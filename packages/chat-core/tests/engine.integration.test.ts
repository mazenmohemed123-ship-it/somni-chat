import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, type AnyMessage, type Message } from '../src/index.ts';
import { MockAdapter, flush } from './mocks/MockAdapter.ts';

function collectMessages(engine: ReturnType<typeof createChat>, convId: string) {
  const list: AnyMessage[] = [];
  engine.subscribeMessages(convId, (event) => {
    if (event.type === 'message:new') {
      const exists = list.some((m) => m.client_id === event.payload.client_id || m.id === event.payload.id);
      if (!exists) list.push(event.payload);
    } else if (event.type === 'message:updated') {
      const idx = list.findIndex((m) => m.client_id === event.payload.client_id || m.id === event.payload.id);
      if (idx >= 0) list[idx] = event.payload;
      else list.push(event.payload);
    }
  });
  return list;
}

test('optimistic send + realtime echo produces exactly ONE message (no duplicate)', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const list = collectMessages(engine, 'c1');
  await engine.sendMessage({ conversation_id: 'c1', content: 'hello' });
  await flush(); // let the realtime echo fire

  assert.equal(list.length, 1, 'expected a single reconciled message');
  assert.equal(list[0]?.content, 'hello');
  assert.equal((list[0] as Message).status, 'sent', 'optimistic placeholder reconciled to server message');
  await engine.disconnect();
});

test('duplicate realtime delivery under load is ignored', async () => {
  const adapter = new MockAdapter();
  adapter.echo = false; // we will drive delivery manually
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const list = collectMessages(engine, 'c1');
  const incoming = adapter.injectIncoming('c1', 'from other');
  adapter.redeliver('c1', incoming); // double delivery
  adapter.redeliver('c1', incoming); // triple delivery
  await flush();

  assert.equal(list.length, 1, 'duplicates must be collapsed to one');
  await engine.disconnect();
});

test('plugin can block an outgoing message', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    plugins: [{ name: 'block', onBeforeSend: (i) => (i.content === 'no' ? false : i) }],
  });
  await engine.connect();

  await assert.rejects(() => engine.sendMessage({ conversation_id: 'c1', content: 'no' }));
  assert.equal(adapter.sendCalls, 0, 'blocked message never hits the adapter');
  await engine.disconnect();
});

test('invalid (empty) message is rejected before the adapter', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();
  await assert.rejects(() => engine.sendMessage({ conversation_id: 'c1', content: '   ' }));
  assert.equal(adapter.sendCalls, 0);
  await engine.disconnect();
});

test('userId can be supplied at connect() time', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter }); // no userId yet
  await engine.connect('late-user');
  assert.equal(engine.userId, 'late-user');
  await engine.disconnect();
});

test('throws a clear error if adapter is non-compliant', () => {
  assert.throws(() => createChat({ adapter: {} as never, userId: 'me' }));
});
