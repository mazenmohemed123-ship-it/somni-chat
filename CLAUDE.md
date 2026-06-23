# Somni Chat Engine — Claude Code Integration Guide

This file tells Claude Code everything it needs to know to integrate Somni Chat
into any project in this workspace or any future project that references this repo.

---

## What is Somni Chat?

A production-grade, framework-agnostic messaging engine published as a monorepo
of npm packages. It handles: real-time messages, optimistic updates,
exactly-once delivery, offline queuing, typing indicators, presence, reactions,
attachments, voice/video calls, push notifications, and analytics.

**The critical design principle**: The engine never talks to a database directly.
It delegates ALL I/O to a `ChatAdapter` that you provide. Swapping backends =
swapping one class. No logic changes required.

---

## Repository layout

```
packages/
  chat-core/            ← @somni/chat-core       The engine + adapter contract
  chat-call/            ← @somni/chat-call        WebRTC + LiveKit/Daily calls
  chat-react/           ← @somni/chat-react       React hooks
  chat-ui/              ← @somni/chat-ui          Ready-made UI components
  chat-notifications/   ← @somni/notifications    FCM / APNs / Web Push
  chat-analytics/       ← @somni/analytics        DAU, delivery rates, p99
  chat-adapters/
    supabase/           ← @somni/adapter-supabase Supabase + Auth integration
    firebase/           ← @somni/adapter-firebase Firestore + Auth integration
    appwrite/           ← @somni/adapter-appwrite Appwrite adapter
examples/
  nextjs-appwrite/      ← Full Next.js 14 + Appwrite example
docs/
  calls.md              ← Voice/video call guide
  publishing.md         ← How to publish to npm manually
  verification.md       ← How to run the 252 tests
```

---

## How to integrate into a NEW project

### Step 1 — Choose the right adapter

| Backend | Package | Auth helper |
|---------|---------|-------------|
| Supabase | `@somni/adapter-supabase` | `SupabaseAuth` |
| Firebase/Firestore | `@somni/adapter-firebase` | `FirebaseAuth` |
| Appwrite | `@somni/adapter-appwrite` | — |
| Custom REST/WS | Write a class implementing `ChatAdapter` | — |

### Step 2 — Install

```bash
# Supabase
npm install @somni/chat-core @somni/adapter-supabase

# Firebase
npm install @somni/chat-core @somni/adapter-firebase

# With React hooks
npm install @somni/chat-react

# Calls (optional)
npm install @somni/chat-call
```

### Step 3 — Create the engine (always the same pattern)

```typescript
import { createChat } from '@somni/chat-core';
import { FirebaseAdapter, FirebaseAuth } from '@somni/adapter-firebase';

// or: import { SupabaseAdapter, SupabaseAuth } from '@somni/adapter-supabase';

const adapter = new FirebaseAdapter({ firestore, storage });
const auth    = new FirebaseAuth(firebaseAuth);

const userId = auth.getCurrentUserId();
const chat = createChat({
  adapter,
  userId,
  offlineQueue: true,       // survives page refresh
  typingTimeoutMs: 3000,    // auto-stop typing after 3 s silence
  plugins: [],              // optional: moderation, AI, analytics hooks
});

await chat.connect();

// Reconnect automatically on auth change
auth.onAuthStateChange(({ userId }) => {
  if (userId) chat.connect(userId);
  else chat.disconnect();
});
```

### Step 4 — Send and receive messages

```typescript
// Subscribe (set up BEFORE sending — receives optimistic + confirmed)
const unsub = chat.subscribeMessages('conversation-id', (event) => {
  if (event.type === 'message:new')     addToUI(event.payload);
  if (event.type === 'message:updated') updateInUI(event.payload); // optimistic → confirmed
});

// Send (fires message:new immediately with _optimistic: true, then message:updated on confirm)
await chat.sendMessage({ conversation_id: 'conv-id', content: 'Hello!' });

// Clean up
unsub();
await chat.disconnect();
```

### Step 5 — With React (preferred)

```tsx
import { ChatProvider, useMessages, useSendMessage, useTyping } from '@somni/chat-react';

// Wrap your app
<ChatProvider engine={chat} autoConnect>
  <YourApp />
</ChatProvider>

// In any component
function ChatRoom({ conversationId }) {
  const { messages } = useMessages({ conversationId });
  const { sendMessage } = useSendMessage();
  const { typingUserIds, notifyTyping } = useTyping(conversationId);
  // ...
}
```

---

## How to integrate into an EXISTING project (migration)

