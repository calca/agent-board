/**
 * GenAI provider that uses the `@github/copilot-sdk` directly.
 *
 * Registers alongside the existing providers in GenAiProviderRegistry.
 * Uses the real Copilot SDK (CopilotClient / CopilotSession) with streaming,
 * tool-call events, and session management.
 */
import type { CopilotClientOptions, SessionConfig } from '@github/copilot-sdk';
import { CopilotClient, CopilotSession, approveAll } from '@github/copilot-sdk';
import * as path from 'path';
import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { formatError } from '../../utils/errorUtils';
import {
  GenAiProviderConfig,
  GenAiProviderScope,
  GenAiSettingDescriptor,
  IGenAiProvider,
} from '../IGenAiProvider';
import type { CopilotEvent } from './copilot-sdk/types';

export class CopilotSdkGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-sdk';
  readonly displayName = 'Copilot SDK';
  readonly description = 'GitHub Copilot SDK with structured chat UI';
  readonly icon = 'sparkle';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;
  readonly requiresGit = true;
  readonly handlesAgentNatively = true;

  private model: string;
  private abortController: AbortController | undefined;
  private client: CopilotClient | undefined;
  private currentSession: CopilotSession | undefined;

  private readonly _onDidStreamEmitter = new vscode.EventEmitter<string>();
  readonly onDidStream: vscode.Event<string> = this._onDidStreamEmitter.event;

  private readonly _onDidCopilotEvent = new vscode.EventEmitter<CopilotEvent>();
  /** Structured event stream for the chat bridge. */
  readonly onDidCopilotEvent: vscode.Event<CopilotEvent> = this._onDidCopilotEvent.event;

  constructor(config?: GenAiProviderConfig) {
    this.model = (config?.model as string | undefined) ?? 'gpt-4o';
  }

  getSettingsDescriptors(): GenAiSettingDescriptor[] {
    return [
      {
        key: 'model',
        title: 'Model',
        description: 'Model identifier (e.g. gpt-4o, gpt-5, claude-sonnet-4.5)',
        type: 'string',
        defaultValue: 'gpt-4o',
      },
    ];
  }

  applyConfig(config: GenAiProviderConfig): void {
    this.model = (config.model as string | undefined) ?? this.model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      require.resolve('@github/copilot-sdk');
      return true;
    } catch {
      return false;
    }
  }

  async run(prompt: string, _task?: KanbanTask, worktreePath?: string, agentSlug?: string): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const emit = (event: CopilotEvent) => {
      this._onDidCopilotEvent.fire(event);

      // Also forward to classic stream for backward-compatible session panel
      switch (event.type) {
        case 'message':
        case 'message_delta':
          this._onDidStreamEmitter.fire(event.content);
          break;
        case 'command':
          this._onDidStreamEmitter.fire(`\n▶ ${event.content}\n`);
          break;
        case 'result':
          this._onDidStreamEmitter.fire(`${event.content}\n`);
          break;
        case 'step':
          this._onDidStreamEmitter.fire(`⟳ ${event.label}\n`);
          break;
        case 'error':
          this._onDidStreamEmitter.fire(`⚠ ${event.content}\n`);
          break;
        case 'end':
          this._onDidStreamEmitter.fire(`\n[copilot-sdk] Session ended.\n`);
          break;
      }
    };

    emit({ type: 'start' });
    emit({ type: 'step', label: 'SDK client starting…' });

    // Use the .bin/copilot wrapper (has #!/usr/bin/env node shebang) instead of
    // relying on the SDK's default getBundledCliPath() which returns a .js file.
    // When cliPath ends with .js the SDK spawns it via process.execPath, which
    // inside VS Code is the Electron binary — not Node.js — causing argument errors.
    const copilotPkgDir = path.dirname(require.resolve('@github/copilot/package.json'));
    const copilotBin = path.join(copilotPkgDir, '..', '..', '.bin', 'copilot');

    const clientOpts: CopilotClientOptions = {
      cliPath: copilotBin,
    };
    this.client = new CopilotClient(clientOpts);
    await this.client.start();

    try {
      const cwd = worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const sessionConfig: SessionConfig = {
        model: this.model,
        streaming: true,
        onPermissionRequest: approveAll,
        ...(cwd ? { workingDirectory: cwd } : {}),
        ...(agentSlug ? { agent: agentSlug } : {}),
      };

      this.currentSession = await this.client.createSession(sessionConfig);
      const session = this.currentSession;
      emit({ type: 'step', label: 'Session ready' });

      // Wire up event handlers
      const done = new Promise<void>((resolve, _reject) => {
        session.on('assistant.message_delta', (event) => {
          emit({ type: 'message_delta', content: event.data.deltaContent ?? '' });
        });

        session.on('assistant.message', (event) => {
          emit({ type: 'message', content: event.data.content ?? '' });
        });

        session.on('tool.execution_start', (event) => {
          emit({ type: 'command', content: event.data.toolName ?? 'tool' });
        });

        session.on('tool.execution_complete', (event) => {
          const output = event.data.result ?? '';
          const content = typeof output === 'string' ? output : JSON.stringify(output);
          emit({ type: 'result', content });
        });

        session.on('session.idle', () => {
          resolve();
        });

        if (signal) {
          signal.addEventListener('abort', () => {
            session.abort().catch(() => {});
            resolve();
          }, { once: true });
        }
      });

      await session.send({ prompt });
      await done;
      emit({ type: 'end' });
    } catch (err) {
      const msg = formatError(err);
      this._onDidStreamEmitter.fire(`\n[copilot-sdk] Error: ${msg}\n`);
      throw err;
    } finally {
      this.abortController = undefined;
      if (this.currentSession) {
        try { await this.currentSession.disconnect(); } catch { /* ignore */ }
        this.currentSession = undefined;
      }
      if (this.client) {
        try { await this.client.stop(); } catch { /* ignore */ }
        this.client = undefined;
      }
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
      this._onDidStreamEmitter.fire('\n[copilot-sdk] Session cancelled.\n');
    }
    if (this.currentSession) {
      this.currentSession.abort().catch(() => {});
    }
  }

  dispose(): void {
    this.cancel();
    this._onDidStreamEmitter.dispose();
    this._onDidCopilotEvent.dispose();
  }
}
