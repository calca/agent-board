import { useSettings } from '../../context/SettingsContext';

export function WorktreeSection() {
  const { state, dispatch } = useSettings();
  const wt = state.config.worktree ?? {};

  function update(patch: Record<string, unknown>) {
    dispatch({ type: 'updateConfig', patch: { worktree: { ...wt, ...patch } } });
  }

  return (
    <div className="section">
      <div className="section__title">Worktree</div>
      <p className="section__intro">
        Keep each agent session isolated in its own git worktree to reduce branch conflicts and accidental cross-task edits.
      </p>
      <div className="cols-2">
        <div className="field field--row">
          <input
            type="checkbox"
            id="wt-enabled"
            checked={wt.enabled !== false}
            onChange={e => update({ enabled: e.target.checked })}
          />
          <label htmlFor="wt-enabled">Enable worktrees</label>
        </div>
        <div className="field field--row">
          <input
            type="checkbox"
            id="wt-confirm"
            checked={!!wt.confirmCleanup}
            onChange={e => update({ confirmCleanup: e.target.checked })}
          />
          <label htmlFor="wt-confirm">Confirm cleanup</label>
        </div>
      </div>
    </div>
  );
}
