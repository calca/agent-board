import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { AgentsTreeProvider, AgentTreeItem } from './agentsTreeProvider';
import { bootstrapGenAi, bootstrapMobile, bootstrapProviders, bootstrapSquad } from './bootstrap';
import { refreshTasksCommand } from './commands/refreshTasks';
import { ProjectConfig } from './config/ProjectConfig';
import { AgentInfo } from './genai-provider/agentDiscovery';
import { GenAiProviderRegistry } from './genai-provider/GenAiProviderRegistry';
import { mapEventToBlock } from './genai-provider/providers/copilot-sdk/eventMapper';
import { PullRequestManager } from './github/PullRequestManager';
import { KanbanPanel } from './kanban/KanbanPanel';
import { McpRegistration } from './mcp/McpRegistration';
import { wireMessageDispatcher } from './MessageDispatcher';
import { OverviewTreeProvider } from './overviewTreeProvider';
import type { ITaskProvider } from './providers/ITaskProvider';
import { ProviderPicker } from './providers/ProviderPicker';
import { SettingsPanel } from './settings/SettingsPanel';
import { TaskTreeItem } from './tasksTreeProvider';
import { buildColumnOrder, DEFAULT_COLUMN_COLORS, DEFAULT_COLUMN_LABELS } from './types/ColumnId';
import { Logger, LogLevel } from './utils/logger';
import { handleStartSquad, handleToggleAutoSquad, sendTasksToPanel, updateStatusBar } from './utils/panelHelpers';
import { isAzureDevOpsRepository, isGitHubRepository, isGitRepository } from './utils/repoDetection';

