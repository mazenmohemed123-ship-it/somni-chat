import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CallEngine,
  CallSession,
  CallState,
  CallType,
  MediaConstraints,
  MediaStreamLike,
  RemoteTrack,
} from '@somni/chat-call';

export interface UseCallReturn {
  session: CallSession | null;
  state: CallState;
  localStream: MediaStreamLike | null;
  remoteTracks: RemoteTrack[];
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  start: (conversationId: string, type: CallType, peers: string[], constraints?: Partial<MediaConstraints>) => Promise<void>;
  accept: (constraints?: Partial<MediaConstraints>) => Promise<void>;
  reject: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
}

/**
 * Binds a {@link CallEngine} to React state. Pass an engine instance you created
 * with your chosen provider (WebRTC / LiveKit / Daily). The hook subscribes to
 * call events and exposes reactive session, media, and controls.
 *
 * `@somni/chat-call` is an optional peer dependency — only import this hook in
 * apps that use calling.
 */
export function useCall(engine: CallEngine): UseCallReturn {
  const [session, setSession] = useState<CallSession | null>(engine.currentCall as CallSession | null);
  const [localStream, setLocalStream] = useState<MediaStreamLike | null>(null);
  const [remoteTracks, setRemoteTracks] = useState<RemoteTrack[]>([]);
  const mounted = useRef(true);

  const syncSession = useCallback(() => {
    if (mounted.current) setSession(engine.currentCall ? ({ ...engine.currentCall } as CallSession) : null);
  }, [engine]);

  useEffect(() => {
    mounted.current = true;
    const offs = [
      engine.on('call:outgoing', syncSession),
      engine.on('call:incoming', syncSession),
      engine.on('call:state', syncSession),
      engine.on('call:connected', syncSession),
      engine.on('participant:joined', syncSession),
      engine.on('participant:left', syncSession),
      engine.on('participant:media', syncSession),
      engine.on('call:ended', () => {
        syncSession();
        if (mounted.current) {
          setLocalStream(null);
          setRemoteTracks([]);
        }
      }),
      engine.on('local-stream', (e) => {
        if (mounted.current) setLocalStream(e.payload.stream);
      }),
      engine.on('remote-track', (e) => {
        if (!mounted.current) return;
        setRemoteTracks((prev) => [
          ...prev.filter((t) => !(t.user_id === e.payload.user_id && t.kind === e.payload.kind)),
          e.payload,
        ]);
      }),
      engine.on('remote-track:removed', (e) => {
        if (!mounted.current) return;
        setRemoteTracks((prev) =>
          prev.filter((t) => !(t.user_id === e.payload.user_id && t.kind === e.payload.kind))
        );
      }),
    ];
    return () => {
      mounted.current = false;
      offs.forEach((off) => off());
    };
  }, [engine, syncSession]);

  const local = session?.participants.find((p) => p.is_local);

  const start = useCallback(
    async (conversationId: string, type: CallType, peers: string[], constraints?: Partial<MediaConstraints>) => {
      await engine.start(conversationId, type, { peers, constraints });
    },
    [engine]
  );

  const accept = useCallback((constraints?: Partial<MediaConstraints>) => engine.accept(constraints), [engine]);
  const reject = useCallback(() => engine.reject(), [engine]);
  const hangup = useCallback(() => engine.hangup(), [engine]);
  const toggleMic = useCallback(() => engine.setMicEnabled(!(local?.audio_enabled ?? true)), [engine, local]);
  const toggleCamera = useCallback(() => engine.setCameraEnabled(!(local?.video_enabled ?? true)), [engine, local]);

  return {
    session,
    state: session?.state ?? 'idle',
    localStream,
    remoteTracks,
    isMicEnabled: local?.audio_enabled ?? false,
    isCameraEnabled: local?.video_enabled ?? false,
    start,
    accept,
    reject,
    hangup,
    toggleMic,
    toggleCamera,
  };
}
