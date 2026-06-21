import type { CallProvider, CallProviderContext, CallProviderEvent } from '../provider/CallProvider';
import type { CallSignaling, SignalMessage } from '../types/signaling';
import type {
  CallSession,
  CallType,
  CallState,
  CallEndReason,
  CallParticipant,
  MediaConstraints,
} from '../types/call';
import type { CallEvent, CallEventType, CallEventListener } from '../types/events';
import { CallEmitter } from './CallEmitter';
import { generateId } from '@somni/chat-core';

export interface CallEngineConfig {
  /** Local user id. */
  selfId: string;
  /** Signaling transport (InMemory, Transport-backed, or custom). */
  signaling: CallSignaling;
  /** Media provider (WebRTC mesh, LiveKit, Daily…). */
  provider: CallProvider;
  /** Ms to wait for an answer before giving up (default: 30000). */
  ringTimeoutMs?: number;
}

const now = (): string => new Date().toISOString();

/**
 * Framework-agnostic voice/video call orchestrator.
 *
 * Responsibilities:
 *  - call lifecycle state machine (idle → ringing/incoming → connecting → connected → ended)
 *  - signaling routing (invite/accept/reject/cancel/leave + offer/answer/ice for mesh)
 *  - participant + media-state tracking
 *  - delegating media to a pluggable {@link CallProvider}
 *
 * It deliberately knows nothing about the DOM, React, or any specific backend.
 */
export class CallEngine {
  private readonly emitter = new CallEmitter();
  private readonly selfId: string;
  private readonly signaling: CallSignaling;
  private readonly provider: CallProvider;
  private readonly ringTimeoutMs: number;

  private session: CallSession | null = null;
  private unsubscribeSignal: (() => void) | null = null;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private connectedEmitted = false;

