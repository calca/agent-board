import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { AgentInfo, discoverAgents } from '../genai-provider/agentDiscovery';
import { CopilotLauncher } from '../genai-provider/CopilotLauncher';
import { GenAiProviderRegistry } from '../genai-provider/GenAiProviderRegistry';
import { ModelSelector } from '../genai-provider/ModelSelector';
import { SessionStateManager } from '../genai-provider/SessionStateManager';
import { SquadManager } from '../genai-provider/SquadManager';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { AgentOption, SquadTeam } from '../types/Messages';
import { Logger } from '../utils/logger';

export interface SquadBootstrapResult {
  sessionStateManager: SessionStateManager;
  copilotLauncher: CopilotLauncher;
  modelSelector: ModelSelector;
  squadManager: SquadManager;
  agentOptions: () => AgentOption[];
  getSquadTeams: () => SquadTeam[];
  refreshAgents: () => void;
  getDiscoveredAgents: () => AgentInfo[];
}

/**
 * Creates SessionStateManager, CopilotLauncher, ModelSelector, SquadManager,
 * restores interrupted sessions, and sets up agent discovery.
 */
export function bootstrapSquad(
  context: vscode.ExtensionContext,
  providerRegistry: ProviderRegistry,
  genAiRegistry: GenAiProviderRegistry,
): SquadBootstrapResult {
  const logger = Logger.getInstance();

  const sessionStateManager = new SessionStateManager(context);

  const copilotLauncher = new CopilotLauncher(providerRegistry, context, genAiRegistry, [], sessionStateManager);
  const modelSelector = new ModelSelector(context, genAiRegistry);
  const squadManager = new SquadManager(
    providerRegistry,
    copilotLauncher,
    () => modelSelector.getProviderId(),
    genAiRegistry,
  );

  // Restore any sessions that were interrupted when VS Code was last closed.
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

  const getSquadTeams = (): SquadTeam[] =>
    ProjectConfig.getProjectConfig()?.squad?.teams ?? [];

  function refreshAgents(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      discoveredAgents = discoverAgents(folders[0].uri.fsPath);
      copilotLauncher.setAgents(discoveredAgents);
      logger.info('Agent discovery: found %d agent(s)', discoveredAgents.length);
    }
  }

  refreshAgents();

  const getDiscoveredAgents = (): AgentInfo[] => discoveredAgents;

  return {
    sessionStateManager,
    copilotLauncher,
    modelSelector,
    squadManager,
    agentOptions,
    getSquadTeams,
    refreshAgents,
    getDiscoveredAgents,
  };
}
