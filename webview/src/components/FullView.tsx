import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBoard } from '../context/BoardContext';
import { DataProvider } from '../DataProvider';
import { postMessage } from '../hooks/useVsCodeApi';
import type { AgentOption, Column, KanbanTask } from '../types';
import { relativeWorktreePath } from '../utils';
import { ChatContainer } from './chat';
import { FlatButton } from './FlatButton';
import { LocalNotesPanel } from './LocalNotesPanel';
import { MarkdownBody } from './MarkdownBody';

const statusIcons: Record<string, string> = { added: '＋', modified: '✎', deleted: '✕' };
const logSourceIcons: Record<string, string> = { board: '☰', agent: '◆', tool: '⚙', system: 'ⓘ' };

export function FullView() {
  const { state, dispatch, imp } = useBoard();
  const { fullViewTaskId, tasks, columns, genAiProviders, repoIsGit, repoIsGitHub, repoIsAzureDevOps, workspaceRoot, availableAgents } = state;
  const logScrollRef = useRef<HTMLDivElement>(null);
  const [mobileTab, setMobileTab] = useState<'details' | 'session' | 'files' | 'actions' | 'chat'>('details');

  const task = tasks.find(t => t.id === fullViewTaskId);

  useEffect(() => {
    if (imp.current.fullViewAutoScroll && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  });

  const handleLogScroll = useCallback(() => {
    if (logScrollRef.current) {
      const el = logScrollRef.current;
      imp.current.fullViewAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }
  }, [imp]);

  const handleClose = useCallback(() => {
    imp.current.fullViewAutoScroll = true;
    dispatch({ type: 'CLOSE_FULL_VIEW' });
  }, [dispatch, imp]);

  if (!fullViewTaskId || !task) { return null; }

  const sessionInfo = task.copilotSession;
  const isRunning = sessionInfo?.state === 'running' || sessionInfo?.state === 'starting';
  const isInterrupted = sessionInfo?.state === 'interrupted';
  const logs = imp.current.taskEventLogs.get(task.id) ?? [];
  const files = imp.current.fileChangeLists.get(task.id) ?? [];
  const statusCol = columns.find(c => c.id === task.status);
  const activeProviderId = isRunning ? sessionInfo?.providerId : undefined;
  const isMerged = imp.current.mergedSessions.has(task.id);
  const hasWorktree = !!sessionInfo?.worktreePath;
  const isLastCol = task.status === columns[columns.length - 1]?.id;
  const stateClass = sessionInfo ? `task-card__session task-card__session--${sessionInfo.state}` : '';

  return (
    <div className="full-view">
      {/* Top bar */}
      <div className="fv-topbar">
        <div className="fv-topbar__left">
          <FlatButton variant="icon" icon="←" className="fv-topbar__back" title="Back" onClick={handleClose} />
          <div className="fv-topbar__title-group">
            <span className="fv-topbar__title">{task.title}</span>
            <span className="fv-topbar__meta">
              {sessionInfo && <span className={stateClass}>{sessionInfo.state}</span>}
              <span className="fv-topbar__provider">{task.providerId}</span>
              {task.url && <a className="fv-topbar__link" href={task.url}>↗</a>}
            </span>
          </div>
        </div>
        <div className="fv-topbar__actions">
          {isMerged && <span className="fv-merged-badge fv-merged-badge--inline">✓ Merged</span>}
        </div>
      </div>

      {isInterrupted && <div className="session-interrupted-banner">↯ Session interrupted. Log is read-only.</div>}

      {/* Mobile tab selector — hidden on desktop via CSS */}
      <div className="fv-tab-selector" role="tablist">
        {([
          { id: 'details' as const, label: '☰ Details', badge: undefined as number | undefined },
          { id: 'session' as const, label: '⊙ Session', badge: undefined as number | undefined },
          { id: 'files' as const, label: '⊞ Files', badge: files.length || undefined },
          { id: 'actions' as const, label: '▸ Actions', badge: undefined as number | undefined },
          { id: 'chat' as const, label: '≡ Chat', badge: logs.length || undefined },
        ]).map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={mobileTab === tab.id}
            className={`fv-tab-selector__tab${mobileTab === tab.id ? ' fv-tab-selector__tab--active' : ''}`}
            onClick={() => setMobileTab(tab.id)}
          >
            <span className="fv-tab-selector__label">{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="fv-tab-selector__badge">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ROW 1: Details / Session / Actions (1/3 height) */}
      <div className={`fv-row fv-row--top${mobileTab === 'chat' ? ' fv-row--hidden-mobile' : ''}`}>
        {/* Task Details */}
        <div className="fv-col" data-fv-tab="details" data-active={mobileTab === 'details' || undefined}>
          <div className="fv-panel fv-panel--fill">
            <div className="fv-panel__header fv-panel__header--static">
              <span className="fv-panel__header-text">☰ Issue Details</span>
              <FlatButton variant="icon" size="sm" icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>} title="Edit" onClick={() => dispatch({ type: 'SET_EDITING_TASK', task })} />
            </div>
            <div className="fv-panel__body fv-panel__body--scroll">
              <FvReadOnlyDetails task={task} statusCol={statusCol} columns={columns} />
            </div>
          </div>
        </div>

        {/* Session */}
        <div className="fv-col" data-fv-tab="session" data-active={mobileTab === 'session' || undefined}>
          <div className="fv-panel fv-panel--fill">
            <div className="fv-panel__header fv-panel__header--static">
              <span className="fv-panel__header-text">⊙ Session</span>
            </div>
            <div className="fv-panel__body fv-panel__body--scroll">
              {sessionInfo || hasWorktree
                ? <FvSessionPanel sessionInfo={sessionInfo} task={task} isMerged={isMerged} workspaceRoot={workspaceRoot} />
                : <div className="fv-empty-hint">No session started</div>}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="fv-col" data-fv-tab="actions" data-active={mobileTab === 'actions' || undefined}>
          <div className="fv-panel fv-panel--fill">
            <div className="fv-panel__header fv-panel__header--static">
              <span className="fv-panel__header-text">
                <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7ZM4 6.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5Zm.5 2.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4Zm-1 3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5Z"/></svg>
                {' '}Actions
              </span>
            </div>
            <div className="fv-panel__body fv-panel__body--scroll">
              <FvActions
                task={task}
                sessionInfo={sessionInfo}
                isRunning={isRunning}
                isMerged={isMerged}
                hasWorktree={hasWorktree}
                activeProviderId={activeProviderId}
                genAiProviders={genAiProviders}
                availableAgents={availableAgents}
                repoIsGitHub={repoIsGitHub}
                repoIsAzureDevOps={repoIsAzureDevOps}
                columns={columns}
                dispatch={dispatch}
                availableBranches={state.availableBranches}
                selectedBaseBranch={state.selectedBaseBranch}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2: Files (1/4) + Activity Log (3/4)  — 2/3 height */}
      <div className="fv-row fv-row--bottom" data-fv-tab="chat" data-active={mobileTab === 'chat' || mobileTab === 'files' || undefined}>
        {/* Files panel */}
        <div className="fv-col fv-col--files" data-fv-tab="files" data-active={mobileTab === 'files' || undefined}>
          <div className="fv-panel fv-panel--fill">
            <div className="fv-panel__header fv-panel__header--static">
              <span className="fv-panel__header-text">⊞ Modified Files</span>
              {files.length > 0 && <span className="fv-panel__badge">{files.length}</span>}
              <span className="fv-panel__header-actions">
                {hasWorktree && !isMerged && (
                  <FlatButton variant="icon" size="sm" icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>} title="Open in VS Code" onClick={() => postMessage({ type: 'openWorktree', worktreePath: sessionInfo!.worktreePath! })} />
                )}
                {hasWorktree && !isMerged && sessionInfo?.state === 'completed' && (
                  <FlatButton variant="icon" size="sm" icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.586a1.5 1.5 0 0 1 1.06.44l3.415 3.414A1.5 1.5 0 0 1 14 6.914V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7H9.5A1.5 1.5 0 0 1 8 5.5V3H3.5ZM9 3.207V5.5a.5.5 0 0 0 .5.5h2.293L9 3.207ZM6 8.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2Z"/></svg>} title="Review Diff" onClick={() => postMessage({ type: 'reviewWorktree', sessionId: task.id })} />
                )}
              </span>
            </div>
            <div className="fv-panel__body fv-panel__body--scroll fv-panel__body--flush">
              {files.length === 0
                ? <div className="fv-files-empty">No changes detected</div>
                : <div className="fv-file-list">
                    {files.map(f => (
                      <div
                        key={f.path}
                        className={`fv-file-item file-list__item file-list__item--${f.status}`}
                        data-file-path={f.path}
                        onClick={() => postMessage({ type: 'openDiff', sessionId: fullViewTaskId!, filePath: f.path })}
                      >
                        <span className="file-list__icon">{statusIcons[f.status] || '?'}</span>
                        <span className="file-list__path">{f.path}</span>
                      </div>
                    ))}
                  </div>}
            </div>
          </div>
        </div>

        {/* Activity Log panel */}
        <div className="fv-col fv-col--log" data-fv-tab="chat" data-active={mobileTab === 'chat' || undefined}>
          <div className="fv-panel fv-panel--fill">
            <div className="fv-panel__header fv-panel__header--static fv-log-panel-header">
              <span className="fv-panel__header-text">≡ Activity Logs</span>
              <span className="fv-panel__badge">{logs.length}</span>
            </div>
            <div className="fv-panel__body fv-panel__body--log">
              {fullViewTaskId ? (
                <ChatContainer sessionId={fullViewTaskId} />
              ) : (
                <div className="fv-log-scroll" ref={logScrollRef} onScroll={handleLogScroll}>
                  <div className="fv-log-entries">
                    {logs.map((e, i) => (
                      <div key={i} className={`fv-log__entry fv-log__entry--${e.source}`}>
                        <span className="fv-log__ts">[{e.ts}]</span>{' '}
                        <span className="fv-log__icon">{logSourceIcons[e.source] ?? '●'}</span>{' '}
                        <span className="fv-log__text">{e.text}</span>
                      </div>
                    ))}
                    {logs.length === 0 && <div className="fv-log__empty">No activity yet. Events will appear here in real time.</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function FvReadOnlyDetails({ task, statusCol, columns }: { task: KanbanTask; statusCol: Column | undefined; columns: Column[] }) {
  const statusColor = statusCol?.color ?? '';
  const isLocalProvider = task.providerId === 'json';
  const savedNotes = (task.meta as Record<string, unknown>)?.localNotes as string | undefined;
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <>
      <div className="fv-detail-grid">
        <div className="fv-detail-row fv-detail-row--status">
          <span className="fv-detail-label">Status</span>
          <select
            className="task-form__select fv-status-select"
            value={task.status}
            onChange={e => DataProvider.updateTaskStatus(task.id, e.target.value as any, task.providerId).catch(err => console.error('Error updating task status:', err))}
          >
            {columns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        {task.labels.length > 0 && (
          <div className="fv-detail-row">
            <span className="fv-detail-label">Labels</span>
            <span className="fv-detail-labels">{task.labels.map(l => <span key={l} className="task-card__label">{l}</span>)}</span>
          </div>
        )}
        {task.agent && (
          <div className="fv-detail-row">
            <span className="fv-detail-label">Agent</span>
            <span className="fv-detail-value">◆ {task.agent}</span>
          </div>
        )}
      </div>
      {task.body && (
        <MarkdownBody body={task.body} className="fv-description" />
      )}
      {!isLocalProvider && (
        <div className="fv-local-notes">
          <FlatButton variant="ghost" className="fv-local-notes__cta" onClick={() => setNotesOpen(true)} icon={savedNotes
              ? <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg>
              : <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg>
            }>{savedNotes ? 'Technical Notes' : '+ Technical Notes'}</FlatButton>
          {savedNotes && <MarkdownBody body={savedNotes} className="fv-local-notes__preview" />}
          {notesOpen && (
            <LocalNotesPanel
              taskId={task.id}
              providerId={task.providerId}
              markdown={savedNotes ?? ''}
              onClose={() => setNotesOpen(false)}
            />
          )}
        </div>
      )}
    </>
  );
}

function FvSessionPanel({ sessionInfo, task, isMerged, workspaceRoot }: {
  sessionInfo: KanbanTask['copilotSession'];
  task: KanbanTask;
  isMerged: boolean;
  workspaceRoot: string;
}) {
  if (!sessionInfo) { return null; }
  return (
    <div className="fv-session-grid">
      <div className="fv-detail-row">
        <span className="fv-detail-label">State</span>
        <span className={`task-card__session task-card__session--${sessionInfo.state}`}>{sessionInfo.state}</span>
      </div>
      {sessionInfo.providerId && (
        <div className="fv-detail-row">
          <span className="fv-detail-label">Provider</span>
          <span>{sessionInfo.providerId}</span>
        </div>
      )}
      {sessionInfo.startedAt && (
        <div className="fv-detail-row">
          <span className="fv-detail-label">Started</span>
          <span className="fv-detail-meta">{sessionInfo.startedAt}</span>
        </div>
      )}
      {sessionInfo.finishedAt && (
        <div className="fv-detail-row">
          <span className="fv-detail-label">Finished</span>
          <span className="fv-detail-meta">{sessionInfo.finishedAt}</span>
        </div>
      )}
      {sessionInfo.state === 'error' && sessionInfo.errorMessage && (
        <div className="fv-session-error">{sessionInfo.errorMessage}</div>
      )}
      {sessionInfo.prUrl && (
        <div className="fv-detail-row">
          <span className="fv-detail-label">Pull Request</span>
          <a className={`task-card__pr-badge task-card__pr-badge--${sessionInfo.prState ?? 'open'}`} href={sessionInfo.prUrl}>
            PR #{sessionInfo.prNumber ?? ''}
          </a>
        </div>
      )}
      {sessionInfo.worktreePath && (
        <div className="fv-detail-row">
          <span className="fv-detail-label">Worktree</span>
          <code className="fv-wt-path">{relativeWorktreePath(sessionInfo.worktreePath, workspaceRoot)}</code>
        </div>
      )}
    </div>
  );
}

function FvActions({ task, sessionInfo, isRunning, isMerged, hasWorktree, activeProviderId, genAiProviders, availableAgents, repoIsGitHub, repoIsAzureDevOps, columns, dispatch, availableBranches, selectedBaseBranch }: {
  task: KanbanTask;
  sessionInfo: KanbanTask['copilotSession'];
  isRunning: boolean;
  isMerged: boolean;
  hasWorktree: boolean;
  activeProviderId: string | undefined;
  genAiProviders: { id: string; displayName: string; disabled?: boolean }[];
  availableAgents: AgentOption[];
  repoIsGitHub: boolean;
  repoIsAzureDevOps: boolean;
  columns: Column[];
  dispatch: React.Dispatch<any>;
  availableBranches: string[];
  selectedBaseBranch: string;
}) {
  const isCompleteOrDone = sessionInfo?.state === 'completed' || task.status === 'done';
  const squadAgents = availableAgents.filter(a => a.canSquad);
  const [selectedSquadAgent, setSelectedSquadAgent] = useState<string>(task.squadAgent ?? '');

  // Keep local state in sync when the task prop changes (e.g. after save)
  useEffect(() => {
    setSelectedSquadAgent(task.squadAgent ?? '');
  }, [task.squadAgent]);

  function handleSquadAgentChange(slug: string) {
    setSelectedSquadAgent(slug);
    postMessage({ type: 'saveSquadAgent', taskId: task.id, providerId: task.providerId, agentSlug: slug });
  }

  return (
    <div className="fv-actions">
      {sessionInfo && !isRunning && (
        <FlatButton variant="ghost" fullWidth className="fv-reset-session" icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.563 2.063A6 6 0 0 1 14 8h-1.5A4.5 4.5 0 1 0 8 12.5v1.5A6 6 0 0 1 5.563 2.063Z"/><path d="M14 4v4h-4l1.5-1.5L10 5l2.5-1L14 4Z"/></svg>} onClick={() => {
          postMessage({ type: 'resetSession', sessionId: task.id });
          dispatch({ type: 'SET_EDITING_TASK', task: null });
          dispatch({ type: 'CLOSE_FULL_VIEW' });
        }} title="Reset session and move task back to first column">
          Reset
        </FlatButton>
      )}

      {isRunning ? (
        <>
          <div className="fv-actions__running-provider">
            <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11ZM7 5v4.5l3.5 2 .75-1.25L8.5 8.5V5H7Z"/></svg>
            {' '}{genAiProviders.find(p => p.id === activeProviderId)?.displayName ?? activeProviderId ?? 'Agent'}
          </div>
          <FlatButton variant="danger" fullWidth icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>} onClick={() => postMessage({ type: 'cancelSession', taskId: task.id })}>
            Stop
          </FlatButton>
        </>
      ) : sessionInfo?.state !== 'completed' && !isMerged ? (
        <>
          {squadAgents.length > 0 && (
            <div className="fv-squad-agent-selector">
              <label className="fv-squad-agent-selector__label">Squad Agent</label>
              <select
                className="fv-merge-select fv-squad-agent-selector__select"
                value={selectedSquadAgent}
                onChange={e => handleSquadAgentChange(e.target.value)}
              >
                <option value="">(none)</option>
                {squadAgents.map(a => (
                  <option key={a.slug} value={a.slug}>{a.displayName}</option>
                ))}
              </select>
            </div>
          )}
          {availableBranches.length >= 1 && (
            <div className="fv-branch-selector">
              <label className="fv-branch-selector__label">Branch</label>
              {availableBranches.length === 1
                ? <span className="fv-branch-selector__readonly">{availableBranches[0]}</span>
                : <select
                    className="fv-merge-select"
                    value={selectedBaseBranch}
                    onChange={e => dispatch({ type: 'SET_SELECTED_BASE_BRANCH', branch: e.target.value })}
                  >
                    {availableBranches.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
              }
            </div>
          )}
          <div className="fv-actions__providers">
            {genAiProviders.filter(p => !p.disabled).length > 0
              ? genAiProviders.filter(p => !p.disabled).map(p => (
                <FlatButton key={p.id} variant="secondary" fullWidth className="fv-launch-provider" icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5L12 8l-6 4.5v-9Z"/></svg>} onClick={() => postMessage({ type: 'launchProvider', taskId: task.id, providerId: task.providerId, genAiProviderId: p.id, agentSlug: selectedSquadAgent || undefined, baseBranch: selectedBaseBranch || undefined })} title={p.displayName}>
                  {p.displayName}
                </FlatButton>
              ))
              : <p className="fv-actions__no-providers">No GenAI providers enabled. Configure them in <strong>Settings → GenAI</strong>.</p>
            }
          </div>
        </>
      ) : null}

      {hasWorktree ? (
        isMerged ? (
          <FlatButton variant="danger" fullWidth icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1.5A.5.5 0 0 1 6 1h4a.5.5 0 0 1 .5.5V3h3a.5.5 0 0 1 0 1h-.538l-.853 10.66A1 1 0 0 1 11.114 15H4.886a1 1 0 0 1-.995-.94L3.038 4H2.5a.5.5 0 0 1 0-1h3V1.5ZM6.5 2v1h3V2h-3Zm-2.457 2 .826 10h6.262l.826-10H4.043Z"/></svg>} onClick={() => postMessage({ type: 'deleteWorktree', sessionId: task.id })} title="Delete worktree directory and branch">
            Delete Workspace
          </FlatButton>
        ) : (
          <>
            {!isRunning && (
              <div className="fv-actions__row">
                <FlatButton variant="secondary" fullWidth className="fv-align-wt" icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 1ZM3.1 3.1a.75.75 0 0 1 1.06 0l1.77 1.77a.75.75 0 0 1-1.06 1.06L3.1 4.16a.75.75 0 0 1 0-1.06Zm9.8 0a.75.75 0 0 1 0 1.06l-1.77 1.77a.75.75 0 1 1-1.06-1.06l1.77-1.77a.75.75 0 0 1 1.06 0ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1 8a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 1 8Zm10 0a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 11 8Z"/></svg>} onClick={() => postMessage({ type: 'alignWorktree', sessionId: task.id })} title={`Align worktree from ${selectedBaseBranch || 'main'} with AI`}>
                  Align from {selectedBaseBranch || 'main'}
                </FlatButton>
                {isCompleteOrDone && (
                  <FlatButton variant="secondary" fullWidth className="fv-agent-merge" icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a2.25 2.25 0 1 1 4.5 0A2.25 2.25 0 0 1 8 5.37V7h2.75A2.25 2.25 0 0 1 13 9.25v.38a2.25 2.25 0 1 1-1.5 0v-.38a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v.38a2.25 2.25 0 1 1-1.5 0v-.38A2.25 2.25 0 0 1 5.25 7H8V5.37A2.25 2.25 0 0 1 5 3.25Z"/></svg>} onClick={() => {
                    const providerId = task.copilotSession?.providerId ?? '';
                    postMessage({ type: 'agentMerge', sessionId: task.id, mergeStrategy: 'squash', providerId });
                  }} title="Launch AI to review and merge">
                    Merge to {selectedBaseBranch || 'main'}
                  </FlatButton>
                )}
              </div>
            )}
            {isCompleteOrDone && (
              <>
                {(repoIsGitHub || repoIsAzureDevOps) && !sessionInfo?.prUrl && (
                  <FlatButton variant="primary" fullWidth icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073 9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25ZM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5Zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>} onClick={() => postMessage({ type: 'createPullRequest', sessionId: task.id })} title={`Create a Pull Request on ${repoIsGitHub ? 'GitHub' : 'Azure DevOps'}`}>
                    Create Pull Request
                  </FlatButton>
                )}
                {sessionInfo?.prUrl && (
                  <a className="flat-btn flat-btn--primary flat-btn--block" href={sessionInfo.prUrl} title={`Open Pull Request${sessionInfo.prNumber ? ` #${sessionInfo.prNumber}` : ''}`}>
                    <span className="flat-btn__icon"><svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073 9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25ZM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5Zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg></span>
                    {sessionInfo.prNumber ? `Open PR #${sessionInfo.prNumber}` : 'Open PR'}
                  </a>
                )}
                <MergePanel taskId={task.id} targetBranch={selectedBaseBranch || 'main'} />
              </>
            )}
          </>
        )
      ) : (
        <div className="fv-actions__empty">No worktree — actions require a worktree session.</div>
      )}
    </div>
  );
}

