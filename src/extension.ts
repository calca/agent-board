import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { AgentsTreeProvider, AgentTreeItem } from './agentsTreeProvider';
import { refreshTasksCommand } from './commands/refreshTasks';
import { ProjectConfig } from './config/ProjectConfig';
import { AgentInfo, discoverAgents } from './copilot/agentDiscovery';
import { registerChatParticipant } from './copilot/ChatParticipant';
import { CopilotLauncher } from './copilot/CopilotLauncher';
import { GenAiProviderRegistry } from './copilot/GenAiProviderRegistry';
import { ModelSelector } from './copilot/ModelSelector';
import { ChatGenAiProvider } from './copilot/providers/ChatGenAiProvider';
import { CloudGenAiProvider } from './copilot/providers/CloudGenAiProvider';
import { CopilotCliGenAiProvider } from './copilot/providers/CopilotCliGenAiProvider';
import { LmApiGenAiProvider } from './copilot/providers/LmApiGenAiProvider';
import { SessionStateManager } from './copilot/SessionStateManager';
import { SquadManager } from './copilot/SquadManager';
import { removeWorktree } from './copilot/WorktreeManager';
import { GIT_REF_SCHEME, GitRefContentProvider, gitRefUri } from './diff/DiffWatcher';
import { GitHubIssueManager } from './github/GitHubIssueManager';
import { PullRequestManager } from './github/PullRequestManager';
import { KanbanPanel } from './kanban/KanbanPanel';
import { OverviewTreeProvider } from './overviewTreeProvider';
import { AzureDevOpsProvider } from './providers/AzureDevOpsProvider';
import { BeadsProvider } from './providers/BeadsProvider';
import { GitHubProvider } from './providers/GitHubProvider';
import { ITaskProvider } from './providers/ITaskProvider';
import { JsonProvider } from './providers/JsonProvider';
import { MarkdownProvider } from './providers/MarkdownProvider';
import { ProviderPicker } from './providers/ProviderPicker';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { SettingsPanel } from './settings/SettingsPanel';
import { TaskStore } from './taskStore';
import { TaskTreeItem } from './tasksTreeProvider';
import { COLUMN_IDS, COLUMN_LABELS, DEFAULT_COLUMN_COLORS } from './types/ColumnId';
import { AgentOption, GenAiProviderOption } from './types/Messages';
import { Logger } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
  const logger = Logger.getInstance();
  logger.info('Agent Board activating…');

  // ── Provider infrastructure ────────────────────────────────────────────

  const providerRegistry = new ProviderRegistry();
  const providerPicker = new ProviderPicker(providerRegistry, context);

  // GitHub service layer (labels, polling, avatars, comments)
  const ghIssueManager = new GitHubIssueManager();
  const prManager = new PullRequestManager();
  context.subscriptions.push(ghIssueManager);

  // Register custom git-ref content provider for diff views
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_REF_SCHEME, new GitRefContentProvider()),
  );

  // Register ALL task providers — disabled ones are filtered at query time
  // so the Settings panel can always show and enable/disable them.
  const githubProvider = new GitHubProvider(context, ghIssueManager);
  providerRegistry.register(githubProvider);

  const beadsProvider = new BeadsProvider();
  providerRegistry.register(beadsProvider);

  const azureDevOpsProvider = new AzureDevOpsProvider();
  providerRegistry.register(azureDevOpsProvider);

  // ── GenAI provider infrastructure ─────────────────────────────────────

  const genAiRegistry = new GenAiProviderRegistry();

  // Global providers (VS Code integrated) — always registered
  genAiRegistry.register(new ChatGenAiProvider());
  genAiRegistry.register(new CloudGenAiProvider());
  const copilotLmCfg = ProjectConfig.getProjectConfig()?.genAiProviders?.['copilot-lm'];
  const lmYolo = copilotLmCfg?.yolo ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('copilotCli.yolo', true);
  genAiRegistry.register(new LmApiGenAiProvider({
    yolo: lmYolo,
    autopilot: lmYolo,
  }));

  // Copilot CLI — pass per-project config (yolo / fleet), falling back to VS Code settings
  const copilotCliCfg = ProjectConfig.getProjectConfig()?.genAiProviders?.['copilot-cli'];
  const copilotCliConfig = {
    ...copilotCliCfg,
    yolo: copilotCliCfg?.yolo ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('copilotCli.yolo', true),
    fleet: copilotCliCfg?.fleet ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('copilotCli.fleet', false),
  };
  genAiRegistry.register(new CopilotCliGenAiProvider(copilotCliConfig));

  // ── Copilot infrastructure ─────────────────────────────────────────────

  // SessionStateManager is created first so it can be passed to CopilotLauncher
  // and restore interrupted sessions before the kanban panel opens.
  const sessionStateManager = new SessionStateManager(context);

  const copilotLauncher = new CopilotLauncher(providerRegistry, context, genAiRegistry, [], ghIssueManager, sessionStateManager);
  const modelSelector = new ModelSelector(context, genAiRegistry);
  const squadManager = new SquadManager(
    providerRegistry,
    copilotLauncher,
    () => modelSelector.getProviderId(),
    genAiRegistry,
  );

  // Wire session state changes → refresh overview + kanban
  sessionStateManager.onDidChangeState(({ taskId, state }) => {
    logger.info('SessionState changed: %s → %s', taskId, state);
    overviewProvider.refresh();
  });

  // Restore any sessions that were interrupted when VS Code was last closed.
  // Inject them into SquadManager so they appear on the kanban board.
  for (const s of sessionStateManager.getInterruptedSessions()) {
    squadManager.restoreInterruptedSession(s.taskId, {
      state: 'interrupted',
      providerId: s.providerId,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    });
    logger.info('Restored interrupted session for task %s', s.taskId);
  }

  // ── Agent discovery ────────────────────────────────────────────────────

  let discoveredAgents: AgentInfo[] = [];
  const agentOptions = (): AgentOption[] =>
    discoveredAgents.map(a => ({ slug: a.slug, displayName: a.displayName, canSquad: a.canSquad }));

  function refreshAgents(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      discoveredAgents = discoverAgents(folders[0].uri.fsPath);
      copilotLauncher.setAgents(discoveredAgents);
      logger.info('Agent discovery: found %d agent(s)', discoveredAgents.length);
    }
  }

  refreshAgents();

  // Register @taskai chat participant (gracefully skipped if API unavailable)
  const chatParticipant = registerChatParticipant(context, providerRegistry);

  // Re-read log level when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agentBoard.logLevel')) {
        logger.refreshLevel();
      }
    }),
  );

  // ── Internal stores ────────────────────────────────────────────────────

  const taskStore = new TaskStore(context);
  const agentManager = new AgentManager(context, taskStore);

  // JSON-backed task provider — always registered, persists to .agent-board/tasks.json
  const jsonProvider = new JsonProvider();
  providerRegistry.register(jsonProvider);

  // Markdown-backed task provider — opt-in; reads .md files from a configurable inbox directory
  const markdownProvider = new MarkdownProvider();
  if (markdownProvider.isEnabled()) {
    providerRegistry.register(markdownProvider);
  } else {
    context.subscriptions.push({ dispose: () => markdownProvider.dispose() });
  }

  // Overview sidebar view
  const overviewProvider = new OverviewTreeProvider(providerRegistry, squadManager);

  const overviewView = vscode.window.createTreeView('agentBoardOverview', {
    treeDataProvider: overviewProvider,
    showCollapseAll: false,
  });

  // Keep old providers for internal use (agents, task store)
  const agentsProvider = new AgentsTreeProvider(agentManager);

  // Status bar item showing pending task count
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'agentBoard.openKanban';
  void updateStatusBar(statusBarItem, jsonProvider);
  statusBarItem.show();

  function refresh(): void {
    overviewProvider.refresh();
    agentsProvider.refresh();
    void updateStatusBar(statusBarItem, jsonProvider);
  }

  // Auto-refresh overview when squad status changes
  squadManager.onDidChangeStatus(() => {
    overviewProvider.refresh();
    modelSelector.updateSquadStatus(squadManager.getStatus());
  });

  // ── WebView panel serializer ───────────────────────────────────────────

  vscode.window.registerWebviewPanelSerializer(
    KanbanPanel.viewType,
    KanbanPanel.getSerializer(context.extensionUri),
  );

  // ── Commands ───────────────────────────────────────────────────────────

  const addTask = vscode.commands.registerCommand('agentBoard.addTask', async () => {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showWarningMessage(
        'Agent Board: please open a folder or workspace before adding tasks.',
        'Open Folder'
      ).then(selection => {
        if (selection === 'Open Folder') {
          vscode.commands.executeCommand('vscode.openFolder');
        }
      });
      return;
    }
    const title = await vscode.window.showInputBox({
      prompt: 'Task title',
      placeHolder: 'What needs to be done?',
      validateInput: v => (v.trim() ? undefined : 'Title cannot be empty'),
    });
    if (!title) {
      return;
    }
    const description = await vscode.window.showInputBox({
      prompt: 'Task description (optional)',
      placeHolder: 'Add more details…',
    });
    await jsonProvider.createTask(title.trim(), description?.trim() || undefined);
    refresh();
    const activePanel = KanbanPanel.getInstance();
    if (activePanel) {
      await sendTasksToPanel(activePanel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
    }
    vscode.window.showInformationMessage(`Task "${title}" added.`);
  });

  const editTask = vscode.commands.registerCommand('agentBoard.editTask', async (item?: TaskTreeItem) => {
    const task = item?.task ?? (await pickTask(jsonProvider));
    if (!task) {
      return;
    }
    const newTitle = await vscode.window.showInputBox({
      prompt: 'Edit task title',
      value: task.title,
      validateInput: v => (v.trim() ? undefined : 'Title cannot be empty'),
    });
    if (!newTitle) {
      return;
    }
    const newDesc = await vscode.window.showInputBox({
      prompt: 'Edit task description (optional)',
      value: task.body ?? '',
    });
    await jsonProvider.updateTask({ ...task, title: newTitle.trim(), body: newDesc?.trim() ?? '' });
    refresh();
  });

  const completeTask = vscode.commands.registerCommand('agentBoard.completeTask', async (item?: TaskTreeItem) => {
    const task = item?.task ?? (await pickTask(jsonProvider, true));
    if (!task) {
      return;
    }
    await jsonProvider.updateTask({ ...task, status: 'done' });
    refresh();
    vscode.window.showInformationMessage(`Task "${task.title}" marked as complete.`);
  });

  const deleteTask = vscode.commands.registerCommand('agentBoard.deleteTask', async (item?: TaskTreeItem) => {
    const task = item?.task ?? (await pickTask(jsonProvider));
    if (!task) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete task "${task.title}"?`,
      { modal: true },
      'Delete',
    );
    if (confirm !== 'Delete') {
      return;
    }
    await jsonProvider.deleteTaskById(task.id);
    refresh();
  });

  const refreshTasks = vscode.commands.registerCommand('agentBoard.refreshTasks', async () => {
    refresh();
    await refreshTasksCommand(providerRegistry);
  });

  // ── Kanban / Provider / Copilot commands ─────────────────────────────

  /**
   * Send all initial data (tasks, squad status, agents, MCP, repo info) to the panel.
   * Wraps sendTasksToPanel with a 15-second timeout so a hanging provider can't
   * block the board from loading.
   */
  async function sendInitialDataToPanel(panel: KanbanPanel): Promise<void> {
    const TIMEOUT_MS = 15_000;
    try {
      await Promise.race([
        sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sendTasksToPanel timed out')), TIMEOUT_MS)),
      ]);
    } catch (err) {
      logger.error('Initial data send failed or timed out:', err instanceof Error ? err.message : String(err));
      // Send empty data so the webview exits the loading spinner
      panel.updateTasks([], EDITABLE_PROVIDER_IDS);
    }
    panel.updateSquadStatus(squadManager.getStatus());
    panel.updateAgents(agentOptions());
    panel.updateMcpStatus(ProjectConfig.getProjectConfig()?.mcp?.enabled ?? false);
    panel.postMessage({
      type: 'repoStatus',
      isGit: await isGitRepository(),
      isGitHub: await isGitHubRepository(),
      isAzureDevOps: await isAzureDevOpsRepository(),
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      workspaceName: vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '',
    });
  }

  const openKanban = vscode.commands.registerCommand('agentBoard.openKanban', async () => {
    logger.info('openKanban command invoked');
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showInformationMessage(
        'Agent Board requires an open folder or workspace. Please open a folder to use the Kanban board.',
        'Open Folder'
      ).then(selection => {
        if (selection === 'Open Folder') {
          vscode.commands.executeCommand('vscode.openFolder');
        }
      });
      return;
    }
    const panel = KanbanPanel.createOrShow(context.extensionUri);

    // Wire WebView messages FIRST — before any async work — to avoid
    // losing the 'ready' message the webview sends on script load.
    panel.onMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          await sendInitialDataToPanel(panel);
          break;
        case 'refreshRequest':
          await refreshTasksCommand(providerRegistry);
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          refreshAgents();
          panel.updateAgents(agentOptions());
          break;
        case 'taskMoved': {
          const [providerId] = msg.taskId.split(':');
          const provider = providerRegistry.get(providerId);
          if (provider) {
            const tasks = await provider.getTasks();
            const task = tasks.find(t => t.id === msg.taskId);
            if (task) {
              await provider.updateTask({ ...task, status: msg.toCol });

              // ── Auto-PR on move to "done" ────────────────────────────
              if (msg.toCol === 'done' && task.copilotSession?.state === 'completed') {
                const worktreeBranch = task.copilotSession.changedFiles && task.copilotSession.changedFiles.length > 0
                  ? `agent-board/${msg.taskId.replace(/[^a-zA-Z0-9-]/g, '-')}`
                  : undefined;
                if (worktreeBranch) {
                  const dw = copilotLauncher.getDiffWatcher(msg.taskId);
                  const changedFiles = dw?.getChanges() ?? [];
                  const diffSummary = changedFiles.length > 0
                    ? `### Files changed\n\n${changedFiles.map(f => `- \`${f.path}\``).join('\n')}`
                    : '';
                  const pr = await prManager.createPR({
                    title: task.title,
                    body: `Closes #${msg.taskId.split(':')[1]}\n\n${diffSummary}`,
                    headBranch: worktreeBranch,
                  });
                  if (pr) {
                    // Persist PR link on the task's session info
                    const updatedTask = { ...task, status: msg.toCol as import('./types/ColumnId').ColumnId };
                    if (updatedTask.copilotSession) {
                      updatedTask.copilotSession = {
                        ...updatedTask.copilotSession,
                        prUrl: pr.url,
                        prNumber: pr.number,
                        prState: pr.state,
                      };
                    }
                    await provider.updateTask(updatedTask);
                  }
                }
              }
            }
          }
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'openCopilot':
          if (!(await isGitRepository())) {
            vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
            break;
          }
          await squadManager.launchSingle(msg.taskId, msg.providerId, msg.agentSlug);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        case 'startSquad': {
          if (!(await isGitRepository())) {
            vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
            break;
          }
          await handleStartSquad(squadManager, msg.agentSlug, msg.genAiProviderId);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'toggleAutoSquad': {
          if (!(await isGitRepository())) {
            vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
            break;
          }
          handleToggleAutoSquad(squadManager, msg.agentSlug, msg.genAiProviderId);
          panel.updateSquadStatus(squadManager.getStatus());
          break;
        }
        case 'toggleMcp': {
          const currentMcp = ProjectConfig.getProjectConfig()?.mcp?.enabled ?? false;
          const newMcpEnabled = !currentMcp;
          ProjectConfig.updateConfig({ mcp: { enabled: newMcpEnabled } });
          panel.updateMcpStatus(newMcpEnabled);
          logger.info(`MCP server ${newMcpEnabled ? 'enabled' : 'disabled'} via board toggle`);
          break;
        }
        case 'addTask': {
          const columns = COLUMN_IDS.map(id => ({ id, label: COLUMN_LABELS[id], color: DEFAULT_COLUMN_COLORS[id] }));
          panel.postMessage({ type: 'showTaskForm', columns });
          break;
        }
        case 'saveTask': {
          const { title, body, status, labels, assignee } = msg.data;
          const task = await jsonProvider.createTask(title, body || undefined);
          // Apply extra properties
          const updates: Partial<import('./types/KanbanTask').KanbanTask> = { ...task };
          if (status) { updates.status = status; }
          if (labels) { updates.labels = labels.split(',').map((l: string) => l.trim()).filter(Boolean); }
          if (assignee) { updates.assignee = assignee; }
          if (updates.status !== task.status || (updates.labels && updates.labels.length > 0) || updates.assignee) {
            await jsonProvider.updateTask(updates as import('./types/KanbanTask').KanbanTask);
          }
          refresh();
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'cancelTaskForm':
          break;
        case 'editTask': {
          const [editProviderId] = msg.taskId.split(':');
          const editProvider = providerRegistry.get(editProviderId);
          if (editProvider) {
            const tasks = await editProvider.getTasks();
            const existing = tasks.find(t => t.id === msg.taskId);
            if (existing) {
              const { title, body, status, labels, assignee } = msg.data;
              const parsedLabels = labels ? labels.split(',').map((l: string) => l.trim()).filter(Boolean) : [];
              await editProvider.updateTask({
                ...existing,
                title,
                body,
                status: status || existing.status,
                labels: parsedLabels,
                assignee: assignee || undefined,
              });
            }
          }
          refresh();
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'deleteTask': {
          const [delProviderId] = msg.taskId.split(':');
          const delProvider = providerRegistry.get(delProviderId);
          if (delProvider && 'deleteTaskById' in delProvider && typeof (delProvider as Record<string, unknown>).deleteTaskById === 'function') {
            await (delProvider as unknown as { deleteTaskById(id: string): Promise<boolean> }).deleteTaskById(msg.taskId);
          }
          refresh();
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'exportDoneMd': {
          const allProviders = providerRegistry.getAll().filter(p => p.isEnabled());
          const allTasks = (await Promise.allSettled(allProviders.map(p => p.getTasks())))
            .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
            .flatMap(r => r.value);
          const doneTasks = allTasks.filter(t => t.status === 'done');
          const today = new Date().toISOString().slice(0, 10);
          const lines = [
            `# Done Tasks Report`,
            ``,
            `**Date:** ${today}`,
            `**Total:** ${doneTasks.length} task${doneTasks.length === 1 ? '' : 's'}`,
            ``,
            `| # | Title | Provider | Labels | Assignee |`,
            `|---|-------|----------|--------|----------|`,
            ...doneTasks.map((t, i) => {
              const title = t.url ? `[${t.title}](${t.url})` : t.title;
              return `| ${i + 1} | ${title} | ${t.providerId} | ${t.labels.join(', ')} | ${t.assignee ?? '—'} |`;
            }),
            ``,
          ];
          const md = lines.join('\n');
          await vscode.env.clipboard.writeText(md);
          vscode.window.showInformationMessage(`Copied ${doneTasks.length} done task(s) to clipboard as Markdown.`);
          break;
        }
        case 'cleanDone': {
          const allProviders2 = providerRegistry.getAll().filter(p => p.isEnabled());
          const allTasks2 = (await Promise.allSettled(allProviders2.map(p => p.getTasks())))
            .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
            .flatMap(r => r.value);
          const doneTasks2 = allTasks2.filter(t => t.status === 'done');
          if (doneTasks2.length === 0) {
            vscode.window.showInformationMessage('No done tasks to clean.');
            break;
          }
          const confirm = await vscode.window.showWarningMessage(
            `Remove ${doneTasks2.length} done task(s) from the board?`,
            { modal: true },
            'Clean',
          );
          if (confirm !== 'Clean') { break; }
          for (const t of doneTasks2) {
            const [pid] = t.id.split(':');
            const prov = providerRegistry.get(pid);
            if (prov && 'deleteTaskById' in prov && typeof (prov as Record<string, unknown>).deleteTaskById === 'function') {
              await (prov as unknown as { deleteTaskById(id: string): Promise<boolean> }).deleteTaskById(t.id);
            } else if (prov && 'removeDoneTask' in prov && typeof (prov as Record<string, unknown>).removeDoneTask === 'function') {
              await (prov as unknown as { removeDoneTask(id: string): Promise<void> }).removeDoneTask(t.id);
            }
          }
          refresh();
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          vscode.window.showInformationMessage(`Cleaned ${doneTasks2.length} done task(s).`);
          break;
        }
        case 'launchProvider': {
          await squadManager.launchSingle(msg.taskId, msg.genAiProviderId, undefined);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'cancelSession': {
          copilotLauncher.cancelSession(msg.taskId);
          squadManager.failSession(msg.taskId);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'resetSession': {
          logger.info('resetSession: sessionId=%s', msg.sessionId);
          // Cancel any running session
          copilotLauncher.cancelSession(msg.sessionId);
          squadManager.failSession(msg.sessionId);
          // Remove session state entirely
          sessionStateManager.removeSession(msg.sessionId);
          logger.info('resetSession: session removed, verify=%s', !sessionStateManager.getSession(msg.sessionId));
          // Move task back to first column
          const [resetProviderId] = msg.sessionId.split(':');
          const resetProvider = providerRegistry.get(resetProviderId);
          if (resetProvider) {
            const resetTasks = await resetProvider.getTasks();
            const resetTask = resetTasks.find(t => t.id === msg.sessionId);
            if (resetTask) {
              const resetColumns = ProjectConfig.getProjectConfig()?.kanban?.columns ?? [...COLUMN_IDS];
              const firstCol = resetColumns[0];
              logger.info('resetSession: task found, status=%s -> %s', resetTask.status, firstCol);
              await resetProvider.updateTask({ ...resetTask, status: firstCol });
            } else {
              logger.warn('resetSession: task not found in provider "%s"', resetProviderId);
            }
          } else {
            logger.warn('resetSession: provider "%s" not found', resetProviderId);
          }
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          logger.info('resetSession: done, tasks sent to panel');
          break;
        }
        case 'reopenSession': {
          // Focus the VS Code chat panel so the user can see the running session
          await vscode.commands.executeCommand('workbench.action.chat.open');
          break;
        }
        case 'openDiff': {
          const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
          if (dw) {
            await dw.openDiff(msg.filePath);
          } else {
            // Fallback: try to open diff using session worktree path
            const session = sessionStateManager.getSession(msg.sessionId);
            const wtPath = session?.worktreePath;
            if (wtPath) {
              const headUri = gitRefUri(wtPath, msg.filePath, 'main');
              const workingUri = vscode.Uri.file(path.join(wtPath, msg.filePath));
              await vscode.commands.executeCommand('vscode.diff', headUri, workingUri, `${msg.filePath} (main ↔ Working)`);
            }
          }
          break;
        }
        case 'openFullDiff': {
          const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
          if (dw) {
            await dw.openFullDiff(dw.getChanges());
          } else {
            await vscode.commands.executeCommand('workbench.view.scm');
          }
          break;
        }
        case 'openTerminalInWorktree': {
          const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
          const worktreeRoot = dw?.rootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (worktreeRoot) {
            const terminal = vscode.window.createTerminal({
              name: `Worktree: ${msg.sessionId.split(':').pop() ?? msg.sessionId}`,
              cwd: worktreeRoot,
            });
            terminal.show();
          }
          break;
        }
        case 'exportLog': {
          const stream = copilotLauncher.getStreamRegistry().get(msg.sessionId);
          if (stream) {
            const doc = await vscode.workspace.openTextDocument({ content: stream.exportLog(), language: 'log' });
            await vscode.window.showTextDocument(doc);
          }
          break;
        }
        case 'requestStreamResume': {
          // Replay the accumulated log buffer so the webview can restore the session panel.
          // Falls back to the on-disk log if the session was interrupted during a restart.
          const stream = copilotLauncher.getStreamRegistry().get(msg.sessionId);
          if (stream) {
            panel.postMessage({ type: 'streamResume', sessionId: msg.sessionId, log: stream.exportLog() });
          } else {
            const persistedLog = copilotLauncher.readPersistedLog(msg.sessionId);
            if (persistedLog) {
              panel.postMessage({ type: 'streamResume', sessionId: msg.sessionId, log: persistedLog });
            }
          }
          break;
        }
        case 'sendFollowUp': {
          await copilotLauncher.sendFollowUp(msg.sessionId, msg.text);
          break;
        }
        case 'openWorktree': {
          const wtUri = vscode.Uri.file(msg.worktreePath);
          await vscode.commands.executeCommand('vscode.openFolder', wtUri, { forceNewWindow: true });
          break;
        }
        case 'reviewWorktree': {
          // Open VS Code diff view: main...worktree-branch
          const session = sessionStateManager.getSession(msg.sessionId);
          const wtPath = session?.worktreePath;
          const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wtPath || !repoRoot) { break; }
          if (!fs.existsSync(wtPath)) {
            vscode.window.showErrorMessage(`Worktree directory not found: ${wtPath}`);
            break;
          }

          try {
            // Get the branch name of the worktree
            const branch = await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath });
            // Use vscode.changes to show the multi-file diff between main and the worktree branch
            const diffOutput = await execPromise(`git diff --name-status main...${branch.trim()}`, { cwd: repoRoot });
            const files = diffOutput.trim().split('\n').filter(l => l).map(line => {
              const [statusChar, ...pathParts] = line.split('\t');
              const filePath = pathParts.join('\t');
              return { statusChar, filePath };
            });
            const resources = files.map(f => {
              const absPath = path.join(repoRoot, f.filePath);
              const mainUri = gitRefUri(repoRoot, f.filePath, 'main');
              const branchUri = f.statusChar === 'D'
                ? gitRefUri(repoRoot, f.filePath, '')
                : vscode.Uri.file(path.join(wtPath, f.filePath));
              // vscode.changes expects [labelUri, leftUri?, rightUri?]
              return [vscode.Uri.file(absPath), mainUri, branchUri] as [vscode.Uri, vscode.Uri, vscode.Uri];
            });
            if (resources.length > 0) {
              await vscode.commands.executeCommand('vscode.changes', `Review: ${branch.trim()} vs main`, resources);
            } else {
              vscode.window.showInformationMessage('Nessuna differenza tra il worktree e main.');
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error('reviewWorktree failed:', errMsg);
            panel.postMessage({ type: 'mergeResult', sessionId: msg.sessionId, success: false, message: `Review failed: ${errMsg}` });
            vscode.window.showErrorMessage(`Review failed: ${errMsg}`);
          }
          break;
        }
        case 'mergeWorktree': {
          const session = sessionStateManager.getSession(msg.sessionId);
          const wtPath = session?.worktreePath;
          const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wtPath || !repoRoot) { break; }
          if (!fs.existsSync(wtPath)) {
            vscode.window.showErrorMessage(`Worktree directory not found: ${wtPath}`);
            break;
          }

          const strategy = msg.mergeStrategy ?? 'squash';
          const strategyLabels: Record<string, string> = {
            squash: 'Squash and merge',
            merge: 'Merge commit',
            rebase: 'Rebase and merge',
          };

          try {
            const branch = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath })).trim();

            const answer = await vscode.window.showWarningMessage(
              `${strategyLabels[strategy]} il branch "${branch}" in main?`,
              { modal: true },
              'Merge',
              'Annulla',
            );
            if (answer !== 'Merge') { break; }

            // Commit any uncommitted changes in the worktree first
            try {
              await execPromise('git add -A && git diff --cached --quiet || git commit -m "agent: auto-commit before merge"', { cwd: wtPath });
            } catch { /* ignore if nothing to commit */ }

            // Merge into main using chosen strategy
            if (strategy === 'squash') {
              await execPromise(`git merge --squash ${branch}`, { cwd: repoRoot });
              await execPromise(`git commit --no-edit -m "squash: ${branch}"`, { cwd: repoRoot });
            } else if (strategy === 'rebase') {
              await execPromise(`git rebase ${branch}`, { cwd: repoRoot });
            } else {
              await execPromise(`git merge ${branch} --no-edit`, { cwd: repoRoot });
            }

            panel.postMessage({ type: 'mergeResult', sessionId: msg.sessionId, success: true, message: `Branch "${branch}" mergiato in main (${strategyLabels[strategy]}).` });
            vscode.window.showInformationMessage(`✅ Branch "${branch}" mergiato in main (${strategyLabels[strategy]}).`);

            // Move task to last column (done) after successful merge
            const [mergeProviderId] = msg.sessionId.split(':');
            logger.info('mergeWorktree: providerId=%s, sessionId=%s', mergeProviderId, msg.sessionId);
            const mergeProvider = providerRegistry.get(mergeProviderId);
            if (mergeProvider) {
              const mergeTasks = await mergeProvider.getTasks();
              const mergeTask = mergeTasks.find(t => t.id === msg.sessionId);
              logger.info('mergeWorktree: found task=%s, currentStatus=%s', !!mergeTask, mergeTask?.status);
              if (mergeTask) {
                const columnOrder = ProjectConfig.getProjectConfig()?.kanban?.columns ?? [...COLUMN_IDS];
                const lastCol = columnOrder[columnOrder.length - 1];
                logger.info('mergeWorktree: columnOrder=%s, lastCol=%s', JSON.stringify(columnOrder), lastCol);
                await mergeProvider.updateTask({ ...mergeTask, status: lastCol });
                logger.info('mergeWorktree: task updated to %s', lastCol);
              }
            } else {
              logger.warn('mergeWorktree: provider "%s" not found in registry', mergeProviderId);
            }

            // Persist merged flag on session so it survives reloads
            sessionStateManager.markMerged(msg.sessionId);

            // Refresh tasks to update the UI
            await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error('mergeWorktree failed:', errMsg);
            panel.postMessage({ type: 'mergeResult', sessionId: msg.sessionId, success: false, message: errMsg });
            vscode.window.showErrorMessage(`Merge fallito: ${errMsg}`);
          }
          break;
        }
        case 'alignWorktree': {
          const session = sessionStateManager.getSession(msg.sessionId);
          const wtPath = session?.worktreePath;
          const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wtPath || !repoRoot) {
            vscode.window.showErrorMessage('Align: worktree non trovato.');
            break;
          }

          // Pick the provider used for this task, or the first available non-chat provider
          const alignProviderId = session.providerId;
          const alignProvider = alignProviderId
            ? genAiRegistry?.get(alignProviderId) ?? genAiRegistry?.getAll().find(p => p.id !== 'chat')
            : genAiRegistry?.getAll().find(p => p.id !== 'chat');
          if (!alignProvider) {
            vscode.window.showErrorMessage('Align from main: nessun provider disponibile.');
            break;
          }

          try {
            const branch = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath })).trim();
            // Check if main has diverged from the worktree branch
            const behindCount = (await execPromise(`git rev-list --count ${branch}..main`, { cwd: repoRoot })).trim();
            const mainDiff = (await execPromise('git diff main --stat', { cwd: wtPath })).trim();

            const alignPrompt =
              `## Align Worktree from main\n\n` +
              `You are working in the worktree at **${wtPath}** on branch **${branch}**.\n` +
              `The main repository root is at **${repoRoot}**.\n` +
              `The branch is **${behindCount}** commit(s) behind main.\n\n` +
              `### Current diff vs main\n\`\`\`\n${mainDiff}\n\`\`\`\n\n` +
              `### Instructions\n` +
              `1. From the worktree directory, fetch and rebase on top of origin/main:\n` +
              `   - Run: cd ${wtPath} && git fetch origin && git rebase origin/main\n` +
              `2. If there are merge conflicts, resolve them intelligently by understanding both sides\n` +
              `3. After resolving conflicts, run: git add . && git rebase --continue\n` +
              `4. Ensure the code compiles and tests pass\n` +
              `5. Report what changed and whether the alignment was successful\n`;

            await copilotLauncher.launch(msg.sessionId, alignProvider.id, undefined, alignPrompt);
            await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error('Align from main failed:', errMsg);
            vscode.window.showErrorMessage(`Align from main fallito: ${errMsg}`);
          }
          break;
        }
        case 'agentMerge': {
          const session = sessionStateManager.getSession(msg.sessionId);
          const wtPath = session?.worktreePath;
          const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wtPath || !repoRoot) {
            vscode.window.showErrorMessage('Agent Merge: worktree non trovato.');
            break;
          }

          const strategy = msg.mergeStrategy ?? 'squash';
          const strategyLabels: Record<string, string> = {
            squash: 'squash and merge',
            merge: 'merge commit',
            rebase: 'rebase and merge',
          };

          // Determine which provider to use — prefer the one used for the task
          const provider = msg.providerId
            ? genAiRegistry?.get(msg.providerId) ?? genAiRegistry?.getAll().find(p => p.id !== 'chat')
            : genAiRegistry?.getAll().find(p => p.id !== 'chat');
          if (!provider) {
            vscode.window.showErrorMessage('Merge by AI: nessun provider disponibile.');
            break;
          }

          try {
            const branch = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath })).trim();
            const diffSummary = (await execPromise(`git diff main --stat`, { cwd: wtPath })).trim();

            const mergePrompt =
              `## Merge Task\n\n` +
              `You are reviewing and merging branch **${branch}** into main.\n` +
              `Strategy: **${strategyLabels[strategy]}**.\n\n` +
              `- Worktree: ${wtPath}\n` +
              `- Main repo root: ${repoRoot}\n\n` +
              `### Changed files\n\`\`\`\n${diffSummary}\n\`\`\`\n\n` +
              `### Instructions\n` +
              `1. Review all changes in the worktree at ${wtPath}\n` +
              `2. Ensure code quality, check for bugs, security issues, and style\n` +
              `3. If changes are acceptable, perform the merge **from the main repo root** using the "${strategyLabels[strategy]}" strategy:\n` +
              (strategy === 'squash'
                ? `   - Run: cd ${repoRoot} && git fetch origin && git checkout main && git merge --squash ${branch} && git commit -m "squash: ${branch}"\n`
                : strategy === 'rebase'
                  ? `   - Run: cd ${repoRoot} && git fetch origin && git checkout main && git rebase ${branch}\n`
                  : `   - Run: cd ${repoRoot} && git fetch origin && git checkout main && git merge ${branch} --no-edit\n`) +
              `4. If the merge fails or produces conflicts, **abort immediately** to leave main clean:\n` +
              (strategy === 'rebase'
                ? `   - Run: cd ${repoRoot} && git rebase --abort\n`
                : `   - Run: cd ${repoRoot} && git merge --abort\n`) +
              `5. If changes need fixes, apply them in the worktree first (cd ${wtPath}), commit, then retry the merge from repo root\n` +
              `6. Report what you found and whether the merge was successful\n`;

            // Launch the provider directly with the merge prompt
            await copilotLauncher.launch(msg.sessionId, provider.id, undefined, mergePrompt);

            await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error('Merge by AI failed:', errMsg);
            vscode.window.showErrorMessage(`Merge by AI fallito: ${errMsg}`);
          }
          break;
        }
        case 'deleteWorktree': {
          const session = sessionStateManager.getSession(msg.sessionId);
          const wtPath = session?.worktreePath;
          const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wtPath || !repoRoot) { break; }

          const answer = await vscode.window.showWarningMessage(
            `Eliminare il workspace worktree "${path.basename(wtPath)}"? Questa operazione è irreversibile.`,
            { modal: true },
            'Elimina',
            'Annulla',
          );
          if (answer !== 'Elimina') { break; }

          try {
            await removeWorktree(repoRoot, msg.sessionId);
            sessionStateManager.clearWorktree(msg.sessionId);
            panel.postMessage({ type: 'deleteWorktreeResult', sessionId: msg.sessionId, success: true });
            vscode.window.showInformationMessage('Worktree eliminato.');
            vscode.commands.executeCommand('agentBoard.refreshTasks');
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error('deleteWorktree failed:', errMsg);
            panel.postMessage({ type: 'deleteWorktreeResult', sessionId: msg.sessionId, success: false, message: errMsg });
            vscode.window.showErrorMessage(`Eliminazione fallita: ${errMsg}`);
          }
          break;
        }
        case 'createPullRequest': {
          const session = sessionStateManager.getSession(msg.sessionId);
          const wtPath = session?.worktreePath;
          const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wtPath || !repoRoot) {
            vscode.window.showErrorMessage('Create PR: worktree not found.');
            break;
          }

          try {
            const branch = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath })).trim();
            const isGH = await isGitHubRepository();
            const isADO = await isAzureDevOpsRepository();

            if (isGH) {
              // ── GitHub: use PullRequestManager API ───────────────────
              const [prProviderId] = msg.sessionId.split(':');
              const prProvider = providerRegistry.get(prProviderId);
              let taskTitle = branch;
              let taskBody = '';
              if (prProvider) {
                const prTasks = await prProvider.getTasks();
                const prTask = prTasks.find(t => t.id === msg.sessionId);
                if (prTask) {
                  taskTitle = prTask.title;
                  const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
                  const changedFiles = dw?.getChanges() ?? [];
                  taskBody = changedFiles.length > 0
                    ? `### Files changed\n\n${changedFiles.map(f => `- \`${f.path}\``).join('\n')}`
                    : '';
                }
              }
              const pr = await prManager.createPR({
                title: taskTitle,
                body: taskBody,
                headBranch: branch,
              });
              if (pr) {
                // Persist PR info on the task
                const [updProviderId] = msg.sessionId.split(':');
                const updProvider = providerRegistry.get(updProviderId);
                if (updProvider) {
                  const updTasks = await updProvider.getTasks();
                  const updTask = updTasks.find(t => t.id === msg.sessionId);
                  if (updTask?.copilotSession) {
                    await updProvider.updateTask({
                      ...updTask,
                      copilotSession: {
                        ...updTask.copilotSession,
                        prUrl: pr.url,
                        prNumber: pr.number,
                        prState: pr.state,
                      },
                    });
                  }
                }
                panel.postMessage({ type: 'createPullRequestResult', sessionId: msg.sessionId, success: true, prUrl: pr.url });
                await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
              }
            } else if (isADO) {
              // ── Azure DevOps: open browser to PR creation page ───────
              const remoteUrl = await getRemoteUrl();
              if (!remoteUrl) {
                vscode.window.showErrorMessage('Create PR: could not determine Azure DevOps remote URL.');
                break;
              }
              // Detect the default branch (fallback to 'main')
              let defaultBranch = 'main';
              try {
                const symbolicRef = (await execPromise('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoRoot })).trim();
                const match = symbolicRef.match(/refs\/remotes\/origin\/(.+)$/);
                if (match) { defaultBranch = match[1]; }
              } catch { /* use 'main' fallback */ }
              // Normalise URL: remove .git suffix and trailing slash
              const baseUrl = remoteUrl.replace(/\.git$/, '').replace(/\/$/, '');
              const prUrl = `${baseUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(branch)}&targetRef=${encodeURIComponent(`refs/heads/${defaultBranch}`)}`;
              await vscode.env.openExternal(vscode.Uri.parse(prUrl));
              panel.postMessage({ type: 'createPullRequestResult', sessionId: msg.sessionId, success: true, prUrl });
            } else {
              vscode.window.showWarningMessage('Create PR: no GitHub or Azure DevOps remote configured.');
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error('createPullRequest failed:', errMsg);
            panel.postMessage({ type: 'createPullRequestResult', sessionId: msg.sessionId, success: false, message: errMsg });
            vscode.window.showErrorMessage(`Create PR failed: ${errMsg}`);
          }
          break;
        }
      }
    });

    // Proactively send initial data right away — don't rely solely on the
    // webview 'ready' message which can be lost during panel deserialization.
    void sendInitialDataToPanel(panel);

    // Auto-refresh board when squad session state changes (background completion/failure)
    const squadSub = squadManager.onDidChangeStatus(async () => {
      panel.updateSquadStatus(squadManager.getStatus());
      await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
    });
    panel.onDispose(() => squadSub.dispose());

    // Auto-refresh board when session state changes (worktree creation, running, done, error)
    const sessionSub = sessionStateManager.onDidChangeState(async () => {
      await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
    });
    panel.onDispose(() => sessionSub.dispose());

    // Forward stream output from any session → webview
    const streamSub = copilotLauncher.getStreamRegistry().onDidAppendAny(({ sessionId, text, ts }) => {
      panel.appendStreamOutput(sessionId, text, ts);
    });
    panel.onDispose(() => streamSub.dispose());

    // Forward tool-call status events → webview
    const toolCallSub = copilotLauncher.onDidToolCall(({ sessionId, status }) => {
      panel.notifyToolCall(sessionId, status);
    });
    panel.onDispose(() => toolCallSub.dispose());

    // Forward DiffWatcher file-change events → webview (live, via onDidChangeDiff)
    const diffSub = copilotLauncher.onDidChangeDiff(({ sessionId, files }) => {
      panel.updateFileChanges(sessionId, files);
    });
    panel.onDispose(() => diffSub.dispose());

    // GitHub 30-second polling: detect remote changes, refresh board
    const isGH = await isGitHubRepository();
    if (isGH) {
      void ghIssueManager.ensureKanbanLabels();
      ghIssueManager.startPolling(30_000);
      const ghPollSub = ghIssueManager.onDidDetectRemoteChange(async () => {
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
      });
      panel.onDispose(() => {
        ghIssueManager.stopPolling();
        ghPollSub.dispose();
      });
    }
  });

  const selectProvider = vscode.commands.registerCommand('agentBoard.selectProvider', async () => {
    logger.info('selectProvider command invoked');
    await providerPicker.pick();
  });

  const launchCopilot = vscode.commands.registerCommand('agentBoard.launchCopilot', async () => {
    logger.info('launchCopilot command invoked');
    const mode = await modelSelector.pick();
    if (!mode) {
      return;
    }
    vscode.window.showInformationMessage(`GenAI provider set to "${mode}". Select a task from the Kanban board to launch.`);
  });

  const startSquad = vscode.commands.registerCommand('agentBoard.startSquad', async () => {
    logger.info('startSquad command invoked');
    if (!(await isGitRepository())) {
      vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
      return;
    }
    const isGit = await isGitRepository();
    const isGitHub = await isGitHubRepository();
    const genAiProviderId = await pickGenAiProvider(genAiRegistry, isGit, isGitHub);
    if (genAiProviderId === undefined) { return; }
    const agentSlug = await pickAgent(discoveredAgents);
    await handleStartSquad(squadManager, agentSlug, genAiProviderId);
  });

  const toggleAutoSquad = vscode.commands.registerCommand('agentBoard.toggleAutoSquad', async () => {
    logger.info('toggleAutoSquad command invoked');
    if (!(await isGitRepository())) {
      vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
      return;
    }
    const isGit = await isGitRepository();
    const isGitHub = await isGitHubRepository();
    const genAiProviderId = await pickGenAiProvider(genAiRegistry, isGit, isGitHub);
    if (genAiProviderId === undefined) { return; }
    const agentSlug = await pickAgent(discoveredAgents);
    handleToggleAutoSquad(squadManager, agentSlug, genAiProviderId);
  });

  const toggleMaximize = vscode.commands.registerCommand('agentBoard.toggleMaximize', () => {
    vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
  });

  const openSettings = vscode.commands.registerCommand('agentBoard.openSettings', () => {
    SettingsPanel.createOrShow(providerRegistry);
  });

  const runAgent = vscode.commands.registerCommand('agentBoard.runAgent', async (item?: AgentTreeItem) => {
    if (item) {
      const started = agentManager.startAgent(item.agent.id);
      if (!started) {
        vscode.window.showErrorMessage(`Cannot start agent "${item.agent.name}".`);
        return;
      }
      agentsProvider.refresh();
      simulateAgentRun(started.id, agentManager, refresh);
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Agent name',
      placeHolder: 'e.g. Code reviewer',
      validateInput: v => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (!name) {
      return;
    }

    const pendingTasks = (await jsonProvider.getTasks()).filter(t => t.status !== 'done');
    let taskId: string | undefined;
    if (pendingTasks.length > 0) {
      const pick = await vscode.window.showQuickPick(
        [
          { label: '(none)', description: 'Run without a linked task', id: undefined as string | undefined },
          ...pendingTasks.map(t => ({ label: t.title, description: t.body ?? '', id: t.id })),
        ],
        { placeHolder: 'Link to a task (optional)' },
      );
      taskId = pick?.id;
    }

    const agent = agentManager.createAgent(name.trim(), taskId);
    const started = agentManager.startAgent(agent.id);
    if (!started) {
      vscode.window.showErrorMessage('Failed to start agent.');
      return;
    }
    refresh();
    simulateAgentRun(started.id, agentManager, refresh);
  });

  const stopAgent = vscode.commands.registerCommand('agentBoard.stopAgent', async (item?: AgentTreeItem) => {
    if (!item) {
      return;
    }
    const stopped = agentManager.stopAgent(item.agent.id);
    if (!stopped) {
      vscode.window.showErrorMessage(`Cannot stop agent "${item.agent.name}".`);
      return;
    }
    refresh();
    vscode.window.showInformationMessage(`Agent "${item.agent.name}" stopped.`);
  });

  // ── Subscriptions ─────────────────────────────────────────────────────

  context.subscriptions.push(
    overviewView,
    statusBarItem,
    sessionStateManager,
    addTask,
    editTask,
    completeTask,
    deleteTask,
    refreshTasks,
    runAgent,
    stopAgent,
    openKanban,
    openSettings,
    toggleMaximize,
    selectProvider,
    launchCopilot,
    startSquad,
    toggleAutoSquad,
    modelSelector,
    { dispose: () => squadManager.dispose() },
    { dispose: () => providerRegistry.disposeAll() },
    { dispose: () => genAiRegistry.disposeAll() },
    logger,
  );

  if (chatParticipant) {
    context.subscriptions.push(chatParticipant);
  }

  logger.info('Agent Board activated — %d subscriptions registered', context.subscriptions.length);
}

export function deactivate(): void {
  // Nothing to clean up
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function updateStatusBar(item: vscode.StatusBarItem, provider: ITaskProvider): Promise<void> {
  return provider.getTasks().then(tasks => {
    const pending = tasks.filter(t => t.status !== 'done').length;
    item.text = pending > 0 ? `$(tasklist) ${pending} task${pending === 1 ? '' : 's'}` : '$(tasklist) Agent Board';
    item.tooltip = pending > 0 ? `${pending} pending task${pending === 1 ? '' : 's'} – click to add` : 'Agent Board – click to add a task';
  });
}

async function pickTask(provider: ITaskProvider, excludeDone = false) {
  const tasks = await provider.getTasks();
  const filtered = excludeDone ? tasks.filter(t => t.status !== 'done') : tasks;
  if (filtered.length === 0) {
    vscode.window.showInformationMessage('No tasks found.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    filtered.map(t => ({ label: t.title, description: t.status, task: t })),
    { placeHolder: 'Select a task' },
  );
  return pick?.task;
}

/**
 * Simulates an agent performing work (replace with real agent integration).
 */
function simulateAgentRun(agentId: string, agentManager: AgentManager, refresh: () => void): void {
  const SIMULATE_MS = 3000;
  setTimeout(() => {
    agentManager.completeAgent(agentId, 'Agent finished successfully.');
    refresh();
    vscode.window.showInformationMessage('Agent finished successfully.');
  }, SIMULATE_MS);
}

/** Provider IDs whose tasks support full inline editing. */
const EDITABLE_PROVIDER_IDS = ['json', 'github', 'azure-devops'];

/**
 * Gather tasks from all providers and push them to the Kanban panel.
 */
async function sendTasksToPanel(panel: KanbanPanel, registry: ProviderRegistry, genAiRegistry?: import('./copilot/GenAiProviderRegistry').GenAiProviderRegistry, squadMgr?: SquadManager, sessionStateMgr?: SessionStateManager): Promise<void> {
  const providers = registry.getAll().filter(p => p.isEnabled());
  const allTasks = (
    await Promise.allSettled(providers.map(p => p.getTasks()))
  )
    .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Inject session info into tasks so the webview can show status, worktree, errors
  // Prefer SessionStateManager (has worktreePath, errorMessage), fallback to SquadManager active sessions
  for (const task of allTasks) {
    if (sessionStateMgr) {
      const persisted = sessionStateMgr.getSession(task.id);
      if (persisted) {
        task.copilotSession = sessionStateMgr.toCopilotSessionInfo(persisted);
        continue;
      }
    }
    if (squadMgr) {
      const session = squadMgr.getActiveSessions().get(task.id);
      if (session) {
        task.copilotSession = session;
      }
    }
  }

  const genAiOptions = genAiRegistry
    ? await buildGenAiOptions(genAiRegistry)
    : [];
  panel.updateTasks(allTasks, EDITABLE_PROVIDER_IDS, genAiOptions);
}

/** IDs of GenAI providers that are always registered (VS Code integrated). */
const GLOBAL_GENAI_PROVIDER_IDS = ['chat', 'cloud', 'copilot-cli'];

/**
 * Handle starting a squad session — shared between command and WebView handler.
 */
async function handleStartSquad(squadManager: SquadManager, agentSlug?: string, genAiProviderId?: string): Promise<void> {
  const launched = await squadManager.startSquad(agentSlug, genAiProviderId);
  vscode.window.showInformationMessage(
    `Squad: launched ${launched} session${launched === 1 ? '' : 's'}.`,
  );
}

/**
 * Handle toggling auto-squad — shared between command and WebView handler.
 */
function handleToggleAutoSquad(squadManager: SquadManager, agentSlug?: string, genAiProviderId?: string): void {
  const enabled = squadManager.toggleAutoSquad(agentSlug, genAiProviderId);
  vscode.window.showInformationMessage(
    `Auto-squad ${enabled ? 'enabled' : 'disabled'}.`,
  );
}

/**
 * Show a Quick Pick for selecting the GenAI provider for the squad.
 * Filters out providers that are disabled for the current repo.
 * Returns `undefined` if the user cancels.
 */
async function pickGenAiProvider(
  registry: import('./copilot/GenAiProviderRegistry').GenAiProviderRegistry,
  isGit: boolean,
  isGitHub: boolean,
): Promise<string | undefined> {
  const items = registry.getAll()
    .filter(p => {
      // Chat provider cannot run in background — exclude from squad
      if (p.id === 'chat') { return false; }
      const noGitRequired = p.id === 'copilot-cli' || p.id === 'cloud' || p.id === 'copilot-lm';
      if (!isGit && noGitRequired) { return false; }
      if (!isGitHub && p.id === 'cloud') { return false; }
      return true;
    })
    .map(p => ({
      label: `$(${p.icon}) ${p.displayName}`,
      description: p.scope === 'global' ? 'VS Code integrated' : 'Project provider',
      providerId: p.id,
    }));

  const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select GenAI provider for squad' });
  return selected?.providerId;
}

/**
 * Show a Quick Pick for selecting an agent when invoked from the command palette.
 * Returns `undefined` if no agents are available or the user cancels.
 */
async function pickAgent(agents: AgentInfo[]): Promise<string | undefined> {
  const squadAgents = agents.filter(a => a.canSquad);
  if (squadAgents.length === 0) {
    return undefined;
  }

  const items = squadAgents.map(a => ({
    label: `$(hubot) ${a.displayName}`,
    description: a.slug,
    slug: a.slug as string | undefined,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a squad agent',
  });

  // Default to first squad agent when user cancels
  return selected?.slug ?? squadAgents[0]?.slug;
}

// ── Git / GitHub detection helpers ──────────────────────────────────────────

/** Cache for workspace git/github detection (computed once per session). */
let _isGitRepo: boolean | undefined;
let _isGitHubRepo: boolean | undefined;
let _isAzureDevOpsRepo: boolean | undefined;

function shellCheck(cmd: string, cwd: string): Promise<boolean> {
  return new Promise(resolve => {
    exec(cmd, { cwd, timeout: 5_000 }, (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve(stdout.trim().length > 0);
    });
  });
}

async function isGitRepository(): Promise<boolean> {
  if (_isGitRepo !== undefined) { return _isGitRepo; }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) { _isGitRepo = false; return false; }
  _isGitRepo = await shellCheck('git rev-parse --is-inside-work-tree', root);
  return _isGitRepo;
}

async function isGitHubRepository(): Promise<boolean> {
  if (_isGitHubRepo !== undefined) { return _isGitHubRepo; }
  const isGit = await isGitRepository();
  if (!isGit) { _isGitHubRepo = false; return false; }
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  _isGitHubRepo = await shellCheck('git remote -v | grep -i github.com', root);
  return _isGitHubRepo;
}

async function isAzureDevOpsRepository(): Promise<boolean> {
  if (_isAzureDevOpsRepo !== undefined) { return _isAzureDevOpsRepo; }
  const isGit = await isGitRepository();
  if (!isGit) { _isAzureDevOpsRepo = false; return false; }
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  _isAzureDevOpsRepo = await shellCheck('git remote -v | grep -iE "dev\\.azure\\.com|visualstudio\\.com"', root);
  return _isAzureDevOpsRepo;
}

/** Return the raw fetch URL of the first git remote, or undefined. */
async function getRemoteUrl(): Promise<string | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) { return undefined; }
  try {
    const output = await execPromise('git remote get-url origin', { cwd: root });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the GenAI provider options list, disabling providers
 * that require git or GitHub when the workspace doesn't qualify.
 *
 * - `copilot-cli` and `cloud` require a git repository.
 * - `cloud` additionally requires a GitHub remote.
 */
async function buildGenAiOptions(registry: GenAiProviderRegistry): Promise<GenAiProviderOption[]> {
  const isGit = await isGitRepository();
  const isGitHub = await isGitHubRepository();

  return registry.getAll().map(p => {
    const option: GenAiProviderOption = {
      id: p.id,
      displayName: p.displayName,
      icon: p.icon,
    };

    if (!isGit && (p.id === 'copilot-cli' || p.id === 'cloud' || p.id === 'copilot-lm')) {
      option.disabled = true;
      option.disabledReason = 'Requires a git repository';
    } else if (!isGitHub && p.id === 'cloud') {
      option.disabled = true;
      option.disabledReason = 'Requires a GitHub repository';
    }

    return option;
  });
}

/** Promisified `exec` helper for git commands. */
function execPromise(command: string, options: { cwd: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: options.cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
