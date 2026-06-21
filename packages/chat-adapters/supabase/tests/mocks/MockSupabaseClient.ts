/**
 * A recording mock of the parts of supabase-js the adapter touches.
 * It verifies the adapter issues the *correct* calls (table, op, payload,
 * filters, realtime wiring) and maps canned responses to domain types —
 * without needing a live Supabase project.
 */

export interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
  single: boolean;
  select?: string;
  order?: { col: string; opts?: unknown };
  limit?: number;
}

export interface QueryResponse {
  data: unknown;
  error: { message: string } | null;
}

class MockQueryBuilder {
  private readonly client: MockSupabaseClient;
  private readonly call: RecordedCall;

  constructor(client: MockSupabaseClient, table: string) {
    this.client = client;
    this.call = { table, op: 'select', filters: [], single: false };
  }

  insert(payload: unknown) { this.call.op = 'insert'; this.call.payload = payload; return this; }
  update(payload: unknown) { this.call.op = 'update'; this.call.payload = payload; return this; }
  upsert(payload: unknown, _opts?: unknown) { this.call.op = 'upsert'; this.call.payload = payload; return this; }
  delete() { this.call.op = 'delete'; return this; }
  select(cols?: string) { this.call.select = cols ?? '*'; return this; }
  single() { this.call.single = true; return this; }
  eq(col: string, val: unknown) { this.call.filters.push(['eq', col, val]); return this; }
  lt(col: string, val: unknown) { this.call.filters.push(['lt', col, val]); return this; }
  gt(col: string, val: unknown) { this.call.filters.push(['gt', col, val]); return this; }
  in(col: string, val: unknown) { this.call.filters.push(['in', col, val]); return this; }
  is(col: string, val: unknown) { this.call.filters.push(['is', col, val]); return this; }
  order(col: string, opts?: unknown) { this.call.order = { col, opts }; return this; }
  limit(n: number) { this.call.limit = n; return this; }

  private resolve(): QueryResponse {
    this.client.calls.push(this.call);
    const key = `${this.call.table}:${this.call.op}`;
    const programmed = this.client.responses.get(key);
    return programmed ?? { data: this.call.single ? null : [], error: null };
  }

  then<T>(onFulfilled: (value: QueryResponse) => T): Promise<T> {
    return Promise.resolve(this.resolve()).then(onFulfilled);
  }
}

export interface MockChannelHandler {
  type: string;
  config: Record<string, unknown> | undefined;
  cb: (payload: unknown) => void;
}

export class MockChannel {
  readonly name: string;
  readonly handlers: MockChannelHandler[] = [];
  subscribed = false;
  readonly sent: unknown[] = [];

  constructor(name: string) {
    this.name = name;
  }

  on(type: string, configOrCb: unknown, cb?: (payload: unknown) => void): this {
    if (typeof configOrCb === 'function') {
      this.handlers.push({ type, config: undefined, cb: configOrCb as (p: unknown) => void });
    } else {
      this.handlers.push({ type, config: configOrCb as Record<string, unknown>, cb: cb! });
    }
    return this;
  }

  subscribe(): this { this.subscribed = true; return this; }

  async send(message: unknown): Promise<'ok'> { this.sent.push(message); return 'ok'; }

  /** Test helper: fire a postgres_changes-style payload to matching handlers. */
  emitPostgres(eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>): void {
    for (const h of this.handlers) {
      if (h.type !== 'postgres_changes') continue;
      const cfgEvent = h.config?.['event'];
      if (cfgEvent === '*' || cfgEvent === eventType) {
        h.cb({ eventType, new: row, old: row });
      }
    }
  }

  /** Test helper: fire a broadcast payload. */
  emitBroadcast(event: string, payload: unknown): void {
    for (const h of this.handlers) {
      if (h.type === 'broadcast' && h.config?.['event'] === event) {
        h.cb({ payload });
      }
    }
  }
}

class MockAuth {
  user: { id: string; email?: string } | null = null;
  accessToken: string | null = 'fake-jwt';
  private listeners: Array<(event: string, session: unknown) => void> = [];

  setUser(user: { id: string; email?: string } | null): void { this.user = user; }

  async getUser() {
    if (!this.user) return { data: { user: null }, error: { message: 'no session' } };
    return { data: { user: this.user }, error: null };
  }

  async getSession() {
    if (!this.user) return { data: { session: null }, error: null };
    return { data: { session: { user: this.user, access_token: this.accessToken } }, error: null };
  }

  onAuthStateChange(cb: (event: string, session: unknown) => void) {
    this.listeners.push(cb);
    return { data: { subscription: { unsubscribe: () => { this.listeners = this.listeners.filter((l) => l !== cb); } } } };
  }

  async signInWithPassword({ email }: { email: string; password: string }) {
    this.user = { id: `user-for-${email}`, email };
    return { data: { user: this.user }, error: null };
  }

  async signInWithOAuth(_opts: unknown) { return { data: {}, error: null }; }
  async signOut() { this.user = null; return { error: null }; }

  emitAuthChange(event: string): void {
    for (const l of this.listeners) l(event, this.user ? { user: this.user } : null);
  }
}

class MockStorage {
  readonly uploads: Array<{ bucket: string; path: string; contentType?: string }> = [];
  from(bucket: string) {
    const uploads = this.uploads;
    return {
      async upload(path: string, _file: unknown, opts?: { contentType?: string }) {
        uploads.push({ bucket, path, contentType: opts?.contentType });
        return { data: { path }, error: null };
      },
      getPublicUrl(path: string) {
        return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } };
      },
    };
  }
}

export class MockSupabaseClient {
  readonly calls: RecordedCall[] = [];
  readonly responses = new Map<string, QueryResponse>();
  readonly channelsCreated: MockChannel[] = [];
  readonly removedChannels: MockChannel[] = [];
  readonly auth = new MockAuth();
  readonly storage = new MockStorage();

  /** Program a canned response for a `${table}:${op}` key. */
  setResponse(table: string, op: RecordedCall['op'], data: unknown, error: { message: string } | null = null): void {
    this.responses.set(`${table}:${op}`, { data, error });
  }

  schema(_schema: string) {
    return { from: (table: string) => new MockQueryBuilder(this, table) };
  }

  channel(name: string, _opts?: unknown): MockChannel {
    const ch = new MockChannel(name);
    this.channelsCreated.push(ch);
    return ch;
  }

  async removeChannel(channel: MockChannel): Promise<void> {
    this.removedChannels.push(channel);
  }

  // Test helpers
  lastCall(): RecordedCall { return this.calls[this.calls.length - 1]; }
  callsTo(table: string): RecordedCall[] { return this.calls.filter((c) => c.table === table); }
  findChannel(predicate: (c: MockChannel) => boolean): MockChannel | undefined {
    return this.channelsCreated.find(predicate);
  }
}
