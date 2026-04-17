import React, { useCallback, useEffect, useRef } from 'react';
import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';
import type { FileChangeInfo } from '../types';
import { escapeHtml } from '../utils';
import { FlatButton } from './FlatButton';

const statusIcons: Record<string, string> = { added: '＋', modified: '✎', deleted: '✕' };

/** Lightweight client-side parser state for fenced blocks. */
let _fenceMode: 'none' | 'diff' | 'bash' | 'code' = 'none';

function renderStreamLine(rawLine: string, role?: 'user' | 'assistant' | 'tool'): string {
  const tsMatch = rawLine.match(/^\[(\d{2}:\d{2}:\d{2})\] (.*)/s);
  const ts = tsMatch ? tsMatch[1] : '';
  const line = tsMatch ? tsMatch[2] : rawLine;
  const tsHtml = ts ? `<span class="stream-ts">[${escapeHtml(ts)}]</span> ` : '';

  const fenceMatch = line.match(/^```(\w*)$/);
  if (fenceMatch) {
    if (_fenceMode !== 'none') {
      _fenceMode = 'none';
      return `<div class="stream-output__line stream-fence-close"></div>`;
    }
    const lang = (fenceMatch[1] || 'text').toLowerCase();
    _fenceMode = lang === 'diff' ? 'diff' : (lang === 'bash' || lang === 'sh' || lang === 'shell') ? 'bash' : 'code';
    return `<div class="stream-output__line stream-fence-open stream-fence-open--${_fenceMode}">${tsHtml}<span class="stream-fence-lang">${escapeHtml(lang || 'code')}</span></div>`;
  }

  if (_fenceMode === 'diff') {
    if (line.startsWith('+')) { return `<div class="stream-output__line stream-output__line--diff-add">${tsHtml}${escapeHtml(line)}</div>`; }
    if (line.startsWith('-')) { return `<div class="stream-output__line stream-output__line--diff-del">${tsHtml}${escapeHtml(line)}</div>`; }
    return `<div class="stream-output__line stream-output__line--diff-ctx">${tsHtml}${escapeHtml(line)}</div>`;
  }

  if (_fenceMode === 'bash') {
    return `<div class="stream-output__line stream-output__line--bash">${tsHtml}<code>${escapeHtml(line)}</code><button class="stream-run-btn" data-cmd="${escapeHtml(line)}" title="Run in terminal">▶</button></div>`;
  }

  const fileMatch = line.match(/^FILE:\s*(.+)$/);
  if (fileMatch) {
    const filePath = fileMatch[1].trim();
    return `<div class="stream-output__line stream-output__line--file">${tsHtml}<span class="stream-file-link" data-file-path="${escapeHtml(filePath)}" title="Open diff">◇ ${escapeHtml(filePath)}</span></div>`;
  }

  const roleClass = role && role !== 'assistant' ? ` stream-output__line--${role}` : '';
  return `<div class="stream-output__line${roleClass}">${tsHtml}${escapeHtml(line)}</div>`;
}

export function SessionPanel() {
  const { state, dispatch, imp } = useBoard();
  const { sessionPanelTaskId, tasks } = state;
  const scrollRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const task = tasks.find(t => t.id === sessionPanelTaskId);
  const isRunning = task?.copilotSession?.state === 'running' || task?.copilotSession?.state === 'starting';
  const isInterrupted = task?.copilotSession?.state === 'interrupted';
  const fileChanges: FileChangeInfo[] = sessionPanelTaskId
    ? (imp.current.fileChangeLists.get(sessionPanelTaskId) ?? [])
    : [];
  const streamLines = imp.current.sessionStreamLines;
  const chatMessages = imp.current.sessionChatMessages;

  // Auto-scroll
  useEffect(() => {
    if (imp.current.streamAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      imp.current.streamAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }
  }, [imp]);

  const handleClose = useCallback(() => {
    imp.current.sessionStreamLines = [];
    imp.current.sessionChatMessages = [];
    imp.current.streamAutoScroll = true;
    dispatch({ type: 'CLOSE_SESSION_PANEL' });
  }, [dispatch, imp]);

  const handleFollowUp = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector('#session-follow-up-input') as HTMLInputElement;
    if (input && sessionPanelTaskId && input.value.trim()) {
      postMessage({ type: 'sendFollowUp', sessionId: sessionPanelTaskId, text: input.value.trim() });
      input.value = '';
    }
  }, [sessionPanelTaskId]);

  if (!sessionPanelTaskId) { return null; }

  // Reset fence state for full render
  _fenceMode = 'none';
  const renderedLines = streamLines.map(l => renderStreamLine(l)).join('');

  const chatHtml = chatMessages.map(m => {
    const cls = m.role === 'user' ? 'chat-bubble chat-bubble--user'
      : m.role === 'tool' ? 'chat-bubble chat-bubble--tool'
      : 'chat-bubble chat-bubble--assistant';
    const icon = m.role === 'user' ? '●' : m.role === 'tool' ? '⚙' : '◆';
    return `<div class="${cls}"><span class="chat-bubble__icon">${icon}</span><div class="chat-bubble__body">${escapeHtml(m.text)}</div></div>`;
  }).join('');

  return (
    <div className="session-panel">
      <div className="session-panel__header">
        <span className="session-panel__title">{task?.title ?? sessionPanelTaskId}</span>
        <div className="session-panel__action-bar">
          <FlatButton variant="secondary" size="sm" icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.586a1.5 1.5 0 0 1 1.06.44l3.415 3.414A1.5 1.5 0 0 1 14 6.914V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z"/></svg>} title="Full Diff" onClick={() => postMessage({ type: 'openFullDiff', sessionId: sessionPanelTaskId })}>Diff</FlatButton>
          <FlatButton variant="secondary" size="sm" icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7ZM4 6.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5Zm.5 2.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4Z"/></svg>} title="Export Log" onClick={() => postMessage({ type: 'exportLog', sessionId: sessionPanelTaskId })}>Export</FlatButton>
          <FlatButton variant="icon" icon="✕" onClick={handleClose} title="Close" />
        </div>
      </div>
      {isInterrupted && <div className="session-interrupted-banner">↯ Sessione interrotta al riavvio di VS Code. Il log precedente è mostrato sotto (sola lettura).</div>}
      {isRunning && <div id={`tool-status-${sessionPanelTaskId}`} className="session-tool-status" />}
      <div className="session-panel__body">
        {chatMessages.length > 0 && (
          <div className="session-chat" dangerouslySetInnerHTML={{ __html: chatHtml }} />
        )}
        <div className="session-panel__stream" ref={scrollRef} onScroll={handleScroll}>
          <div
            className="stream-output"
            ref={outputRef}
            dangerouslySetInnerHTML={{ __html: renderedLines }}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.classList.contains('stream-file-link')) {
                const filePath = target.dataset.filePath;
                if (filePath && sessionPanelTaskId) {
                  postMessage({ type: 'openDiff', sessionId: sessionPanelTaskId, filePath });
                }
              }
              if (target.classList.contains('stream-run-btn')) {
                if (sessionPanelTaskId) {
                  postMessage({ type: 'openTerminalInWorktree', sessionId: sessionPanelTaskId });
                }
              }
            }}
          />
        </div>
        <div className="session-panel__files">
          <div className="file-list__header">Changed files ({fileChanges.length})</div>
          {fileChanges.length === 0
            ? <div className="file-list__empty">No changes yet</div>
            : fileChanges.map(f => (
              <div
                key={f.path}
                className={`session-file-item file-list__item file-list__item--${f.status}`}
                data-file-path={f.path}
                onClick={() => postMessage({ type: 'openDiff', sessionId: sessionPanelTaskId, filePath: f.path })}
              >
                <span className="file-list__icon">{statusIcons[f.status] || '?'}</span>
                <span className="file-list__path">{f.path}</span>
              </div>
            ))}
        </div>
      </div>
      <form className="session-panel__follow-up" onSubmit={handleFollowUp}>
        <input
          className="task-form__input"
          id="session-follow-up-input"
          type="text"
          placeholder={isInterrupted ? 'Sessione interrotta — riavvia per inviare messaggi' : "Invia messaggio all'agente…"}
          disabled={isInterrupted}
        />
        <FlatButton type="submit" variant="primary" disabled={isInterrupted}>Invia</FlatButton>
      </form>
    </div>
  );
}
