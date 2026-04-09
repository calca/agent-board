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
  /** Arbitrary provider metadata (e.g. avatarUrl from GitHub). */
  meta?: Record<string, unknown>;
  copilotSession?: {
    state: 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error' | 'interrupted';
    providerId?: string;
    startedAt?: string;
    finishedAt?: string;
    /** Pull request URL after PR creation. */
    prUrl?: string;
    /** Pull request number. */
    prNumber?: number;
    /** Pull request state. */
    prState?: 'open' | 'merged' | 'closed';
    /** Files changed during the session. */
    changedFiles?: string[];
    /** Relative path to worktree directory. */
    worktreePath?: string;
    /** Human-readable error message when state is 'error'. */
    errorMessage?: string;
  };
}
interface AgentOption {
  slug: string;
  displayName: string;
  canSquad?: boolean;
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
let workspaceRoot = '';
/** When true, auto-scroll to bottom on new output. Disabled when user scrolls up. */
let streamAutoScroll = true;
/** Per-session file change lists (all sessions, not just the open panel). */
const fileChangeLists = new Map<string, FileChangeInfo[]>();
/** Per-session tool-call status string currently shown in the card. */
const toolCallStatus = new Map<string, string>();

/**
 * Chat messages stored for multi-turn display.
 * role: 'user' | 'assistant' | 'tool'
 */
interface ChatMessage { role: 'user' | 'assistant' | 'tool'; text: string; ts: string }
let sessionChatMessages: ChatMessage[] = [];

// ── Full view state ────────────────────────────────────────────────
interface TaskLogEntry {
  ts: string;
  source: 'board' | 'agent' | 'tool' | 'system';
  text: string;
}
let fullViewTaskId: string | null = null;
const taskEventLogs = new Map<string, TaskLogEntry[]>();
let fullViewAutoScroll = true;
let logExpanded = false;
/** Sessions whose worktree has been merged successfully — enables "Delete Workspace". */
const mergedSessions = new Set<string>();

// ── Render ─────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById('root');
  if (!root) { return; }

