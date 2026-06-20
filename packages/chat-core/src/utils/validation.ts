import type { SendMessageInput, MessageType } from '../types/message';

export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export interface MessageValidationOptions {
  /** Max characters allowed in message content (default: 8000) */
  maxContentLength?: number;
  /** Allow empty content when attachments are present (default: true) */
  allowEmptyWithAttachments?: boolean;
  /** Allowed message types */
  allowedTypes?: MessageType[];
}

const DEFAULT_MAX_LENGTH = 8000;
const ALLOWED_TYPES: MessageType[] = ['text', 'attachment', 'system', 'reply', 'ai'];

// Matches C0/C1 control characters except TAB (U+0009) and LF (U+000A).
// Built from an escaped string so no raw control bytes live in the source file.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]', 'g');

/**
 * Removes invisible control characters that could break rendering or smuggle
 * terminal escape sequences. Does NOT HTML-escape (the rendering layer owns that),
 * but strips the dangerous invisible bytes and trims surrounding whitespace.
 */
export function sanitizeContent(content: string): string {
  return content.replace(CONTROL_CHARS, '').trim();
}

/**
 * Validates and normalizes a send-message input before it reaches an adapter.
 * Throws ValidationError on invalid input. Returns a sanitized copy.
 */
export function validateMessageInput(
  input: Omit<SendMessageInput, 'client_id'>,
  options: MessageValidationOptions = {}
): Omit<SendMessageInput, 'client_id'> {
  const maxLen = options.maxContentLength ?? DEFAULT_MAX_LENGTH;
  const allowEmpty = options.allowEmptyWithAttachments ?? true;
  const allowedTypes = options.allowedTypes ?? ALLOWED_TYPES;

  if (!input || typeof input !== 'object') {
    throw new ValidationError('INVALID_INPUT', 'Message input must be an object');
  }

  if (typeof input.conversation_id !== 'string' || input.conversation_id.length === 0) {
    throw new ValidationError('INVALID_CONVERSATION_ID', 'conversation_id is required');
  }

  const type = input.type ?? 'text';
  if (!allowedTypes.includes(type)) {
    throw new ValidationError('INVALID_TYPE', `Message type "${type}" is not allowed`);
  }

  const rawContent = typeof input.content === 'string' ? input.content : '';
  const content = sanitizeContent(rawContent);
  const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;

  if (content.length === 0 && !(allowEmpty && hasAttachments)) {
    throw new ValidationError('EMPTY_CONTENT', 'Message content cannot be empty');
  }

  if (content.length > maxLen) {
    throw new ValidationError(
      'CONTENT_TOO_LONG',
      `Message content exceeds maximum length of ${maxLen} characters`
    );
  }

  if (input.reply_to_id !== undefined && typeof input.reply_to_id !== 'string') {
    throw new ValidationError('INVALID_REPLY_TO', 'reply_to_id must be a string');
  }

  return { ...input, type, content };
}
