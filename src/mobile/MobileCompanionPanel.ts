import * as QRCode from 'qrcode';
import * as vscode from 'vscode';
import { MobileDeviceInfo } from '../server/LocalApiServer';

export interface MobileCompanionStatus {
  running: boolean;
  url: string;
  devices: MobileDeviceInfo[];
}

export class MobileCompanionPanel {
  public static readonly viewType = 'agentBoard.mobileCompanionView';
  private static instance: MobileCompanionPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly getStatus: () => Promise<MobileCompanionStatus>,
    private readonly toggleServer: () => Promise<MobileCompanionStatus>,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg.type === 'ready' || msg.type === 'refresh') {
        void this.pushStatus();
      } else if (msg.type === 'toggleServer') {
        void this.handleToggleServer();
      }
    }, null, this.disposables);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static createOrShow(
    getStatus: () => Promise<MobileCompanionStatus>,
    toggleServer: () => Promise<MobileCompanionStatus>,
  ): MobileCompanionPanel {
    if (MobileCompanionPanel.instance) {
      MobileCompanionPanel.instance.panel.reveal(vscode.ViewColumn.One);
      void MobileCompanionPanel.instance.pushStatus();
      return MobileCompanionPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      MobileCompanionPanel.viewType,
      'Agent Board Mobile',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    MobileCompanionPanel.instance = new MobileCompanionPanel(panel, getStatus, toggleServer);
    return MobileCompanionPanel.instance;
  }

  async revealAndRefresh(): Promise<void> {
    this.panel.reveal(vscode.ViewColumn.One);
    await this.pushStatus();
  }

  async pushStatus(): Promise<void> {
    const status = await this.getStatus();
    const qrSvg = await this.buildQrSvg(status.url);
    this.panel.webview.postMessage({ type: 'status', status, qrSvg });
  }

  private async handleToggleServer(): Promise<void> {
    const status = await this.toggleServer();
    const qrSvg = await this.buildQrSvg(status.url);
    this.panel.webview.postMessage({ type: 'status', status, qrSvg });
  }

  private async buildQrSvg(url: string): Promise<string> {
    return QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      width: 280,
      color: {
        dark: '#111111',
        light: '#ffffff',
      },
    });
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Board Mobile</title>
  <style>
    body {
      font-family: var(--vscode-font-family, sans-serif);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      margin: 0;
      padding: 22px;
    }
    .card {
      max-width: 520px;
      margin: 0 auto;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 18px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    }
    .title { font-size: 1.2rem; font-weight: 700; margin-bottom: 6px; }
    .subtitle { opacity: 0.8; margin-bottom: 16px; }
    .status { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 12px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #888; }
    .dot.on { background: #2ea043; }
    .dot.off { background: #d73a49; }
    .qr { background: #fff; border-radius: 10px; padding: 10px; display: inline-block; margin: 8px 0 12px; }
    .url { word-break: break-all; font-family: var(--vscode-editor-font-family, monospace); margin-bottom: 10px; }
    .actions { display: flex; gap: 8px; margin-bottom: 14px; }
    button {
      border: none;
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: 600;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .devices h3 { margin: 0 0 8px; font-size: 1rem; }
    .device {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .muted { opacity: 0.75; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">agent-board Mobile</div>
    <div class="subtitle">Scansiona con il telefono (stesso WiFi)</div>
    <div class="status"><span id="server-dot" class="dot"></span><span id="server-label">Server</span></div>
    <div id="qr" class="qr"></div>
    <div id="url" class="url"></div>
    <div class="actions">
      <button id="toggle-btn" type="button">Toggle server</button>
      <button id="refresh-btn" type="button">Refresh</button>
    </div>
    <div class="devices">
      <h3>Device connessi (<span id="device-count">0</span>)</h3>
      <div id="devices-list" class="muted">Nessun device connesso.</div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const qrEl = document.getElementById('qr');
    const urlEl = document.getElementById('url');
    const serverDot = document.getElementById('server-dot');
    const serverLabel = document.getElementById('server-label');
    const deviceCountEl = document.getElementById('device-count');
    const devicesListEl = document.getElementById('devices-list');

    document.getElementById('toggle-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleServer' });
    });
    document.getElementById('refresh-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (!msg || msg.type !== 'status') { return; }

      const status = msg.status;
      qrEl.innerHTML = msg.qrSvg || '';
      urlEl.textContent = status.url;

      serverDot.classList.remove('on', 'off');
      serverDot.classList.add(status.running ? 'on' : 'off');
      serverLabel.textContent = status.running ? 'Server attivo' : 'Server non attivo';

      const devices = status.devices || [];
      deviceCountEl.textContent = String(devices.length);
      if (devices.length === 0) {
        devicesListEl.textContent = 'Nessun device connesso.';
      } else {
        devicesListEl.innerHTML = devices.map(d => {
          const ts = new Date(d.lastAccess).toLocaleString();
          return '<div class="device"><strong>' + d.ip + '</strong><div class="muted">Ultimo accesso: ' + ts + '</div></div>';
        }).join('');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    MobileCompanionPanel.instance = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
