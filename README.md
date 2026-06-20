# Somni Chat Engine

> بنية تحتية شاملة للمراسلة الفورية — مثل WhatsApp / Discord / Slack / Intercom — لكنها مكتبة npm قابلة لإعادة الاستخدام في أي مشروع.

---

## المبدأ الأساسي

**المحرك لا يعتمد على أي إطار عمل أو قاعدة بيانات.**

يمكن تبديل Supabase بـ Appwrite بـ Firebase بـ PostgreSQL بدون تغيير سطر واحد من منطق التطبيق.

---

## هيكل المشروع

```
packages/
  chat-core/              ← المحرك الأساسي (TypeScript خالص)
  chat-react/             ← React Hooks
  chat-ui/                ← مكونات UI جاهزة
  chat-adapters/
    supabase/             ← Supabase Adapter
    appwrite/             ← Appwrite Adapter
    firebase/             ← Firebase Adapter
examples/
  nextjs-appwrite/        ← مثال كامل Next.js 14 + Appwrite
```

---

## التثبيت

```bash
# Core فقط (بدون React)
npm install @somni/chat-core @somni/adapter-appwrite

# مع React
npm install @somni/chat-core @somni/chat-react @somni/adapter-appwrite

# مع UI جاهز
npm install @somni/chat-core @somni/chat-react @somni/chat-ui @somni/adapter-appwrite
```

---

## الاستخدام السريع

### 1. إنشاء المحرك

```typescript
import { createChat } from '@somni/chat-core';
import { AppwriteAdapter } from '@somni/adapter-appwrite';
import { Client, Databases, Realtime } from 'appwrite';

const client = new Client()
  .setEndpoint('https://cloud.appwrite.io/v1')
  .setProject('YOUR_PROJECT_ID');

const chat = createChat({
  adapter: new AppwriteAdapter({
    client,
    databases: new Databases(client),
    realtime: new Realtime(client),
    databaseId: 'YOUR_DATABASE_ID',
    collections: {
      conversations: 'conversations',
      participants: 'participants',
      messages: 'messages',
      attachments: 'attachments',
      reactions: 'reactions',
      presence: 'presence',
    },
  }),
  userId: 'current-user-id',
  offlineQueue: true,
  typingTimeoutMs: 3000,
});

// اتصل بالمحرك
await chat.connect();
```

### 2. إرسال رسالة (مع Optimistic Update)

```typescript
// الرسالة تظهر فوراً في الواجهة قبل تأكيد السيرفر
const message = await chat.sendMessage({
  conversation_id: 'conv-123',
  content: 'مرحباً بالعالم!',
});
```

### 3. الاشتراك في الرسائل

```typescript
const unsubscribe = chat.subscribeMessages('conv-123', (event) => {
  if (event.type === 'message:new') {
    console.log('رسالة جديدة:', event.payload.content);
  }
});

// إلغاء الاشتراك عند التنظيف
unsubscribe();
```

### 4. مع React

```tsx
import { ChatProvider, useMessages, useSendMessage, useTyping } from '@somni/chat-react';

function App() {
  const engine = useMemo(() => createChat({ adapter, userId }), []);

  return (
    <ChatProvider engine={engine} autoConnect>
      <ChatRoom conversationId="conv-123" />
    </ChatProvider>
  );
}

function ChatRoom({ conversationId }: { conversationId: string }) {
  const { messages, isLoading } = useMessages({ conversationId });
  const { sendMessage, isSending } = useSendMessage();
  const { typingUserIds, notifyTyping } = useTyping(conversationId);

  return (
    <div>
      {messages.map((m) => <div key={m.id}>{m.content}</div>)}
      {typingUserIds.length > 0 && <p>{typingUserIds.join(', ')} يكتب...</p>}
      <input
        onChange={(e) => notifyTyping()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            sendMessage({ conversation_id: conversationId, content: e.currentTarget.value });
          }
        }}
      />
    </div>
  );
}
```

### 5. واجهة كاملة بسطر واحد

```tsx
import { ChatProvider } from '@somni/chat-react';
import { Chat } from '@somni/chat-ui';
import '@somni/chat-ui/styles';

function App() {
  const engine = useMemo(() => createChat({ adapter, userId }), []);

  return (
    <ChatProvider engine={engine}>
      <Chat style={{ height: '100vh' }} />
    </ChatProvider>
  );
}
```

---

## أنواع المحادثات

