import React, { useCallback, useMemo, useState } from 'react';
import { useBoard } from '../context/BoardContext';
import { DataProvider } from '../DataProvider';
import { postMessage } from '../hooks/useVsCodeApi';
import type { Column, KanbanTask } from '../types';
import { FlatButton } from './FlatButton';
import { TaskCard } from './TaskCard';

export function KanbanBoard() {
  const { state } = useBoard();
  const { tasks, columns, searchText } = state;
  const [activeCol, setActiveCol] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Memoize filtered list — O(N) once instead of O(N*C)
  const filtered = useMemo(() => {
    if (!searchText) { return tasks; }
    const q = searchText.toLowerCase();
    return tasks.filter(t =>
      t.title.toLowerCase().includes(q)
      || t.labels.some(l => l.toLowerCase().includes(q))
      || (t.assignee?.toLowerCase().includes(q) ?? false)
    );
  }, [tasks, searchText]);

  // Pre-group tasks by column so each KanbanColumn gets O(1) access
  const tasksByCol = useMemo(() => {
    const map = new Map<string, KanbanTask[]>();
    for (const col of columns) { map.set(col.id, []); }
    for (const t of filtered) {
      const arr = map.get(t.status);
      if (arr) { arr.push(t); }
    }
    // Sort each column newest-first
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    }
    return map;
  }, [filtered, columns]);

  // Default to first column if none selected (mobile)
  const selectedCol = activeCol ?? columns[0]?.id ?? '';

  // Arrow-key navigation for mobile tab strip
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, colId: string) => {
    const idx = columns.findIndex(c => c.id === colId);
    if (e.key === 'ArrowRight' && idx < columns.length - 1) {
      setActiveCol(columns[idx + 1].id);
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      setActiveCol(columns[idx - 1].id);
    }
  }, [columns]);

  const handleMoveError = useCallback((msg: string) => {
    setMoveError(msg);
    const t = setTimeout(() => setMoveError(null), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="kanban-wrapper">
      {/* Error toast for failed card moves */}
      {moveError && (
        <div className="kanban__move-error" role="alert" aria-live="assertive">
          <span>⚠ {moveError}</span>
          <button className="kanban__move-error-close" onClick={() => setMoveError(null)} aria-label="Dismiss error">✕</button>
        </div>
      )}

      {/* Mobile column selector — hidden on desktop via CSS */}
      <div className="kanban-col-selector" role="tablist" aria-label="Board columns">
        {columns.map(col => (
          <button
            key={col.id}
            id={`kanban-tab-${col.id}`}
            role="tab"
            aria-selected={col.id === selectedCol}
            aria-controls={`kanban-panel-${col.id}`}
            className={`kanban-col-selector__tab${col.id === selectedCol ? ' kanban-col-selector__tab--active' : ''}`}
            style={col.color ? { '--tab-color': col.color } as React.CSSProperties : undefined}
            onClick={() => setActiveCol(col.id)}
            onKeyDown={e => handleTabKeyDown(e, col.id)}
          >
            <span className="kanban-col-selector__label">{col.label}</span>
            <span className="kanban-col-selector__count">{tasksByCol.get(col.id)?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="kanban">
        {columns.map(col => (
          <KanbanColumn
            key={col.id}
            column={col}
            tasks={tasksByCol.get(col.id) ?? []}
            allTasks={tasks}
            isActive={col.id === selectedCol}
            onMoveError={handleMoveError}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({ column, tasks, allTasks, isActive, onMoveError }: {
  column: Column;
  tasks: KanbanTask[];
  allTasks: KanbanTask[];
  isActive: boolean;
  onMoveError: (msg: string) => void;
}) {
  const { dispatch } = useBoard();
  const [isDragOver, setIsDragOver] = useState(false);

  const bgStyle = column.color ? { background: `${column.color}0D` } : undefined;
  const headerStyle = column.color ? { background: `${column.color}1A` } : undefined;
  const countStyle = column.color ? { background: `${column.color}33`, color: column.color } : undefined;
  const isDone = column.id === 'done';
  const hasDoneActions = isDone && tasks.length > 0;

  function handleDragEnter(e: React.DragEvent) { e.preventDefault(); setIsDragOver(true); }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDragLeave(e: React.DragEvent) {
    // Only clear when pointer leaves the column element itself (not its children)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) { return; }
    const task = allTasks.find(t => t.id === raw);
    if (task && task.status !== column.id) {
      DataProvider.updateTaskStatus(task.id, column.id, task.providerId)
        .catch(() => onMoveError(`Could not move "${task.title}" to ${column.label}. The board will resync shortly.`));
    }
  }

  const colClass = `kanban__column${isDragOver ? ' kanban__column--drag-over' : ''}`;
  const actionsStyle = column.color ? { '--col-btn-color': column.color } as React.CSSProperties : undefined;

  return (
    <div
      className={colClass}
      style={bgStyle}
      data-active={isActive ? 'true' : 'false'}
      id={`kanban-panel-${column.id}`}
      aria-label={column.label}
    >
      {/* Column header — on mobile, only shown when Done actions are present (via data-has-actions) */}
      <div className="kanban__column-header" style={headerStyle} data-has-actions={hasDoneActions ? 'true' : 'false'}>
        <span>{column.label}</span>
        <span className="kanban__column-header-right">
          {hasDoneActions && (
            <span className="kanban__column-actions" style={actionsStyle}>
              <FlatButton variant="icon" size="sm" title="Export done tasks to Markdown" onClick={() => postMessage({ type: 'exportDoneMd' })} icon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.586a1.5 1.5 0 0 1 1.06.44l3.415 3.414A1.5 1.5 0 0 1 14 6.914V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7H9.5A1.5 1.5 0 0 1 8 5.5V3H3.5ZM9 3.207V5.5a.5.5 0 0 0 .5.5h2.293L9 3.207ZM6 8.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2Z"/></svg>
              } />
              <FlatButton variant="icon" size="sm" title="Hide done tasks from board" onClick={() => dispatch({ type: 'SHOW_CLEAN_CONFIRM' })} icon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8a13 13 0 0 1-1.516 1.985l1.047 1.047ZM11.297 9.176A3.5 3.5 0 0 0 6.823 4.703l.89.89a2.5 2.5 0 0 1 2.693 2.693l.89.89Zm-2.218 1.456-.891-.891A2.5 2.5 0 0 1 5.379 7.06l-.891-.891A3.5 3.5 0 0 0 9.08 10.632ZM2.641 4.762A13 13 0 0 0 1.172 8a13 13 0 0 0 1.517 1.985C4.12 11.332 5.88 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.94-1.72 2.641-3.238ZM14.354 14.354l-12-12 .707-.708 12 12-.707.708Z"/></svg>
              } />
            </span>
          )}
          <span className="kanban__column-count" style={countStyle}>{tasks.length}</span>
        </span>
      </div>

      <div
        className="kanban__column-body"
        data-col-id={column.id}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {tasks.length === 0
          ? <div className="kanban__placeholder">No issues</div>
          : tasks.map(t => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  );
}