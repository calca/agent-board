import React, { useCallback, useRef } from 'react';
import { useBoard } from '../context/BoardContext';
import { transport } from '../transport';
import { MarkdownBody } from './MarkdownBody';
import { MarkdownEditor, type MDXEditorMethods } from './MarkdownEditor';

export function TaskForm() {
  const { state, dispatch } = useBoard();
  const { showTaskForm, editingTask, columns, formColumns, editableProviderIds, genAiProviders, currentUser } = state;
  const bodyRef = useRef<MDXEditorMethods>(null);

  const isEdit = !!editingTask;
  const task = editingTask;
  const cols = formColumns.length > 0 ? formColumns : columns;
  const remoteProviders = ['github', 'azure-devops', 'beads'];
  const isRemote = task ? remoteProviders.includes(task.providerId) : false;

  const handleClose = useCallback(() => dispatch({ type: 'CLOSE_TASK_FORM' }), [dispatch]);
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).id === 'task-form-overlay') { dispatch({ type: 'CLOSE_TASK_FORM' }); }
  }, [dispatch]);

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
  }, [task, cols, isRemote, dispatch]);

  if (!showTaskForm && !editingTask) { return null; }

  return (
    <div className="task-form-overlay" id="task-form-overlay" onClick={handleOverlayClick}>
      <div className="task-form-panel">
        <button className="task-form-panel__close" onClick={handleClose} title="Close">✕</button>
        <div className="task-form-panel__heading">
          {isEdit
            ? <>Edit Issue{isRemote && <span style={{ opacity: 0.45, fontSize: '0.75em', fontWeight: 400, marginLeft: 8 }}>(remote — read-only fields)</span>}</>
            : 'New Issue'}
        </div>
        <form id="task-form" className="task-form" onSubmit={handleSubmit}>
          <div className="task-form__section">
            <label className="task-form__label">{isRemote ? 'Title' : 'Title *'}</label>
            {isEdit && isRemote
              ? <span className="task-form__readonly-value">{task!.title}</span>
              : <input className="task-form__input" id="tf-title" type="text" defaultValue={task?.title ?? ''} required autoFocus={!isEdit} placeholder={isEdit ? undefined : 'What needs to be done?'} />}
          </div>

          <div className="task-form__section task-form__section--grow">
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
            <button type="submit" className="task-form__btn task-form__btn--save">{isRemote ? 'Update Status' : 'Save'}</button>
            <button type="button" className="task-form__btn task-form__btn--cancel" onClick={handleClose}>
              {isEdit ? 'Close' : 'Cancel'}
            </button>
            {isEdit && !isRemote && editableProviderIds.includes(task!.providerId) && (
              <button type="button" className="task-form__btn task-form__btn--delete" onClick={handleDelete}>
                ⊘ Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

