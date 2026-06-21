# Somni Chat Engine

> بنية تحتية شاملة للمراسلة الفورية — مثل WhatsApp / Discord / Slack / Intercom — لكنها مكتبة npm قابلة لإعادة الاستخدام في أي مشروع.

**v1.0.0 — Production Hardened** · **شات + مكالمات صوت/فيديو** · 84 اختبار يمر · exactly-once · offline-first · plugins

### 📚 التوثيق
- [Quick Start (5 أسطر)](./docs/quickstart.md)
- [API Reference الكامل](./docs/api-reference.md)
- [🎙️ المكالمات الصوتية والفيديو](./docs/calls.md)
- [دليل كتابة Adapter](./docs/adapter-guide.md)
- [أمثلة واقعية (marketplace / support / group / AI)](./docs/examples.md)
- [✅ كيف تتأكد أن كل شيء شغّال](./docs/verification.md)
- [Production Checklist + تقرير جاهزية npm](./docs/production-checklist.md)

```bash
# تشغيل كل الاختبارات (لا تحتاج أي تثبيت — Node 22+)
npm test     # 84 passing (54 chat-core + 30 chat-call)
```

---

## المبدأ الأساسي

**المحرك لا يعتمد على أي إطار عمل أو قاعدة بيانات.**

يمكن تبديل Supabase بـ Appwrite بـ Firebase بـ PostgreSQL بدون تغيير سطر واحد من منطق التطبيق.

---

## هيكل المشروع

```
packages/
  chat/                   ← الحزمة الموحّدة @somni/chat (re-exports)
  chat-core/              ← المحرك الأساسي (TypeScript خالص)
  chat-call/              ← 🎙️ المكالمات الصوتية والفيديو (WebRTC + LiveKit/Daily)
  chat-react/             ← React Hooks (شات + مكالمات)
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
| 🎙️ مكالمات صوتية (WebRTC) | ✅ |
| 🎥 مكالمات فيديو (WebRTC) | ✅ |
| مكالمات جماعية SFU (LiveKit / Daily) | ✅ |
| كتم/كاميرا/مشاركة شاشة | ✅ |
| Signaling عبر أي backend | ✅ |
| 84 اختبار آلي | ✅ |

---

## 🎙️ المكالمات الصوتية والفيديو — `@somni/chat-call`

موديول منفصل ومستقل، يعيد استخدام نفس المعمارية: محرك `CallEngine` رفيع +
**providers قابلة للتبديل**. لا نعيد اختراع WebRTC — نستخدم مكتبات مثبتة:

| الاحتياج | من ينفّذه |
|----------|-----------|
| حالة المكالمة + التوجيه + المشاركون | `CallEngine` |
| ميديا P2P (1:1) | **WebRTC الأصلي** عبر `WebRTCCallProvider` |
| مكالمات جماعية + TURN + توسّع | **LiveKit** / **Daily** عبر wrappers جاهزة |
| نقل الـ signaling | الـ realtime الموجود عندك (Supabase/Appwrite/WS) |

```ts
import { CallEngine, WebRTCCallProvider, TransportSignaling } from '@somni/chat-call';

const call = new CallEngine({
  selfId: userId,
  signaling: new TransportSignaling(myTransport, conversationId),
  provider: new WebRTCCallProvider(),
});

await call.start(conversationId, 'video', { peers: [otherUserId] });
call.on('call:incoming', () => call.accept());
```

التفاصيل الكاملة في [docs/calls.md](./docs/calls.md).

---

## التوسعات المستقبلية (خارطة طريق أقوى)

**تم إنجازها في v1.0:** ✅ مكالمات صوت/فيديو · ✅ نظام Plugins · ✅ AI agents (عبر hooks)

**القادم:**
- 🌐 **E2E Encryption** — تشفير طرف-لطرف للرسائل والمكالمات (MLS / Signal protocol)
- 📹 **تسجيل المكالمات والبث المباشر** (live streaming / RTMP egress)
- 🧠 **AI مدمج**: ترجمة فورية، تلخيص محادثات، نسخ صوتي (transcription)، إشراف تلقائي (moderation)
- 📨 **`@somni/notifications`** — إشعارات Push عبر FCM / APNs / Web Push مع تجميع ذكي
- 📊 **`@somni/analytics`** — تحليلات فورية (DAU، زمن الاستجابة، معدلات التسليم)
- 🗄️ **`@somni/adapter-postgres`** + adapters لـ MongoDB و Redis Streams و NATS
- 🔄 **CRDT sync** — تحرير تعاوني وتاريخ رسائل غير متصل بدون تعارض
- 🌍 **Edge-first** — تشغيل على Cloudflare Workers / Durable Objects للزمن المنخفض عالمياً
- 🧩 **Marketplace للـ plugins** — نظام إضافات قابل للتركيب

كل هذا **بدون تغيير Core API**.

---

## المتطلبات

- Node.js >= 22 (لتشغيل الاختبارات بدون تثبيت)
- pnpm >= 8
- TypeScript >= 5.4

```bash
pnpm install
pnpm build
npm test          # 84 اختبار
```
