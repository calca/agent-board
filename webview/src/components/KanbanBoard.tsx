import React from 'react';
import { useBoard } from '../context/BoardContext';
import { DataProvider } from '../DataProvider';
import { postMessage } from '../hooks/useVsCodeApi';
import type { Column, KanbanTask } from '../types';
import { TaskCard } from './TaskCard';

export function KanbanBoard() {
  const { state } = useBoard();
  const { tasks, columns, searchText } = state;

  const filtered = tasks.filter(t => {
    if (!searchText) { return true; }
    const q = searchText.toLowerCase();
    return t.title.toLowerCase().includes(q)
      || t.labels.some(l => l.toLowerCase().includes(q))
      || (t.assignee?.toLowerCase().includes(q) ?? false);
  });

  return (
    <div className="kanban">
      {columns.map(col => (
        <KanbanColumn key={col.id} column={col} tasks={filtered.filter(t => t.status === col.id)} />
      ))}
    </div>
  );
}

function KanbanColumn({ column, tasks }: { column: Column; tasks: KanbanTask[] }) {
  const { dispatch } = useBoard();
  const bgStyle = column.color ? { background: `${column.color}0D` } : undefined;
  const headerStyle = column.color ? { background: `${column.color}1A` } : undefined;
  const countStyle = column.color ? { background: `${column.color}33`, color: column.color } : undefined;
  const isDone = column.id === 'done';

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      DataProvider.updateTaskStatus(taskId, column.id).catch(err => console.error('Error updating task status:', err));
    }
  }

  return (
    <div className="kanban__column" style={bgStyle}>
      <div className="kanban__column-header" style={headerStyle}>
        <span>{column.label}</span>
        <span className="kanban__column-header-right">
          {isDone && tasks.length > 0 && (
            <span className="kanban__column-actions" style={column.color ? { '--col-btn-color': column.color } as React.CSSProperties : undefined}>
              <button className="kanban__col-btn" title="Export to Markdown" onClick={() => postMessage({ type: 'exportDoneMd' })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.586a1.5 1.5 0 0 1 1.06.44l3.415 3.414A1.5 1.5 0 0 1 14 6.914V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7H9.5A1.5 1.5 0 0 1 8 5.5V3H3.5ZM9 3.207V5.5a.5.5 0 0 0 .5.5h2.293L9 3.207ZM6 8.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2Z"/></svg>
              </button>
              <button className="kanban__col-btn" title="Hide done tasks" onClick={() => dispatch({ type: 'SHOW_CLEAN_CONFIRM' })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8a13 13 0 0 1-1.516 1.985l1.047 1.047ZM11.297 9.176A3.5 3.5 0 0 0 6.823 4.703l.89.89a2.5 2.5 0 0 1 2.693 2.693l.89.89Zm-2.218 1.456-.891-.891A2.5 2.5 0 0 1 5.379 7.06l-.891-.891A3.5 3.5 0 0 0 9.08 10.632ZM2.641 4.762A13 13 0 0 0 1.172 8a13 13 0 0 0 1.517 1.985C4.12 11.332 5.88 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.94-1.72 2.641-3.238ZM14.354 14.354l-12-12 .707-.708 12 12-.707.708Z"/></svg>
              </button>
            </span>
          )}
          <span className="kanban__column-count" style={countStyle}>{tasks.length}</span>
        </span>
      </div>
      <div className="kanban__column-body" data-col-id={column.id} onDragOver={handleDragOver} onDrop={handleDrop}>
        {tasks.length === 0
          ? <div className="kanban__placeholder">No tasks</div>
          : tasks.map(t => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  );
}