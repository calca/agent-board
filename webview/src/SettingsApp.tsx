import { SettingsPillNav } from './components/settings/SettingsPillNav';
import { ProvidersSection } from './components/settings/ProvidersSection';
import { KanbanSection } from './components/settings/KanbanSection';
import { WorktreeSection } from './components/settings/WorktreeSection';
import { SquadSection } from './components/settings/SquadSection';
import { McpSection } from './components/settings/McpSection';
import { NotificationsSection } from './components/settings/NotificationsSection';
import { MiscSection } from './components/settings/MiscSection';
import { useSettings } from './context/SettingsContext';
import { useSettingsMessages } from './hooks/useSettingsMessages';
import type { SectionId } from './settingsTypes';

const SECTION_COMPONENTS: Record<SectionId, () => JSX.Element> = {
  providers: ProvidersSection,
  kanban: KanbanSection,
  worktree: WorktreeSection,
  squad: SquadSection,
  mcp: McpSection,
  notifications: NotificationsSection,
  misc: MiscSection,
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
            <button className="btn btn--secondary" onClick={resetToFile}>Reset to file</button>
            <button className="btn btn--primary" onClick={save}>Save</button>
          </div>
        </div>
        <SettingsPillNav />
      </header>
      <main className="settings-content">
        <ActiveSection />
      </main>
    </>
  );
}
