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
 */
export class SettingsPanel {
  public static readonly viewType = 'agentBoard.settingsView';
  private static instance: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private registry: ProviderRegistry | undefined;

  private constructor(panel: vscode.WebviewPanel, registry?: ProviderRegistry) {
    this.panel = panel;
    this.registry = registry;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables);
  }

  static createOrShow(registry?: ProviderRegistry): SettingsPanel {
    if (SettingsPanel.instance) {
      SettingsPanel.instance.registry = registry;
      SettingsPanel.instance.panel.reveal();
      return SettingsPanel.instance;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'Agent Board — Settings',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    SettingsPanel.instance = new SettingsPanel(panel, registry);
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
    padding: 0;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .sticky-header {
    position: sticky; top: 0; z-index: 10;
    background: var(--vscode-editor-background);
    padding: 20px 32px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex; align-items: center; gap: 16px;
  }
  .sticky-header .header-text { flex: 1; }
  .sticky-header h1 { font-size: 1.3em; margin-bottom: 2px; }
  .sticky-header .subtitle { opacity: 0.6; font-size: 0.85em; margin: 0; }
  .sticky-header .header-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .scroll-content {
    flex: 1; overflow-y: auto;
    padding: 24px 32px;
  }
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
  /* ── Provider cards ──────────────────── */
  .provider-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px; padding: 14px 16px; margin-bottom: 14px;
  }
  .provider-card.disabled { opacity: 0.55; }
  .provider-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .provider-header h3 { margin: 0; font-size: 0.95em; flex: 1; }
  .diag { font-size: 0.78em; padding: 4px 10px; border-radius: 4px; margin-top: 6px; }
  .diag--ok { background: rgba(40,167,69,0.15); color: #28a745; }
  .diag--warning { background: rgba(255,193,7,0.18); color: #e6a700; }
  .diag--error { background: rgba(220,53,69,0.15); color: #dc3545; }
  .available-list { display: flex; flex-direction: column; gap: 8px; }
  .available-item {
    display: flex; align-items: center; gap: 12px;
    border: 1px dashed var(--vscode-panel-border); border-radius: 6px;
    padding: 10px 14px; opacity: 0.7; transition: opacity 0.15s;
  }
  .available-item:hover { opacity: 1; }
  .available-item h4 { margin: 0; font-size: 0.9em; flex: 1; }
  .available-item .diag { margin-top: 0; margin-left: auto; }
  .btn--add {
    cursor: pointer; border: none; border-radius: 4px;
    padding: 5px 14px; font-size: 0.8em; font-weight: 600;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .btn--add:hover { background: var(--vscode-button-hoverBackground); }
  .btn--remove {
    cursor: pointer; border: none; border-radius: 4px;
    padding: 4px 10px; font-size: 0.75em; font-weight: 600;
    background: rgba(220,53,69,0.15); color: #dc3545;
  }
  .btn--remove:hover { background: rgba(220,53,69,0.3); }
</style>
</head>
<body>
  <div class="sticky-header">
    <div class="header-text">
      <h1>⚙ Project Settings</h1>
      <p class="subtitle">.agent-board/config.json</p>
    </div>
    <div class="header-actions">
      <button class="btn btn--secondary" id="btn-reset-header">Reset to file</button>
      <button class="btn btn--primary" id="btn-save-header">Save</button>
    </div>
  </div>
  <div class="scroll-content">
    <div id="root"></div>
  </div>

<script>
const vscode = acquireVsCodeApi();
let config = ${configJson};
let providerInfos = [];

function render() {
  const root = document.getElementById('root');
  root.innerHTML =
    renderProviders() +
    renderKanban() +
    renderWorktree() +
    renderSquad() +
    renderMcp() +
    renderNotifications() +
    renderMisc();

  // Header buttons (always present)
  document.getElementById('btn-save-header')?.addEventListener('click', save);
  document.getElementById('btn-reset-header')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'requestConfig' });
  });
  document.getElementById('btn-refresh-diag')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshDiagnostics' });
  });

  // Wire "Add" buttons
  document.querySelectorAll('.btn--add').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.getAttribute('data-section');
      if (section) {
        config[section] = config[section] || {};
        config[section].enabled = true;
        // Update in-memory provider info
        const pi = providerInfos.find(p => p.configSection === section);
        if (pi) { pi.enabled = true; }
        // Save immediately so the provider activates
        vscode.postMessage({ type: 'save', config: buildSavePayload() });
        render();
      }
    });
  });

  // Wire "Remove" buttons
  document.querySelectorAll('.btn--remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.getAttribute('data-section');
      if (section && config[section]) {
        config[section].enabled = false;
        const pi = providerInfos.find(p => p.configSection === section);
        if (pi) { pi.enabled = false; }
        vscode.postMessage({ type: 'save', config: buildSavePayload() });
        render();
      }
    });
  });
}

