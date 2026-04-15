import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { formatError } from '../../utils/errorUtils';
import { Logger } from '../../utils/logger';
import { buildOptimisationPrefix, isGitHubRepository } from '../copilotCliUtils';
import { GenAiProviderConfig, GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/** Directory where the copilot CLI persists session state. */
const CLI_SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state');

/** GenAI provider that invokes the `copilot` CLI (`npm i -g @github/copilot`) as a background subprocess. */
export class CopilotCliGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-cli';
  readonly displayName = 'Copilot - cli';
  readonly icon = 'terminal';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;

  private readonly logger = Logger.getInstance();
  private readonly yolo: boolean;
  private readonly fleet: boolean;
  private readonly remote: boolean;
  private readonly rubberDuck: boolean;
  private _proc: ChildProcess | undefined;
  private _resumeSessionId: string | undefined;
  private _lastSessionId: string | undefined;

  private readonly _onDidStreamEmitter = new vscode.EventEmitter<string>();
  readonly onDidStream: vscode.Event<string> = this._onDidStreamEmitter.event;

  constructor(config?: GenAiProviderConfig) {
    this.yolo       = config?.yolo       ?? true;
    this.fleet      = config?.fleet      ?? false;
    this.remote     = config?.remote     ?? false;
    this.rubberDuck = config?.rubberDuck ?? false;
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

    // --remote is only supported for GitHub repositories.
    let useRemote = false;
    if (this.remote) {
      useRemote = cwd ? await isGitHubRepository(cwd) : false;
      if (!useRemote) {
        this._emit('[copilot-cli] Warning: --remote ignorato — il workspace non è un repository GitHub.\n');
        this.logger.warn('CopilotCliGenAiProvider: --remote richiesto ma il workspace non è un repository GitHub; flag ignorato.');
      }
    }

    const resumeLabel = resumeId ? ` --resume=${resumeId}` : '';
    const flagParts = [
      ...(this.yolo ? ['--allow-all', '--autopilot'] : []),
      ...(useRemote ? ['--remote'] : []),
      ...(this.rubberDuck ? ['--rubber-duck'] : []),
    ];
    const flags = flagParts.length > 0 ? ` ${flagParts.join(' ')}` : '';
    this._emit(`[copilot-cli] Avvio: copilot${flags}${resumeLabel}\n`);
    await this._spawnCopilot(fullPrompt, cwd, resumeId, useRemote, this.rubberDuck);
  }

  cancel(): void {
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = undefined;
      this._emit('\n[copilot-cli] Sessione annullata.\n');
    }
  }

  dispose(): void { this.cancel(); this._onDidStreamEmitter.dispose(); }

  private _emit(text: string): void { this._onDidStreamEmitter.fire(text); }

  private _spawnCopilot(prompt: string, cwd?: string, resumeId?: string, useRemote?: boolean, useRubberDuck?: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args: string[] = [];
      if (resumeId) {
        args.push(`--resume=${resumeId}`);
      }
      args.push('-p', prompt);
      if (this.yolo) {
        args.push('--allow-all', '--autopilot');
      }
      if (useRemote) {
        args.push('--remote');
      }
      if (useRubberDuck) {
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
      proc.stdout?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.info("[copilot-cli] %s", t.trimEnd()); });
      proc.stderr?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.warn("[copilot-cli] stderr: %s", t.trimEnd()); });
      proc.on('close', (code) => {
        this._proc = undefined;
        // Detect the CLI session ID created during this run.
        this._lastSessionId = resumeId ?? CopilotCliGenAiProvider._detectNewSessionId(existingIds);
        if (this._lastSessionId) {
          this._emit(`[copilot-cli] session-id: ${this._lastSessionId}\n`);
        }
        this._emit(`\n[copilot-cli] exit ${code ?? 'null'}.\n`);
        resolve();
      });
      proc.on("error", (err) => {
        this._proc = undefined;
        const msg = formatError(err);
        this._emit(`\n[copilot-cli] Errore: ${msg}\nInstalla: npm install -g @github/copilot\n`);
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
