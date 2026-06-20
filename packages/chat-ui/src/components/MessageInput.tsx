import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import type { AnyMessage } from '@somni/chat-core';
import { useSendMessage, useTyping } from '@somni/chat-react';

interface MessageInputProps {
  conversationId: string;
  replyTo?: AnyMessage | null;
  onCancelReply?: () => void;
  placeholder?: string;
  disabled?: boolean;
  onSent?: (message: AnyMessage) => void;
  className?: string;
}

export function MessageInput({
  conversationId,
  replyTo,
  onCancelReply,
  placeholder = 'Type a message…',
  disabled = false,
  onSent,
  className = '',
}: MessageInputProps) {
  const [text, setText] = useState('');
  const { sendMessage, isSending } = useSendMessage();
  const { notifyTyping, stopTyping } = useTyping(conversationId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || isSending) return;

    setText('');
    await stopTyping(conversationId);

    const message = await sendMessage({
      conversation_id: conversationId,
      content,
      reply_to_id: replyTo?.id,
    });

    onSent?.(message);
    onCancelReply?.();

    // Resize textarea back to default
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isSending, sendMessage, conversationId, replyTo, onSent, onCancelReply, stopTyping]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      notifyTyping();

      // Auto-grow textarea
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    },
    [notifyTyping]
  );

  return (
    <div className={`somni-message-input ${className}`}>
      {replyTo && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          right: 0,
          padding: '0.5rem 1rem',
          background: 'var(--somni-bg-secondary)',
          borderTop: '1px solid var(--somni-border)',
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ color: 'var(--somni-text-secondary)' }}>
            Replying to: {replyTo.content.slice(0, 60)}
            {replyTo.content.length > 60 ? '…' : ''}
          </span>
          <button
            onClick={onCancelReply}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
            aria-label="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="somni-message-input__textarea"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isSending}
        rows={1}
        aria-label="Message input"
        aria-multiline="true"
      />

      <button
        className="somni-message-input__send"
        onClick={() => void handleSend()}
        disabled={!text.trim() || isSending || disabled}
        aria-label="Send message"
      >
        {isSending ? '…' : 'Send'}
      </button>
    </div>
  );
}
