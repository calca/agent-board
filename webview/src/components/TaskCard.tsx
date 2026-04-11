import React, { useCallback } from 'react';
import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';
import type { KanbanTask } from '../types';

/** Convert inline markdown (bold, italic, code, strikethrough) to React nodes. */
function inlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Order matters: code first (literal), then bold, strikethrough, italic
  const re = /(`[^`]+`)|(?:\*\*(.+?)\*\*)|(?:~~(.+?)~~)|(?:\*(.+?)\*)|(?:_(.+?)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) { nodes.push(text.slice(last, m.index)); }
    if (m[1] != null) { nodes.push(<code key={key++}>{m[1].slice(1, -1)}</code>); }
    else if (m[2] != null) { nodes.push(<strong key={key++}>{m[2]}</strong>); }
    else if (m[3] != null) { nodes.push(<del key={key++}>{m[3]}</del>); }
    else if (m[4] != null) { nodes.push(<em key={key++}>{m[4]}</em>); }
    else if (m[5] != null) { nodes.push(<em key={key++}>{m[5]}</em>); }
    last = m.index + m[0].length;
  }
  if (last < text.length) { nodes.push(text.slice(last)); }
  return nodes;
}

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

  const initials = task.assignee ? task.assignee.slice(0, 2).toUpperCase() : '';
  const avatarUrl = (task.meta as Record<string, unknown>)?.avatarUrl as string | undefined;
  const shortId = task.id.includes(':') ? task.id.replace(':', '-').toUpperCase() : task.id;

  // Body snippet
  const isBodyHtml = task.body ? /<[a-z][\s\S]*>/i.test(task.body) : false;
  const plainBody = isBodyHtml ? task.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : task.body;
  const bodySnippet = plainBody ? plainBody.slice(0, 80).replace(/\n/g, ' ') + (plainBody.length > 80 ? '…' : '') : '';
  const bodyNodes = bodySnippet ? inlineMarkdown(bodySnippet) : null;

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

  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'SET_EDITING_TASK', task });
  }, [dispatch, task]);

  return (
    <div
      className={`task-card${stateModifier}`}
      data-task-id={task.id}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
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
      {bodyNodes && <div className="task-card__body">{bodyNodes}</div>}
      {toolCallBadge}
      <div className="task-card__footer">
        <div className="task-card__footer-left">
          {assigneeEl}
          {priorityHtml}
        </div>
        <div className="task-card__footer-right">
          {visibleLabels.slice(0, 2).map(l => (
            <span key={l} className="task-card__label">{l}</span>
          ))}
          <button className="task-card__edit-btn card-btn-edit" data-task-id={task.id} title="Edit" onClick={handleEdit}>✎</button>
        </div>
      </div>
    </div>
  );
}
