import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { formatError } from '../../utils/errorUtils';
import { Logger } from '../../utils/logger';
import { buildOptimisationPrefix } from '../copilotCliUtils';
import { GenAiProviderConfig, GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/** GenAI provider that invokes the `copilot` CLI (`npm i -g @github/copilot`) as a background subprocess. */
export class CopilotCliGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-cli';
  readonly displayName = 'Copilot CLI';
  readonly icon = 'terminal';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;

  private readonly logger = Logger.getInstance();
  private readonly yolo: boolean;
  private readonly fleet: boolean;
  private _proc: ChildProcess | undefined;

  private readonly _onDidStreamEmitter = new vscode.EventEmitter<string>();
  readonly onDidStream: vscode.Event<string> = this._onDidStreamEmitter.event;

  constructor(config?: GenAiProviderConfig) {
    this.yolo   = config?.yolo   ?? true;
    this.fleet  = config?.fleet  ?? false;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn('copilot', ['--version'], { stdio: 'pipe' });
      proc.on("close", code => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async run(prompt: string, _task?: KanbanTask, worktreePath?: string): Promise<void> {
    const suffix = buildOptimisationPrefix(this.yolo, this.fleet);
    const fullPrompt = suffix ? `${prompt}\n\n${suffix}` : prompt;
    const cwd = worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const flags = this.yolo ? ' --allow-all --autopilot' : '';
    this._emit(`[copilot-cli] Avvio: copilot${flags}\n`);
    await this._spawnCopilot(fullPrompt, cwd);
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

  private _spawnCopilot(prompt: string, cwd?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = ['-p', prompt];
      if (this.yolo) {
        args.push('--allow-all', '--autopilot');
      }
      this.logger.info("CopilotCliGenAiProvider: spawning copilot %s (cwd=%s)", args.join(" "), cwd ?? ".");
      console.log(`[agent-board] copilot ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}  (cwd=${cwd ?? '.'})`);
      const proc = spawn('copilot', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      });
      this._proc = proc;
      proc.stdout?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.info("[copilot-cli] %s", t.trimEnd()); });
      proc.stderr?.on("data", (chunk: Buffer) => { const t = chunk.toString("utf-8"); this._emit(t); this.logger.warn("[copilot-cli] stderr: %s", t.trimEnd()); });
      proc.on('close', (code) => { this._proc = undefined; this._emit(`\n[copilot-cli] exit ${code ?? 'null'}.\n`); resolve(); });
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
}
