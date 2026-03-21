import * as vscode from 'vscode';
import { ITaskProvider } from './ITaskProvider';
import { ProviderRegistry } from './ProviderRegistry';

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  providerId: string | undefined;
}

/**
 * Quick Pick UI for selecting an active task provider.
 * Persists the user's selection in `workspaceState`.
 */
export class ProviderPicker {
  private static readonly STATE_KEY = 'agentBoard.selectedProvider';

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /** Show the Quick Pick and return the selected provider id (or `undefined` for "all"). */
  async pick(): Promise<string | undefined> {
    const providers = this.registry.getAll();

    const items: ProviderQuickPickItem[] = [
      {
        label: '$(layers) All providers',
        description: 'Aggregate tasks from every registered provider',
        providerId: undefined,
      },
      ...providers.map(p => this.toQuickPickItem(p)),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a task provider',
      matchOnDescription: true,
    });

    if (selected) {
      await this.context.workspaceState.update(
        ProviderPicker.STATE_KEY,
        selected.providerId ?? '',
      );
    }

    return selected?.providerId;
  }

  /** Return the previously persisted selection (empty string = all). */
  getSelection(): string | undefined {
    const val = this.context.workspaceState.get<string>(ProviderPicker.STATE_KEY);
    return val === '' ? undefined : val;
  }

  private toQuickPickItem(provider: ITaskProvider): ProviderQuickPickItem {
    return {
      label: `$(${provider.icon}) ${provider.displayName}`,
      description: provider.id,
      providerId: provider.id,
    };
  }
}
