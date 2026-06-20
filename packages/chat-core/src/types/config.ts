import type { ChatAdapter } from '../adapter/ChatAdapter';

export interface ChatEngineConfig {
  /** Backend adapter (Supabase, Appwrite, Firebase, Custom) */
  adapter: ChatAdapter;

  /** Current authenticated user ID */
  userId: string;

  /** Typing indicator auto-stop timeout in ms (default: 3000) */
  typingTimeoutMs?: number;

  /** Presence heartbeat interval in ms (default: 30000) */
  presenceIntervalMs?: number;

  /** Reconnect backoff config */
  reconnect?: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };

  /** Enable offline queue for messages sent while disconnected */
  offlineQueue?: boolean;

  /** Max messages kept in memory per conversation */
  messagePageSize?: number;

  /** Plugin hooks for extensibility */
  plugins?: ChatPlugin[];
}

export interface ChatPlugin {
  name: string;
  onBeforeSend?: (input: unknown) => unknown | Promise<unknown>;
  onAfterReceive?: (message: unknown) => unknown | Promise<unknown>;
  onPresenceChange?: (presence: unknown) => void;
}
