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
}
interface AgentOption {
  slug: string;
  displayName: string;
}
interface GenAiProviderOption {
  id: string;
  displayName: string;
  icon: string;
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
let mcpEnabled = false;
let squadStatus: SquadStatus = { activeCount: 0, maxSessions: 10, autoSquadEnabled: false };
let showTaskForm = false;
let formColumns: Column[] = [];
let editableProviderIds: string[] = [];
let genAiProviders: GenAiProviderOption[] = [];

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
          <select class="toolbar__select" id="agent-select" title="Agent">
            <option value="">Agent: any</option>
            ${availableAgents.map(a => `<option value="${escapeHtml(a.slug)}"${a.slug === selectedAgentSlug ? ' selected' : ''}>${escapeHtml(a.displayName)}</option>`).join('')}
          </select>
          <button class="toolbar__btn toolbar__btn--primary" id="btn-start-squad" ${squadStatus.activeCount >= squadStatus.maxSessions ? 'disabled' : ''} title="Start Squad">▶ Start</button>
          <button class="toolbar__btn toolbar__btn--toggle${squadStatus.autoSquadEnabled ? ' toolbar__btn--on' : ''}" id="btn-toggle-auto" title="Toggle Auto‑Squad">⟳ Auto</button>
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
    <div class="kanban">
      ${currentColumns.map(col => renderColumn(col, filtered.filter(t => t.status === col.id))).join('')}
    </div>
    ${selectedTask && !editingTask ? renderDetail(selectedTask) : ''}
    ${editingTask ? renderEditForm(editingTask) : ''}
    ${showTaskForm && !editingTask ? renderTaskForm() : ''}
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

  document.getElementById('agent-select')?.addEventListener('change', (e: Event) => {
    selectedAgentSlug = (e.target as HTMLSelectElement).value;
  });

  document.getElementById('btn-start-squad')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'startSquad', agentSlug: selectedAgentSlug || undefined });
  });

  document.getElementById('btn-toggle-auto')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleAutoSquad', agentSlug: selectedAgentSlug || undefined });
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
    }
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
  return `
    <div class="task-card" data-task-id="${escapeHtml(task.id)}">
      <div class="task-card__title">${escapeHtml(task.title)}</div>
      <div class="task-card__meta">
        ${task.labels.map(l => `<span class="task-card__label">${escapeHtml(l)}</span>`).join('')}
        ${initials ? `<span class="task-card__assignee">${initials}</span>` : ''}
        <span class="task-card__provider">${escapeHtml(task.providerId)}</span>
      </div>
    </div>
  `;
}

function renderDetail(task: KanbanTask): string {
  return `
    <div class="task-detail">
      <button class="task-detail__close" id="detail-close">✕</button>
      <div class="task-detail__title">${escapeHtml(task.title)}</div>
      <div class="task-detail__labels">
        ${task.labels.map(l => `<span class="task-card__label">${escapeHtml(l)}</span>`).join('')}
      </div>
      <div class="task-detail__body">${escapeHtml(task.body)}</div>
      ${task.url ? `<a class="task-detail__link" href="${escapeHtml(task.url)}">Open source ↗</a>` : ''}
      <button class="task-detail__copilot-btn" id="detail-copilot">🤖 Launch Copilot</button>
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
              <button class="actions__provider-btn" data-provider-id="${escapeHtml(p.id)}" title="${escapeHtml(p.displayName)}">
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
    case 'themeChange':
      // Theme is auto-applied via CSS variables; nothing to do.
      break;
  }
});

// Signal the host that the WebView is ready
vscode.postMessage({ type: 'ready' });
