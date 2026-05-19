import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { GenAiProviderRegistry } from '../genai-provider/GenAiProviderRegistry';
import { ChatGenAiProvider } from '../genai-provider/providers/ChatGenAiProvider';
import { CopilotCliGenAiProvider } from '../genai-provider/providers/CopilotCliGenAiProvider';
import { CopilotSdkGenAiProvider } from '../genai-provider/providers/CopilotSdkGenAiProvider';
import { LmApiGenAiProvider } from '../genai-provider/providers/LmApiGenAiProvider';

export interface GenAiBootstrapResult {
  genAiRegistry: GenAiProviderRegistry;
  ghCopilotGenAi: CopilotCliGenAiProvider;
}

/**
 * Registers all GenAI providers (Chat, LM API, Copilot CLI, Copilot SDK)
 * and returns the registry plus the Copilot CLI provider instance.
 */
export function bootstrapGenAi(): GenAiBootstrapResult {
  const genAiRegistry = new GenAiProviderRegistry();

  // Global providers (VS Code integrated) — always registered
  genAiRegistry.register(new ChatGenAiProvider());

  // LmApiGenAiProvider — reads initial config from project file / VS Code settings
  const vsCodeApiCfg = ProjectConfig.getProjectConfig()?.genAiProviders?.['vscode-api'] ?? {};
  const lmYolo = (vsCodeApiCfg.yolo as boolean | undefined) ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('githubCopilot.yolo', true);
  genAiRegistry.register(new LmApiGenAiProvider({
    yolo: lmYolo,
    autopilot: lmYolo,
  }));

  // GitHub Copilot — reads initial config from project file / VS Code settings
  const ghCopilotCfg = ProjectConfig.getProjectConfig()?.genAiProviders?.['github-copilot'] ?? {};
  const ghCopilotConfig: Record<string, unknown> = {
    ...ghCopilotCfg,
    yolo: (ghCopilotCfg.yolo as boolean | undefined) ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('githubCopilot.yolo', true),
    fleet: (ghCopilotCfg.fleet as boolean | undefined) ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('githubCopilot.fleet', false),
    silent:     (ghCopilotCfg.silent     as boolean | undefined) ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('githubCopilot.silent', true),
    remote:     (ghCopilotCfg.remote     as boolean | undefined) ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('githubCopilot.remote', false),
    rubberDuck: (ghCopilotCfg.rubberDuck as boolean | undefined) ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('githubCopilot.rubberDuck', false),
  };
  const ghCopilotGenAi = new CopilotCliGenAiProvider(ghCopilotConfig);
  genAiRegistry.register(ghCopilotGenAi);

  // Copilot SDK — structured chat UI using @github/copilot-sdk
  const sdkCfg = ProjectConfig.getProjectConfig()?.genAiProviders?.['copilot-sdk'] ?? {};
  const sdkConfig: Record<string, unknown> = {
    ...sdkCfg,
    model: (sdkCfg.model as string | undefined) ?? vscode.workspace.getConfiguration('agentBoard').get<string>('copilotModel', 'gpt-4o'),
  };
  genAiRegistry.register(new CopilotSdkGenAiProvider(sdkConfig));

  return { genAiRegistry, ghCopilotGenAi };
}