  // Skip full re-render when a form overlay is open to avoid losing user input
  if ((showTaskForm || editingTask) && document.getElementById('task-form-overlay')) {
    return;
  }

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
            ${(() => {
              const squadProviders = genAiProviders.filter(p => !p.disabled && p.id !== 'chat');
              if (squadProviders.length === 0) { return '<option value="">No providers</option>'; }
              return squadProviders.map((p, i) => `<option value="${escapeHtml(p.id)}"${(selectedSquadProviderId ? p.id === selectedSquadProviderId : i === 0) ? ' selected' : ''}>${escapeHtml(p.displayName)}</option>`).join('');
            })()}
          </select>
          <select class="toolbar__select" id="agent-select" title="Agent"${availableAgents.some(a => a.canSquad) ? '' : ' disabled'}>
            ${(() => {
              const squadAgents = availableAgents.filter(a => a.canSquad);
              if (squadAgents.length === 0) { return '<option value="">No agents</option>'; }
              return squadAgents.map((a, i) => `<option value="${escapeHtml(a.slug)}"${(selectedAgentSlug ? a.slug === selectedAgentSlug : i === 0) ? ' selected' : ''}>${escapeHtml(a.displayName)}</option>`).join('');
            })()}
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
    ${editingTask ? renderEditForm(editingTask) : ''}
    ${showTaskForm && !editingTask ? renderTaskForm() : ''}
    ${sessionPanelTaskId ? renderSessionPanel() : ''}
    ${fullViewTaskId ? renderFullView() : ''}
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
      if (taskId) { openFullView(taskId); }
    });
  });

  // Card action buttons
  document.querySelectorAll('.card-btn-edit').forEach(btn => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const taskId = (btn as HTMLElement).dataset.taskId;
      if (!taskId) { return; }
      const task = currentTasks.find(t => t.id === taskId);
      if (task) {
        editingTask = task;
        formColumns = currentColumns;
        showTaskForm = false;
        render();
      }
    });
  });
  document.querySelectorAll('.card-btn-execute').forEach(btn => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const taskId = (btn as HTMLElement).dataset.taskId;
      if (taskId) { openFullView(taskId); }
    });
  });

  // ── Session panel listeners ────────────────────────────────────────
  document.getElementById('session-panel-close')?.addEventListener('click', () => {
    sessionPanelTaskId = null;
    sessionStreamLines = [];
    sessionChatMessages = [];
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

  // ── Full view listeners ────────────────────────────────────────────
  document.getElementById('fv-close')?.addEventListener('click', () => {
    fullViewTaskId = null;
    fullViewAutoScroll = true;
    render();
  });

  const fvScrollEl = document.getElementById('fv-log-scroll');
  if (fvScrollEl) {
    fvScrollEl.addEventListener('scroll', () => {
      const atBottom = fvScrollEl.scrollHeight - fvScrollEl.scrollTop - fvScrollEl.clientHeight < 40;
      fullViewAutoScroll = atBottom;
    }, { passive: true });
  }
  document.getElementById('fv-log-expand')?.addEventListener('click', () => {
    logExpanded = !logExpanded;
    render();
  });

  document.getElementById('fv-btn-stop')?.addEventListener('click', () => {
    if (fullViewTaskId) { vscode.postMessage({ type: 'cancelSession', taskId: fullViewTaskId }); }
  });
  // ── Full view edit button → open overlay ────────────────────────────
  document.getElementById('fv-edit-btn')?.addEventListener('click', () => {
    if (!fullViewTaskId) { return; }
    const task = currentTasks.find(t => t.id === fullViewTaskId);
    if (task) {
      editingTask = task;
      formColumns = currentColumns;
      showTaskForm = false;
      render();
    }
  });
  // ── Full view inline edit form ──────────────────────────────────────
  document.getElementById('fv-edit-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    if (!fullViewTaskId) { return; }
    const title = (document.getElementById('fv-edit-title') as HTMLInputElement)?.value.trim();
    if (!title) { return; }
    const body = (document.getElementById('fv-edit-body') as HTMLTextAreaElement)?.value.trim() ?? '';
    const status = (document.getElementById('fv-edit-status') as HTMLSelectElement)?.value ?? '';
    const labels = (document.getElementById('fv-edit-labels') as HTMLInputElement)?.value.trim() ?? '';
    const assignee = (document.getElementById('fv-edit-assignee') as HTMLInputElement)?.value.trim() ?? '';
    vscode.postMessage({ type: 'editTask', taskId: fullViewTaskId, data: { title, body, status, labels, assignee } });
  });
  // Immediate status change from any full-view status select
  document.getElementById('fv-status-select')?.addEventListener('change', (e: Event) => {
    const newStatus = (e.target as HTMLSelectElement).value;
    if (fullViewTaskId && newStatus) {
      vscode.postMessage({ type: 'taskMoved', taskId: fullViewTaskId, toCol: newStatus, index: 0 });
    }
  });
  document.getElementById('fv-edit-status')?.addEventListener('change', (e: Event) => {
    const newStatus = (e.target as HTMLSelectElement).value;
    if (fullViewTaskId && newStatus) {
      vscode.postMessage({ type: 'taskMoved', taskId: fullViewTaskId, toCol: newStatus, index: 0 });
    }
  });
  document.querySelectorAll('.fv-file-item').forEach(item => {
    item.addEventListener('click', () => {
      const filePath = (item as HTMLElement).dataset.filePath;
      if (filePath && fullViewTaskId) {
        vscode.postMessage({ type: 'openDiff', sessionId: fullViewTaskId, filePath });
      }
    });
  });
  document.querySelectorAll('.fv-launch-provider').forEach(btn => {
    btn.addEventListener('click', () => {
      const providerId = (btn as HTMLElement).dataset.providerId;
      if (fullViewTaskId && providerId) {
        vscode.postMessage({ type: 'launchProvider', taskId: fullViewTaskId, genAiProviderId: providerId });
      }
    });
  });

  // ── Open worktree in VS Code (all views) ──────────────────────────
  document.querySelectorAll('.fv-open-worktree').forEach(btn => {
    btn.addEventListener('click', () => {
      const wtPath = (btn as HTMLElement).dataset.wtPath;
      if (wtPath) {
        vscode.postMessage({ type: 'openWorktree', worktreePath: wtPath });
      }
    });
  });

  // ── Review & merge worktree (all views) ───────────────────────────
  document.querySelectorAll('.fv-review-wt, .card-review-wt').forEach(btn => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation(); // prevent card click → full view
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (sessionId) { vscode.postMessage({ type: 'reviewWorktree', sessionId }); }
    });
  });
  document.querySelectorAll('.fv-merge-confirm').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (!sessionId) { return; }
      const panel = (btn as HTMLElement).closest('.fv-merge-panel');
      const select = panel?.querySelector<HTMLSelectElement>('.fv-merge-select');
      const mergeStrategy = (select?.value ?? 'squash') as 'squash' | 'merge' | 'rebase';
      vscode.postMessage({ type: 'mergeWorktree', sessionId, mergeStrategy });
    });
  });
  document.querySelectorAll('.fv-agent-merge').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (!sessionId) { return; }
      const panel = (btn as HTMLElement).closest('.fv-merge-panel');
      const select = panel?.querySelector<HTMLSelectElement>('.fv-merge-select');
      const mergeStrategy = (select?.value ?? 'squash') as 'squash' | 'merge' | 'rebase';
      const task = currentTasks.find(t => t.id === sessionId);
      const providerId = task?.copilotSession?.providerId ?? '';
      vscode.postMessage({ type: 'agentMerge', sessionId, mergeStrategy, providerId });
    });
  });
  document.querySelectorAll('.fv-delete-wt').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (sessionId) { vscode.postMessage({ type: 'deleteWorktree', sessionId }); }
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
  // Close on overlay backdrop click
  document.getElementById('task-form-overlay')?.addEventListener('click', (e: Event) => {
    if ((e.target as HTMLElement).id === 'task-form-overlay') {
      showTaskForm = false;
      editingTask = null;
      render();
    }
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

  // ── Post-render auto-scroll for full view and session panel ────────
  if (fullViewAutoScroll) {
    const fvScroll = document.getElementById('fv-log-scroll');
    if (fvScroll) { fvScroll.scrollTop = fvScroll.scrollHeight; }
  }
  if (streamAutoScroll) {
    const ssScroll = document.getElementById('session-stream-scroll');
    if (ssScroll) { ssScroll.scrollTop = ssScroll.scrollHeight; }
  }
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
  const SESSION_LABELS: Record<string, string> = {
    idle:        'Idle',
    starting:    'Starting',
    running:     'Running',
    paused:      'Paused',
    completed:   'Completed',
    error:       'Error',
    interrupted: 'Interrupted',
  };
  const sessionBadge = session
    ? (() => {
        const label = SESSION_LABELS[session.state] ?? session.state;
        return `<span class="task-card__session task-card__session--${session.state}">${escapeHtml(label)}</span>`;
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
  // PR badge from copilot session
  const pr = session?.prUrl
    ? `<a class="task-card__pr-badge task-card__pr-badge--${session.prState ?? 'open'}" href="${escapeHtml(session.prUrl)}" title="PR #${session.prNumber ?? ''}: ${session.prState ?? 'open'}">⤴ PR${session.prNumber ? ` #${session.prNumber}` : ''}</a>`
    : '';
  // Tool-call status badge (shown while session is running)
  const tcs = toolCallStatus.get(task.id);
  const toolCallBadge = tcs && isActive
    ? `<div class="task-card__tool-status" title="${escapeHtml(tcs)}">🔧 ${escapeHtml(tcs)}</div>`
    : '';
  // Avatar: prefer meta.avatarUrl populated by GitHubProvider, fallback to initials
  const avatarUrl = (task.meta as Record<string, unknown>)?.avatarUrl as string | undefined;
  const assigneeHtml = avatarUrl
    ? `<img class="task-card__avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(task.assignee ?? '')}" title="${escapeHtml(task.assignee ?? '')}" />`
    : (initials ? `<span class="task-card__assignee">${initials}</span>` : '');
  const wtBadge = session?.worktreePath
    ? `<span class="task-card__wt-badge" title="${escapeHtml(relativeWorktreePath(session.worktreePath))}">🌿</span><button class="task-card__diff-btn card-review-wt" data-session-id="${escapeHtml(task.id)}" title="Review Diff vs Main">⇄</button>`
    : '';
  return `
    <div class="task-card${isActive ? ' task-card--running' : ''}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-card__title">${escapeHtml(task.title)}</div>
      <div class="task-card__meta">
        ${sessionBadge}
        ${task.labels.filter(l => !l.startsWith('kanban:')).map(l => `<span class="task-card__label">${escapeHtml(l)}</span>`).join('')}
        ${assigneeHtml}
        <span class="task-card__provider">${escapeHtml(task.providerId)}</span>
        ${diffBadge}
        ${pr}
        ${wtBadge}
      </div>
      ${toolCallBadge}
      ${agentBadge ? `<div class="task-card__footer">${agentBadge}</div>` : ''}
      <div class="task-card__actions">
        <button class="task-card__action-btn card-btn-edit" data-task-id="${escapeHtml(task.id)}" title="Edit">✎</button>
        <button class="task-card__action-btn card-btn-execute" data-task-id="${escapeHtml(task.id)}" title="Execute">▶</button>
      </div>
    </div>
  `;
}

function renderEditForm(task: KanbanTask): string {
  const cols = currentColumns;
  return `
    <div class="task-form-overlay" id="task-form-overlay">
      <div class="task-form-panel">
        <button class="task-form-panel__close" id="task-form-close">✕</button>
        <div class="task-form-panel__heading">Edit Task</div>
        <form id="task-form" class="task-form">
          <label class="task-form__label" for="tf-title">Title *</label>
          <input class="task-form__input" id="tf-title" type="text" value="${escapeHtml(task.title)}" required />

          <label class="task-form__label" for="tf-body">Description</label>
          <textarea class="task-form__textarea" id="tf-body" rows="8">${escapeHtml(task.body)}</textarea>

          <div class="task-form__row">
            <div class="task-form__field">
              <label class="task-form__label" for="tf-status">Status</label>
              <select class="task-form__select" id="tf-status">
                ${cols.map(c => `<option value="${escapeHtml(c.id)}"${c.id === task.status ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="task-form__field">
              <label class="task-form__label" for="tf-labels">Labels</label>
              <input class="task-form__input" id="tf-labels" type="text" value="${escapeHtml(task.labels.join(', '))}" placeholder="bug, feature" />
            </div>
            <div class="task-form__field">
              <label class="task-form__label" for="tf-assignee">Assignee</label>
              <input class="task-form__input" id="tf-assignee" type="text" value="${escapeHtml(task.assignee ?? '')}" placeholder="Username" />
            </div>
          </div>

          <div class="task-form__actions">
            <button type="submit" class="task-form__btn task-form__btn--save">Save</button>
            <button type="button" class="task-form__btn task-form__btn--cancel" id="task-form-cancel">Close</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderTaskForm(): string {
  const cols = formColumns.length > 0 ? formColumns : currentColumns;
  return `
    <div class="task-form-overlay" id="task-form-overlay">
      <div class="task-form-panel">
        <button class="task-form-panel__close" id="task-form-close">✕</button>
        <div class="task-form-panel__heading">New Task</div>
        <form id="task-form" class="task-form">
          <label class="task-form__label" for="tf-title">Title *</label>
          <input class="task-form__input" id="tf-title" type="text" placeholder="What needs to be done?" required autofocus />

          <label class="task-form__label" for="tf-body">Description</label>
          <textarea class="task-form__textarea" id="tf-body" rows="8" placeholder="Describe the task in detail — the agent will use this as instructions…"></textarea>

          <div class="task-form__row">
            <div class="task-form__field">
              <label class="task-form__label" for="tf-status">Status</label>
              <select class="task-form__select" id="tf-status">
                ${cols.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="task-form__field">
              <label class="task-form__label" for="tf-labels">Labels</label>
              <input class="task-form__input" id="tf-labels" type="text" placeholder="bug, feature" />
            </div>
            <div class="task-form__field">
              <label class="task-form__label" for="tf-assignee">Assignee</label>
              <input class="task-form__input" id="tf-assignee" type="text" placeholder="Username" />
            </div>
          </div>

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
          <br/><small>Installa: <code>npm install -g @github/copilot</code></small>
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
function renderStreamLine(rawLine: string, role?: 'user' | 'assistant' | 'tool'): string {
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

  const roleClass = role && role !== 'assistant' ? ` stream-output__line--${role}` : '';
  return `<div class="stream-output__line${roleClass}">${tsHtml}${escapeHtml(line)}</div>`;
}

function renderSessionPanel(): string {
  const task = currentTasks.find(t => t.id === sessionPanelTaskId);
  const title = task ? escapeHtml(task.title) : sessionPanelTaskId ?? '';
  const isRunning = task?.copilotSession?.state === 'running' || task?.copilotSession?.state === 'starting';
  const isInterrupted = task?.copilotSession?.state === 'interrupted';
  const statusIcons: Record<string, string> = { added: '＋', modified: '✎', deleted: '✕' };
  // Reset fence parser state on full render
  _fenceMode = 'none';
  const renderedLines = sessionStreamLines.map(l => renderStreamLine(l)).join('');

  // Chat bubbles from accumulated messages
  const chatHtml = sessionChatMessages.map(m => {
    const cls = m.role === 'user'
      ? 'chat-bubble chat-bubble--user'
      : m.role === 'tool'
        ? 'chat-bubble chat-bubble--tool'
        : 'chat-bubble chat-bubble--assistant';
    const icon = m.role === 'user' ? '👤' : m.role === 'tool' ? '🔧' : '🤖';
    return `<div class="${cls}"><span class="chat-bubble__icon">${icon}</span><div class="chat-bubble__body">${escapeHtml(m.text)}</div></div>`;
  }).join('');
  return `
    <div class="session-panel">
      <div class="session-panel__header">
        <span class="session-panel__title">${title}</span>
        <div class="session-panel__action-bar">
          <button class="toolbar__btn toolbar__btn--small" id="session-btn-full-diff" title="Full Diff">Diff</button>
          <button class="toolbar__btn toolbar__btn--small" id="session-btn-export" title="Export Log">Export</button>
          ${isRunning ? `<button class="toolbar__btn toolbar__btn--small toolbar__btn--danger" id="session-btn-stop" title="Stop Agent">■ Stop</button>` : ''}
          <button class="session-panel__close" id="session-panel-close">✕</button>
        </div>
      </div>
      ${isInterrupted ? `<div class="session-interrupted-banner">⚡ Sessione interrotta al riavvio di VS Code. Il log precedente è mostrato sotto (sola lettura).</div>` : ''}
      ${isRunning ? `<div id="tool-status-${sessionPanelTaskId}" class="session-tool-status"></div>` : ''}
      <div class="session-panel__body">
        ${sessionChatMessages.length > 0 ? `<div class="session-chat" id="session-chat">${chatHtml}</div>` : ''}
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
        <input class="task-form__input" id="session-follow-up-input" type="text"
          placeholder="${isInterrupted ? 'Sessione interrotta — riavvia per inviare messaggi' : 'Invia messaggio all\'agente…'}"
          ${isInterrupted ? 'disabled' : ''} />
        <button type="submit" class="toolbar__btn toolbar__btn--primary" ${isInterrupted ? 'disabled' : ''}>Invia</button>
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

function relativeWorktreePath(absPath: string): string {
  if (!workspaceRoot) { return absPath; }
  const root = workspaceRoot.endsWith('/') ? workspaceRoot : workspaceRoot + '/';
  const parent = root.replace(/[^/]+\/$/, '');
  if (absPath.startsWith(parent)) { return absPath.slice(parent.length); }
  return absPath;
}

// ── Full view helpers ──────────────────────────────────────────────────

function openFullView(taskId: string): void {
  fullViewTaskId = taskId;
  selectedTask = null;
  editingTask = null;
  showTaskForm = false;
  sessionPanelTaskId = null;
  fullViewAutoScroll = true;
  render();
  vscode.postMessage({ type: 'requestStreamResume', sessionId: taskId });
}

function addTaskLog(taskId: string, source: TaskLogEntry['source'], text: string): void {
  if (!taskEventLogs.has(taskId)) { taskEventLogs.set(taskId, []); }
  const logs = taskEventLogs.get(taskId)!;
  const ts = new Date().toISOString().slice(11, 19);
  logs.push({ ts, source, text });
  if (logs.length > 2000) { taskEventLogs.set(taskId, logs.slice(-2000)); }
  if (fullViewTaskId === taskId) {
    const logEl = document.getElementById('fv-log-entries');
    const scrollEl = document.getElementById('fv-log-scroll');
    if (logEl) {
      logEl.insertAdjacentHTML('beforeend', renderLogEntry({ ts, source, text }));
      // Remove the empty placeholder if present
      const emptyEl = logEl.querySelector('.fv-log__empty');
      if (emptyEl) { emptyEl.remove(); }
      if (fullViewAutoScroll && scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    }
  }
}

function renderLogEntry(entry: TaskLogEntry): string {
  const sourceIcons: Record<string, string> = {
    board: '📋',
    agent: '🤖',
    tool: '🔧',
    system: 'ℹ️',
  };
  const icon = sourceIcons[entry.source] ?? '●';
  return `<div class="fv-log__entry fv-log__entry--${entry.source}"><span class="fv-log__ts">[${escapeHtml(entry.ts)}]</span> <span class="fv-log__icon">${icon}</span> <span class="fv-log__text">${escapeHtml(entry.text)}</span></div>`;
}

function renderFullView(): string {
  const task = currentTasks.find(t => t.id === fullViewTaskId);
  if (!task) { return ''; }

  const sessionInfo = task.copilotSession;
  const isRunning = sessionInfo?.state === 'running' || sessionInfo?.state === 'starting';
  const isInterrupted = sessionInfo?.state === 'interrupted';
  const logs = taskEventLogs.get(task.id) ?? [];
  const files = fileChangeLists.get(task.id) ?? [];
  const statusIcons: Record<string, string> = { added: '＋', modified: '✎', deleted: '✕' };
  const statusCol = currentColumns.find(c => c.id === task.status);
  const isEditable = editableProviderIds.includes(task.providerId);
  const activeProviderId = isRunning ? sessionInfo?.providerId : undefined;
  const isMerged = mergedSessions.has(task.id);
  const hasWorktree = !!sessionInfo?.worktreePath;

  // ── State badge colour helper ──
  const stateClass = sessionInfo ? `task-card__session task-card__session--${sessionInfo.state}` : '';

  return `
    <div class="full-view">
      <!-- ── Top bar ── -->
      <div class="fv-topbar">
        <div class="fv-topbar__left">
          <button class="fv-topbar__back" id="fv-close" title="Back">←</button>
          <div class="fv-topbar__title-group">
            <span class="fv-topbar__title">${escapeHtml(task.title)}</span>
            <span class="fv-topbar__meta">
              ${sessionInfo ? `<span class="${stateClass}">${escapeHtml(sessionInfo.state)}</span>` : ''}
              <span class="fv-topbar__provider">${escapeHtml(task.providerId)}</span>
              ${task.url ? `<a class="fv-topbar__link" href="${escapeHtml(task.url)}">↗</a>` : ''}
            </span>
          </div>
        </div>
        <div class="fv-topbar__actions">
          ${isRunning ? `<button class="toolbar__btn toolbar__btn--small toolbar__btn--danger" id="fv-btn-stop">■ Stop</button>` : ''}
        </div>
      </div>

      ${isInterrupted ? `<div class="session-interrupted-banner">⚡ Session interrupted. Log is read-only.</div>` : ''}

      <!-- ── ROW 1: four panels side by side (2/3 height) ── -->
      <div class="fv-row fv-row--top${logExpanded ? ' fv-row--hidden' : ''}">

        <!-- Task Details -->
        <div class="fv-col">
          <div class="fv-panel fv-panel--fill">
            <div class="fv-panel__header fv-panel__header--static">
              <span class="fv-panel__header-text">📋 Task Details</span>
              ${isEditable ? `<button class="fv-panel__header-btn" id="fv-edit-btn" title="Edit task">✏ Edit</button>` : ''}
            </div>
            <div class="fv-panel__body fv-panel__body--scroll">
              ${renderFvReadOnlyDetails(task, statusCol)}
            </div>
          </div>
        </div>

        <!-- Session -->
        <div class="fv-col">
          <div class="fv-panel fv-panel--fill">
            <div class="fv-panel__header fv-panel__header--static">
              <span class="fv-panel__header-text">⚙ Session</span>
            </div>
            <div class="fv-panel__body fv-panel__body--scroll">
              ${sessionInfo || hasWorktree
                ? renderFvSessionPanel(sessionInfo, task, isMerged)
                : '<div class="fv-empty-hint">No session started</div>'}
            </div>
          </div>
        </div>

        <!-- Files -->
        <div class="fv-col">
          <div class="fv-panel fv-panel--fill">
            <div class="fv-panel__header fv-panel__header--static">
              <span class="fv-panel__header-text">📂 Files</span>
              ${files.length > 0 ? `<span class="fv-panel__badge">${files.length}</span>` : ''}
            </div>
            <div class="fv-panel__body fv-panel__body--scroll fv-panel__body--flush">
              ${files.length === 0
                ? '<div class="fv-files-empty">No changes detected</div>'
                : `<div class="fv-file-list">
                    ${files.map(f => `
                      <div class="fv-file-item file-list__item file-list__item--${f.status}" data-file-path="${escapeHtml(f.path)}">
                        <span class="file-list__icon">${statusIcons[f.status] || '?'}</span>
                        <span class="file-list__path">${escapeHtml(f.path)}</span>
                      </div>
                    `).join('')}
                  </div>`}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="fv-col">
          <div class="fv-panel fv-panel--fill">
            <div class="fv-panel__header fv-panel__header--static">
              <span class="fv-panel__header-text">⚡ Actions</span>
            </div>
            <div class="fv-panel__body fv-panel__body--scroll">
              <div class="fv-actions">
                <div class="fv-actions__providers">
                  ${genAiProviders.filter(p => !p.disabled).map(p => {
                    const isActive = activeProviderId === p.id;
                    const disabledAttr = isRunning && !isActive ? ' disabled' : '';
                    return `<button class="fv-action-btn fv-launch-provider${isActive ? ' fv-action-btn--active' : ''}${isRunning && !isActive ? ' fv-action-btn--muted' : ''}" data-provider-id="${escapeHtml(p.id)}" title="${escapeHtml(p.displayName)}"${disabledAttr}>🤖 ${escapeHtml(p.displayName)}</button>`;
                  }).join('')}
                </div>
                <hr class="fv-actions__separator" />
                ${hasWorktree ? `
                  <button class="fv-action-btn fv-open-worktree" data-wt-path="${escapeHtml(sessionInfo!.worktreePath!)}" title="Open worktree folder in VS Code">↗ Open in VS Code</button>
                  <button class="fv-action-btn fv-review-wt" data-session-id="${escapeHtml(task.id)}" title="Review changes vs main branch">🔍 Review Diff</button>
                  ${sessionInfo?.state === 'completed' ? `
                    <hr class="fv-actions__separator" />
                    ${isMerged
                      ? `<button class="fv-action-btn fv-action-btn--primary" disabled>⤴ Merge ✓</button>`
                      : `<div class="fv-merge-panel" data-session-id="${escapeHtml(task.id)}">
                          <select class="fv-merge-select" data-session-id="${escapeHtml(task.id)}">
                            <option value="squash" selected>Squash and merge</option>
                            <option value="merge">Create a merge commit</option>
                            <option value="rebase">Rebase and merge</option>
                          </select>
                          <div class="fv-merge-panel__btns">
                            <button class="fv-action-btn fv-action-btn--primary fv-merge-confirm" data-session-id="${escapeHtml(task.id)}">⤴ Merge</button>
                            <button class="fv-action-btn fv-agent-merge" data-session-id="${escapeHtml(task.id)}" title="Launch AI provider to review and merge">🤖 Merge by AI</button>
                          </div>
                        </div>`
                    }
                    <button class="fv-action-btn fv-action-btn--danger fv-delete-wt" data-session-id="${escapeHtml(task.id)}" title="Delete worktree directory and branch" ${!isMerged ? 'disabled' : ''}>🗑 Delete Workspace</button>
                  ` : ''}
                ` : `<div class="fv-actions__empty">No worktree — actions require a worktree session.</div>`}
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ── ROW 2: Activity Log (1/3 height) ── -->
      <div class="fv-row fv-row--bottom${logExpanded ? ' fv-row--expanded' : ''}">
        <div class="fv-panel fv-panel--fill">
          <div class="fv-panel__header fv-panel__header--static fv-log-panel-header">
            <span class="fv-panel__header-text">📜 Activity Log</span>
            <span class="fv-panel__badge">${logs.length}</span>
            <button class="fv-panel__header-btn" id="fv-log-expand" title="${logExpanded ? 'Collapse' : 'Expand'}">${logExpanded ? '⊖' : '⊕'}</button>
          </div>
          <div class="fv-panel__body fv-panel__body--log">
            <div class="fv-log-scroll" id="fv-log-scroll">
              <div class="fv-log-entries" id="fv-log-entries">
                ${logs.map(e => renderLogEntry(e)).join('')}
                ${logs.length === 0 ? '<div class="fv-log__empty">No activity yet. Events will appear here in real time.</div>' : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;
}

// ── Full-view sub-renderers ────────────────────────────────────────────

function renderFvReadOnlyDetails(task: KanbanTask, statusCol: Column | undefined): string {
  return `
    <div class="fv-detail-grid">
      <div class="fv-detail-row">
        <span class="fv-detail-label">Status</span>
        <select class="task-form__select fv-status-select" id="fv-status-select">
          ${currentColumns.map(c => `<option value="${escapeHtml(c.id)}"${c.id === task.status ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
        </select>
      </div>
      ${task.labels.length > 0 ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Labels</span>
          <span class="fv-detail-labels">${task.labels.map(l => `<span class="task-card__label">${escapeHtml(l)}</span>`).join('')}</span>
        </div>
      ` : ''}
      ${task.assignee ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Assignee</span>
          <span>${escapeHtml(task.assignee)}</span>
        </div>
      ` : ''}
      ${task.agent ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Agent</span>
          <span>🤖 ${escapeHtml(task.agent)}</span>
        </div>
      ` : ''}
    </div>
    ${task.body ? `<div class="fv-description">${escapeHtml(task.body)}</div>` : ''}
  `;
}

function renderFvEditableDetails(task: KanbanTask, statusCol: Column | undefined): string {
  return `
    <form id="fv-edit-form" class="fv-edit-form">
      <div class="fv-detail-grid">
        <div class="fv-detail-row">
          <label class="fv-detail-label" for="fv-edit-title">Title</label>
          <input class="task-form__input" id="fv-edit-title" type="text" value="${escapeHtml(task.title)}" required />
        </div>
        <div class="fv-detail-row">
          <label class="fv-detail-label" for="fv-edit-status">Status</label>
          <select class="task-form__select" id="fv-edit-status">
            ${currentColumns.map(c => `<option value="${escapeHtml(c.id)}"${c.id === task.status ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="fv-detail-row">
          <label class="fv-detail-label" for="fv-edit-labels">Labels</label>
          <input class="task-form__input" id="fv-edit-labels" type="text" value="${escapeHtml(task.labels.join(', '))}" placeholder="bug, feature" />
        </div>
        <div class="fv-detail-row">
          <label class="fv-detail-label" for="fv-edit-assignee">Assignee</label>
          <input class="task-form__input" id="fv-edit-assignee" type="text" value="${escapeHtml(task.assignee ?? '')}" placeholder="Username" />
        </div>
        ${task.agent ? `
          <div class="fv-detail-row">
            <span class="fv-detail-label">Agent</span>
            <span>🤖 ${escapeHtml(task.agent)}</span>
          </div>
        ` : ''}
      </div>
      <div class="fv-edit-body-group">
        <label class="fv-detail-label" for="fv-edit-body">Description</label>
        <textarea class="task-form__textarea" id="fv-edit-body" rows="3">${escapeHtml(task.body)}</textarea>
      </div>
      <button type="submit" class="toolbar__btn toolbar__btn--primary fv-save-btn">Save Changes</button>
    </form>
  `;
}

function renderFvSessionPanel(
  sessionInfo: KanbanTask['copilotSession'],
  task: KanbanTask,
  isMerged: boolean,
): string {
  if (!sessionInfo) { return ''; }
  const hasWorktree = !!sessionInfo.worktreePath;
  return `
    <div class="fv-session-grid">
      <div class="fv-detail-row">
        <span class="fv-detail-label">State</span>
        <span class="task-card__session task-card__session--${sessionInfo.state}">${escapeHtml(sessionInfo.state)}</span>
      </div>
      ${sessionInfo.providerId ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Provider</span>
          <span>${escapeHtml(sessionInfo.providerId)}</span>
        </div>
      ` : ''}
      ${sessionInfo.startedAt ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Started</span>
          <span class="fv-detail-meta">${escapeHtml(sessionInfo.startedAt)}</span>
        </div>
      ` : ''}
      ${sessionInfo.finishedAt ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Finished</span>
          <span class="fv-detail-meta">${escapeHtml(sessionInfo.finishedAt)}</span>
        </div>
      ` : ''}
      ${sessionInfo.state === 'error' && sessionInfo.errorMessage ? `
        <div class="fv-session-error">${escapeHtml(sessionInfo.errorMessage)}</div>
      ` : ''}
      ${sessionInfo.prUrl ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Pull Request</span>
          <a class="task-card__pr-badge task-card__pr-badge--${sessionInfo.prState ?? 'open'}" href="${escapeHtml(sessionInfo.prUrl)}">PR #${sessionInfo.prNumber ?? ''}</a>
        </div>
      ` : ''}
      ${hasWorktree ? `
        <div class="fv-detail-row">
          <span class="fv-detail-label">Worktree</span>
          <code class="fv-wt-path">${escapeHtml(relativeWorktreePath(sessionInfo.worktreePath!))}</code>
        </div>
        ${isMerged ? '<div class="fv-merged-badge">✅ Merged into main</div>' : ''}
      ` : ''}
    </div>
  `;
}

// ── Message handling ───────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  switch (msg.type) {
    case 'tasksUpdate': {
      const newTasks = msg.tasks ?? [];
      // Track state transitions for per-task logs
      for (const nt of newTasks) {
        const ot = currentTasks.find(t => t.id === nt.id);
        if (ot) {
          if (ot.status !== nt.status) {
            const colLabel = (msg.columns ?? currentColumns).find((c: Column) => c.id === nt.status)?.label ?? nt.status;
            addTaskLog(nt.id, 'board', `Moved to "${colLabel}"`);
          }
          if (ot.copilotSession?.state !== nt.copilotSession?.state && nt.copilotSession) {
            addTaskLog(nt.id, 'board', `Session → ${nt.copilotSession.state}`);
            if (nt.copilotSession.state === 'error' && nt.copilotSession.errorMessage) {
              addTaskLog(nt.id, 'board', `❌ ${nt.copilotSession.errorMessage}`);
            }
          }
        }
      }
      currentTasks = newTasks;
      currentColumns = msg.columns ?? [];
      editableProviderIds = msg.editableProviderIds ?? [];
      genAiProviders = msg.genAiProviders ?? [];
      // Pre-select first squad-eligible provider if none selected
      if (!selectedSquadProviderId) {
        const first = genAiProviders.find(p => !p.disabled && p.id !== 'chat');
        if (first) { selectedSquadProviderId = first.id; }
      }
      // If the editing task was refreshed, update its data
      if (editingTask) {
        const updated = currentTasks.find(t => t.id === editingTask!.id);
        if (updated) { editingTask = updated; }
        else { editingTask = null; }
      }
      // Clear toolCallStatus for sessions that are no longer active
      for (const [id] of toolCallStatus) {
        const t = currentTasks.find(t2 => t2.id === id);
        if (!t || (t.copilotSession?.state !== 'running' && t.copilotSession?.state !== 'starting')) {
          toolCallStatus.delete(id);
        }
      }
      render();
      break;
    }
    case 'agentsAvailable':
      availableAgents = msg.agents ?? [];
      // Reset selected agent if it was removed or no longer squad-capable
      if (selectedAgentSlug && !availableAgents.some(a => a.slug === selectedAgentSlug && a.canSquad)) {
        selectedAgentSlug = '';
      }
      // Pre-select the first squad-capable agent
      if (!selectedAgentSlug) {
        const first = availableAgents.find(a => a.canSquad);
        if (first) { selectedAgentSlug = first.slug; }
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
      addTaskLog(msg.sessionId, 'agent', msg.text);
      if (sessionPanelTaskId === msg.sessionId) {
        const newLines = msg.text.split('\n');
        sessionStreamLines.push(...newLines);
        // Cap to last 500 lines in the UI for performance
        if (sessionStreamLines.length > 500) {
          sessionStreamLines = sessionStreamLines.slice(-500);
        }

        // Accumulate chat messages for multi-turn view
        const chatRole = msg.role ?? 'assistant';
        if (chatRole === 'user' || chatRole === 'tool') {
          sessionChatMessages.push({ role: chatRole, text: msg.text, ts: msg.ts });
        } else {
          // Merge consecutive assistant chunks into the last assistant message
          const last = sessionChatMessages[sessionChatMessages.length - 1];
          if (last && last.role === 'assistant') {
            last.text += msg.text;
          } else {
            sessionChatMessages.push({ role: 'assistant', text: msg.text, ts: msg.ts });
          }
        }
        if (sessionChatMessages.length > 200) {
          sessionChatMessages = sessionChatMessages.slice(-200);
        }

        const outputEl = document.getElementById('stream-output');
        const scrollEl2 = document.getElementById('session-stream-scroll');
        if (outputEl) {
          for (const l of newLines) {
            // Synthesise the stored form (with timestamp) for rendering
            const stored = `[${msg.ts}] ${l}`;
            outputEl.insertAdjacentHTML('beforeend', renderStreamLine(stored, msg.role));
          }
          if (streamAutoScroll && scrollEl2) {
            scrollEl2.scrollTop = scrollEl2.scrollHeight;
          }
        } else {
          render();
        }
      }
      break;
    case 'toolCall':
      toolCallStatus.set(msg.sessionId, msg.status);
      addTaskLog(msg.sessionId, 'tool', msg.status);
      if (sessionPanelTaskId === msg.sessionId) {
        // Append tool-call line to stream output
        const outputEl3 = document.getElementById('stream-output');
        if (outputEl3) {
          const ts = new Date().toISOString().slice(11, 19);
          outputEl3.insertAdjacentHTML('beforeend',
            `<div class="stream-output__line stream-output__line--tool">🔧 ${escapeHtml(msg.status)}</div>`);
          const scrollEl3 = document.getElementById('session-stream-scroll');
          if (streamAutoScroll && scrollEl3) { scrollEl3.scrollTop = scrollEl3.scrollHeight; }
        }
      }
      // Trigger card re-render to show/update the tool-call badge
      render();
      break;
    case 'fileChanges': {
      const prevCount = fileChangeLists.get(msg.sessionId)?.length ?? 0;
      const newFiles = msg.files ?? [];
      fileChangeLists.set(msg.sessionId, newFiles);
      if (newFiles.length !== prevCount) {
        addTaskLog(msg.sessionId, 'system', `${newFiles.length} file(s) changed`);
      }
      if (sessionPanelTaskId === msg.sessionId) {
        sessionFileChanges = msg.files ?? [];
      }
      render();
      break;
    }
    case 'streamResume':
      // Populate full-view log from historic data
      if (msg.log && fullViewTaskId === msg.sessionId) {
        const histLines = msg.log.split('\n').filter((l: string) => l.trim());
        const existing = taskEventLogs.get(msg.sessionId) ?? [];
        const nonAgent = existing.filter(e => e.source !== 'agent');
        const histEntries: TaskLogEntry[] = histLines.map((line: string) => {
          const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\] (.*)/s);
          return {
            ts: tsMatch ? tsMatch[1] : '',
            source: 'agent' as const,
            text: tsMatch ? tsMatch[2] : line,
          };
        });
        taskEventLogs.set(msg.sessionId, [...histEntries, ...nonAgent]);
        render();
      }
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
      workspaceRoot = msg.workspaceRoot ?? '';
      render();
      break;
    case 'mergeResult':
      if (msg.success) { mergedSessions.add(msg.sessionId); }
      addTaskLog(msg.sessionId, msg.success ? 'system' : 'board',
        msg.success ? `✅ ${msg.message}` : `❌ Merge fallito: ${msg.message}`);
      render();
      break;
    case 'deleteWorktreeResult':
      addTaskLog(msg.sessionId, msg.success ? 'system' : 'board',
        msg.success ? '🗑 Worktree eliminato.' : `❌ Eliminazione fallita: ${msg.message ?? ''}`);
      if (msg.success) { mergedSessions.delete(msg.sessionId); }
      render();
      break;
  }
});

// Signal the host that the WebView is ready
vscode.postMessage({ type: 'ready' });
