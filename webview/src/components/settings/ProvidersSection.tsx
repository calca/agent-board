import { useCallback, useEffect, useRef, useState } from 'react';
import { postSettingsMessage, useSettings } from '../../context/SettingsContext';
import type { ProviderInfo } from '../../settingsTypes';
import { FlatButton } from '../FlatButton';

function escHtml(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Text input that stores a comma-separated string locally and syncs a `string[]` to config. */
function StatesField({ fieldId, value, placeholder, hint, label, required, onChange }: {
  fieldId: string;
  value: unknown;
  placeholder?: string;
  hint?: string;
  label: string;
  required?: boolean;
  onChange: (arr: string[] | undefined) => void;
}) {
  const display = Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
  const [text, setText] = useState(display);
  const localEdit = useRef(false);

  // Sync external value changes (e.g. config reload) — skip when user is typing
  useEffect(() => {
    if (!localEdit.current) { setText(display); }
    localEdit.current = false;
  }, [display]);

  function handleChange(raw: string) {
    localEdit.current = true;
    setText(raw);
    // Keep config in sync on every keystroke so Save always has the latest value.
    // Send [] (not undefined) when empty — undefined is stripped by JSON.stringify
    // and the merge with the existing file would preserve the old value.
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
    onChange(arr);
  }

  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}{required ? ' *' : ''}</label>
      <input
        type="text"
        id={fieldId}
        value={text}
        placeholder={placeholder}
        onChange={e => handleChange(e.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
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

function ProviderCard({ provider, onRemove }: { provider: ProviderInfo; onRemove?: () => void }) {
  const { state, dispatch } = useSettings();
  const sectionCfg = state.config[provider.configSection] ?? {};

  function updateField(key: string, value: unknown) {
    dispatch({
      type: 'updateSectionField',
      section: provider.configSection,
      key,
      value,
    });
  }

  return (
    <>
      <div className="provider-header">
        <h3>{provider.displayName}</h3>
        <FlatButton variant="danger" size="sm" onClick={onRemove}>Remove</FlatButton>
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
              const hasError = !!f.required && (val === '' || val === undefined || Number.isNaN(val));
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
                  {hasError
                    ? <span className="hint hint--error">This field is required.</span>
                    : f.hint && <span className="hint">{f.hint}</span>}
                </div>
              );
            }
            if (f.key === 'states') {
              return (
                <StatesField
                  key={f.key}
                  fieldId={fieldId}
                  value={val}
                  placeholder={f.placeholder}
                  hint={f.hint}
                  label={f.label}
                  required={f.required}
                  onChange={arr => updateField(f.key, arr)}
                />
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
                {!!f.required && !val
                  ? <span className="hint hint--error">This field is required.</span>
                  : f.hint && <span className="hint">{f.hint}</span>}
              </div>
            );
          })}
        </div>
      )}
      <DiagBadge diagnostic={provider.diagnostic} />
    </>
  );
}

/**
 * Manages enable/disable provider transitions with smooth animations.
 *
 * Uses a local override map so we control the visual state independently
 * of host re-renders (which arrive when the config file watcher fires).
 *
 *   Enable:  available-item fades out → appears as card with fade-in → persist
 *   Remove:  card fades out → reappears as available item → persist
 */
export function ProvidersSection() {
  const { state, dispatch, configRef, refreshDiagnostics } = useSettings();
  const providers = state.providers;

  // Local override: id → true (force active) | false (force available)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // Animation phase: id → 'fade-out' | 'fade-in'
  const [anims, setAnims] = useState<Record<string, 'fade-out' | 'fade-in'>>({});
  const pendingSave = useRef<Map<string, { section: string; enabled: boolean }>>(new Map());

  const effectiveProviders = providers.map(p => {
    if (p.id in overrides) {
      return { ...p, enabled: overrides[p.id] };
    }
    return p;
  });

  const active = effectiveProviders.filter(p => p.enabled);
  const available = effectiveProviders.filter(p => !p.enabled);

  // Clear overrides once host data confirms the expected state
  useEffect(() => {
    setOverrides(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [id, enabled] of Object.entries(next)) {
        const p = providers.find(pr => pr.id === id);
        if (p && p.enabled === enabled) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [providers]);

  const commitSave = useCallback((id: string) => {
    const pending = pendingSave.current.get(id);
    if (!pending) { return; }
    pendingSave.current.delete(id);

    dispatch({
      type: 'updateSectionField',
      section: pending.section,
      key: 'enabled',
      value: pending.enabled,
    });
    // Use configRef for the latest config to avoid stale closure
    const current = configRef.current;
    const updated = { ...current[pending.section], enabled: pending.enabled };
    postSettingsMessage({
      type: 'save',
      config: { ...current, [pending.section]: updated },
    });
    // Override stays until host confirms via providerDiagnostics
  }, [dispatch, configRef]);

  function handleEnable(p: ProviderInfo) {
    pendingSave.current.set(p.id, { section: p.configSection, enabled: true });
    setAnims(prev => ({ ...prev, [p.id]: 'fade-out' }));
  }

  function handleDisable(p: ProviderInfo) {
    pendingSave.current.set(p.id, { section: p.configSection, enabled: false });
    setAnims(prev => ({ ...prev, [p.id]: 'fade-out' }));
  }

  function onAnimEnd(id: string, wasEnabled: boolean) {
    const phase = anims[id];
    if (phase === 'fade-out') {
      // Flip the override and start fade-in in the new position
      setOverrides(prev => ({ ...prev, [id]: !wasEnabled }));
      setAnims(prev => ({ ...prev, [id]: 'fade-in' }));
    } else if (phase === 'fade-in') {
      // Animation complete — persist and clean up
      setAnims(prev => { const n = { ...prev }; delete n[id]; return n; });
      commitSave(id);
    }
  }

  return (
    <div className="section">
      <div className="section__title">Issue Providers</div>
      <p className="section__intro">
        Enable only the issue sources you actually use in this project. Configure credentials here to avoid runtime failures when syncing tasks.
      </p>

      {providers.length === 0 && (
        <p className="section-empty">Loading provider information…</p>
      )}

      {active.length === 0 && providers.length > 0 && (
        <p className="section-empty">No providers enabled. Add one below.</p>
      )}

      {active.map(p => {
        const anim = anims[p.id];
        const cls = anim === 'fade-out' ? ' provider-card--fade-out'
          : anim === 'fade-in' ? ' provider-card--fade-in' : '';
        return (
          <div
            key={p.id}
            className={`provider-card${cls}`}
            onAnimationEnd={() => onAnimEnd(p.id, true)}
          >
            <ProviderCard provider={p} onRemove={() => handleDisable(p)} />
          </div>
        );
      })}

      {available.length > 0 && (
        <>
          <div className="section-subhead">
            + Add Provider
          </div>
          <div className="available-list">
            {available.map(p => {
              const anim = anims[p.id];
              const cls = anim === 'fade-out' ? ' available-item--fade-out'
                : anim === 'fade-in' ? ' available-item--fade-in' : '';
              return (
                <div
                  className={`available-item${cls}`}
                  key={p.id}
                  onAnimationEnd={() => onAnimEnd(p.id, false)}
                >
                  <h4>{p.displayName}</h4>
                  <DiagBadge diagnostic={p.diagnostic} />
                  <FlatButton variant="primary" size="sm" onClick={() => handleEnable(p)}>Enable</FlatButton>
                </div>
              );
            })}
          </div>
        </>
      )}

      <FlatButton
        variant="secondary"
        style={{ marginTop: 12 }}
        onClick={refreshDiagnostics}
      >
        Re-check providers
      </FlatButton>
    </div>
  );
}
