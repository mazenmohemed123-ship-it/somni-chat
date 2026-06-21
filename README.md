# Somni Chat Engine

> بنية تحتية شاملة للمراسلة الفورية — مثل WhatsApp / Discord / Slack / Intercom — لكنها مكتبة npm قابلة لإعادة الاستخدام في أي مشروع.

**v1.0.0 — Production Hardened** · شات + مكالمات + إشعارات + تحليلات · **215 اختبار يمر** · exactly-once · offline-first · plugins

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
npm test     # 215 passing (54 core + 44 call + 44 notifications + 48 analytics + 25 supabase)
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
  chat-notifications/     ← 🔔 إشعارات Push (FCM / APNs / Web Push + تجميع ذكي)
  chat-analytics/         ← 📊 تحليلات فورية (DAU، معدلات التسليم، زمن الاستجابة)
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

# إشعارات Push
npm install @somni/notifications

# تحليلات
npm install @somni/analytics
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
        onChange={() => notifyTyping()}
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

### 🔐 Supabase + Auth integration

الـ `SupabaseAdapter` يتكامل مع Supabase Auth مباشرة — يتحقق من الجلسة عند الاتصال،
ويقرأ الـ userId من الجلسة الحالية، ويعيد الاتصال تلقائياً عند تسجيل الدخول/الخروج:

```typescript
import { createChat } from '@somni/chat-core';
import { SupabaseAdapter, SupabaseAuth } from '@somni/adapter-supabase';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const auth = new SupabaseAuth(supabase);

const userId = await auth.getCurrentUserId();   // من جلسة Supabase
const chat = createChat({ adapter: new SupabaseAdapter({ client: supabase }), userId });
await chat.connect();   // يتحقق أن الجلسة مطابقة (requireAuth افتراضياً true)

// أعد الاتصال تلقائياً عند تغيّر الجلسة
auth.onAuthStateChange(async ({ userId }) => {
  if (userId) await chat.connect(userId);
  else await chat.disconnect();
});
```

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

## 🔔 الإشعارات — `@somni/notifications`

إشعارات Push متكاملة عبر FCM (أندرويد) و APNs (iOS) و Web Push (متصفح) مع **تجميع ذكي** و **Rate Limiting** لحماية المستخدمين من الإزعاج.

### المميزات
- **تجميع ذكي (Smart Batching)**: دمج الإشعارات المتعددة من نفس المحادثة في إشعار واحد خلال نافذة زمنية قابلة للضبط
- **Rate Limiting**: حد أقصى لكل مستخدم (per-minute / per-hour / per-day) مع أحداث مخصصة عند التجاوز
- **كشف التوكن المنتهي**: يصدر حدث `token:invalid` تلقائياً عند رفض FCM/APNs/Web Push للتوكن
- **Provider-agnostic**: تحقّق واجهة `NotificationProvider` الخاصة بك لأي خدمة

```typescript
import { NotificationEngine, FcmProvider } from '@somni/notifications';

// أنشئ المحرك
const notifications = new NotificationEngine({
  batch: { windowMs: 500, maxBatchSize: 100, collapseByConversation: true },
  rateLimit: { maxPerUserPerMinute: 10, maxPerUserPerHour: 120, maxPerUserPerDay: 500 },
});

// سجّل مزوّد FCM (ينقل استدعاءات HTTP الفعلية)
notifications.registerProvider(new FcmProvider({ httpClient: myFcmClient }));

// استمع للأحداث
notifications.on('notification:sent', (e) => console.log('أُرسل:', e.envelope.id));
notifications.on('rate-limit:exceeded', (e) => console.warn('حد المستخدم:', e.userId, e.window));
notifications.on('token:invalid', (e) => removeTokenFromDB(e.userId, e.token));

// أرسل إشعاراً (يدخل قائمة التجميع)
await notifications.send(
  { userId: 'alice', token: 'FCM_TOKEN', channel: 'fcm' },
  { title: 'رسالة جديدة', body: 'أرسل لك Bob رسالة', data: { conversationId: 'c1' } },
  { conversationId: 'c1', senderId: 'bob' }
);

// إرسال فوري بدون تجميع (مثلاً: إشعارات النظام)
const result = await notifications.sendImmediate(target, payload);

// تفريغ الطابور يدوياً
notifications.flush();
```

