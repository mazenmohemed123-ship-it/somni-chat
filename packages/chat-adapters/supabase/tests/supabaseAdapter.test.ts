import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAdapter } from '../src/SupabaseAdapter';
import { MockSupabaseClient } from './mocks/MockSupabaseClient';
import type { ChatEvent } from '@somni/chat-core';

function makeAdapter(client = new MockSupabaseClient(), config = {}) {
  return { adapter: new SupabaseAdapter({ client: client as never, requireAuth: false, ...config }), client };
}

describe('SupabaseAdapter — conversations', () => {
  test('createConversation inserts conversation then participants', async () => {
    const { adapter, client } = makeAdapter();
    client.setResponse('conversations', 'insert', { id: 'conv-1', type: 'group' });

    const conv = await adapter.createConversation({
      type: 'group', title: 'Team', participant_ids: ['alice', 'bob'],
    });

    assert.equal(conv.id, 'conv-1');
    const convInsert = client.callsTo('conversations').find((c) => c.op === 'insert');
    assert.ok(convInsert);
    assert.equal((convInsert.payload as Record<string, unknown>).type, 'group');

    const partInsert = client.callsTo('participants').find((c) => c.op === 'insert');
    assert.ok(partInsert);
    const rows = partInsert.payload as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].role, 'owner');   // first participant becomes owner
    assert.equal(rows[1].role, 'member');
  });

  test('getConversation returns null on error', async () => {
    const { adapter, client } = makeAdapter();
    client.setResponse('conversations', 'select', null, { message: 'not found' });
    const conv = await adapter.getConversation('missing');
    assert.equal(conv, null);
  });

  test('listConversations maps joined rows and paginates', async () => {
    const { adapter, client } = makeAdapter();
    client.setResponse('participants', 'select', [
      { conversation: { id: 'c1', last_message_at: '2026-01-02' } },
      { conversation: { id: 'c2', last_message_at: '2026-01-01' } },
    ]);
    const result = await adapter.listConversations('alice', { limit: 2 });
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].id, 'c1');
    assert.equal(result.has_more, true);
    assert.equal(result.next_cursor, '2026-01-01');
  });
});

describe('SupabaseAdapter — messages', () => {
  test('sendMessage inserts with client_id and returns server message', async () => {
    const { adapter, client } = makeAdapter();
    client.setResponse('messages', 'insert', { id: 'srv-1', content: 'hi', client_id: 'cli-1' });

    const msg = await adapter.sendMessage({ conversation_id: 'c1', content: 'hi', client_id: 'cli-1' });
    assert.equal(msg.id, 'srv-1');

    const insert = client.callsTo('messages').find((c) => c.op === 'insert');
    const payload = insert!.payload as Record<string, unknown>;
    assert.equal(payload.client_id, 'cli-1');
    assert.equal(payload.conversation_id, 'c1');
    assert.equal(payload.type, 'text');
  });

  test('editMessage sets edited_at and content', async () => {
    const { adapter, client } = makeAdapter();
    client.setResponse('messages', 'update', { id: 'm1', content: 'edited' });
    await adapter.editMessage({ message_id: 'm1', content: 'edited' });
    const update = client.callsTo('messages').find((c) => c.op === 'update');
    const payload = update!.payload as Record<string, unknown>;
    assert.equal(payload.content, 'edited');
    assert.ok(payload.edited_at);
  });

  test('deleteMessage is a soft delete (sets deleted_at)', async () => {
    const { adapter, client } = makeAdapter();
    await adapter.deleteMessage('m1');
    const update = client.callsTo('messages').find((c) => c.op === 'update');
    assert.ok((update!.payload as Record<string, unknown>).deleted_at);
  });

  test('listMessages excludes deleted by default and reverses to ascending', async () => {
    const { adapter, client } = makeAdapter();
    client.setResponse('messages', 'select', [
      { id: 'm3', created_at: '2026-01-03' },
      { id: 'm2', created_at: '2026-01-02' },
      { id: 'm1', created_at: '2026-01-01' },
    ]);
    const result = await adapter.listMessages('c1', { limit: 3 });
    // reversed → oldest first
    assert.equal(result.items[0].id, 'm1');
    assert.equal(result.items[2].id, 'm3');

    const select = client.callsTo('messages').find((c) => c.op === 'select');
    assert.ok(select!.filters.some(([op, col, val]) => op === 'is' && col === 'deleted_at' && val === null));
  });
});

