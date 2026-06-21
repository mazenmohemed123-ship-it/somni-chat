import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallEmitter } from '../src/index.ts';

test('delivers to matching listeners only', () => {
  const e = new CallEmitter();
  let connected = 0;
  let ended = 0;
  e.on('call:connected', () => connected++);
  e.on('call:ended', () => ended++);
  e.emit({ type: 'call:ended', payload: { call_id: 'c', reason: 'hangup' } });
  assert.equal(connected, 0);
  assert.equal(ended, 1);
});

test('unsubscribe works', () => {
  const e = new CallEmitter();
  let n = 0;
  const off = e.on('call:ended', () => n++);
  off();
  e.emit({ type: 'call:ended', payload: { call_id: 'c', reason: 'hangup' } });
  assert.equal(n, 0);
});

test('a throwing listener does not break the emit loop', () => {
  const e = new CallEmitter();
  let reached = false;
  e.on('call:ended', () => { throw new Error('x'); });
  e.on('call:ended', () => { reached = true; });
  assert.doesNotThrow(() => e.emit({ type: 'call:ended', payload: { call_id: 'c', reason: 'hangup' } }));
  assert.equal(reached, true);
});
