import React, { createContext, useCallback, useContext, useReducer, useRef, type Dispatch } from 'react';
import { AgentOption, ChatMessage, Column, FileChangeInfo, GenAiProviderOption, KanbanTask, MobileDeviceInfo, SquadStatus, TaskLogEntry } from '../types';

// ── State ────────────────────────────────────────────────────────────────

export interface BoardState {
  loaded: boolean;
  tasks: KanbanTask[];
  columns: Column[];
  editableProviderIds: string[];
  genAiProviders: GenAiProviderOption[];
  availableAgents: AgentOption[];
  selectedAgentSlug: string;
  selectedSquadProviderId: string;
  squadStatus: SquadStatus;
  mcpEnabled: boolean;
  mobileServerRunning: boolean;
  mobileServerUrl: string;
  mobileDevices: MobileDeviceInfo[];
  mobileQrSvg: string;
  showMobileDialog: boolean;
  mobileTunnelEnabled: boolean;
  mobileTunnelActive: boolean;
  mobileTunnelUrl: string;
  mobileRefreshing: boolean;
  repoIsGit: boolean;
  repoIsGitHub: boolean;
  repoIsAzureDevOps: boolean;
  workspaceRoot: string;
  workspaceName: string;
  // UI state
  searchText: string;
  showSearchInput: boolean;
  showTaskForm: boolean;
  formColumns: Column[];
  editingTask: KanbanTask | null;
  selectedTask: KanbanTask | null;
  fullViewTaskId: string | null;
  sessionPanelTaskId: string | null;
  showNotificationCenter: boolean;
  showCleanConfirm: boolean;
  logExpanded: boolean;
  syncing: boolean;
  connectionError: boolean;
}

export const initialState: BoardState = {
  loaded: false,
  tasks: [],
  columns: [],
  editableProviderIds: [],
  genAiProviders: [],
  availableAgents: [],
  selectedAgentSlug: '',
  selectedSquadProviderId: '',
  squadStatus: { activeCount: 0, maxSessions: 10, autoSquadEnabled: false },
  mcpEnabled: false,
  mobileServerRunning: false,
  mobileServerUrl: '',
  mobileDevices: [],
  mobileQrSvg: '',
  showMobileDialog: false,
  mobileTunnelEnabled: false,
  mobileTunnelActive: false,
  mobileTunnelUrl: '',
  mobileRefreshing: false,
  repoIsGit: true,
  repoIsGitHub: true,
  repoIsAzureDevOps: false,
  workspaceRoot: '',
  workspaceName: '',
  searchText: '',
  showSearchInput: false,
  showTaskForm: false,
  formColumns: [],
  editingTask: null,
  selectedTask: null,
  fullViewTaskId: null,
  sessionPanelTaskId: null,
  showNotificationCenter: false,
  showCleanConfirm: false,
  logExpanded: false,
  syncing: false,
  connectionError: false,
};

// ── Actions ──────────────────────────────────────────────────────────────

export type BoardAction =
  | { type: 'TASKS_UPDATE'; tasks: KanbanTask[]; columns: Column[]; editableProviderIds: string[]; genAiProviders: GenAiProviderOption[] }
  | { type: 'AGENTS_AVAILABLE'; agents: AgentOption[] }
  | { type: 'SQUAD_STATUS'; status: SquadStatus }
  | { type: 'MCP_STATUS'; enabled: boolean }
  | { type: 'MOBILE_STATUS'; running: boolean; url: string; devices: MobileDeviceInfo[]; qrSvg?: string; tunnelEnabled?: boolean; tunnelActive?: boolean; tunnelUrl?: string; refreshing?: boolean }
  | { type: 'OPEN_MOBILE_DIALOG' }
  | { type: 'CLOSE_MOBILE_DIALOG' }
  | { type: 'START_MOBILE_REFRESH' }
  | { type: 'SHOW_TASK_FORM'; columns: Column[] }
  | { type: 'REPO_STATUS'; isGit: boolean; isGitHub: boolean; isAzureDevOps: boolean; workspaceRoot: string; workspaceName: string }
  | { type: 'SET_SEARCH_TEXT'; text: string }
  | { type: 'TOGGLE_SEARCH' }
  | { type: 'TOGGLE_NOTIFICATION_CENTER' }
  | { type: 'TOGGLE_LOG_EXPANDED' }
  | { type: 'OPEN_TASK_FORM' }
  | { type: 'CLOSE_TASK_FORM' }
  | { type: 'SET_EDITING_TASK'; task: KanbanTask | null }
  | { type: 'OPEN_FULL_VIEW'; taskId: string }
  | { type: 'CLOSE_FULL_VIEW' }
  | { type: 'OPEN_SESSION_PANEL'; taskId: string }
  | { type: 'CLOSE_SESSION_PANEL' }
  | { type: 'SET_SELECTED_AGENT'; slug: string }
  | { type: 'SET_SELECTED_SQUAD_PROVIDER'; id: string }
  | { type: 'SHOW_CLEAN_CONFIRM' }
  | { type: 'HIDE_CLEAN_CONFIRM' }
  | { type: 'START_SYNC' }
  | { type: 'SET_CONNECTION_ERROR'; error: boolean }
  | { type: 'SETTLE' };

