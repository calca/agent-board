import { useSettings } from '../../context/SettingsContext';

export function KanbanSection() {
  const { state, dispatch } = useSettings();
  const intermediate = (state.config.kanban?.intermediateColumns ?? []).join(', ');

  return (
    <div className="section">
      <div className="section__title">Kanban Board</div>
      <p className="field__hint" style={{ marginBottom: 8 }}>
        The first column is always <strong>To Do</strong> and the last is always <strong>Done</strong>.
        Configure only the intermediate columns below.
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
      </div>
    </div>
  );
}