### تجميع الإشعارات
```typescript
// 10 رسائل في conv-123 → إشعار واحد "10 رسائل جديدة"
for (let i = 0; i < 10; i++) {
  await notifications.send(target, { title: 'رسالة جديدة', body: `رسالة ${i}` }, { conversationId: 'conv-123' });
}
// الإشعار الأخير يحمل: payload.data.collapsed = "9"
```

### دعم FCM / APNs / Web Push

```typescript
// FCM (أندرويد / كروم)
import { FcmProvider } from '@somni/notifications';
notifications.registerProvider(new FcmProvider({ httpClient: myFcmV1Client }));

// APNs (iOS)
import { ApnsProvider } from '@somni/notifications';
notifications.registerProvider(new ApnsProvider({ httpClient: myApnsClient, bundleId: 'com.myapp' }));

// Web Push (متصفح)
import { WebPushProvider } from '@somni/notifications';
notifications.registerProvider(new WebPushProvider({
  client: webpushLib, // أي مكتبة web-push
  parseSubscription: (token) => JSON.parse(token),
}));
```

---

## 📊 التحليلات — `@somni/analytics`

تحليلات فورية لقياس صحة نظام الشات بدون أي قاعدة بيانات خارجية (provider-agnostic).

### المميزات
- **DAU (Daily Active Users)**: تتبع المستخدمين الفريدين يومياً بدقة
- **معدلات التسليم**: نسبة الرسائل المُرسَلة → المُسلَّمة → المقروءة
- **زمن الاستجابة**: p50 / p95 / p99 / mean / min / max من sent إلى delivered
- **إحصائيات المحادثات**: عدد الرسائل، آخر نشاط، المشاركون الفاعلون
- **Snapshots دورية**: إرسال لقطة شاملة كل X ثانية
- **InMemoryProvider**: تخزين افتراضي بدون إعداد (مثالي للاختبار والتطبيقات الصغيرة)

```typescript
import { AnalyticsEngine, InMemoryProvider } from '@somni/analytics';

const analytics = new AnalyticsEngine({
  provider: new InMemoryProvider(),  // أو أي AnalyticsProvider مخصص
  snapshotIntervalMs: 60_000,         // لقطة كل دقيقة
});

// تسجيل الأحداث
analytics.track({ type: 'user:active', userId: 'alice' });
analytics.track({ type: 'message:sent', userId: 'alice', conversationId: 'c1', metadata: { messageId: 'msg-1' } });
analytics.track({ type: 'message:delivered', userId: 'bob', conversationId: 'c1', metadata: { messageId: 'msg-1' } });
analytics.track({ type: 'message:read', userId: 'bob' });

// قراءة المقاييس
const dau = analytics.getDAU();
console.log(`المستخدمون النشطون اليوم: ${dau.activeUsers}`);

const rates = analytics.getDeliveryRates('hour');
console.log(`معدل التسليم: ${(rates.deliveryRate * 100).toFixed(1)}%`);
console.log(`معدل القراءة: ${(rates.readRate * 100).toFixed(1)}%`);

const rt = analytics.getResponseTime();
console.log(`زمن الاستجابة p50: ${rt.p50}ms | p95: ${rt.p95}ms | p99: ${rt.p99}ms`);

// لقطة شاملة
const snap = analytics.snapshot();
// { dau, totalMessages, deliveryRate, avgResponseTimeMs, activeConversations, errorCount }

// الاشتراك في اللقطات الدورية
analytics.on('snapshot:ready', (e) => {
  saveToMonitoring(e.snapshot);
});

analytics.destroy(); // ينظّف التايمرات
```

### ربط التحليلات بالمحرك الأساسي

