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

  return (
    <>
      <header className="settings-header">
        <div className="settings-header__top">
          <div className="settings-header__text">
            <h1>⚙ Project Settings</h1>
            <p className="settings-header__subtitle">.agent-board/config.json</p>
          </div>
          <div className="settings-header__actions">
            <FlatButton variant="secondary" onClick={resetToFile}>Reset to file</FlatButton>
            <FlatButton variant="primary" onClick={save}>Save</FlatButton>
          </div>
        </div>
        <SettingsPillNav />
      </header>
      <main className={`settings-content${state.activeSection === 'logging' ? ' settings-content--fill' : ''}`}>
        <ActiveSection />
      </main>
    </>
  );
}
