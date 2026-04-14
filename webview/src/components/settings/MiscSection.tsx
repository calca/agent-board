import { useSettings } from '../../context/SettingsContext';

function numOrUndef(val: string): number | undefined {
  const n = Number(val);
  return isNaN(n) || val === '' ? undefined : n;
}

export function MiscSection() {
  const { state, dispatch } = useSettings();

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
      </div>
    </div>
  );
}
