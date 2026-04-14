import { useSettings } from '../../context/SettingsContext';

function numOrUndef(val: string): number | undefined {
  const n = Number(val);
  return isNaN(n) || val === '' ? undefined : n;
}

export function MiscSection() {
  const { state, dispatch } = useSettings();
  const logLevel = state.config.logLevel ?? '';

  return (
    <div className="section">
      <div className="section__title">Misc</div>
      <div className="cols-2">

        <div className="field">
          <label htmlFor="poll-interval">Poll interval (ms)</label>
          <input
            type="number"
            id="poll-interval"
            value={state.config.pollInterval ?? ''}
            placeholder="default"
            onChange={e =>
              dispatch({ type: 'updateConfig', patch: { pollInterval: numOrUndef(e.target.value) } })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="log-level">Log level</label>
          <select
            id="log-level"
            value={logLevel}
            onChange={e =>
              dispatch({ type: 'updateConfig', patch: { logLevel: e.target.value || undefined } })
            }
          >
            <option value="">Default</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>
    </div>
  );
}