1. **Install**: `npm install @somni/chat-core @somni/adapter-<your-backend>`

2. **Write the adapter** (if no adapter exists for your backend):
   - Create a class implementing `ChatAdapter` from `@somni/chat-core`
   - Required methods: `connect`, `disconnect`, `sendMessage`, `subscribeMessages`,
     `listMessages`, `createConversation`, `listConversations`, `addParticipant`,
     `listParticipants`, `removeParticipant`, `updateParticipantRole`,
     `getConversation`, `updateConversation`, `deleteConversation`,
     `subscribeConversations`, `editMessage`, `deleteMessage`, `getMessage`,
     `markAsRead`, `addReaction`, `removeReaction`, `uploadAttachment`,
     `updatePresence`, `getPresence`, `subscribePresence`,
     `updateTyping`, `subscribeTyping`
   - Validate your adapter: `import { validateAdapter } from '@somni/chat-core'; validateAdapter(myAdapter);`

3. **Replace your message-sending logic** with `chat.sendMessage()`
   — it handles optimistic updates, deduplication, and offline queuing automatically.

4. **Replace your subscription logic** with `chat.subscribeMessages()`
   — it deduplicates realtime echoes (the double-message bug common in naive setups).

5. **Keep your auth as-is** — just pass `userId` to `createChat()` or `chat.connect(userId)`.

---

## Key APIs Claude Code should use

```typescript
// ─── Always available ─────────────────────────────────────────
chat.state                     // 'idle'|'connecting'|'connected'|'disconnected'|'reconnecting'
chat.isConnected               // boolean
await chat.onceConnected()     // wait until connected (safe to call before connect())

// ─── Message flow ─────────────────────────────────────────────
await chat.sendMessage({ conversation_id, content, reply_to_id? })
chat.subscribeMessages(conversationId, callback)   // returns unsub fn
chat.subscribe(conversationId, callback)           // messages + typing in one call
await chat.listMessages(conversationId, { limit, cursor })
await chat.markAsRead(conversationId, messageId)

// ─── Conversations ────────────────────────────────────────────
await chat.createConversation({ type: 'direct'|'group'|'channel'|'support'|'ai', participant_ids })
await chat.listConversations({ limit, cursor })
chat.subscribeConversations(callback)

// ─── Typing ───────────────────────────────────────────────────
await chat.notifyTyping(conversationId)       // call on keystroke
await chat.stopTyping(conversationId)         // call on send / blur
chat.getTypingUsers(conversationId)           // string[] — no polling needed

// ─── Diagnostics ──────────────────────────────────────────────
chat.pendingCount                             // queued messages
chat.getDeadLetterMessages()                  // permanently failed
chat.retryDeadLetter(id)                      // re-queue one

// ─── Events ───────────────────────────────────────────────────
chat.on('message:new', handler)
chat.on('message:updated', handler)           // optimistic → confirmed transition
chat.on('connection:connected', handler)
chat.on('connection:reconnecting', handler)
chat.on('error', handler)                     // SEND_FAILED | MESSAGE_DEAD_LETTERED
chat.on('typing:updated', handler)
chat.on('presence:updated', handler)

// ─── Lifecycle ────────────────────────────────────────────────
await chat.connect(userId?)
await chat.disconnect()
await chat.destroy()    // disconnect + remove all event listeners
```

---

## Firebase-specific setup

### Firestore collections needed

Claude Code should create these Firestore collections (or run the rules file):

| Collection | Purpose |
|-----------|---------|
| `conversations` | Conversation metadata |
| `participants` | User ↔ conversation membership |
| `messages` | All messages |
| `reactions` | Message reactions |
| `presence` | Online/away/offline status |
| `typing_indicators` | Ephemeral typing state |

### Security rules

Copy `packages/chat-adapters/firebase/firestore.rules` to your Firebase project.

### Full Firebase wiring

```typescript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { createChat } from '@somni/chat-core';
import { FirebaseAdapter, FirebaseAuth } from '@somni/adapter-firebase';

const app  = initializeApp({ /* your firebase config */ });
const db   = getFirestore(app);
const st   = getStorage(app);
const fbAuth = getAuth(app);

const adapter = new FirebaseAdapter({ firestore: db, storage: st });
const auth    = new FirebaseAuth(fbAuth);

const userId = auth.getCurrentUserId();
const chat   = createChat({ adapter, userId: userId ?? undefined, offlineQueue: true });

if (userId) await chat.connect();

// Auto-reconnect on auth changes
auth.onAuthStateChange(({ userId }) => {
  if (userId) chat.connect(userId);
  else chat.disconnect();
});
```

