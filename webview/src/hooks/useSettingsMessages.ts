import { useEffect } from 'react';
import { postSettingsMessage, useSettings } from '../context/SettingsContext';

/**
 * Listens for host → settings webview messages and dispatches
 * them into the SettingsContext.
 */
export function useSettingsMessages(): void {
  const { dispatch } = useSettings();

  useEffect(() => {
    function handler(e: MessageEvent) {
      const msg = e.data;
      if (!msg || typeof msg.type !== 'string') { return; }

      switch (msg.type) {
        case 'configData':
          dispatch({ type: 'setConfig', config: msg.config ?? {} });
          break;
        case 'configSaved':
          // Authoritative merged config from host after save — always accept
          dispatch({ type: 'setConfig', config: msg.config ?? {}, force: true });
          break;
        case 'saveOk':
          dispatch({ type: 'markClean' });
          break;
        case 'providerDiagnostics':
          dispatch({ type: 'setProviders', providers: msg.providers ?? [] });
          break;
        case 'genAiProviderInfo':
          dispatch({ type: 'setGenAiProviders', providers: msg.providers ?? [] });
          break;
        case 'logContent':
          dispatch({ type: 'setLogContent', content: msg.content ?? '' });
          break;
        case 'logFiles':
          dispatch({ type: 'setLogFiles', files: msg.files ?? [] });
          break;
      }
    }

    window.addEventListener('message', handler);

    // Signal host that the webview is ready
    postSettingsMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, [dispatch]);
}
