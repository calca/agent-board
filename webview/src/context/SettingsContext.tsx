import React, { createContext, useCallback, useContext, useReducer } from 'react';
import type { ProviderInfo, SectionId, SettingsConfig } from '../settingsTypes';

// ── State ──────────────────────────────────────────────────────

export interface SettingsState {
  loaded: boolean;
  config: SettingsConfig;
  providers: ProviderInfo[];
  activeSection: SectionId;
  dirty: boolean;
  /** Log content received from the host. */
  logContent: string;
  /** Available log file names (most recent first). */
  logFiles: string[];
}

const initialState: SettingsState = {
  loaded: false,
  config: {},
  providers: [],
  activeSection: 'providers',
  dirty: false,
  logContent: '',
  logFiles: [],
};

// ── Actions ────────────────────────────────────────────────────

type Action =
  | { type: 'setConfig'; config: SettingsConfig }
  | { type: 'setProviders'; providers: ProviderInfo[] }
  | { type: 'setActiveSection'; section: SectionId }
  | { type: 'updateConfig'; patch: SettingsConfig }
  | { type: 'markClean' }
  | { type: 'setLogContent'; content: string }
  | { type: 'setLogFiles'; files: string[] };

function reducer(state: SettingsState, action: Action): SettingsState {
  switch (action.type) {
    case 'setConfig':
      return { ...state, config: action.config, loaded: true, dirty: false };
    case 'setProviders':
      return { ...state, providers: action.providers };
    case 'setActiveSection':
      return { ...state, activeSection: action.section };
    case 'updateConfig':
      return { ...state, config: { ...state.config, ...action.patch }, dirty: true };
    case 'markClean':
      return { ...state, dirty: false };
    case 'setLogContent':
      return { ...state, logContent: action.content };
    case 'setLogFiles':
      return { ...state, logFiles: action.files };
    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────────

interface SettingsContextValue {
  state: SettingsState;
  dispatch: React.Dispatch<Action>;
  save: () => void;
  resetToFile: () => void;
  refreshDiagnostics: () => void;
}

const SettingsContext = createContext<SettingsContextValue>(null!);

// ── VS Code API ────────────────────────────────────────────────

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

let vscodeApi: VsCodeApi | undefined;
function getApi(): VsCodeApi {
  if (!vscodeApi) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vscodeApi = (window as any).acquireVsCodeApi();
  }
  return vscodeApi!;
}

export function postSettingsMessage(msg: unknown): void {
  getApi().postMessage(msg);
}

// ── Provider ───────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const save = useCallback(() => {
    postSettingsMessage({ type: 'save', config: state.config });
    dispatch({ type: 'markClean' });
  }, [state.config]);

  const resetToFile = useCallback(() => {
    postSettingsMessage({ type: 'requestConfig' });
  }, []);

  const refreshDiagnostics = useCallback(() => {
    postSettingsMessage({ type: 'refreshDiagnostics' });
  }, []);

  return (
    <SettingsContext.Provider value={{ state, dispatch, save, resetToFile, refreshDiagnostics }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
