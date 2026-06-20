# API Reference — `@somni/chat`

## `createChat(config): ChatEngine`

```ts
const chat = createChat({
  adapter,                       // required — any ChatAdapter
  userId,                        // optional here; can pass to connect()
  typingTimeoutMs: 3000,
  presenceIntervalMs: 30_000,
  messagePageSize: 50,
  offlineQueue: true,            // or { enabled: true, maxRetries: 8 }
  reconnect: { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 30_000, jitter: 0.3 },
  validation: { maxContentLength: 8000 },
  skipAdapterValidation: false,  // runtime adapter compliance check (keep on)
  plugins: [],
});
```

The constructor runs a **runtime adapter-compliance check** and throws
`AdapterComplianceError` listing any missing methods — so a malformed custom
adapter fails fast at `createChat()` rather than deep inside a realtime callback.

---

## Lifecycle

| Method | Description |
|--------|-------------|
| `connect(userId?)` | Opens adapter connection + presence heartbeat. Drains the offline queue. Idempotent. |
| `disconnect()` | Stops presence/typing, tears down all subscriptions, clears dedup + drain timers. |
| `destroy()` | `disconnect()` **and** removes every event listener. Use on full unmount. |
| `state` | `'idle' \| 'connecting' \| 'connected' \| 'disconnected' \| 'reconnecting'` |

Reconnection uses **capped exponential backoff with jitter** and is
**single-flight** (no reconnect storms).

---

## Messages

| Method | Description |
|--------|-------------|
| `sendMessage({ conversation_id, content, type?, reply_to_id?, attachments?, metadata? })` | Validates + sanitizes, runs `onBeforeSend` plugins, emits an **optimistic** message, persists, then **reconciles** the server echo. Returns `AnyMessage`. |
| `editMessage({ message_id, content })` | Edits; sets `edited_at`. |
| `deleteMessage(messageId)` | **Soft delete** (`deleted_at`). |
| `listMessages(conversationId, opts?)` | **Cursor-based** pagination. `opts: { limit, cursor, before, after, include_deleted }`. |
| `subscribeMessages(conversationId, cb)` | Realtime. **Fan-out**: many subscribers share one channel; deduped + reconciled. Returns `unsubscribe`. |
| `subscribe(conversationId, cb)` | Convenience: messages **+** typing in one subscription. |

### Idempotency model

Every message carries a client-generated `client_id` (UUID). The engine tracks
it **before** the optimistic emit, so the backend's realtime echo is recognised
as a **reconciliation** (`message:updated`) rather than a second `message:new`.
A `serverId`/`client_id` cache also drops hard duplicates under load. Result:
**exactly-once** rendering even when the same row is delivered multiple times.

---

## Read receipts, reactions, attachments

```ts
await chat.markAsRead(conversationId, messageId);
await chat.addReaction(messageId, '🔥');
await chat.removeReaction(messageId, '🔥');
const file = await chat.uploadAttachment({ file, file_name, mime_type });
await chat.sendMessage({ conversation_id, content: '', attachments: [file] });
```

---

## Presence & typing

```ts
await chat.setPresenceStatus('online' | 'away' | 'busy' | 'offline');
const list = await chat.fetchPresence([userId1, userId2]);
const offP = chat.subscribePresence([userId1, userId2]);

await chat.notifyTyping(conversationId);  // call on keystroke (throttled)
await chat.stopTyping(conversationId);
const offT = chat.subscribeTyping(conversationId);
chat.getTypingUsers(conversationId);      // string[]
```

Presence heartbeat, visibility-based away status, and typing auto-timeout are
managed and cleaned up automatically.

---

## Conversations & participants

```ts
await chat.createConversation({ type: 'group', title, participant_ids });
await chat.listConversations({ limit: 30, cursor });   // lazy / cursor paginated
await chat.updateConversation(id, { title });
await chat.addParticipant(convId, { user_id, role: 'member' });
await chat.removeParticipant(convId, userId);
chat.subscribeConversations(onEvent);
```

---

## Events

```ts
chat.on('message:new', e => …);
chat.on('message:updated', e => …);
chat.on('message:deleted', e => …);
chat.on('presence:updated', e => …);
chat.on('typing:updated', e => …);
chat.on('connection:connected', () => …);
chat.on('connection:reconnecting', e => e.payload.attempt);
chat.on('connection:disconnected', e => e.payload.reason);
chat.on('error', e => e.payload.code);  // e.g. 'SEND_FAILED', 'MESSAGE_DEAD_LETTERED'
```

All events are a fully-typed discriminated union (`ChatEvent`).

---

## Offline diagnostics

```ts
chat.pendingCount;                 // queued, not-yet-sent messages
chat.getDeadLetterMessages();      // permanently failed (exceeded maxRetries)
chat.retryDeadLetter(id);          // requeue a dead-lettered message
```

---

## Plugins

```ts
const moderation: ChatPlugin = {
  name: 'moderation',
  onBeforeSend: (input) => (isSpam(input.content) ? false : input), // false = block
  onAfterSend:  (msg) => analytics.track('sent', msg.id),
  onMessageReceive: (msg) => ({ ...msg, content: translate(msg.content) }),
  onPresenceChange: (p) => {},
  onTyping: (t) => {},
};
createChat({ adapter, plugins: [moderation] });
```

Hooks run in registration order, are awaited when async, and a throwing plugin
is isolated — it never breaks the pipeline.
