import * as vscode from 'vscode';
import { CopilotMode } from '../types/Messages';
import { ProjectConfig } from '../config/ProjectConfig';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';
import { IGenAiProvider } from './IGenAiProvider';

/**
 * Quick Pick for selecting the Copilot mode / GenAI provider.
 * Persists selection in `workspaceState`. Shows current mode in status bar.
 *
 * When a `GenAiProviderRegistry` is available the picker shows all
 * registered providers; otherwise falls back to the built-in mode list.
 */
export class ModelSelector {
  private static readonly STATE_KEY = 'agentBoard.copilotMode';
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly genAiRegistry?: GenAiProviderRegistry,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBarItem.command = 'agentBoard.selectCopilotMode';
    this.updateStatusBar();
    this.statusBarItem.show();
  }

  /** Show Quick Pick and return the selected mode / provider id. */
  async pick(): Promise<CopilotMode | string | undefined> {
    // If GenAI registry is available, build dynamic list from providers
    if (this.genAiRegistry) {
      const providers = this.genAiRegistry.getAll();
      if (providers.length > 0) {
        return this.pickFromProviders(providers);
      }
    }

    // Fallback to built-in modes
    return this.pickLegacy();
  }

  /** Get the currently selected mode / provider id. */
  getMode(): CopilotMode | string {
    const projectCfg = ProjectConfig.getProjectConfig();
    const resolved = ProjectConfig.resolve(
      projectCfg?.copilot?.defaultMode as CopilotMode | undefined,
      'copilot.defaultMode',
      'cloud' as CopilotMode,
    );
    return this.context.workspaceState.get<CopilotMode | string>(
      ModelSelector.STATE_KEY,
      resolved,
    );
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async pickFromProviders(providers: IGenAiProvider[]): Promise<string | undefined> {
    const items = providers.map(p => ({
      label: `$(${p.icon}) ${p.displayName}`,
      description: p.scope === 'global' ? 'VS Code integrated' : 'Project provider',
      providerId: p.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select GenAI provider',
    });

    if (selected) {
      await this.context.workspaceState.update(ModelSelector.STATE_KEY, selected.providerId);
      this.updateStatusBar();
    }

    return selected?.providerId;
  }

  private async pickLegacy(): Promise<CopilotMode | undefined> {
    const items: Array<vscode.QuickPickItem & { mode: CopilotMode }> = [
      { label: '$(comment-discussion) Chat', description: 'Open VS Code chat with task context', mode: 'chat' },
      { label: '$(cloud) Cloud', description: 'GitHub Copilot cloud model', mode: 'cloud' },
      { label: '$(server) Local', description: 'Local Ollama model', mode: 'local' },
      { label: '$(file-text) Background', description: 'Run silently, save to file', mode: 'background' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select Copilot mode',
    });

    if (selected) {
      await this.context.workspaceState.update(ModelSelector.STATE_KEY, selected.mode);
      this.updateStatusBar();
    }

    return selected?.mode;
  }

  private updateStatusBar(): void {
    const mode = this.getMode();

    // Try to get icon from provider registry
    if (this.genAiRegistry) {
      const provider = this.genAiRegistry.get(mode);
      if (provider) {
        this.statusBarItem.text = `$(${provider.icon}) Copilot: ${provider.displayName}`;
        this.statusBarItem.tooltip = 'Click to change GenAI provider';
        return;
      }
    }

    // Fallback to built-in icon map
    const icons: Record<string, string> = {
      chat: '$(comment-discussion)',
      cloud: '$(cloud)',
      local: '$(server)',
      background: '$(file-text)',
    };
    this.statusBarItem.text = `${icons[mode] ?? '$(beaker)'} Copilot: ${mode}`;
    this.statusBarItem.tooltip = 'Click to change Copilot mode';
  }
}
