export function AboutSection() {
  const mascotUri = document.getElementById('root')?.dataset.mascotUri ?? '';

  return (
    <div className="section about-section">
      <div className="section__title">About</div>

      <div className="about-hero">
        {mascotUri && <img className="about-mascot" src={mascotUri} alt="Agent Board mascot" />}
        <h2>Agent Board</h2>
        <p className="about-tagline">Manage tasks. Run agents. Ship faster.</p>
        <p className="about-version">v0.1.0</p>
      </div>

      <p className="about-desc">
        A Kanban-powered command center for VS Code that turns GitHub Issues
        into parallel AI coding sessions — with worktrees, live diffs,
        auto-PRs, and full MCP integration.
      </p>

      <div className="about-features">
        <h3>Key Features</h3>
        <ul>
          <li>Kanban board with drag-and-drop, customisable columns, search &amp; filter</li>
          <li>Agent Squad — up to 50 parallel AI sessions with auto-squad mode</li>
          <li>Git worktree isolation per task — no conflicts, no stashing</li>
          <li>Live session streaming with diff viewer</li>
          <li>MCP server for external agent integration</li>
          <li>GitHub Issues, Azure DevOps, JSON, Markdown, Beads providers</li>
          <li>Multiple GenAI backends: Copilot, Ollama, Mistral, LM API</li>
        </ul>
      </div>

      <div className="about-grid">
        <div className="about-card">
          <div className="about-card__label">Author</div>
          <div className="about-card__value">Gianluigi Calcaterra</div>
        </div>
        <div className="about-card">
          <div className="about-card__label">License</div>
          <div className="about-card__value">MIT</div>
        </div>
        <div className="about-card">
          <div className="about-card__label">Repository</div>
          <div className="about-card__value">
            <a href="https://github.com/calca/agent-board" target="_blank" rel="noopener noreferrer">
              github.com/calca/agent-board
            </a>
          </div>
        </div>
        <div className="about-card">
          <div className="about-card__label">VS Code</div>
          <div className="about-card__value">≥ 1.85.0</div>
        </div>
      </div>

      <p className="about-footer">
        Made with ♥ in Italy —{' '}
        <a href="https://github.com/calca/agent-board/issues" target="_blank" rel="noopener noreferrer">
          Report an issue
        </a>
      </p>
    </div>
  );
}
