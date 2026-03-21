import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/ProviderRegistry';

/**
 * Command handler for `agentBoard.refreshTasks`.
 * Calls `refresh()` on all active providers with a progress notification.
 */
export async function refreshTasksCommand(registry: ProviderRegistry): Promise<void> {
  const providers = registry.getAll();

  if (providers.length === 0) {
    vscode.window.showInformationMessage('No task providers registered.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Refreshing tasks…',
      cancellable: false,
    },
    async (progress) => {
      let total = 0;

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        progress.report({
          increment: (100 / providers.length),
          message: provider.displayName,
        });

        try {
          await provider.refresh();
          const tasks = await provider.getTasks();
          total += tasks.length;
        } catch {
          vscode.window.showWarningMessage(
            `Failed to refresh provider "${provider.displayName}".`,
          );
        }
      }

      vscode.window.showInformationMessage(`Loaded ${total} task${total === 1 ? '' : 's'}.`);
    },
  );
}
