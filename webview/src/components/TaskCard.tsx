import React, { useCallback } from 'react';
import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';
import type { KanbanTask } from '../types';
import { FlatButton } from './FlatButton';
import { MarkdownBody } from './MarkdownBody';

const SESSION_LABELS: Record<string, string> = {
  idle: 'Idle', starting: 'Starting', running: 'Running',
  paused: 'Paused', completed: 'Completed', error: 'Error', interrupted: 'Interrupted',
};

const priorityMap: Record<string, { icon: string; cls: string }> = {
  critical: { icon: '⬆⬆', cls: 'critical' },
  high:     { icon: '⬆', cls: 'high' },
  medium:   { icon: '⬍', cls: 'medium' },
  low:      { icon: '⬇', cls: 'low' },
};

export function TaskCard({ task }: { task: KanbanTask }) {
  const { state, dispatch, imp } = useBoard();
  const { columns } = state;
  const session = task.copilotSession;
  const cardMerged = imp.current.mergedSessions.has(task.id);
  const isActive = session?.state === 'running' || session?.state === 'starting';
  const tcs = imp.current.toolCallStatus.get(task.id);
  const stateModifier = session ? ` task-card--state-${session.state}` : '';
  const movedKind = imp.current.recentlyMovedTaskKinds.get(task.id) ?? 'generic';
  const movedModifier = imp.current.recentlyMovedTaskIds.has(task.id) ? ` task-card--moved task-card--moved-${movedKind}` : '';
  const newModifier = (!imp.current.recentlyMovedTaskIds.has(task.id) && imp.current.recentlyNewTaskIds.has(task.id)) ? ' task-card--new' : '';

  const initials = task.assignee ? task.assignee.slice(0, 2).toUpperCase() : '';
  const avatarUrl = (task.meta as Record<string, unknown>)?.avatarUrl as string | undefined;
  const shortId = `${task.providerId}-${task.nativeId}`.toUpperCase();

  // Local notes indicator
  const hasDetails = !!(task.meta as Record<string, unknown>)?.localNotes;

  // Body snippet
  const hasBody = !!task.body;

  // Priority + visible labels
  let priorityHtml: React.ReactNode = null;
  const visibleLabels: string[] = [];
  for (const l of task.labels) {
    if (l.startsWith('kanban:')) { continue; }
    const key = l.toLowerCase().replace(/^priority[:/]/, '');
    if (priorityMap[key]) {
      priorityHtml = (
        <span className={`task-card__priority task-card__priority--${priorityMap[key].cls}`}>
          {priorityMap[key].icon} {l.replace(/^priority[:/]/i, '')}
        </span>
      );
    } else {
      visibleLabels.push(l);
    }
  }

  const sessionBadge = session && !cardMerged
    ? <span className={`task-card__session task-card__session--${session.state}`}>{SESSION_LABELS[session.state] ?? session.state}</span>
    : null;

  const prBadge = session?.prUrl
    ? <a className={`task-card__pr-badge task-card__pr-badge--${session.prState ?? 'open'}`} href={session.prUrl} title={`PR #${session.prNumber ?? ''}: ${session.prState ?? 'open'}`}>⤴ PR{session.prNumber ? ` #${session.prNumber}` : ''}</a>
    : null;

  const toolCallBadge = tcs && isActive
    ? <div className="task-card__tool-status" title={tcs}>⚙ {tcs}</div>
    : null;

  const assigneeEl = avatarUrl
    ? <img className="task-card__avatar" src={avatarUrl} alt={task.assignee ?? ''} title={task.assignee ?? ''} />
    : initials ? <span className="task-card__assignee" title={task.assignee ?? ''}>{initials}</span> : null;

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    (e.currentTarget as HTMLElement).classList.add('task-card--dragging');
  }, [task.id]);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('task-card--dragging');
  }, []);

  const handleClick = useCallback(() => {
    dispatch({ type: 'OPEN_FULL_VIEW', taskId: task.id });
    postMessage({ type: 'requestStreamResume', sessionId: task.id });
    postMessage({ type: 'requestFileChanges', sessionId: task.id });
  }, [dispatch, task.id]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }, [handleClick]);

  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'SET_EDITING_TASK', task });
  }, [dispatch, task]);

  const lastColId = columns[columns.length - 1]?.id;
  const isDone = task.status === lastColId;

  const handleHide = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    postMessage({ type: 'hideTask', taskId: task.id });
  }, [task.id]);

  return (
    <div
      className={`task-card${stateModifier}${movedModifier}${newModifier}`}
      data-task-id={task.id}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="task-card__header">
        <span className="task-card__id">{shortId}</span>
        <div className="task-card__badges">
          {sessionBadge}
          {cardMerged && <span className="task-card__session task-card__session--merged">Merged</span>}
          {prBadge}
        </div>
      </div>
      <div className="task-card__title">{task.title}</div>
      {hasBody && <MarkdownBody body={task.body} className="task-card__body" snippet />}
      {toolCallBadge}
      <div className="task-card__footer">
        <div className="task-card__footer-left">
          {assigneeEl}
          {priorityHtml}
          {hasDetails && (
            <span className="task-card__details-icon" title="Has technical notes">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg>
            </span>
          )}
        </div>
        <div className="task-card__footer-right">
          {visibleLabels.slice(0, 2).map(l => (
            <span key={l} className="task-card__label">{l}</span>
          ))}
          {isDone && (
            <FlatButton variant="icon" size="sm" data-task-id={task.id} title="Hide from board" onClick={handleHide} icon={
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8a13 13 0 0 1-1.516 1.985l1.047 1.047ZM11.297 9.176A3.5 3.5 0 0 0 6.823 4.703l.89.89a2.5 2.5 0 0 1 2.693 2.693l.89.89Zm-2.218 1.456-.891-.891A2.5 2.5 0 0 1 5.379 7.06l-.891-.891A3.5 3.5 0 0 0 9.08 10.632ZM2.641 4.762A13 13 0 0 0 1.172 8a13 13 0 0 0 1.517 1.985C4.12 11.332 5.88 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.94-1.72 2.641-3.238ZM14.354 14.354l-12-12 .707-.708 12 12-.707.708Z"/></svg>
            } />
          )}
          <FlatButton variant="icon" size="sm" data-task-id={task.id} title="Edit" onClick={handleEdit} icon="✎" />
        </div>
      </div>
    </div>
  );
}
