<!-- markdownlint-disable MD033 MD041 MD024 -->
<div align="center">

<img src="media/mascotte.png" alt="Agent Board mascot" width="140" />

# Agent Board

**Manage tasks. Run agents. Ship faster.**

A Kanban-powered command center for VS Code that turns GitHub Issues into parallel AI coding sessions — with worktrees, live diffs, auto-PRs, and full MCP integration.

[![CI](https://github.com/calca/agent-board/actions/workflows/ci.yml/badge.svg)](https://github.com/calca/agent-board/actions/workflows/ci.yml)
[![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.85.0-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=agent-board)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## Why Agent Board?

Modern AI coding assistants are powerful — but managing **multiple tasks across multiple agents** is still manual, fragile, and slow. Agent Board fixes that.

- **One board to rule them all.** Drag tasks across columns. Each card can launch an autonomous AI session with one click.
- **Parallel agent squads.** Spin up 10+ simultaneous Copilot sessions — each on its own git worktree, each streaming live output back to the board.
- **From issue to PR in zero clicks.** Auto-squad picks tasks, launches agents, tracks diffs, and opens pull requests — all while you review the last batch.
- **Works with your stack.** GitHub Issues, Azure DevOps, local JSON, Beads CLI, or your own provider. Copilot, LM API, or your own GenAI backend.
- **MCP-native.** External agents can list, create, update, and delete tasks via the built-in Model Context Protocol server.

---

## Key Features

### Kanban Board

Drag-and-drop task management with fully configurable columns, search/filter, live session badges, and native VS Code theming (Dark+, Light+, High Contrast).

### Agent Squad

Launch up to 50 parallel AI sessions. **Auto-squad** mode continuously polls for new tasks and fills available slots as sessions complete — with retry, priority, cooldown, timeout, label exclusion, and assignee filtering.

### Live Session Panel

Split-view streaming: agent output on the left, changed files on the right. Real-time tool-call status, auto-scroll, follow-up input, and one-click full diff.

### Git Worktree Isolation

Each agent session gets its own worktree and branch — no conflicts, no stashing, no context switching. Review, merge (squash/rebase/merge), or delete directly from the board.

### Pull Requests

When a task completes, a **"Create Pull Request"** button appears on the card. One click creates a GitHub PR (via `gh` CLI) or opens the Azure DevOps PR creation page — with branch and changed-file list pre-filled. Auto-squad can also create PRs automatically.

### MCP Server

Stdio-based Model Context Protocol server for full CRUD: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`. Any MCP-compatible agent can manage your board.

### Extensible Providers

GitHub Issues (via `gh` CLI), Azure DevOps, Markdown files, local JSON, Beads CLI — or register your own via the extension API. GenAI providers: VS Code Chat, Cloud (vscode.lm), Copilot CLI, LM API with tool-calling — or register your own.

---

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

---

# Technical Reference

## Per-Project Configuration

Create a `.agent-board/config.json` file in the workspace root to override any VS Code setting per project. Values in this file take priority over VS Code settings. The file is validated with a JSON schema that provides autocomplete and inline documentation.

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
  "markdownProvider": {
    "enabled": true,
    "inboxPath": ".agent-board/markdown/inbox",
    "donePath": ".agent-board/markdown/done"
  },
  "beadsProvider": {
    "executable": "/usr/local/bin/beads"
  },
  "worktree": {
    "enabled": true
  },
  "genAiProviders": {
    "copilot-cli": { "yolo": true, "fleet": true },
  },
  "kanban": {
    "columns": ["backlog", "todo", "inprogress", "review", "done"]
  },
  "squad": {
    "maxSessions": 10,
    "sourceColumn": "todo",
    "activeColumn": "inprogress",
    "doneColumn": "review",
    "autoSquadInterval": 15000,
    "maxRetries": 2,
    "sessionTimeout": 300000,
    "cooldownMs": 2000
  },
  "notifications": {
    "taskActive": true,
    "taskDone": true
  },
  "mcp": {
    "enabled": true,
    "tasksPath": ".agent-board/tasks"
  },
  "logLevel": "DEBUG"
}
```

### Flexible Columns

Column identifiers are arbitrary strings. The first column is always `todo` and the last is always `done`. You can customise only the intermediate columns:

```jsonc
{
  "kanban": { "intermediateColumns": ["ready", "doing", "qa"] },
  "squad": {
    "sourceColumn": "todo",
    "activeColumn": "doing",
    "doneColumn": "qa"
  }
}
```

## VS Code Settings

All settings can also be configured globally through **File > Preferences > Settings** (search for `agentBoard`). Per-project values in `.agent-board/config.json` take priority.

| Setting | Default | Description |
| --------- | --------- | ------------- |
| `agentBoard.jsonProvider.path` | `".agent-board/tasks"` | Path to JSON tasks file |
| `agentBoard.markdownProvider.inboxPath` | `".agent-board/markdown/inbox"` | Inbox directory for `.md` task files |
| `agentBoard.markdownProvider.donePath` | `".agent-board/markdown/done"` | Directory where done `.md` files are moved |
| `agentBoard.beadsProvider.executable` | `"beads"` | Path to Beads CLI |
| `agentBoard.worktree.enabled` | `true` | Create an isolated git worktree for providers that support it |
| `agentBoard.copilotCli.yolo` | `true` | Enable `/yolo` mode — auto-approve all changes without confirmation |
| `agentBoard.copilotCli.fleet` | `false` | Enable `/fleet` mode — optimise prompt for parallel fleet execution |
| `agentBoard.kanban.intermediateColumns` | `["inprogress","review"]` | Intermediate column IDs between todo and done |
| `agentBoard.copilotModel` | `""` | Preferred Copilot model family (e.g. `gpt-4o`). Empty = default |
| `agentBoard.contextDepth` | `"standard"` | Context depth: `minimal`, `standard`, `full` (file tree + git) |
| `agentBoard.sessionTimeoutMinutes` | `5` | Max session duration in minutes (0 = disabled) |
| `agentBoard.autoCleanWorktreeOnDone` | `false` | Remove worktree when session completes |
| `agentBoard.squad.maxSessions` | `10` | Maximum parallel agent sessions |
| `agentBoard.squad.sourceColumn` | `"todo"` | Column from which the squad picks tasks |
| `agentBoard.squad.activeColumn` | `"inprogress"` | Column tasks move to when agent starts |
| `agentBoard.squad.doneColumn` | `"review"` | Column tasks move to when agent completes |
| `agentBoard.squad.autoSquadInterval` | `15000` | Auto-squad polling interval (ms) |
| `agentBoard.squad.maxRetries` | `0` | Max retries for failed sessions (0 = no retry) |
| `agentBoard.squad.sessionTimeout` | `300000` | Session timeout (ms), 0 = disabled |
| `agentBoard.squad.cooldownMs` | `0` | Delay between consecutive launches (ms) |
| `agentBoard.notifications.taskActive` | `true` | Notify when task moves to active column |
| `agentBoard.notifications.taskDone` | `true` | Notify when task moves to done column |
| `agentBoard.logLevel` | `"INFO"` | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

## Commands

| Command | Shortcut | Description |
| --------- | ---------- | ------------- |
| `Agent Board: Open Kanban Board` | `Ctrl+Shift+K` / `Cmd+Shift+K` | Open the Kanban board |
| `Agent Board: Refresh Tasks` | — | Refresh all task providers |
| `Agent Board: Select Task Provider` | — | Choose active provider |
| `Agent Board: Launch Copilot for Task` | — | Start a GenAI session with task context |
| `Agent Board: Start Squad Session` | — | One-shot launch of parallel agent sessions |
| `Agent Board: Toggle Auto Squad` | — | Enable/disable continuous auto-squad mode |
| `Agent Board: Add Task` | — | Add a new task |
| `Agent Board: Edit Task` | — | Edit an existing task |
| `Agent Board: Complete Task` | — | Mark task as complete |
| `Agent Board: Delete Task` | — | Delete a task |
| `Agent Board: Run Agent` | — | Start a simulation agent |
| `Agent Board: Stop Agent` | — | Stop a running agent |
| `Agent Board: Project Settings` | — | Open per-project settings panel |
| `Agent Board: Toggle Maximize` | — | Hide/show sidebar for full-width board |

## Task Providers

### GitHub Issues

Requires the [GitHub CLI](https://cli.github.com) (`gh`). Install via `brew install gh` and authenticate with `gh auth login`. Repository coordinates (`owner`/`repo`) are auto-detected from `gh repo view`, VS Code settings, or `.agent-board/config.json`. Supports Kanban label sync (`kanban:todo`, `kanban:in-progress`, etc.), conditional polling with ETag, and avatar caching.

### Azure DevOps

Uses the `az boards` CLI. Maps Azure DevOps work item states to Kanban columns. Configurable polling interval and done-task cleanup. Supports "Create Pull Request" button — opens the Azure DevOps PR creation page with source branch pre-filled.

### JSON File

Tasks are stored at `.agent-board/tasks` by default (override via `jsonProvider.path`). File changes are auto-detected via `FileSystemWatcher`. Schema: [tasks.schema.json](schemas/tasks.schema.json)

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

### Markdown Files

Each `.md` file in an inbox directory becomes a task — the filename is the title, the content is the body. Done tasks are automatically moved to a separate directory. Enable via `.agent-board/config.json`:

```jsonc
{
  "markdownProvider": {
    "enabled": true,
    "inboxPath": ".agent-board/markdown/inbox",
    "donePath": ".agent-board/markdown/done"
  }
}
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

Providers that declare `supportsWorktree` (e.g. **Copilot CLI**, **LM API**) automatically create an isolated git worktree before the session runs. Each task gets its own branch (`agent-board/<taskId>`) outside the repo root, so agents never conflict with each other or with your working tree.

From the board you can: **open** the worktree in a new window, **review** changes (multi-file diff), **create a PR** (GitHub or Azure DevOps), **merge** (squash/merge/rebase), **align** from the base branch, run **agent-merge**, or **delete** the worktree.

### Base Branch Selection

The board shows a **branch selector** in the squad toolbar and in the full-view actions panel. You can choose which branch to use as the base for worktree creation and merge targets.

- **Single branch** — displayed as a read-only pill (same style as the Auto toggle).
- **Multiple branches** — dropdown selector. Worktree branches (`agent-board/*`) are automatically filtered out.
- The selected branch is propagated to worktree creation, diff watchers, merge operations, align prompts, and PR creation.

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

| Provider | Description | Worktree | Tool Calling | Auto-Advance |
| ---------- | ------------- | :--------: | :------------: | :------------: |
| **Chat** (`chat`) | Opens VS Code native chat with task context pre-filled | — | Yes | Manual |
| **Cloud** (`cloud`) | Autopilot mode via VS Code agent chat (auto-submits) | — | — | Automatic |
| **Copilot CLI** (`copilot-cli`) | Background subprocess, streams output, saves to `.kanban-notes/` | Yes | — | Automatic |
| **LM API** (`copilot-lm`) | Direct `vscode.lm` calls with full tool-calling loop (up to 100 rounds) | Yes | Yes | Automatic |

#### Copilot CLI Optimisations

| Flag | Config Key | Default | Description |
| ------ | ----------- | --------- | ------------- |
| `/yolo` | `genAiProviders.copilot-cli.yolo` | `true` | Auto-approve all changes — the model applies changes autonomously |
| `/fleet` | `genAiProviders.copilot-cli.fleet` | `false` | Optimise for parallel execution — focus on assigned task, avoid conflicts |

```jsonc
{
  "genAiProviders": {
    "copilot-cli": { "yolo": true, "fleet": true }
  }
}
```

### Custom GenAI Providers

Any extension can register its own GenAI provider at runtime via the extension API.
A provider must implement the `IGenAiProvider` interface (see below) and register itself through the exported `genAiRegistry`.

```typescript
import * as vscode from 'vscode';

const agentBoard = vscode.extensions.getExtension('agent-board');
const genAiRegistry = agentBoard?.exports?.genAiRegistry;

genAiRegistry?.register({
  id: 'my-provider',
  displayName: 'My Provider',
  icon: 'hubot',
  scope: 'project',            // 'global' | 'project'
  supportsWorktree: true,       // set to true if the provider can work inside a git worktree
  async isAvailable() { return true; },
  async run(prompt, task, worktreePath) {
    // call your LLM here
  },
  dispose() {},
});
```

Providers can optionally:

| Field / Method | Purpose |
| --- | --- |
| `onDidStream` | `vscode.Event<string>` — stream chunks to the live session panel |
| `onDidToolCall` | `vscode.Event<string>` — show tool-call status in the UI |
| `sendFollowUp(text)` | Multi-turn conversations (e.g. chat-style providers) |
| `cancel()` | Cancel a running request |
| `disableAutoAdvance` | Prevent auto-moving the task to done/failed after `run()` |

Per-provider settings can be stored in `.agent-board/config.json` under `genAiProviders.<id>`:

```jsonc
{
  "genAiProviders": {
    "my-provider": { "enabled": true, "model": "my-model", "endpoint": "http://localhost:8080" }
  }
}
```

Each entry supports `enabled`, `model`, `endpoint`, `yolo`, and `fleet` — all optional.

## Agent Tools

The LM API and Chat providers expose five tools to the model via `vscode.lm` tool-calling:

| Tool | Description | Security |
| ------ | ------------- | ---------- |
| `read_file` | Read file content | Path traversal guard |
| `write_file` | Write file (creates directories) | Path traversal guard |
| `run_command` | Shell command (30s timeout) | User confirmation (unless yolo) |
| `get_diff` | `git diff` for the workspace | — |
| `list_files` | Directory listing | Path traversal guard |

## Agent Selection

When `.github/agents/` contains Markdown files, Agent Board automatically discovers them and exposes an **agent picker**:

- **Single task** — select an agent before clicking "Launch Copilot"; instructions are prepended to the context.
- **Squad / Auto-Squad** — dropdown near the squad buttons; every launched session uses the selected agent.
- **Command palette** — Quick Pick appears when starting a squad (if agents are available).

### Agent file format

Each `.md` file in `.github/agents/` defines an agent. The filename (without extension) becomes the **slug**. The first `# Heading` is the display name; no heading → auto title-cased.

To make an agent available in the **squad selector**, add `agent-board-squad: true` to the frontmatter:

```markdown
---
agent-board-squad: true
---
# Code Reviewer

Review pull requests and suggest improvements.
```

Agents **without** `agent-board-squad: true` are still discovered and available for single-task launches, but they will not appear in the squad agent dropdown.

```text
.github/agents/
├── code-reviewer.md     → slug: "code-reviewer", name: "Code Reviewer"
├── test-writer.md       → slug: "test-writer",   name: "Test Writer"
└── doc-updater.md       → slug: "doc-updater",   name: "Doc Updater"
```

## Agent Squad

The **squad** launches multiple parallel GenAI sessions, one per task:

- **Start Squad** — one-shot launch of up to `maxSessions` sessions for tasks in the source column.
- **Auto Squad** — continuously monitors and fills slots as sessions complete.

Tasks flow: **Source** → **Active** → **Done** (all three columns are configurable).

### Auto-Advance

Each GenAI provider declares whether task progression is automatic or manual:

- **Automatic** (default) — when the session completes successfully the task moves to the done column; on failure it is retried or moved back to the source column.
- **Manual** (`disableAutoAdvance: true`) — the task moves to the active column on launch but stays there when the session ends. The user decides when to advance it.

The **Chat** provider is manual by default (interactive session). All other built-in providers (Cloud, Copilot CLI, LM API) use automatic advancement.

### Squad Autonomy Features

| Feature | Config Key | Default | Description |
| --------- | ----------- | --------- | ------------- |
| **Poll interval** | `squad.autoSquadInterval` | `15000` | Auto-squad check frequency (ms) |
| **Retry** | `squad.maxRetries` | `0` | Max retries for failed sessions |
| **Timeout** | `squad.sessionTimeout` | `300000` | Max session duration (ms) |
| **Cooldown** | `squad.cooldownMs` | `0` | Delay between launches (ms) |
| **Worktree cleanup** | *(automatic)* | — | Removed in `try/finally` after session |
| **Concurrency guard** | *(automatic)* | — | Prevents over-scheduling |
| **Graceful shutdown** | *(automatic)* | — | Sessions moved back to source on extension stop |

```jsonc
{
  "squad": {
    "maxSessions": 5,
    "maxRetries": 2,
    "autoSquadInterval": 30000,
    "sessionTimeout": 600000,
    "cooldownMs": 2000
  }
}
```

### Notifications

| Config Key | Default | Description |
| ----------- | --------- | ------------- |
| `notifications.taskActive` | `true` | Notify on task → active column |
| `notifications.taskDone` | `true` | Notify on task → done column |

Failure notifications are always shown.

## Session State Management

Sessions follow a full lifecycle: `idle → starting → running → paused → completed | error | interrupted`.

- **Persistence** — survives VS Code restarts via `workspaceState`
- **Interrupted detection** — sessions running when VS Code closed are marked `interrupted`
- **Configurable timeout** — auto-kill with `sessionTimeoutMinutes` (default 5 min); reset on output
- **Worktree tracking** — `markMerged()` / `clearWorktree()` lifecycle methods
- **State badges** — color/icon mapping per state on Kanban cards

## Streaming & Output

- **StreamController** — circular buffer (10,000 lines) per session with timestamped entries
- **StreamRegistry** — maps `sessionId → StreamController` with cross-session events
- **OutputParser** — stateful parser for fenced code blocks (`diff`, `bash`, `FILE: path`)
- **DiffWatcher** — `FileSystemWatcher` + `git diff --name-status` with 500ms debounce
- **Live WebView** — split view: stream output + changed files, auto-scroll, export log

## MCP Server

Stdio-based [Model Context Protocol](https://modelcontextprotocol.io) server (JSON-RPC 2.0, protocol `2024-11-05`).

### Tools

| Tool | Required | Optional | Description |
| ------ | ---------- | ---------- | ------------- |
| `list_tasks` | — | `column` | List tasks, optionally filtered by column |
| `get_task` | `taskId` | — | Get full task details |
| `update_task` | `taskId` | `column`, `title`, `body`, `labels`, `assignee` | Update or move a task |
| `create_task` | `title` | `body`, `column`, `labels`, `assignee` | Create a new task |
| `delete_task` | `taskId` | — | Delete a task |

### Configuration

```jsonc
{
  "mcp": {
    "enabled": true,
    "tasksPath": ".agent-board/tasks"   // optional, defaults to jsonProvider path
  }
}
```

### Usage

```bash
npm run mcp                                    # default task file
node out/mcp/mcpServer.js --tasks custom.json  # custom path
```

```bash
# List tasks in "todo"
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{"column":"todo"}}}' \
  | node out/mcp/mcpServer.js

# Create a task
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_task","arguments":{"title":"Fix login bug","labels":["bug"],"column":"todo"}}}' \
  | node out/mcp/mcpServer.js
```

## Architecture

```text
Extension Host (Node.js)
├── ProjectConfig           → .agent-board/config.json (per-project overrides)
├── ProviderRegistry        → ITaskProvider implementations
│   ├── GitHubProvider         (gh CLI + Kanban labels + polling + avatar cache)
│   ├── AzureDevOpsProvider    (az boards CLI)
│   ├── MarkdownProvider       (FileSystemWatcher, .md inbox → done)
│   ├── JsonProvider           (FileSystemWatcher, default: .agent-board/tasks)
│   ├── BeadsProvider          (CLI + polling)
│   ├── TaskStoreProvider      (in-memory store)
│   └── AggregatorProvider     (merge + dedup)
├── GenAiProviderRegistry   → IGenAiProvider implementations
│   ├── ChatGenAiProvider      (VS Code chat + tool calling)
│   ├── CloudGenAiProvider     (vscode.lm autopilot)
│   ├── CopilotCliGenAiProvider (background subprocess + worktree)
│   └── LmApiGenAiProvider     (vscode.lm + tool-calling loop + worktree)
├── AgentDiscovery          → .github/agents/*.md
├── SquadManager            → parallel sessions, auto-squad, SquadConfig
│   └── squadUtils.ts         (resolveSquadConfig, canRetry, etc.)
├── CopilotLauncher         → ContextBuilder + WorktreeManager + DiffWatcher + StreamRegistry
├── SessionStateManager     → lifecycle tracking + persistence + timeout
├── WorktreeManager         → git worktree create / remove
├── KanbanPanel             → WebView (vanilla TS/HTML/CSS)
│   ├── MessageBridge          (typed postMessage)
│   └── theme.css              (--vscode-* variables)
├── SettingsPanel           → React WebView (config editing, provider diagnostics, About)
├── PullRequestManager      → GitHub PR creation (gh CLI) + state tracking
├── AgentTools              → read_file, write_file, run_command, get_diff, list_files
├── MCP Server              → stdio JSON-RPC 2.0 (5 tools)
├── formatError             → standardised error utility
└── Logger                  → Output channel (DEBUG/INFO/WARN/ERROR)
```

## Development

```bash
npm run compile              # esbuild bundle
npm run compile:tsc          # TypeScript type-check
npm run watch                # Watch mode
npm run lint                 # ESLint
npm test                     # Mocha TDD (318 tests across 18 suites)
npm run mcp                  # Start MCP server
node esbuild.config.js       # Bundle for distribution
```

## License

[MIT](LICENSE)
