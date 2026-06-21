import type { CallSignaling, SignalMessage } from '../types/signaling';

/**
 * A pluggable transport: anything that can publish a JSON payload to a topic and
 * subscribe to it. This lets you carry call signaling over your EXISTING Somni
 * realtime backend (Supabase broadcast, Appwrite realtime, a WebSocket, etc.)
 * without the call layer knowing the details.
 */
export interface SignalTransport {
  publish(topic: string, payload: unknown): Promise<void> | void;
  subscribe(topic: string, callback: (payload: unknown) => void): () => void;
}

/**
 * Bridges a generic {@link SignalTransport} to the {@link CallSignaling} contract.
 * Topic is namespaced per conversation so call traffic is isolated.
 */
export class TransportSignaling implements CallSignaling {
  private readonly transport: SignalTransport;
  private readonly topic: string;

  constructor(transport: SignalTransport, conversationId: string) {
    this.transport = transport;
    this.topic = `somni:call:${conversationId}`;
  }

  send(message: SignalMessage): Promise<void> | void {
    return this.transport.publish(this.topic, message);
  }

  subscribe(callback: (message: SignalMessage) => void): () => void {
    return this.transport.subscribe(this.topic, (payload) => {
      callback(payload as SignalMessage);
    });
  }
}
