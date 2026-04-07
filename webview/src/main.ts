/**
 * Minimal WebView entry point.
 *
 * In Phase 03 this would be built with Vite / React.
 * For now it provides a lightweight vanilla-JS Kanban board
 * that communicates with the host via the typed message protocol.
 */

// @ts-ignore — vscode webview API is injected at runtime
const vscode = acquireVsCodeApi();

interface Column { id: string; label: string }
interface KanbanTask {
  id: string;
  title: string;
  body: string;
  status: string;
  labels: string[];
  assignee?: string;
  url?: string;
  providerId: string;
  agent?: string;
  copilotSession?: {
    state: 'idle' | 'starting' | 'running' | 'paused' | 'done' | 'error';
    providerId?: string;
    startedAt?: string;
    finishedAt?: string;
  };
}
interface AgentOption {
  slug: string;
  displayName: string;
}
interface GenAiProviderOption {
  id: string;
  displayName: string;
  icon: string;
  disabled?: boolean;
  disabledReason?: string;
}

let currentTasks: KanbanTask[] = [];
let currentColumns: Column[] = [];
let selectedTask: KanbanTask | null = null;
let editingTask: KanbanTask | null = null;
let searchText = '';
interface SquadStatus {
  activeCount: number;
  maxSessions: number;
  autoSquadEnabled: boolean;
}
let availableAgents: AgentOption[] = [];
let selectedAgentSlug = '';
let selectedSquadProviderId = '';
let mcpEnabled = false;
let squadStatus: SquadStatus = { activeCount: 0, maxSessions: 10, autoSquadEnabled: false };
let showTaskForm = false;
let formColumns: Column[] = [];
let editableProviderIds: string[] = [];
let genAiProviders: GenAiProviderOption[] = [];

// ── Session panel state ────────────────────────────────────────────
interface FileChangeInfo { path: string; status: 'added' | 'modified' | 'deleted' }
let sessionPanelTaskId: string | null = null;
let sessionStreamLines: string[] = [];
let sessionFileChanges: FileChangeInfo[] = [];
let repoIsGit = true;
let repoIsGitHub = true;
/** When true, auto-scroll to bottom on new output. Disabled when user scrolls up. */
let streamAutoScroll = true;
/** Per-session file change lists (all sessions, not just the open panel). */
const fileChangeLists = new Map<string, FileChangeInfo[]>();

