import React from 'react';
import { useBoard } from '../context/BoardContext';
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
  const bgStyle = column.color ? { background: `${column.color}0D` } : undefined;
  const headerStyle = column.color ? { background: `${column.color}1A` } : undefined;
  const countStyle = column.color ? { background: `${column.color}33`, color: column.color } : undefined;
  const isDone = column.id === 'done';

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      postMessage({ type: 'taskMoved', taskId, toCol: column.id, index: 0 });
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
              <button className="kanban__col-btn kanban__col-btn--danger" title="Clean done tasks" onClick={() => postMessage({ type: 'cleanDone' })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1.5A.5.5 0 0 1 6 1h4a.5.5 0 0 1 .5.5V3h3a.5.5 0 0 1 0 1h-.538l-.853 10.66A1 1 0 0 1 11.114 15H4.886a1 1 0 0 1-.995-.94L3.038 4H2.5a.5.5 0 0 1 0-1h3V1.5ZM6.5 2v1h3V2h-3Zm-2.457 2 .826 10h6.262l.826-10H4.043Z"/></svg>
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
