import * as vscode from 'vscode';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';

/**
 * Quick Pick for selecting the active GenAI provider.
 * Persists selection in `workspaceState`. Shows current provider in status bar.
 *
 * Builds the picker dynamically from the `GenAiProviderRegistry`.
 */
export class ModelSelector {
  private static readonly STATE_KEY = 'agentBoard.selectedProviderId';
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly genAiRegistry: GenAiProviderRegistry,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBarItem.command = 'agentBoard.selectCopilotMode';
    this.updateStatusBar();
    this.statusBarItem.show();
  }

  /** Show Quick Pick and return the selected provider id. */
  async pick(): Promise<string | undefined> {
    const providers = this.genAiRegistry.getAll();
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

  /** Get the currently selected provider id. */
  getProviderId(): string {
    const defaultId = this.genAiRegistry.getAll()[0]?.id ?? 'chat';
    const stored = this.context.workspaceState.get<string>(
      ModelSelector.STATE_KEY,
      defaultId,
    );

    // Validate stored value against registry (the provider may have been removed)
    if (!this.genAiRegistry.get(stored)) {
      return defaultId;
    }

    return stored;
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private updateStatusBar(): void {
    const providerId = this.getProviderId();
    const provider = this.genAiRegistry.get(providerId);

    if (provider) {
      this.statusBarItem.text = `$(${provider.icon}) Copilot: ${provider.displayName}`;
    } else {
      this.statusBarItem.text = `$(beaker) Copilot: ${providerId}`;
    }
    this.statusBarItem.tooltip = 'Click to change GenAI provider';
  }
}
