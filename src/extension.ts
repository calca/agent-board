import { exec } from 'child_process';
import * as fs from 'fs';
import type * as LocalTunnelNS from 'localtunnel';
import * as os from 'os';
import * as path from 'path';
import * as QRCode from 'qrcode';
import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { AgentsTreeProvider, AgentTreeItem } from './agentsTreeProvider';
import { refreshTasksCommand } from './commands/refreshTasks';
import { ProjectConfig } from './config/ProjectConfig';
import { DiffWatcher, GIT_REF_SCHEME, GitRefContentProvider, gitRefUri } from './diff/DiffWatcher';
import { AgentInfo, discoverAgents } from './genai-provider/agentDiscovery';
import { cancelAgent as cancelCliAgent, runAgent as runCliAgent } from './genai-provider/AgentRunner';
import { registerChatParticipant } from './genai-provider/ChatParticipant';
import { CopilotLauncher } from './genai-provider/CopilotLauncher';
import { GenAiProviderRegistry } from './genai-provider/GenAiProviderRegistry';
import { ModelSelector } from './genai-provider/ModelSelector';
import { ChatGenAiProvider } from './genai-provider/providers/ChatGenAiProvider';
import { CloudGenAiProvider } from './genai-provider/providers/CloudGenAiProvider';
import { CopilotCliGenAiProvider } from './genai-provider/providers/CopilotCliGenAiProvider';
import { LmApiGenAiProvider } from './genai-provider/providers/LmApiGenAiProvider';
import { SessionStateManager } from './genai-provider/SessionStateManager';
import { SquadManager } from './genai-provider/SquadManager';
import { removeWorktree } from './genai-provider/WorktreeManager';
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
import { LocalApiServer } from './server/LocalApiServer';
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

  const mobileServerPort = 3333;
  const mobileServer = new LocalApiServer(providerRegistry, context.extensionUri.fsPath, vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '');
  let mobileTunnelEnabled = false;
  let mobileTunnel: LocalTunnelNS.Tunnel | undefined;

  const stopMobileTunnel = async (): Promise<void> => {
    if (!mobileTunnel) {
      return;
    }
    try {
      await mobileTunnel.close();
    } catch {
      // no-op
    }
    mobileTunnel = undefined;
  };

  const ensureMobileTunnel = async (): Promise<void> => {
    if (!mobileTunnelEnabled || !mobileServer.isRunning() || mobileTunnel) {
      return;
    }
    const ltModule = await import('localtunnel');
    const ltFn = (ltModule as unknown as {
      default?: (opts: { port: number }) => Promise<LocalTunnelNS.Tunnel>;
      'module.exports'?: (opts: { port: number }) => Promise<LocalTunnelNS.Tunnel>;
    }).default ?? (ltModule as unknown as {
      default?: (opts: { port: number }) => Promise<LocalTunnelNS.Tunnel>;
      'module.exports'?: (opts: { port: number }) => Promise<LocalTunnelNS.Tunnel>;
    })['module.exports'];
    if (!ltFn) {
      throw new Error('localtunnel module did not expose a callable export');
    }
    const tunnel = await ltFn({ port: mobileServer.getPort() });
    mobileTunnel = tunnel;
    tunnel.on('close', () => {
      mobileTunnel = undefined;
    });
  };

  const getMobileStatusPayload = async () => {
    const localIp = getLocalIPv4() ?? '127.0.0.1';
    if (!mobileServer.isRunning()) {
      await stopMobileTunnel();
    } else if (mobileTunnelEnabled) {
      await ensureMobileTunnel();
    }

    const url = mobileTunnelEnabled && mobileTunnel?.url
      ? mobileTunnel.url
      : `http://${localIp}:${mobileServer.getPort()}`;
    const qrSvg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      width: 240,
    });
    return {
      running: mobileServer.isRunning(),
      url,
      devices: mobileServer.getConnectedDevices().map(d => ({ ip: d.ip, lastAccess: d.lastAccess })),
      qrSvg,
      tunnelEnabled: mobileTunnelEnabled,
      tunnelActive: Boolean(mobileTunnel?.url),
      tunnelUrl: mobileTunnel?.url,
    };
  };

  const pushMobileStatus = async (panel: KanbanPanel): Promise<void> => {
    panel.postMessage({ type: 'mobileStatus', ...(await getMobileStatusPayload()) });
  };

  // GitHub service layer (labels, polling, avatars, comments)
  const ghIssueManager = new GitHubIssueManager();
  const prManager = new PullRequestManager();
  context.subscriptions.push(ghIssueManager);

  // Register the content provider for agent-board-git: URIs (used by diff views)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_REF_SCHEME, new GitRefContentProvider()),
  );

  // Register the GitHub provider (uses VSCode SSO + .agent-board/config.json)
  const githubProvider = new GitHubProvider(context, ghIssueManager);
  providerRegistry.register(githubProvider);

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
  const copilotCliGenAi = new CopilotCliGenAiProvider(copilotCliConfig);
  genAiRegistry.register(copilotCliGenAi);

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

  // Cache repo status for the mobile status provider (sync callback)
  let cachedIsGit = false;
  let cachedIsGitHub = false;
  (async () => {
    cachedIsGit = await isGitRepository();
    cachedIsGitHub = await isGitHubRepository();
  })();

  // Provide live status to mobile server API
  mobileServer.setStatusProvider(() => {
    const isGit = cachedIsGit;
    const isGH = cachedIsGitHub;
    const providers = genAiRegistry.getAll().map(p => {
      const entry: { id: string; displayName: string; disabled?: boolean } = { id: p.id, displayName: p.displayName };
      if (!isGit && (p.id === 'copilot-cli' || p.id === 'cloud' || p.id === 'copilot-lm')) {
        entry.disabled = true;
      } else if (!isGH && p.id === 'cloud') {
        entry.disabled = true;
      }
      return entry;
    }).filter(p => !p.disabled);
    const columnOrder = ProjectConfig.getProjectConfig()?.kanban?.columns ?? [...COLUMN_IDS];
    const cols = columnOrder.map((id: string) => ({
      id,
      label: COLUMN_LABELS[id] ?? id,
      color: DEFAULT_COLUMN_COLORS[id],
    }));
    return {
      squadStatus: squadManager.getStatus(),
      providers,
      agents: agentOptions(),
      columns: cols,
      repoIsGit: isGit,
      repoIsGitHub: isGH,
      hiddenTaskIds: ProjectConfig.getProjectConfig()?.hiddenTaskIds ?? [],
    };
  });

  // Handle squad actions from mobile browser
  mobileServer.setSquadActionHandler(async (action, agentSlug, genAiProviderId) => {
    if (action === 'startSquad') {
      await handleStartSquad(squadManager, agentSlug, genAiProviderId);
    } else if (action === 'toggleAutoSquad') {
      handleToggleAutoSquad(squadManager, agentSlug, genAiProviderId);
    }
  });

  // Handle sync/refresh requests from mobile browser
  mobileServer.setRefreshHandler(async () => {
    try {
      await refreshTasksCommand(providerRegistry);
    } catch { /* logged in refreshTasksCommand */ }
  });

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

  // Markdown-backed task provider — opt-in via .agent-board/config.json
  const markdownProvider = new MarkdownProvider();
  providerRegistry.register(markdownProvider);

  // Azure DevOps task provider — opt-in via .agent-board/config.json
  const azureDevOpsProvider = new AzureDevOpsProvider();
  providerRegistry.register(azureDevOpsProvider);

  // Beads task provider — opt-in via .agent-board/config.json
  const beadsProvider = new BeadsProvider();
  providerRegistry.register(beadsProvider);

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
    KanbanPanel.getSerializer(context.extensionUri, context.extensionMode),
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
    const panel = KanbanPanel.createOrShow(context.extensionUri, context.extensionMode);

    // Wire WebView messages FIRST — before any async work — to avoid
    // losing the 'ready' message the webview sends on script load.
    panel.onMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          // Send initial tasks, squad status, available agents, and MCP status
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          panel.updateSquadStatus(squadManager.getStatus());
          panel.updateAgents(agentOptions());
          panel.updateMcpStatus(ProjectConfig.getProjectConfig()?.mcp?.enabled ?? false);
          panel.postMessage({
            type: 'repoStatus',
            isGit: await isGitRepository(),
            isGitHub: await isGitHubRepository(),
            workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            workspaceName: vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '',
          });
          await pushMobileStatus(panel);
          break;
        case 'refreshRequest':
          try {
            await refreshTasksCommand(providerRegistry);
          } catch { /* logged in refreshTasksCommand */ }
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          refreshAgents();
          panel.updateAgents(agentOptions());
          await pushMobileStatus(panel);
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
        case 'toggleMobileServer': {
          if (mobileServer.isRunning()) {
            mobileServer.stop();
            await stopMobileTunnel();
          } else {
            mobileServer.start(mobileServerPort);
            if (mobileTunnelEnabled) {
              await ensureMobileTunnel();
            }
          }
          await pushMobileStatus(panel);
          break;
        }
        case 'setMobileTunnelEnabled': {
          mobileTunnelEnabled = msg.enabled;
          if (!mobileTunnelEnabled) {
            await stopMobileTunnel();
          } else if (mobileServer.isRunning()) {
            await ensureMobileTunnel();
          }
          await pushMobileStatus(panel);
          break;
        }
        case 'refreshMobileStatus': {
          await pushMobileStatus(panel);
          break;
        }
        case 'openMobileCompanion': {
          await pushMobileStatus(panel);
          panel.postMessage({ type: 'mobileDialog', open: true });
          break;
        }
        case 'addTask': {
          const columns = COLUMN_IDS.map(id => ({ id, label: COLUMN_LABELS[id], color: DEFAULT_COLUMN_COLORS[id] }));
          let currentUser = '';
          try {
            const ghSession = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
            if (ghSession) { currentUser = ghSession.account.label; }
          } catch { /* no session */ }
          if (!currentUser) { currentUser = os.userInfo().username || 'me'; }
          panel.postMessage({ type: 'showTaskForm', columns, currentUser });
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
        case 'hideTask': {
          const hiddenIds = ProjectConfig.getProjectConfig()?.hiddenTaskIds ?? [];
          if (!hiddenIds.includes(msg.taskId)) {
            ProjectConfig.updateConfig({ hiddenTaskIds: [...hiddenIds, msg.taskId] });
          }
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
          break;
        }
        case 'exportDoneMd': {
          const configuredCols = ProjectConfig.getProjectConfig()?.kanban?.columns ?? [...COLUMN_IDS];
          const doneColId = configuredCols[configuredCols.length - 1] ?? 'done';
          const allProviders = providerRegistry.getAll().filter(p => p.isEnabled());
          const allTasks = (await Promise.allSettled(allProviders.map(p => p.getTasks())))
            .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
            .flatMap(r => r.value);
          const doneTasks = allTasks.filter(t => t.status === doneColId);
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
              return `| ${i + 1} | ${title} | ${t.providerId} | ${t.labels.join(', ')} | ${t.assignee ?? '\u2014'} |`;
            }),
            ``,
          ];
          const md = lines.join('\n');
          await vscode.env.clipboard.writeText(md);
          vscode.window.showInformationMessage(`Copied ${doneTasks.length} done task(s) to clipboard as Markdown.`);
          break;
        }
        case 'startAgent': {
          runCliAgent(panel, msg.taskId, msg.provider, msg.prompt, genAiRegistry);
          break;
        }
        case 'cancelAgent': {
          cancelCliAgent(msg.taskId);
          break;
        }
        case 'cleanDone': {
          const configuredCols2 = ProjectConfig.getProjectConfig()?.kanban?.columns ?? [...COLUMN_IDS];
          const doneColId2 = configuredCols2[configuredCols2.length - 1] ?? 'done';
          const allProviders2 = providerRegistry.getAll().filter(p => p.isEnabled());
          const allTasks2 = (await Promise.allSettled(allProviders2.map(p => p.getTasks())))
            .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
            .flatMap(r => r.value);
          const doneTasks2 = allTasks2.filter(t => t.status === doneColId2);
          if (doneTasks2.length === 0) { break; }
          const existingHidden = ProjectConfig.getProjectConfig()?.hiddenTaskIds ?? [];
          const newHidden = doneTasks2.map(t => t.id).filter(id => !existingHidden.includes(id));
          if (newHidden.length > 0) {
            ProjectConfig.updateConfig({ hiddenTaskIds: [...existingHidden, ...newHidden] });
          }
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
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
            // Fallback: use custom agent-board-git scheme to resolve git content
            const session = sessionStateManager.getSession(msg.sessionId);
            const wtPath = session?.worktreePath;
            const watchRoot = wtPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (watchRoot) {
              const baseRef = wtPath ? 'main' : 'HEAD';
              const absPath = path.join(watchRoot, msg.filePath);
              const headUri = gitRefUri(watchRoot, msg.filePath, baseRef);
              const workingUri = vscode.Uri.file(absPath);
              await vscode.commands.executeCommand('vscode.diff', headUri, workingUri, `${msg.filePath} (${baseRef} ↔ Working)`);
            }
          }
          break;
        }
        case 'openFullDiff': {
          const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
          if (dw) {
            await dw.openFullDiff(dw.getChanges());
          } else {
            // Fallback: recreate a temporary DiffWatcher to gather changes
            const fdSession = sessionStateManager.getSession(msg.sessionId);
            const wtPath = fdSession?.worktreePath;
            const watchRoot = wtPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (watchRoot) {
              const baseRef = wtPath ? 'main' : 'HEAD';
              const tempDw = new DiffWatcher(watchRoot, baseRef);
              const files = await tempDw.refresh();
              if (files.length > 0) {
                await tempDw.openFullDiff(files);
              } else {
                await vscode.commands.executeCommand('workbench.view.scm');
              }
              tempDw.dispose();
            } else {
              await vscode.commands.executeCommand('workbench.view.scm');
            }
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
        case 'requestFileChanges': {
          // If a DiffWatcher is still alive, refresh it.
          const existingDw = copilotLauncher.getDiffWatcher(msg.sessionId);
          if (existingDw) {
            const files = await existingDw.refresh();
            panel.updateFileChanges(msg.sessionId, files);
          } else {
            // Recreate a one-shot diff from the session's worktree path.
            const fcSession = sessionStateManager.getSession(msg.sessionId);
            const wtPath = fcSession?.worktreePath;
            const watchRoot = wtPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (watchRoot) {
              const baseRef = wtPath ? 'main' : 'HEAD';
              const tempDw = new DiffWatcher(watchRoot, baseRef);
              const files = await tempDw.refresh();
              tempDw.dispose();
              panel.updateFileChanges(msg.sessionId, files);
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
              const mainUri = vscode.Uri.file(absPath).with({
                scheme: 'git',
                query: JSON.stringify({ path: absPath, ref: 'main' }),
              });
              const branchUri = f.statusChar === 'D'
                ? vscode.Uri.file(absPath).with({ scheme: 'git', query: JSON.stringify({ path: absPath, ref: '' }) })
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

            // Move task to next column after successful merge
            const [mergeProviderId] = msg.sessionId.split(':');
            const mergeProvider = providerRegistry.get(mergeProviderId);
            if (mergeProvider) {
              const mergeTasks = await mergeProvider.getTasks();
              const mergeTask = mergeTasks.find(t => t.id === msg.sessionId);
              if (mergeTask) {
                const columnOrder = ProjectConfig.getProjectConfig()?.kanban?.columns ?? [...COLUMN_IDS];
                const currentIdx = columnOrder.indexOf(mergeTask.status);
                const nextCol = currentIdx >= 0 && currentIdx < columnOrder.length - 1
                  ? columnOrder[currentIdx + 1]
                  : columnOrder[columnOrder.length - 1];
                if (mergeTask.status !== nextCol) {
                  await mergeProvider.updateTask({ ...mergeTask, status: nextCol });
                }
              }
            }

            // Persist merged flag on session so it survives reloads
            sessionStateManager.markMerged(msg.sessionId);

            // Refresh tasks to update the UI
            vscode.commands.executeCommand('agentBoard.refreshTasks');
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
              `The branch is **${behindCount}** commit(s) behind main.\n\n` +
              `### Current diff vs main\n\`\`\`\n${mainDiff}\n\`\`\`\n\n` +
              `### Instructions\n` +
              `1. From the worktree directory (${wtPath}), rebase or merge from main to align the branch:\n` +
              `   - Run: cd ${wtPath} && git fetch origin main && git rebase main\n` +
              `2. If there are merge conflicts, resolve them intelligently by understanding both sides\n` +
              `3. After resolving conflicts, ensure the code compiles and tests pass\n` +
              `4. Commit the resolution if needed\n` +
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
              `You are reviewing and merging branch "${branch}" into main.\n` +
              `Strategy: **${strategyLabels[strategy]}**.\n\n` +
              `### Changed files\n\`\`\`\n${diffSummary}\n\`\`\`\n\n` +
              `### Instructions\n` +
              `1. Review all changes in the worktree at ${wtPath}\n` +
              `2. Ensure code quality, check for bugs, security issues, and style\n` +
              `3. If changes are acceptable, perform the merge using the "${strategyLabels[strategy]}" strategy:\n` +
              (strategy === 'squash'
                ? `   - Run: git checkout main && git merge --squash ${branch} && git commit -m "squash: ${branch}"\n`
                : strategy === 'rebase'
                  ? `   - Run: git checkout main && git rebase ${branch}\n`
                  : `   - Run: git checkout main && git merge ${branch} --no-edit\n`) +
              `4. If changes need fixes, apply them first, then merge\n` +
              `5. Report what you found and whether the merge was successful\n`;

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
      }
    });

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

  const openMobileCompanion = vscode.commands.registerCommand('agentBoard.openMobileCompanion', async () => {
    await vscode.commands.executeCommand('agentBoard.openKanban');
    const panel = KanbanPanel.getInstance();
    if (!panel) {
      return;
    }
    await pushMobileStatus(panel);
    panel.postMessage({ type: 'mobileDialog', open: true });
  });

  const openMobileCompanionAlias = vscode.commands.registerCommand('agent-board.openMobileCompanion', async () => {
    await vscode.commands.executeCommand('agentBoard.openMobileCompanion');
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
    openMobileCompanion,
    openMobileCompanionAlias,
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

  context.subscriptions.push({ dispose: () => { void stopMobileTunnel(); mobileServer.stop(); } });
  logger.info('Mobile companion server started on http://localhost:%d', mobileServerPort);
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
const EDITABLE_PROVIDER_IDS = ['json', 'github'];

/**
 * Gather tasks from all providers and push them to the Kanban panel.
 */
async function sendTasksToPanel(panel: KanbanPanel, registry: ProviderRegistry, genAiRegistry?: import('./genai-provider/GenAiProviderRegistry').GenAiProviderRegistry, squadMgr?: SquadManager, sessionStateMgr?: SessionStateManager): Promise<void> {
  const providers = registry.getAll();
  const hiddenIds = new Set(ProjectConfig.getProjectConfig()?.hiddenTaskIds ?? []);
  const allTasks = (
    await Promise.allSettled(providers.map(p => p.getTasks()))
  )
    .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(t => !hiddenIds.has(t.id));

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
  registry: import('./genai-provider/GenAiProviderRegistry').GenAiProviderRegistry,
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

function getLocalIPv4(): string | undefined {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const entry of values ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
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
