import { useEffect, useRef } from 'react';
import type { UIBlock } from '../components/chat/chatTypes';
import { chatReducer, EMPTY_CHAT_STATE } from '../components/chat/chatTypes';
import { persistChatStates, useBoard } from '../context/BoardContext';
import { DataProvider } from '../DataProvider';
import type { Column, FileChangeInfo, KanbanTask, TaskLogEntry } from '../types';
import { getVsCodeApi, postMessage } from './useVsCodeApi';

/**
 * Listens for messages from the extension host and dispatches
 * the corresponding BoardContext actions / imperative updates.
 */
export function useHostMessages(): void {
  const { state, dispatch, imp, forceUpdate } = useBoard();
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveAnimTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const newCardAnimTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    function classifyMoveKind(status: string): 'to-active' | 'to-done' | 'to-source' | 'generic' {
      if (status === 'inprogress') { return 'to-active'; }
      if (status === 'review' || status === 'done') { return 'to-done'; }
      if (status === 'todo') { return 'to-source'; }
      return 'generic';
    }

    function handler(event: MessageEvent) {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') { return; }

      switch (msg.type) {
        case 'tasksUpdate': {
          const newTasks: KanbanTask[] = msg.tasks ?? [];
          const prevTasks = state.tasks;
          const columns: Column[] = msg.columns ?? [];

          // Track state transitions for per-task logs
          for (const nt of newTasks) {
            const ot = prevTasks.find(t => t.id === nt.id);
            if (!ot && prevTasks.length > 0) {
              // Brand-new task: animate its entry
              imp.current.recentlyNewTaskIds.add(nt.id);
              const prevNewTimer = newCardAnimTimers.current.get(nt.id);
              if (prevNewTimer) { clearTimeout(prevNewTimer); }
              newCardAnimTimers.current.set(nt.id, setTimeout(() => {
                imp.current.recentlyNewTaskIds.delete(nt.id);
                newCardAnimTimers.current.delete(nt.id);
                forceUpdate();
              }, 700));
            }
            if (ot) {
              if (ot.status !== nt.status) {
                const colLabel = columns.find(c => c.id === nt.status)?.label ?? nt.status;
                addLog(nt.id, 'board', `Moved to "${colLabel}"`);

                // Mark recently moved cards to trigger a visual transition in the board.
                imp.current.recentlyMovedTaskIds.add(nt.id);
                imp.current.recentlyMovedTaskKinds.set(nt.id, classifyMoveKind(nt.status));
                const prevTimer = moveAnimTimers.current.get(nt.id);
                if (prevTimer) { clearTimeout(prevTimer); }
                moveAnimTimers.current.set(nt.id, setTimeout(() => {
                  imp.current.recentlyMovedTaskIds.delete(nt.id);
                  imp.current.recentlyMovedTaskKinds.delete(nt.id);
                  moveAnimTimers.current.delete(nt.id);
                  forceUpdate();
                }, 850));
              }
              if (ot.copilotSession?.state !== nt.copilotSession?.state && nt.copilotSession) {
                addLog(nt.id, 'board', `Session → ${nt.copilotSession.state}`);
                if (nt.copilotSession.state === 'error' && nt.copilotSession.errorMessage) {
                  addLog(nt.id, 'board', `✗ ${nt.copilotSession.errorMessage}`);
                }
              }
            }
          }

          // Sync mergedSessions
          imp.current.mergedSessions.clear();
          for (const t of newTasks) {
            if (t.copilotSession?.merged) { imp.current.mergedSessions.add(t.id); }
          }

          // Clear toolCallStatus for inactive sessions
          for (const [id] of imp.current.toolCallStatus) {
            const t = newTasks.find(t2 => t2.id === id);
            if (!t || (t.copilotSession?.state !== 'running' && t.copilotSession?.state !== 'starting')) {
              imp.current.toolCallStatus.delete(id);
            }
          }

          dispatch({
            type: 'TASKS_UPDATE',
            tasks: newTasks,
            columns,
            editableProviderIds: msg.editableProviderIds ?? [],
            genAiProviders: msg.genAiProviders ?? [],
          });

          // Debounce: wait for data to stabilise before revealing the board
          if (settleTimer.current) { clearTimeout(settleTimer.current); }
          settleTimer.current = setTimeout(() => dispatch({ type: 'SETTLE' }), 400);
          break;
        }
        case 'agentsAvailable':
          dispatch({ type: 'AGENTS_AVAILABLE', agents: msg.agents ?? [], squadTeams: msg.squadTeams });
          break;
        case 'branchesAvailable':
          dispatch({ type: 'BRANCHES_AVAILABLE', branches: msg.branches ?? [], current: msg.current ?? '' });
          break;
        case 'squadStatus':
          dispatch({ type: 'SQUAD_STATUS', status: msg.status });
          break;
        case 'mcpStatus':
          dispatch({ type: 'MCP_STATUS', enabled: msg.enabled ?? false });
          break;
        case 'mobileStatus':
          dispatch({
            type: 'MOBILE_STATUS',
            running: msg.running ?? false,
            url: msg.url ?? '',
            devices: msg.devices ?? [],
            qrSvg: msg.qrSvg,
            tunnelEnabled: msg.tunnelEnabled,
            tunnelActive: msg.tunnelActive,
            tunnelUrl: msg.tunnelUrl,
            refreshing: msg.refreshing,
          });
          break;
        case 'mobileDialog':
          dispatch({ type: msg.open ? 'OPEN_MOBILE_DIALOG' : 'CLOSE_MOBILE_DIALOG' });
          break;
        case 'showTaskForm':
          dispatch({ type: 'SHOW_TASK_FORM', columns: msg.columns ?? [], currentUser: msg.currentUser });
          break;
        case 'repoStatus':
          dispatch({
            type: 'REPO_STATUS',
            isGit: msg.isGit ?? true,
            isGitHub: msg.isGitHub ?? true,
            isAzureDevOps: msg.isAzureDevOps ?? false,
            workspaceRoot: msg.workspaceRoot ?? '',
            workspaceName: msg.workspaceName ?? '',
          });
          break;
        case 'streamOutput': {
          const sessionId = msg.sessionId as string;
          addLog(sessionId, 'agent', msg.text);
          if (state.sessionPanelTaskId === sessionId) {
            const newLines = (msg.text as string).split('\n');
            imp.current.sessionStreamLines.push(...newLines);
            if (imp.current.sessionStreamLines.length > 500) {
              imp.current.sessionStreamLines = imp.current.sessionStreamLines.slice(-500);
            }
            const chatRole = msg.role ?? 'assistant';
            if (chatRole === 'user' || chatRole === 'tool') {
              imp.current.sessionChatMessages.push({ role: chatRole, text: msg.text, ts: msg.ts });
            } else {
              const last = imp.current.sessionChatMessages[imp.current.sessionChatMessages.length - 1];
              if (last && last.role === 'assistant') {
                last.text += msg.text;
              } else {
                imp.current.sessionChatMessages.push({ role: 'assistant', text: msg.text, ts: msg.ts });
              }
            }
            if (imp.current.sessionChatMessages.length > 200) {
              imp.current.sessionChatMessages = imp.current.sessionChatMessages.slice(-200);
            }
          }
          forceUpdate();
          break;
        }
        case 'toolCall': {
          imp.current.toolCallStatus.set(msg.sessionId, msg.status);
          addLog(msg.sessionId, 'tool', msg.status);
          forceUpdate();
          break;
        }
        case 'fileChanges': {
          const prevCount = imp.current.fileChangeLists.get(msg.sessionId)?.length ?? 0;
          const newFiles: FileChangeInfo[] = msg.files ?? [];
          imp.current.fileChangeLists.set(msg.sessionId, newFiles);
          if (newFiles.length !== prevCount) {
            addLog(msg.sessionId, 'system', `${newFiles.length} file(s) changed`);
          }
          forceUpdate();
          break;
        }
        case 'streamResume': {
          if (msg.log && state.fullViewTaskId === msg.sessionId) {
            const histLines = (msg.log as string).split('\n').filter((l: string) => l.trim());
            const existing = imp.current.taskEventLogs.get(msg.sessionId) ?? [];
            const nonAgent = existing.filter(e => e.source !== 'agent');
            const histEntries: TaskLogEntry[] = histLines.map((line: string) => {
              const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\] (.*)/s);
              return {
                ts: tsMatch ? tsMatch[1] : '',
                source: 'agent' as const,
                text: tsMatch ? tsMatch[2] : line,
              };
            });
            imp.current.taskEventLogs.set(msg.sessionId, [...histEntries, ...nonAgent]);
          }
          if (state.sessionPanelTaskId === msg.sessionId) {
            imp.current.sessionStreamLines = (msg.log as string).split('\n');
            if (imp.current.sessionStreamLines.length > 500) {
              imp.current.sessionStreamLines = imp.current.sessionStreamLines.slice(-500);
            }
          }
          forceUpdate();
          break;
        }
        case 'mergeResult':
          if (msg.success) { imp.current.mergedSessions.add(msg.sessionId); }
          addLog(msg.sessionId, msg.success ? 'system' : 'board',
            msg.success ? `✓ ${msg.message}` : `✗ Merge fallito: ${msg.message}`);
          forceUpdate();
          break;
        case 'deleteWorktreeResult':
          addLog(msg.sessionId, msg.success ? 'system' : 'board',
            msg.success ? '⊘ Worktree eliminato.' : `✗ Eliminazione fallita: ${msg.message ?? ''}`);
          if (msg.success) { imp.current.mergedSessions.delete(msg.sessionId); }
          forceUpdate();
          break;
        case 'createPullRequestResult':
          addLog(msg.sessionId, msg.success ? 'system' : 'board',
            msg.success ? `⤴ Pull Request created: ${msg.prUrl ?? ''}` : `✗ Create PR failed: ${msg.message ?? ''}`);
          forceUpdate();
          break;
        case 'agentLog': {
          const tid = msg.taskId as string;
          if (!msg.done) {
            addLog(tid, 'agent', msg.chunk);
          }
          forceUpdate();
          break;
        }
        case 'agentError': {
          addLog(msg.taskId as string, 'system', `✗ ${msg.error}`);
          forceUpdate();
          break;
        }
        case 'themeChange':
          // Theme auto-applied via CSS variables
          break;

        // ── Chat messages — persisted in imp.chatStates ───────────────
        case 'chatPrompt':
          dispatchChat(msg.sessionId as string, { type: 'BOARD_MESSAGE', text: msg.prompt as string });
          break;
        case 'chatBoardEvent':
          dispatchChat(msg.sessionId as string, { type: 'BOARD_MESSAGE', text: msg.text as string });
          break;
        case 'chatStart':
          dispatchChat(msg.sessionId as string, { type: 'START_ASSISTANT' });
          break;
        case 'chatBlock':
          dispatchChat(msg.sessionId as string, { type: 'APPEND_BLOCK', block: msg.block as UIBlock });
          break;
        case 'chatEnd':
          dispatchChat(msg.sessionId as string, { type: 'END_ASSISTANT' });
          break;
        case 'chatError':
          dispatchChat(msg.sessionId as string, { type: 'APPEND_BLOCK', block: { type: 'text', content: `⚠ ${msg.content}` } });
          dispatchChat(msg.sessionId as string, { type: 'END_ASSISTANT' });
          break;
      }
    }

    /** Apply a ChatAction to the persistent chat state for a session. */
    function dispatchChat(sessionId: string, action: import('../components/chat/chatTypes').ChatAction) {
      const prev = imp.current.chatStates.get(sessionId) ?? EMPTY_CHAT_STATE;
      imp.current.chatStates.set(sessionId, chatReducer(prev, action));
      persistChatStates(imp.current.chatStates);
      forceUpdate();
    }

    function addLog(taskId: string, source: TaskLogEntry['source'], text: string) {
      if (!imp.current.taskEventLogs.has(taskId)) {
        imp.current.taskEventLogs.set(taskId, []);
      }
      const logs = imp.current.taskEventLogs.get(taskId)!;
      const ts = new Date().toISOString().slice(11, 19);
      logs.push({ ts, source, text });
      if (logs.length > 2000) {
        imp.current.taskEventLogs.set(taskId, logs.slice(-2000));
      }
    }

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      for (const timer of moveAnimTimers.current.values()) {
        clearTimeout(timer);
      }
      moveAnimTimers.current.clear();
    };
    // We intentionally use state refs that may be stale for some values;
    // the handler reads them at call time which is acceptable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, forceUpdate, imp, state.sessionPanelTaskId, state.fullViewTaskId, state.tasks]);

  // Send ready message on mount + retry
  useEffect(() => {
    postMessage({ type: 'ready' });
    const interval = setInterval(() => {
      if (state.loaded) { clearInterval(interval); return; }
      postMessage({ type: 'ready' });
    }, 2000);
    return () => clearInterval(interval);
  }, [state.loaded]);

  // Mobile browser fallback: poll tasks from HTTP API and keep board updated.
  useEffect(() => {
    if (getVsCodeApi()) {
      return;
    }

    let disposed = false;
    let infoFetched = false;

    const tokenHeaders = (): Record<string, string> => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || (window as any).__BOARD_SESSION_TOKEN;
      return token ? { 'X-Board-Token': token } : {};
    };

    const pullInfo = async () => {
      try {
        const r = await fetch('/info', { headers: tokenHeaders() });
        const info = await r.json();
        if (disposed) { return; }

        dispatch({ type: 'SET_CONNECTION_ERROR', error: false });

        if (!infoFetched && info.workspaceName) {
          dispatch({
            type: 'REPO_STATUS',
            isGit: info.repoIsGit ?? false,
            isGitHub: info.repoIsGitHub ?? false,
            isAzureDevOps: false,
            workspaceRoot: '',
            workspaceName: info.workspaceName,
          });
          infoFetched = true;
        }

        if (info.squadStatus) {
          dispatch({ type: 'SQUAD_STATUS', status: info.squadStatus });
        }
        if (info.agents) {
          dispatch({ type: 'AGENTS_AVAILABLE', agents: info.agents });
        }
        if (info.branches) {
          dispatch({ type: 'BRANCHES_AVAILABLE', branches: info.branches, current: info.currentBranch ?? '' });
        }
        if (info.providers) {
          // Merge into next TASKS_UPDATE as genAiProviders
          latestProviders = info.providers;
        }
        if (info.columns) {
          latestColumns = info.columns;
        }
      } catch {
        if (!disposed) {
          dispatch({ type: 'SET_CONNECTION_ERROR', error: true });
        }
      }
    };

    let latestProviders: { id: string; displayName: string }[] = [];
    let latestColumns: { id: string; label: string; color?: string }[] = [];

    const pullTasks = async () => {
      try {
        const tasks = await DataProvider.getTasks();
        if (disposed) {
          return;
        }

        dispatch({ type: 'SET_CONNECTION_ERROR', error: false });

        let columns: { id: string; label: string; color?: string }[];
        if (latestColumns.length > 0) {
          // Use columns from /info (includes labels + colors from project config)
          const colIds = new Set(latestColumns.map(c => c.id));
          const extraStatuses = [...new Set(tasks.map(t => t.status))].filter(s => !colIds.has(s));
          columns = [...latestColumns, ...extraStatuses.map(id => ({ id, label: id }))];
        } else {
          // Fallback: guess columns from task statuses
          const statusOrder = ['todo', 'inprogress', 'review', 'done'];
          const extraStatuses = [...new Set(tasks.map(t => t.status))].filter(s => !statusOrder.includes(s));
          const ordered = [...statusOrder, ...extraStatuses];
          columns = ordered.map(id => ({ id, label: id }));
        }

        dispatch({
          type: 'TASKS_UPDATE',
          tasks: tasks as unknown as KanbanTask[],
          columns,
          editableProviderIds: ['json'],
          genAiProviders: latestProviders.map(p => ({ id: p.id, displayName: p.displayName, icon: '' })),
        });

        // Sync mergedSessions from copilotSession.merged (same logic as VS Code handler)
        imp.current.mergedSessions.clear();
        for (const t of tasks as unknown as KanbanTask[]) {
          if (t.copilotSession?.merged) { imp.current.mergedSessions.add(t.id); }
        }
      } catch {
        if (!disposed) {
          dispatch({ type: 'SET_CONNECTION_ERROR', error: true });
        }
      }
    };

    void pullInfo();
    void pullTasks();
    const interval = setInterval(() => {
      void pullInfo();
      void pullTasks();
    }, 3000);

    // Expose manual sync trigger for browser mode (used by Sync button)
    (window as any).__agentBoardMobileSync = async () => {
      // Ask the VS Code extension to refresh its providers first
      try { await fetch('/sync', { method: 'POST', headers: tokenHeaders() }); } catch { /* ignore */ }
      void pullInfo();
      void pullTasks();
    };

    return () => {
      disposed = true;
      clearInterval(interval);
      delete (window as any).__agentBoardMobileSync;
    };
  }, [dispatch]);
}
