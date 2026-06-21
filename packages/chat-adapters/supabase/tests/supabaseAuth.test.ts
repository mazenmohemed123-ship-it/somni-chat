import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAuth } from '../src/SupabaseAuth';
import { MockSupabaseClient } from './mocks/MockSupabaseClient';

describe('SupabaseAuth', () => {
  test('getCurrentUserId returns id when signed in', async () => {
    const client = new MockSupabaseClient();
    client.auth.setUser({ id: 'alice', email: 'a@x.com' });
    const auth = new SupabaseAuth(client as never);
    assert.equal(await auth.getCurrentUserId(), 'alice');
  });

  test('getCurrentUserId returns null when anonymous', async () => {
    const client = new MockSupabaseClient();
    const auth = new SupabaseAuth(client as never);
    assert.equal(await auth.getCurrentUserId(), null);
  });

  test('getCurrentUser returns id and email', async () => {
    const client = new MockSupabaseClient();
    client.auth.setUser({ id: 'alice', email: 'a@x.com' });
    const auth = new SupabaseAuth(client as never);
    const user = await auth.getCurrentUser();
    assert.deepEqual(user, { id: 'alice', email: 'a@x.com' });
  });

  test('getAccessToken returns the session JWT', async () => {
    const client = new MockSupabaseClient();
    client.auth.setUser({ id: 'alice' });
    const auth = new SupabaseAuth(client as never);
    assert.equal(await auth.getAccessToken(), 'fake-jwt');
  });

  test('onAuthStateChange fires on sign-in and sign-out', async () => {
    const client = new MockSupabaseClient();
    const auth = new SupabaseAuth(client as never);
    const states: Array<string | null> = [];
    const unsub = auth.onAuthStateChange((s) => states.push(s.userId));

    client.auth.setUser({ id: 'alice' });
    client.auth.emitAuthChange('SIGNED_IN');
    client.auth.setUser(null);
    client.auth.emitAuthChange('SIGNED_OUT');

    assert.deepEqual(states, ['alice', null]);
    unsub();
    client.auth.emitAuthChange('SIGNED_IN'); // ignored after unsubscribe
    assert.equal(states.length, 2);
  });

  test('signInWithPassword returns the user id', async () => {
    const client = new MockSupabaseClient();
    const auth = new SupabaseAuth(client as never);
    const id = await auth.signInWithPassword('bob@x.com', 'pw');
    assert.equal(id, 'user-for-bob@x.com');
  });

  test('signOut clears the session', async () => {
    const client = new MockSupabaseClient();
    client.auth.setUser({ id: 'alice' });
    const auth = new SupabaseAuth(client as never);
    await auth.signOut();
    assert.equal(await auth.getCurrentUserId(), null);
  });
});
