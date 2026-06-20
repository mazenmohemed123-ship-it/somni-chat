/**
 * @somni/chat — the umbrella entry point.
 *
 * Re-exports the entire framework-agnostic core. Framework/back-end specific
 * code lives behind sub-path exports so they stay fully tree-shakable:
 *
 *   import { createChat } from '@somni/chat';
 *   import { useMessages } from '@somni/chat/react';
 *   import { SupabaseAdapter } from '@somni/chat/adapters/supabase';
 */
export * from '@somni/chat-core';
