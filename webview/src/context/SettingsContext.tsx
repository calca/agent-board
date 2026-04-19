import React, { createContext, useCallback, useContext, useReducer, useRef } from 'react';
import type { GenAiProviderInfo, ProviderInfo, SectionId, SettingsConfig } from '../settingsTypes';

// ── State ──────────────────────────────────────────────────────

export interface SettingsState {
  loaded: boolean;
  config: SettingsConfig;
  providers: ProviderInfo[];
  genAiProviders: GenAiProviderInfo[];
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
  genAiProviders: [],
  activeSection: 'providers',
  dirty: false,
  logContent: '',
  logFiles: [],
};

// ── Actions ────────────────────────────────────────────────────

type Action =
  | { type: 'setConfig'; config: SettingsConfig; force?: boolean }
  | { type: 'setProviders'; providers: ProviderInfo[] }
  | { type: 'setGenAiProviders'; providers: GenAiProviderInfo[] }
  | { type: 'setActiveSection'; section: SectionId }
  | { type: 'updateConfig'; patch: SettingsConfig }
  | { type: 'updateSectionField'; section: string; key: string; value: unknown }
  | { type: 'markClean' }
  | { type: 'setLogContent'; content: string }
  | { type: 'setLogFiles'; files: string[] };

function reducer(state: SettingsState, action: Action): SettingsState {
  switch (action.type) {
    case 'setConfig':
      // When the user has unsaved edits, ignore file-watcher reloads
      // to avoid overwriting in-progress changes. Force is used by resetToFile.
      if (state.loaded && state.dirty && !action.force) { return state; }
      return { ...state, config: action.config, loaded: true, dirty: false };
    case 'setProviders':
      return { ...state, providers: action.providers };
    case 'setGenAiProviders':
      return { ...state, genAiProviders: action.providers };
    case 'setActiveSection':
      return { ...state, activeSection: action.section };
    case 'updateConfig': {
      // Deep-merge one level down for object values (same as host ProjectConfig.updateConfig).
      // This prevents partial section patches from wiping out existing fields like `states`.
      const next: SettingsConfig = { ...state.config };
      for (const [key, value] of Object.entries(action.patch)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          next[key] = { ...(state.config[key] ?? {}), ...value };
        } else {
          next[key] = value;
        }
      }
      return { ...state, config: next, dirty: true };
    }
    case 'updateSectionField': {
      const prev = state.config[action.section] ?? {};
      return {
        ...state,
        config: {
          ...state.config,
          [action.section]: { ...prev, enabled: true, [action.key]: action.value },
        },
        dirty: true,
      };
    }
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
  configRef: React.MutableRefObject<SettingsConfig>;
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

  // Ref always points to the latest config — eliminates stale-closure issues in save
  const configRef = useRef(state.config);
  configRef.current = state.config;

  const save = useCallback(() => {
    postSettingsMessage({ type: 'save', config: configRef.current });
    // Don't markClean here — wait for host's saveOk confirmation.
    // This keeps dirty=true to block any file-watcher configData in transit.
  }, []);

  const resetToFile = useCallback(() => {
    dispatch({ type: 'markClean' });
    postSettingsMessage({ type: 'requestConfig' });
  }, []);

  const refreshDiagnostics = useCallback(() => {
    postSettingsMessage({ type: 'refreshDiagnostics' });
  }, []);

  return (
    <SettingsContext.Provider value={{ state, dispatch, configRef, save, resetToFile, refreshDiagnostics }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
