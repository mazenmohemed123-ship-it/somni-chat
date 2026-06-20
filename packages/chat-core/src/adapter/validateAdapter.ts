import type { ChatAdapter } from './ChatAdapter';

export class AdapterComplianceError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `Adapter is not compliant with ChatAdapter. Missing or invalid methods: ${missing.join(', ')}`
    );
    this.name = 'AdapterComplianceError';
    this.missing = missing;
  }
}

/** Every method a compliant adapter MUST implement. */
export const REQUIRED_ADAPTER_METHODS: ReadonlyArray<keyof ChatAdapter> = [
  'connect',
  'disconnect',
  'createConversation',
  'getConversation',
  'listConversations',
  'updateConversation',
  'deleteConversation',
  'subscribeConversations',
  'addParticipant',
  'removeParticipant',
  'listParticipants',
  'updateParticipantRole',
  'sendMessage',
  'editMessage',
  'deleteMessage',
  'getMessage',
  'listMessages',
  'subscribeMessages',
  'markAsRead',
  'addReaction',
  'removeReaction',
  'updatePresence',
  'getPresence',
  'subscribePresence',
  'updateTyping',
  'subscribeTyping',
  'uploadAttachment',
];

/**
 * Runtime compliance check. Catches the classic "I wrote a custom adapter and
 * forgot a method" failure at `createChat()` time with a clear error, instead
 * of a cryptic `undefined is not a function` deep inside a realtime callback.
 */
export function validateAdapter(adapter: ChatAdapter): void {
  if (!adapter || typeof adapter !== 'object') {
    throw new AdapterComplianceError(['<adapter is not an object>']);
  }
  const missing: string[] = [];
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof (adapter as Record<string, unknown>)[method] !== 'function') {
      missing.push(method);
    }
  }
  if (missing.length > 0) {
    throw new AdapterComplianceError(missing);
  }
}

/** Non-throwing variant for diagnostics / health endpoints. */
export function isAdapterCompliant(adapter: ChatAdapter): boolean {
  try {
    validateAdapter(adapter);
    return true;
  } catch {
    return false;
  }
}
