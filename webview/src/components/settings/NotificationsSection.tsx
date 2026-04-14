import { useSettings } from '../../context/SettingsContext';

export function NotificationsSection() {
  const { state, dispatch } = useSettings();
  const notif = state.config.notifications ?? {};

  function update(patch: Record<string, unknown>) {
    dispatch({ type: 'updateConfig', patch: { notifications: { ...notif, ...patch } } });
  }

  return (
    <div className="section">
      <div className="section__title">Notifications</div>
      <div className="cols-2">
        <div className="field field--row">
          <input
            type="checkbox"
            id="notif-active"
            checked={notif.taskActive !== false}
            onChange={e => update({ taskActive: e.target.checked })}
          />
          <label htmlFor="notif-active">Task moved to active</label>
        </div>
        <div className="field field--row">
          <input
            type="checkbox"
            id="notif-done"
            checked={notif.taskDone !== false}
            onChange={e => update({ taskDone: e.target.checked })}
          />
          <label htmlFor="notif-done">Task moved to done</label>
        </div>
      </div>
    </div>
  );
}
