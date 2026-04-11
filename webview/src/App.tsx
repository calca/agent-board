import { CleanConfirmDialog } from './components/CleanConfirmDialog';
import { FullView } from './components/FullView';
import { KanbanBoard } from './components/KanbanBoard';
import { NotificationCenter } from './components/NotificationCenter';
import { SessionPanel } from './components/SessionPanel';
import { TaskForm } from './components/TaskForm';
import { Toolbar } from './components/Toolbar';
import { useBoard } from './context/BoardContext';
import { useHostMessages } from './hooks/useHostMessages';

export function App() {
  useHostMessages();
  const { state } = useBoard();

  if (!state.loaded) {
    return (
      <div className="loader">
        <div className="loader__spinner" />
        <div className="loader__text">Loading board…</div>
      </div>
    );
  }

  return (
    <>
      <Toolbar />
      <NotificationCenter />
      <KanbanBoard />
      <TaskForm />
      <CleanConfirmDialog />
      <SessionPanel />
      <FullView />
    </>
  );
}
