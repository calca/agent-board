import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export interface ChatSessionOptions {
  /** Chat mode (e.g. 'autopilot'). */
  mode: string;
  /** The prompt / query text. */
  query: string;
  /** true = prefill only, false = auto-submit. */
  isPartialQuery: boolean;
  /** If true, close the chat panel after submission (for background sessions). */
  hideAfter?: boolean;
}

const SETTLE_DELAY_MS = 500;
const MAX_RETRIES = 2;

/**
 * Singleton factory that serialises VS Code chat-session creation.
 *
 * All providers go through `create()` which enqueues the work behind
 * a promise chain so that only one `newChat → chat.open` sequence
 * runs at a time.  This prevents race conditions where a second
 * `newChat` overwrites the first session.
 */
export class ChatSessionFactory {
  private static instance: ChatSessionFactory | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly logger = Logger.getInstance();

  static getInstance(): ChatSessionFactory {
    if (!ChatSessionFactory.instance) {
      ChatSessionFactory.instance = new ChatSessionFactory();
    }
    return ChatSessionFactory.instance;
  }

  /** Enqueue a new chat session creation. Resolves once the session is ready. */
  create(opts: ChatSessionOptions): Promise<void> {
    const task = this.queue.then(() => this.doCreate(opts, 0));
    // Keep the queue advancing even if one creation fails.
    this.queue = task.catch(() => {});
    return task;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async doCreate(opts: ChatSessionOptions, attempt: number): Promise<void> {
    try {
      // 1. Create a brand-new, empty chat session.
      await vscode.commands.executeCommand('workbench.action.chat.newChat');

      // 2. Let VS Code fully initialise the new session before sending the query.
      await this.delay(SETTLE_DELAY_MS);

      // 3. Open the session with the desired mode and query.
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: opts.mode,
        query: opts.query,
        isPartialQuery: opts.isPartialQuery,
      });

      // 4. Post-open actions.
      if (opts.hideAfter) {
        await this.delay(200);
        await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
      }

      // 5. Wait for the session to settle before allowing the next one.
      await this.delay(SETTLE_DELAY_MS);

      this.logger.info('ChatSessionFactory: session created (mode=%s, partial=%s)', opts.mode, opts.isPartialQuery);
    } catch (err) {
      this.logger.error('ChatSessionFactory: attempt %d failed — %s', attempt, String(err));
      if (attempt < MAX_RETRIES) {
        await this.delay(500);
        return this.doCreate(opts, attempt + 1);
      }
      throw err;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
