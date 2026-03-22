# Agent Board

**Manage tasks. Run agents.** A Kanban-style task manager for VS Code with extensible providers and Copilot integration.

[![CI](https://github.com/calca/agent-board/actions/workflows/ci.yml/badge.svg)](https://github.com/calca/agent-board/actions/workflows/ci.yml)

## Features

- **Kanban Board** — drag-and-drop task management with configurable columns
- **Extensible Providers** — load tasks from GitHub Issues, local JSON files, Beads CLI, or any custom source
- **Copilot Integration** — launch Copilot sessions with full task context (chat, cloud, local Ollama, or background mode)
- **Per-Project Configuration** — every setting can be overridden per project via `.agent-board/config.json`
- **GitHub SSO** — authenticate via VS Code's built-in GitHub SSO (no PAT required)
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

## Per-Project Configuration

Create a `.agent-board/config.json` file in the workspace root to override any VS Code setting per project. Values in this file take priority over VS Code settings.

```jsonc
// .agent-board/config.json
{
  "github": {
    "owner": "calca",
    "repo": "agent-board"
  },
  "jsonProvider": {
    "path": ".agent-board/tasks"
  },
  "beadsProvider": {
    "executable": "/usr/local/bin/beads"
  },
  "copilot": {
    "defaultMode": "chat",
    "localModel": "codellama"
  },
  "genAiProviders": {
    "ollama": { "enabled": true, "model": "codellama" },
    "mistral": { "enabled": true, "model": "mistral-small-latest" }
  },
  "kanban": {
    "columns": ["todo", "inprogress", "review", "done"]
  },
  "pollInterval": 15000,
  "logLevel": "DEBUG"
}
```

The file is validated with a JSON schema that provides autocomplete and inline documentation in VS Code.

## VS Code Settings

All settings can also be configured globally through **File > Preferences > Settings** (search for `agentBoard`). Per-project values in `.agent-board/config.json` take priority.

| Setting | Default | Description |
|---------|---------|-------------|
| `agentBoard.jsonProvider.path` | `".agent-board/tasks"` | Path to JSON tasks file |
| `agentBoard.beadsProvider.executable` | `"beads"` | Path to Beads CLI |
| `agentBoard.copilot.defaultMode` | `"chat"` | Default Copilot mode: `chat`, `cloud`, `local`, `background` |
| `agentBoard.copilot.localModel` | `"llama3"` | Ollama model name for local mode |
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
Authentication uses VS Code's built-in GitHub SSO — sign in via the **Accounts** menu. Repository coordinates (`owner`/`repo`) are configured in `.agent-board/config.json`.

### JSON File
Tasks are stored at `.agent-board/tasks` by default (override via `jsonProvider.path` in the config file or VS Code settings). Schema: [tasks.schema.json](schemas/tasks.schema.json)

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
Configure `beadsProvider.executable` in `.agent-board/config.json` or VS Code settings.

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
| **Chat** | Opens VS Code native chat with task context pre-filled (default) |
| **Cloud** | Uses GitHub Copilot via `vscode.lm` API |
| **Local** | Sends prompts to Ollama at `localhost:11434` |
| **Background** | Runs silently, saves results to `.kanban-notes/` |

## GenAI Providers

The Copilot integration uses an extensible provider architecture (`IGenAiProvider`). Each provider implements `id`, `displayName`, `icon`, `scope`, `isAvailable()`, `run()`, and `dispose()`.

### Global Providers (VS Code integrated)

These providers integrate with VS Code APIs and are always registered. Their configuration comes from VS Code settings and can be overridden per project.

| Provider | Description |
|----------|-------------|
| **Chat** (`chat`) | Opens VS Code native chat with task context pre-filled |
| **Cloud** (`cloud`) | Uses GitHub Copilot cloud model via `vscode.lm` API |
| **Copilot CLI** (`copilot-cli`) | Runs silently via `vscode.lm`, saves result to `.kanban-notes/` |

### Project Providers

These providers are enabled and configured per project in `.agent-board/config.json` under `genAiProviders`.

| Provider | Description |
|----------|-------------|
| **Ollama** (`ollama`) | Local Ollama model (default: `llama3`, endpoint: `localhost:11434`) |
| **Mistral** (`mistral`) | Mistral API (default model: `mistral-small-latest`, key via `MISTRAL_API_KEY` env var) |

#### Example configuration

```jsonc
// .agent-board/config.json
{
  "genAiProviders": {
    "ollama": { "enabled": true, "model": "codellama", "endpoint": "http://localhost:11434/api/generate" },
    "mistral": { "enabled": true, "model": "mistral-small-latest" }
  }
}
```

### Custom GenAI Providers

Register third-party GenAI providers via the extension API:

```typescript
const agentBoard = vscode.extensions.getExtension('agent-board');
const genAiRegistry = agentBoard?.exports?.genAiRegistry;
genAiRegistry?.register(myCustomGenAiProvider);
```

## Architecture

```
Extension Host (Node.js)
├── ProjectConfig → .agent-board/config.json (per-project overrides)
├── ProviderRegistry → ITaskProvider implementations
│   ├── GitHubProvider (REST API + VSCode SSO + cache)
│   ├── JsonProvider (FileSystemWatcher, default: .agent-board/tasks)
│   ├── BeadsProvider (CLI + polling)
│   └── AggregatorProvider (merge + dedup)
├── GenAiProviderRegistry → IGenAiProvider implementations
│   ├── ChatGenAiProvider (global — VS Code chat)
│   ├── CloudGenAiProvider (global — vscode.lm API)
│   ├── CopilotCliGenAiProvider (global — background + file save)
│   ├── OllamaGenAiProvider (project — local HTTP)
│   └── MistralGenAiProvider (project — Mistral API)
├── CopilotLauncher → ContextBuilder + GenAiProviderRegistry
├── KanbanPanel → WebView (HTML/CSS/JS)
│   ├── MessageBridge (typed postMessage)
│   └── theme.css (--vscode-* variables)
├── ChatParticipant (@taskai)
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