// ── Render ─────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById('root');
  if (!root) { return; }

  const filtered = currentTasks.filter(t => {
    if (!searchText) { return true; }
    const q = searchText.toLowerCase();
    return t.title.toLowerCase().includes(q)
      || t.labels.some(l => l.toLowerCase().includes(q))
      || (t.assignee?.toLowerCase().includes(q) ?? false);
  });

  root.innerHTML = `
    <header class="toolbar">
      <div class="toolbar__row toolbar__row--main">
        <span class="toolbar__title">Agent Board</span>

        <div class="toolbar__group" data-label="Tasks">
          <button class="toolbar__btn toolbar__btn--primary" id="btn-add-task">＋ Add</button>
          <div class="toolbar__search">
            <input class="toolbar__search-input" id="search-input" placeholder="Filter…" value="${escapeHtml(searchText)}" />
            ${searchText ? `<span class="toolbar__badge">${filtered.length}</span>` : ''}
          </div>
          <button class="toolbar__btn toolbar__btn--icon" id="btn-refresh" title="Refresh">⟳</button>
        </div>

        <div class="toolbar__separator"></div>

        <div class="toolbar__group" data-label="Squad">
          <select class="toolbar__select" id="squad-provider-select" title="Provider">
            <option value="">Provider: default</option>
            ${genAiProviders
              .filter(p => !p.disabled)
              .map(p => `<option value="${escapeHtml(p.id)}"${p.id === selectedSquadProviderId ? ' selected' : ''}>${escapeHtml(p.displayName)}</option>`)
              .join('')}
          </select>
          <select class="toolbar__select" id="agent-select" title="Agent">
            <option value="">Agent: any</option>
            ${availableAgents.map(a => `<option value="${escapeHtml(a.slug)}"${a.slug === selectedAgentSlug ? ' selected' : ''}>${escapeHtml(a.displayName)}</option>`).join('')}
          </select>
          <button class="toolbar__btn toolbar__btn--primary" id="btn-start-squad" ${!repoIsGit || squadStatus.activeCount >= squadStatus.maxSessions ? 'disabled' : ''} title="Start Squad">▶ Start</button>
          <button class="toolbar__btn toolbar__btn--toggle${squadStatus.autoSquadEnabled ? ' toolbar__btn--on' : ''}" id="btn-toggle-auto" ${!repoIsGit ? 'disabled' : ''} title="Toggle Auto‑Squad">⟳ Auto</button>
          ${squadStatus.activeCount > 0 ? `<span class="toolbar__badge toolbar__badge--live">${squadStatus.activeCount}/${squadStatus.maxSessions}</span>` : ''}
        </div>

        <div class="toolbar__separator"></div>

        <div class="toolbar__group" data-label="MCP">
          <span class="toolbar__dot toolbar__dot--${mcpEnabled ? 'on' : 'off'}"></span>
          <span class="toolbar__meta">${mcpEnabled ? 'On' : 'Off'}</span>
          <button class="toolbar__btn toolbar__btn--small" id="btn-mcp-toggle">${mcpEnabled ? 'Disable' : 'Enable'}</button>
        </div>
      </div>
    </header>
    ${renderRepoBanners()}
    <div class="kanban">
      ${currentColumns.map(col => renderColumn(col, filtered.filter(t => t.status === col.id))).join('')}
    </div>
    ${selectedTask && !editingTask ? renderDetail(selectedTask) : ''}
    ${editingTask ? renderEditForm(editingTask) : ''}
    ${showTaskForm && !editingTask ? renderTaskForm() : ''}
    ${sessionPanelTaskId ? renderSessionPanel() : ''}
  `;

  // Event listeners
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshRequest' });
  });

  document.getElementById('btn-mcp-toggle')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleMcp' });
  });
  document.getElementById('btn-add-task')?.addEventListener('click', () => {
    showTaskForm = true;
    formColumns = currentColumns;
    selectedTask = null;
    render();
  });

  document.getElementById('search-input')?.addEventListener('input', (e: Event) => {
    searchText = (e.target as HTMLInputElement).value;
    render();
  });

  document.getElementById('squad-provider-select')?.addEventListener('change', (e: Event) => {
    selectedSquadProviderId = (e.target as HTMLSelectElement).value;
  });

  document.getElementById('agent-select')?.addEventListener('change', (e: Event) => {
    selectedAgentSlug = (e.target as HTMLSelectElement).value;
  });

  document.getElementById('btn-start-squad')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'startSquad', agentSlug: selectedAgentSlug || undefined, genAiProviderId: selectedSquadProviderId || undefined });
  });

  document.getElementById('btn-toggle-auto')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleAutoSquad', agentSlug: selectedAgentSlug || undefined, genAiProviderId: selectedSquadProviderId || undefined });
  });

  document.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => {
      const taskId = (card as HTMLElement).dataset.taskId;
      const task = currentTasks.find(t => t.id === taskId) ?? null;
      if (task && editableProviderIds.includes(task.providerId)) {
        editingTask = task;
        selectedTask = null;
        showTaskForm = false;
      } else {
        selectedTask = task;
        editingTask = null;
        showTaskForm = false;
      }
      render();
    });
  });

  document.getElementById('detail-close')?.addEventListener('click', () => {
    selectedTask = null;
    render();
  });

  document.getElementById('detail-copilot')?.addEventListener('click', () => {
    if (selectedTask) {
      vscode.postMessage({ type: 'openCopilot', taskId: selectedTask.id, providerId: 'cloud', agentSlug: selectedAgentSlug || undefined });
      selectedTask = null;
      render();
    }
  });

  // Detail panel — per-provider launch buttons
  document.querySelectorAll('.detail-launch-provider').forEach(btn => {
    btn.addEventListener('click', () => {
      const providerId = (btn as HTMLElement).dataset.providerId;
      if (selectedTask && providerId) {
        vscode.postMessage({ type: 'launchProvider', taskId: selectedTask.id, genAiProviderId: providerId });
        selectedTask = null;
        render();
      }
    });
  });

  // Detail panel — reopen running session
  document.getElementById('detail-reopen-session')?.addEventListener('click', () => {
    if (selectedTask) {
      vscode.postMessage({ type: 'reopenSession', taskId: selectedTask.id });
    }
  });

  // Detail panel — cancel running session
  document.getElementById('detail-cancel-session')?.addEventListener('click', () => {
    if (selectedTask) {
      vscode.postMessage({ type: 'cancelSession', taskId: selectedTask.id });
    }
  });

  // Detail panel — open session panel (stream + files)
  document.getElementById('detail-open-session-panel')?.addEventListener('click', () => {
    if (selectedTask) {
      sessionPanelTaskId = selectedTask.id;
      sessionStreamLines = [];
      sessionFileChanges = fileChangeLists.get(selectedTask.id) ?? [];
      selectedTask = null;
      render();
      // Request accumulated log replay from the host
      vscode.postMessage({ type: 'requestStreamResume', sessionId: sessionPanelTaskId });
    }
  });

  // ── Session panel listeners ────────────────────────────────────────
  document.getElementById('session-panel-close')?.addEventListener('click', () => {
    sessionPanelTaskId = null;
    sessionStreamLines = [];
    sessionFileChanges = [];
    streamAutoScroll = true;
    render();
  });  // Auto-scroll override: if user scrolls up, disable; if they reach the bottom, re-enable
  const scrollEl = document.getElementById('session-stream-scroll');
  if (scrollEl) {
    scrollEl.addEventListener('scroll', () => {
      const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 40;
      streamAutoScroll = atBottom;
    }, { passive: true });
  }
  document.getElementById('session-btn-terminal')?.addEventListener('click', () => {
    if (sessionPanelTaskId) {
      vscode.postMessage({ type: 'openTerminalInWorktree', sessionId: sessionPanelTaskId });
    }
  });
  document.getElementById('session-btn-stop')?.addEventListener('click', () => {
    if (sessionPanelTaskId) {
      vscode.postMessage({ type: 'cancelSession', taskId: sessionPanelTaskId });
    }
  });
  document.getElementById('session-btn-full-diff')?.addEventListener('click', () => {
    if (sessionPanelTaskId) {
      vscode.postMessage({ type: 'openFullDiff', sessionId: sessionPanelTaskId });
    }
  });
  document.getElementById('session-btn-export')?.addEventListener('click', () => {
    if (sessionPanelTaskId) {
      vscode.postMessage({ type: 'exportLog', sessionId: sessionPanelTaskId });
    }
  });
  // "Run in terminal" buttons inside bash blocks
  document.querySelectorAll('.stream-run-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = (btn as HTMLElement).dataset.cmd ?? '';
      if (cmd && sessionPanelTaskId) {
        vscode.postMessage({ type: 'openTerminalInWorktree', sessionId: sessionPanelTaskId });
      }
    });
  });
  // FILE links inside stream output
  document.querySelectorAll('.stream-file-link').forEach(link => {
    link.addEventListener('click', () => {
      const filePath = (link as HTMLElement).dataset.filePath;
      if (filePath && sessionPanelTaskId) {
        vscode.postMessage({ type: 'openDiff', sessionId: sessionPanelTaskId, filePath });
      }
    });
  });
  document.getElementById('session-follow-up-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    const input = document.getElementById('session-follow-up-input') as HTMLInputElement | null;
    if (input && sessionPanelTaskId && input.value.trim()) {
      vscode.postMessage({ type: 'sendFollowUp', sessionId: sessionPanelTaskId, text: input.value.trim() });
      input.value = '';
    }
  });
  document.querySelectorAll('.session-file-item').forEach(item => {
    item.addEventListener('click', () => {
      const filePath = (item as HTMLElement).dataset.filePath;
      if (filePath && sessionPanelTaskId) {
        vscode.postMessage({ type: 'openDiff', sessionId: sessionPanelTaskId, filePath });
      }
    });
  });

  // ── Task form listeners ──────────────────────────────────────────
  document.getElementById('task-form-close')?.addEventListener('click', () => {
    showTaskForm = false;
    editingTask = null;
    render();
  });
  document.getElementById('task-form-cancel')?.addEventListener('click', () => {
    showTaskForm = false;
    editingTask = null;
    render();
  });

  document.getElementById('task-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const title = (form.querySelector('#tf-title') as HTMLInputElement).value.trim();
    if (!title) { return; }
    const body = (form.querySelector('#tf-body') as HTMLTextAreaElement).value.trim();
    const status = (form.querySelector('#tf-status') as HTMLSelectElement).value;
    const labels = (form.querySelector('#tf-labels') as HTMLInputElement).value.trim();
    const assignee = (form.querySelector('#tf-assignee') as HTMLInputElement).value.trim();

    if (editingTask) {
      vscode.postMessage({ type: 'editTask', taskId: editingTask.id, data: { title, body, status, labels, assignee } });
      editingTask = null;
    } else {
      vscode.postMessage({ type: 'saveTask', data: { title, body, status, labels, assignee } });
      showTaskForm = false;
    }
    render();
  });

  // ── GenAI provider action buttons ─────────────────────────────────
  document.querySelectorAll('.actions__provider-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const providerId = (btn as HTMLElement).dataset.providerId;
      if (editingTask && providerId) {
        vscode.postMessage({ type: 'launchProvider', taskId: editingTask.id, genAiProviderId: providerId });
        editingTask = null;
        showTaskForm = false;
        render();
      }
    });
  });

  // DnD — dragstart
  document.querySelectorAll('.task-card').forEach(card => {
    (card as HTMLElement).setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (e: Event) => {
      const de = e as DragEvent;
      const taskId = (card as HTMLElement).dataset.taskId ?? '';
      de.dataTransfer?.setData('text/plain', taskId);
      (card as HTMLElement).classList.add('task-card--dragging');
    });
    card.addEventListener('dragend', () => {
      (card as HTMLElement).classList.remove('task-card--dragging');
    });
  });

  // DnD — drop zones
  document.querySelectorAll('.kanban__column-body').forEach(zone => {
    zone.addEventListener('dragover', (e: Event) => { e.preventDefault(); });
    zone.addEventListener('drop', (e: Event) => {
      e.preventDefault();
      const de = e as DragEvent;
      const taskId = de.dataTransfer?.getData('text/plain');
      const colId = (zone as HTMLElement).dataset.colId;
      if (taskId && colId) {
        vscode.postMessage({ type: 'taskMoved', taskId, toCol: colId, index: 0 });
      }
    });
  });
}