  constructor(config: CallEngineConfig) {
    this.selfId = config.selfId;
    this.signaling = config.signaling;
    this.provider = config.provider;
    this.ringTimeoutMs = config.ringTimeoutMs ?? 30_000;
    this.unsubscribeSignal = this.signaling.subscribe((msg) => void this.onSignal(msg));
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get currentCall(): Readonly<CallSession> | null {
    return this.session;
  }

  get state(): CallState {
    return this.session?.state ?? 'idle';
  }

  on<T extends CallEventType>(type: T, listener: CallEventListener<T>): () => void {
    return this.emitter.on(type, listener);
  }

  /** Place an outgoing call. */
  async start(
    conversationId: string,
    callType: CallType,
    options: { peers: string[]; constraints?: Partial<MediaConstraints> }
  ): Promise<CallSession> {
    if (this.session && this.session.state !== 'ended') {
      throw new Error('[Somni Call] A call is already in progress.');
    }
    const constraints = this.resolveConstraints(callType, options.constraints);
    const callId = generateId();

    this.session = {
      id: callId,
      conversation_id: conversationId,
      type: callType,
      state: 'ringing',
      initiator_id: this.selfId,
      participants: [this.localParticipant(constraints)],
      started_at: now(),
      connected_at: null,
      ended_at: null,
      end_reason: null,
    };
    this.connectedEmitted = false;

    this.emitter.emit({ type: 'call:outgoing', payload: this.session });

    // Acquire local media now; offers are created when peers accept.
    await this.provider.join(this.buildProviderContext(callId, callType, [], constraints));

    for (const peer of options.peers) {
      await this.signaling.send({
        kind: 'invite',
        call_id: callId,
        conversation_id: conversationId,
        from: this.selfId,
        call_type: callType,
        to: peer,
      });
    }

    this.armRingTimeout();
    return this.session;
  }

  /** Accept an incoming call. */
  async accept(constraints?: Partial<MediaConstraints>): Promise<void> {
    if (!this.session || this.session.state !== 'incoming') {
      throw new Error('[Somni Call] No incoming call to accept.');
    }
    const merged = this.resolveConstraints(this.session.type, constraints);
    this.clearRingTimeout();
    this.setState('connecting');

    const initiator = this.session.initiator_id;
    await this.provider.join(
      this.buildProviderContext(this.session.id, this.session.type, [initiator], merged)
    );

    await this.signaling.send({ kind: 'accept', call_id: this.session.id, from: this.selfId, to: initiator });
  }

  /** Reject an incoming call. */
  async reject(reason: CallEndReason = 'rejected'): Promise<void> {
    if (!this.session || this.session.state !== 'incoming') return;
    await this.signaling.send({
      kind: 'reject',
      call_id: this.session.id,
      from: this.selfId,
      to: this.session.initiator_id,
      reason,
    });
    await this.end(reason);
  }

  /** Hang up / leave the current call. */
  async hangup(): Promise<void> {
    if (!this.session || this.session.state === 'ended') return;
    await this.signaling.send({ kind: 'leave', call_id: this.session.id, from: this.selfId });
    await this.end('hangup');
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    await this.provider.setMicEnabled(enabled);
    this.updateLocalMedia({ audio_enabled: enabled });
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    await this.provider.setCameraEnabled(enabled);
    this.updateLocalMedia({ video_enabled: enabled });
  }

  /** Release all resources (call this on unmount). */
  async destroy(): Promise<void> {
    await this.end('hangup', /*silent*/ true);
    this.unsubscribeSignal?.();
    this.unsubscribeSignal = null;
    this.emitter.removeAll();
  }

  // ─── Signaling ──────────────────────────────────────────────────────────────

  private async onSignal(msg: SignalMessage): Promise<void> {
    // Address filter for targeted messages.
    if ('to' in msg && msg.to && msg.to !== this.selfId) return;

    switch (msg.kind) {
      case 'invite':
        return this.onInvite(msg);
      case 'accept':
        return this.onAccept(msg);
      case 'reject':
        if (this.isForCurrent(msg)) await this.end(msg.reason ?? 'rejected');
        return;
      case 'cancel':
        if (this.isForCurrent(msg)) await this.end('cancelled');
        return;
      case 'leave':
        return this.onLeave(msg);
      case 'media-state':
        return this.onMediaState(msg);
      case 'offer':
      case 'answer':
      case 'ice':
        if (this.isForCurrent(msg) && !this.provider.handlesSignaling) {
          await this.provider.handleSignal?.(msg);
        }
        return;
      default:
        return;
    }
  }

  private onInvite(msg: Extract<SignalMessage, { kind: 'invite' }>): void {
    if (this.session && this.session.state !== 'ended') return; // busy
    const constraints = this.resolveConstraints(msg.call_type);
    this.session = {
      id: msg.call_id,
      conversation_id: msg.conversation_id,
      type: msg.call_type,
      state: 'incoming',
      initiator_id: msg.from,
      participants: [this.localParticipant(constraints), this.remoteParticipant(msg.from)],
      started_at: now(),
      connected_at: null,
      ended_at: null,
      end_reason: null,
    };
    this.connectedEmitted = false;
    this.emitter.emit({ type: 'call:incoming', payload: this.session });
    this.armRingTimeout('no-answer');
  }

  private async onAccept(msg: Extract<SignalMessage, { kind: 'accept' }>): Promise<void> {
    if (!this.session || !this.isForCurrent(msg)) return;
    if (this.session.initiator_id !== this.selfId) return; // only the caller reacts to accept
    this.clearRingTimeout();
    this.ensureParticipant(msg.from);
    this.setState('connecting');
    await this.provider.addPeer?.(msg.from);
  }

  private async onLeave(msg: Extract<SignalMessage, { kind: 'leave' }>): Promise<void> {
    if (!this.session || !this.isForCurrent(msg)) return;
    this.removeParticipant(msg.from);
    // In a 1:1 call, the remote leaving ends the call.
    const remotes = this.session.participants.filter((p) => !p.is_local);
    if (remotes.length === 0) await this.end('remote-hangup');
  }

  private onMediaState(msg: Extract<SignalMessage, { kind: 'media-state' }>): void {
    if (!this.session || !this.isForCurrent(msg)) return;
    const p = this.ensureParticipant(msg.from);
    p.audio_enabled = msg.audio_enabled;
    p.video_enabled = msg.video_enabled;
    this.emitter.emit({ type: 'participant:media', payload: { ...p } });
  }

  // ─── Provider event bridge ──────────────────────────────────────────────────

  private buildProviderContext(
    callId: string,
    callType: CallType,
    peers: string[],
    constraints: MediaConstraints
  ): CallProviderContext {
    return {
      callId,
      selfId: this.selfId,
      callType,
      peers,
      constraints,
      signaling: this.signaling,
      emit: (event) => this.onProviderEvent(event),
    };
  }

  private onProviderEvent(event: CallProviderEvent): void {
    if (!this.session) return;
    switch (event.type) {
      case 'local-stream':
        this.emitter.emit({ type: 'local-stream', payload: { stream: event.stream } });
        break;
      case 'remote-track':
        this.ensureParticipant(event.track.user_id);
        this.emitter.emit({ type: 'remote-track', payload: event.track });
        break;
      case 'remote-track-removed':
        this.emitter.emit({ type: 'remote-track:removed', payload: { user_id: event.user_id, kind: event.kind } });
        break;
      case 'peer-joined': {
        const p = this.ensureParticipant(event.user_id);
        this.emitter.emit({ type: 'participant:joined', payload: { ...p } });
        break;
      }
      case 'peer-left':
        this.removeParticipant(event.user_id);
        break;
      case 'state':
        if (event.state === 'connected') this.markConnected();
        else if (event.state === 'reconnecting') this.setState('reconnecting');
        else if (event.state === 'failed') void this.end('error');
        break;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private resolveConstraints(callType: CallType, partial?: Partial<MediaConstraints>): MediaConstraints {
    const base: MediaConstraints = { audio: true, video: callType === 'video' };
    return { audio: partial?.audio ?? base.audio, video: partial?.video ?? base.video };
  }

  private localParticipant(constraints: MediaConstraints): CallParticipant {
    return {
      user_id: this.selfId,
      is_local: true,
      audio_enabled: constraints.audio,
      video_enabled: constraints.video,
      speaking: false,
      joined_at: now(),
    };
  }

  private remoteParticipant(userId: string): CallParticipant {
    return {
      user_id: userId,
      is_local: false,
      audio_enabled: true,
      video_enabled: this.session?.type === 'video',
      speaking: false,
      joined_at: now(),
    };
  }

  private ensureParticipant(userId: string): CallParticipant {
    if (!this.session) throw new Error('no session');
    let p = this.session.participants.find((x) => x.user_id === userId);
    if (!p) {
      p = userId === this.selfId ? this.localParticipant({ audio: true, video: this.session.type === 'video' }) : this.remoteParticipant(userId);
      this.session.participants.push(p);
    }
    return p;
  }

  private removeParticipant(userId: string): void {
    if (!this.session) return;
    const before = this.session.participants.length;
    this.session.participants = this.session.participants.filter((p) => p.user_id !== userId);
    if (this.session.participants.length !== before) {
      this.emitter.emit({ type: 'participant:left', payload: { user_id: userId } });
    }
  }

  private updateLocalMedia(patch: Partial<Pick<CallParticipant, 'audio_enabled' | 'video_enabled'>>): void {
    if (!this.session) return;
    const local = this.session.participants.find((p) => p.is_local);
    if (!local) return;
    Object.assign(local, patch);
    void this.signaling.send({
      kind: 'media-state',
      call_id: this.session.id,
      from: this.selfId,
      audio_enabled: local.audio_enabled,
      video_enabled: local.video_enabled,
    });
    this.emitter.emit({ type: 'participant:media', payload: { ...local } });
  }

  private setState(state: CallState): void {
    if (!this.session || this.session.state === state) return;
    this.session.state = state;
    this.emitter.emit({ type: 'call:state', payload: { call_id: this.session.id, state } });
  }

  private markConnected(): void {
    if (!this.session) return;
    if (this.session.state !== 'connected') {
      this.session.state = 'connected';
      this.session.connected_at = now();
      this.emitter.emit({ type: 'call:state', payload: { call_id: this.session.id, state: 'connected' } });
    }
    if (!this.connectedEmitted) {
      this.connectedEmitted = true;
      this.emitter.emit({ type: 'call:connected', payload: this.session });
    }
  }

  private isForCurrent(msg: { call_id: string }): boolean {
    return !!this.session && this.session.id === msg.call_id;
  }

  private armRingTimeout(reason: CallEndReason = 'no-answer'): void {
    this.clearRingTimeout();
    this.ringTimer = setTimeout(() => {
      if (this.session && (this.session.state === 'ringing' || this.session.state === 'incoming')) {
        void this.end(reason);
      }
    }, this.ringTimeoutMs);
    if (this.ringTimer && typeof (this.ringTimer as { unref?: () => void }).unref === 'function') {
      (this.ringTimer as { unref: () => void }).unref();
    }
  }

  private clearRingTimeout(): void {
    if (this.ringTimer) {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
  }

  private async end(reason: CallEndReason, silent = false): Promise<void> {
    if (!this.session || this.session.state === 'ended') return;
    this.clearRingTimeout();
    const callId = this.session.id;
    this.session.state = 'ended';
    this.session.ended_at = now();
    this.session.end_reason = reason;
    try {
      await this.provider.leave();
    } catch {
      /* ignore provider teardown errors */
    }
    if (!silent) this.emitter.emit({ type: 'call:ended', payload: { call_id: callId, reason } });
  }
}
