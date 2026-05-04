import { useSettings } from '../../context/SettingsContext';
import { SECTIONS, type SectionId } from '../../settingsTypes';

export function SettingsPillNav() {
  const { state, dispatch } = useSettings();

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) { return; }
    e.preventDefault();
    const last = SECTIONS.length - 1;
    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight') { nextIdx = currentIdx === last ? 0 : currentIdx + 1; }
    if (e.key === 'ArrowLeft') { nextIdx = currentIdx === 0 ? last : currentIdx - 1; }
    if (e.key === 'Home') { nextIdx = 0; }
    if (e.key === 'End') { nextIdx = last; }
    const next = SECTIONS[nextIdx];
    dispatch({ type: 'setActiveSection', section: next.id as SectionId });
  }

  return (
    <nav className="pill-nav" role="tablist" aria-label="Settings sections">
      {SECTIONS.map((s, idx) => (
        <button
          key={s.id}
          id={`settings-tab-${s.id}`}
          role="tab"
          aria-selected={state.activeSection === s.id}
          aria-controls={`settings-panel-${s.id}`}
          tabIndex={state.activeSection === s.id ? 0 : -1}
          className={`pill-nav__item${state.activeSection === s.id ? ' pill-nav__item--active' : ''}`}
          onClick={() => dispatch({ type: 'setActiveSection', section: s.id as SectionId })}
          onKeyDown={e => onKeyDown(e, idx)}
        >
          <span>{s.label}</span>
          {state.dirtySections[s.id] && <span className="pill-nav__dirty-dot" aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
}