| النوع | الوصف |
|-------|-------|
| `direct` | محادثة 1:1 |
| `group` | مجموعة بعدد غير محدود |
| `channel` | بث (broadcast) للقراءة فقط |
| `support` | دعم فني (ticket-style) |
| `ai` | محادثة مع وكيل ذكاء اصطناعي |

---

## الـ Adapters المتاحة

| Adapter | الحزمة |
|---------|--------|
| Supabase | `@somni/adapter-supabase` |
| Appwrite | `@somni/adapter-appwrite` |
| Firebase | `@somni/adapter-firebase` |

### كتابة Adapter مخصص

```typescript
import type { ChatAdapter } from '@somni/chat-core';

class MyCustomAdapter implements ChatAdapter {
  async connect(userId: string) { /* ... */ }
  async sendMessage(input) { /* ... */ }
  subscribeMessages(conversationId, callback) { /* ... */; return unsubscribe; }
  // ... باقي الميثودز
}

const chat = createChat({
  adapter: new MyCustomAdapter(),
  userId: 'user-123',
});
```

---

## API المحرك الكامل

```typescript
// Conversations
chat.createConversation({ type, title, participant_ids })
chat.listConversations({ limit, cursor })
chat.updateConversation(id, { title })
chat.subscribeConversations(callback)

// Messages
chat.sendMessage({ conversation_id, content, reply_to_id })
chat.editMessage({ message_id, content })
chat.deleteMessage(messageId)
chat.listMessages(conversationId, { limit, cursor })
chat.subscribeMessages(conversationId, callback)
chat.markAsRead(conversationId, messageId)

// Reactions
chat.addReaction(messageId, emoji)
chat.removeReaction(messageId, emoji)

// Presence
chat.setPresenceStatus('online' | 'away' | 'busy' | 'offline')
chat.fetchPresence(userIds)
chat.subscribePresence(userIds)

// Typing
chat.notifyTyping(conversationId)
chat.stopTyping(conversationId)
chat.subscribeTyping(conversationId)
chat.getTypingUsers(conversationId)

// Events
chat.on('message:new', handler)
chat.on('message:updated', handler)
chat.on('presence:updated', handler)
chat.on('typing:updated', handler)
chat.on('connection:connected', handler)
chat.on('connection:disconnected', handler)

// Lifecycle
await chat.connect()
await chat.disconnect()
```

---

## React Hooks

```typescript
useChatEngine()      // engine, isConnected, userId
useMessages()        // messages, isLoading, hasMore, loadMore
useConversations()   // conversations, isLoading, hasMore, loadMore
useTyping()          // typingUserIds, notifyTyping, stopTyping
usePresence()        // presence Map, isOnline(userId)
useSendMessage()     // sendMessage, isSending, error
```

---

## UI Components

```tsx
<Chat />                 // واجهة كاملة
<ConversationList />     // قائمة المحادثات
<MessageList />          // قائمة الرسائل
<MessageItem />          // رسالة واحدة
<MessageInput />         // صندوق الكتابة
<TypingIndicator />      // مؤشر الكتابة
<OnlineIndicator />      // حالة الاتصال
```

---

## Supabase — تشغيل الـ Migration

```bash
# قم بنسخ محتوى هذا الملف في Supabase SQL Editor
packages/chat-adapters/supabase/migrations/001_somni_chat_schema.sql
```

---

## الميزات المدعومة

| الميزة | الحالة |
|--------|--------|
| Optimistic Updates | ✅ |
| Client ID Deduplication | ✅ |
| Offline Queue | ✅ |
| Auto Reconnect (Exponential Backoff) | ✅ |
| Typing Indicators | ✅ |
| Presence (Online/Away/Offline) | ✅ |
| Read Receipts | ✅ |
| Reactions | ✅ |
| Thread/Reply | ✅ |
| Attachments | ✅ |
| Soft Delete | ✅ |
| Edit Messages | ✅ |
| Multi-adapter | ✅ |
| Tree-shakable | ✅ |
| TypeScript 100% | ✅ |

---

## التوسعات المستقبلية (بدون تغيير Core API)

- `@somni/plugin-voice` — مكالمات صوتية
- `@somni/plugin-video` — مكالمات فيديو
- `@somni/plugin-ai` — وكلاء ذكاء اصطناعي
- `@somni/plugin-notifications` — إشعارات Push
- `@somni/plugin-analytics` — تحليلات المحادثات
- `@somni/adapter-postgres` — PostgreSQL مباشر

---

## المتطلبات

- Node.js >= 18
- pnpm >= 8
- TypeScript >= 5.4

```bash
pnpm install
pnpm build
```
