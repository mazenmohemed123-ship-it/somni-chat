# Quick Start — 5 lines

```ts
import { createChat } from '@somni/chat';
import { SupabaseAdapter } from '@somni/chat/adapters/supabase';

const chat = createChat({ adapter: new SupabaseAdapter({ client: supabase }) });
await chat.connect(userId);
await chat.sendMessage({ conversation_id, content: 'Hello 👋' });
```

That's it. Realtime delivery, optimistic UI, deduplication, offline queue, and
auto-reconnect are all on by default.

---

## With React (also 5 lines)

```tsx
import { ChatProvider } from '@somni/chat/react';
import { Chat } from '@somni/chat-ui';
import '@somni/chat-ui/styles';

<ChatProvider engine={chat}><Chat /></ChatProvider>;
```

---

## The whole public surface you need to remember

```ts
await chat.connect(userId)              // open the connection
chat.sendMessage({ conversation_id, content })
const off = chat.subscribe(convId, onEvent)   // messages + typing in one
await chat.markAsRead(convId, messageId)
await chat.disconnect()                  // clean teardown
```

Everything else (reactions, presence, typing, attachments, pagination,
plugins) is optional and discoverable from the same `chat` object.
