import type { ChatPlugin, PluginContext, BeforeSendResult } from '../types/config';
import type { Message, SendMessageInput, AnyMessage } from '../types/message';
import type { UserPresence, TypingIndicator } from '../types/presence';

/**
 * Runs the registered plugin hooks in order. Plugins can transform messages,
 * block outgoing messages, and observe presence/typing — without the engine
 * knowing what any individual plugin does (AI agents, moderation, analytics…).
 *
 * A throwing plugin never breaks the pipeline: errors are isolated and logged.
 */
export class PluginManager {
  private readonly plugins: ChatPlugin[];

  constructor(plugins: ChatPlugin[] = []) {
    this.plugins = plugins;
  }

  get count(): number {
    return this.plugins.length;
  }

  /**
   * Runs `onBeforeSend` across all plugins. Returns the transformed input, or
   * `false` if any plugin blocked the message.
   */
  async runBeforeSend(
    input: Omit<SendMessageInput, 'client_id'>,
    ctx: PluginContext
  ): Promise<BeforeSendResult> {
    let current: Omit<SendMessageInput, 'client_id'> = input;
    for (const plugin of this.plugins) {
      if (!plugin.onBeforeSend) continue;
      try {
        const result = await plugin.onBeforeSend(current, ctx);
        if (result === false) return false; // blocked
        current = result;
      } catch (err) {
        this.logError(plugin.name, 'onBeforeSend', err);
      }
    }
    return current;
  }

  async runAfterSend(message: Message, ctx: PluginContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.onAfterSend) continue;
      try {
        await plugin.onAfterSend(message, ctx);
      } catch (err) {
        this.logError(plugin.name, 'onAfterSend', err);
      }
    }
  }

  async runMessageReceive(message: AnyMessage, ctx: PluginContext): Promise<AnyMessage> {
    let current = message;
    for (const plugin of this.plugins) {
      if (!plugin.onMessageReceive) continue;
      try {
        current = await plugin.onMessageReceive(current, ctx);
      } catch (err) {
        this.logError(plugin.name, 'onMessageReceive', err);
      }
    }
    return current;
  }

  runPresenceChange(presence: UserPresence, ctx: PluginContext): void {
    for (const plugin of this.plugins) {
      if (!plugin.onPresenceChange) continue;
      try {
        plugin.onPresenceChange(presence, ctx);
      } catch (err) {
        this.logError(plugin.name, 'onPresenceChange', err);
      }
    }
  }

  runTyping(typing: TypingIndicator & { is_typing: boolean }, ctx: PluginContext): void {
    for (const plugin of this.plugins) {
      if (!plugin.onTyping) continue;
      try {
        plugin.onTyping(typing, ctx);
      } catch (err) {
        this.logError(plugin.name, 'onTyping', err);
      }
    }
  }

  private logError(plugin: string, hook: string, err: unknown): void {
    console.error(`[Somni] Plugin "${plugin}" failed in ${hook}:`, err);
  }
}
