import { useState } from 'react';
import type { Conversation, AnyMessage } from '@somni/chat-core';
import { useChatEngine } from '@somni/chat-react';
import { useTyping } from '@somni/chat-react';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

interface ChatProps {
  /** Start with a specific conversation open */
  initialConversationId?: string;
  /** Override the conversation list panel */
  renderConversationList?: (props: { onSelect: (c: Conversation) => void; activeId?: string }) => React.ReactNode;
  /** Override the message list panel */
  renderMessages?: (props: { conversationId: string }) => React.ReactNode;
  /** Render a custom header above the message list */
  renderHeader?: (conversation: Conversation | null) => React.ReactNode;
  /** Map userId → display name */
  resolveUserName?: (userId: string) => string;
  /** Map userId → presence participant ids for online indicators */
  participantIds?: string[];
  className?: string;
  theme?: 'light' | 'dark';
}

function DefaultHeader({ conversation }: { conversation: Conversation | null }) {
  if (!conversation) return null;
  return (
    <div style={{
      padding: '0.875rem 1rem',
      borderBottom: '1px solid var(--somni-border)',
      fontWeight: 600,
      fontSize: '0.95rem',
    }}>
      {conversation.title ?? 'Direct Message'}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--somni-text-secondary)',
      fontSize: '0.9rem',
    }}>
      Select a conversation to start chatting
    </div>
  );
}

export function Chat({
  initialConversationId,
  renderConversationList,
  renderMessages,
  renderHeader,
  resolveUserName,
  participantIds = [],
  className = '',
  theme = 'light',
}: ChatProps) {
  const { isConnected } = useChatEngine();
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [replyTo, setReplyTo] = useState<AnyMessage | null>(null);

  const conversationId = activeConversation?.id ?? initialConversationId;
  const { typingUserIds } = useTyping(conversationId ?? '');

  return (
    <div
      className={`somni-chat ${className}`}
      data-somni-theme={theme}
      role="main"
      aria-label="Chat"
    >
      {/* Connection banner */}
      {!isConnected && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          background: '#ef4444',
          color: '#fff',
          textAlign: 'center',
          padding: '0.375rem',
          fontSize: '0.8rem',
          zIndex: 10,
        }}>
          Reconnecting…
        </div>
      )}

      {/* Conversation list */}
      {renderConversationList ? (
        renderConversationList({ onSelect: setActiveConversation, activeId: activeConversation?.id })
      ) : (
        <ConversationList
          activeId={activeConversation?.id}
          onSelect={setActiveConversation}
          participantIds={participantIds}
        />
      )}

      {/* Main chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {conversationId ? (
          <>
            {renderHeader ? renderHeader(activeConversation) : <DefaultHeader conversation={activeConversation} />}

            {renderMessages ? (
              renderMessages({ conversationId })
            ) : (
              <MessageList
                conversationId={conversationId}
                typingUserIds={typingUserIds}
                onReply={setReplyTo}
                renderSenderName={resolveUserName}
              />
            )}

            <MessageInput
              conversationId={conversationId}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}