function renderColumn(col: Column, tasks: KanbanTask[]): string {
  return `
    <div class="kanban__column">
      <div class="kanban__column-header">
        <span>${escapeHtml(col.label)}</span>
        <span class="kanban__column-count">${tasks.length}</span>
      </div>
      <div class="kanban__column-body" data-col-id="${col.id}">
        ${tasks.length === 0
          ? '<div class="kanban__placeholder">No tasks</div>'
          : tasks.map(renderCard).join('')}
      </div>
    </div>
  `;
}

function renderCard(task: KanbanTask): string {
  const initials = task.assignee
    ? task.assignee.slice(0, 2).toUpperCase()
    : '';
  const session = task.copilotSession;
  const SESSION_BADGES: Record<string, { icon: string; label: string }> = {
    idle:     { icon: '⏸', label: 'Idle' },
    starting: { icon: '▶', label: 'Starting' },
    running:  { icon: '⟳', label: 'Running' },
    paused:   { icon: '⏸', label: 'Paused' },
    done:     { icon: '✓', label: 'Done' },
    error:    { icon: '✗', label: 'Error' },
  };
  const sessionBadge = session
    ? (() => {
        const b = SESSION_BADGES[session.state] ?? { icon: '●', label: session.state };
        return `<span class="task-card__session task-card__session--${session.state}" title="Session: ${b.label}">${b.icon}</span>`;
      })()
    : '';
  const isActive = session?.state === 'running' || session?.state === 'starting';
  const agentBadge = task.agent
    ? `<span class="task-card__agent" title="Agent: ${escapeHtml(task.agent)}">🤖 ${escapeHtml(task.agent)}</span>`
    : '';
  const diffFiles = fileChangeLists.get(task.id);
  const diffBadge = diffFiles && diffFiles.length > 0
    ? `<span class="task-card__diff-badge" title="${diffFiles.length} file${diffFiles.length === 1 ? '' : 's'} changed">●&thinsp;${diffFiles.length}</span>`
    : '';
  return `
    <div class="task-card${isActive ? ' task-card--running' : ''}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-card__title">${escapeHtml(task.title)}</div>
      <div class="task-card__meta">
        ${sessionBadge}
        ${task.labels.map(l => `<span class="task-card__label">${escapeHtml(l)}</span>`).join('')}
        ${initials ? `<span class="task-card__assignee">${initials}</span>` : ''}
        <span class="task-card__provider">${escapeHtml(task.providerId)}</span>
        ${diffBadge}
      </div>
      ${agentBadge ? `<div class="task-card__footer">${agentBadge}</div>` : ''}
    </div>
  `;
}

