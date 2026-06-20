import { Client, Databases, Realtime } from 'appwrite';
import { createChat } from '@somni/chat-core';
import { AppwriteAdapter } from '@somni/adapter-appwrite';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? 'https://cloud.appwrite.io/v1')
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? '');

const databases = new Databases(client);
const realtime = new Realtime(client);

export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? '';

export const COLLECTIONS = {
  conversations: 'conversations',
  participants: 'participants',
  messages: 'messages',
  attachments: 'attachments',
  reactions: 'reactions',
  presence: 'presence',
} as const;

/**
 * Factory — call this once per authenticated user.
 * Pass the userId from your auth system (Appwrite, NextAuth, Clerk, etc.)
 */
export function buildChatEngine(userId: string) {
  const adapter = new AppwriteAdapter({
    client,
    databases,
    realtime,
    databaseId: DATABASE_ID,
    collections: COLLECTIONS,
  });

  return createChat({
    adapter,
    userId,
    typingTimeoutMs: 3000,
    presenceIntervalMs: 30_000,
    offlineQueue: true,
    reconnect: {
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
    },
  });
}
