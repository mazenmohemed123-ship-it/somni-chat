import { useEffect, useRef } from 'react';
import type { AnyMessage } from '@somni/chat-core';
import { useMessages } from '@somni/chat-react';
import { MessageItem } from './MessageItem';
import { TypingIndicator } from './TypingIndicator';

interface MessageListProps {
  conversationId: string;
  typingUserIds?: string[];
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: AnyMessage) => void;
  renderSenderName?: (senderId: string) => string;
  className?: string;
}

export function MessageList({
  conversationId,
  typingUserIds = [],
  onReact,
  onReply,
  renderSenderName,
  className = '',
}: MessageListProps) {
  const { messages, isLoading, hasMore, loadMore } = useMessages({ conversationId });
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (isLoading) {
    return (
      <div className={`somni-message-list ${className}`} role="log" aria-label="Messages" aria-busy="true">
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--somni-text-secondary)' }}>
          Loading messages…
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`somni-message-list ${className}`}
      role="log"
      aria-label="Messages"
      aria-live="polite"
    >
      {hasMore && (
        <div className="somni-message-list__load-more">
          <button onClick={() => void loadMore()} aria-label="Load older messages">
            Load older messages
          </button>
        </div>
      )}

      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          onReact={onReact}
          onReply={onReply}
          renderSenderName={renderSenderName}
        />
      ))}

      <TypingIndicator userIds={typingUserIds} renderUser={renderSenderName} />
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
