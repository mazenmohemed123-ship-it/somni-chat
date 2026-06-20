'use client';

import { useMemo } from 'react';
import { ChatProvider } from '@somni/chat-react';
import { Chat } from '@somni/chat-ui';
import { buildChatEngine } from '../lib/chat';

interface ChatAppProps {
  userId: string;
  userMap?: Record<string, string>;
}

/**
 * Client component that bootstraps the chat engine and renders the full UI.
 *
 * Usage in a Server Component:
 *   const session = await getServerSession();
 *   return <ChatApp userId={session.user.id} />;
 */
export default function ChatApp({ userId, userMap = {} }: ChatAppProps) {
  // Memoize so engine is created once per userId
  const engine = useMemo(() => buildChatEngine(userId), [userId]);

  return (
    <ChatProvider engine={engine} autoConnect>
      <Chat
        resolveUserName={(id) => userMap[id] ?? id}
        theme="light"
        style={{ height: '100%' } as React.CSSProperties}
      />
    </ChatProvider>
  );
}
