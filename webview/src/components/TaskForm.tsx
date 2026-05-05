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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
  );
  return Array.from(candidates).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null);
}

export function TaskForm() {
  const { state, dispatch } = useBoard();
  const { showTaskForm, editingTask, columns, formColumns, editableProviderIds, currentUser } = state;
  const bodyRef = useRef<MDXEditorMethods>(null);
  const notesRef = useRef<MDXEditorMethods>(null);
  const notesAutosaveTimerRef = useRef<number | null>(null);
  const notesSavedBadgeTimerRef = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesSaveState, setNotesSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const notesTouched = useRef(false);

  const isEdit = !!editingTask;
  const isOpen = showTaskForm || isEdit;
  const task = editingTask;
  const savedNotes = isEdit ? ((task?.meta as Record<string, unknown>)?.localNotes as string | undefined) : undefined;

  // Reset notesOpen when task changes — always start closed
  useEffect(() => {
    setNotesOpen(false);
    notesTouched.current = false;
    setNotesSaveState('idle');
  }, [task?.id]);
  const cols = formColumns.length > 0 ? formColumns : columns;
  const remoteProviders = ['github', 'azure-devops', 'beads'];
  const isRemote = task ? remoteProviders.includes(task.providerId) : false;

  const flushLocalNotes = useCallback(() => {
    if (!task || !isRemote || !notesTouched.current) { return; }
    const notes = normalizeMd(notesOpen && notesRef.current ? notesRef.current.getMarkdown() : savedNotes ?? '');
    setNotesSaveState('saving');
    postMessage({ type: 'saveLocalNotes', taskId: task.id, providerId: task.providerId, notes });
    notesTouched.current = false;

    if (notesSavedBadgeTimerRef.current) {
      window.clearTimeout(notesSavedBadgeTimerRef.current);
    }
    notesSavedBadgeTimerRef.current = window.setTimeout(() => {
      setNotesSaveState('saved');
      notesSavedBadgeTimerRef.current = window.setTimeout(() => {
        setNotesSaveState('idle');
      }, 1200);
    }, 150);
  }, [task, isRemote, notesOpen, savedNotes]);

  const queueNotesAutosave = useCallback(() => {
    if (!task || !isRemote || !notesOpen) { return; }
    notesTouched.current = true;
    setNotesSaveState('saving');
    if (notesAutosaveTimerRef.current) {
      window.clearTimeout(notesAutosaveTimerRef.current);
    }
    notesAutosaveTimerRef.current = window.setTimeout(() => {
      flushLocalNotes();
      notesAutosaveTimerRef.current = null;
    }, 700);
  }, [task, isRemote, notesOpen, flushLocalNotes]);

  useEffect(() => {
    return () => {
      if (notesAutosaveTimerRef.current) {
        window.clearTimeout(notesAutosaveTimerRef.current);
      }
      if (notesSavedBadgeTimerRef.current) {
        window.clearTimeout(notesSavedBadgeTimerRef.current);
      }
    };
  }, []);

  const requestClose = useCallback(() => {
    flushLocalNotes();
    dispatch({ type: 'CLOSE_TASK_FORM' });
  }, [dispatch, flushLocalNotes]);

  useEffect(() => {
    if (!isOpen || !panelRef.current) { return; }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const rafId = window.requestAnimationFrame(() => {
      const firstFocusable = getFocusableElements(panel)[0];
      firstFocusable?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') { return; }

      const focusables = getFocusableElements(panel);
      if (focusables.length === 0) { return; }

      const active = document.activeElement as HTMLElement | null;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey) {
        if (!active || active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      panel.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, requestClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).id === 'task-form-overlay') { requestClose(); }
  }, [requestClose]);

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

    flushLocalNotes();

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
  }, [task, cols, isRemote, flushLocalNotes, dispatch]);

  if (!showTaskForm && !editingTask) { return null; }

  return (
    <div className="task-form-overlay" id="task-form-overlay" onClick={handleOverlayClick}>
      <div ref={panelRef} className="task-form-panel" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
        <FlatButton variant="icon" icon="✕" className="task-form-panel__close" onClick={requestClose} title="Close" aria-label="Close task form" />
        <div className="task-form-panel__heading-wrap">
          <h2 id="task-form-title" className="task-form-panel__heading">{isEdit ? 'Edit Issue' : 'New Issue'}</h2>
          {(savedNotes || isRemote) && (
            <div className="task-form-panel__heading-meta">
              {savedNotes && (
                <span className="task-form-panel__notes-indicator" title="Has technical notes">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg>
                  Notes
                </span>
              )}
              {isRemote && <span className="task-form-panel__heading-badge">Remote · read-only details</span>}
            </div>
          )}
        </div>

        {isEdit && isRemote && (
          <div className="task-form__remote-hint">Only status and technical notes are editable for remote issues.</div>
        )}

        <form ref={formRef} id="task-form" className="task-form" onSubmit={handleSubmit}>
          {isEdit && isRemote && (
            <div className="task-form__section task-form__section--remote-priority">
              <div className="task-form__row task-form__row--compact">
                <div className="task-form__field">
                  <label className="task-form__label" htmlFor="tf-status">Status</label>
                  <select className="task-form__select" id="tf-status" defaultValue={task!.status}>
                    {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                {!!task?.meta?.remoteStatus && (
                  <div className="task-form__field">
                    <label className="task-form__label">Remote Status</label>
                    <span className="task-form__readonly-value task-form__readonly-value--badge">{String(task.meta.remoteStatus)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

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
                  <div className="task-form__local-notes-title-wrap">
                    <label className="task-form__label"><svg className="task-form__notes-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4Zm5 1v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5ZM5 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Zm.5 1.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"/></svg> Technical Notes</label>
                    {notesSaveState !== 'idle' && (
                      <span className={`task-form__notes-save-status task-form__notes-save-status--${notesSaveState}`}>
                        {notesSaveState === 'saving' ? 'Saving…' : 'Saved'}
                      </span>
                    )}
                  </div>
                  <FlatButton type="button" variant="icon" icon="−" onClick={() => {
                    flushLocalNotes();
                    setNotesOpen(false);
                  }} title="Close technical notes" />
                </div>
                <div className="task-form__desc-group">
                  <MarkdownEditor
                    ref={notesRef}
                    editorKey={`tf-notes-${task!.id}`}
                    markdown={savedNotes ?? ''}
                    placeholder="Add technical notes to enrich this task…"
                    onChange={() => queueNotesAutosave()}
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

          <div className="task-form__meta-panel">
            {!(isEdit && isRemote) && (
              <div className="task-form__meta-row task-form__meta-row--status">
                <label className="task-form__meta-label" htmlFor="tf-status">Status</label>
                <div className="task-form__meta-value task-form__meta-value--editable">
                  {isEdit
                    ? <select className="task-form__select" id="tf-status" defaultValue={task!.status}>
                        {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    : <input className="task-form__input" id="tf-status" type="text" value={cols[0]?.label ?? ''} disabled />}
                </div>
              </div>
            )}

            <div className="task-form__meta-row">
              <label className="task-form__meta-label" htmlFor={isRemote ? undefined : 'tf-labels'}>Labels</label>
              <div className={`task-form__meta-value${isEdit && isRemote ? ' task-form__meta-value--readonly' : ' task-form__meta-value--editable'}`}>
                {isEdit && isRemote
                  ? (task!.labels.length > 0
                      ? <span className="task-form__label-pills">{task!.labels.map(l => <span key={l} className="task-form__label-pill">{l}</span>)}</span>
                      : <span className="task-form__readonly-value task-form__readonly-value--muted">—</span>)
                  : <input className="task-form__input" id="tf-labels" type="text" defaultValue={task?.labels.join(', ') ?? ''} placeholder="bug, feature" />}
              </div>
            </div>

            <div className="task-form__meta-row">
              <label className="task-form__meta-label" htmlFor="tf-assignee">Assignee</label>
              <div className={`task-form__meta-value${isEdit && isRemote ? ' task-form__meta-value--readonly' : ' task-form__meta-value--editable'}`}>
                {isEdit && isRemote
                  ? (task!.assignee
                      ? <span className="task-form__assignee-value">{task!.assignee}</span>
                      : <span className="task-form__readonly-value task-form__readonly-value--muted">—</span>)
                  : <>
                      <input id="tf-assignee" type="hidden" value={task?.assignee ?? (currentUser || 'me')} readOnly />
                      <span className="task-form__assignee-chip">{task?.assignee ?? (currentUser || 'me')}</span>
                    </>}
              </div>
            </div>
          </div>

          <div className="task-form__actions">
            {isEdit && !isRemote && editableProviderIds.includes(task!.providerId) && (
              <FlatButton type="button" variant="danger" onClick={handleDelete}>
                Delete
              </FlatButton>
            )}
            <div className="task-form__actions-right">
              <FlatButton type="button" variant="secondary" onClick={requestClose}>
                {isEdit ? 'Close' : 'Cancel'}
              </FlatButton>
              <FlatButton type="submit" variant="primary">
                {isRemote ? 'Update Status' : 'Save'}
              </FlatButton>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

