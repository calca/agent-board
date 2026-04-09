import * as vscode from 'vscode';
import { ProjectConfig, ProjectConfigData } from '../config/ProjectConfig';

/**
 * WebView panel for editing `.agent-board/config.json` project settings.
 * Singleton pattern — only one panel at a time.
 */
export class SettingsPanel {
  public static readonly viewType = 'agentBoard.settingsView';
  private static instance: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables);
  }

  static createOrShow(): SettingsPanel {
    if (SettingsPanel.instance) {
      SettingsPanel.instance.panel.reveal();
      return SettingsPanel.instance;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'Agent Board — Settings',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    SettingsPanel.instance = new SettingsPanel(panel);
    return SettingsPanel.instance;
  }

  private dispose(): void {
    SettingsPanel.instance = undefined;
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }

  private handleMessage(msg: { type: string; config?: ProjectConfigData }): void {
    switch (msg.type) {
      case 'save':
        if (msg.config) {
          ProjectConfig.updateConfig(msg.config);
          vscode.window.showInformationMessage('Agent Board settings saved.');
        }
        break;
      case 'requestConfig':
        this.sendConfig();
        break;
    }
  }

  private sendConfig(): void {
    const config = ProjectConfig.getProjectConfig() ?? {};
    this.panel.webview.postMessage({ type: 'configData', config });
  }

  private getHtml(): string {
    const config = ProjectConfig.getProjectConfig() ?? {};
    const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Settings</title>
<style>
  :root { --gap: 12px; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px;
  }
  h1 { font-size: 1.3em; margin-bottom: 4px; }
  .subtitle { opacity: 0.6; font-size: 0.85em; margin-bottom: 24px; }
  .section { margin-bottom: 28px; }
  .section__title {
    font-weight: 600; font-size: 0.95em; text-transform: uppercase;
    letter-spacing: 0.06em; opacity: 0.7; margin-bottom: 12px;
    padding-bottom: 6px; border-bottom: 1px solid var(--vscode-panel-border);
  }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .field--row { flex-direction: row; align-items: center; gap: 10px; }
  .field label { font-size: 0.82em; font-weight: 500; opacity: 0.85; }
  .field .hint { font-size: 0.75em; opacity: 0.5; }
  input[type="text"], input[type="number"], select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px; padding: 5px 8px; font-size: 0.85em; width: 100%; max-width: 400px;
  }
  input[type="number"] { max-width: 140px; }
  input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
  input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--vscode-button-background); }
  .actions { display: flex; gap: 10px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); }
  .btn {
    cursor: pointer; border: none; border-radius: 4px; padding: 7px 20px;
    font-size: 0.85em; font-weight: 600; transition: background 0.12s;
  }
  .btn--primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn--primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn--secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn--secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .cols-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
</style>
</head>
<body>
  <h1>⚙ Project Settings</h1>
  <p class="subtitle">.agent-board/config.json</p>
  <div id="root"></div>

<script>
const vscode = acquireVsCodeApi();
let config = ${configJson};