// ── Reducer ──────────────────────────────────────────────────────────────

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'TASKS_UPDATE': {
      let editingTask = state.editingTask;
      if (editingTask) {
        const updated = action.tasks.find(t => t.id === editingTask!.id);
        editingTask = updated ?? null;
      }
      let selectedSquadProviderId = state.selectedSquadProviderId;
      if (!selectedSquadProviderId) {
        const first = action.genAiProviders.find(p => !p.disabled && p.id !== 'chat');
        if (first) { selectedSquadProviderId = first.id; }
      }
      return {
        ...state,
        loaded: true,
        syncing: false,
        tasks: action.tasks,
        columns: action.columns,
        editableProviderIds: action.editableProviderIds,
        genAiProviders: action.genAiProviders,
        selectedSquadProviderId,
        editingTask,
      };
    }
    case 'AGENTS_AVAILABLE': {
      let slug = state.selectedAgentSlug;
      if (slug && !action.agents.some(a => a.slug === slug && a.canSquad)) {
        slug = '';
      }
      if (!slug) {
        const first = action.agents.find(a => a.canSquad);
        if (first) { slug = first.slug; }
      }
      return { ...state, availableAgents: action.agents, selectedAgentSlug: slug };
    }
    case 'SQUAD_STATUS':
      return { ...state, squadStatus: action.status };
    case 'MCP_STATUS':
      return { ...state, mcpEnabled: action.enabled };
    case 'MOBILE_STATUS':
      return {
        ...state,
        mobileServerRunning: action.running,
        mobileServerUrl: action.url,
        mobileDevices: action.devices,
        mobileQrSvg: action.qrSvg ?? state.mobileQrSvg,
        mobileTunnelEnabled: action.tunnelEnabled ?? state.mobileTunnelEnabled,
        mobileTunnelActive: action.tunnelActive ?? state.mobileTunnelActive,
        mobileTunnelUrl: action.tunnelUrl ?? state.mobileTunnelUrl,
        mobileRefreshing: action.refreshing ?? false,
      };
    case 'OPEN_MOBILE_DIALOG':
      return { ...state, showMobileDialog: true };
    case 'CLOSE_MOBILE_DIALOG':
      return { ...state, showMobileDialog: false };
    case 'START_MOBILE_REFRESH':
      return { ...state, mobileRefreshing: true };
    case 'SHOW_TASK_FORM':
      return { ...state, showTaskForm: true, formColumns: action.columns, selectedTask: null };
    case 'REPO_STATUS':
      return {
        ...state,
        repoIsGit: action.isGit,
        repoIsGitHub: action.isGitHub,
        repoIsAzureDevOps: action.isAzureDevOps,
        workspaceRoot: action.workspaceRoot,
        workspaceName: action.workspaceName,
      };
    case 'SET_SEARCH_TEXT':
      return { ...state, searchText: action.text };
    case 'TOGGLE_SEARCH': {
      const next = !state.showSearchInput;
      return { ...state, showSearchInput: next, searchText: next ? state.searchText : '' };
    }
    case 'TOGGLE_NOTIFICATION_CENTER':
      return { ...state, showNotificationCenter: !state.showNotificationCenter };
    case 'TOGGLE_LOG_EXPANDED':
      return { ...state, logExpanded: !state.logExpanded };
    case 'OPEN_TASK_FORM':
      return { ...state, showTaskForm: true, formColumns: state.columns, selectedTask: null };
    case 'CLOSE_TASK_FORM':
      return { ...state, showTaskForm: false, editingTask: null };
    case 'SET_EDITING_TASK':
      return { ...state, editingTask: action.task, showTaskForm: false };
    case 'OPEN_FULL_VIEW':
      return { ...state, fullViewTaskId: action.taskId, selectedTask: null, editingTask: null, showTaskForm: false, sessionPanelTaskId: null };
    case 'CLOSE_FULL_VIEW':
      return { ...state, fullViewTaskId: null };
    case 'OPEN_SESSION_PANEL':
      return { ...state, sessionPanelTaskId: action.taskId };
    case 'CLOSE_SESSION_PANEL':
      return { ...state, sessionPanelTaskId: null };
    case 'SET_SELECTED_AGENT':
      return { ...state, selectedAgentSlug: action.slug };
    case 'SET_SELECTED_SQUAD_PROVIDER':
      return { ...state, selectedSquadProviderId: action.id };
    case 'START_SYNC':
      return { ...state, syncing: true };
    case 'SET_CONNECTION_ERROR':
      return { ...state, connectionError: action.error };
    case 'SHOW_CLEAN_CONFIRM':
      return { ...state, showCleanConfirm: true };
    case 'HIDE_CLEAN_CONFIRM':
      return { ...state, showCleanConfirm: false };
    case 'SETTLE':
      return state;
    default:
      return state;
  }
}

// ── Imperative state (not in React re-render cycle) ──────────────────

export interface ImperativeState {
  mergedSessions: Set<string>;
  toolCallStatus: Map<string, string>;
  fileChangeLists: Map<string, FileChangeInfo[]>;
  taskEventLogs: Map<string, TaskLogEntry[]>;
  sessionStreamLines: string[];
  sessionChatMessages: ChatMessage[];
  streamAutoScroll: boolean;
  fullViewAutoScroll: boolean;
}

// ── Context ──────────────────────────────────────────────────────────────

interface BoardContextValue {
  state: BoardState;
  dispatch: Dispatch<BoardAction>;
  imp: React.MutableRefObject<ImperativeState>;
  /** Force a re-render (for imperative state changes). */
  forceUpdate: () => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, initialState);
  const [, setTick] = React.useState(0);
  const imp = useRef<ImperativeState>({
    mergedSessions: new Set(),
    toolCallStatus: new Map(),
    fileChangeLists: new Map(),
    taskEventLogs: new Map(),
    sessionStreamLines: [],
    sessionChatMessages: [],
    streamAutoScroll: true,
    fullViewAutoScroll: true,
  });
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  return (
    <BoardContext.Provider value={{ state, dispatch, imp, forceUpdate }}>
      {children}
    </BoardContext.Provider>
  );
}

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) { throw new Error('useBoard must be used within BoardProvider'); }
  return ctx;
}
