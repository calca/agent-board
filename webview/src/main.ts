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

let currentTasks: KanbanTask[] = [];
let currentColumns: Column[] = [];
let selectedTask: KanbanTask | null = null;
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
    ${selectedTask ? renderDetail(selectedTask) : ''}
  `;

  // Event listeners
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshRequest' });
  });

  document.getElementById('btn-mcp-toggle')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleMcp' });
  });
  document.getElementById('btn-add-task')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'addTask' });
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
      selectedTask = currentTasks.find(t => t.id === taskId) ?? null;
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
    case 'themeChange':
      // Theme is auto-applied via CSS variables; nothing to do.
      break;
  }
});

// Signal the host that the WebView is ready
vscode.postMessage({ type: 'ready' });
