import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';

export function Toolbar() {
  const { state, dispatch } = useBoard();
  const {
    workspaceName, mcpEnabled, squadStatus, repoIsGit,
    genAiProviders, availableAgents, selectedSquadProviderId,
    selectedAgentSlug, searchText, showSearchInput,
  } = state;

  const filtered = getFilteredCount();
  const squadProviders = genAiProviders.filter(p => !p.disabled && p.id !== 'chat');
  const squadAgents = availableAgents.filter(a => a.canSquad);

  function getFilteredCount() {
    if (!searchText) { return state.tasks.length; }
    const q = searchText.toLowerCase();
    return state.tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.labels.some(l => l.toLowerCase().includes(q)) ||
      (t.assignee?.toLowerCase().includes(q) ?? false)
    ).length;
  }

  return (
    <header className="toolbar">
      <div className="project-bar">
        <span className="project-bar__name" title={workspaceName}>
          <svg className="project-bar__icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 1h5l1 2H14.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
          </svg>
          {workspaceName || 'Workspace'}
        </span>
        <div className="project-bar__actions">
          <button
            className={`mcp-toggle${mcpEnabled ? ' mcp-toggle--on' : ''}`}
            onClick={() => postMessage({ type: 'toggleMcp' })}
            title={`MCP Server ${mcpEnabled ? 'On' : 'Off'}`}
          >
            <span className="mcp-toggle__dot" />
            <span className="mcp-toggle__label">MCP</span>
          </button>
          <NotificationBell />
        </div>
      </div>

      <div className="toolbar__row toolbar__row--main">
        <div className="toolbar__group" data-label="Squad">
          <button
            className={`mcp-toggle mcp-toggle--toolbar${squadStatus.autoSquadEnabled ? ' mcp-toggle--on' : ''}`}
            disabled={!repoIsGit}
            title="Toggle Auto‑Squad"
            onClick={() => postMessage({ type: 'toggleAutoSquad', agentSlug: selectedAgentSlug || undefined, genAiProviderId: selectedSquadProviderId || undefined })}
          >
            <span className="mcp-toggle__dot" />
            <span className="mcp-toggle__label">Auto</span>
          </button>
          <select
            className="toolbar__select"
            title="Provider"
            value={selectedSquadProviderId || (squadProviders[0]?.id ?? '')}
            onChange={e => dispatch({ type: 'SET_SELECTED_SQUAD_PROVIDER', id: e.target.value })}
          >
            {squadProviders.length === 0
              ? <option value="">No providers</option>
              : squadProviders.map(p => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
          </select>
          <select
            className="toolbar__select"
            title="Agent"
            disabled={!squadAgents.some(a => a.canSquad)}
            value={selectedAgentSlug || (squadAgents[0]?.slug ?? '')}
            onChange={e => dispatch({ type: 'SET_SELECTED_AGENT', slug: e.target.value })}
          >
            {squadAgents.length === 0
              ? <option value="">No agents</option>
              : squadAgents.map(a => (
                <option key={a.slug} value={a.slug}>{a.displayName}</option>
              ))}
          </select>
          <button
            className="toolbar__btn toolbar__btn--primary"
            disabled={!repoIsGit || squadStatus.activeCount >= squadStatus.maxSessions}
            title="Start Squad"
            onClick={() => postMessage({ type: 'startSquad', agentSlug: selectedAgentSlug || undefined, genAiProviderId: selectedSquadProviderId || undefined })}
          >
            ▶ Start
          </button>
          {squadStatus.activeCount > 0 && (
            <span className="toolbar__badge toolbar__badge--live">
              {squadStatus.activeCount}/{squadStatus.maxSessions}
            </span>
          )}
        </div>

        <div className="toolbar__spacer" />

        <div className="toolbar__group" data-label="Issues">
          <button
            className="toolbar__btn toolbar__btn--icon"
            title="Filter"
            onClick={() => dispatch({ type: 'TOGGLE_SEARCH' })}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 12h4v-1H6v1zm-3-4h10V7H3v1zm-2-5v1h14V3H1z"/>
            </svg>
            {searchText && <span className="toolbar__badge toolbar__badge--inline">{filtered}</span>}
          </button>
          {showSearchInput && (
            <input
              className="toolbar__search-input toolbar__search-input--open"
              placeholder="Filter issues…"
              value={searchText}
              autoFocus
              onChange={e => dispatch({ type: 'SET_SEARCH_TEXT', text: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Escape') { dispatch({ type: 'TOGGLE_SEARCH' }); }
              }}
            />
          )}
          <button className="toolbar__btn toolbar__btn--secondary" onClick={() => postMessage({ type: 'refreshRequest' })}>Sync</button>
          <button className="toolbar__btn toolbar__btn--secondary" onClick={() => dispatch({ type: 'OPEN_TASK_FORM' })}>+ New Issue</button>
        </div>
      </div>
    </header>
  );
}

function NotificationBell() {
  const { state, dispatch } = useBoard();
  const notifications = getNotifications(state.repoIsGit, state.repoIsGitHub);
  const count = notifications.length;

  return (
    <button
      className="toolbar__btn toolbar__btn--icon notification-bell"
      title="Notifications"
      onClick={() => dispatch({ type: 'TOGGLE_NOTIFICATION_CENTER' })}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5A3.5 3.5 0 0 0 4.5 5v2.5c0 .5-.2 1.1-.6 1.6L3 10.2V11h10v-.8l-.9-1.1c-.4-.5-.6-1.1-.6-1.6V5A3.5 3.5 0 0 0 8 1.5ZM6.5 12a1.5 1.5 0 0 0 3 0h-3Z"/>
      </svg>
      {count > 0 && <span className="notification-bell__badge">{count}</span>}
    </button>
  );
}

export function getNotifications(repoIsGit: boolean, repoIsGitHub: boolean): string[] {
  const notifications: string[] = [];
  if (!repoIsGit) {
    notifications.push('⚠︎ Questo progetto non è un repository Git. Squad, Copilot LM API, Copilot CLI e Cloud sono disabilitati.');
  } else if (!repoIsGitHub) {
    notifications.push('⚠︎ Nessun remote GitHub collegato. Cloud è disabilitato.');
  }
  return notifications;
}
