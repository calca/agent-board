import React, { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { postMessage } from '../hooks/useVsCodeApi';
import { MarkdownEditor, type MDXEditorMethods } from './MarkdownEditor';

interface LocalNotesPanelProps {
  taskId: string;
  providerId: string;
  markdown: string;
  onClose: () => void;
}

/**
 * Overlay panel for editing local notes in Markdown.
 * Opened via CTA from FullView or TaskForm.
 * Uses a portal to escape parent overflow/stacking contexts.
 */
export function LocalNotesPanel({ taskId, providerId, markdown, onClose }: LocalNotesPanelProps) {
  const editorRef = useRef<MDXEditorMethods>(null);

  const handleSave = useCallback(() => {
    const md = editorRef.current?.getMarkdown().trim() ?? '';
    postMessage({ type: 'saveLocalNotes', taskId, providerId, notes: md });
    onClose();
  }, [taskId, providerId, onClose]);

  const handleOverlay = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('local-notes-overlay')) {
      handleSave();
    }
  }, [handleSave]);

  return createPortal(
    <div className="local-notes-overlay" onClick={handleOverlay}>
      <div className="local-notes-panel">
        <div className="local-notes-panel__header">
          <span className="local-notes-panel__title">Details</span>
          <button className="local-notes-panel__close" onClick={handleSave} title="Save & Close">✕</button>
        </div>
        <div className="local-notes-panel__body">
          <MarkdownEditor
            ref={editorRef}
            editorKey={`local-notes-panel-${taskId}`}
            markdown={markdown}
            placeholder="Add local notes to enrich this task…"
          />
        </div>
        <div className="local-notes-panel__actions">
          <button className="local-notes-panel__btn local-notes-panel__btn--save" onClick={handleSave}>Save & Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
