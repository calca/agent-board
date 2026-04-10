/**
 * Minimal WebView entry point.
 *
 * In Phase 03 this would be built with Vite / React.
 * For now it provides a lightweight vanilla-JS Kanban board
 * that communicates with the host via the typed message protocol.
 */

import {
  mountMarkdownEditor,
  getMarkdownEditorValue,
  unmountAllMarkdownEditors,
} from './markdownEditor';

// @ts-ignore — vscode webview API is injected at runtime
const vscode = acquireVsCodeApi();

interface Column { id: string; label: string; color?: string }
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
    /** Whether the worktree branch has been merged locally. */
    merged?: boolean;
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
let showSearchInput = false;
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
let repoIsAzureDevOps = false;
let workspaceRoot = '';
let workspaceName = '';
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
let showNotificationCenter = false;
let loaded = false;

// ── Render ─────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById('root');
  if (!root) { return; }

  // Show loader until first data arrives from the host
  if (!loaded) {
    root.innerHTML = `
      <div class="loader">
        <div class="loader__spinner"></div>
        <div class="loader__text">Loading board…</div>
      </div>
    `;
    return;
  }

  // Skip full re-render when a form overlay is open to avoid losing user input
  if ((showTaskForm || editingTask) && document.getElementById('task-form-overlay')) {
    return;
  }

  // Unmount any active markdown editors before replacing the DOM
  unmountAllMarkdownEditors();

  const filtered = currentTasks.filter(t => {
    if (!searchText) { return true; }
    const q = searchText.toLowerCase();
    return t.title.toLowerCase().includes(q)
      || t.labels.some(l => l.toLowerCase().includes(q))
      || (t.assignee?.toLowerCase().includes(q) ?? false);
  });

  root.innerHTML = `
    <header class="toolbar">
      <div class="project-bar">
        <span class="project-bar__name" title="${escapeHtml(workspaceName)}">
          <svg class="project-bar__icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 2H14.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/></svg>
          ${escapeHtml(workspaceName || 'Workspace')}
        </span>
        <div class="project-bar__actions">
          <button class="mcp-toggle${mcpEnabled ? ' mcp-toggle--on' : ''}" id="btn-mcp-toggle" title="MCP Server ${mcpEnabled ? 'On' : 'Off'}">
            <span class="mcp-toggle__dot"></span>
            <span class="mcp-toggle__label">MCP</span>
          </button>
          ${renderNotificationBell()}
        </div>
      </div>

      <div class="toolbar__row toolbar__row--main">
        <div class="toolbar__group" data-label="Squad">
          <button class="mcp-toggle mcp-toggle--toolbar${squadStatus.autoSquadEnabled ? ' mcp-toggle--on' : ''}" id="btn-toggle-auto" ${!repoIsGit ? 'disabled' : ''} title="Toggle Auto‑Squad">
            <span class="mcp-toggle__dot"></span>
            <span class="mcp-toggle__label">Auto</span>
          </button>
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
          ${squadStatus.activeCount > 0 ? `<span class="toolbar__badge toolbar__badge--live">${squadStatus.activeCount}/${squadStatus.maxSessions}</span>` : ''}
        </div>

        <div class="toolbar__spacer"></div>

        <div class="toolbar__group" data-label="Issues">
          <button class="toolbar__btn toolbar__btn--icon" id="btn-filter" title="Filter">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 12h4v-1H6v1zm-3-4h10V7H3v1zm-2-5v1h14V3H1z"/></svg>
            ${searchText ? `<span class="toolbar__badge toolbar__badge--inline">${filtered.length}</span>` : ''}
          </button>
          ${showSearchInput ? `<input class="toolbar__search-input toolbar__search-input--open" id="search-input" placeholder="Filter issues…" value="${escapeHtml(searchText)}" autofocus />` : ''}
          <button class="toolbar__btn toolbar__btn--secondary" id="btn-refresh">Sync</button>
          <button class="toolbar__btn toolbar__btn--secondary" id="btn-add-task">+ New Issue</button>
        </div>
      </div>
    </header>
    ${renderNotificationCenter()}
    <div class="kanban">
      ${currentColumns.map(col => renderColumn(col, filtered.filter(t => t.status === col.id))).join('')}
    </div>
    ${editingTask ? renderEditForm(editingTask) : ''}
    ${showTaskForm && !editingTask ? renderTaskForm() : ''}
    ${sessionPanelTaskId ? renderSessionPanel() : ''}
    ${fullViewTaskId ? renderFullView() : ''}
  `;

  // Mount markdown editors in any visible form containers
  if (document.getElementById('tf-body-editor')) {
    const initialBody = editingTask?.body ?? '';
    mountMarkdownEditor(
      'tf-body-editor',
      initialBody,
      'Describe the task in detail — the agent will use this as instructions…',
    );
  }
  if (document.getElementById('fv-edit-body-editor')) {
    const task = currentTasks.find(t => t.id === fullViewTaskId);
    mountMarkdownEditor('fv-edit-body-editor', task?.body ?? '');
  }

  // Event listeners
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshRequest' });
  });

  document.getElementById('btn-mcp-toggle')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleMcp' });
  });
  document.getElementById('btn-notifications')?.addEventListener('click', () => {
    showNotificationCenter = !showNotificationCenter;
    render();
  });
  document.getElementById('notification-center-close')?.addEventListener('click', () => {
    showNotificationCenter = false;
    render();
  });
  document.getElementById('btn-add-task')?.addEventListener('click', () => {
    showTaskForm = true;
    formColumns = currentColumns;
    selectedTask = null;
    render();
  });

  document.getElementById('btn-filter')?.addEventListener('click', () => {
    showSearchInput = !showSearchInput;
    if (!showSearchInput) { searchText = ''; }
    render();
    if (showSearchInput) { document.getElementById('search-input')?.focus(); }
  });
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  searchInput?.addEventListener('input', (e: Event) => {
    searchText = (e.target as HTMLInputElement).value;
    const pos = searchInput!.selectionStart;
    render();
    const restored = document.getElementById('search-input') as HTMLInputElement | null;
    if (restored) { restored.focus(); restored.selectionStart = restored.selectionEnd = pos; }
  });
  searchInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { showSearchInput = false; searchText = ''; render(); }
  });

  // Done column actions
  document.getElementById('btn-export-done')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportDoneMd' });
  });
  document.getElementById('btn-clean-done')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'cleanDone' });
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
  document.querySelectorAll('.fv-reset-session').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (sessionId) {
        vscode.postMessage({ type: 'resetSession', sessionId });
        editingTask = null;
        fullViewTaskId = null;
        render();
      }
    });
  });
  // ── Full view edit button → open inline form ────────────────────────
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
  document.getElementById('fv-edit-cancel')?.addEventListener('click', () => {
    editingTask = null;
    render();
  });
  // ── Full view inline edit form ──────────────────────────────────────
  document.getElementById('fv-edit-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    if (!fullViewTaskId) { return; }
    const title = (document.getElementById('fv-edit-title') as HTMLInputElement)?.value.trim();
    if (!title) { return; }
    const body = getMarkdownEditorValue('fv-edit-body-editor') || currentTasks.find(t => t.id === fullViewTaskId)?.body || '';
    const status = (document.getElementById('fv-edit-status') as HTMLSelectElement)?.value ?? '';
    const labels = (document.getElementById('fv-edit-labels') as HTMLInputElement)?.value.trim() ?? '';
    const assignee = (document.getElementById('fv-edit-assignee') as HTMLInputElement)?.value.trim() ?? '';
    vscode.postMessage({ type: 'editTask', taskId: fullViewTaskId, data: { title, body, status, labels, assignee } });
    editingTask = null;
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
  document.querySelectorAll('.fv-align-wt').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (sessionId) { vscode.postMessage({ type: 'alignWorktree', sessionId }); }
    });
  });
  document.querySelectorAll('.fv-delete-wt').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (sessionId) { vscode.postMessage({ type: 'deleteWorktree', sessionId }); }
    });
  });
  document.querySelectorAll('.fv-create-pr').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.sessionId;
      if (sessionId) { vscode.postMessage({ type: 'createPullRequest', sessionId }); }
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

  document.getElementById('task-form-delete')?.addEventListener('click', () => {
    const taskId = (document.getElementById('task-form-delete') as HTMLElement)?.dataset.taskId;
    if (taskId) {
      vscode.postMessage({ type: 'deleteTask', taskId });
      editingTask = null;
      fullViewTaskId = null;
      render();
    }
  });

  document.getElementById('task-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const remoteProviders = ['github', 'azure-devops', 'beads'];
    const isRemoteEdit = editingTask && remoteProviders.includes(editingTask.providerId);

    const titleEl = form.querySelector('#tf-title') as HTMLInputElement | null;
    const labelsEl = form.querySelector('#tf-labels') as HTMLInputElement | null;
    const assigneeEl = form.querySelector('#tf-assignee') as HTMLInputElement | null;

    const title = titleEl?.value.trim() ?? editingTask?.title ?? '';
    if (!title) { return; }
    const body = getMarkdownEditorValue('tf-body-editor') || editingTask?.body || '';
    const status = editingTask
      ? (form.querySelector('#tf-status') as HTMLSelectElement)?.value ?? currentColumns[0]?.id ?? 'todo'
      : currentColumns[0]?.id ?? 'todo';
    const labels = labelsEl?.value.trim() ?? editingTask?.labels.join(', ') ?? '';
    const assignee = assigneeEl?.value.trim() ?? editingTask?.assignee ?? '';

    if (editingTask) {
      if (isRemoteEdit) {
        // Remote task: only send status change, keep original values
        vscode.postMessage({ type: 'editTask', taskId: editingTask.id, data: { title: editingTask.title, body: editingTask.body, status, labels: editingTask.labels.join(', '), assignee: editingTask.assignee ?? '' } });
      } else {
        vscode.postMessage({ type: 'editTask', taskId: editingTask.id, data: { title, body, status, labels, assignee } });
      }
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
  const bgStyle = col.color ? ` style="background: ${col.color}0D"` : '';
  const headerStyle = col.color ? ` style="background: ${col.color}1A"` : '';
  const countStyle = col.color ? ` style="background: ${col.color}33; color: ${col.color}"` : '';
  const isDone = col.id === 'done';
  const doneActions = isDone && tasks.length > 0
    ? `<span class="kanban__column-actions">
        <button class="kanban__col-btn" id="btn-export-done" title="Export to Markdown">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.586a1.5 1.5 0 0 1 1.06.44l3.415 3.414A1.5 1.5 0 0 1 14 6.914V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7H9.5A1.5 1.5 0 0 1 8 5.5V3H3.5ZM9 3.207V5.5a.5.5 0 0 0 .5.5h2.293L9 3.207ZM6 8.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2Z"/></svg>
        </button>
        <button class="kanban__col-btn kanban__col-btn--danger" id="btn-clean-done" title="Clean done tasks">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1.5A.5.5 0 0 1 6 1h4a.5.5 0 0 1 .5.5V3h3a.5.5 0 0 1 0 1h-.538l-.853 10.66A1 1 0 0 1 11.114 15H4.886a1 1 0 0 1-.995-.94L3.038 4H2.5a.5.5 0 0 1 0-1h3V1.5ZM6.5 2v1h3V2h-3Zm-2.457 2 .826 10h6.262l.826-10H4.043Z"/></svg>
        </button>
      </span>`
    : '';
  return `
    <div class="kanban__column"${bgStyle}>
      <div class="kanban__column-header"${headerStyle}>
        <span>${escapeHtml(col.label)}</span>
        <span class="kanban__column-header-right">
          ${doneActions}
          <span class="kanban__column-count"${countStyle}>${tasks.length}</span>
        </span>
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
  const cardMerged = mergedSessions.has(task.id);
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
        // When merged, show a single compact badge instead of two
        if (cardMerged) { return ''; }
        const label = SESSION_LABELS[session.state] ?? session.state;
        return `<span class="task-card__session task-card__session--${session.state}">${escapeHtml(label)}</span>`;
      })()
    : '';
  const isActive = session?.state === 'running' || session?.state === 'starting';
  // PR badge from copilot session
  const pr = session?.prUrl
    ? `<a class="task-card__pr-badge task-card__pr-badge--${session.prState ?? 'open'}" href="${escapeHtml(session.prUrl)}" title="PR #${session.prNumber ?? ''}: ${session.prState ?? 'open'}">⤴ PR${session.prNumber ? ` #${session.prNumber}` : ''}</a>`
    : '';
  // Tool-call status badge (shown while session is running)
  const tcs = toolCallStatus.get(task.id);
  const toolCallBadge = tcs && isActive
    ? `<div class="task-card__tool-status" title="${escapeHtml(tcs)}">⚙ ${escapeHtml(tcs)}</div>`
    : '';
  // Avatar: prefer meta.avatarUrl populated by GitHubProvider, fallback to initials
  const avatarUrl = (task.meta as Record<string, unknown>)?.avatarUrl as string | undefined;
  const assigneeHtml = avatarUrl
    ? `<img class="task-card__avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(task.assignee ?? '')}" title="${escapeHtml(task.assignee ?? '')}" />`
    : (initials ? `<span class="task-card__assignee" title="${escapeHtml(task.assignee ?? '')}">${initials}</span>` : '');
  const stateModifier = session ? ` task-card--state-${session.state}` : '';
  // Short ID display (e.g. "GH-12" or provider prefix)
  const shortId = task.id.includes(':') ? task.id.replace(':', '-').toUpperCase() : task.id;
  // Body snippet — first ~80 chars; strip HTML tags for card preview
  const isBodyHtml = task.body ? /<[a-z][\s\S]*>/i.test(task.body) : false;
  const plainBody = isBodyHtml ? task.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : task.body;
  const bodySnippet = plainBody ? plainBody.slice(0, 80).replace(/\n/g, ' ') + (plainBody.length > 80 ? '…' : '') : '';
  // Priority label (look for priority/high/medium/low in labels)
  const priorityMap: Record<string, { icon: string; cls: string }> = {
    critical: { icon: '⬆⬆', cls: 'critical' },
    high:     { icon: '⬆', cls: 'high' },
    medium:   { icon: '⬍', cls: 'medium' },
    low:      { icon: '⬇', cls: 'low' },
  };
  let priorityHtml = '';
  const visibleLabels: string[] = [];
  for (const l of task.labels) {
    if (l.startsWith('kanban:')) { continue; }
    const key = l.toLowerCase().replace(/^priority[:/]/, '');
    if (priorityMap[key]) {
      priorityHtml = `<span class="task-card__priority task-card__priority--${priorityMap[key].cls}">${priorityMap[key].icon} ${escapeHtml(l.replace(/^priority[:/]/i, ''))}</span>`;
    } else {
      visibleLabels.push(l);
    }
  }
  return `
    <div class="task-card${stateModifier}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-card__header">
        <span class="task-card__id">${escapeHtml(shortId)}</span>
        ${sessionBadge}${cardMerged ? '<span class="task-card__session task-card__session--merged">Merged</span>' : ''}${pr}
      </div>
      <div class="task-card__title">${escapeHtml(task.title)}</div>
      ${bodySnippet ? `<div class="task-card__body">${escapeHtml(bodySnippet)}</div>` : ''}
      ${toolCallBadge}
      <div class="task-card__footer">
        <div class="task-card__footer-left">
          ${assigneeHtml}
          ${priorityHtml}
        </div>
        <div class="task-card__footer-right">
          ${visibleLabels.slice(0, 2).map(l => `<span class="task-card__label">${escapeHtml(l)}</span>`).join('')}
          ${task.status !== currentColumns[currentColumns.length - 1]?.id ? `<button class="task-card__edit-btn card-btn-edit" data-task-id="${escapeHtml(task.id)}" title="Edit">✎</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderEditForm(task: KanbanTask): string {
  const cols = currentColumns;
  const remoteProviders = ['github', 'azure-devops', 'beads'];
  const isRemote = remoteProviders.includes(task.providerId);
  const ro = isRemote ? ' readonly' : '';
  const roClass = isRemote ? ' task-form__input--readonly' : '';

  const isHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);

  // Title: readonly → plain text span, editable → input
  const titleField = isRemote
    ? `<span class="task-form__readonly-value">${escapeHtml(task.title)}</span>`
    : `<input class="task-form__input" id="tf-title" type="text" value="${escapeHtml(task.title)}" required />`;

  // Description: readonly → rendered HTML (if body is HTML) or escaped text, editable → MDXEditor
  const bodyField = isRemote
    ? `<div class="task-form__readonly-body">${isHtml(task.body) ? sanitizeHtml(task.body) : escapeHtml(task.body)}</div>`
    : `<div id="tf-body-editor" class="md-editor-container"></div>`;

  // Labels
  const labelsField = isRemote
    ? `<span class="task-form__readonly-value">${escapeHtml(task.labels.join(', ')) || '—'}</span>`
    : `<input class="task-form__input" id="tf-labels" type="text" value="${escapeHtml(task.labels.join(', '))}" placeholder="bug, feature" />`;

  // Assignee
  const assigneeField = isRemote
    ? `<span class="task-form__readonly-value">${escapeHtml(task.assignee ?? '') || '—'}</span>`
    : `<input class="task-form__input" id="tf-assignee" type="text" value="${escapeHtml(task.assignee ?? '')}" placeholder="Username" />`;

  // Remote status (only for remote providers)
  const remoteStatusField = isRemote
    ? `<div class="task-form__field">
              <label class="task-form__label">Remote Status</label>
              <span class="task-form__readonly-value task-form__readonly-value--badge">${escapeHtml(String(task.meta?.remoteStatus ?? ''))}</span>
            </div>`
    : '';

  return `
    <div class="task-form-overlay" id="task-form-overlay">
      <div class="task-form-panel">
        <button class="task-form-panel__close" id="task-form-close">✕</button>
        <div class="task-form-panel__heading">Edit Issue${isRemote ? ' <span style="opacity:0.5;font-size:0.8em">(remote — read-only fields)</span>' : ''}</div>
        <form id="task-form" class="task-form">
          <label class="task-form__label">Title${isRemote ? '' : ' *'}</label>
          ${titleField}

          <label class="task-form__label">Description</label>
          ${bodyField}

          <div class="task-form__row">
            <div class="task-form__field">
              <label class="task-form__label" for="tf-status">Status</label>
              <select class="task-form__select" id="tf-status">
                ${cols.map(c => `<option value="${escapeHtml(c.id)}"${c.id === task.status ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
              </select>
            </div>
${remoteStatusField}
            <div class="task-form__field">
              <label class="task-form__label"${!isRemote ? ' for="tf-labels"' : ''}>Labels</label>
              ${labelsField}
            </div>
            <div class="task-form__field">
              <label class="task-form__label"${!isRemote ? ' for="tf-assignee"' : ''}>Assignee</label>
              ${assigneeField}
            </div>
          </div>

          <div class="task-form__actions">
            <button type="submit" class="task-form__btn task-form__btn--save">${isRemote ? 'Update Status' : 'Save'}</button>
            <button type="button" class="task-form__btn task-form__btn--cancel" id="task-form-cancel">Close</button>
            ${!isRemote && editableProviderIds.includes(task.providerId) ? `<button type="button" class="task-form__btn task-form__btn--delete" id="task-form-delete" data-task-id="${escapeHtml(task.id)}">⊘ Delete</button>` : ''}
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
        <div class="task-form-panel__heading">New Issue</div>
        <form id="task-form" class="task-form">
          <label class="task-form__label" for="tf-title">Title *</label>
          <input class="task-form__input" id="tf-title" type="text" placeholder="What needs to be done?" required autofocus />

          <label class="task-form__label">Description</label>
          <div id="tf-body-editor" class="md-editor-container"></div>

          <div class="task-form__row">
            <div class="task-form__field">
              <label class="task-form__label" for="tf-status">Status</label>
              <input class="task-form__input" id="tf-status" type="text" value="${escapeHtml(cols[0]?.label ?? '')}" disabled />
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
    banners.push('Questo progetto non è un repository Git. Squad, Copilot LM API, Copilot CLI e Cloud sono disabilitati.');
  } else if (!repoIsGitHub) {
    banners.push('Nessun remote GitHub collegato. Cloud è disabilitato.');
  }
  return banners.join('');
}

function getNotifications(): string[] {
  const notifications: string[] = [];
  if (!repoIsGit) {
    notifications.push('⚠︎ Questo progetto non è un repository Git. Squad, Copilot LM API, Copilot CLI e Cloud sono disabilitati.');
  } else if (!repoIsGitHub) {
    notifications.push('⚠︎ Nessun remote GitHub collegato. Cloud è disabilitato.');
  }
  return notifications;
}

function renderNotificationBell(): string {
  const count = getNotifications().length;
  return `
    <button class="toolbar__btn toolbar__btn--icon notification-bell" id="btn-notifications" title="Notifications">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5A3.5 3.5 0 0 0 4.5 5v2.5c0 .5-.2 1.1-.6 1.6L3 10.2V11h10v-.8l-.9-1.1c-.4-.5-.6-1.1-.6-1.6V5A3.5 3.5 0 0 0 8 1.5ZM6.5 12a1.5 1.5 0 0 0 3 0h-3Z"/></svg>${count > 0 ? `<span class="notification-bell__badge">${count}</span>` : ''}
    </button>
  `;
}

function renderNotificationCenter(): string {
  if (!showNotificationCenter) { return ''; }
  const items = getNotifications();
  return `
    <div class="notification-center" id="notification-center">
      <div class="notification-center__header">
        <span class="notification-center__title">Notifications</span>
        <button class="notification-center__close" id="notification-center-close">✕</button>
      </div>
      <div class="notification-center__body">
        ${items.length === 0
          ? '<div class="notification-center__empty">No notifications</div>'
          : items.map(n => `<div class="notification-center__item">${escapeHtml(n)}</div>`).join('')}
      </div>
    </div>
  `;
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
      `<span class="stream-file-link" data-file-path="${escapeHtml(filePath)}" title="Open diff">◇ ${escapeHtml(filePath)}</span></div>`;
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
    const icon = m.role === 'user' ? '●' : m.role === 'tool' ? '⚙' : '◆';
    return `<div class="${cls}"><span class="chat-bubble__icon">${icon}</span><div class="chat-bubble__body">${escapeHtml(m.text)}</div></div>`;
  }).join('');
  return `
    <div class="session-panel">
      <div class="session-panel__header">
        <span class="session-panel__title">${title}</span>
        <div class="session-panel__action-bar">
          <button class="toolbar__btn toolbar__btn--small" id="session-btn-full-diff" title="Full Diff">Diff</button>
          <button class="toolbar__btn toolbar__btn--small" id="session-btn-export" title="Export Log">Export</button>
          <button class="session-panel__close" id="session-panel-close">✕</button>
        </div>
      </div>
      ${isInterrupted ? `<div class="session-interrupted-banner">↯ Sessione interrotta al riavvio di VS Code. Il log precedente è mostrato sotto (sola lettura).</div>` : ''}
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

/** Strip dangerous tags/attributes but allow safe formatting HTML. */
function sanitizeHtml(html: string): string {
  const allowedTags = new Set([
    'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'code', 'pre', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'hr', 'img',
  ]);
  const allowedAttrs = new Set(['href', 'src', 'alt', 'title', 'class', 'id']);

  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  function walk(node: Element): void {
    // Remove disallowed elements entirely
    const children = Array.from(node.children);
    for (const child of children) {
      if (!allowedTags.has(child.tagName.toLowerCase())) {
        // Replace disallowed element with its text content
        const text = document.createTextNode(child.textContent ?? '');
        node.replaceChild(text, child);
        continue;
      }
      // Strip disallowed attributes
      for (const attr of Array.from(child.attributes)) {
        if (!allowedAttrs.has(attr.name.toLowerCase())) {
          child.removeAttribute(attr.name);
        }
      }
      // Sanitise href/src to prevent javascript: URLs
      for (const urlAttr of ['href', 'src']) {
        const val = child.getAttribute(urlAttr);
        if (val && !/^https?:\/\//i.test(val.trim()) && !val.trim().startsWith('#')) {
          child.removeAttribute(urlAttr);
        }
      }
      walk(child);
    }
  }
  walk(tmp);
  return tmp.innerHTML;
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
    board: '☰',
    agent: '◆',
    tool: '⚙',
    system: 'ⓘ',
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
  const isLastCol = task.status === currentColumns[currentColumns.length - 1]?.id;

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
          ${isMerged ? '<span class="fv-merged-badge fv-merged-badge--inline">✓ Merged</span>' : ''}
        </div>
      </div>

      ${isInterrupted ? `<div class="session-interrupted-banner">↯ Session interrupted. Log is read-only.</div>` : ''}

      <!-- ── ROW 1: four panels side by side (2/3 height) ── -->
      <div class="fv-row fv-row--top${logExpanded ? ' fv-row--hidden' : ''}">

        <!-- Task Details -->
        <div class="fv-col">
          <div class="fv-panel fv-panel--fill"${statusCol?.color ? ` style="background:${statusCol.color}0D;"` : ''}>
            <div class="fv-panel__header fv-panel__header--static"${statusCol?.color ? ` style="background:${statusCol.color}1A;"` : ''}>
              <span class="fv-panel__header-text">☰ Issue Details</span>
              ${isEditable && !isRunning && !isLastCol ? (editingTask?.id === task.id
                ? `<button class="fv-panel__header-btn" id="fv-edit-cancel" title="Cancel edit">✕ Cancel</button>`
                : `<button class="fv-panel__header-btn" id="fv-edit-btn" title="Edit task">✎ Edit</button>`) : ''}
            </div>
            <div class="fv-panel__body fv-panel__body--scroll">
              ${editingTask?.id === task.id ? renderFvEditableDetails(task, statusCol) : renderFvReadOnlyDetails(task, statusCol)}
            </div>
          </div>
        </div>

        <!-- Session -->
        <div class="fv-col">
          <div class="fv-panel fv-panel--fill" style="background:#9b59b60D;">
            <div class="fv-panel__header fv-panel__header--static" style="background:#9b59b61A;">
              <span class="fv-panel__header-text">⊙ Session</span>
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
          <div class="fv-panel fv-panel--fill" style="background:#3498db0D;">
            <div class="fv-panel__header fv-panel__header--static" style="background:#3498db1A;">
              <span class="fv-panel__header-text">⊞ Files</span>
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
          <div class="fv-panel fv-panel--fill" style="background:#e67e220D;">
            <div class="fv-panel__header fv-panel__header--static" style="background:#e67e221A;">
              <span class="fv-panel__header-text"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7ZM4 6.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5Zm.5 2.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4Zm-1 3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5Z"/></svg> Actions</span>
            </div>
            <div class="fv-panel__body fv-panel__body--scroll">
              <div class="fv-actions">
                ${sessionInfo && !isRunning ? `
                  <button class="fv-action-btn fv-reset-session" data-session-id="${escapeHtml(task.id)}" title="Reset session and move task back to first column"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.563 2.063A6 6 0 0 1 14 8h-1.5A4.5 4.5 0 1 0 8 12.5v1.5A6 6 0 0 1 5.563 2.063Z"/><path d="M14 4v4h-4l1.5-1.5L10 5l2.5-1L14 4Z"/></svg> Reset</button>
                  <hr class="fv-actions__separator" />
                ` : ''}
                ${isRunning ? `
                  <div class="fv-actions__running-provider"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11ZM7 5v4.5l3.5 2 .75-1.25L8.5 8.5V5H7Z"/></svg> ${escapeHtml(genAiProviders.find(p => p.id === activeProviderId)?.displayName ?? activeProviderId ?? 'Agent')}</div>
                  <button class="fv-action-btn fv-action-btn--danger" id="fv-btn-stop"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg> Stop</button>
                  <hr class="fv-actions__separator" />
                ` : sessionInfo?.state !== 'completed' && !isMerged ? `
                <div class="fv-actions__providers">
                  ${genAiProviders.filter(p => !p.disabled).map(p => {
                    return `<button class="fv-action-btn fv-launch-provider" data-provider-id="${escapeHtml(p.id)}" title="${escapeHtml(p.displayName)}"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5L12 8l-6 4.5v-9Z"/></svg> ${escapeHtml(p.displayName)}</button>`;
                  }).join('')}
                </div>
                <hr class="fv-actions__separator" />
                ` : ''}
                ${hasWorktree ? `
                  ${isMerged ? `
                    <button class="fv-action-btn fv-action-btn--danger fv-delete-wt" data-session-id="${escapeHtml(task.id)}" title="Delete worktree directory and branch"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1.5A.5.5 0 0 1 6 1h4a.5.5 0 0 1 .5.5V3h3a.5.5 0 0 1 0 1h-.538l-.853 10.66A1 1 0 0 1 11.114 15H4.886a1 1 0 0 1-.995-.94L3.038 4H2.5a.5.5 0 0 1 0-1h3V1.5ZM6.5 2v1h3V2h-3Zm-2.457 2 .826 10h6.262l.826-10H4.043Z"/></svg> Delete Workspace</button>
                  ` : `
                    <button class="fv-action-btn fv-open-worktree" data-wt-path="${escapeHtml(sessionInfo!.worktreePath!)}" title="Open worktree folder in VS Code"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 2H14.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/></svg> Open in VS Code</button>
                    <button class="fv-action-btn fv-review-wt" data-session-id="${escapeHtml(task.id)}" title="Review changes vs main branch"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.586a1.5 1.5 0 0 1 1.06.44l3.415 3.414A1.5 1.5 0 0 1 14 6.914V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7H9.5A1.5 1.5 0 0 1 8 5.5V3H3.5ZM9 3.207V5.5a.5.5 0 0 0 .5.5h2.293L9 3.207ZM6 8.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2Z"/></svg> Review Diff</button>
                    ${!isRunning ? `
                    <hr class="fv-actions__separator" />
                    <button class="fv-action-btn fv-align-wt" data-session-id="${escapeHtml(task.id)}" title="Align worktree from main with AI"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 1ZM3.1 3.1a.75.75 0 0 1 1.06 0l1.77 1.77a.75.75 0 0 1-1.06 1.06L3.1 4.16a.75.75 0 0 1 0-1.06Zm9.8 0a.75.75 0 0 1 0 1.06l-1.77 1.77a.75.75 0 1 1-1.06-1.06l1.77-1.77a.75.75 0 0 1 1.06 0ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1 8a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 1 8Zm10 0a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 11 8Zm-7.9 4.9a.75.75 0 0 1 1.06 0l1.77-1.77a.75.75 0 0 1 1.06 1.06l-1.77 1.77a.75.75 0 0 1-1.06 0l-1.06-1.06Zm7.03-1.77a.75.75 0 0 1 1.06-1.06l1.77 1.77a.75.75 0 0 1-1.06 1.06l-1.77-1.77ZM8 11a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 11Z"/></svg> Align from main with AI</button>
                    ` : ''}
                    ${sessionInfo?.state === 'completed' || task.status === 'done' ? `
                      ${(repoIsGitHub || repoIsAzureDevOps) && !sessionInfo?.prUrl ? `
                        <button class="fv-action-btn fv-action-btn--primary fv-create-pr" data-session-id="${escapeHtml(task.id)}" title="Create a Pull Request on ${repoIsGitHub ? 'GitHub' : 'Azure DevOps'}"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073 9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25ZM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5Zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg> Create Pull Request</button>
                        <hr class="fv-actions__separator" />
                      ` : ''}
                      ${sessionInfo?.prUrl ? `
                        <a class="fv-action-btn fv-action-btn--primary" href="${escapeHtml(sessionInfo.prUrl)}" title="Open Pull Request${sessionInfo.prNumber ? ` #${sessionInfo.prNumber}` : ''}"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073 9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25ZM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5Zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg> ${sessionInfo.prNumber ? `Open PR #${sessionInfo.prNumber}` : 'Open PR'}</a>
                        <hr class="fv-actions__separator" />
                      ` : ''}
                      <button class="fv-action-btn fv-agent-merge" data-session-id="${escapeHtml(task.id)}" title="Launch AI to review and merge"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a2.25 2.25 0 1 1 4.5 0A2.25 2.25 0 0 1 8 5.37V7h2.75A2.25 2.25 0 0 1 13 9.25v.38a2.25 2.25 0 1 1-1.5 0v-.38a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v.38a2.25 2.25 0 1 1-1.5 0v-.38A2.25 2.25 0 0 1 5.25 7H8V5.37A2.25 2.25 0 0 1 5 3.25Z"/></svg> Merge to main with AI</button>
                      <hr class="fv-actions__separator" />
                      <div class="fv-merge-panel" data-session-id="${escapeHtml(task.id)}">
                        <label class="fv-merge-panel__label">Manual merge</label>
                        <select class="fv-merge-select" data-session-id="${escapeHtml(task.id)}">
                          <option value="squash" selected>Squash and merge</option>
                          <option value="merge">Create a merge commit</option>
                          <option value="rebase">Rebase and merge</option>
                        </select>
                        <button class="fv-action-btn fv-action-btn--primary fv-merge-confirm" data-session-id="${escapeHtml(task.id)}"><svg class="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a2.25 2.25 0 1 1 4.5 0A2.25 2.25 0 0 1 8 5.37V7h2.75A2.25 2.25 0 0 1 13 9.25v.38a2.25 2.25 0 1 1-1.5 0v-.38a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v.38a2.25 2.25 0 1 1-1.5 0v-.38A2.25 2.25 0 0 1 5.25 7H8V5.37A2.25 2.25 0 0 1 5 3.25Z"/></svg> Merge</button>
                      </div>
                    ` : ''}
                  `}
                ` : `<div class="fv-actions__empty">No worktree — actions require a worktree session.</div>`}
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ── ROW 2: Activity Log (1/3 height) ── -->
      <div class="fv-row fv-row--bottom${logExpanded ? ' fv-row--expanded' : ''}">
        <div class="fv-panel fv-panel--fill" style="background:#8888880D;">
          <div class="fv-panel__header fv-panel__header--static fv-log-panel-header" style="background:#8888881A;">
            <span class="fv-panel__header-text">≡ Activity Log</span>
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
  const statusColor = statusCol?.color ?? '';
  const statusDot = statusColor ? `<span class="fv-status-dot" style="background:${statusColor}1A"></span>` : '';
  return `
    <div class="fv-detail-grid">
      <div class="fv-detail-row fv-detail-row--status">
        <span class="fv-detail-label">${statusDot} Status</span>
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
          <span>◆ ${escapeHtml(task.agent)}</span>
        </div>
      ` : ''}
    </div>
    ${task.body ? `<div class="fv-description">${/<[a-z][\s\S]*>/i.test(task.body) ? sanitizeHtml(task.body) : escapeHtml(task.body)}</div>` : ''}
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
            <span>◆ ${escapeHtml(task.agent)}</span>
          </div>
        ` : ''}
      </div>
      <div class="fv-edit-body-group">
        <label class="fv-detail-label">Description</label>
        <div id="fv-edit-body-editor" class="md-editor-container"></div>
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
              addTaskLog(nt.id, 'board', `✗ ${nt.copilotSession.errorMessage}`);
            }
          }
        }
      }
      currentTasks = newTasks;
      loaded = true;
      // Sync mergedSessions from persisted metadata
      mergedSessions.clear();
      for (const t of currentTasks) {
        if (t.copilotSession?.merged) { mergedSessions.add(t.id); }
      }
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
            `<div class="stream-output__line stream-output__line--tool">⚙ ${escapeHtml(msg.status)}</div>`);
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
      repoIsAzureDevOps = msg.isAzureDevOps ?? false;
      workspaceRoot = msg.workspaceRoot ?? '';
      workspaceName = msg.workspaceName ?? '';
      render();
      break;
    case 'mergeResult':
      if (msg.success) { mergedSessions.add(msg.sessionId); }
      addTaskLog(msg.sessionId, msg.success ? 'system' : 'board',
        msg.success ? `✓ ${msg.message}` : `✗ Merge fallito: ${msg.message}`);
      render();
      break;
    case 'deleteWorktreeResult':
      addTaskLog(msg.sessionId, msg.success ? 'system' : 'board',
        msg.success ? '⊘ Worktree eliminato.' : `✗ Eliminazione fallita: ${msg.message ?? ''}`);
      if (msg.success) { mergedSessions.delete(msg.sessionId); }
      render();
      break;
    case 'createPullRequestResult':
      addTaskLog(msg.sessionId, msg.success ? 'system' : 'board',
        msg.success ? `⤴ Pull Request created: ${msg.prUrl ?? ''}` : `✗ Create PR failed: ${msg.message ?? ''}`);
      render();
      break;
  }
});

// Render the initial loading state immediately
render();

// Signal the host that the WebView is ready.
// Retry periodically in case the first message was lost (e.g. during panel
// deserialization where the host handler may not be wired yet).
vscode.postMessage({ type: 'ready' });
const readyRetry = setInterval(() => {
  if (loaded) { clearInterval(readyRetry); return; }
  vscode.postMessage({ type: 'ready' });
}, 2000);
