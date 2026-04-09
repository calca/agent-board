import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { DiffWatcher } from '../diff/DiffWatcher';
import { GitHubIssueManager } from '../github/GitHubIssueManager';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { StreamRegistry } from '../stream/StreamController';
import { KanbanTask } from '../types/KanbanTask';
import { formatError } from '../utils/errorUtils';
import { Logger } from '../utils/logger';
import { AgentInfo, readAgentInstructions } from './agentDiscovery';
import { ContextBuilder } from './ContextBuilder';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';
import { SessionStateManager } from './SessionStateManager';
import { createWorktree, removeWorktree, WorktreeInfo } from './WorktreeManager';

/**
 * Entry point for launching a GenAI session with task context.
 *
 * Receives a `taskId` and a GenAI provider `id`, resolves the task
 * from the task registry, builds context via `ContextBuilder`, and
 * delegates to the matching `IGenAiProvider`.
 *
 * When the selected provider declares `supportsWorktree` and worktree
 * creation is enabled (default), a git worktree is created before the
 * provider runs so it can operate on an isolated branch.
 */
export const AGENT_PROMPT_PREFIX = (name: string, instructions: string): string =>
  `## Agent: ${name}\n\n${instructions}\n\n---\n\n`;

export class CopilotLauncher {
  private readonly logger = Logger.getInstance();
  private readonly streamRegistry = new StreamRegistry();
  private readonly diffWatchers = new Map<string, DiffWatcher>();
  /** Tracks the provider currently running for a given taskId (for cancellation). */
  private readonly activeProviders = new Map<string, import('./IGenAiProvider').IGenAiProvider>();

  private readonly _onDidChangeDiff = new vscode.EventEmitter<{
    sessionId: string;
    files: import('../diff/DiffWatcher').FileChange[];
  }>();
  /** Fires whenever a DiffWatcher reports changed files for any session. */
  readonly onDidChangeDiff = this._onDidChangeDiff.event;

