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
      </div>
    </div>
  );
}
