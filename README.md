# Agent Board

**Manage tasks. Run agents.** A Kanban-style task manager for VS Code with extensible providers and Copilot integration.

[![CI](https://github.com/calca/agent-board/actions/workflows/ci.yml/badge.svg)](https://github.com/calca/agent-board/actions/workflows/ci.yml)

## Features

- **Kanban Board** — drag-and-drop task management with configurable columns
- **Extensible Providers** — load tasks from GitHub Issues, local JSON files, Beads CLI, or any custom source
- **Copilot Integration** — launch Copilot sessions with full task context (cloud, local Ollama, or background mode)
- **Tree Views** — sidebar tasks and agents views in the Activity Bar
- **Native Theming** — respects VS Code themes (Dark+, Light+, High Contrast)

## Installation

### From Marketplace
Search for **"Agent Board"** in the Extensions panel.

### From VSIX
1. Download the `.vsix` from the [Releases](https://github.com/calca/agent-board/releases) page
2. Run `code --install-extension agent-board-x.x.x.vsix`

### Development
```bash
git clone https://github.com/calca/agent-board.git
cd agent-board
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

## Configuration

Open **File > Preferences > Settings** and search for `agentBoard`:

| Setting | Default | Description |
|---------|---------|-------------|
| `agentBoard.github.token` | `""` | GitHub personal access token |
| `agentBoard.jsonProvider.path` | `""` | Path to JSON tasks file |
| `agentBoard.beadsProvider.executable` | `"beads"` | Path to Beads CLI |
| `agentBoard.copilot.defaultMode` | `"cloud"` | Default Copilot mode: `cloud`, `local`, `background` |
| `agentBoard.kanban.columns` | `["todo","inprogress","review","done"]` | Kanban column IDs |
| `agentBoard.pollInterval` | `30000` | Polling interval (ms) for providers |
| `agentBoard.logLevel` | `"INFO"` | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Agent Board: Open Kanban Board` | `Ctrl+Shift+K` | Open the Kanban board |
| `Agent Board: Refresh Tasks` | — | Refresh all task providers |
| `Agent Board: Select Task Provider` | — | Choose active provider |
| `Agent Board: Launch Copilot for Task` | — | Start Copilot with task context |
| `Agent Board: Add Task` | — | Add a new task |
| `Agent Board: Edit Task` | — | Edit an existing task |
| `Agent Board: Complete Task` | — | Mark task as complete |
| `Agent Board: Delete Task` | — | Delete a task |
| `Agent Board: Run Agent` | — | Start an agent |
| `Agent Board: Stop Agent` | — | Stop a running agent |

## Task Providers

### GitHub Issues
Set `agentBoard.github.token` to a PAT with `repo` scope. Tasks are loaded from the current workspace repository.

### JSON File
Set `agentBoard.jsonProvider.path` to a file path. Schema: [tasks.schema.json](schemas/tasks.schema.json)

```json
[
  {
    "id": "1",
    "title": "Implement feature X",
    "body": "Description in **Markdown**",
    "status": "todo",
    "labels": ["feature"],
    "assignee": "alice"
  }
]
```

### Beads CLI
Set `agentBoard.beadsProvider.executable` to your Beads installation path.

### Custom Providers
Register third-party providers via the extension API:

```typescript
const agentBoard = vscode.extensions.getExtension('agent-board');
const registry = agentBoard?.exports?.providerRegistry;
registry?.register(myCustomProvider);
```

## Copilot Modes

| Mode | Description |
|------|-------------|
| **Cloud** | Uses GitHub Copilot via `vscode.lm` API |
| **Local** | Sends prompts to Ollama at `localhost:11434` |
| **Background** | Runs silently, saves results to `.kanban-notes/` |

## Architecture

```
Extension Host (Node.js)
├── ProviderRegistry → ITaskProvider implementations
│   ├── GitHubProvider (REST API + cache)
│   ├── JsonProvider (FileSystemWatcher)
│   ├── BeadsProvider (CLI + polling)
│   └── AggregatorProvider (merge + dedup)
├── KanbanPanel → WebView (HTML/CSS/JS)
│   ├── MessageBridge (typed postMessage)
│   └── theme.css (--vscode-* variables)
├── CopilotLauncher
│   ├── ContextBuilder
│   ├── CloudRunner / LocalRunner / BackgroundRunner
│   └── ChatParticipant (@taskai)
└── Logger (Output channel)
```

## Development

```bash
npm run compile    # TypeScript compilation
npm run watch      # Watch mode
npm run lint       # ESLint
npm test           # Unit tests (Mocha)
node esbuild.config.js  # Bundle for distribution
```

## License

[MIT](LICENSE)
