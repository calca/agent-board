import * as vscode from 'vscode';
import { TaskStore } from './taskStore';
import { AgentManager } from './agentManager';
import { TasksTreeProvider, TaskTreeItem } from './tasksTreeProvider';
import { AgentsTreeProvider, AgentTreeItem } from './agentsTreeProvider';
import { Logger } from './utils/logger';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { ProviderPicker } from './providers/ProviderPicker';
import { AggregatorProvider } from './providers/AggregatorProvider';
import { refreshTasksCommand } from './commands/refreshTasks';
import { KanbanPanel } from './kanban/KanbanPanel';
import { CopilotLauncher } from './copilot/CopilotLauncher';
import { ModelSelector } from './copilot/ModelSelector';
import { SquadManager } from './copilot/SquadManager';
import { registerChatParticipant } from './copilot/ChatParticipant';
import { GitHubProvider } from './providers/GitHubProvider';
import { GenAiProviderRegistry } from './copilot/GenAiProviderRegistry';
import { ChatGenAiProvider } from './copilot/providers/ChatGenAiProvider';
import { CloudGenAiProvider } from './copilot/providers/CloudGenAiProvider';
import { CopilotCliGenAiProvider } from './copilot/providers/CopilotCliGenAiProvider';
import { OllamaGenAiProvider } from './copilot/providers/OllamaGenAiProvider';
import { MistralGenAiProvider } from './copilot/providers/MistralGenAiProvider';
import { ProjectConfig } from './config/ProjectConfig';
import { discoverAgents, AgentInfo } from './copilot/agentDiscovery';
import { AgentOption } from './types/Messages';

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
  genAiRegistry.register(new CopilotCliGenAiProvider());

  // Project providers — registered only when enabled in config
  registerProjectGenAiProviders(genAiRegistry);

  // ── Copilot infrastructure ─────────────────────────────────────────────

  const copilotLauncher = new CopilotLauncher(providerRegistry, context, genAiRegistry);
  const modelSelector = new ModelSelector(context, genAiRegistry);
  const squadManager = new SquadManager(
    providerRegistry,
    copilotLauncher,
    () => modelSelector.getProviderId(),
  );

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

  // Tree views
  const tasksProvider = new TasksTreeProvider(taskStore);
  const agentsProvider = new AgentsTreeProvider(agentManager);

  const tasksView = vscode.window.createTreeView('agentBoardTasks', {
    treeDataProvider: tasksProvider,
    showCollapseAll: false,
  });

  const agentsView = vscode.window.createTreeView('agentBoardAgents', {
    treeDataProvider: agentsProvider,
    showCollapseAll: false,
  });

  // Status bar item showing pending task count
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'agentBoard.addTask';
  updateStatusBar(statusBarItem, taskStore);
  statusBarItem.show();

  function refresh(): void {
    tasksProvider.refresh();
    agentsProvider.refresh();
    updateStatusBar(statusBarItem, taskStore);
  }

  // ── WebView panel serializer ───────────────────────────────────────────

  vscode.window.registerWebviewPanelSerializer(
    KanbanPanel.viewType,
    KanbanPanel.getSerializer(context.extensionUri),
  );

  // ── Commands ───────────────────────────────────────────────────────────

  const addTask = vscode.commands.registerCommand('agentBoard.addTask', async () => {
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
    taskStore.addTask(title.trim(), description?.trim() || undefined);
    refresh();
    vscode.window.showInformationMessage(`Task "${title}" added.`);
  });

  const editTask = vscode.commands.registerCommand('agentBoard.editTask', async (item?: TaskTreeItem) => {
    const task = item?.task ?? (await pickTask(taskStore));
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
      value: task.description ?? '',
    });
    taskStore.updateTask(task.id, {
      title: newTitle.trim(),
      description: newDesc?.trim() || undefined,
    });
    refresh();
  });

  const completeTask = vscode.commands.registerCommand('agentBoard.completeTask', async (item?: TaskTreeItem) => {
    const task = item?.task ?? (await pickTask(taskStore, 'pending'));
    if (!task) {
      return;
    }
    taskStore.completeTask(task.id);
    refresh();
    vscode.window.showInformationMessage(`Task "${task.title}" marked as complete.`);
  });

  const deleteTask = vscode.commands.registerCommand('agentBoard.deleteTask', async (item?: TaskTreeItem) => {
    const task = item?.task ?? (await pickTask(taskStore));
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
    taskStore.deleteTask(task.id);
    refresh();
  });

  const refreshTasks = vscode.commands.registerCommand('agentBoard.refreshTasks', async () => {
    refresh();
    await refreshTasksCommand(providerRegistry);
  });

  // ── Kanban / Provider / Copilot commands ─────────────────────────────

  const openKanban = vscode.commands.registerCommand('agentBoard.openKanban', async () => {
    logger.info('openKanban command invoked');
    const panel = KanbanPanel.createOrShow(context.extensionUri);

    // Wire WebView messages
    panel.onMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          // Send initial tasks, squad status, and available agents
          await sendTasksToPanel(panel, providerRegistry);
          panel.updateSquadStatus(squadManager.getStatus());
          panel.updateAgents(agentOptions());
          break;
        case 'refreshRequest':
          await refreshTasksCommand(providerRegistry);
          await sendTasksToPanel(panel, providerRegistry);
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
          await sendTasksToPanel(panel, providerRegistry);
          break;
        }
        case 'openCopilot':
          await copilotLauncher.launch(msg.taskId, msg.providerId, msg.agentSlug);
          break;
        case 'startSquad': {
          await handleStartSquad(squadManager, msg.agentSlug);
          panel.updateSquadStatus(squadManager.getStatus());
          await sendTasksToPanel(panel, providerRegistry);
          break;
        }
        case 'toggleAutoSquad': {
          handleToggleAutoSquad(squadManager, msg.agentSlug);
          panel.updateSquadStatus(squadManager.getStatus());
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

    const pendingTasks = taskStore.getTasksByStatus('pending');
    let taskId: string | undefined;
    if (pendingTasks.length > 0) {
      const pick = await vscode.window.showQuickPick(
        [
          { label: '(none)', description: 'Run without a linked task', id: undefined as string | undefined },
          ...pendingTasks.map(t => ({ label: t.title, description: t.description ?? '', id: t.id })),
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
    tasksView,
    agentsView,
    statusBarItem,
    addTask,
    editTask,
    completeTask,
    deleteTask,
    refreshTasks,
    runAgent,
    stopAgent,
    openKanban,
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

function updateStatusBar(item: vscode.StatusBarItem, taskStore: TaskStore): void {
  const pending = taskStore.getTasksByStatus('pending').length;
  item.text = pending > 0 ? `$(tasklist) ${pending} task${pending === 1 ? '' : 's'}` : '$(tasklist) Agent Board';
  item.tooltip = pending > 0 ? `${pending} pending task${pending === 1 ? '' : 's'} – click to add` : 'Agent Board – click to add a task';
}

async function pickTask(taskStore: TaskStore, status?: 'pending' | 'completed') {
  const tasks = status ? taskStore.getTasksByStatus(status) : taskStore.getTasks();
  if (tasks.length === 0) {
    vscode.window.showInformationMessage('No tasks found.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    tasks.map(t => ({ label: t.title, description: t.status, task: t })),
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
 * Gather tasks from all providers and push them to the Kanban panel.
 */
async function sendTasksToPanel(panel: KanbanPanel, registry: ProviderRegistry): Promise<void> {
  const providers = registry.getAll();
  const allTasks = (
    await Promise.allSettled(providers.map(p => p.getTasks()))
  )
    .filter((r): r is PromiseFulfilledResult<import('./types/KanbanTask').KanbanTask[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);

  panel.updateTasks(allTasks);
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

/**
 * Register project-scoped GenAI providers based on `.agent-board/config.json`.
 *
 * Global providers (chat, cloud, copilot-cli) are always registered.
 * Project providers (ollama, mistral) are only registered when explicitly
 * enabled in the project config.
 */
function registerProjectGenAiProviders(genAiRegistry: GenAiProviderRegistry): void {
  const logger = Logger.getInstance();
  const projectCfg = ProjectConfig.getProjectConfig();
  const providers = projectCfg?.genAiProviders;
  if (!providers) {
    return;
  }

  for (const [id, entry] of Object.entries(providers)) {
    // Skip global providers — they are always registered above
    if (GLOBAL_GENAI_PROVIDER_IDS.includes(id)) {
      continue;
    }

    if (!entry.enabled) {
      continue;
    }

    try {
      switch (id) {
        case 'ollama':
          genAiRegistry.register(new OllamaGenAiProvider(entry));
          logger.info(`Registered project GenAI provider: ${id}`);
          break;
        case 'mistral':
          genAiRegistry.register(new MistralGenAiProvider(entry));
          logger.info(`Registered project GenAI provider: ${id}`);
          break;
        default:
          logger.info(`Unknown GenAI provider "${id}" in config — skipped`);
          break;
      }
    } catch (err) {
      logger.error(`Failed to register GenAI provider "${id}":`, String(err));
    }
  }
}
