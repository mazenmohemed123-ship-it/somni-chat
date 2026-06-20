import { useMemo } from 'react';
import type { AnyMessage } from '@somni/chat-core';
import { useChatEngine } from '@somni/chat-react';

interface MessageItemProps {
  message: AnyMessage;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: AnyMessage) => void;
  renderSenderName?: (senderId: string) => string;
  className?: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageItem({
  message,
  onReact,
  onReply,
  renderSenderName,
  className = '',
}: MessageItemProps) {
  const { userId } = useChatEngine();
  const isMine = message.sender_id === userId;
  const isOptimistic = '_optimistic' in message && message._optimistic;
  const isDeleted = !!message.deleted_at;

  const reactionGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const r of message.reactions) {
      if (!groups.has(r.emoji)) groups.set(r.emoji, []);
      groups.get(r.emoji)!.push(r.user_id);
    }
    return groups;
  }, [message.reactions]);

  const variantClass = isMine ? 'somni-message--mine' : 'somni-message--other';
  const optimisticClass = isOptimistic ? 'somni-message--optimistic' : '';
  const deletedClass = isDeleted ? 'somni-message--deleted' : '';

  return (
    <article
      className={`somni-message ${variantClass} ${optimisticClass} ${deletedClass} ${className}`}
      data-message-id={message.id}
      data-client-id={message.client_id}
    >
      {message.reply_to_preview && (
        <div className="somni-message__reply-preview">
          {message.reply_to_preview}
        </div>
      )}

      <div
        className="somni-message__bubble"
        role="article"
        aria-label={`Message from ${isMine ? 'you' : (renderSenderName?.(message.sender_id) ?? message.sender_id)}`}
      >
        {!isMine && renderSenderName && (
          <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', opacity: 0.7 }}>
            {renderSenderName(message.sender_id)}
          </div>
        )}
        {isDeleted ? (
          <em>Message deleted</em>
        ) : (
          <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
        )}
      </div>

      {reactionGroups.size > 0 && (
        <div className="somni-message__reactions" role="group" aria-label="Reactions">
          {Array.from(reactionGroups.entries()).map(([emoji, users]) => (
            <button
              key={emoji}
              className="somni-message__reaction"
              onClick={() => onReact?.(message.id, emoji)}
              title={users.join(', ')}
              aria-label={`${emoji} ${users.length}`}
            >
              {emoji} <span>{users.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="somni-message__meta">
        <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
        {message.edited_at && <span>· edited</span>}
        {isOptimistic && <span>· sending…</span>}
        {isMine && !isOptimistic && message.read_at && <span aria-label="Read">✓✓</span>}
        {isMine && !isOptimistic && !message.read_at && <span aria-label="Delivered">✓</span>}
        {onReply && !isDeleted && (
          <button
            onClick={() => onReply(message)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', color: 'inherit', padding: 0, marginLeft: '0.25rem' }}
            aria-label="Reply"
          >
            ↩ Reply
          </button>
        )}
      </div>
    </article>
  );
}
