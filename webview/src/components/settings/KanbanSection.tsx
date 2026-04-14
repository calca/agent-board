import { useSettings } from '../../context/SettingsContext';

export function KanbanSection() {
  const { state, dispatch } = useSettings();
  const columns = (state.config.kanban?.columns ?? []).join(', ');

  return (
    <div className="section">
      <div className="section__title">Kanban Board</div>
      <div className="field">
        <label htmlFor="kanban-cols">Columns (comma-separated)</label>
        <input
          type="text"
          id="kanban-cols"
          value={columns}
          placeholder="todo, inprogress, review, done"
          onChange={e => {
            const arr = e.target.value
              ? e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              : undefined;
            dispatch({ type: 'updateConfig', patch: { kanban: { columns: arr } } });
          }}
        />
      </div>
    </div>
  );
}
