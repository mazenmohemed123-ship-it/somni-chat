import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionRegistry } from '../src/engine/SubscriptionRegistry.ts';
import type { ChatEvent } from '../src/index.ts';

const ev: ChatEvent = { type: 'connection:connected' };

test('multiple subscribers to one key all receive events (fan-out)', () => {
  const reg = new SubscriptionRegistry();
  let connectCalls = 0;
  let a = 0;
  let b = 0;
  let emit!: (e: ChatEvent) => void;

  const connect = (fanout: (e: ChatEvent) => void) => {
    connectCalls++;
    emit = fanout;
    return () => undefined;
  };

  reg.subscribe('k', () => { a++; }, connect);
  reg.subscribe('k', () => { b++; }, connect);

  assert.equal(connectCalls, 1, 'adapter channel opened exactly once');
  emit(ev);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('adapter channel torn down only when the LAST subscriber leaves', () => {
  const reg = new SubscriptionRegistry();
  let torndown = false;
  const connect = () => () => { torndown = true; };

  const off1 = reg.subscribe('k', () => {}, connect);
  const off2 = reg.subscribe('k', () => {}, connect);

  off1();
  assert.equal(torndown, false, 'still has one subscriber');
  assert.equal(reg.subscriberCount('k'), 1);

  off2();
  assert.equal(torndown, true, 'last subscriber gone → channel closed');
  assert.equal(reg.has('k'), false);
});

test('a throwing subscriber does not block siblings', () => {
  const reg = new SubscriptionRegistry();
  let reached = false;
  let emit!: (e: ChatEvent) => void;
  const connect = (fanout: (e: ChatEvent) => void) => { emit = fanout; return () => undefined; };

  reg.subscribe('k', () => { throw new Error('x'); }, connect);
  reg.subscribe('k', () => { reached = true; }, connect);
  assert.doesNotThrow(() => emit(ev));
  assert.equal(reached, true);
});
