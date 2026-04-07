import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { formatError } from '../../utils/errorUtils';
import { Logger } from '../../utils/logger';
import { buildOptimisationPrefix } from '../copilotCliUtils';
import { GenAiProviderConfig, GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/** GenAI provider that invokes `gh copilot suggest` as a background subprocess. */
export class CopilotCliGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-cli';
  readonly displayName = 'Copilot CLI';
  readonly icon = 'terminal';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;

  private readonly logger = Logger.getInstance();
  private readonly yolo: boolean;
  private readonly fleet: boolean;
  private readonly target: string;
  private _proc: ChildProcess | undefined;

  private readonly _onDidStreamEmitter = new vscode.EventEmitter<string>();
  readonly onDidStream: vscode.Event<string> = this._onDidStreamEmitter.event;

  constructor(config?: GenAiProviderConfig & { target?: string }) {
    this.yolo   = config?.yolo   ?? true;
    this.fleet  = config?.fleet  ?? false;
    this.target = (config as { target?: string } | undefined)?.target ?? 'shell';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn('gh', ['copilot', '--version'], { stdio: 'pipe' });
      proc.on("close", code => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async run(prompt: string, _task?: KanbanTask, worktreePath?: string): Promise<void> {
    const prefix = buildOptimisationPrefix(this.yolo, this.fleet);
    const fullPrompt = prefix ? `${prefix}\n${prompt}` : prompt;
    const cwd = worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._emit(`[copilot-cli] Avvio: gh copilot suggest --target ${this.target}\n`);
    await this._spawnSuggest(fullPrompt, cwd);
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

  private _spawnSuggest(prompt: string, cwd?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = ['copilot', 'suggest', '--target', this.target, prompt];
      this.logger.info("CopilotCliGenAiProvider: spawning gh %s (cwd=%s)", args.join(" "), cwd ?? ".");
      const proc = spawn('gh', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1' },
      });
      this._proc = proc;
      proc.stdout?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.info("[copilot-cli] %s", t.trimEnd()); });
      proc.stderr?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.warn("[copilot-cli] stderr: %s", t.trimEnd()); });
      proc.on('close', (code) => { this._proc = undefined; this._emit(`\n[copilot-cli] exit ${code ?? 'null'}.\n`); resolve(); });
      proc.on("error", (err) => {
        this._proc = undefined;
        const msg = formatError(err);
        this._emit(`\n[copilot-cli] Errore: ${msg}\nInstalla: brew install gh && gh extension install github/gh-copilot\n`);
        this.logger.error("CopilotCliGenAiProvider: %s", msg);
        reject(err);
      });
      proc.stdin?.end();
    });
  }
}
