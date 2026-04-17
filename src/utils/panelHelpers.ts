import * as vscode from 'vscode';
import { HiddenTasksStore } from '../config/HiddenTasksStore';
import { LocalNotesStore } from '../config/LocalNotesStore';
import { ProjectConfig } from '../config/ProjectConfig';
import type { GenAiProviderRegistry } from '../genai-provider/GenAiProviderRegistry';
import type { SessionStateManager } from '../genai-provider/SessionStateManager';
import type { SquadManager } from '../genai-provider/SquadManager';
import type { KanbanPanel } from '../kanban/KanbanPanel';
import type { ITaskProvider } from '../providers/ITaskProvider';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { KanbanTask } from '../types/KanbanTask';
import type { GenAiProviderOption } from '../types/Messages';
import { isGitHubRepository, isGitRepository } from './repoDetection';

/** Provider IDs whose tasks support full inline editing. */
export const EDITABLE_PROVIDER_IDS = ['json', 'github'];

/**
 * Gather tasks from all providers and push them to the Kanban panel.
 */
export async function sendTasksToPanel(
  panel: KanbanPanel,
  registry: ProviderRegistry,
  genAiRegistry?: GenAiProviderRegistry,
  squadMgr?: SquadManager,
  sessionStateMgr?: SessionStateManager,
): Promise<void> {
  const providers = registry.getAll();
  const allTasks = HiddenTasksStore.filterVisible(
    (await Promise.allSettled(providers.map(p => p.getTasks())))
      .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
      .flatMap(r => r.value),
  );

  // Inject session info into tasks so the webview can show status, worktree, errors
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

  // Inject local notes into task.meta so the webview has them without round-trips
  const localNotes = LocalNotesStore.getAll();
  for (const task of allTasks) {
    const notes = localNotes[task.id];
    if (notes) {
      (task.meta as Record<string, unknown>).localNotes = notes;
    }
  }

  const genAiOptions = genAiRegistry
    ? await buildGenAiOptions(genAiRegistry)
    : [];
  panel.updateTasks(allTasks, EDITABLE_PROVIDER_IDS, genAiOptions);
}

/**
 * Build the GenAI provider options list, disabling providers
 * that require git or GitHub when the workspace doesn't qualify.
 */
export async function buildGenAiOptions(registry: GenAiProviderRegistry): Promise<GenAiProviderOption[]> {
  const isGit = await isGitRepository();
  const isGitHub = await isGitHubRepository();
  const genAiCfg = ProjectConfig.getProjectConfig()?.genAiProviders ?? {};

  return registry.getAll()
    .filter(p => {
      const entry = genAiCfg[p.id];
      if (p.scope === 'global') { return entry?.enabled !== false; }
      return entry?.enabled === true;
    })
    .map(p => {
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

/**
 * Handle starting a squad session — shared between command and WebView handler.
 */
export async function handleStartSquad(squadManager: SquadManager, agentSlug?: string, genAiProviderId?: string, baseBranch?: string): Promise<void> {
  const launched = await squadManager.startSquad(agentSlug, genAiProviderId, baseBranch);
  vscode.window.showInformationMessage(
    `Squad: launched ${launched} session${launched === 1 ? '' : 's'}.`,
  );
}

/**
 * Handle toggling auto-squad — shared between command and WebView handler.
 */
export function handleToggleAutoSquad(squadManager: SquadManager, agentSlug?: string, genAiProviderId?: string, baseBranch?: string): void {
  const enabled = squadManager.toggleAutoSquad(agentSlug, genAiProviderId, baseBranch);
  vscode.window.showInformationMessage(
    `Auto-squad ${enabled ? 'enabled' : 'disabled'}.`,
  );
}

export function updateStatusBar(item: vscode.StatusBarItem, provider: ITaskProvider): Promise<void> {
  return provider.getTasks().then(tasks => {
    const pending = tasks.filter(t => t.status !== 'done').length;
    item.text = pending > 0 ? `$(tasklist) ${pending} task${pending === 1 ? '' : 's'}` : '$(tasklist) Agent Board';
    item.tooltip = pending > 0 ? `${pending} pending task${pending === 1 ? '' : 's'} – click to add` : 'Agent Board – click to add a task';
  });
}
