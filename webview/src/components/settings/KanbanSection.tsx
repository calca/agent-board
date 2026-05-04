import { useSettings } from '../../context/SettingsContext';

export function KanbanSection() {
  const { state, dispatch } = useSettings();
  const intermediateCols: string[] = state.config.kanban?.intermediateColumns ?? [];
  const intermediate = intermediateCols.join(', ');

  const hasDuplicates = new Set(intermediateCols.map(v => v.toLowerCase())).size !== intermediateCols.length;
  const hasReserved = intermediateCols.some(v => ['todo', 'done'].includes(v.toLowerCase()));
  const hasBlank = intermediateCols.some(v => !v.trim());
  const validationError = hasDuplicates
    ? 'Column names must be unique.'
    : hasReserved
      ? 'Do not include To Do or Done as intermediate columns.'
      : hasBlank
        ? 'Column names cannot be empty.'
        : '';

  return (
    <div className="section">
      <div className="section__title">Kanban Board</div>
      <p className="section__intro">
        The first column is always <strong>To Do</strong> and the last is always <strong>Done</strong>.
        Configure only intermediate columns here, ordered from left to right.
      </p>
      <div className="field">
        <label htmlFor="kanban-cols">Intermediate columns (comma-separated)</label>
        <input
          type="text"
          id="kanban-cols"
          value={intermediate}
          placeholder="inprogress, review"
          onChange={e => {
            const arr = e.target.value
              ? e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              : undefined;
            dispatch({ type: 'updateConfig', patch: { kanban: { intermediateColumns: arr } } });
          }}
        />
        {validationError && <span className="hint hint--error">{validationError}</span>}
      </div>
    </div>
  );
}
