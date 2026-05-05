import { useRef } from 'react';
import { useBoard } from '../context/BoardContext';
import { getVsCodeApi, postMessage } from '../hooks/useVsCodeApi';
import { FlatButton } from './FlatButton';

export function Toolbar() {
  const { state, dispatch, imp, forceUpdate } = useBoard();
  const {
    workspaceName, mcpEnabled, squadStatus, repoIsGit,
    genAiProviders, availableAgents, squadTeams, selectedSquadProviderId,
    selectedAgentSlug, selectedBaseBranch, availableBranches,
    searchText, showSearchInput, syncing,
    mobileServerRunning, mobileDevices, mobileRefreshing,
  } = state;
  const isVsCodeWebview = Boolean(getVsCodeApi());
  const squadSheetRef = useRef<HTMLDialogElement>(null);

  const filtered = getFilteredCount();
  const squadProviders = genAiProviders.filter(p => !p.disabled && p.canSquad !== false);
  const squadAgents = availableAgents.filter(a => a.canSquad);
  console.log('[Toolbar] availableAgents:', availableAgents, 'squadAgents:', squadAgents, 'branches:', availableBranches, 'repoIsGit:', state.repoIsGit);

  // Split agents: team members first (from all agents), then other canSquad agents
  const teamSlugs = new Set(squadTeams.map(t => t.agentSlug));
  const teamEntries = squadTeams
    .filter(t => availableAgents.some(a => a.slug === t.agentSlug))
    .map(t => ({ slug: t.agentSlug, label: t.name }));
  const otherAgents = squadAgents.filter(a => !teamSlugs.has(a.slug));
  const hasAgents = teamEntries.length > 0 || otherAgents.length > 0;

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
      baseBranch: selectedBaseBranch || undefined,
    };
    if (action === 'startSquad') {
      const sourceCol = state.columns.find(c => c.id === 'todo')?.id ?? state.columns[0]?.id;
      const candidate = state.tasks.find(t =>
        t.status === sourceCol
        && (!t.copilotSession || (t.copilotSession.state !== 'running' && t.copilotSession.state !== 'starting'))
      );
      if (candidate) {
        imp.current.recentlyMovedTaskIds.add(candidate.id);
        imp.current.recentlyMovedTaskKinds.set(candidate.id, 'to-active');
        forceUpdate();
        setTimeout(() => {
          imp.current.recentlyMovedTaskIds.delete(candidate.id);
          imp.current.recentlyMovedTaskKinds.delete(candidate.id);
          forceUpdate();
        }, 850);
      }
      dispatch({ type: 'OPTIMISTIC_SQUAD_START' });
    }
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
            <FlatButton
              variant="icon"
              className={`mobile-companion-btn${mobileServerRunning ? ' mobile-companion-btn--on' : ' mobile-companion-btn--off'}${mobileRefreshing ? ' mobile-companion-btn--spinning' : ''}`}
              title={mobileServerRunning ? `Mobile server attivo — ${mobileDevices.length} device` : 'Mobile server spento'}
              onClick={() => {
                dispatch({ type: 'START_MOBILE_REFRESH' });
                postMessage({ type: 'openMobileCompanion' });
              }}
              icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 1.75A1.75 1.75 0 0 0 3.25 3.5v9A1.75 1.75 0 0 0 5 14.25h6A1.75 1.75 0 0 0 12.75 12.5v-9A1.75 1.75 0 0 0 11 1.75H5Zm0 1.5h6a.25.25 0 0 1 .25.25v9a.25.25 0 0 1-.25.25H5a.25.25 0 0 1-.25-.25v-9A.25.25 0 0 1 5 3.25ZM8 11.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
              </svg>}
            >
              {mobileServerRunning && mobileDevices.length > 0 && (
                <span className="mobile-companion-btn__badge">{mobileDevices.length}</span>
              )}
            </FlatButton>
          )}
          {!isVsCodeWebview && <ConnectionIndicator />}
          <NotificationBell />
        </div>
      </div>

      <div className="toolbar__row toolbar__row--main">
        {(availableBranches.length > 0 || !repoIsGit) && (
        <div className="toolbar__group toolbar__group--fade-in" data-label="Squad">
          <button
            className={`mcp-toggle mcp-toggle--toolbar${squadStatus.autoSquadEnabled ? ' mcp-toggle--on' : ''}`}
            title="Toggle Auto‑Squad"
            onClick={() => squadAction('toggleAutoSquad')}
          >
            <span className="mcp-toggle__dot" />
            <span className="mcp-toggle__label">Auto</span>
          </button>
          {availableBranches.length === 1
            ? <span className="toolbar__branch-pill" title="Base branch">{availableBranches[0]}</span>
            : availableBranches.length > 1 && (
            <select
              className="toolbar__select"
              title="Base branch"
              value={selectedBaseBranch}
              onChange={e => dispatch({ type: 'SET_SELECTED_BASE_BRANCH', branch: e.target.value })}
            >
              {availableBranches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          <select
            className="toolbar__select"
            title="Provider"
            value={selectedSquadProviderId || (squadProviders[0]?.id ?? '')}
            onChange={e => {
              const id = e.target.value;
              dispatch({ type: 'SET_SELECTED_SQUAD_PROVIDER', id });
              if (isVsCodeWebview && id) {
                postMessage({ type: 'setSelectedGenAiProvider', genAiProviderId: id });
              }
            }}
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
            disabled={!hasAgents}
            value={selectedAgentSlug || (teamEntries[0]?.slug ?? otherAgents[0]?.slug ?? '')}
            onChange={e => dispatch({ type: 'SET_SELECTED_AGENT', slug: e.target.value })}
          >
            {!hasAgents
              ? <option value="">No agents</option>
              : teamEntries.length > 0
                ? <>
                    {teamEntries.map(t => (
                      <option key={t.slug} value={t.slug}>{t.label}</option>
                    ))}
                    {otherAgents.length > 0 && <option disabled>───</option>}
                    {otherAgents.map(a => (
                      <option key={a.slug} value={a.slug}>{a.displayName}</option>
                    ))}
                  </>
                : squadAgents.map(a => (
                    <option key={a.slug} value={a.slug}>{a.displayName}</option>
                  ))}
          </select>
          <FlatButton
            variant="primary"
            icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5L12 8l-6 4.5v-9Z"/></svg>}
            disabled={squadStatus.activeCount >= squadStatus.maxSessions}
            title={squadStatus.autoSquadEnabled ? 'Launch squad and keep auto-polling' : 'Launch squad once'}
            onClick={() => squadAction('startSquad')}
          >
            {squadStatus.autoSquadEnabled ? 'Start Squad & Auto' : 'Start Squad'}
          </FlatButton>
          {squadStatus.activeCount > 0 && (
            <span className="toolbar__badge toolbar__badge--live">
              {squadStatus.activeCount}/{squadStatus.maxSessions}
            </span>
          )}
        </div>
        )}

        <div className="toolbar__spacer" />

        <div className="toolbar__group" data-label="Issues">
          <FlatButton
            variant="icon"
            title="Filter"
            onClick={() => dispatch({ type: 'TOGGLE_SEARCH' })}
            icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 12h4v-1H6v1zm-3-4h10V7H3v1zm-2-5v1h14V3H1z"/></svg>}
          >
            {searchText && <span className="toolbar__badge toolbar__badge--inline">{filtered}</span>}
          </FlatButton>
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
          <FlatButton variant="secondary" className={syncing ? 'toolbar__btn--syncing' : ''} icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.563 2.063A6 6 0 0 1 14 8h-1.5A4.5 4.5 0 1 0 8 12.5v1.5A6 6 0 0 1 5.563 2.063Z"/><path d="M14 4v4h-4l1.5-1.5L10 5l2.5-1L14 4Z"/></svg>} onClick={() => { dispatch({ type: 'START_SYNC' }); if (isVsCodeWebview) { postMessage({ type: 'refreshRequest' }); } else { (window as any).__agentBoardMobileSync?.(); } }}>{syncing ? 'Syncing…' : 'Sync'}</FlatButton>
          <FlatButton variant="secondary" icon="+" onClick={() => dispatch({ type: 'OPEN_TASK_FORM' })}>New Issue</FlatButton>
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
          <FlatButton
            variant="secondary"
            className={syncing ? 'toolbar__btn--syncing' : ''}
            icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.563 2.063A6 6 0 0 1 14 8h-1.5A4.5 4.5 0 1 0 8 12.5v1.5A6 6 0 0 1 5.563 2.063Z"/><path d="M14 4v4h-4l1.5-1.5L10 5l2.5-1L14 4Z"/></svg>}
            onClick={() => { dispatch({ type: 'START_SYNC' }); if (isVsCodeWebview) { postMessage({ type: 'refreshRequest' }); } else { (window as any).__agentBoardMobileSync?.(); } }}
          />
          <FlatButton
            variant="primary"
            className="toolbar__mobile-squad-btn"
            icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5L12 8l-6 4.5v-9Z"/></svg>}
            onClick={() => squadSheetRef.current?.showModal()}
          >
            Squad
          </FlatButton>
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

          {availableBranches.length >= 1 && (
            <>
              <label className="squad-sheet__label">Branch</label>
              {availableBranches.length === 1
                ? <span className="squad-sheet__branch-readonly">{availableBranches[0]}</span>
                : <select
                    className="squad-sheet__select"
                    value={selectedBaseBranch}
                    onChange={e => dispatch({ type: 'SET_SELECTED_BASE_BRANCH', branch: e.target.value })}
                  >
                    {availableBranches.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
              }
            </>
          )}

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

          <FlatButton
            variant="primary"
            className="squad-sheet__start"
            icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5L12 8l-6 4.5v-9Z"/></svg>}
            disabled={squadStatus.activeCount >= squadStatus.maxSessions}
            onClick={() => { squadAction('startSquad'); squadSheetRef.current?.close(); }}
          >
            {squadStatus.autoSquadEnabled ? 'Start Squad & Auto' : 'Start Squad'}
          </FlatButton>

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
    <FlatButton
      variant="icon"
      className="notification-bell"
      title="Notifications"
      onClick={() => dispatch({ type: 'TOGGLE_NOTIFICATION_CENTER' })}
      icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5A3.5 3.5 0 0 0 4.5 5v2.5c0 .5-.2 1.1-.6 1.6L3 10.2V11h10v-.8l-.9-1.1c-.4-.5-.6-1.1-.6-1.6V5A3.5 3.5 0 0 0 8 1.5ZM6.5 12a1.5 1.5 0 0 0 3 0h-3Z"/></svg>}
    >
      {count > 0 && <span className="notification-bell__badge">{count}</span>}
    </FlatButton>
  );
}

function ConnectionIndicator() {
  const { state } = useBoard();
  if (!state.connectionError) { return null; }

  return (
    <span className="connection-error" title="Connection to server lost">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.25 4v5h1.5V4h-1.5ZM8 10.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
      </svg>
    </span>
  );
}

export function getNotifications(repoIsGit: boolean, repoIsGitHub: boolean): string[] {
  const notifications: string[] = [];
  if (!repoIsGit) {
    notifications.push('⚠︎ Questo progetto non è un repository Git. Squad, VS Code API e GitHub Copilot sono disabilitati.');
  }
  return notifications;
}
