// Engine
export { CallEngine } from './engine/CallEngine';
export type { CallEngineConfig } from './engine/CallEngine';
export { CallEmitter } from './engine/CallEmitter';

// Providers (WebRTC native is bundled; LiveKit/Daily via sub-path exports)
export * from './provider/index';

// Signaling
export { InMemorySignalingBus } from './signaling/InMemorySignaling';
export { TransportSignaling } from './signaling/TransportSignaling';
export type { SignalTransport } from './signaling/TransportSignaling';

// Types
export type {
  CallType,
  CallState,
  CallEndReason,
  CallSession,
  CallParticipant,
  MediaConstraints,
  MediaStreamLike,
  RemoteTrack,
} from './types/call';
export type { CallSignaling, SignalMessage, SignalKind } from './types/signaling';
export type { CallEvent, CallEventType, CallEventListener } from './types/events';
