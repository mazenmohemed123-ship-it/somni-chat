import { useConversations } from '@somni/chat-react';
import type { Conversation } from '@somni/chat-core';
import { OnlineIndicator } from './OnlineIndicator';
import { usePresence } from '@somni/chat-react';

interface ConversationListProps {
  activeId?: string;
  onSelect: (conversation: Conversation) => void;
  participantIds?: string[];
  renderAvatar?: (conversation: Conversation) => React.ReactNode;
  className?: string;
}

function getInitials(title: string | null): string {
  if (!title) return '?';
  return title.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function ConversationList({
  activeId,
  onSelect,
  participantIds = [],
  renderAvatar,
  className = '',
}: ConversationListProps) {
  const { conversations, isLoading, hasMore, loadMore } = useConversations();
  const { isOnline } = usePresence(participantIds);

  if (isLoading) {
    return (
      <nav className={`somni-conversation-list ${className}`} aria-label="Conversations">
        <div style={{ padding: '1rem', color: 'var(--somni-text-secondary)', fontSize: '0.875rem' }}>
          Loading…
        </div>
      </nav>
    );
  }

  return (
    <nav className={`somni-conversation-list ${className}`} aria-label="Conversations">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          className="somni-conversation-item"
          data-active={conv.id === activeId}
          onClick={() => onSelect(conv)}
          aria-current={conv.id === activeId ? 'page' : undefined}
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <div className="somni-conversation-item__avatar">
            {renderAvatar ? (
              renderAvatar(conv)
            ) : (
              <>
                {conv.avatar_url ? (
                  <img src={conv.avatar_url} alt={conv.title ?? 'Conversation'} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                ) : (
                  getInitials(conv.title)
                )}
                {conv.type === 'direct' && participantIds.length > 0 && (
                  <OnlineIndicator status={isOnline(participantIds[0] ?? '') ? 'online' : 'offline'} />
                )}
              </>
            )}
          </div>

          <div className="somni-conversation-item__info">
            <div className="somni-conversation-item__name">
              {conv.title ?? 'Direct Message'}
            </div>
            {conv.last_message_preview && (
              <div className="somni-conversation-item__preview">
                {conv.last_message_preview}
              </div>
            )}
          </div>

          {conv.last_message_at && (
            <time
              dateTime={conv.last_message_at}
              style={{ fontSize: '0.7rem', color: 'var(--somni-text-secondary)', flexShrink: 0 }}
            >
              {formatRelativeTime(conv.last_message_at)}
            </time>
          )}
        </button>
      ))}

      {hasMore && (
        <button
          onClick={() => void loadMore()}
          style={{
            width: '100%',
            padding: '0.75rem',
            background: 'none',
            border: 'none',
            borderTop: '1px solid var(--somni-border)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            color: 'var(--somni-text-secondary)',
          }}
        >
          Load more
        </button>
      )}
    </nav>
  );
}