function render() {
  const root = document.getElementById('root');
  root.innerHTML = \`
    <div class="section">
      <div class="section__title">GitHub</div>
      <div class="cols-2">
        <div class="field">
          <label for="gh-owner">Owner</label>
          <input type="text" id="gh-owner" value="\${esc(config.github?.owner)}" placeholder="e.g. my-org" />
        </div>
        <div class="field">
          <label for="gh-repo">Repository</label>
          <input type="text" id="gh-repo" value="\${esc(config.github?.repo)}" placeholder="e.g. my-repo" />
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section__title">JSON Provider</div>
      <div class="field">
        <label for="json-path">Tasks file path</label>
        <input type="text" id="json-path" value="\${esc(config.jsonProvider?.path)}" placeholder=".agent-board/tasks.json" />
        <span class="hint">Relative to workspace root</span>
      </div>
    </div>

    <div class="section">
      <div class="section__title">Kanban Board</div>
      <div class="field">
        <label for="kanban-cols">Columns (comma-separated)</label>
        <input type="text" id="kanban-cols" value="\${esc((config.kanban?.columns ?? []).join(', '))}" placeholder="todo, inprogress, review, done" />
      </div>
    </div>

    <div class="section">
      <div class="section__title">Worktree</div>
      <div class="cols-2">
        <div class="field field--row">
          <input type="checkbox" id="wt-enabled" \${config.worktree?.enabled !== false ? 'checked' : ''} />
          <label for="wt-enabled">Enable worktrees</label>
        </div>
        <div class="field field--row">
          <input type="checkbox" id="wt-confirm" \${config.worktree?.confirmCleanup ? 'checked' : ''} />
          <label for="wt-confirm">Confirm cleanup</label>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section__title">Squad</div>
      <div class="cols-2">
        <div class="field">
          <label for="sq-max">Max sessions</label>
          <input type="number" id="sq-max" value="\${config.squad?.maxSessions ?? 10}" min="1" max="50" />
        </div>
        <div class="field">
          <label for="sq-timeout">Session timeout (ms)</label>
          <input type="number" id="sq-timeout" value="\${config.squad?.sessionTimeout ?? 300000}" min="0" step="1000" />
          <span class="hint">0 = no timeout</span>
        </div>
        <div class="field">
          <label for="sq-source">Source column</label>
          <input type="text" id="sq-source" value="\${esc(config.squad?.sourceColumn)}" placeholder="todo" />
        </div>
        <div class="field">
          <label for="sq-active">Active column</label>
          <input type="text" id="sq-active" value="\${esc(config.squad?.activeColumn)}" placeholder="inprogress" />
        </div>
        <div class="field">
          <label for="sq-done">Done column</label>
          <input type="text" id="sq-done" value="\${esc(config.squad?.doneColumn)}" placeholder="review" />
        </div>
        <div class="field">
          <label for="sq-cooldown">Cooldown (ms)</label>
          <input type="number" id="sq-cooldown" value="\${config.squad?.cooldownMs ?? 0}" min="0" step="500" />
        </div>
        <div class="field">
          <label for="sq-retries">Max retries</label>
          <input type="number" id="sq-retries" value="\${config.squad?.maxRetries ?? 0}" min="0" />
        </div>
        <div class="field">
          <label for="sq-interval">Auto-squad interval (ms)</label>
          <input type="number" id="sq-interval" value="\${config.squad?.autoSquadInterval ?? 15000}" min="1000" step="1000" />
        </div>
        <div class="field">
          <label for="sq-priority">Priority labels (comma-separated)</label>
          <input type="text" id="sq-priority" value="\${esc((config.squad?.priorityLabels ?? []).join(', '))}" placeholder="critical, high, medium" />
        </div>
        <div class="field">
          <label for="sq-exclude">Exclude labels (comma-separated)</label>
          <input type="text" id="sq-exclude" value="\${esc((config.squad?.excludeLabels ?? []).join(', '))}" placeholder="blocked, manual" />
        </div>
        <div class="field">
          <label for="sq-assignee">Assignee filter</label>
          <input type="text" id="sq-assignee" value="\${esc(config.squad?.assigneeFilter)}" placeholder="empty = all" />
          <span class="hint">* = any assigned, unassigned = none, or exact username</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section__title">MCP Server</div>
      <div class="cols-2">
        <div class="field field--row">
          <input type="checkbox" id="mcp-enabled" \${config.mcp?.enabled ? 'checked' : ''} />
          <label for="mcp-enabled">Enable MCP server</label>
        </div>
        <div class="field">
          <label for="mcp-path">Tasks path</label>
          <input type="text" id="mcp-path" value="\${esc(config.mcp?.tasksPath)}" placeholder="(defaults to JSON provider path)" />
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section__title">Notifications</div>
      <div class="cols-2">
        <div class="field field--row">
          <input type="checkbox" id="notif-active" \${config.notifications?.taskActive !== false ? 'checked' : ''} />
          <label for="notif-active">Task moved to active</label>
        </div>
        <div class="field field--row">
          <input type="checkbox" id="notif-done" \${config.notifications?.taskDone !== false ? 'checked' : ''} />
          <label for="notif-done">Task moved to done</label>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section__title">Misc</div>
      <div class="cols-2">
        <div class="field field--row">
          <input type="checkbox" id="post-summary" \${config.postAgentSummaryToIssue ? 'checked' : ''} />
          <label for="post-summary">Post agent summary to GitHub issue</label>
        </div>
        <div class="field">
          <label for="poll-interval">Poll interval (ms)</label>
          <input type="number" id="poll-interval" value="\${config.pollInterval ?? ''}" min="0" step="1000" placeholder="default" />
        </div>
        <div class="field">
          <label for="log-level">Log level</label>
          <select id="log-level">
            <option value="" \${!config.logLevel ? 'selected' : ''}>Default</option>
            <option value="debug" \${config.logLevel === 'debug' ? 'selected' : ''}>Debug</option>
            <option value="info" \${config.logLevel === 'info' ? 'selected' : ''}>Info</option>
            <option value="warn" \${config.logLevel === 'warn' ? 'selected' : ''}>Warn</option>
            <option value="error" \${config.logLevel === 'error' ? 'selected' : ''}>Error</option>
          </select>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn--primary" id="btn-save">Save</button>
      <button class="btn btn--secondary" id="btn-reset">Reset to file</button>
    </div>
  \`;

  document.getElementById('btn-save')?.addEventListener('click', save);
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'requestConfig' });
  });
}

function esc(val) { return val ?? ''; }

function csvToArray(val) {
  return val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined;
}

function numOrUndef(val) {
  const n = Number(val);
  return isNaN(n) || val === '' ? undefined : n;
}

function save() {
  const updated = {
    github: {
      owner: document.getElementById('gh-owner').value || undefined,
      repo: document.getElementById('gh-repo').value || undefined,
    },
    jsonProvider: {
      path: document.getElementById('json-path').value || undefined,
    },
    kanban: {
      columns: csvToArray(document.getElementById('kanban-cols').value),
    },
    worktree: {
      enabled: document.getElementById('wt-enabled').checked,
      confirmCleanup: document.getElementById('wt-confirm').checked,
    },
    squad: {
      maxSessions: numOrUndef(document.getElementById('sq-max').value),
      sessionTimeout: numOrUndef(document.getElementById('sq-timeout').value),
      sourceColumn: document.getElementById('sq-source').value || undefined,
      activeColumn: document.getElementById('sq-active').value || undefined,
      doneColumn: document.getElementById('sq-done').value || undefined,
      cooldownMs: numOrUndef(document.getElementById('sq-cooldown').value),
      maxRetries: numOrUndef(document.getElementById('sq-retries').value),
      autoSquadInterval: numOrUndef(document.getElementById('sq-interval').value),
      priorityLabels: csvToArray(document.getElementById('sq-priority').value),
      excludeLabels: csvToArray(document.getElementById('sq-exclude').value),
      assigneeFilter: document.getElementById('sq-assignee').value || undefined,
    },
    mcp: {
      enabled: document.getElementById('mcp-enabled').checked,
      tasksPath: document.getElementById('mcp-path').value || undefined,
    },
    notifications: {
      taskActive: document.getElementById('notif-active').checked,
      taskDone: document.getElementById('notif-done').checked,
    },
    postAgentSummaryToIssue: document.getElementById('post-summary').checked,
    pollInterval: numOrUndef(document.getElementById('poll-interval').value),
    logLevel: document.getElementById('log-level').value || undefined,
  };
  vscode.postMessage({ type: 'save', config: updated });
}

window.addEventListener('message', (e) => {
  if (e.data?.type === 'configData') {
    config = e.data.config;
    render();
  }
});

render();
</script>
</body>
</html>`;
  }
}
