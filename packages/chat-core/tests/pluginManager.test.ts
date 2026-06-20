import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginManager } from '../src/engine/PluginManager.ts';
import type { ChatPlugin, SendMessageInput, Message } from '../src/index.ts';

const ctx = { userId: 'me' };
const baseInput = { conversation_id: 'c1', content: 'hello' };

test('onBeforeSend can mutate the outgoing message', async () => {
  const plugin: ChatPlugin = {
    name: 'upper',
    onBeforeSend: (input) => ({ ...input, content: input.content.toUpperCase() }),
  };
  const pm = new PluginManager([plugin]);
  const result = await pm.runBeforeSend(baseInput, ctx);
  assert.notEqual(result, false);
  assert.equal((result as { content: string }).content, 'HELLO');
});

test('onBeforeSend returning false blocks the message', async () => {
  const moderation: ChatPlugin = {
    name: 'moderation',
    onBeforeSend: (input) => (input.content.includes('spam') ? false : input),
  };
  const pm = new PluginManager([moderation]);
  assert.equal(await pm.runBeforeSend({ conversation_id: 'c1', content: 'spam!' }, ctx), false);
  assert.notEqual(await pm.runBeforeSend(baseInput, ctx), false);
});

test('plugins chain in registration order', async () => {
  const order: string[] = [];
  const p1: ChatPlugin = { name: 'p1', onBeforeSend: (i) => { order.push('p1'); return i; } };
  const p2: ChatPlugin = { name: 'p2', onBeforeSend: (i) => { order.push('p2'); return i; } };
  await new PluginManager([p1, p2]).runBeforeSend(baseInput as SendMessageInput, ctx);
  assert.deepEqual(order, ['p1', 'p2']);
});

test('onMessageReceive can transform inbound messages (AI agent inject)', async () => {
  const aiTag: ChatPlugin = {
    name: 'ai',
    onMessageReceive: (m) => ({ ...m, content: `[seen] ${m.content}` }),
  };
  const pm = new PluginManager([aiTag]);
  const msg = { id: 's1', content: 'hi' } as unknown as Message;
  const out = await pm.runMessageReceive(msg, ctx);
  assert.equal(out.content, '[seen] hi');
});

test('a throwing plugin is isolated and does not break the pipeline', async () => {
  const bad: ChatPlugin = { name: 'bad', onBeforeSend: () => { throw new Error('boom'); } };
  const good: ChatPlugin = { name: 'good', onBeforeSend: (i) => ({ ...i, content: 'ok' }) };
  const pm = new PluginManager([bad, good]);
  const result = await pm.runBeforeSend(baseInput, ctx);
  assert.equal((result as { content: string }).content, 'ok');
});
