import { useSettings } from '../../context/SettingsContext';

function numOrUndef(val: string): number | undefined {
  const n = Number(val);
  return isNaN(n) || val === '' ? undefined : n;
}

export function SquadSection() {
  const { state, dispatch } = useSettings();
  const sq = state.config.squad ?? {};

  function update(patch: Record<string, unknown>) {
    dispatch({ type: 'updateConfig', patch: { squad: { ...sq, ...patch } } });
  }

  return (
    <div className="section">
      <div className="section__title">Squad</div>
      <div className="cols-2">
        <div className="field">
          <label htmlFor="sq-max">Max sessions</label>
          <input type="number" id="sq-max" value={sq.maxSessions ?? 10}
            onChange={e => update({ maxSessions: numOrUndef(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="sq-timeout">Session timeout (ms)</label>
          <input type="number" id="sq-timeout" value={sq.sessionTimeout ?? 300000}
            onChange={e => update({ sessionTimeout: numOrUndef(e.target.value) })} />
          <span className="hint">0 = no timeout</span>
        </div>
        <div className="field">
          <label htmlFor="sq-source">Source column</label>
          <input type="text" id="sq-source" value={sq.sourceColumn ?? ''} placeholder="todo"
            onChange={e => update({ sourceColumn: e.target.value || undefined })} />
        </div>
        <div className="field">
          <label htmlFor="sq-active">Active column</label>
          <input type="text" id="sq-active" value={sq.activeColumn ?? ''} placeholder="inprogress"
            onChange={e => update({ activeColumn: e.target.value || undefined })} />
        </div>
        <div className="field">
          <label htmlFor="sq-done">Done column</label>
          <input type="text" id="sq-done" value={sq.doneColumn ?? ''} placeholder="review"
            onChange={e => update({ doneColumn: e.target.value || undefined })} />
        </div>
        <div className="field">
          <label htmlFor="sq-cooldown">Cooldown (ms)</label>
          <input type="number" id="sq-cooldown" value={sq.cooldownMs ?? 0}
            onChange={e => update({ cooldownMs: numOrUndef(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="sq-retries">Max retries</label>
          <input type="number" id="sq-retries" value={sq.maxRetries ?? 0}
            onChange={e => update({ maxRetries: numOrUndef(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="sq-interval">Auto-squad interval (ms)</label>
          <input type="number" id="sq-interval" value={sq.autoSquadInterval ?? 15000}
            onChange={e => update({ autoSquadInterval: numOrUndef(e.target.value) })} />
        </div>
      </div>
    </div>
  );
}
