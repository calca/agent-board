import { SECTIONS, type SectionId } from '../../settingsTypes';
import { useSettings } from '../../context/SettingsContext';

export function SettingsPillNav() {
  const { state, dispatch } = useSettings();

  return (
    <nav className="pill-nav">
      {SECTIONS.map(s => (
        <button
          key={s.id}
          className={`pill-nav__item${state.activeSection === s.id ? ' pill-nav__item--active' : ''}`}
          onClick={() => dispatch({ type: 'setActiveSection', section: s.id as SectionId })}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