---

## Supabase-specific setup

### SQL migration

Run this in Supabase SQL Editor:
```bash
cat packages/chat-adapters/supabase/migrations/001_somni_chat_schema.sql
```

### Full Supabase wiring

```typescript
import { createClient } from '@supabase/supabase-js';
import { createChat } from '@somni/chat-core';
import { SupabaseAdapter, SupabaseAuth } from '@somni/adapter-supabase';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const auth     = new SupabaseAuth(supabase);
const userId   = await auth.getCurrentUserId();

const chat = createChat({
  adapter: new SupabaseAdapter({ client: supabase }),
  userId: userId ?? undefined,
  offlineQueue: true,
});

if (userId) await chat.connect();

auth.onAuthStateChange(async ({ userId }) => {
  if (userId) await chat.connect(userId);
  else await chat.disconnect();
});
```

---

## Writing a custom adapter

If the project has a custom backend:

```typescript
import type { ChatAdapter, PaginatedResult, ChatEvent, UnsubscribeFn } from '@somni/chat-core';

export class MyAdapter implements ChatAdapter {
  async connect(userId: string) { /* open WS, store userId */ }
  async disconnect() { /* close WS */ }

  async sendMessage(input) {
    const res = await fetch('/api/messages', { method: 'POST', body: JSON.stringify(input) });
    return res.json(); // must return a Message object with id, sender_id, created_at, etc.
  }

  subscribeMessages(conversationId, callback): UnsubscribeFn {
    const ws = new WebSocket(`wss://api.example.com/chat/${conversationId}`);
    ws.onmessage = (e) => callback({ type: 'message:new', payload: JSON.parse(e.data) });
    return () => ws.close();
  }

  // ... implement remaining 20 methods (see ChatAdapter interface in packages/chat-core/src/adapter/ChatAdapter.ts)
}

// Validate it before using (throws with clear error if anything is missing)
import { validateAdapter } from '@somni/chat-core';
validateAdapter(new MyAdapter());
```

---

## Notifications (server-side)

```typescript
import { NotificationEngine, FcmProvider } from '@somni/notifications';

const notifications = new NotificationEngine({
  batch: { windowMs: 2000, maxBatchSize: 50, collapseByConversation: true },
  rateLimit: { maxPerUserPerMinute: 5, maxPerUserPerHour: 60, maxPerUserPerDay: 200 },
});
notifications.registerProvider(new FcmProvider({ httpClient: myFcmClient }));

// Hook into message events
chat.on('message:new', async (e) => {
  if (!isUserOnline(e.payload.receiver_id)) {
    await notifications.send(target, payload, { conversationId: e.payload.conversation_id });
  }
});
```

---

## Analytics

```typescript
import { AnalyticsEngine, InMemoryProvider } from '@somni/analytics';

const analytics = new AnalyticsEngine({ provider: new InMemoryProvider(), snapshotIntervalMs: 60_000 });

chat.on('message:new', (e) => analytics.track({ type: 'message:sent', userId: e.payload.sender_id, conversationId: e.payload.conversation_id }));
chat.on('message:updated', (e) => { if (e.payload.status === 'delivered') analytics.track({ type: 'message:delivered', userId: e.payload.sender_id }); });

const dau = analytics.getDAU();      // { activeUsers: N, date: '2025-...' }
const rt  = analytics.getResponseTime();  // { p50, p95, p99, mean }
```

---

## Tests

```bash
npm test          # 252 tests, no install needed (Node 22+)
npm --workspace @somni/chat-core test         # 91 core tests
npm --workspace @somni/adapter-supabase test  # 25 adapter tests
```

---

## Common mistakes to avoid

1. **Never call `subscribeMessages` before `connect()`** — the adapter channel won't be open.
2. **Don't build your own dedup** — the engine already handles exactly-once delivery. Just use `subscribeMessages`.
3. **Don't read `message:new` AND poll `listMessages` for the same conversation** — you'll get duplicates. Use `subscribeMessages` for realtime, `listMessages` only for initial history load.
4. **Always call `disconnect()` / `destroy()` on cleanup** — particularly in React `useEffect` returns and Next.js route change handlers.
5. **For Firebase**: the `subscribeMessages` adapter skips the initial Firestore snapshot to avoid replaying history as `message:new` events. Load history with `listMessages()` instead.
6. **Typing in multiple conversations**: `notifyTyping(convId)` is per-conversation — call it with the correct `conversationId` each time.
