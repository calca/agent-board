import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';
import { transport } from '../transport';
import { FlatButton } from './FlatButton';
import { MarkdownBody } from './MarkdownBody';
import { MarkdownEditor, type MDXEditorMethods } from './MarkdownEditor';

/** Normalize MDXEditor output: strip invisible chars and consider truly empty. */
function normalizeMd(raw: string): string {
  return raw.replace(/[\u200b\u00a0]/g, '').replace(/^\s+$/, '').trim();
}

export function TaskForm() {
  const { state, dispatch } = useBoard();
  const { showTaskForm, editingTask, columns, formColumns, editableProviderIds, genAiProviders, currentUser } = state;
  const bodyRef = useRef<MDXEditorMethods>(null);
  const notesRef = useRef<MDXEditorMethods>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const notesTouched = useRef(false);

  const isEdit = !!editingTask;
  const task = editingTask;
  const savedNotes = isEdit ? ((task?.meta as Record<string, unknown>)?.localNotes as string | undefined) : undefined;

  // Reset notesOpen when task changes — always start closed
  useEffect(() => {
    setNotesOpen(false);
    notesTouched.current = false;
  }, [task?.id]);
  const cols = formColumns.length > 0 ? formColumns : columns;
  const remoteProviders = ['github', 'azure-devops', 'beads'];
  const isRemote = task ? remoteProviders.includes(task.providerId) : false;

  const handleClose = useCallback(() => {
    // Flush any pending local notes before closing
    if (task && isRemote && notesTouched.current) {
      const md = notesOpen && notesRef.current
        ? normalizeMd(notesRef.current.getMarkdown())
        : '';
      postMessage({ type: 'saveLocalNotes', taskId: task.id, providerId: task.providerId, notes: md });
    }
    dispatch({ type: 'CLOSE_TASK_FORM' });
  }, [task, isRemote, notesOpen, dispatch]);
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).id === 'task-form-overlay') { handleClose(); }
  }, [handleClose]);

  const handleDelete = useCallback(() => {
    if (task) {
      transport.send({ type: 'deleteTask', taskId: task.id, providerId: task.providerId });
      dispatch({ type: 'CLOSE_TASK_FORM' });
      dispatch({ type: 'CLOSE_FULL_VIEW' });
    }
  }, [task, dispatch]);

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;

    // Flush any pending local notes before closing
    if (task && isRemote && notesTouched.current) {
      const md = notesOpen && notesRef.current
        ? normalizeMd(notesRef.current.getMarkdown())
        : '';
      postMessage({ type: 'saveLocalNotes', taskId: task.id, providerId: task.providerId, notes: md });
    }

    const titleEl = form.querySelector('#tf-title') as HTMLInputElement | null;
    const labelsEl = form.querySelector('#tf-labels') as HTMLInputElement | null;
    const assigneeEl = form.querySelector('#tf-assignee') as HTMLInputElement | null;

    const title = titleEl?.value.trim() ?? task?.title ?? '';
    if (!title) { return; }
    const body = bodyRef.current?.getMarkdown().trim() ?? task?.body ?? '';
    const status = task
      ? (form.querySelector('#tf-status') as HTMLSelectElement)?.value ?? cols[0]?.id ?? 'todo'
      : cols[0]?.id ?? 'todo';
    const labels = labelsEl?.value.trim() ?? task?.labels.join(', ') ?? '';
    const assignee = assigneeEl?.value.trim() ?? task?.assignee ?? '';

    if (task) {
      if (isRemote) {
        transport.send({ type: 'editTask', taskId: task.id, providerId: task.providerId, data: { title: task.title, body: task.body, status, labels: task.labels.join(', '), assignee: task.assignee ?? '' } });
      } else {
        transport.send({ type: 'editTask', taskId: task.id, providerId: task.providerId, data: { title, body, status, labels, assignee } });
      }
    } else {
      transport.send({ type: 'saveTask', data: { title, body, status, labels, assignee } });
    }
    dispatch({ type: 'CLOSE_TASK_FORM' });
  }, [task, cols, isRemote, notesOpen, dispatch]);

  if (!showTaskForm && !editingTask) { return null; }

  return (
    <div className="task-form-overlay" id="task-form-overlay" onClick={handleOverlayClick}>
      <div className="task-form-panel">
        <FlatButton variant="icon" icon="✕" className="task-form-panel__close" onClick={handleClose} title="Close" />
        <div className="task-form-panel__heading">
          {isEdit
            ? <>Edit Issue{savedNotes && <span className="task-card__details-icon" title="Has technical notes" style={{ marginLeft: 8 }}><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg></span>}{isRemote && <span style={{ opacity: 0.45, fontSize: '0.75em', fontWeight: 400, marginLeft: 8 }}>(remote — read-only fields)</span>}</>
            : 'New Issue'}
        </div>
        <form id="task-form" className="task-form" onSubmit={handleSubmit}>
          <div className="task-form__section">
            <label className="task-form__label">{isRemote ? 'Title' : 'Title *'}</label>
            {isEdit && isRemote
              ? <span className="task-form__readonly-value">{task!.title}</span>
              : <input className="task-form__input" id="tf-title" type="text" defaultValue={task?.title ?? ''} required autoFocus={!isEdit} placeholder={isEdit ? undefined : 'What needs to be done?'} />}
          </div>

          <div className={`task-form__section ${isEdit && isRemote && notesOpen ? 'task-form__section--desc-third' : 'task-form__section--grow'}`}>
            <label className="task-form__label">Description</label>
            <div className="task-form__desc-group">
              {isEdit && isRemote
                ? <MarkdownBody body={task!.body || ''} className="task-form__readonly-body" />
                : <MarkdownEditor
                    ref={bodyRef}
                    editorKey={task?.id ?? 'new'}
                    markdown={task?.body ?? ''}
                    placeholder="Describe the task in detail — the agent will use this as instructions…"
                  />}
            </div>
          </div>

          {isEdit && isRemote && (notesOpen ? (
              <div className="task-form__section task-form__section--grow task-form__local-notes-inline">
                <div className="task-form__local-notes-header">
                  <label className="task-form__label"><svg className="task-form__notes-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg> Technical Notes</label>
                  <FlatButton type="button" variant="icon" icon="−" onClick={() => {
                    if (task && notesRef.current) {
                      const md = normalizeMd(notesRef.current.getMarkdown());
                      postMessage({ type: 'saveLocalNotes', taskId: task.id, providerId: task.providerId, notes: md });
                    }
                    setNotesOpen(false);
                  }} title="Close technical notes" />
                </div>
                <div className="task-form__desc-group">
                  <MarkdownEditor
                    ref={notesRef}
                    editorKey={`tf-notes-${task!.id}`}
                    markdown={savedNotes ?? ''}
                    placeholder="Add technical notes to enrich this task…"
                  />
                </div>
              </div>
            ) : (
              <div className="task-form__section task-form__local-notes">
                <FlatButton type="button" variant="ghost" className="task-form__local-notes-cta" onClick={() => { notesTouched.current = true; setNotesOpen(true); }} icon={savedNotes
                    ? <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg>
                    : <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg>
                  }>{savedNotes ? 'Technical Notes' : '+ Technical Notes'}</FlatButton>
              </div>
            ))}

          <div className="task-form__row">
            <div className="task-form__field">
              <label className="task-form__label" htmlFor="tf-status">Status</label>
              {isEdit
                ? <select className="task-form__select" id="tf-status" defaultValue={task!.status}>
                    {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                : <input className="task-form__input" id="tf-status" type="text" value={cols[0]?.label ?? ''} disabled />}
            </div>
            {isEdit && isRemote && !!task?.meta?.remoteStatus && (
              <div className="task-form__field">
                <label className="task-form__label">Remote Status</label>
                <span className="task-form__readonly-value task-form__readonly-value--badge">{String(task.meta.remoteStatus)}</span>
              </div>
            )}
            <div className="task-form__field">
              <label className="task-form__label" htmlFor={isRemote ? undefined : 'tf-labels'}>Labels</label>
              {isEdit && isRemote
                ? (task!.labels.length > 0
                    ? <span className="task-form__label-pills">{task!.labels.map(l => <span key={l} className="task-form__label-pill">{l}</span>)}</span>
                    : <span className="task-form__readonly-value task-form__readonly-value--muted">—</span>)
                : <input className="task-form__input" id="tf-labels" type="text" defaultValue={task?.labels.join(', ') ?? ''} placeholder="bug, feature" />}
            </div>
            <div className="task-form__field">
              <label className="task-form__label">Assignee</label>
              {isEdit && isRemote
                ? (task!.assignee
                    ? <span className="task-form__assignee-value">{task!.assignee}</span>
                    : <span className="task-form__readonly-value task-form__readonly-value--muted">—</span>)
                : !isEdit
                  ? <input className="task-form__input task-form__input--readonly" id="tf-assignee" type="text" value={currentUser || 'me'} readOnly />
                  : <input className="task-form__input task-form__input--readonly" id="tf-assignee" type="text" value={task?.assignee ?? (currentUser || 'me')} readOnly />}
            </div>
          </div>

          <div className="task-form__actions">
            <FlatButton type="submit" variant="primary">
              {isRemote ? 'Update Status' : 'Save'}
            </FlatButton>
            <FlatButton type="button" variant="secondary" onClick={handleClose}>
              {isEdit ? 'Close' : 'Cancel'}
            </FlatButton>
            {isEdit && !isRemote && editableProviderIds.includes(task!.providerId) && (
              <FlatButton type="button" variant="danger" icon="⊘" onClick={handleDelete} style={{ marginLeft: 'auto' }}>
                Delete
              </FlatButton>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