```typescript
// سجّل كل حدث في المحرك مباشرة
chat.on('message:new', (e) => {
  analytics.track({ type: 'message:sent', userId: e.payload.sender_id, conversationId: e.payload.conversation_id });
});

chat.on('message:updated', (e) => {
  if (e.payload.status === 'delivered') {
    analytics.track({ type: 'message:delivered', userId: e.payload.sender_id });
  }
});

chat.on('connection:connected', () => {
  analytics.track({ type: 'user:session:start', userId: currentUserId });
});
```

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
useCall(engine)      // state, localStream, remoteTracks, start, accept, hangup, toggleMic, toggleCamera
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

## الميزات المدعومة

| الميزة | الحالة |
|--------|--------|
| Optimistic Updates | ✅ |
| Client ID Deduplication | ✅ |
| Offline Queue (FIFO + backoff + dead-letter) | ✅ |
| Auto Reconnect (Exponential Backoff + jitter) | ✅ |
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
| 🔔 FCM / APNs / Web Push | ✅ |
| 🔔 تجميع الإشعارات الذكي | ✅ |
| 🔔 Rate Limiting للإشعارات | ✅ |
| 📊 DAU tracking | ✅ |
| 📊 معدلات التسليم والقراءة | ✅ |
| 📊 p50/p95/p99 زمن الاستجابة | ✅ |
| 📊 Snapshots دورية | ✅ |
| 🔐 Supabase Auth integration | ✅ |
| 🎟️ LiveKit token server helper | ✅ |
| **215 اختبار آلي** | ✅ |

---

## الـ Plugin System

```typescript
const chat = createChat({
  adapter,
  plugins: [
    {
      name: 'profanity-filter',
      async onBeforeSend(input) {
        if (containsBadWords(input.content)) return false; // حجب الرسالة
        return { ...input, content: clean(input.content) }; // تعديل
      },
    },
    {
      name: 'ai-assistant',
      async onMessageReceive(message) {
        if (message.content.startsWith('/ask ')) {
          const reply = await askAI(message.content.slice(5));
          return [message, { ...message, id: generateId(), content: reply, sender_id: 'ai-bot' }];
        }
        return message;
      },
    },
  ],
});
```

---

## الـ Supabase Migration

```bash
# قم بنسخ محتوى هذا الملف في Supabase SQL Editor
packages/chat-adapters/supabase/migrations/001_somni_chat_schema.sql
```

---

## التوسعات المستقبلية (خارطة طريق أقوى)

**تم إنجازها في v1.0:** ✅ مكالمات صوت/فيديو · ✅ FCM/APNs/Web Push · ✅ DAU + delivery analytics · ✅ نظام Plugins · ✅ AI agents

**القادم:**
- 🌐 **E2E Encryption** — تشفير طرف-لطرف للرسائل والمكالمات (MLS / Signal protocol integration)
- 📹 **تسجيل المكالمات والبث المباشر** — live streaming / RTMP egress عبر LiveKit Cloud
- 🧠 **AI مدمج** — ترجمة فورية، تلخيص محادثات، نسخ صوتي (transcription)، إشراف تلقائي (moderation)
- 🗄️ **`@somni/adapter-postgres`** — PostgreSQL + Drizzle ORM بدون Supabase overhead
- 🗄️ **adapters لـ MongoDB / Redis Streams / NATS** — لتغطية كل stack ممكن
- 🔄 **CRDT sync** — تحرير تعاوني وتاريخ رسائل غير متصل بدون تعارض (Yjs integration)
- 🌍 **Edge-first** — تشغيل على Cloudflare Workers / Durable Objects للزمن المنخفض عالمياً
- 🧩 **Plugin Marketplace** — نظام إضافات قابل للنشر والمشاركة على npm
- 📱 **React Native / Expo** — حزمة `@somni/chat-native` مع دعم كامل للإشعارات المحلية والمكالمات عبر Callkit/ConnectionService

كل هذا **بدون تغيير Core API**.

---

## المتطلبات

- Node.js >= 22 (لتشغيل الاختبارات بدون تثبيت)
- pnpm >= 8
- TypeScript >= 5.4

```bash
pnpm install
pnpm build
npm test          # 215 اختبار (54 + 44 + 44 + 48 + 25)
```

> 📦 **للنشر على npm:** راجع [docs/publishing.md](./docs/publishing.md) — دليل خطوة بخطوة للنشر اليدوي.