function MergePanel({ taskId, targetBranch }: { taskId: string; targetBranch: string }) {
  const selectRef = useRef<HTMLSelectElement>(null);

  return (
    <div className="fv-merge-panel">
      <label className="fv-merge-panel__label">Manual merge</label>
      <div className="fv-merge-panel__target">
        <span className="fv-merge-panel__target-label">Into:</span>
        <code className="fv-merge-panel__target-branch">{targetBranch}</code>
      </div>
      <select className="fv-merge-select" ref={selectRef} defaultValue="squash">
        <option value="squash">Squash and merge</option>
        <option value="merge">Create a merge commit</option>
        <option value="rebase">Rebase and merge</option>
      </select>
      <FlatButton variant="primary" fullWidth icon={<svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a2.25 2.25 0 1 1 4.5 0A2.25 2.25 0 0 1 8 5.37V7h2.75A2.25 2.25 0 0 1 13 9.25v.38a2.25 2.25 0 1 1-1.5 0v-.38a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v.38a2.25 2.25 0 1 1-1.5 0v-.38A2.25 2.25 0 0 1 5.25 7H8V5.37A2.25 2.25 0 0 1 5 3.25Z"/></svg>} onClick={() => {
        const strategy = (selectRef.current?.value ?? 'squash') as 'squash' | 'merge' | 'rebase';
        postMessage({ type: 'mergeWorktree', sessionId: taskId, mergeStrategy: strategy });
      }}>
        Merge
      </FlatButton>
    </div>
  );
}
