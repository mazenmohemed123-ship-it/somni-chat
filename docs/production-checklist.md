# Production Checklist & npm Release Readiness

## 1. Issues found in the v0 implementation

| # | Severity | Issue | Where |
|---|----------|-------|-------|
| 1 | 🔴 Critical | **Optimistic duplicate.** `sendMessage` never tracked the `client_id`, so the realtime echo was treated as a brand-new message → every sent message appeared twice. | `ChatEngine.sendMessage` |
| 2 | 🔴 Critical | **Dropped subscribers.** A 2nd `subscribeMessages(sameConv, cb)` returned the first subscription and silently ignored `cb`. | `ChatEngine.subscribeMessages` |
| 3 | 🔴 Critical | **Premature teardown / leaks.** One component unsubscribing tore down the shared channel for everyone. | same |
| 4 | 🟠 High | **Offline queue reordered messages** (failed op re-appended to tail) and had **no backoff, no max-retry, no dead-letter** → infinite hot-loop on a poison message. | `OfflineQueue`, `drainOfflineQueue` |
| 5 | 🟠 High | **Reconnect storms.** No jitter and no single-flight guard; multiple loops could stack. | `scheduleReconnect` |
| 6 | 🟠 High | **Plugins were dead code.** Hooks were declared in config but never invoked. | `config.ts` |
| 7 | 🟠 High | **No input validation / sanitization** before hitting the adapter. | — |
| 8 | 🟡 Medium | **No adapter compliance check** → cryptic `undefined is not a function` at runtime. | — |
| 9 | 🟡 Medium | **`uploadAttachment` missing** from the adapter contract. | `ChatAdapter` |
| 10 | 🟡 Medium | **Unbounded dedup cache** under heavy realtime load. | `DeduplicationCache` |
| 11 | 🟡 Medium | **Message order not server-consistent** in the React hook. | `useMessages` |
| 12 | 🟢 Low | Weakly-typed plugin hooks (`unknown`), no `client_id`↔`server_id` reconciliation API. | types |

## 2. Fixes applied

- **Exactly-once delivery.** `client_id` is tracked *before* the optimistic emit;
  the echo is reconciled to `message:updated`. A bounded `serverId`/`client_id`
  cache drops hard duplicates. Proven by `stress.test.ts` (1000 msgs, 0 dupes).
- **Fan-out subscriptions.** New `SubscriptionRegistry`: many subscribers, one
  adapter channel, teardown only when the last leaves.
- **Hardened offline queue.** FIFO order preserved, per-op exponential backoff
  with jitter, `maxRetries`, and a **dead-letter queue**; survives refresh via
  versioned storage snapshot. Auto-drain pump on reconnect.
- **Reconnect** is single-flight with jittered capped backoff.
- **Plugin pipeline** (`PluginManager`) actually runs `onBeforeSend` (can
  **block**), `onAfterSend`, `onMessageReceive`, `onPresenceChange`, `onTyping`,
  with per-plugin error isolation.
- **Validation + sanitization** (`validateMessageInput`) on every send.
- **Runtime adapter validation** (`validateAdapter`) at `createChat()`.
- **`uploadAttachment`** added to the contract + all three adapters.
- **Server-consistent ordering** in `useMessages`.
- **Strict typing**: typed plugin hooks, `BeforeSendResult`, reconciliation API,
  zero `any` in the new core code.

## 3. Test suite (all green — 49 tests)

```
npm --workspace @somni/chat-core test
```

| File | Covers |
|------|--------|
| `deduplication.test.ts` | dedup correctness, reconciliation, bounded memory |
| `offlineQueue.test.ts` | FIFO, idempotency, backoff gate, dead-letter, refresh survival |
| `offlineRecovery.test.ts` | queue → flush on recovery, order, dead-letter end-to-end |
| `validation.test.ts` | sanitization, empty/length/type rules |
| `backoff.test.ts` | exponential growth, cap, jitter spread |
| `eventEmitter.test.ts` | delivery, unsubscribe, error isolation |
| `subscriptionRegistry.test.ts` | fan-out, last-subscriber teardown |
| `pluginManager.test.ts` | mutate, block, chain order, AI inject, isolation |
| `validateAdapter.test.ts` | compliance pass/fail, missing-method listing |
| `engine.integration.test.ts` | optimistic no-dupe, dup delivery, plugin block, late userId |
| `stress.test.ts` | 1000-message realtime flood, zero duplicates, leak-free teardown |

## 4. Production checklist

- [x] Exactly-once message rendering under duplicate delivery
- [x] Optimistic UI with reconciliation
- [x] Offline-first: persistent queue, backoff+jitter, dead-letter
- [x] Reconnect: single-flight, capped, jittered
- [x] Memory-safe: bounded caches, full subscription/timer cleanup, `destroy()`
- [x] Cursor-based message pagination + lazy conversation loading
- [x] Strict adapter contract + runtime compliance validation
- [x] Input validation + sanitization
- [x] Plugin system (moderation / AI / analytics) without core changes
- [x] Tree-shakable, dual ESM/CJS, full `.d.ts`
- [x] Test suite covering core, integration, stress, offline, dedup
- [ ] Backend authorization (RLS/rules) — **owned by the adapter/back-end**, see below
- [ ] CI workflow (`npm test` + `tsc --noEmit` + `build`) — add on your runner

## 5. Security notes (shared responsibility)

The engine **sanitizes payloads** and **validates input**, but it **cannot**
enforce who may read or write a conversation — that lives in the backend:

- **Supabase**: RLS policies ship in `packages/chat-adapters/supabase/migrations`.
- **Appwrite**: set document/collection permissions per participant (the adapter
  sets per-user read/write permissions on conversation create).
- **Firebase**: add Firestore security rules restricting reads/writes to
  conversation participants.

Never set `skipAdapterValidation` in production unless you have your own checks.

## 6. npm release readiness report

| Item | Status |
|------|--------|
| Package name | `@somni/chat` (umbrella) + scoped sub-packages |
| Version | `1.0.0` across all packages |
| Entry points | `main` (CJS) + `module` (ESM) + `types` |
| Sub-path exports | `@somni/chat`, `/react`, `/adapters/{supabase,appwrite,firebase}` |
| Tree-shaking | `sideEffects: false` (UI marks its CSS) |
| Types | Emitted `.d.ts` per package |
| Peer deps | adapters/react/ui declared as peers (optional where appropriate) |
| Tests | 49 passing |
| License | MIT |

### Release steps

```bash
pnpm install
pnpm build          # turbo builds every package
pnpm --filter @somni/chat-core test
# bump versions (already 1.0.0), then:
pnpm -r publish --access public
```
