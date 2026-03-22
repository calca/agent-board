import * as vscode from 'vscode';
import { CopilotMode } from '../types/Messages';
import { ProjectConfig } from '../config/ProjectConfig';

/**
 * Quick Pick for selecting the Copilot mode (cloud / local / background).
 * Persists selection in `workspaceState`. Shows current mode in status bar.
 */
export class ModelSelector {
  private static readonly STATE_KEY = 'agentBoard.copilotMode';
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBarItem.command = 'agentBoard.selectCopilotMode';
    this.updateStatusBar();
    this.statusBarItem.show();
  }

  /** Show Quick Pick and return the selected mode. */
  async pick(): Promise<CopilotMode | undefined> {
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

  /** Get the currently selected mode. */
  getMode(): CopilotMode {
    const projectCfg = ProjectConfig.getProjectConfig();
    const resolved = ProjectConfig.resolve(
      projectCfg?.copilot?.defaultMode as CopilotMode | undefined,
      'copilot.defaultMode',
      'cloud' as CopilotMode,
    );
    return this.context.workspaceState.get<CopilotMode>(
      ModelSelector.STATE_KEY,
      resolved,
    );
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  private updateStatusBar(): void {
    const mode = this.getMode();
    const icons: Record<CopilotMode, string> = {
      chat: '$(comment-discussion)',
      cloud: '$(cloud)',
      local: '$(server)',
      background: '$(file-text)',
    };
    this.statusBarItem.text = `${icons[mode]} Copilot: ${mode}`;
    this.statusBarItem.tooltip = 'Click to change Copilot mode';
  }
}