export function activate(context: vscode.ExtensionContext): void {
  const logger = Logger.getInstance();
  logger.info('Agent Board activating…');

  // ── Bootstrap infrastructure ───────────────────────────────────────────

  const { providerRegistry, githubProvider, jsonProvider } = bootstrapProviders(context);
  const { genAiRegistry } = bootstrapGenAi();
  const { mobileServer, getMobileStatusPayload, setTunnelEnabled, isTunnelEnabled, ensureMobileTunnel, stopMobileTunnel } = bootstrapMobile(context.extensionUri.fsPath, vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '', providerRegistry);
  const { sessionStateManager, copilotLauncher, modelSelector, squadManager, agentOptions, getSquadTeams, refreshAgents, getDiscoveredAgents } = bootstrapSquad(context, providerRegistry, genAiRegistry);

  const providerPicker = new ProviderPicker(providerRegistry, context);

  const pushMobileStatus = async (panel: KanbanPanel): Promise<void> => {
    panel.postMessage({ type: 'mobileStatus', ...(await getMobileStatusPayload()) });
  };

  // GitHub service layer
  const prManager = new PullRequestManager();

  // ── MCP server registration ────────────────────────────────────────────

  const mcpRegistration = new McpRegistration(context.extensionPath);
  context.subscriptions.push(mcpRegistration);
  mcpRegistration.register();
  mcpRegistration.setEnabled(ProjectConfig.getProjectConfig()?.mcp?.enabled ?? false);

  // Wire session state changes → refresh overview + kanban
  sessionStateManager.onDidChangeState(({ taskId, state }) => {
    logger.info('SessionState changed: %s → %s', taskId, state);
    overviewProvider.refresh();
  });

  // Watch .github/agents/ for changes and auto-refresh agents
  const agentsPattern = new vscode.RelativePattern(
    vscode.workspace.workspaceFolders![0],
    '.github/agents/*.md'
  );
  const agentsWatcher = vscode.workspace.createFileSystemWatcher(agentsPattern);
  const onAgentsChanged = () => {
    refreshAgents();
    const activePanel = KanbanPanel.getInstance();
    if (activePanel) {
      activePanel.updateAgents(agentOptions(), getSquadTeams());
    }
  };
  agentsWatcher.onDidCreate(onAgentsChanged);
  agentsWatcher.onDidDelete(onAgentsChanged);
  agentsWatcher.onDidChange(onAgentsChanged);
  context.subscriptions.push(agentsWatcher);

  // Watch config file for squad team changes (debounced to avoid re-render storms)
  const configPattern = new vscode.RelativePattern(
    vscode.workspace.workspaceFolders![0],
    '.agent-board/config.json'
  );
  const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);
  let configDebounce: ReturnType<typeof setTimeout> | undefined;
  const onConfigChanged = () => {
    if (configDebounce) { clearTimeout(configDebounce); }
    configDebounce = setTimeout(() => {
      const activePanel = KanbanPanel.getInstance();
      if (activePanel) {
        activePanel.updateAgents(agentOptions(), getSquadTeams());
      }
    }, 500);
  };
  configWatcher.onDidCreate(onConfigChanged);
  configWatcher.onDidChange(onConfigChanged);
  context.subscriptions.push(configWatcher);

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
      if (!isGit && p.requiresGit) {
        entry.disabled = true;
      } else if (!isGH && p.requiresGitHub) {
        entry.disabled = true;
      }
      return entry;
    }).filter(p => !p.disabled);
    const columnOrder = buildColumnOrder(ProjectConfig.getProjectConfig()?.kanban?.intermediateColumns);
    const cols = columnOrder.map((id: string) => ({
      id,
      label: DEFAULT_COLUMN_LABELS[id] ?? id,
      color: DEFAULT_COLUMN_COLORS[id],
    }));
    return {
      squadStatus: squadManager.getStatus(),
      providers,
      agents: agentOptions(),
      columns: cols,
      repoIsGit: isGit,
      repoIsGitHub: isGH,
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

  // Refresh overview and mobile companion panel when a new mobile device connects
  mobileServer.onDeviceChange(() => {
    overviewProvider.refresh();
    const activePanel = KanbanPanel.getInstance();
    if (activePanel) {
      void pushMobileStatus(activePanel);
    }
  });

  // Re-read log level when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agentBoard.logLevel')) {
        logger.refreshLevel();
        logger.info('Log level changed to %s', LogLevel[logger.getLevel()]);
      }
    }),
  );

  // ── Internal stores ────────────────────────────────────────────────────

  const agentManager = new AgentManager(context, providerRegistry);

  // Overview sidebar view
  const overviewProvider = new OverviewTreeProvider(providerRegistry, squadManager, mobileServer);

  const overviewView = vscode.window.createTreeView('agentBoardOverview', {
    treeDataProvider: overviewProvider,
    showCollapseAll: false,
  });

  // Ensure the overview refreshes once providers are ready
  setTimeout(() => overviewProvider.refresh(), 2000);

  // Keep old providers for internal use (agents, task store)
  const agentsProvider = new AgentsTreeProvider(agentManager);

  // Status bar item showing pending task count
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'agentBoard.openKanban';

  function syncStatusBars(): void {
    void updateStatusBar(statusBarItem, providerRegistry, squadManager);
    modelSelector.updateSquadStatus(squadManager.getStatus());
  }

  syncStatusBars();
  statusBarItem.show();

  function refresh(): void {
    overviewProvider.refresh();
    agentsProvider.refresh();
    syncStatusBars();
  }

  // Auto-refresh overview when squad status changes
  squadManager.onDidChangeStatus(() => {
    overviewProvider.refresh();
    syncStatusBars();
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
    wireMessageDispatcher({
      panel,
      providerRegistry,
      genAiRegistry,
      squadManager,
      sessionStateManager,
      copilotLauncher,
      jsonProvider,
      prManager,
      agentOptions,
      getSquadTeams,
      refreshAgents,
      refresh,
      syncStatusBars,
      setSelectedGenAiProvider: (providerId: string) => modelSelector.setProviderId(providerId),
      pushMobileStatus: (p) => pushMobileStatus(p),
      mcpRegistration,
    });

    // Mobile-server-specific messages (require direct mobileServer ref)
    panel.onMessage(async (msg) => {
      switch (msg.type) {
        case 'toggleMobileServer':
          if (mobileServer.isRunning()) {
            mobileServer.stop();
            await stopMobileTunnel();
          } else {
            mobileServer.start(mobileServer.getPort());
            if (isTunnelEnabled()) {
              await ensureMobileTunnel();
            }
          }
          await pushMobileStatus(panel);
          overviewProvider.refresh();
          break;
        case 'setMobileTunnelEnabled':
          setTunnelEnabled(msg.enabled);
          if (!isTunnelEnabled()) {
            await stopMobileTunnel();
          } else if (mobileServer.isRunning()) {
            await ensureMobileTunnel();
          }
          await pushMobileStatus(panel);
          break;
        case 'refreshMobileStatus':
          await pushMobileStatus(panel);
          break;
        case 'openMobileCompanion':
          await pushMobileStatus(panel);
          panel.postMessage({ type: 'mobileDialog', open: true });
          break;
      }
    });

    // Auto-refresh board when squad session state changes (background completion/failure)
    const squadSub = squadManager.onDidChangeStatus(async () => {
      panel.updateSquadStatus(squadManager.getStatus());
      await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
      syncStatusBars();
    });
    panel.onDispose(() => squadSub.dispose());

    // Auto-PR when a squad session completes (if squad.autoPR is enabled)
    const squadPRSub = squadManager.onSessionCompleted(async ({ taskId, autoPR }) => {
      if (!autoPR) { return; }
      const allProviders = providerRegistry.getAll().filter(p => p.isEnabled());
      const allTasks = (await Promise.allSettled(allProviders.map(p => p.getTasks())))
        .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);
      const task = allTasks.find(t => t.id === taskId);
      if (!task) { return; }

      const worktreeBranch = task.copilotSession?.changedFiles && task.copilotSession.changedFiles.length > 0
        ? `agent-board/${taskId.replace(/[^a-zA-Z0-9-]/g, '-')}`
        : undefined;
      if (!worktreeBranch) { return; }

      const isAzure = await isAzureDevOpsRepository();
      const dw = copilotLauncher.getDiffWatcher(taskId);
      const changedFiles = dw?.getChanges() ?? [];
      const diffSummary = changedFiles.length > 0
        ? `### Files changed\n\n${changedFiles.map(f => `- \`${f.path}\``).join('\n')}`
        : '';
      const pr = await prManager.createPR({
        title: task.title,
        body: `Closes #${task.nativeId}\n\n${diffSummary}`,
        headBranch: worktreeBranch,
        isAzureDevOps: isAzure,
      });
      if (pr) {
        const provider = providerRegistry.get(task.providerId);
        if (provider) {
          const updatedTask = { ...task };
          if (updatedTask.copilotSession) {
            updatedTask.copilotSession = { ...updatedTask.copilotSession, prUrl: pr.url, prNumber: pr.number, prState: pr.state };
          }
          await provider.updateTask(updatedTask);
        }
        panel.postMessage({ type: 'createPullRequestResult', sessionId: taskId, success: true, prUrl: pr.url, prNumber: pr.number });
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
      }
    });
    panel.onDispose(() => squadPRSub.dispose());

    // Auto-refresh board when session state changes (worktree creation, running, done, error)
    const sessionSub = sessionStateManager.onDidChangeState(async () => {
      await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
      syncStatusBars();
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

    // Forward structured CopilotEvent from providers → webview chat blocks
    const copilotEventSub = copilotLauncher.onDidCopilotEvent(({ sessionId, event }) => {
      if (event.type === 'start') {
        panel.notifyChatStart(sessionId);
        return;
      }
      if (event.type === 'end') {
        panel.notifyChatEnd(sessionId);
        return;
      }
      const block = mapEventToBlock(event);
      if (block) {
        panel.appendChatBlock(sessionId, block);
      }
    });
    panel.onDispose(() => copilotEventSub.dispose());

    // Forward board events (prompt, state changes) → webview chat
    const boardEventSub = copilotLauncher.onDidBoardEvent(({ sessionId, kind, text }) => {
      if (kind === 'prompt') {
        panel.sendChatPrompt(sessionId, text);
      } else {
        panel.sendChatBoardEvent(sessionId, text);
      }
    });
    panel.onDispose(() => boardEventSub.dispose());

    // Forward DiffWatcher file-change events → webview (live, via onDidChangeDiff)
    const diffSub = copilotLauncher.onDidChangeDiff(({ sessionId, files }) => {
      panel.updateFileChanges(sessionId, files);
    });
    panel.onDispose(() => diffSub.dispose());

    // GitHub 30-second polling: detect remote changes, refresh board
    const isGH = await isGitHubRepository();
    if (isGH) {
      void githubProvider.ensureKanbanLabels();
      githubProvider.startPolling(30_000);
      const ghPollSub = githubProvider.onDidDetectRemoteChange(async () => {
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        syncStatusBars();
      });
      panel.onDispose(() => {
        githubProvider.stopPolling();
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
    await modelSelector.setProviderId(genAiProviderId);
    const agentSlug = await pickAgent(getDiscoveredAgents());
    await handleStartSquad(squadManager, agentSlug, genAiProviderId);
    syncStatusBars();
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
    await modelSelector.setProviderId(genAiProviderId);
    const agentSlug = await pickAgent(getDiscoveredAgents());
    handleToggleAutoSquad(squadManager, agentSlug, genAiProviderId);
    syncStatusBars();
  });

  const toggleMaximize = vscode.commands.registerCommand('agentBoard.toggleMaximize', () => {
    vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
  });

  const openSettings = vscode.commands.registerCommand('agentBoard.openSettings', () => {
    SettingsPanel.createOrShow(context.extensionUri, providerRegistry, genAiRegistry, getDiscoveredAgents);
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
  logger.info('Mobile companion server started on http://localhost:%d', mobileServer.getPort());
  logger.info('Agent Board activated — %d subscriptions registered', context.subscriptions.length);
}

export function deactivate(): void {
  Logger.getInstance().info('Agent Board deactivating');
  Logger.getInstance().dispose();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Show a Quick Pick for selecting the GenAI provider for the squad.
 */
async function pickGenAiProvider(
  registry: GenAiProviderRegistry,
  isGit: boolean,
  isGitHub: boolean,
): Promise<string | undefined> {
  const items = registry.getAll()
    .filter(p => {
      if (p.canSquad === false) { return false; }
      if (!isGit && p.requiresGit) { return false; }
      if (!isGitHub && p.requiresGitHub) { return false; }
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

  return selected?.slug ?? squadAgents[0]?.slug;
}
