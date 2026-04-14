/**
 * Settings WebView entry point.
 * Mounts the SettingsApp component into the #root element.
 */
import { createRoot } from 'react-dom/client';
import { SettingsApp } from './SettingsApp';
import { SettingsProvider } from './context/SettingsContext';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <SettingsProvider>
      <SettingsApp />
    </SettingsProvider>
  );
}
