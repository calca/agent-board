import { useRef } from 'react';
import { useBoard } from '../context/BoardContext';
import { getVsCodeApi, postMessage } from '../hooks/useVsCodeApi';

export function Toolbar() {
  const { state, dispatch } = useBoard();
  const {
    workspaceName, mcpEnabled, squadStatus, repoIsGit,
    genAiProviders, availableAgents, selectedSquadProviderId,
    selectedAgentSlug, searchText, showSearchInput, syncing,
    mobileServerRunning, mobileDevices, mobileRefreshing,
  } = state;
  const isVsCodeWebview = Boolean(getVsCodeApi());
  const squadSheetRef = useRef<HTMLDialogElement>(null);

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

  function squadAction(action: 'startSquad' | 'toggleAutoSquad') {
    const payload = {
      agentSlug: selectedAgentSlug || undefined,
      genAiProviderId: selectedSquadProviderId || undefined,
    };
    if (isVsCodeWebview) {
      postMessage({ type: action, ...payload });
    } else {
      const endpoint = action === 'startSquad' ? '/squad/start' : '/squad/toggle-auto';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => { /* ignore */ });
    }
  }

  return (
    <header className="toolbar">
      <div className="project-bar">
        <span className="project-bar__name" title={workspaceName}>
          {syncing
            ? <span className="project-bar__spinner" />
            : <svg className="project-bar__icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 1h5l1 2H14.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
              </svg>}
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
          {isVsCodeWebview && (
            <button
              className={`toolbar__btn toolbar__btn--icon mobile-companion-btn${mobileServerRunning ? ' mobile-companion-btn--on' : ' mobile-companion-btn--off'}${mobileRefreshing ? ' mobile-companion-btn--spinning' : ''}`}
              title={mobileServerRunning ? `Mobile server attivo — ${mobileDevices.length} device` : 'Mobile server spento'}
              onClick={() => {
                dispatch({ type: 'START_MOBILE_REFRESH' });
                postMessage({ type: 'openMobileCompanion' });
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 1.75A1.75 1.75 0 0 0 3.25 3.5v9A1.75 1.75 0 0 0 5 14.25h6A1.75 1.75 0 0 0 12.75 12.5v-9A1.75 1.75 0 0 0 11 1.75H5Zm0 1.5h6a.25.25 0 0 1 .25.25v9a.25.25 0 0 1-.25.25H5a.25.25 0 0 1-.25-.25v-9A.25.25 0 0 1 5 3.25ZM8 11.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
              </svg>
              {mobileServerRunning && mobileDevices.length > 0 && (
                <span className="mobile-companion-btn__badge">{mobileDevices.length}</span>
              )}
            </button>
          )}
          {!isVsCodeWebview && <ConnectionIndicator />}
          <NotificationBell />
        </div>
      </div>

      <div className="toolbar__row toolbar__row--main">
        <div className="toolbar__group" data-label="Squad">
          <button
            className={`mcp-toggle mcp-toggle--toolbar${squadStatus.autoSquadEnabled ? ' mcp-toggle--on' : ''}`}
            title="Toggle Auto‑Squad"
            onClick={() => squadAction('toggleAutoSquad')}
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
            disabled={squadStatus.activeCount >= squadStatus.maxSessions}
            title="Start Squad"
            onClick={() => squadAction('startSquad')}
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
          <button className={`toolbar__btn toolbar__btn--secondary toolbar__btn--sync${syncing ? ' toolbar__btn--syncing' : ''}`} onClick={() => { dispatch({ type: 'START_SYNC' }); if (isVsCodeWebview) { postMessage({ type: 'refreshRequest' }); } else { (window as any).__agentBoardMobileSync?.(); } }}>{syncing ? 'Syncing…' : 'Sync'}</button>
          <button className="toolbar__btn toolbar__btn--secondary" onClick={() => dispatch({ type: 'OPEN_TASK_FORM' })}>+ New Issue</button>
        </div>
      </div>

      {/* ── Mobile: summary bar (hidden on desktop via CSS) ──────────── */}
      <div className="toolbar__mobile-summary">
        {squadStatus.activeCount > 0 ? (
          <span className="toolbar__mobile-running">
            <span className="toolbar__mobile-running-dot" />
            {squadStatus.activeCount} running
          </span>
        ) : (
          <span className="toolbar__mobile-idle">No agents running</span>
        )}
        <div className="toolbar__mobile-actions">
          <button
            className={`toolbar__btn toolbar__btn--secondary toolbar__btn--sync${syncing ? ' toolbar__btn--syncing' : ''}`}
            onClick={() => { dispatch({ type: 'START_SYNC' }); if (isVsCodeWebview) { postMessage({ type: 'refreshRequest' }); } else { (window as any).__agentBoardMobileSync?.(); } }}
          >
            {syncing ? '↻' : '↻'}
          </button>
          <button
            className="toolbar__btn toolbar__btn--primary toolbar__mobile-squad-btn"
            onClick={() => squadSheetRef.current?.showModal()}
          >
            ▶ Squad
          </button>
        </div>
      </div>

      {/* ── Mobile: bottom sheet for squad launch ──────────────────── */}
      <dialog
        ref={squadSheetRef}
        className="squad-sheet"
        onClick={e => { if (e.target === squadSheetRef.current) { squadSheetRef.current?.close(); } }}
      >
        <div className="squad-sheet__content">
          <div className="squad-sheet__handle" />
          <h3 className="squad-sheet__title">Launch Squad</h3>

          <label className="squad-sheet__label">Provider</label>
          <select
            className="squad-sheet__select"
            value={selectedSquadProviderId || (squadProviders[0]?.id ?? '')}
            onChange={e => dispatch({ type: 'SET_SELECTED_SQUAD_PROVIDER', id: e.target.value })}
          >
            {squadProviders.length === 0
              ? <option value="">No providers</option>
              : squadProviders.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>

          <label className="squad-sheet__label">Agent</label>
          <select
            className="squad-sheet__select"
            disabled={!squadAgents.some(a => a.canSquad)}
            value={selectedAgentSlug || (squadAgents[0]?.slug ?? '')}
            onChange={e => dispatch({ type: 'SET_SELECTED_AGENT', slug: e.target.value })}
          >
            {squadAgents.length === 0
              ? <option value="">No agents</option>
              : squadAgents.map(a => <option key={a.slug} value={a.slug}>{a.displayName}</option>)}
          </select>

          <div className="squad-sheet__toggle-row">
            <span>Auto-Squad</span>
            <button
              className={`mcp-toggle mcp-toggle--toolbar${squadStatus.autoSquadEnabled ? ' mcp-toggle--on' : ''}`}
              onClick={() => squadAction('toggleAutoSquad')}
            >
              <span className="mcp-toggle__dot" />
              <span className="mcp-toggle__label">{squadStatus.autoSquadEnabled ? 'On' : 'Off'}</span>
            </button>
          </div>

          {squadStatus.activeCount > 0 && (
            <div className="squad-sheet__status">
              <span className="toolbar__mobile-running-dot" />
              {squadStatus.activeCount}/{squadStatus.maxSessions} sessions active
            </div>
          )}

          <button
            className="toolbar__btn toolbar__btn--primary squad-sheet__start"
            disabled={squadStatus.activeCount >= squadStatus.maxSessions}
            onClick={() => { squadAction('startSquad'); squadSheetRef.current?.close(); }}
          >
            ▶ Start Squad
          </button>

          <button className="squad-sheet__close" onClick={() => squadSheetRef.current?.close()}>Cancel</button>
        </div>
      </dialog>
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

function ConnectionIndicator() {
  const { state } = useBoard();
  if (!state.connectionError) { return null; }

  return (
    <span className="connection-error" title="Connessione al server persa">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.25 4v5h1.5V4h-1.5ZM8 10.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
      </svg>
    </span>
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
