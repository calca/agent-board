/**
 * React WebView entry point.
 * Mounts the App component into the #root element.
 */
import { createRoot } from 'react-dom/client';
import { BoardProvider } from './context/BoardContext';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <BoardProvider>
      <App />
    </BoardProvider>
  );
}
