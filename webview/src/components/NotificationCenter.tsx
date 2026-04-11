import React from 'react';
import { useBoard } from '../context/BoardContext';
import { getNotifications } from './Toolbar';

export function NotificationCenter() {
  const { state, dispatch } = useBoard();
  if (!state.showNotificationCenter) { return null; }

  const items = getNotifications(state.repoIsGit, state.repoIsGitHub);

  return (
    <div className="notification-center" id="notification-center">
      <div className="notification-center__header">
        <span className="notification-center__title">Notifications</span>
        <button className="notification-center__close" onClick={() => dispatch({ type: 'TOGGLE_NOTIFICATION_CENTER' })}>✕</button>
      </div>
      <div className="notification-center__body">
        {items.length === 0
          ? <div className="notification-center__empty">No notifications</div>
          : items.map((n, i) => <div key={i} className="notification-center__item">{n}</div>)}
      </div>
    </div>
  );
}
