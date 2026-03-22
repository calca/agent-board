# Agent Board

**Manage tasks. Run agents.** A Kanban-style task manager for VS Code with extensible providers and Copilot integration.

[![CI](https://github.com/calca/agent-board/actions/workflows/ci.yml/badge.svg)](https://github.com/calca/agent-board/actions/workflows/ci.yml)

## Features

- **Kanban Board** — drag-and-drop task management with configurable columns
- **Extensible Providers** — load tasks from GitHub Issues, local JSON files, Beads CLI, or any custom source
- **Copilot Integration** — launch Copilot sessions with full task context via extensible GenAI providers
- **Agent Squad** — launch multiple parallel agent sessions, with auto-squad mode that continuously monitors and fills slots as sessions complete
- **Squad Autonomy** — 10 configurable features: tunable polling, auto-retry, label-based priority, session timeout, worktree cleanup, concurrency guard, graceful shutdown, cooldown, label exclusion, assignee filtering
- **Git Worktree Support** — providers that support it (e.g. Copilot CLI) automatically create an isolated git worktree per task
- **Per-Project Configuration** — every setting can be overridden per project via `.agent-board/config.json`
- **GitHub SSO** — authenticate via VS Code's built-in GitHub SSO (no PAT required)
- **Tree Views** — sidebar tasks and agents views in the Activity Bar
- **Notifications** — configurable VS Code notifications for automatic task state changes
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
  "worktree": {
    "enabled": true
  },
  "genAiProviders": {
    "ollama": { "enabled": true, "model": "codellama" },
    "mistral": { "enabled": true, "model": "mistral-small-latest" }
  },
  "kanban": {
    "columns": ["todo", "inprogress", "review", "done"]
  },
  "squad": {
    "maxSessions": 10,
    "sourceColumn": "todo",
    "activeColumn": "inprogress",
    "doneColumn": "review",
    "autoSquadInterval": 15000,
    "maxRetries": 2,
    "priorityLabels": ["critical", "high", "medium"],
    "sessionTimeout": 300000,
    "cooldownMs": 2000,
    "excludeLabels": ["blocked", "manual"],
    "assigneeFilter": ""
  },
  "notifications": {
    "taskActive": true,
    "taskDone": true
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
| `agentBoard.worktree.enabled` | `true` | Create an isolated git worktree for providers that support it |
| `agentBoard.kanban.columns` | `["todo","inprogress","review","done"]` | Kanban column IDs |
| `agentBoard.squad.maxSessions` | `10` | Maximum parallel agent sessions |
| `agentBoard.squad.sourceColumn` | `"todo"` | Column from which the squad picks tasks |
| `agentBoard.squad.activeColumn` | `"inprogress"` | Column tasks move to when agent starts |
| `agentBoard.squad.doneColumn` | `"review"` | Column tasks move to when agent completes |
| `agentBoard.squad.autoSquadInterval` | `15000` | Auto-squad polling interval (ms) |
| `agentBoard.squad.maxRetries` | `0` | Max retries for failed sessions (0 = no retry) |
| `agentBoard.squad.priorityLabels` | `[]` | Ordered labels for task priority |
| `agentBoard.squad.sessionTimeout` | `300000` | Session timeout (ms), 0 = disabled |
| `agentBoard.squad.cooldownMs` | `0` | Delay between consecutive launches (ms) |
| `agentBoard.squad.excludeLabels` | `[]` | Labels that exclude tasks from the squad |
| `agentBoard.squad.assigneeFilter` | `""` | Assignee filter: `""` all, `"*"` assigned, `"unassigned"`, or username |
| `agentBoard.notifications.taskActive` | `true` | Notify when task moves to active column |
| `agentBoard.notifications.taskDone` | `true` | Notify when task moves to done column |
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

## Git Worktree Support

Providers that declare `supportsWorktree` (e.g. **Copilot CLI**) automatically create an
isolated git worktree under `.agent-board/worktrees/<taskId>` before the provider runs. This
lets the AI agent work on a dedicated branch without affecting the main working tree.

**Worktree creation is enabled by default.** To disable it:

```jsonc
// .agent-board/config.json
{
  "worktree": { "enabled": false }
}
```

Or via VS Code settings:

```json
{
  "agentBoard.worktree.enabled": false
}
```

## GenAI Providers

The Copilot integration uses an extensible provider architecture (`IGenAiProvider`). Each provider implements `id`, `displayName`, `icon`, `scope`, `isAvailable()`, `run()`, and `dispose()`.

### Global Providers (VS Code integrated)

These providers integrate with VS Code APIs and are always registered. Their configuration comes from VS Code settings and can be overridden per project.

| Provider | Description |
|----------|-------------|
| **Chat** (`chat`) | Opens VS Code native chat with task context pre-filled |
| **Cloud** (`cloud`) | Uses GitHub Copilot cloud model via `vscode.lm` API |
| **Copilot CLI** (`copilot-cli`) | Runs silently via `vscode.lm`, saves result to `.kanban-notes/` — **supports worktree** |

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

## Agent Squad

The **squad** feature launches multiple parallel GenAI sessions, one per task. It supports two modes:

- **Start Squad** — one-shot launch of up to `maxSessions` parallel agent sessions for tasks in the source column.
- **Auto Squad** — continuously monitors and fills available slots as sessions complete, on a configurable polling interval.

Tasks flow through three configurable columns:
1. **Source** (`squad.sourceColumn`, default `"todo"`) — tasks to be processed
2. **Active** (`squad.activeColumn`, default `"inprogress"`) — tasks currently being worked on
3. **Done** (`squad.doneColumn`, default `"review"`) — completed tasks

### Squad Autonomy Features

| Feature | Config Key | Default | Description |
|---------|-----------|---------|-------------|
| **Poll interval** | `squad.autoSquadInterval` | `15000` | How often auto-squad checks for new tasks (ms) |
| **Retry** | `squad.maxRetries` | `0` | Max retries for failed sessions (0 = no retry). Failed tasks move back to the source column. |
| **Priority** | `squad.priorityLabels` | `[]` | Ordered label list (e.g. `["critical", "high"]`). Tasks matching earlier labels launch first. |
| **Timeout** | `squad.sessionTimeout` | `300000` | Max session duration (ms). Prevents hung tasks from blocking the squad. 0 = no timeout. |
| **Cooldown** | `squad.cooldownMs` | `0` | Delay between consecutive launches (ms). Prevents rate-limiting the GenAI provider. |
| **Exclude labels** | `squad.excludeLabels` | `[]` | Skip tasks with these labels (e.g. `["blocked", "manual"]`). Case-insensitive. |
| **Assignee filter** | `squad.assigneeFilter` | `""` | `""` = all tasks, `"*"` = only assigned, `"unassigned"` = only unassigned, or exact username. |
| **Worktree cleanup** | *(automatic)* | — | Worktrees are removed in `try/finally` after each session completes or fails. |
| **Concurrency guard** | *(automatic)* | — | Prevents overlapping launch cycles from over-scheduling past `maxSessions`. |
| **Graceful shutdown** | *(automatic)* | — | On extension stop, active sessions are moved back to the source column with `gracefulShutdown` metadata. |

#### Example configuration

```jsonc
// .agent-board/config.json
{
  "squad": {
    "maxSessions": 5,
    "maxRetries": 2,
    "autoSquadInterval": 30000,
    "priorityLabels": ["critical", "high", "medium"],
    "sessionTimeout": 600000,
    "cooldownMs": 2000,
    "excludeLabels": ["blocked", "manual"],
    "assigneeFilter": "alice"
  }
}
```

### Notifications

VS Code notifications are shown when the squad automatically moves tasks between columns:

| Config Key | Default | Description |
|-----------|---------|-------------|
| `notifications.taskActive` | `true` | Notify when a task is moved to the active column |
| `notifications.taskDone` | `true` | Notify when a task is moved to the done column |

Failure notifications are always shown, regardless of configuration.

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
│   ├── CopilotCliGenAiProvider (global — background + file save, worktree)
│   ├── OllamaGenAiProvider (project — local HTTP)
│   └── MistralGenAiProvider (project — Mistral API)
├── SquadManager → parallel sessions, auto-squad, retry, priority, timeout
│   └── squadUtils.ts (pure helpers: computeAvailableSlots, canRetry, sortByPriority, isTimedOut, shouldExclude, matchesAssignee)
├── CopilotLauncher → ContextBuilder + GenAiProviderRegistry + WorktreeManager
├── WorktreeManager → git worktree create / remove
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
