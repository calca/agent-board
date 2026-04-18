import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { formatError } from '../../utils/errorUtils';
import { Logger } from '../../utils/logger';
import { buildOptimisationPrefix } from '../copilotCliUtils';
import { GenAiProviderConfig, GenAiProviderScope, GenAiSettingDescriptor, IGenAiProvider } from '../IGenAiProvider';

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

  private readonly logger = Logger.getInstance();
  private yolo: boolean;
  private fleet: boolean;
  private silent: boolean;
  private _proc: ChildProcess | undefined;
  private _resumeSessionId: string | undefined;
  private _lastSessionId: string | undefined;

  private readonly _onDidStreamEmitter = new vscode.EventEmitter<string>();
  readonly onDidStream: vscode.Event<string> = this._onDidStreamEmitter.event;

  constructor(config?: GenAiProviderConfig) {
    this.yolo   = (config?.yolo   as boolean | undefined) ?? true;
    this.fleet  = (config?.fleet  as boolean | undefined) ?? false;
    this.silent = (config?.silent as boolean | undefined) ?? true;
  }

  getSettingsDescriptors(): GenAiSettingDescriptor[] {
    return [
      { key: 'yolo', title: 'Yolo mode', description: 'Auto-approve all changes without confirmation', type: 'boolean', defaultValue: true },
      { key: 'fleet', title: 'Fleet mode', description: 'Optimise prompt for parallel fleet execution', type: 'boolean', defaultValue: false },
      { key: 'silent', title: 'Silent mode', description: 'Suppress interactive prompts and progress output', type: 'boolean', defaultValue: true },
    ];
  }

  applyConfig(config: GenAiProviderConfig): void {
    if (config.yolo !== undefined)   { this.yolo   = Boolean(config.yolo); }
    if (config.fleet !== undefined)  { this.fleet  = Boolean(config.fleet); }
    if (config.silent !== undefined) { this.silent = Boolean(config.silent); }
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

  async run(prompt: string, _task?: KanbanTask, worktreePath?: string): Promise<void> {
    const suffix = buildOptimisationPrefix(this.yolo, this.fleet);
    const fullPrompt = suffix ? `${prompt}\n\n${suffix}` : prompt;
    const cwd = worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const resumeId = this._resumeSessionId;
    this._resumeSessionId = undefined;
    const resumeLabel = resumeId ? ` --resume=${resumeId}` : '';
    const flagParts: string[] = [];
    if (this.yolo) { flagParts.push('--allow-all', '--autopilot'); }
    if (this.silent) { flagParts.push('--silent'); }
    const flags = flagParts.length ? ` ${flagParts.join(' ')}` : '';
    this._emit(`[github-copilot] Avvio: copilot${flags}${resumeLabel}\n`);
    await this._spawnCopilot(fullPrompt, cwd, resumeId);
  }

  cancel(): void {
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = undefined;
      this._emit('\n[github-copilot] Sessione annullata.\n');
    }
  }

  dispose(): void { this.cancel(); this._onDidStreamEmitter.dispose(); }

  private _emit(text: string): void { this._onDidStreamEmitter.fire(text); }

  private _spawnCopilot(prompt: string, cwd?: string, resumeId?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args: string[] = [];
      if (resumeId) {
        args.push(`--resume=${resumeId}`);
      }
      args.push('-p', prompt);
      if (this.yolo) {
        args.push('--allow-all', '--autopilot');
      }
      if (this.silent) {
        args.push('--silent');
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
      proc.stdout?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.info("[github-copilot] %s", t.trimEnd()); });
      proc.stderr?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.warn("[github-copilot] stderr: %s", t.trimEnd()); });
      proc.on('close', (code) => {
        this._proc = undefined;
        // Detect the CLI session ID created during this run.
        this._lastSessionId = resumeId ?? CopilotCliGenAiProvider._detectNewSessionId(existingIds);
        if (this._lastSessionId) {
          this._emit(`[github-copilot] session-id: ${this._lastSessionId}\n`);
        }
        this._emit(`\n[github-copilot] exit ${code ?? 'null'}.\n`);
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
