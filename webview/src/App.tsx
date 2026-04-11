import React from 'react';
import { useBoard } from './context/BoardContext';
import { useHostMessages } from './hooks/useHostMessages';
import { Toolbar } from './components/Toolbar';
import { KanbanBoard } from './components/KanbanBoard';
import { NotificationCenter } from './components/NotificationCenter';
import { TaskForm } from './components/TaskForm';
import { SessionPanel } from './components/SessionPanel';
import { FullView } from './components/FullView';

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
      <SessionPanel />
      <FullView />
    </>
  );
}
