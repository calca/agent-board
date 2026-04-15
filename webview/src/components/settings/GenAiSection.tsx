import { useSettings } from '../../context/SettingsContext';

/** Known built-in GenAI providers with display metadata. */
const KNOWN_PROVIDERS = [
  { id: 'chat', displayName: 'Chat', hint: 'VS Code agent chat panel', scope: 'global' as const },
  { id: 'cloud', displayName: 'Cloud', hint: 'Autopilot via VS Code agent chat (auto-submits)', scope: 'global' as const },
  { id: 'copilot-cli', displayName: 'Copilot CLI', hint: 'GitHub Copilot CLI in terminal', scope: 'global' as const },
  { id: 'copilot-lm', displayName: 'Copilot LM API', hint: 'VS Code Language Model API with tool-calling', scope: 'global' as const },
] as const;

interface ProviderEntry {
  enabled?: boolean;
  model?: string;
  endpoint?: string;
  yolo?: boolean;
  fleet?: boolean;
  remote?: boolean;
}

export function GenAiSection() {
  const { state, dispatch } = useSettings();
  const genAi: Record<string, ProviderEntry> = state.config.genAiProviders ?? {};

  function updateProvider(id: string, patch: Partial<ProviderEntry>) {
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

  // Merge known providers with any custom ones from config
  const knownIds = new Set(KNOWN_PROVIDERS.map(p => p.id));
  const customIds = Object.keys(genAi).filter(id => !knownIds.has(id));

  return (
    <div className="section">
      <div className="section__title">GenAI Providers</div>
      <p className="section__subtitle" style={{ opacity: 0.6, fontSize: '0.85em', marginBottom: 16 }}>
        Configure GenAI providers for agent sessions. Global providers use VS Code settings by default — override per-project here.
      </p>

      {KNOWN_PROVIDERS.map(p => (
        <ProviderCard
          key={p.id}
          id={p.id}
          displayName={p.displayName}
          hint={p.hint}
          defaultEnabled={p.scope === 'global'}
          entry={genAi[p.id] ?? {}}
          onChange={patch => updateProvider(p.id, patch)}
        />
      ))}

      {customIds.map(id => (
        <ProviderCard
          key={id}
          id={id}
          displayName={id}
          hint="Custom provider"
          defaultEnabled={false}
          entry={genAi[id] ?? {}}
          onChange={patch => updateProvider(id, patch)}
        />
      ))}
    </div>
  );
}

function ProviderCard({ id, displayName, hint, defaultEnabled, entry, onChange }: {
  id: string;
  displayName: string;
  hint: string;
  defaultEnabled: boolean;
  entry: ProviderEntry;
  onChange: (patch: Partial<ProviderEntry>) => void;
}) {
  const enabled = entry.enabled ?? defaultEnabled;
  const showRemote = id === 'copilot-cli';

  return (
    <div className={`provider-card${enabled ? '' : ' provider-card--disabled'}`} style={{ marginBottom: 16 }}>
      <div className="provider-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id={`genai-${id}-enabled`} checked={enabled}
          onChange={e => onChange({ enabled: e.target.checked })} />
        <label htmlFor={`genai-${id}-enabled`} style={{ fontWeight: 600 }}>{displayName}</label>
        <span className="hint" style={{ marginLeft: 'auto' }}>{hint}</span>
      </div>
      {enabled && (
        <div className="cols-2" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor={`genai-${id}-model`}>Model</label>
            <input type="text" id={`genai-${id}-model`} value={entry.model ?? ''} placeholder="default"
              onChange={e => onChange({ model: e.target.value || undefined })} />
          </div>
          <div className="field">
            <label htmlFor={`genai-${id}-endpoint`}>Endpoint</label>
            <input type="text" id={`genai-${id}-endpoint`} value={entry.endpoint ?? ''} placeholder="default"
              onChange={e => onChange({ endpoint: e.target.value || undefined })} />
          </div>
          <div className="field field--checkbox">
            <label htmlFor={`genai-${id}-yolo`}>
              <input type="checkbox" id={`genai-${id}-yolo`} checked={entry.yolo ?? false}
                onChange={e => onChange({ yolo: e.target.checked })} />
              Yolo mode
            </label>
            <span className="hint">Auto-approve all changes without confirmation</span>
          </div>
          <div className="field field--checkbox">
            <label htmlFor={`genai-${id}-fleet`}>
              <input type="checkbox" id={`genai-${id}-fleet`} checked={entry.fleet ?? false}
                onChange={e => onChange({ fleet: e.target.checked })} />
              Fleet mode
            </label>
            <span className="hint">Optimise prompt for parallel fleet execution</span>
          </div>
          {showRemote && (
            <div className="field field--checkbox">
              <label htmlFor={`genai-${id}-remote`}>
                <input type="checkbox" id={`genai-${id}-remote`} checked={entry.remote ?? false}
                  onChange={e => onChange({ remote: e.target.checked })} />
                Remote mode
              </label>
              <span className="hint">Run session against the remote GitHub repository (--remote)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
