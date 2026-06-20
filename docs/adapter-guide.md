# Writing a Custom Adapter

An adapter is the **only** thing that knows about your backend. Implement the
`ChatAdapter` interface and the entire engine, React layer, and UI work
unchanged.

```ts
import type {
  ChatAdapter, UnsubscribeFn, ChatEvent,
  Message, SendMessageInput, UploadAttachmentInput, UploadAttachmentResult,
} from '@somni/chat';

export class MyAdapter implements ChatAdapter {
  // ─── Lifecycle ───────────────────────────────────────────
  async connect(userId: string) { /* open socket / auth */ }
  async disconnect() { /* close everything */ }

  // ─── Messages (the core 5) ───────────────────────────────
  async sendMessage(input: SendMessageInput): Promise<Message> {
    // MUST persist input.client_id and return it on the row — this is what
    // powers deduplication + optimistic reconciliation.
  }
  subscribeMessages(conversationId: string, cb: (e: ChatEvent) => void): UnsubscribeFn {
    // Emit { type: 'message:new' | 'message:updated' | 'message:deleted', ... }
    return () => { /* teardown */ };
  }
  subscribePresence(userIds, cb): UnsubscribeFn { /* … */ return () => {}; }
  subscribeTyping(conversationId, cb): UnsubscribeFn { /* … */ return () => {}; }
  async markAsRead(conversationId, userId, messageId) { /* … */ }

  async uploadAttachment(i: UploadAttachmentInput): Promise<UploadAttachmentResult> {
    // upload bytes to your storage, return a public URL + metadata
  }

  // …plus conversations, participants, reactions, presence, typing.
}
```

## Rules every adapter must follow

1. **Echo `client_id`.** `sendMessage` must store and return the `client_id`.
   Realtime `message:new` events must include it too. The engine relies on it
   for exactly-once delivery.
2. **Subscriptions return an unsubscribe function** that fully tears down the
   underlying channel. No teardown = leak.
3. **Soft delete only.** `deleteMessage` sets `deleted_at`; never hard-delete.
4. **Never trust the client for authorization.** Enforce access in the backend
   (RLS / rules / server checks). The engine sanitizes payloads but cannot
   enforce who may read a conversation — that is the adapter/back-end's job.

## Verifying compliance

```ts
import { validateAdapter, isAdapterCompliant } from '@somni/chat';

validateAdapter(new MyAdapter());       // throws AdapterComplianceError if incomplete
isAdapterCompliant(new MyAdapter());    // boolean, for health checks
```

`createChat()` runs `validateAdapter` automatically unless you pass
`skipAdapterValidation: true`.

## Testing your adapter

Reuse the engine's behaviour tests against your adapter by swapping it into the
integration suite, or drive it directly:

```ts
const chat = createChat({ adapter: new MyAdapter(), userId: 'u1' });
await chat.connect();
const list: AnyMessage[] = [];
chat.subscribeMessages('c1', e => { /* assert no duplicates */ });
await chat.sendMessage({ conversation_id: 'c1', content: 'hi' });
```
