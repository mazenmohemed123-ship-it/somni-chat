import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, type ChatEvent } from '../src/index.ts';
import { MockAdapter, flush } from './mocks/MockAdapter.ts';

test('unified subscribe() delivers both messages and typing', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const events: ChatEvent['type'][] = [];
  const off = engine.subscribe('c1', (e) => events.push(e.type));

  adapter.injectIncoming('c1', 'hello');
  adapter.emitTyping('c1', 'other', true);
  await flush();

  assert.ok(events.includes('message:new'));
  assert.ok(events.includes('typing:updated'));
  off();
  await engine.disconnect();
});

test('uploadAttachment delegates to the adapter', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const result = await engine.uploadAttachment({
    file: new Uint8Array([1, 2, 3]),
    file_name: 'photo.png',
    mime_type: 'image/png',
  });
  assert.equal(adapter.uploadCalls, 1);
  assert.equal(result.file_name, 'photo.png');
  await engine.disconnect();
});

test('reactions, edit and soft-delete round-trip through the engine', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const sent = await engine.sendMessage({ conversation_id: 'c1', content: 'original' });
  const reaction = await engine.addReaction(sent.id, '🔥');
  assert.equal(reaction.emoji, '🔥');

  const edited = await engine.editMessage({ message_id: sent.id, content: 'edited' });
  assert.equal(edited.content, 'edited');
  assert.ok(edited.edited_at);

  await engine.deleteMessage(sent.id);
  const after = await adapter.getMessage(sent.id);
  assert.ok(after?.deleted_at, 'soft-deleted, not removed');
  await engine.disconnect();
});

test('presence fetch + typing helpers work', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const presence = await engine.fetchPresence(['u1', 'u2']);
  assert.equal(presence.length, 2);

  const off = engine.subscribeTyping('c1');
  adapter.emitTyping('c1', 'other', true);
  await flush();
  assert.deepEqual(engine.getTypingUsers('c1'), ['other']);
  off();
  await engine.disconnect();
});

test('destroy() removes listeners (no leak after teardown)', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  let count = 0;
  engine.on('message:new', () => { count++; });
  await engine.destroy();

  // After destroy, the bus is clear; emitting reaches nobody.
  engine.events.emit({ type: 'message:new', payload: {} as never });
  assert.equal(count, 0);
});
