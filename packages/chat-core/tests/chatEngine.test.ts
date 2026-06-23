/**
 * Comprehensive engine behaviour tests — covers the API surface that is not
 * exercised by the narrower unit tests (dedup, offline queue, plugins, stress).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, type AnyMessage, type ChatEvent } from '../src/index.ts';
import { MockAdapter, flush } from './mocks/MockAdapter.ts';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Connection lifecycle ──────────────────────────────────────────────────────

test('connect() is idempotent — second call returns early without re-connecting', async () => {
  const adapter = new MockAdapter();
  let connectCalls = 0;
  const orig = adapter.connect.bind(adapter);
  adapter.connect = async (...args) => { connectCalls++; return orig(...args); };

  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();
  await engine.connect(); // second call must be a no-op
  assert.equal(connectCalls, 1, 'adapter.connect must only be called once');
  assert.equal(engine.state, 'connected');
  await engine.disconnect();
});

test('engine state transitions: idle → connected → disconnected', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  assert.equal(engine.state, 'idle');

  await engine.connect();
  assert.equal(engine.state, 'connected');

  await engine.disconnect();
  assert.equal(engine.state, 'disconnected');
});

test('connect() emits connection:connected event', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });

  const events: string[] = [];
  engine.on('connection:connected', () => events.push('connected'));
  engine.on('connection:disconnected', () => events.push('disconnected'));

  await engine.connect();
  await engine.disconnect();

  assert.deepEqual(events, ['connected', 'disconnected']);
});

test('userId throws a clear error when not set at all', () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, skipAdapterValidation: true });
  assert.throws(() => engine.userId, /userId/);
});

// ─── Conversation CRUD ─────────────────────────────────────────────────────────

test('createConversation returns a conversation with generated id', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const conv = await engine.createConversation({ type: 'direct', participant_ids: ['me', 'alice'] });
  assert.ok(conv.id.startsWith('conv_'));
  assert.equal(conv.type, 'direct');
  await engine.disconnect();
});

test('getConversation returns null for unknown id', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const result = await engine.getConversation('no-such-id');
  assert.equal(result, null);
  await engine.disconnect();
});

test('listConversations returns paginated results', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const page = await engine.listConversations();
  assert.ok('items' in page && 'has_more' in page);
  await engine.disconnect();
});

test('updateConversation updates title', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const conv = await engine.createConversation({ type: 'group', participant_ids: ['me'] });
  const updated = await engine.updateConversation(conv.id, { title: 'New Title' });
  assert.equal(updated.id, conv.id);
  await engine.disconnect();
});

test('deleteConversation resolves without error', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const conv = await engine.createConversation({ type: 'direct', participant_ids: ['me', 'alice'] });
  await assert.doesNotReject(() => engine.deleteConversation(conv.id));
  await engine.disconnect();
});

// ─── Message operations ────────────────────────────────────────────────────────

test('listMessages returns all messages for a conversation', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  await engine.sendMessage({ conversation_id: 'c1', content: 'alpha' });
  await engine.sendMessage({ conversation_id: 'c1', content: 'beta' });
  await flush();

  const page = await engine.listMessages('c1');
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.content, 'alpha');
  await engine.disconnect();
});

test('markAsRead delegates to adapter', async () => {
  const adapter = new MockAdapter();
  let marked = false;
  adapter.markAsRead = async () => { marked = true; };

  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  await engine.markAsRead('c1', 'msg-1');
  assert.ok(marked, 'adapter.markAsRead must be called');
  await engine.disconnect();
});

test('addReaction and removeReaction round-trip', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const msg = await engine.sendMessage({ conversation_id: 'c1', content: 'hi' });
  const reaction = await engine.addReaction(msg.id, '❤️');
  assert.equal(reaction.emoji, '❤️');
  assert.equal(reaction.user_id, 'me');

  await assert.doesNotReject(() => engine.removeReaction(msg.id, '❤️'));
  await engine.disconnect();
});

// ─── Subscribers / fanout ─────────────────────────────────────────────────────

test('multiple subscribeMessages on the same conversation all receive events', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const received1: AnyMessage[] = [];
  const received2: AnyMessage[] = [];

  engine.subscribeMessages('c1', (e) => { if (e.type === 'message:new') received1.push(e.payload); });
  engine.subscribeMessages('c1', (e) => { if (e.type === 'message:new') received2.push(e.payload); });

  adapter.injectIncoming('c1', 'hello from other');
  await flush();

  assert.equal(received1.length, 1, 'first subscriber must receive event');
  assert.equal(received2.length, 1, 'second subscriber must also receive event');
  await engine.disconnect();
});

test('unsubscribing one of two subscribers keeps the other alive', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const received: string[] = [];
  const off1 = engine.subscribeMessages('c1', (e) => { if (e.type === 'message:new') received.push('sub1'); });
  engine.subscribeMessages('c1', (e) => { if (e.type === 'message:new') received.push('sub2'); });

  off1(); // remove first subscriber

  adapter.injectIncoming('c1', 'after first unsub');
  await flush();

  assert.equal(received.filter((s) => s === 'sub1').length, 0, 'sub1 must not receive after unsub');
  assert.equal(received.filter((s) => s === 'sub2').length, 1, 'sub2 must still receive events');
  await engine.disconnect();
});

test('subscribeConversations receives conversation events', async () => {
  const adapter = new MockAdapter();
  // Simulate a conversation:updated event from the backend
  adapter.subscribeConversations = (_userId, cb) => {
    setTimeout(() => cb({ type: 'conversation:updated', payload: {
      id: 'c1', type: 'direct', title: 'Updated', description: null, avatar_url: null,
      status: 'active', metadata: {}, created_at: '', updated_at: '', last_message_at: null,
      last_message_preview: null, created_by: 'me',
    }}), 10);
    return () => {};
  };

  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const events: string[] = [];
  engine.subscribeConversations((e) => events.push(e.type));
  await wait(50);

  assert.ok(events.includes('conversation:updated'), 'must receive conversation:updated');
  await engine.disconnect();
});

// ─── Presence ─────────────────────────────────────────────────────────────────

test('setPresenceStatus delegates to adapter', async () => {
  const adapter = new MockAdapter();
  const presenceUpdates: string[] = [];
  adapter.updatePresence = async (update) => { presenceUpdates.push(update.status); };

  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect(); // emits 'online'

  await engine.setPresenceStatus('away');
  assert.ok(presenceUpdates.includes('away'), 'away status must reach adapter');
  await engine.disconnect();
});

test('subscribePresence fires presence:updated events', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const statuses: string[] = [];
  engine.subscribePresence(['alice']);
  engine.on('presence:updated', (e) => statuses.push(e.payload.status));

  // Simulate incoming presence from adapter
  adapter.emitPresence('alice', 'online');
  await flush();

  assert.ok(statuses.includes('online'));
  await engine.disconnect();
});

// ─── Offline queue diagnostics ────────────────────────────────────────────────

test('pendingCount reflects queue size accurately', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  adapter.online = false;
  assert.equal(engine.pendingCount, 0);

  await engine.sendMessage({ conversation_id: 'c1', content: 'A' });
  await engine.sendMessage({ conversation_id: 'c1', content: 'B' });
  assert.equal(engine.pendingCount, 2);

  adapter.online = true;
  await wait(50);
  await flush();

  assert.equal(engine.pendingCount, 0, 'queue should be empty after drain');
  await engine.disconnect();
});

test('retryDeadLetter re-queues the op and drains it on success', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    offlineQueue: { enabled: true, maxRetries: 2 },
    reconnect: { baseDelayMs: 5, maxDelayMs: 10, maxAttempts: 10, jitter: 0 },
  });
  await engine.connect();

  adapter.online = false;
  await engine.sendMessage({ conversation_id: 'c1', content: 'fragile' });

  // Wait for the message to exhaust retries and land in dead-letter
  await wait(200);
  await flush();

  const dead = engine.getDeadLetterMessages();
  assert.equal(dead.length, 1, 'message must be in dead-letter');
  assert.equal(dead[0]?.payload.content, 'fragile');

  // Recover network and retry
  adapter.online = true;
  const ok = engine.retryDeadLetter(dead[0]!.id);
  assert.ok(ok, 'retryDeadLetter must return true for a known id');

  await wait(50);
  await flush();

  assert.equal(engine.getDeadLetterMessages().length, 0, 'dead-lettered op removed after successful retry');
  assert.equal(adapter.messages.filter((m) => m.content === 'fragile').length, 1, 'message delivered');
  await engine.disconnect();
});

test('getDeadLetterMessages includes error info on permanently-failed ops', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    offlineQueue: { enabled: true, maxRetries: 2 },
    reconnect: { baseDelayMs: 5, maxDelayMs: 10, maxAttempts: 10, jitter: 0 },
  });
  await engine.connect();

  adapter.online = false;
  await engine.sendMessage({ conversation_id: 'c1', content: 'gone' });
  await wait(200);

  const dead = engine.getDeadLetterMessages();
  assert.ok(dead.length >= 1);
  assert.ok(dead[0]?.last_error, 'last_error must be populated');
  await engine.disconnect();
});

// ─── Plugin hooks ──────────────────────────────────────────────────────────────

test('onAfterSend plugin runs after successful send', async () => {
  const adapter = new MockAdapter();
  const afterSent: string[] = [];
  const engine = createChat({
    adapter,
    userId: 'me',
    plugins: [{ name: 'after', onAfterSend: (msg) => { afterSent.push(msg.content); } }],
  });
  await engine.connect();

  await engine.sendMessage({ conversation_id: 'c1', content: 'hook-me' });
  await flush();

  assert.ok(afterSent.includes('hook-me'), 'onAfterSend must fire with the confirmed message');
  await engine.disconnect();
});

test('onMessageReceive plugin can transform incoming messages', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    plugins: [{
      name: 'transform',
      onMessageReceive: (msg) => ({ ...msg, content: msg.content.toUpperCase() }),
    }],
  });
  await engine.connect();

  const received: string[] = [];
  engine.subscribeMessages('c1', (e) => {
    if (e.type === 'message:new') received.push(e.payload.content);
  });

  adapter.injectIncoming('c1', 'lowercase message');
  await flush();

  assert.ok(received.includes('LOWERCASE MESSAGE'), 'plugin transform must be applied');
  await engine.disconnect();
});

test('plugin error in onBeforeSend is isolated — message still delivers', async () => {
  // PluginManager catches all plugin errors so a buggy plugin cannot break the pipeline.
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    plugins: [{ name: 'broken', onBeforeSend: () => { throw new Error('plugin crash'); } }],
  });
  await engine.connect();

  // Message must still go through despite the plugin throwing
  await assert.doesNotReject(() => engine.sendMessage({ conversation_id: 'c1', content: 'surviving crash' }));
  await flush();

  assert.equal(
    adapter.messages.filter((m) => m.content === 'surviving crash').length,
    1,
    'message must be delivered even when onBeforeSend plugin throws'
  );
  await engine.disconnect();
});

// ─── on() event API ──────────────────────────────────────────────────────────

test('engine.on() receives message events from subscribeMessages', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const fromOn: string[] = [];
  engine.on('message:new', (e) => fromOn.push(e.payload.content));

  engine.subscribeMessages('c1', () => {});
  adapter.injectIncoming('c1', 'via on()');
  await flush();

  assert.ok(fromOn.includes('via on()'), 'on() must receive events emitted during subscribeMessages');
  await engine.disconnect();
});

test('sendMessage emits error event when adapter throws and offline disabled', async () => {
  const adapter = new MockAdapter();
  adapter.online = false;
  const engine = createChat({ adapter, userId: 'me', offlineQueue: false });
  await engine.connect();

  const errors: string[] = [];
  engine.on('error', (e) => errors.push(e.payload.code));

  const optimistic = await engine.sendMessage({ conversation_id: 'c1', content: 'fail' });
  assert.ok((optimistic as AnyMessage)._optimistic, 'returns the optimistic message');
  assert.ok(errors.includes('SEND_FAILED'), 'error event must be emitted');
  await engine.disconnect();
});

test('on() unsubscribe stops receiving events', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  let count = 0;
  const off = engine.on('message:new', () => { count++; });

  engine.subscribeMessages('c1', () => {});
  adapter.injectIncoming('c1', 'first');
  await flush();
  off(); // unsubscribe

  adapter.injectIncoming('c1', 'second');
  await flush();

  assert.equal(count, 1, 'must stop receiving after unsubscribe');
  await engine.disconnect();
});

// ─── Participants ──────────────────────────────────────────────────────────────

test('addParticipant and removeParticipant delegate to adapter', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const participant = await engine.addParticipant('c1', { user_id: 'alice' });
  assert.equal(participant.user_id, 'alice');

  await assert.doesNotReject(() => engine.removeParticipant('c1', 'alice'));
  await engine.disconnect();
});

test('listParticipants returns array from adapter', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const participants = await engine.listParticipants('c1');
  assert.ok(Array.isArray(participants));
  await engine.disconnect();
});
