/**
 * Server-side helper to mint LiveKit access tokens.
 *
 * Run this **only on your server** — it needs your LiveKit API secret, which
 * must never reach the browser. Expose it behind an authenticated endpoint and
 * pass the result to {@link LiveKitCallProvider}'s `getToken`.
 *
 * Install: `npm i livekit-server-sdk`
 *
 * @example
 * // app/api/livekit-token/route.ts (Next.js)
 * import { createLiveKitToken } from '@somni/chat-call/livekit-token';
 * export async function GET(req: Request) {
 *   const { searchParams } = new URL(req.url);
 *   const room = searchParams.get('room')!;
 *   const identity = await getAuthedUserId(req); // your auth
 *   const token = await createLiveKitToken({
 *     apiKey: process.env.LIVEKIT_API_KEY!,
 *     apiSecret: process.env.LIVEKIT_API_SECRET!,
 *     room, identity,
 *   });
 *   return new Response(token);
 * }
 */
export interface CreateLiveKitTokenOptions {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  /** Display name shown to other participants. */
  name?: string;
  /** Token lifetime, e.g. '10m', '1h'. Default '1h'. */
  ttl?: string | number;
  /** Grants: defaults to join + publish + subscribe for the given room. */
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  /** Inject the `livekit-server-sdk` module (or a fake) for testing. */
  serverSdkModule?: LiveKitServerSdkModule;
}

export async function createLiveKitToken(opts: CreateLiveKitTokenOptions): Promise<string> {
  if (!opts.apiKey || !opts.apiSecret) {
    throw new Error('[LiveKit] apiKey and apiSecret are required to mint a token');
  }

  const sdk = opts.serverSdkModule ?? ((await import('livekit-server-sdk')) as unknown as LiveKitServerSdkModule);

  const at = new sdk.AccessToken(opts.apiKey, opts.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: opts.ttl ?? '1h',
  });

  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canPublish: opts.canPublish ?? true,
    canSubscribe: opts.canSubscribe ?? true,
    canPublishData: opts.canPublishData ?? true,
  });

  // livekit-server-sdk v2 returns a Promise; v1 returns a string. Support both.
  return Promise.resolve(at.toJwt());
}

// ── Minimal structural typings for livekit-server-sdk ──
export interface LiveKitServerSdkModule {
  AccessToken: new (
    apiKey: string,
    apiSecret: string,
    options: { identity: string; name?: string; ttl?: string | number }
  ) => LiveKitAccessToken;
}
export interface LiveKitAccessToken {
  addGrant(grant: {
    room: string;
    roomJoin: boolean;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
  }): void;
  toJwt(): string | Promise<string>;
}
