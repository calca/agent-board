import { exec } from 'child_process';
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
import { KanbanPanel } from './kanban/KanbanPanel';
import { OverviewTreeProvider } from './overviewTreeProvider';
import { GitHubProvider } from './providers/GitHubProvider';
import { ITaskProvider } from './providers/ITaskProvider';
import { JsonProvider } from './providers/JsonProvider';
import { ProviderPicker } from './providers/ProviderPicker';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { TaskStore } from './taskStore';
import { TaskTreeItem } from './tasksTreeProvider';
import { COLUMN_IDS, COLUMN_LABELS } from './types/ColumnId';
import { AgentOption, GenAiProviderOption } from './types/Messages';
import { Logger } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
  const logger = Logger.getInstance();
  logger.info('Agent Board activating…');

  // ── Provider infrastructure ────────────────────────────────────────────

  const providerRegistry = new ProviderRegistry();
  const providerPicker = new ProviderPicker(providerRegistry, context);

  // Register the GitHub provider (uses VSCode SSO + .agent-board/config.json)
  const githubProvider = new GitHubProvider(context);
  providerRegistry.register(githubProvider);

  // ── GenAI provider infrastructure ─────────────────────────────────────

  const genAiRegistry = new GenAiProviderRegistry();

  // Global providers (VS Code integrated) — always registered
  genAiRegistry.register(new ChatGenAiProvider());
  genAiRegistry.register(new CloudGenAiProvider());
  genAiRegistry.register(new LmApiGenAiProvider());

  // Copilot CLI — pass per-project config (yolo / fleet), falling back to VS Code settings
  const copilotCliCfg = ProjectConfig.getProjectConfig()?.genAiProviders?.['copilot-cli'];
  const copilotCliConfig = {
    ...copilotCliCfg,
    yolo: copilotCliCfg?.yolo ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('copilotCli.yolo', true),
    fleet: copilotCliCfg?.fleet ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('copilotCli.fleet', false),
  };
  genAiRegistry.register(new CopilotCliGenAiProvider(copilotCliConfig));

  // ── Copilot infrastructure ─────────────────────────────────────────────

  const copilotLauncher = new CopilotLauncher(providerRegistry, context, genAiRegistry);
  const modelSelector = new ModelSelector(context, genAiRegistry);
  const squadManager = new SquadManager(
    providerRegistry,
    copilotLauncher,
    () => modelSelector.getProviderId(),
  );

  // ── Session state manager ──────────────────────────────────────────────

  const sessionStateManager = new SessionStateManager(context);

  // Wire session state changes → refresh overview + kanban
  sessionStateManager.onDidChangeState(({ taskId, state }) => {
    logger.info('SessionState changed: %s → %s', taskId, state);
    overviewProvider.refresh();
  });

  // ── Agent discovery ────────────────────────────────────────────────────

  let discoveredAgents: AgentInfo[] = [];
  const agentOptions = (): AgentOption[] =>
    discoveredAgents.map(a => ({ slug: a.slug, displayName: a.displayName }));

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
      await sendTasksToPanel(activePanel, providerRegistry, genAiRegistry, squadManager);
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
    const panel = KanbanPanel.createOrShow(context.extensionUri);

    // Auto-refresh board when squad session state changes (background completion/failure)
    const squadSub = squadManager.onDidChangeStatus(async () => {
      panel.updateSquadStatus(squadManager.getStatus());
      await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
    });
    panel.onDispose(() => squadSub.dispose());

    // Wire WebView messages
    panel.onMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          // Send initial tasks, squad status, available agents, and MCP status
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
          panel.updateSquadStatus(squadManager.getStatus());
          panel.updateAgents(agentOptions());
          panel.updateMcpStatus(ProjectConfig.getProjectConfig()?.mcp?.enabled ?? false);
          panel.postMessage({
            type: 'repoStatus',
            isGit: await isGitRepository(),
            isGitHub: await isGitHubRepository(),
          });
          break;
        case 'refreshRequest':
          await refreshTasksCommand(providerRegistry);
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
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
            }
          }
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
          break;
        }
        case 'openCopilot':
          await squadManager.launchSingle(msg.taskId, msg.providerId, msg.agentSlug);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
          break;
        case 'startSquad': {
          await handleStartSquad(squadManager, msg.agentSlug);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
          break;
        }
        case 'toggleAutoSquad': {
          handleToggleAutoSquad(squadManager, msg.agentSlug);
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
          const columns = COLUMN_IDS.map(id => ({ id, label: COLUMN_LABELS[id] }));
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
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
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
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
          break;
        }
        case 'launchProvider': {
          await squadManager.launchSingle(msg.taskId, msg.genAiProviderId, undefined);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager);
          break;
        }
        case 'reopenSession': {
          // Focus the VS Code chat panel so the user can see the running session
          await vscode.commands.executeCommand('workbench.action.chat.open');
          break;
        }
        case 'openDiff': {
          // Open diff editor for a single file via any active DiffWatcher
          const streamReg = copilotLauncher.getStreamRegistry();
          for (const sid of streamReg.sessionIds) {
            const dw = copilotLauncher.getDiffWatcher(sid);
            if (dw) {
              await dw.openDiff(msg.filePath);
              break;
            }
          }
          break;
        }
        case 'openFullDiff': {
          await vscode.commands.executeCommand('workbench.view.scm');
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
        case 'sendFollowUp': {
          // Open chat with the follow-up text
          await vscode.commands.executeCommand('workbench.action.chat.open', { query: msg.text });
          break;
        }
      }
    });
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
    const agentSlug = await pickAgent(discoveredAgents);
    await handleStartSquad(squadManager, agentSlug);
  });

  const toggleAutoSquad = vscode.commands.registerCommand('agentBoard.toggleAutoSquad', async () => {
    logger.info('toggleAutoSquad command invoked');
    const agentSlug = await pickAgent(discoveredAgents);
    handleToggleAutoSquad(squadManager, agentSlug);
  });

  const toggleMaximize = vscode.commands.registerCommand('agentBoard.toggleMaximize', () => {
    vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
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
const EDITABLE_PROVIDER_IDS = ['json', 'github'];

/**
 * Gather tasks from all providers and push them to the Kanban panel.
 */
async function sendTasksToPanel(panel: KanbanPanel, registry: ProviderRegistry, genAiRegistry?: import('./copilot/GenAiProviderRegistry').GenAiProviderRegistry, squadMgr?: SquadManager): Promise<void> {
  const providers = registry.getAll();
  const allTasks = (
    await Promise.allSettled(providers.map(p => p.getTasks()))
  )
    .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Inject active session info into tasks so the webview can show status
  if (squadMgr) {
    const sessions = squadMgr.getActiveSessions();
    for (const task of allTasks) {
      const session = sessions.get(task.id);
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
async function handleStartSquad(squadManager: SquadManager, agentSlug?: string): Promise<void> {
  const launched = await squadManager.startSquad(agentSlug);
  vscode.window.showInformationMessage(
    `Squad: launched ${launched} session${launched === 1 ? '' : 's'}.`,
  );
}

/**
 * Handle toggling auto-squad — shared between command and WebView handler.
 */
function handleToggleAutoSquad(squadManager: SquadManager, agentSlug?: string): void {
  const enabled = squadManager.toggleAutoSquad(agentSlug);
  vscode.window.showInformationMessage(
    `Auto-squad ${enabled ? 'enabled' : 'disabled'}.`,
  );
}

/**
 * Show a Quick Pick for selecting an agent when invoked from the command palette.
 * Returns `undefined` if no agents are available or the user cancels.
 */
async function pickAgent(agents: AgentInfo[]): Promise<string | undefined> {
  if (agents.length === 0) {
    return undefined;
  }

  const items = [
    { label: '$(dash) None', description: 'No agent', slug: undefined as string | undefined },
    ...agents.map(a => ({
      label: `$(hubot) ${a.displayName}`,
      description: a.slug,
      slug: a.slug as string | undefined,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an agent (optional)',
  });

  return selected?.slug;
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

    if (!isGit && (p.id === 'copilot-cli' || p.id === 'cloud')) {
      option.disabled = true;
      option.disabledReason = 'Requires a git repository';
    } else if (!isGitHub && p.id === 'cloud') {
      option.disabled = true;
      option.disabledReason = 'Requires a GitHub repository';
    }

    return option;
  });
}
