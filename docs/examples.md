# Real-World Usage Examples

All examples assume:

```ts
import { createChat } from '@somni/chat';
const chat = createChat({ adapter, userId });
await chat.connect();
```

---

## 1. Marketplace chat (buyer ↔ seller about a listing)

A direct conversation scoped to a product. Listing context travels in metadata,
so the same engine powers "Message seller" on any item.

```ts
async function openListingChat(buyerId: string, sellerId: string, listingId: string) {
  const conversation = await chat.createConversation({
    type: 'direct',
    participant_ids: [buyerId, sellerId],
    metadata: { listing_id: listingId },
  });

  await chat.sendMessage({
    conversation_id: conversation.id,
    content: 'Hi! Is this still available?',
    metadata: { listing_id: listingId },
  });

  return conversation;
}
```

```tsx
function ListingChat({ conversationId }: { conversationId: string }) {
  const { messages } = useMessages({ conversationId });
  const { sendMessage } = useSendMessage();
  // optimistic send keeps the buyer's UI instant even on flaky mobile networks
  return <Thread messages={messages} onSend={(c) => sendMessage({ conversation_id: conversationId, content: c })} />;
}
```

---

## 2. Support / ticket system (customer ↔ agents)

`type: 'support'` with an internal status in metadata, and an SLA plugin that
auto-tags slow first responses.

```ts
const ticket = await chat.createConversation({
  type: 'support',
  title: `Ticket #${ticketNumber}`,
  participant_ids: [customerId, agentId],
  metadata: { status: 'open', priority: 'high' },
});

// Agent resolves:
await chat.updateConversation(ticket.id, { metadata: { status: 'resolved' } });
await chat.sendMessage({ conversation_id: ticket.id, type: 'system', content: 'Ticket resolved ✅' });
```

```ts
// Plugin: stamp every inbound customer message with a received timestamp for SLA.
const slaPlugin: ChatPlugin = {
  name: 'sla',
  onMessageReceive: (msg) => ({ ...msg, metadata: { ...msg.metadata, received_at: Date.now() } }),
};
```

---

## 3. Group chat (teams / communities)

`type: 'group'` with unlimited participants, typing indicators, and presence.

```ts
const room = await chat.createConversation({
  type: 'group',
  title: 'Engineering',
  participant_ids: memberIds, // any number
});

await chat.addParticipant(room.id, { user_id: newHireId, role: 'member' });
```

```tsx
function GroupRoom({ conversationId, memberIds }: Props) {
  const { messages } = useMessages({ conversationId });
  const { typingUserIds, notifyTyping } = useTyping(conversationId);
  const { isOnline } = usePresence(memberIds);

  return (
    <>
      <MemberBar members={memberIds} isOnline={isOnline} />
      <MessageList conversationId={conversationId} typingUserIds={typingUserIds} />
      <Composer onType={notifyTyping} />
    </>
  );
}
```

---

## 4. AI chat agent

`type: 'ai'`. The user's message is sent normally; an `onAfterSend` plugin calls
your LLM and streams the reply back as a message of `type: 'ai'`. The core API
does not change.

```ts
const aiAgent: ChatPlugin = {
  name: 'ai-agent',
  onAfterSend: async (msg, ctx) => {
    if (msg.sender_id !== ctx.userId) return;       // only respond to the human
    const reply = await llm.complete(msg.content);  // your model call
    await chat.sendMessage({
      conversation_id: msg.conversation_id,
      type: 'ai',
      content: reply,
      metadata: { model: 'claude', in_reply_to: msg.id },
    });
  },
};

const chat = createChat({ adapter, userId, plugins: [aiAgent] });

const thread = await chat.createConversation({ type: 'ai', title: 'Assistant', participant_ids: [userId, 'agent-bot'] });
await chat.sendMessage({ conversation_id: thread.id, content: 'Summarize my unread messages' });
// → the assistant's answer arrives as a normal realtime message
```

### Moderation + AI together

Because plugins compose, you can stack moderation before the agent:

```ts
createChat({ adapter, userId, plugins: [moderationPlugin, aiAgent] });
// moderationPlugin.onBeforeSend can return `false` to block, before anything is sent
```
