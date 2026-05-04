import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { formatError } from '../../utils/errorUtils';
import { Logger } from '../../utils/logger';
import { buildOptimisationPrefix, isGitHubRepository } from '../copilotCliUtils';
import { GenAiProviderConfig, GenAiProviderScope, GenAiSettingDescriptor, IGenAiProvider } from '../IGenAiProvider';
import type { CopilotEvent } from './copilot-sdk/types';

/** Directory where the copilot CLI persists session state. */
const CLI_SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state');

/** GenAI provider that invokes the `copilot` CLI (`npm i -g @github/copilot`) as a background subprocess. */
export class CopilotCliGenAiProvider implements IGenAiProvider {
  readonly id = 'github-copilot';
  readonly displayName = 'GitHub Copilot';
  readonly description = 'GitHub Copilot CLI in terminal';
  readonly icon = 'terminal';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;
  readonly requiresGit = true;
  readonly handlesAgentNatively = true;

  private readonly logger = Logger.getInstance();
  private yolo: boolean;
  private fleet: boolean;
  private silent: boolean;
  private remote: boolean;
  private rubberDuck: boolean;
  private _proc: ChildProcess | undefined;
  private _resumeSessionId: string | undefined;
  private _lastSessionId: string | undefined;

  /** Pre-set the session ID for the next run (used on first launch). */
  setInitSessionId(id: string): void { this._resumeSessionId = id; }

  private readonly _onDidStreamEmitter = new vscode.EventEmitter<string>();
  readonly onDidStream: vscode.Event<string> = this._onDidStreamEmitter.event;

  private readonly _onDidCopilotEventEmitter = new vscode.EventEmitter<CopilotEvent>();
  readonly onDidCopilotEvent: vscode.Event<CopilotEvent> = this._onDidCopilotEventEmitter.event;

  constructor(config?: GenAiProviderConfig) {
    this.yolo       = (config?.yolo       as boolean | undefined) ?? true;
    this.fleet      = (config?.fleet      as boolean | undefined) ?? false;
    this.silent     = (config?.silent     as boolean | undefined) ?? true;
    this.remote     = (config?.remote     as boolean | undefined) ?? false;
    this.rubberDuck = (config?.rubberDuck as boolean | undefined) ?? false;
  }

  getSettingsDescriptors(): GenAiSettingDescriptor[] {
    return [
      { key: 'yolo', title: 'Yolo mode', description: 'Auto-approve all changes without confirmation', type: 'boolean', defaultValue: true },
      { key: 'fleet', title: 'Fleet mode', description: 'Optimise prompt for parallel fleet execution', type: 'boolean', defaultValue: false },
      { key: 'silent', title: 'Silent mode', description: 'Suppress interactive prompts and progress output', type: 'boolean', defaultValue: true },
      { key: 'remote', title: 'Remote mode', description: 'Run session against the remote GitHub repository (--remote; requires GitHub remote)', type: 'boolean', defaultValue: false },
      { key: 'rubberDuck', title: 'Rubber Duck mode', description: 'Use a second model family for a second opinion review (--rubber-duck)', type: 'boolean', defaultValue: false },
    ];
  }

  applyConfig(config: GenAiProviderConfig): void {
    if (config.yolo !== undefined)   { this.yolo   = Boolean(config.yolo); }
    if (config.fleet !== undefined)  { this.fleet  = Boolean(config.fleet); }
    if (config.silent     !== undefined) { this.silent     = Boolean(config.silent); }
    if (config.remote     !== undefined) { this.remote     = Boolean(config.remote); }
    if (config.rubberDuck !== undefined) { this.rubberDuck = Boolean(config.rubberDuck); }
  }

  /** Set-up a resume session ID so the next `run()` adds `--resume=<id>`. */
  setResumeSessionId(id: string): void { this._resumeSessionId = id; }

  /** The CLI session ID captured after the last run. */
  get lastSessionId(): string | undefined { return this._lastSessionId; }

