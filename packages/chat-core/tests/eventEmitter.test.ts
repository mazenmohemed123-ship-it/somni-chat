import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatEventEmitter } from '../src/engine/EventEmitter.ts';

test('delivers events to subscribers of the matching type', () => {
  const e = new ChatEventEmitter();
  let got = 0;
  e.on('connection:connected', () => { got++; });
  e.emit({ type: 'connection:connected' });
  assert.equal(got, 1);
});

test('unsubscribe stops further delivery (no leak)', () => {
  const e = new ChatEventEmitter();
  let got = 0;
  const off = e.on('connection:connected', () => { got++; });
  e.emit({ type: 'connection:connected' });
  off();
  e.emit({ type: 'connection:connected' });
  assert.equal(got, 1);
});

test('a throwing listener does not break the bus', () => {
  const e = new ChatEventEmitter();
  let reached = false;
  e.on('connection:connected', () => { throw new Error('boom'); });
  e.on('connection:connected', () => { reached = true; });
  assert.doesNotThrow(() => e.emit({ type: 'connection:connected' }));
  assert.equal(reached, true);
});

test('removeAllListeners clears everything', () => {
  const e = new ChatEventEmitter();
  let got = 0;
  e.on('connection:connected', () => { got++; });
  e.removeAllListeners();
  e.emit({ type: 'connection:connected' });
  assert.equal(got, 0);
});