  private readonly _onDidToolCall = new vscode.EventEmitter<{ sessionId: string; status: string }>();
  /** Fires whenever a tool call is in progress for any session. */
  readonly onDidToolCall = this._onDidToolCall.event;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context: vscode.ExtensionContext,
    private readonly genAiRegistry: GenAiProviderRegistry,
    private agents: AgentInfo[] = [],
    private readonly ghIssueManager?: GitHubIssueManager,
    private sessionStateManager?: SessionStateManager,
  ) {}

  /** Inject (or replace) the SessionStateManager after construction. */
  setSessionStateManager(mgr: SessionStateManager): void {
    this.sessionStateManager = mgr;
  }

  /**
   * Read the persisted log file for a session, if it exists.
   * Returns `undefined` if no log file was recorded or the file was deleted.
   */
  readPersistedLog(sessionId: string): string | undefined {
    const logPath = this.sessionStateManager?.getSession(sessionId)?.logPath;
    if (!logPath) { return undefined; }
    try {
      return fs.readFileSync(logPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /** The shared stream registry (used by KanbanPanel for real-time output). */
  getStreamRegistry(): StreamRegistry {
    return this.streamRegistry;
  }

  /** Get the DiffWatcher for a session, if any. */
  getDiffWatcher(sessionId: string): DiffWatcher | undefined {
    return this.diffWatchers.get(sessionId);
  }

  /** Cancel the running provider for a task, if any. */
  cancelSession(taskId: string): void {
    const provider = this.activeProviders.get(taskId);
    if (provider?.cancel) {
      provider.cancel();
      this.logger.info(`CopilotLauncher: cancelled session for task ${taskId}`);
    }
  }

  /**
   * Send a follow-up message to the active provider for a task.
   * Only works when the provider supports `sendFollowUp` (e.g. copilot-lm).
   */
  async sendFollowUp(taskId: string, text: string): Promise<void> {
    const provider = this.activeProviders.get(taskId);
    if (!provider?.sendFollowUp) {
      // Provider not running or doesn't support multi-turn — fall back quietly
      this.logger.warn(`CopilotLauncher: sendFollowUp not available for task ${taskId}`);
      return;
    }
    await provider.sendFollowUp(text);
  }

  /** Update the cached list of discovered agents. */
  setAgents(agents: AgentInfo[]): void {
    this.agents = agents;
  }

  async launch(taskId: string, providerId: string, agentSlug?: string, promptOverride?: string): Promise<void> {
    this.logger.info(`CopilotLauncher: launching provider "${providerId}" for task ${taskId}${agentSlug ? ` with agent "${agentSlug}"` : ''}`);

    const provider = this.genAiRegistry.get(providerId);
    if (!provider) {
      vscode.window.showErrorMessage(`GenAI provider "${providerId}" not found.`);
      return;
    }

    const task = await this.resolveTask(taskId);
    if (!task) {
      vscode.window.showErrorMessage(`Task "${taskId}" not found.`);
      return;
    }

    // ── Worktree support ──────────────────────────────────────────────
    let worktree: WorktreeInfo | undefined;
    if (provider.supportsWorktree && this.isWorktreeEnabled(provider.id)) {
      try {
        worktree = await this.tryCreateWorktree(taskId);
      } catch (wtErr) {
        const errMsg = formatError(wtErr);
        this.sessionStateManager?.startSession(taskId, providerId, undefined, undefined);
        this.sessionStateManager?.markError(taskId, `Worktree creation failed: ${errMsg}`);
        vscode.window.showErrorMessage(`Worktree creation failed: ${errMsg}`);
        return;
      }
    }

    let prompt = promptOverride ?? ContextBuilder.build(task);

    // ── Compute log path for persistence ─────────────────────────────
    const logPath = this.computeLogPath(taskId);

    // ── Register session in SessionStateManager ───────────────────────
    this.sessionStateManager?.startSession(taskId, providerId, worktree?.path, logPath);

    // ── Agent instructions ────────────────────────────────────────────
    if (agentSlug) {
      const agentInfo = this.agents.find(a => a.slug === agentSlug);
      if (agentInfo) {
        const instructions = readAgentInstructions(agentInfo.filePath);
        if (instructions) {
          prompt = AGENT_PROMPT_PREFIX(agentInfo.displayName, instructions) + prompt;
        }
      }
    }

    if (worktree) {
      this.logger.info(`CopilotLauncher: worktree ready at ${worktree.path} (branch ${worktree.branch})`);
    }

    // ── Stream + DiffWatcher ──────────────────────────────────────────
    const stream = this.streamRegistry.getOrCreate(taskId);
    // Wire provider streaming → StreamController so output flows to the webview
    const streamSub = provider.onDidStream?.((text: string) => stream.append(text));
    // Wire tool-call events → onDidToolCall aggregate event
    const toolCallSub = provider.onDidToolCall?.(status => this._onDidToolCall.fire({ sessionId: taskId, status }));

    const watchRoot = worktree?.path ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let dwSub: vscode.Disposable | undefined;
    if (watchRoot) {
      // When running in a worktree the agent may commit its changes, so we diff
      // against `main` (the parent branch) instead of `HEAD` to keep seeing them.
      const baseRef = worktree ? 'main' : 'HEAD';
      const dw = new DiffWatcher(watchRoot, baseRef);
      this.diffWatchers.set(taskId, dw);
      dwSub = dw.onDidChange(files => this._onDidChangeDiff.fire({ sessionId: taskId, files }));
      // Emit initial state
      void dw.refresh();
    }

    this.sessionStateManager?.markRunning(taskId);
    this.activeProviders.set(taskId, provider);
    let sessionSucceeded = false;
    let sessionError: string | undefined;
    try {
      await provider.run(prompt, task, worktree?.path);
      sessionSucceeded = true;
    } catch (runErr) {
      sessionError = formatError(runErr);
    } finally {
      streamSub?.dispose();
      toolCallSub?.dispose();
      dwSub?.dispose();
      this.activeProviders.delete(taskId);

      // ── Flush stream log to disk for restart recovery ─────────────
      this.flushLogToDisk(taskId, logPath);

      // ── Auto-commit worktree changes ────────────────────────────
      if (worktree) {
        await this.autoCommitWorktree(worktree.path, task.title, sessionSucceeded);
      }

      // ── Update session state ──────────────────────────────────────
      if (sessionSucceeded) {
        this.sessionStateManager?.markCompleted(taskId);
      } else {
        this.sessionStateManager?.markError(taskId, sessionError);
      }

      // ── Post agent-summary comment on GitHub issue (3.3) ─────────
      if (sessionSucceeded && this.ghIssueManager) {
        const shouldPost = ProjectConfig.getProjectConfig()?.postAgentSummaryToIssue
          ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('postAgentSummaryToIssue', false);
        if (shouldPost && task.providerId === 'github') {
          const issueNumber = parseInt(task.id.split(':')[1] ?? '', 10);
          if (!isNaN(issueNumber)) {
            const changedFiles = this.diffWatchers.get(taskId)?.getChanges() ?? [];
            const stream = this.streamRegistry.get(taskId);
            // Last 50 lines of stream output as a trimmed summary
            const logLines = stream?.exportLog().trim().split('\n') ?? [];
            const streamSummary = logLines.slice(-50).join('\n');
            const agentName = agentSlug ?? 'Agent Board';
            const markdown = this.ghIssueManager.buildAgentSummaryMarkdown({
              agentName,
              issueTitle: task.title,
              changedFiles,
              prUrl: task.copilotSession?.prUrl,
              streamSummary: streamSummary || undefined,
            });
            void this.ghIssueManager.postAgentSummaryComment(issueNumber, markdown)
              .catch(e => this.logger.warn('CopilotLauncher: failed to post summary comment:', e));
          }
        }
      }

      // Worktree cleanup is disabled by default: the worktree is kept so the
      // next session can reuse the same branch and working directory.
      // Set `worktree.confirmCleanup: true` in config to re-enable cleanup.
      if (worktree) {
        this.logger.info(`CopilotLauncher: worktree kept for reuse at ${worktree.path}`);
      }
      // Cleanup diff watcher (stream kept until explicit removal)
      const dw = this.diffWatchers.get(taskId);
      if (dw) {
        dw.dispose();
        this.diffWatchers.delete(taskId);
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Optionally confirm with the user before removing the worktree.
   * Controlled by `worktree.confirmCleanup` in the project config.
   */
  private async tryCleanupWorktree(taskId: string, worktreePath: string): Promise<void> {
    const projectCfg = ProjectConfig.getProjectConfig();
    const confirm = projectCfg?.worktree?.confirmCleanup
      ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('worktree.confirmCleanup', false);

    if (confirm) {
      const answer = await vscode.window.showInformationMessage(
        `Session complete. Remove worktree at:\n${worktreePath}?`,
        { modal: true },
        'Remove',
        'Keep',
      );
      if (answer !== 'Remove') {
        this.logger.info(`CopilotLauncher: worktree kept at ${worktreePath} (user chose to keep)`);
        return;
      }
    }

    await this.tryRemoveWorktree(taskId);
  }

  private async tryRemoveWorktree(taskId: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }
    const repoRoot = folders[0].uri.fsPath;
    try {
      await removeWorktree(repoRoot, taskId);
      this.logger.info(`CopilotLauncher: worktree removed for task ${taskId}`);
    } catch (err) {
      this.logger.error('CopilotLauncher: worktree removal failed:', formatError(err));
    }
  }

  private isWorktreeEnabled(providerId?: string): boolean {
    const projectCfg = ProjectConfig.getProjectConfig();
    const fileValue = projectCfg?.worktree?.enabled;
    if (fileValue !== undefined) {
      return fileValue;
    }
    const settingValue = vscode.workspace
      .getConfiguration('agentBoard')
      .get<boolean>('worktree.enabled');
    return settingValue ?? true;
  }

  private async tryCreateWorktree(taskId: string): Promise<WorktreeInfo | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }

    const repoRoot = folders[0].uri.fsPath;
    const info = await createWorktree(repoRoot, taskId);
    if (info) {
      this.logger.info(
        `CopilotLauncher: worktree created at ${info.path} (branch: ${info.branch})`,
      );
    }
    return info;
  }

  /**
   * Auto-commit all changes in the worktree with an auto-generated message.
   * Silently skips if there is nothing to commit.
   */
  private async autoCommitWorktree(wtPath: string, taskTitle: string, succeeded: boolean): Promise<void> {
    try {
      // Check if there are any changes to commit
      const statusOut = await this.git(wtPath, ['status', '--porcelain']);
      if (!statusOut.trim()) {
        this.logger.info('CopilotLauncher: autoCommit — nothing to commit in %s', wtPath);
        return;
      }

      await this.git(wtPath, ['add', '-A']);

      // Build a descriptive commit message
      const diffStat = await this.git(wtPath, ['diff', '--cached', '--stat', '--no-color']);
      const fileCount = diffStat.trim().split('\n').length - 1; // last line is summary
      const status = succeeded ? 'done' : 'wip';
      const msg = `agent(${status}): ${taskTitle}\n\n${fileCount > 0 ? diffStat.trim() : 'Auto-commit by Agent Board'}`;

      await this.git(wtPath, ['commit', '-m', msg, '--no-verify']);
      this.logger.info('CopilotLauncher: autoCommit — committed in %s', wtPath);
    } catch (err) {
      // Non-fatal: log and move on
      this.logger.warn('CopilotLauncher: autoCommit failed: %s', formatError(err));
    }
  }

  /** Run a git command in the given directory. */
  private git(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) { reject(new Error(stderr?.trim() || err.message)); }
        else { resolve(stdout); }
      });
    });
  }

  private async resolveTask(taskId: string): Promise<KanbanTask | undefined> {
    const [providerId] = taskId.split(':');
    const provider = this.registry.get(providerId);
    if (!provider) {
      return undefined;
    }
    const tasks = await provider.getTasks();
    return tasks.find(t => t.id === taskId);
  }

  // ── Log persistence ─────────────────────────────────────────────────

  /**
   * Compute the path where the stream log for a session will be stored.
   * Returns `undefined` if `context.storageUri` is not available.
   */
  private computeLogPath(taskId: string): string | undefined {
    const storageUri = this.context.storageUri;
    if (!storageUri) { return undefined; }
    const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(storageUri.fsPath, 'logs', `${safeId}.log`);
  }

  /**
   * Write the current in-memory stream buffer to `logPath`.
   * Called in the `finally` block of `launch()`.
   */
  private flushLogToDisk(taskId: string, logPath: string | undefined): void {
    if (!logPath) { return; }
    try {
      const content = this.streamRegistry.get(taskId)?.exportLog();
      if (!content) { return; }
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, content, 'utf-8');
      this.logger.info(`CopilotLauncher: log saved to ${logPath}`);
    } catch (err) {
      this.logger.warn('CopilotLauncher: failed to flush log:', formatError(err));
    }
  }
}