function renderDetail(task: KanbanTask): string {
  const sessionInfo = task.copilotSession;
  const isActiveSession = sessionInfo?.state === 'running' || sessionInfo?.state === 'starting';
  const sessionLine = sessionInfo
    ? `<div class="task-detail__session">
        Session: <strong>${sessionInfo.state}</strong>${sessionInfo.startedAt ? ` — started ${sessionInfo.startedAt}` : ''}
        ${isActiveSession ? `<button class="task-detail__reopen-btn" id="detail-reopen-session">↗ Open Session</button>` : ''}
        ${isActiveSession ? `<button class="task-detail__reopen-btn" id="detail-open-session-panel">📊 Session Panel</button>` : ''}
        ${isActiveSession ? `<button class="task-detail__reopen-btn task-detail__reopen-btn--stop" id="detail-cancel-session">■ Stop</button>` : ''}
        ${!isActiveSession && sessionInfo.state !== 'idle' ? `<button class="task-detail__reopen-btn" id="detail-open-session-panel">📊 View Log</button>` : ''}
      </div>`
    : '';
  return `
    <div class="task-detail">
      <button class="task-detail__close" id="detail-close">✕</button>
      <div class="task-detail__title">${escapeHtml(task.title)}</div>
      <div class="task-detail__labels">
        ${task.labels.map(l => `<span class="task-card__label">${escapeHtml(l)}</span>`).join('')}
      </div>
      <div class="task-detail__body">${escapeHtml(task.body)}</div>
      ${sessionLine}
      ${task.url ? `<a class="task-detail__link" href="${escapeHtml(task.url)}">Open source ↗</a>` : ''}
      <div class="task-detail__actions">
        ${genAiProviders.map(p => `
          <button class="task-detail__copilot-btn detail-launch-provider${p.disabled ? ' task-detail__copilot-btn--disabled' : ''}" data-provider-id="${escapeHtml(p.id)}" ${p.disabled ? 'disabled' : ''} title="${escapeHtml(p.disabled ? (p.disabledReason ?? 'Not available') : p.displayName)}">
            🤖 ${escapeHtml(p.displayName)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderEditForm(task: KanbanTask): string {
  const cols = currentColumns;
  return `
    <div class="task-form-overlay">
      <div class="task-form-panel">
        <button class="task-form-panel__close" id="task-form-close">✕</button>
        <div class="task-form-panel__heading">Edit Task</div>
        <form id="task-form" class="task-form">
          <label class="task-form__label" for="tf-title">Title *</label>
          <input class="task-form__input" id="tf-title" type="text" value="${escapeHtml(task.title)}" required />

          <label class="task-form__label" for="tf-body">Description</label>
          <textarea class="task-form__textarea" id="tf-body" rows="4">${escapeHtml(task.body)}</textarea>

          <label class="task-form__label" for="tf-status">Status</label>
          <select class="task-form__select" id="tf-status">
            ${cols.map(c => `<option value="${escapeHtml(c.id)}"${c.id === task.status ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
          </select>

          <label class="task-form__label" for="tf-labels">Labels</label>
          <input class="task-form__input" id="tf-labels" type="text" value="${escapeHtml(task.labels.join(', '))}" placeholder="bug, feature  (comma separated)" />

          <label class="task-form__label" for="tf-assignee">Assignee</label>
          <input class="task-form__input" id="tf-assignee" type="text" value="${escapeHtml(task.assignee ?? '')}" placeholder="Username" />

          <div class="task-form__actions">
            <button type="submit" class="task-form__btn task-form__btn--save">Save</button>
            <button type="button" class="task-form__btn task-form__btn--cancel" id="task-form-cancel">Close</button>
          </div>
        </form>
        ${genAiProviders.length > 0 ? `
        <div class="actions-toolbar">
          <div class="actions-toolbar__heading">Actions</div>
          <div class="actions-toolbar__list">
            ${genAiProviders.map(p => `
              <button class="actions__provider-btn${p.disabled ? ' actions__provider-btn--disabled' : ''}" data-provider-id="${escapeHtml(p.id)}" ${p.disabled ? 'disabled' : ''} title="${escapeHtml(p.disabled ? (p.disabledReason ?? 'Not available') : p.displayName)}">
                <span class="actions__provider-icon codicon codicon-${escapeHtml(p.icon)}"></span>
                ${escapeHtml(p.displayName)}
              </button>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderTaskForm(): string {
  const cols = formColumns.length > 0 ? formColumns : currentColumns;
  return `
    <div class="task-form-overlay">
      <div class="task-form-panel">
        <button class="task-form-panel__close" id="task-form-close">✕</button>
        <div class="task-form-panel__heading">New Task</div>
        <form id="task-form" class="task-form">
          <label class="task-form__label" for="tf-title">Title *</label>
          <input class="task-form__input" id="tf-title" type="text" placeholder="What needs to be done?" required />

          <label class="task-form__label" for="tf-body">Description</label>
          <textarea class="task-form__textarea" id="tf-body" rows="4" placeholder="Add more details…"></textarea>

          <label class="task-form__label" for="tf-status">Status</label>
          <select class="task-form__select" id="tf-status">
            ${cols.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('')}
          </select>

          <label class="task-form__label" for="tf-labels">Labels</label>
          <input class="task-form__input" id="tf-labels" type="text" placeholder="bug, feature  (comma separated)" />

          <label class="task-form__label" for="tf-assignee">Assignee</label>
          <input class="task-form__input" id="tf-assignee" type="text" placeholder="Username" />

          <div class="task-form__actions">
            <button type="submit" class="task-form__btn task-form__btn--save">Save</button>
            <button type="button" class="task-form__btn task-form__btn--cancel" id="task-form-cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderRepoBanners(): string {
  const banners: string[] = [];
  if (!repoIsGit) {
    banners.push(`
      <div class="repo-banner repo-banner--warn">
        <span class="repo-banner__icon">⚠</span>
        <span class="repo-banner__text">
          Questo progetto non è un repository Git.
          <span class="repo-banner__provider">Squad</span>,
          <span class="repo-banner__provider">Copilot LM API</span>,
          <span class="repo-banner__provider">Copilot CLI</span> e
          <span class="repo-banner__provider">Cloud</span> sono disabilitati.
        </span>
      </div>
    `);
  } else if (!repoIsGitHub) {
    banners.push(`
      <div class="repo-banner repo-banner--warn">
        <span class="repo-banner__icon">⚠</span>
        <span class="repo-banner__text">
          Nessun remote GitHub collegato.
          <span class="repo-banner__provider">Cloud</span> è disabilitato.
        </span>
      </div>
    `);
  }
  if (banners.length === 0) { return ''; }
  return `<div class="repo-banners">${banners.join('')}</div>`;
}

// ── Stream output rich rendering ───────────────────────────────────

/** Lightweight client-side parser state for fenced blocks. */
let _fenceMode: 'none' | 'diff' | 'bash' | 'code' = 'none';

/**
 * Convert a single raw stream line to an HTML string with appropriate
 * class/markup for diffs, bash blocks, file links, and timestamps.
 */
function renderStreamLine(rawLine: string): string {
  // Strip leading timestamp prefix stored by StreamController (e.g. "[12:34:56] ")
  const tsMatch = rawLine.match(/^\[(\d{2}:\d{2}:\d{2})\] (.*)/s);
  const ts = tsMatch ? tsMatch[1] : '';
  const line = tsMatch ? tsMatch[2] : rawLine;

  const tsHtml = ts ? `<span class="stream-ts">[${escapeHtml(ts)}]</span> ` : '';

  // Fence open / close
  const fenceMatch = line.match(/^```(\w*)$/);
  if (fenceMatch) {
    if (_fenceMode !== 'none') {
      // Close – emit a separator
      _fenceMode = 'none';
      return `<div class="stream-output__line stream-fence-close"></div>`;
    }
    const lang = (fenceMatch[1] || 'text').toLowerCase();
    _fenceMode = lang === 'diff' ? 'diff' : (lang === 'bash' || lang === 'sh' || lang === 'shell') ? 'bash' : 'code';
    return `<div class="stream-output__line stream-fence-open stream-fence-open--${_fenceMode}">${tsHtml}<span class="stream-fence-lang">${escapeHtml(lang || 'code')}</span></div>`;
  }

  if (_fenceMode === 'diff') {
    if (line.startsWith('+')) {
      return `<div class="stream-output__line stream-output__line--diff-add">${tsHtml}${escapeHtml(line)}</div>`;
    }
    if (line.startsWith('-')) {
      return `<div class="stream-output__line stream-output__line--diff-del">${tsHtml}${escapeHtml(line)}</div>`;
    }
    return `<div class="stream-output__line stream-output__line--diff-ctx">${tsHtml}${escapeHtml(line)}</div>`;
  }

  if (_fenceMode === 'bash') {
    return `<div class="stream-output__line stream-output__line--bash">${tsHtml}<code>${escapeHtml(line)}</code>` +
      `<button class="stream-run-btn" data-cmd="${escapeHtml(line)}" title="Run in terminal">▶</button></div>`;
  }

  // FILE: path pattern → clickable link
  const fileMatch = line.match(/^FILE:\s*(.+)$/);
  if (fileMatch) {
    const filePath = fileMatch[1].trim();
    return `<div class="stream-output__line stream-output__line--file">${tsHtml}` +
      `<span class="stream-file-link" data-file-path="${escapeHtml(filePath)}" title="Open diff">📄 ${escapeHtml(filePath)}</span></div>`;
  }

  return `<div class="stream-output__line">${tsHtml}${escapeHtml(line)}</div>`;
}

function renderSessionPanel(): string {
  const task = currentTasks.find(t => t.id === sessionPanelTaskId);
  const title = task ? escapeHtml(task.title) : sessionPanelTaskId ?? '';
  const isRunning = task?.copilotSession?.state === 'running' || task?.copilotSession?.state === 'starting';
  const statusIcons: Record<string, string> = { added: '＋', modified: '✎', deleted: '✕' };
  // Reset fence parser state on full render
  _fenceMode = 'none';
  const renderedLines = sessionStreamLines.map(renderStreamLine).join('');
  return `
    <div class="session-panel">
      <div class="session-panel__header">
        <span class="session-panel__title">${title}</span>
        <div class="session-panel__action-bar">
          <button class="toolbar__btn toolbar__btn--small" id="session-btn-terminal" title="Open in Terminal">⌨ Terminal</button>
          <button class="toolbar__btn toolbar__btn--small" id="session-btn-full-diff" title="Full Diff">Diff</button>
          <button class="toolbar__btn toolbar__btn--small" id="session-btn-export" title="Export Log">Export</button>
          ${isRunning ? `<button class="toolbar__btn toolbar__btn--small toolbar__btn--danger" id="session-btn-stop" title="Stop Agent">■ Stop</button>` : ''}
          <button class="session-panel__close" id="session-panel-close">✕</button>
        </div>
      </div>
      <div class="session-panel__body">
        <div class="session-panel__stream" id="session-stream-scroll">
          <div class="stream-output" id="stream-output">${renderedLines}</div>
        </div>
        <div class="session-panel__files">
          <div class="file-list__header">Changed files (${sessionFileChanges.length})</div>
          ${sessionFileChanges.length === 0
            ? '<div class="file-list__empty">No changes yet</div>'
            : sessionFileChanges.map(f => `
              <div class="session-file-item file-list__item file-list__item--${f.status}" data-file-path="${escapeHtml(f.path)}">
                <span class="file-list__icon">${statusIcons[f.status] || '?'}</span>
                <span class="file-list__path">${escapeHtml(f.path)}</span>
              </div>
            `).join('')}
        </div>
      </div>
      <form class="session-panel__follow-up" id="session-follow-up-form">
        <input class="task-form__input" id="session-follow-up-input" type="text" placeholder="Send follow-up…" />
        <button type="submit" class="toolbar__btn toolbar__btn--primary">Send</button>
      </form>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Message handling ───────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  switch (msg.type) {
    case 'tasksUpdate':
      currentTasks = msg.tasks ?? [];
      currentColumns = msg.columns ?? [];
      editableProviderIds = msg.editableProviderIds ?? [];
      genAiProviders = msg.genAiProviders ?? [];
      // If the editing task was refreshed, update its data
      if (editingTask) {
        const updated = currentTasks.find(t => t.id === editingTask!.id);
        if (updated) { editingTask = updated; }
        else { editingTask = null; }
      }
      render();
      break;
    case 'agentsAvailable':
      availableAgents = msg.agents ?? [];
      // Reset selected agent if it was removed
      if (selectedAgentSlug && !availableAgents.some(a => a.slug === selectedAgentSlug)) {
        selectedAgentSlug = '';
      }
      render();
      break;
    case 'squadStatus':
      squadStatus = msg.status ?? squadStatus;
      render();
      break;
    case 'mcpStatus':
      mcpEnabled = msg.enabled ?? false;
      render();
      break;
    case 'showTaskForm':
      formColumns = msg.columns ?? currentColumns;
      showTaskForm = true;
      selectedTask = null;
      render();
      break;
    case 'streamOutput':
      if (sessionPanelTaskId === msg.sessionId) {
        const newLines = msg.text.split('\n');
        sessionStreamLines.push(...newLines);
        // Cap to last 500 lines in the UI for performance
        if (sessionStreamLines.length > 500) {
          sessionStreamLines = sessionStreamLines.slice(-500);
        }
        const outputEl = document.getElementById('stream-output');
        const scrollEl2 = document.getElementById('session-stream-scroll');
        if (outputEl) {
          for (const l of newLines) {
            // Synthesise the stored form (with timestamp) for rendering
            const stored = `[${msg.ts}] ${l}`;
            outputEl.insertAdjacentHTML('beforeend', renderStreamLine(stored));
          }
          if (streamAutoScroll && scrollEl2) {
            scrollEl2.scrollTop = scrollEl2.scrollHeight;
          }
        } else {
          render();
        }
      }
      break;
    case 'fileChanges':
      fileChangeLists.set(msg.sessionId, msg.files ?? []);
      if (sessionPanelTaskId === msg.sessionId) {
        sessionFileChanges = msg.files ?? [];
      }
      render();
      break;
    case 'streamResume':
      if (sessionPanelTaskId === msg.sessionId) {
        // Populate buffer with full historic log, then re-render
        sessionStreamLines = msg.log.split('\n');
        if (sessionStreamLines.length > 500) {
          sessionStreamLines = sessionStreamLines.slice(-500);
        }
        render();
      }
      break;
    case 'themeChange':
      // Theme is auto-applied via CSS variables; nothing to do.
      break;
    case 'repoStatus':
      repoIsGit = msg.isGit ?? true;
      repoIsGitHub = msg.isGitHub ?? true;
      render();
      break;
  }
});

// Signal the host that the WebView is ready
vscode.postMessage({ type: 'ready' });
