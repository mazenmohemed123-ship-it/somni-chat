import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Thin bridge between Supabase Auth and the Somni Chat engine.
 *
 * The chat engine is auth-agnostic — it only needs a stable `userId`. This
 * helper resolves that id from the current Supabase session and lets you react
 * to sign-in / sign-out so you can (re)connect the engine.
 *
 * @example
 * const auth = new SupabaseAuth(supabase);
 * const userId = await auth.getCurrentUserId();
 * const chat = createChat({ adapter: new SupabaseAdapter({ client: supabase }), userId });
 * await chat.connect();
 *
 * auth.onAuthStateChange(async ({ userId }) => {
 *   if (userId) await chat.connect(userId);
 *   else await chat.disconnect();
 * });
 */
export interface AuthState {
  userId: string | null;
  event: string;
}

export type AuthStateListener = (state: AuthState) => void;

export class SupabaseAuth {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /** Resolve the signed-in user's id, or null if anonymous. */
  async getCurrentUserId(): Promise<string | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  }

  /** Return the full Supabase user object (email, metadata, …) or null. */
  async getCurrentUser(): Promise<{ id: string; email?: string } | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined };
  }

  /** The current access token (JWT) — useful to mint LiveKit/Storage tokens. */
  async getAccessToken(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data?.session?.access_token ?? null;
  }

  /** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
  onAuthStateChange(listener: AuthStateListener): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      listener({ event, userId: session?.user?.id ?? null });
    });
    return () => data.subscription.unsubscribe();
  }

  // ── Convenience pass-throughs (optional to use) ───────────────────────────

  async signInWithPassword(email: string, password: string): Promise<string> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`[Supabase] signIn: ${error.message}`);
    return data.user.id;
  }

  async signInWithOAuth(provider: 'google' | 'github' | 'apple' | string): Promise<void> {
    const { error } = await this.client.auth.signInWithOAuth({ provider: provider as never });
    if (error) throw new Error(`[Supabase] signInWithOAuth: ${error.message}`);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(`[Supabase] signOut: ${error.message}`);
  }
}
