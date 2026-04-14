import { useSettings, postSettingsMessage } from '../../context/SettingsContext';
import type { ProviderInfo } from '../../settingsTypes';

function escHtml(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function DiagBadge({ diagnostic }: { diagnostic: ProviderInfo['diagnostic'] }) {
  if (!diagnostic) { return null; }
  const icon = diagnostic.severity === 'ok' ? '✓' : diagnostic.severity === 'warning' ? '⚠' : '✗';
  return (
    <span className={`diag diag--${diagnostic.severity}`}>
      {icon} {escHtml(diagnostic.message)}
    </span>
  );
}

function ProviderCard({ provider }: { provider: ProviderInfo }) {
  const { state, dispatch } = useSettings();
  const sectionCfg = state.config[provider.configSection] ?? {};

  function updateField(key: string, value: unknown) {
    dispatch({
      type: 'updateConfig',
      patch: {
        [provider.configSection]: {
          ...state.config[provider.configSection],
          enabled: true,
          [key]: value,
        },
      },
    });
  }

  function handleRemove() {
    const updated = { ...state.config[provider.configSection], enabled: false };
    dispatch({ type: 'updateConfig', patch: { [provider.configSection]: updated } });
    // Save immediately so provider deactivates
    postSettingsMessage({
      type: 'save',
      config: { ...state.config, [provider.configSection]: updated },
    });
  }

  return (
    <div className="provider-card">
      <div className="provider-header">
        <h3>{provider.displayName}</h3>
        <button className="btn--remove" onClick={handleRemove}>Remove</button>
      </div>
      {provider.fields.length > 0 && (
        <div className="cols-2">
          {provider.fields.map(f => {
            const val = sectionCfg[f.key] ?? '';
            const fieldId = `prov-${provider.id}-${f.key}`;
            if (f.type === 'boolean') {
              return (
                <div className="field field--row" key={f.key}>
                  <input
                    type="checkbox"
                    id={fieldId}
                    checked={!!val}
                    onChange={e => updateField(f.key, e.target.checked)}
                  />
                  <label htmlFor={fieldId}>{f.label}</label>
                </div>
              );
            }
            if (f.type === 'number') {
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={fieldId}>{f.label}{f.required ? ' *' : ''}</label>
                  <input
                    type="number"
                    id={fieldId}
                    value={val}
                    placeholder={f.placeholder}
                    onChange={e => updateField(f.key, e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                  {f.hint && <span className="hint">{f.hint}</span>}
                </div>
              );
            }
            return (
              <div className="field" key={f.key}>
                <label htmlFor={fieldId}>{f.label}{f.required ? ' *' : ''}</label>
                <input
                  type="text"
                  id={fieldId}
                  value={val}
                  placeholder={f.placeholder}
                  onChange={e => updateField(f.key, e.target.value || undefined)}
                />
                {f.hint && <span className="hint">{f.hint}</span>}
              </div>
            );
          })}
        </div>
      )}
      <DiagBadge diagnostic={provider.diagnostic} />
    </div>
  );
}

export function ProvidersSection() {
  const { state, dispatch, refreshDiagnostics } = useSettings();
  const providers = state.providers;
  const active = providers.filter(p => p.enabled);
  const available = providers.filter(p => !p.enabled);

  function handleEnable(p: ProviderInfo) {
    const updated = { ...state.config[p.configSection], enabled: true };
    dispatch({ type: 'updateConfig', patch: { [p.configSection]: updated } });
    postSettingsMessage({
      type: 'save',
      config: { ...state.config, [p.configSection]: updated },
    });
  }

  return (
    <div className="section">
      <div className="section__title">Task Providers</div>

      {providers.length === 0 && (
        <p style={{ opacity: 0.5, fontSize: '0.85em' }}>Loading provider information…</p>
      )}

      {active.length === 0 && providers.length > 0 && (
        <p style={{ opacity: 0.5, fontSize: '0.85em', marginBottom: 14 }}>No providers enabled. Add one below.</p>
      )}

      {active.map(p => <ProviderCard key={p.id} provider={p} />)}

      {available.length > 0 && (
        <>
          <div style={{ marginTop: 18, marginBottom: 10, fontWeight: 600, fontSize: '0.88em', opacity: 0.6 }}>
            + Add Provider
          </div>
          <div className="available-list">
            {available.map(p => (
              <div className="available-item" key={p.id}>
                <h4>{p.displayName}</h4>
                <DiagBadge diagnostic={p.diagnostic} />
                <button className="btn--add" onClick={() => handleEnable(p)}>Enable</button>
              </div>
            ))}
          </div>
        </>
      )}

      <button
        className="btn btn--secondary"
        style={{ marginTop: 12 }}
        onClick={refreshDiagnostics}
      >
        Re-check providers
      </button>
    </div>
  );
}
