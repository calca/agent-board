import { useSettings } from '../../context/SettingsContext';

export function McpSection() {
  const { state, dispatch } = useSettings();
  const mcp = state.config.mcp ?? {};

  function update(patch: Record<string, unknown>) {
    dispatch({ type: 'updateConfig', patch: { mcp: { ...mcp, ...patch } } });
  }

  return (
    <div className="section">
      <div className="section__title">MCP Server</div>
      <div className="cols-2">
        <div className="field field--row">
          <input
            type="checkbox"
            id="mcp-enabled"
            checked={!!mcp.enabled}
            onChange={e => update({ enabled: e.target.checked })}
          />
          <label htmlFor="mcp-enabled">Enable MCP server</label>
        </div>
        <div className="field">
          <label htmlFor="mcp-path">Tasks path</label>
          <input
            type="text"
            id="mcp-path"
            value={mcp.tasksPath ?? ''}
            placeholder="(defaults to JSON provider path)"
            onChange={e => update({ tasksPath: e.target.value || undefined })}
          />
        </div>
      </div>
    </div>
  );
}
