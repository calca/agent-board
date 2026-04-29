import { useSettings } from '../../context/SettingsContext';

function numOrUndef(val: string): number | undefined {
  const n = Number(val);
  return isNaN(n) || val === '' ? undefined : n;
}

export function SquadSection() {
  const { state, dispatch } = useSettings();
  const sq = state.config.squad ?? {};
  const agents = state.agents;
  const teams: Array<{ name: string; agentSlug: string }> = sq.teams ?? [];

  function update(patch: Record<string, unknown>) {
    dispatch({ type: 'updateConfig', patch: { squad: { ...sq, ...patch } } });
  }

  function addTeam() {
    const newTeam = { name: '', agentSlug: agents.find(a => a.canSquad)?.slug ?? '' };
    update({ teams: [...teams, newTeam] });
  }

  function updateTeam(index: number, field: 'name' | 'agentSlug', value: string) {
    const updated = teams.map((t, i) => i === index ? { ...t, [field]: value } : t);
    update({ teams: updated });
  }

  function removeTeam(index: number) {
    update({ teams: teams.filter((_, i) => i !== index) });
  }

  return (
    <div className="section">
      <div className="section__title">Squad</div>
      <p className="section__hint">
        Only agents with <code>agent-board-squad: true</code> in their frontmatter appear in the squad agent selector.
        Add this to your <code>.github/agents/*.md</code> files to enable them for squad mode.
      </p>
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
        <div className="field field--checkbox">
          <label htmlFor="sq-autopr">
            <input type="checkbox" id="sq-autopr" checked={sq.autoPR ?? false}
              onChange={e => update({ autoPR: e.target.checked })} />
            Auto-PR on completion
          </label>
          <span className="hint">Automatically create a Pull Request when a squad session completes</span>
        </div>
      </div>

      <div className="section__subtitle">Teams</div>
      <p className="section__hint">
        Define named squad teams. Each team specifies an agent that handles its tasks.
        Select a squad agent per task in the Full View to override the default agent.
      </p>
      <div className="squad-teams">
        {teams.map((team, i) => (
          <div key={i} className="squad-team-row">
            <input
              type="text"
              className="squad-team-row__name"
              placeholder="Team name"
              value={team.name}
              onChange={e => updateTeam(i, 'name', e.target.value)}
            />
            <select
              className="squad-team-row__agent"
              value={team.agentSlug}
              onChange={e => updateTeam(i, 'agentSlug', e.target.value)}
            >
              <option value="">— Select agent —</option>
              {agents.map(a => (
                <option key={a.slug} value={a.slug}>{a.displayName}</option>
              ))}
            </select>
            <button
              type="button"
              className="squad-team-row__remove"
              title="Remove team"
              onClick={() => removeTeam(i)}
            >✕</button>
          </div>
        ))}
        <button type="button" className="squad-teams__add" onClick={addTeam}>
          + Add team
        </button>
      </div>
    </div>
  );
}