describe('SupabaseAdapter — realtime', () => {
  test('subscribeMessages emits message:new on INSERT and message:updated on UPDATE', async () => {
    const { adapter, client } = makeAdapter();
    const events: ChatEvent[] = [];
    adapter.subscribeMessages('conv-1', (e) => events.push(e));

    const channel = client.findChannel((c) => c.name === 'messages:conv-1');
    assert.ok(channel);
    assert.equal(channel.subscribed, true);

    channel.emitPostgres('INSERT', { id: 'm1', content: 'new' });
    channel.emitPostgres('UPDATE', { id: 'm1', content: 'edited' });

    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'message:new');
    assert.equal(events[1].type, 'message:updated');
  });

  test('unsubscribe removes the channel', async () => {
    const { adapter, client } = makeAdapter();
    const unsub = adapter.subscribeMessages('conv-1', () => {});
    const channel = client.findChannel((c) => c.name === 'messages:conv-1')!;
    unsub();
    assert.ok(client.removedChannels.includes(channel));
  });

  test('subscribePresence emits presence:updated', async () => {
    const { adapter, client } = makeAdapter();
    const events: ChatEvent[] = [];
    adapter.subscribePresence(['alice', 'bob'], (e) => events.push(e));
    const channel = client.channelsCreated.find((c) => c.name.startsWith('presence:'))!;
    channel.emitPostgres('UPDATE', { user_id: 'alice', status: 'online' });
    assert.equal(events[0].type, 'presence:updated');
  });

  test('typing: updateTyping reuses one subscribed sender channel per conversation', async () => {
    const { adapter, client } = makeAdapter();
    await adapter.updateTyping({ conversation_id: 'c1', user_id: 'alice', is_typing: true });
    await adapter.updateTyping({ conversation_id: 'c1', user_id: 'alice', is_typing: false });

    const senders = client.channelsCreated.filter((c) => c.name === 'typing:c1');
    assert.equal(senders.length, 1);          // reused, not leaked
    assert.equal(senders[0].subscribed, true);
    assert.equal(senders[0].sent.length, 2);
  });

  test('subscribeTyping emits typing:updated from broadcast', async () => {
    const { adapter, client } = makeAdapter();
    const events: ChatEvent[] = [];
    adapter.subscribeTyping('c1', (e) => events.push(e));
    const channel = client.findChannel((c) => c.name === 'typing:c1')!;
    channel.emitBroadcast('typing', { user_id: 'bob', is_typing: true });
    assert.equal(events[0].type, 'typing:updated');
    assert.equal((events[0] as { payload: { user_id: string } }).payload.user_id, 'bob');
  });
});

describe('SupabaseAdapter — attachments & lifecycle', () => {
  test('uploadAttachment stores file and returns a public URL', async () => {
    const { adapter, client } = makeAdapter();
    const blob = { size: 1234 } as Blob;
    const result = await adapter.uploadAttachment({
      file: blob, file_name: 'photo.png', mime_type: 'image/png', conversation_id: 'c1',
    });
    assert.equal(result.file_type, 'image');
    assert.equal(result.file_size, 1234);
    assert.ok(result.file_url.startsWith('https://cdn.test/chat-attachments/'));
    assert.equal(client.storage.uploads.length, 1);
  });

  test('disconnect removes all channels (subscriptions + typing senders)', async () => {
    const { adapter, client } = makeAdapter();
    adapter.subscribeMessages('c1', () => {});
    await adapter.updateTyping({ conversation_id: 'c2', user_id: 'a', is_typing: true });
    await adapter.disconnect();
    assert.ok(client.removedChannels.length >= 2);
  });
});

describe('SupabaseAdapter — auth gating', () => {
  test('connect throws when requireAuth and no session', async () => {
    const client = new MockSupabaseClient();
    const adapter = new SupabaseAdapter({ client: client as never, requireAuth: true });
    await assert.rejects(() => adapter.connect('alice'), /no authenticated session/);
  });

  test('connect throws when userId mismatches session', async () => {
    const client = new MockSupabaseClient();
    client.auth.setUser({ id: 'real-user' });
    const adapter = new SupabaseAdapter({ client: client as never, requireAuth: true });
    await assert.rejects(() => adapter.connect('someone-else'), /does not match/);
  });

  test('connect succeeds when session matches', async () => {
    const client = new MockSupabaseClient();
    client.auth.setUser({ id: 'alice' });
    const adapter = new SupabaseAdapter({ client: client as never, requireAuth: true });
    await adapter.connect('alice');
    assert.equal(await adapter.getCurrentUserId(), 'alice');
  });

  test('getCurrentUserId returns null when anonymous', async () => {
    const { adapter } = makeAdapter();
    assert.equal(await adapter.getCurrentUserId(), null);
  });
});