/* ── Provider cards ──────────────────────────────────────────── */

function renderProviders() {
  const active = providerInfos.filter(p => p.enabled);
  const available = providerInfos.filter(p => !p.enabled);

  let html = '<div class="section"><div class="section__title">Task Providers</div>';

  if (providerInfos.length === 0) {
    html += '<p style="opacity:0.5;font-size:0.85em">Loading provider information…</p>';
    html += '</div>';
    return html;
  }

  // ── Active providers ──────────────────────
  if (active.length === 0) {
    html += '<p style="opacity:0.5;font-size:0.85em;margin-bottom:14px">No providers enabled. Add one below.</p>';
  }

  for (const p of active) {
    html += renderProviderCard(p);
  }

  // ── Available providers (+ Add) ───────────
  if (available.length > 0) {
    html += '<div style="margin-top:18px;margin-bottom:10px;font-weight:600;font-size:0.88em;opacity:0.6">+ Add Provider</div>';
    html += '<div class="available-list">';
    for (const p of available) {
      html += '<div class="available-item" data-provider="' + p.id + '">';
      html += '<h4>' + escHtml(p.displayName) + '</h4>';
      // Show diagnostic inline
      if (p.diagnostic) {
        const sev = p.diagnostic.severity;
        const icon = sev === 'ok' ? '✓' : sev === 'warning' ? '⚠' : '✗';
        html += '<span class="diag diag--' + sev + '" style="font-size:0.72em">' + icon + ' ' + escHtml(p.diagnostic.message) + '</span>';
      }
      html += '<button class="btn--add" data-section="' + p.configSection + '">Enable</button>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '<button class="btn btn--secondary" id="btn-refresh-diag" style="margin-top:12px">Re-check providers</button>';
  html += '</div>';
  return html;
}

function renderProviderCard(p) {
  const section = p.configSection;
  const sectionCfg = config[section] ?? {};

  let html = '<div class="provider-card" data-provider="' + p.id + '">';
  html += '<div class="provider-header">';
  html += '<h3>' + escHtml(p.displayName) + '</h3>';
  html += '<button class="btn--remove" data-section="' + section + '">Remove</button>';
  html += '</div>';

  // Dynamic config fields
  if (p.fields && p.fields.length > 0) {
    html += '<div class="cols-2">';
    for (const f of p.fields) {
      const fieldId = 'prov-' + p.id + '-' + f.key;
      const val = sectionCfg[f.key] ?? '';
      if (f.type === 'boolean') {
        html += '<div class="field field--row">';
        html += '<input type="checkbox" id="' + fieldId + '" ' + (val ? 'checked' : '') + ' />';
        html += '<label for="' + fieldId + '">' + escHtml(f.label) + '</label>';
        html += '</div>';
      } else if (f.type === 'number') {
        html += '<div class="field">';
        html += '<label for="' + fieldId + '">' + escHtml(f.label) + (f.required ? ' *' : '') + '</label>';
        html += '<input type="number" id="' + fieldId + '" value="' + esc(val) + '" placeholder="' + esc(f.placeholder) + '" />';
        if (f.hint) { html += '<span class="hint">' + escHtml(f.hint) + '</span>'; }
        html += '</div>';
      } else {
        html += '<div class="field">';
        html += '<label for="' + fieldId + '">' + escHtml(f.label) + (f.required ? ' *' : '') + '</label>';
        html += '<input type="text" id="' + fieldId + '" value="' + esc(val) + '" placeholder="' + esc(f.placeholder) + '" />';
        if (f.hint) { html += '<span class="hint">' + escHtml(f.hint) + '</span>'; }
        html += '</div>';
      }
    }
    html += '</div>';
  }

  // Diagnostic badge
  if (p.diagnostic) {
    const sev = p.diagnostic.severity;
    html += '<div class="diag diag--' + sev + '">';
    html += (sev === 'ok' ? '✓' : sev === 'warning' ? '⚠' : '✗') + ' ' + escHtml(p.diagnostic.message);
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/* ── Other sections (unchanged) ──────────────────────────────── */

function renderKanban() {
  return '<div class="section">' +
    '<div class="section__title">Kanban Board</div>' +
    '<div class="field">' +
    '<label for="kanban-cols">Columns (comma-separated)</label>' +
    '<input type="text" id="kanban-cols" value="' + esc((config.kanban?.columns ?? []).join(', ')) + '" placeholder="todo, inprogress, review, done" />' +
    '</div></div>';
}

function renderWorktree() {
  return '<div class="section"><div class="section__title">Worktree</div><div class="cols-2">' +
    '<div class="field field--row"><input type="checkbox" id="wt-enabled" ' + (config.worktree?.enabled !== false ? 'checked' : '') + ' /><label for="wt-enabled">Enable worktrees</label></div>' +
    '<div class="field field--row"><input type="checkbox" id="wt-confirm" ' + (config.worktree?.confirmCleanup ? 'checked' : '') + ' /><label for="wt-confirm">Confirm cleanup</label></div>' +
    '</div></div>';
}

function renderSquad() {
  const sq = config.squad ?? {};
  return '<div class="section"><div class="section__title">Squad</div><div class="cols-2">' +
    field('sq-max', 'Max sessions', 'number', sq.maxSessions ?? 10) +
    field('sq-timeout', 'Session timeout (ms)', 'number', sq.sessionTimeout ?? 300000, '0 = no timeout') +
    field('sq-source', 'Source column', 'text', sq.sourceColumn, null, 'todo') +
    field('sq-active', 'Active column', 'text', sq.activeColumn, null, 'inprogress') +
    field('sq-done', 'Done column', 'text', sq.doneColumn, null, 'review') +
    field('sq-cooldown', 'Cooldown (ms)', 'number', sq.cooldownMs ?? 0) +
    field('sq-retries', 'Max retries', 'number', sq.maxRetries ?? 0) +
    field('sq-interval', 'Auto-squad interval (ms)', 'number', sq.autoSquadInterval ?? 15000) +
    field('sq-priority', 'Priority labels (csv)', 'text', (sq.priorityLabels ?? []).join(', '), null, 'critical, high') +
    field('sq-exclude', 'Exclude labels (csv)', 'text', (sq.excludeLabels ?? []).join(', '), null, 'blocked, manual') +
    field('sq-assignee', 'Assignee filter', 'text', sq.assigneeFilter, '* = any, unassigned = none', 'empty = all') +
    '</div></div>';
}

function renderMcp() {
  return '<div class="section"><div class="section__title">MCP Server</div><div class="cols-2">' +
    '<div class="field field--row"><input type="checkbox" id="mcp-enabled" ' + (config.mcp?.enabled ? 'checked' : '') + ' /><label for="mcp-enabled">Enable MCP server</label></div>' +
    field('mcp-path', 'Tasks path', 'text', config.mcp?.tasksPath, null, '(defaults to JSON provider path)') +
    '</div></div>';
}

function renderNotifications() {
  return '<div class="section"><div class="section__title">Notifications</div><div class="cols-2">' +
    '<div class="field field--row"><input type="checkbox" id="notif-active" ' + (config.notifications?.taskActive !== false ? 'checked' : '') + ' /><label for="notif-active">Task moved to active</label></div>' +
    '<div class="field field--row"><input type="checkbox" id="notif-done" ' + (config.notifications?.taskDone !== false ? 'checked' : '') + ' /><label for="notif-done">Task moved to done</label></div>' +
    '</div></div>';
}

function renderMisc() {
  const ll = config.logLevel ?? '';
  return '<div class="section"><div class="section__title">Misc</div><div class="cols-2">' +
    '<div class="field field--row"><input type="checkbox" id="post-summary" ' + (config.postAgentSummaryToIssue ? 'checked' : '') + ' /><label for="post-summary">Post agent summary to GitHub issue</label></div>' +
    field('poll-interval', 'Poll interval (ms)', 'number', config.pollInterval ?? '', null, 'default') +
    '<div class="field"><label for="log-level">Log level</label><select id="log-level">' +
    '<option value=""' + (!ll ? ' selected' : '') + '>Default</option>' +
    '<option value="debug"' + (ll === 'debug' ? ' selected' : '') + '>Debug</option>' +
    '<option value="info"' + (ll === 'info' ? ' selected' : '') + '>Info</option>' +
    '<option value="warn"' + (ll === 'warn' ? ' selected' : '') + '>Warn</option>' +
    '<option value="error"' + (ll === 'error' ? ' selected' : '') + '>Error</option>' +
    '</select></div>' +
    '</div></div>';
}

function renderActions() {
  return '';
}

function field(id, label, type, value, hint, placeholder) {
  let h = '<div class="field"><label for="' + id + '">' + escHtml(label) + '</label>';
  h += '<input type="' + type + '" id="' + id + '" value="' + esc(value) + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + ' />';
  if (hint) { h += '<span class="hint">' + escHtml(hint) + '</span>'; }
  h += '</div>';
  return h;
}

/* ── helpers ─────────────────────────────────────────────────── */

function esc(val) { return val ?? ''; }
function escHtml(val) { return String(val ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function csvToArray(val) {
  return val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined;
}

function numOrUndef(val) {
  const n = Number(val);
  return isNaN(n) || val === '' ? undefined : n;
}

/* ── Save ────────────────────────────────────────────────────── */

function buildSavePayload() {
  const updated = {
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

  // Collect provider-specific config from dynamic fields
  // enabled flag: use the in-memory provider info (reflects isEnabled())
  for (const p of providerInfos) {
    const section = p.configSection;
    const sectionData = { enabled: p.enabled };
    // Only read field values for active (enabled) providers that have visible inputs
    for (const f of (p.fields || [])) {
      const el = document.getElementById('prov-' + p.id + '-' + f.key);
      if (!el) continue;
      if (f.type === 'boolean') { sectionData[f.key] = el.checked; }
      else if (f.type === 'number') { sectionData[f.key] = numOrUndef(el.value); }
      else { sectionData[f.key] = el.value || undefined; }
    }
    updated[section] = sectionData;
  }

  return updated;
}

function save() {
  vscode.postMessage({ type: 'save', config: buildSavePayload() });
}

/* ── Message handling ──────────────────────────────────────── */

window.addEventListener('message', (e) => {
  if (e.data?.type === 'configData') {
    config = e.data.config;
    render();
  }
  if (e.data?.type === 'providerDiagnostics') {
    providerInfos = e.data.providers;
    render();
  }
});

render();
// Signal the host that the webview is ready to receive messages
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
