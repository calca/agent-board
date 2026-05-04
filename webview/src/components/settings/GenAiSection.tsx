import { useSettings } from '../../context/SettingsContext';
import type { GenAiProviderInfo, GenAiSettingDescriptor } from '../../settingsTypes';

export function GenAiSection() {
  const { state, dispatch } = useSettings();
  const providers: GenAiProviderInfo[] = state.genAiProviders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const genAi: Record<string, Record<string, any>> = state.config.genAiProviders ?? {};

  function updateProvider(id: string, patch: Record<string, unknown>) {
    dispatch({
      type: 'updateConfig',
      patch: {
        genAiProviders: {
          ...genAi,
          [id]: { ...genAi[id], ...patch },
        },
      },
    });
  }

  return (
    <div className="section">
      <div className="section__title">GenAI Providers</div>
      <p className="section__intro">
        Choose which GenAI backends are available in this repository and override defaults only when the project needs special behavior.
      </p>

      {providers.length === 0 && (
        <p className="section-empty">Loading provider information…</p>
      )}

      {providers.map(p => (
        <ProviderCard
          key={p.id}
          provider={p}
          entry={genAi[p.id] ?? {}}
          onChange={patch => updateProvider(p.id, patch)}
        />
      ))}
    </div>
  );
}

function ProviderCard({ provider, entry, onChange }: {
  provider: GenAiProviderInfo;
  entry: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const enabled = (entry.enabled as boolean | undefined) ?? (provider.settings.length > 0);

  return (
    <div className={`provider-card${enabled ? '' : ' provider-card--disabled'}`}>
      <div className="provider-header">
        <input type="checkbox" id={`genai-${provider.id}-enabled`} checked={enabled}
          onChange={e => onChange({ enabled: e.target.checked })} />
        <label htmlFor={`genai-${provider.id}-enabled`}>{provider.displayName}</label>
        <span className="hint">{provider.description}</span>
      </div>
      {enabled && provider.settings.length > 0 && (
        <div className="cols-2">
          {provider.settings.map(s => (
            <SettingField
              key={s.key}
              providerId={provider.id}
              descriptor={s}
              value={entry[s.key]}
              onChange={val => onChange({ [s.key]: val })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingField({ providerId, descriptor, value, onChange }: {
  providerId: string;
  descriptor: GenAiSettingDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `genai-${providerId}-${descriptor.key}`;

  switch (descriptor.type) {
    case 'boolean': {
      const checked = (value as boolean | undefined) ?? (descriptor.defaultValue as boolean);
      return (
        <div className="field field--checkbox">
          <label htmlFor={id}>
            <input type="checkbox" id={id} checked={checked}
              onChange={e => onChange(e.target.checked)} />
            {descriptor.title}
          </label>
          <span className="hint">{descriptor.description}</span>
        </div>
      );
    }
    case 'string': {
      const strVal = (value as string | undefined) ?? '';
      return (
        <div className="field">
          <label htmlFor={id}>{descriptor.title}</label>
          <input type="text" id={id} value={strVal}
            placeholder={String(descriptor.defaultValue)}
            onChange={e => onChange(e.target.value || undefined)} />
          <span className="hint">{descriptor.description}</span>
        </div>
      );
    }
    case 'number': {
      const numVal = (value as number | undefined) ?? '';
      return (
        <div className="field">
          <label htmlFor={id}>{descriptor.title}</label>
          <input type="number" id={id} value={numVal}
            placeholder={String(descriptor.defaultValue)}
            onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)} />
          <span className="hint">{descriptor.description}</span>
        </div>
      );
    }
    case 'select': {
      const selVal = (value as string | number | boolean | undefined) ?? descriptor.defaultValue;
      return (
        <div className="field">
          <label htmlFor={id}>{descriptor.title}</label>
          <select id={id} value={String(selVal)}
            onChange={e => onChange(e.target.value)}>
            {(descriptor.options ?? []).map(opt => (
              <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
            ))}
          </select>
          <span className="hint">{descriptor.description}</span>
        </div>
      );
    }
  }
}
