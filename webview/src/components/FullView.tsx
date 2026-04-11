import React, { useCallback, useEffect, useRef } from 'react';
import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';
import type { Column, KanbanTask } from '../types';
import { relativeWorktreePath } from '../utils';
import { MarkdownBody } from './MarkdownBody';

const statusIcons: Record<string, string> = { added: '＋', modified: '✎', deleted: '✕' };
const logSourceIcons: Record<string, string> = { board: '☰', agent: '◆', tool: '⚙', system: 'ⓘ' };

export function FullView() {
  const { state, dispatch, imp } = useBoard();
  const { fullViewTaskId, tasks, columns, genAiProviders, logExpanded, repoIsGit, repoIsGitHub, repoIsAzureDevOps, workspaceRoot } = state;
  const logScrollRef = useRef<HTMLDivElement>(null);

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
          <button className="fv-topbar__back" title="Back" onClick={handleClose}>←</button>
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

      {/* ROW 1 */}
      <div className={`fv-row fv-row--top${logExpanded ? ' fv-row--hidden' : ''}`}>
        {/* Task Details */}
        <div className="fv-col">
          <div className="fv-panel fv-panel--fill" style={statusCol?.color ? { background: `${statusCol.color}0D` } : undefined}>
            <div className="fv-panel__header fv-panel__header--static" style={statusCol?.color ? { background: `${statusCol.color}1A` } : undefined}>
              <span className="fv-panel__header-text">☰ Issue Details</span>
              <button className="fv-panel__header-btn" title="Edit" onClick={() => dispatch({ type: 'SET_EDITING_TASK', task })}>✎</button>
            </div>
            <div className="fv-panel__body fv-panel__body--scroll">
              <FvReadOnlyDetails task={task} statusCol={statusCol} columns={columns} />
            </div>
          </div>
        </div>

        {/* Session */}
        <div className="fv-col">
          <div className="fv-panel fv-panel--fill" style={{ background: '#9b59b60D' }}>
            <div className="fv-panel__header fv-panel__header--static" style={{ background: '#9b59b61A' }}>
              <span className="fv-panel__header-text">⊙ Session</span>
            </div>
            <div className="fv-panel__body fv-panel__body--scroll">
              {sessionInfo || hasWorktree
                ? <FvSessionPanel sessionInfo={sessionInfo} task={task} isMerged={isMerged} workspaceRoot={workspaceRoot} />
                : <div className="fv-empty-hint">No session started</div>}
            </div>
          </div>
        </div>

        {/* Files */}
        <div className="fv-col">
          <div className="fv-panel fv-panel--fill" style={{ background: '#3498db0D' }}>
            <div className="fv-panel__header fv-panel__header--static" style={{ background: '#3498db1A' }}>
              <span className="fv-panel__header-text">⊞ Files</span>
              {files.length > 0 && <span className="fv-panel__badge">{files.length}</span>}
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

        {/* Actions */}
        <div className="fv-col">
          <div className="fv-panel fv-panel--fill" style={{ background: '#e67e220D' }}>
            <div className="fv-panel__header fv-panel__header--static" style={{ background: '#e67e221A' }}>
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
                repoIsGitHub={repoIsGitHub}
                repoIsAzureDevOps={repoIsAzureDevOps}
                columns={columns}
                dispatch={dispatch}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2: Activity Log */}
      <div className={`fv-row fv-row--bottom${logExpanded ? ' fv-row--expanded' : ''}`}>
        <div className="fv-panel fv-panel--fill" style={{ background: '#8888880D' }}>
          <div className="fv-panel__header fv-panel__header--static fv-log-panel-header" style={{ background: '#8888881A' }}>
            <span className="fv-panel__header-text">≡ Activity Log</span>
            <span className="fv-panel__badge">{logs.length}</span>
            <button className="fv-panel__header-btn" title={logExpanded ? 'Collapse' : 'Expand'} onClick={() => dispatch({ type: 'TOGGLE_LOG_EXPANDED' })}>
              {logExpanded ? '⊖' : '⊕'}
            </button>
          </div>
          <div className="fv-panel__body fv-panel__body--log">
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
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function FvReadOnlyDetails({ task, statusCol, columns }: { task: KanbanTask; statusCol: Column | undefined; columns: Column[] }) {
  const statusColor = statusCol?.color ?? '';

  return (
    <>
      <div className="fv-detail-grid">
        <div className="fv-detail-row fv-detail-row--status">
          <span className="fv-detail-label">
            {statusColor && <span className="fv-status-dot" style={{ background: `${statusColor}1A` }} />}
            {' '}Status
          </span>
          <select
            className="task-form__select fv-status-select"
            defaultValue={task.status}
            onChange={e => postMessage({ type: 'taskMoved', taskId: task.id, toCol: e.target.value, index: 0 })}
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
        {task.assignee && (
          <div className="fv-detail-row">
            <span className="fv-detail-label">Assignee</span>
            <span>{task.assignee}</span>
          </div>
        )}
        {task.agent && (
          <div className="fv-detail-row">
            <span className="fv-detail-label">Agent</span>
            <span>◆ {task.agent}</span>
          </div>
        )}
      </div>
      {task.body && (
        <MarkdownBody body={task.body} className="fv-description" snippet />
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

function FvActions({ task, sessionInfo, isRunning, isMerged, hasWorktree, activeProviderId, genAiProviders, repoIsGitHub, repoIsAzureDevOps, columns, dispatch }: {
  task: KanbanTask;
  sessionInfo: KanbanTask['copilotSession'];
  isRunning: boolean;
  isMerged: boolean;
  hasWorktree: boolean;
  activeProviderId: string | undefined;
  genAiProviders: { id: string; displayName: string; disabled?: boolean }[];
  repoIsGitHub: boolean;
  repoIsAzureDevOps: boolean;
  columns: Column[];
  dispatch: React.Dispatch<any>;
}) {
  const isCompleteOrDone = sessionInfo?.state === 'completed' || task.status === 'done';

  return (
    <div className="fv-actions">
      {sessionInfo && !isRunning && (
        <>
          <button className="fv-action-btn fv-reset-session" onClick={() => {
            postMessage({ type: 'resetSession', sessionId: task.id });
            dispatch({ type: 'SET_EDITING_TASK', task: null });
            dispatch({ type: 'CLOSE_FULL_VIEW' });
          }} title="Reset session and move task back to first column">
            <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.563 2.063A6 6 0 0 1 14 8h-1.5A4.5 4.5 0 1 0 8 12.5v1.5A6 6 0 0 1 5.563 2.063Z"/><path d="M14 4v4h-4l1.5-1.5L10 5l2.5-1L14 4Z"/></svg>
            {' '}Reset
          </button>
          <hr className="fv-actions__separator" />
        </>
      )}

      {isRunning ? (
        <>
          <div className="fv-actions__running-provider">
            <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11ZM7 5v4.5l3.5 2 .75-1.25L8.5 8.5V5H7Z"/></svg>
            {' '}{genAiProviders.find(p => p.id === activeProviderId)?.displayName ?? activeProviderId ?? 'Agent'}
          </div>
          <button className="fv-action-btn fv-action-btn--danger" onClick={() => postMessage({ type: 'cancelSession', taskId: task.id })}>
            <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
            {' '}Stop
          </button>
          <hr className="fv-actions__separator" />
        </>
      ) : sessionInfo?.state !== 'completed' && !isMerged ? (
        <>
          <div className="fv-actions__providers">
            {genAiProviders.filter(p => !p.disabled).map(p => (
              <button key={p.id} className="fv-action-btn fv-launch-provider" onClick={() => postMessage({ type: 'launchProvider', taskId: task.id, genAiProviderId: p.id })} title={p.displayName}>
                <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5L12 8l-6 4.5v-9Z"/></svg>
                {' '}{p.displayName}
              </button>
            ))}
          </div>
          <hr className="fv-actions__separator" />
        </>
      ) : null}

      {hasWorktree ? (
        isMerged ? (
          <button className="fv-action-btn fv-action-btn--danger" onClick={() => postMessage({ type: 'deleteWorktree', sessionId: task.id })} title="Delete worktree directory and branch">
            <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1.5A.5.5 0 0 1 6 1h4a.5.5 0 0 1 .5.5V3h3a.5.5 0 0 1 0 1h-.538l-.853 10.66A1 1 0 0 1 11.114 15H4.886a1 1 0 0 1-.995-.94L3.038 4H2.5a.5.5 0 0 1 0-1h3V1.5ZM6.5 2v1h3V2h-3Zm-2.457 2 .826 10h6.262l.826-10H4.043Z"/></svg>
            {' '}Delete Workspace
          </button>
        ) : (
          <>
            <button className="fv-action-btn" onClick={() => postMessage({ type: 'openWorktree', worktreePath: sessionInfo!.worktreePath! })} title="Open worktree folder in VS Code">
              <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 2H14.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/></svg>
              {' '}Open in VS Code
            </button>
            {sessionInfo?.state === 'completed' && (
              <button className="fv-action-btn" onClick={() => postMessage({ type: 'reviewWorktree', sessionId: task.id })} title="Review changes vs main branch">
                <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.586a1.5 1.5 0 0 1 1.06.44l3.415 3.414A1.5 1.5 0 0 1 14 6.914V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7H9.5A1.5 1.5 0 0 1 8 5.5V3H3.5ZM9 3.207V5.5a.5.5 0 0 0 .5.5h2.293L9 3.207ZM6 8.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2Z"/></svg>
                {' '}Review Diff
              </button>
            )}
            {!isRunning && (
              <>
                <hr className="fv-actions__separator" />
                <button className="fv-action-btn" onClick={() => postMessage({ type: 'alignWorktree', sessionId: task.id })} title="Align worktree from main with AI">
                  <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 1ZM3.1 3.1a.75.75 0 0 1 1.06 0l1.77 1.77a.75.75 0 0 1-1.06 1.06L3.1 4.16a.75.75 0 0 1 0-1.06Zm9.8 0a.75.75 0 0 1 0 1.06l-1.77 1.77a.75.75 0 1 1-1.06-1.06l1.77-1.77a.75.75 0 0 1 1.06 0ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1 8a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 1 8Zm10 0a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 11 8Z"/></svg>
                  {' '}Align from main with AI
                </button>
              </>
            )}
            {isCompleteOrDone && (
              <>
                {(repoIsGitHub || repoIsAzureDevOps) && !sessionInfo?.prUrl && (
                  <button className="fv-action-btn fv-action-btn--primary" onClick={() => postMessage({ type: 'createPullRequest', sessionId: task.id })} title={`Create a Pull Request on ${repoIsGitHub ? 'GitHub' : 'Azure DevOps'}`}>
                    <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073 9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25ZM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5Zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>
                    {' '}Create Pull Request
                  </button>
                )}
                {sessionInfo?.prUrl && (
                  <a className="fv-action-btn fv-action-btn--primary" href={sessionInfo.prUrl} title={`Open Pull Request${sessionInfo.prNumber ? ` #${sessionInfo.prNumber}` : ''}`}>
                    <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073 9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25ZM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5Zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>
                    {' '}{sessionInfo.prNumber ? `Open PR #${sessionInfo.prNumber}` : 'Open PR'}
                  </a>
                )}
                <hr className="fv-actions__separator" />
                <button className="fv-action-btn" onClick={() => {
                  const providerId = task.copilotSession?.providerId ?? '';
                  postMessage({ type: 'agentMerge', sessionId: task.id, mergeStrategy: 'squash', providerId });
                }} title="Launch AI to review and merge">
                  <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a2.25 2.25 0 1 1 4.5 0A2.25 2.25 0 0 1 8 5.37V7h2.75A2.25 2.25 0 0 1 13 9.25v.38a2.25 2.25 0 1 1-1.5 0v-.38a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v.38a2.25 2.25 0 1 1-1.5 0v-.38A2.25 2.25 0 0 1 5.25 7H8V5.37A2.25 2.25 0 0 1 5 3.25Z"/></svg>
                  {' '}Merge to main with AI
                </button>
                <hr className="fv-actions__separator" />
                <MergePanel taskId={task.id} />
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

function MergePanel({ taskId }: { taskId: string }) {
  const selectRef = useRef<HTMLSelectElement>(null);

  return (
    <div className="fv-merge-panel">
      <label className="fv-merge-panel__label">Manual merge</label>
      <select className="fv-merge-select" ref={selectRef} defaultValue="squash">
        <option value="squash">Squash and merge</option>
        <option value="merge">Create a merge commit</option>
        <option value="rebase">Rebase and merge</option>
      </select>
      <button className="fv-action-btn fv-action-btn--primary" onClick={() => {
        const strategy = (selectRef.current?.value ?? 'squash') as 'squash' | 'merge' | 'rebase';
        postMessage({ type: 'mergeWorktree', sessionId: taskId, mergeStrategy: strategy });
      }}>
        <svg className="fv-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a2.25 2.25 0 1 1 4.5 0A2.25 2.25 0 0 1 8 5.37V7h2.75A2.25 2.25 0 0 1 13 9.25v.38a2.25 2.25 0 1 1-1.5 0v-.38a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v.38a2.25 2.25 0 1 1-1.5 0v-.38A2.25 2.25 0 0 1 5.25 7H8V5.37A2.25 2.25 0 0 1 5 3.25Z"/></svg>
        {' '}Merge
      </button>
    </div>
  );
}
