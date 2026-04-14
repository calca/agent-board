import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { Logger } from '../utils/logger';

/**
 * Command handler for `agentBoard.refreshTasks`.
 * Calls `refresh()` on all active providers with a progress notification.
 */
export async function refreshTasksCommand(registry: ProviderRegistry): Promise<void> {
  const logger = Logger.getInstance();
  const providers = registry.getAll().filter(p => p.isEnabled());

  if (providers.length === 0) {
    vscode.window.showInformationMessage('No task providers registered.');
    return;
  }

  logger.info('refreshTasks: refreshing %d provider(s)', providers.length);

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
          logger.debug('refreshTasks: provider %s returned %d task(s)', provider.id, tasks.length);
        } catch (err) {
          logger.error('refreshTasks: provider %s failed: %s', provider.id, String(err));
          vscode.window.showWarningMessage(
            `Failed to refresh provider "${provider.displayName}".`,
          );
        }
      }

      logger.info('refreshTasks: loaded %d task(s) total', total);
      vscode.window.showInformationMessage(`Loaded ${total} task${total === 1 ? '' : 's'}.`);
    },
  );
}
