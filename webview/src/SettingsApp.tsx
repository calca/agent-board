import { FlatButton } from './components/FlatButton';
import { AboutSection } from './components/settings/AboutSection';
import { GenAiSection } from './components/settings/GenAiSection';
import { KanbanSection } from './components/settings/KanbanSection';
import { LoggingSection } from './components/settings/LoggingSection';
import { McpSection } from './components/settings/McpSection';
import { ProvidersSection } from './components/settings/ProvidersSection';
import { SettingsPillNav } from './components/settings/SettingsPillNav';
import { SquadSection } from './components/settings/SquadSection';
import { WorktreeSection } from './components/settings/WorktreeSection';
import { useSettings } from './context/SettingsContext';
import { useSettingsMessages } from './hooks/useSettingsMessages';
import type { SectionId } from './settingsTypes';

const SECTION_COMPONENTS: Record<SectionId, () => React.JSX.Element> = {
  providers: ProvidersSection,
  genai: GenAiSection,
  kanban: KanbanSection,
  worktree: WorktreeSection,
  squad: SquadSection,
  mcp: McpSection,
  logging: LoggingSection,
  about: AboutSection,
};

export function SettingsApp() {
  useSettingsMessages();
  const { state, save, resetToFile } = useSettings();

  if (!state.loaded) {
    return (
      <div className="settings-loader">
        <div>Loading settings…</div>
      </div>
    );
  }

  const ActiveSection = SECTION_COMPONENTS[state.activeSection];
  const saveDisabled = !state.dirty || state.saveState === 'saving';

  let statusLabel = 'Saved';
  let statusClass = 'settings-status settings-status--saved';
  if (state.saveState === 'dirty') {
    statusLabel = 'Unsaved changes';
    statusClass = 'settings-status settings-status--dirty';
  } else if (state.saveState === 'saving') {
    statusLabel = 'Saving...';
    statusClass = 'settings-status settings-status--saving';
  } else if (state.saveState === 'error') {
    statusLabel = state.saveError ? `Save failed: ${state.saveError}` : 'Save failed';
    statusClass = 'settings-status settings-status--error';
  }

  return (
    <>
      <header className="settings-header">
        <div className="settings-header__top">
          <div className="settings-header__text">
            <h1>⚙ Project Settings</h1>
            <p className="settings-header__subtitle">.agent-board/config.json</p>
            <p className={statusClass} aria-live="polite">{statusLabel}</p>
          </div>
          <div className="settings-header__actions">
            <FlatButton variant="secondary" onClick={resetToFile}>Reset to file</FlatButton>
            <FlatButton variant="primary" onClick={save} disabled={saveDisabled}>Save</FlatButton>
          </div>
        </div>
        <SettingsPillNav />
      </header>
      <main className={`settings-content${state.activeSection === 'logging' ? ' settings-content--fill' : ''}`}>
        <section
          role="tabpanel"
          id={`settings-panel-${state.activeSection}`}
          aria-labelledby={`settings-tab-${state.activeSection}`}
        >
          <ActiveSection />
        </section>
      </main>
    </>
  );
}