  private static _shellEnv(): NodeJS.ProcessEnv {
    const PATH = process.env.PATH ?? '';
    const extra = ['/usr/local/bin', '/opt/homebrew/bin'].filter(p => !PATH.includes(p)).join(':');
    return { ...process.env, PATH: extra ? `${extra}:${PATH}` : PATH };
  }

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn('copilot', ['--version'], { stdio: 'pipe', env: CopilotCliGenAiProvider._shellEnv() });
      proc.on("close", code => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async run(prompt: string, _task?: KanbanTask, worktreePath?: string, agentSlug?: string): Promise<void> {
    const suffix = buildOptimisationPrefix(this.yolo, this.fleet);
    const fullPrompt = suffix ? `${prompt}\n\n${suffix}` : prompt;
    const cwd = worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const resumeId = this._resumeSessionId;
    this._resumeSessionId = undefined;

    // --remote is only supported for GitHub repositories.
    let useRemote = false;
    if (this.remote) {
      useRemote = cwd ? await isGitHubRepository(cwd) : false;
      if (!useRemote) {
        this._emit('[github-copilot] Warning: --remote ignorato — il workspace non è un repository GitHub.\n');
        this.logger.warn('CopilotCliGenAiProvider: --remote richiesto ma il workspace non è un repository GitHub; flag ignorato.');
      }
    }

    const resumeLabel = resumeId ? ` --resume=${resumeId}` : '';
    const flagParts: string[] = [];
    if (this.yolo) { flagParts.push('--allow-all', '--autopilot'); }
    if (this.silent) { flagParts.push('--silent'); }
    if (useRemote) { flagParts.push('--remote'); }
    if (this.rubberDuck) { flagParts.push('--rubber-duck'); }
    if (agentSlug) { flagParts.push('--agent', agentSlug); }
    const flags = flagParts.length ? ` ${flagParts.join(' ')}` : '';
    this._emit(`[github-copilot] Avvio: copilot${flags}${resumeLabel}\n`);
    this._onDidCopilotEventEmitter.fire({ type: 'start' });
    await this._spawnCopilot(fullPrompt, cwd, resumeId, useRemote, agentSlug);
  }

  cancel(): void {
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = undefined;
      this._emit('\n[github-copilot] Sessione annullata.\n');
      this._onDidCopilotEventEmitter.fire({ type: 'end' });
    }
  }

  dispose(): void { this.cancel(); this._onDidStreamEmitter.dispose(); this._onDidCopilotEventEmitter.dispose(); }

  private _emit(text: string): void { this._onDidStreamEmitter.fire(text); }

  private _spawnCopilot(prompt: string, cwd?: string, resumeId?: string, useRemote?: boolean, agentSlug?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args: string[] = [];
      if (resumeId) {
        args.push(`--resume=${resumeId}`);
      }
      if (agentSlug) {
        args.push('--agent', agentSlug);
      }
      args.push('-p', prompt);
      if (this.yolo) {
        args.push('--allow-all', '--autopilot');
      }
      if (this.silent) {
        args.push('--silent');
      }
      if (useRemote) {
        args.push('--remote');
      }
      if (this.rubberDuck) {
        args.push('--rubber-duck');
      }

      // Snapshot existing session IDs so we can diff after the process exits.
      const existingIds = CopilotCliGenAiProvider._listCliSessionIds();

      this.logger.info("CopilotCliGenAiProvider: spawning copilot %s (cwd=%s)", args.join(" "), cwd ?? ".");
      console.log(`[agent-board] copilot ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}  (cwd=${cwd ?? '.'})`);
      const proc = spawn('copilot', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...CopilotCliGenAiProvider._shellEnv(), NO_COLOR: '1' },
      });
      this._proc = proc;
      proc.stdout?.on("data", (chunk: Buffer) => {
        const t = chunk.toString("utf-8");
        this._emit(t);
        this._onDidCopilotEventEmitter.fire({ type: 'message_delta', content: t });
        this.logger.info("[github-copilot] %s", t.trimEnd());
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        const t = chunk.toString("utf-8");
        this._emit(t);
        this._onDidCopilotEventEmitter.fire({ type: 'error', content: t });
        this.logger.warn("[github-copilot] stderr: %s", t.trimEnd());
      });
      proc.on('close', (code) => {
        this._proc = undefined;
        // If we started with a known ID (init or resume), keep it.
        // Otherwise fall back to filesystem diffing to detect a newly created session.
        if (resumeId) {
          this._lastSessionId = resumeId;
        } else {
          this._lastSessionId = CopilotCliGenAiProvider._detectNewSessionId(existingIds);
        }
        if (this._lastSessionId) {
          this._emit(`[github-copilot] session-id: ${this._lastSessionId}\n`);
        }
        this._emit(`\n[github-copilot] exit ${code ?? 'null'}.\n`);
        this._onDidCopilotEventEmitter.fire({ type: 'end' });
        resolve();
      });
      proc.on("error", (err) => {
        this._proc = undefined;
        const msg = formatError(err);
        this._emit(`\n[github-copilot] Errore: ${msg}\nInstalla: npm install -g @github/copilot\n`);
        this.logger.error("CopilotCliGenAiProvider: %s", msg);
        reject(err);
      });
      proc.stdin?.end();
    });
  }

  /** List all existing CLI session IDs from `~/.copilot/session-state/`. */
  private static _listCliSessionIds(): Set<string> {
    try {
      return new Set(fs.readdirSync(CLI_SESSION_STATE_DIR));
    } catch {
      return new Set();
    }
  }

  /** Return the first session ID that appeared after the snapshot, or undefined. */
  private static _detectNewSessionId(before: Set<string>): string | undefined {
    const after = CopilotCliGenAiProvider._listCliSessionIds();
    for (const id of after) {
      if (!before.has(id)) { return id; }
    }
    return undefined;
  }
}
