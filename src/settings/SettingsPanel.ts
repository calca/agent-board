import * as vscode from 'vscode';
import { ProjectConfig, ProjectConfigData } from '../config/ProjectConfig';
import { ProviderDiagnosticSeverity } from '../providers/ITaskProvider';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { Logger } from '../utils/logger';

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
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  /** Debounce timer for config-file watcher reloads. */
  private configDebounce: ReturnType<typeof setTimeout> | undefined;
  /** Suppress file-watcher reloads until this timestamp (to avoid echoing stale data after save). */
  private suppressUntil = 0;

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
    this.watchConfigFile();
    this.setupDevWatcher();
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
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );
    SettingsPanel.instance = new SettingsPanel(panel, extensionUri, registry);
    return SettingsPanel.instance;
  }

  private dispose(): void {
    SettingsPanel.instance = undefined;
    if (this.reloadTimer) { clearTimeout(this.reloadTimer); }
    if (this.configDebounce) { clearTimeout(this.configDebounce); }
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }

  /** Watch `dist/settings.*` for changes and auto-reload in dev mode. */
  private setupDevWatcher(): void {
    const distPattern = new vscode.RelativePattern(
      vscode.Uri.joinPath(this.extensionUri, 'dist'),
      'settings.*',
    );
    const watcher = vscode.workspace.createFileSystemWatcher(distPattern);
    const scheduleReload = () => {
      if (this.reloadTimer) { clearTimeout(this.reloadTimer); }
      this.reloadTimer = setTimeout(() => {
        this.panel.webview.html = this.getHtml(this.panel.webview);
      }, 300);
    };
    watcher.onDidChange(scheduleReload, null, this.disposables);
    watcher.onDidCreate(scheduleReload, null, this.disposables);
    this.disposables.push(watcher);
  }

  /** Watch `.agent-board/config.json` for external changes and auto-reload. */
  private watchConfigFile(): void {
    const pattern = new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] ?? '',
      '.agent-board/config.json',
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = () => {
      if (this.configDebounce) { clearTimeout(this.configDebounce); }
      this.configDebounce = setTimeout(() => {
        if (Date.now() < this.suppressUntil) { return; }
        this.sendConfig();
        void this.sendProviderDiagnostics();
      }, 300);
    };
    watcher.onDidChange(reload, null, this.disposables);
    watcher.onDidCreate(reload, null, this.disposables);
    watcher.onDidDelete(reload, null, this.disposables);
    this.disposables.push(watcher);
  }

  private handleMessage(msg: { type: string; config?: ProjectConfigData; fileName?: string }): void {
    switch (msg.type) {
      case 'ready':
        this.sendConfig();
        void this.sendProviderDiagnostics();
        break;
      case 'save':
        if (msg.config) {
          const log = Logger.getInstance();
          log.info('SettingsPanel save: received config → %s', JSON.stringify(msg.config).slice(0, 2000));
          // Cancel any pending file-watcher reload to prevent stale data echo
          if (this.configDebounce) { clearTimeout(this.configDebounce); }
          // Suppress file-watcher reloads for 1s
          this.suppressUntil = Date.now() + 1000;
          ProjectConfig.updateConfig(msg.config);
          // Send the merged config back — the webview may have sent a partial
          // config (e.g. missing `states` array), so the authoritative merged
          // version from disk must replace the webview state.
          const merged = ProjectConfig.getProjectConfig() ?? {};
          log.info('SettingsPanel save: merged config → %s', JSON.stringify(merged).slice(0, 2000));
          this.panel.webview.postMessage({ type: 'configSaved', config: merged });
          vscode.window.showInformationMessage('Agent Board settings saved.');
          Logger.getInstance().refreshLevel();
          // Refresh all providers so they re-read the updated config
          if (this.registry) {
            for (const p of this.registry.getAll()) {
              void p.refresh();
            }
          }
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
      case 'requestLogs':
        this.sendLogContent(msg.fileName);
        break;
      case 'requestLogFiles':
        this.sendLogFiles();
        break;
    }
  }

  private sendConfig(): void {
    const config = ProjectConfig.getProjectConfig() ?? {};
    this.panel.webview.postMessage({ type: 'configData', config });
  }

  private sendLogContent(fileName?: string): void {
    const logger = Logger.getInstance();
    const content = fileName
      ? logger.readLogFile(fileName)
      : logger.readLogContent();
    this.panel.webview.postMessage({ type: 'logContent', content });
  }

  private sendLogFiles(): void {
    const logger = Logger.getInstance();
    const files = logger.listLogFiles();
    this.panel.webview.postMessage({ type: 'logFiles', files });
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
    const mascotUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mascotte.png'),
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
  <div id="root" data-mascot-uri="${mascotUri}"></div>
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
