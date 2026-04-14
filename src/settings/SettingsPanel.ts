import * as vscode from 'vscode';
import { ProjectConfig, ProjectConfigData } from '../config/ProjectConfig';
import { ProviderDiagnosticSeverity } from '../providers/ITaskProvider';
import { ProviderRegistry } from '../providers/ProviderRegistry';

/** Serialisable provider info sent to the webview. */
interface ProviderInfo {
  id: string;
  displayName: string;
  icon: string;
  enabled: boolean;
  configSection: string; // key in ProjectConfigData, e.g. 'github'
  fields: Array<{ key: string; label: string; type: string; placeholder?: string; hint?: string; required?: boolean }>;
  diagnostic: { severity: ProviderDiagnosticSeverity; message: string };
}

/**
 * WebView panel for editing `.agent-board/config.json` project settings.
 * Singleton pattern — only one panel at a time.
 * Renders a React app from dist/settings.js (same pattern as KanbanPanel).
 */
export class SettingsPanel {
  public static readonly viewType = 'agentBoard.settingsView';
  private static instance: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private registry: ProviderRegistry | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    registry?: ProviderRegistry,
  ) {
    this.panel = panel;
    this.registry = registry;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables);
  }

  static createOrShow(extensionUri: vscode.Uri, registry?: ProviderRegistry): SettingsPanel {
    if (SettingsPanel.instance) {
      SettingsPanel.instance.registry = registry;
      SettingsPanel.instance.panel.reveal();
      return SettingsPanel.instance;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'Agent Board — Settings',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );
    SettingsPanel.instance = new SettingsPanel(panel, extensionUri, registry);
    return SettingsPanel.instance;
  }

  private dispose(): void {
    SettingsPanel.instance = undefined;
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }

  private handleMessage(msg: { type: string; config?: ProjectConfigData }): void {
    switch (msg.type) {
      case 'ready':
        this.sendConfig();
        void this.sendProviderDiagnostics();
        break;
      case 'save':
        if (msg.config) {
          ProjectConfig.updateConfig(msg.config);
          vscode.window.showInformationMessage('Agent Board settings saved.');
          void this.sendProviderDiagnostics();
        }
        break;
      case 'requestConfig':
        this.sendConfig();
        void this.sendProviderDiagnostics();
        break;
      case 'refreshDiagnostics':
        void this.sendProviderDiagnostics();
        break;
    }
  }

  private sendConfig(): void {
    const config = ProjectConfig.getProjectConfig() ?? {};
    this.panel.webview.postMessage({ type: 'configData', config });
  }

  /** Map provider id → config section key in ProjectConfigData. */
  private static readonly PROVIDER_CONFIG_SECTION: Record<string, string> = {
    'github': 'github',
    'json': 'jsonProvider',
    'markdown': 'markdownProvider',
    'beads': 'beadsProvider',
    'azure-devops': 'azureDevOps',
  };

  private async sendProviderDiagnostics(): Promise<void> {
    if (!this.registry) { return; }
    const providers = this.registry.getAll();
    const infos: ProviderInfo[] = [];

    for (const p of providers) {
      if (p.id === 'aggregator' || p.id === 'taskstore') { continue; }
      const diag = await p.diagnose();
      infos.push({
        id: p.id,
        displayName: p.displayName,
        icon: p.icon,
        enabled: p.isEnabled(),
        configSection: SettingsPanel.PROVIDER_CONFIG_SECTION[p.id] ?? p.id,
        fields: p.getConfigFields(),
        diagnostic: diag,
      });
    }

    this.panel.webview.postMessage({ type: 'providerDiagnostics', providers: infos });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const cacheBust = Date.now();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'settings.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'settings.css'),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 font-src ${webview.cspSource};
                 img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${styleUri}?v=${cacheBust}">
  <title>Agent Board - Settings</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}?v=${cacheBust}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
  }
}
