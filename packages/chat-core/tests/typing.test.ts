import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../src/index.ts';
import { MockAdapter, flush } from './mocks/MockAdapter.ts';
import type { TypingUpdate } from '../src/index.ts';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function trackTyping(adapter: MockAdapter): { calls: TypingUpdate[] } {
  const calls: TypingUpdate[] = [];
  adapter.updateTyping = async (update: TypingUpdate) => { calls.push({ ...update }); };
  return { calls };
}

test('notifyTyping sends typing:true to adapter exactly once per burst', async () => {
  const adapter = new MockAdapter();
  const { calls } = trackTyping(adapter);
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 200 });
  await engine.connect();

  // Three rapid keystrokes in the same conversation
  await engine.notifyTyping('c1');
  await engine.notifyTyping('c1');
  await engine.notifyTyping('c1');

  const trueEvents = calls.filter((c) => c.conversation_id === 'c1' && c.is_typing);
  assert.equal(trueEvents.length, 1, 'only one typing:true per burst, not one per keystroke');
  await engine.destroy();
});

test('typing auto-stops after timeout and sends typing:false', async () => {
  const adapter = new MockAdapter();
  const { calls } = trackTyping(adapter);
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 50 });
  await engine.connect();

  await engine.notifyTyping('c1');
  assert.equal(calls.filter((c) => c.is_typing).length, 1);

  await wait(100); // let the timer fire

  const falseEvents = calls.filter((c) => c.conversation_id === 'c1' && !c.is_typing);
  assert.equal(falseEvents.length, 1, 'timer must send typing:false after timeout');
  await engine.destroy();
});

test('stopTyping cancels timer and sends typing:false immediately', async () => {
  const adapter = new MockAdapter();
  const { calls } = trackTyping(adapter);
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 5000 });
  await engine.connect();

  await engine.notifyTyping('c1');
  await engine.stopTyping('c1');

  const falseEvents = calls.filter((c) => c.conversation_id === 'c1' && !c.is_typing);
  assert.equal(falseEvents.length, 1, 'stopTyping must flush typing:false immediately');
  await wait(10);
  // No second typing:false from a stale timer
  assert.equal(calls.filter((c) => !c.is_typing).length, 1, 'no extra typing:false from stale timer');
  await engine.destroy();
});

test('notifyTyping in two conversations sends typing:true to BOTH independently', async () => {
  // This was the actual bug: a shared `isCurrentlyTyping` boolean meant conv-b
  // never received typing:true if conv-a was already active.
  const adapter = new MockAdapter();
  const { calls } = trackTyping(adapter);
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 5000 });
  await engine.connect();

  await engine.notifyTyping('conv-a');
  await engine.notifyTyping('conv-b');

  const trueA = calls.filter((c) => c.conversation_id === 'conv-a' && c.is_typing);
  const trueB = calls.filter((c) => c.conversation_id === 'conv-b' && c.is_typing);
  assert.equal(trueA.length, 1, 'conv-a must receive typing:true');
  assert.equal(trueB.length, 1, 'conv-b must receive typing:true even though conv-a is already active');
  await engine.destroy();
});

test('stopTyping on conv-a does not affect active typing in conv-b', async () => {
  const adapter = new MockAdapter();
  const { calls } = trackTyping(adapter);
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 5000 });
  await engine.connect();

  await engine.notifyTyping('conv-a');
  await engine.notifyTyping('conv-b');
  await engine.stopTyping('conv-a');

  const falseA = calls.filter((c) => c.conversation_id === 'conv-a' && !c.is_typing);
  const falseB = calls.filter((c) => c.conversation_id === 'conv-b' && !c.is_typing);
  assert.equal(falseA.length, 1, 'conv-a should stop');
  assert.equal(falseB.length, 0, 'conv-b should still be active — stopTyping must be per-conversation');
  await engine.destroy();
});

test('typing:true not re-sent for same conversation until timeout or stopTyping', async () => {
  const adapter = new MockAdapter();
  const { calls } = trackTyping(adapter);
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 200 });
  await engine.connect();

  await engine.notifyTyping('c1');
  await wait(50);
  await engine.notifyTyping('c1'); // mid-burst, should NOT resend typing:true
  await wait(50);
  await engine.notifyTyping('c1'); // still mid-burst

  const trueEvents = calls.filter((c) => c.is_typing);
  assert.equal(trueEvents.length, 1, 'exactly one typing:true for the whole burst');

  await wait(250); // timer fires
  const falseEvents = calls.filter((c) => !c.is_typing);
  assert.equal(falseEvents.length, 1, 'exactly one typing:false after burst ends');

  // New keystroke after silence: typing:true again
  await engine.notifyTyping('c1');
  assert.equal(calls.filter((c) => c.is_typing).length, 2, 'new burst starts fresh');
  await engine.destroy();
});

test('getTypingUsers reflects incoming typing events from remote users', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 200 });
  await engine.connect();

  engine.subscribeTyping('c1');
  adapter.emitTyping('c1', 'alice', true);
  adapter.emitTyping('c1', 'bob', true);
  await flush();

  assert.deepEqual(engine.getTypingUsers('c1').sort(), ['alice', 'bob']);

  adapter.emitTyping('c1', 'alice', false);
  await flush();

  assert.deepEqual(engine.getTypingUsers('c1'), ['bob']);
  await engine.destroy();
});

test('getTypingUsers does not include self (own typing signals filtered)', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 200 });
  await engine.connect();

  engine.subscribeTyping('c1');
  adapter.emitTyping('c1', 'me', true); // our own echo — must be filtered
  await flush();

  assert.deepEqual(engine.getTypingUsers('c1'), [], 'self must never appear in getTypingUsers');
  await engine.destroy();
});

test('destroy clears all per-conversation timers without error', async () => {
  const adapter = new MockAdapter();
  const { calls } = trackTyping(adapter);
  const engine = createChat({ adapter, userId: 'me', typingTimeoutMs: 5000 });
  await engine.connect();

  // Start typing in several conversations
  await engine.notifyTyping('c1');
  await engine.notifyTyping('c2');
  await engine.notifyTyping('c3');

  // destroy must cancel timers — no typing:false events should fire afterwards
  await engine.destroy();
  await wait(30);

  const afterDestroy = calls.filter((c) => !c.is_typing);
  assert.equal(afterDestroy.length, 0, 'no typing:false after destroy — timers were cleared');
});
