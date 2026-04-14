import { useEffect } from 'react';
import { useSettings, postSettingsMessage } from '../context/SettingsContext';

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
        case 'providerDiagnostics':
          dispatch({ type: 'setProviders', providers: msg.providers ?? [] });
          break;
      }
    }

    window.addEventListener('message', handler);

    // Signal host that the webview is ready
    postSettingsMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, [dispatch]);
}
