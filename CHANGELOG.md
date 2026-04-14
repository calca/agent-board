# Changelog

All notable changes to **Agent Board** are documented here.

## [Unreleased]

### Added

- **StreamController** — circular buffer (10 000 lines) with `onDidAppend` event for real-time output streaming to the WebView. Registry pattern (`StreamRegistry`) maps `sessionId → StreamController`.
- **OutputParser** — stateful parser that extracts structured blocks (text, code, diff, bash, file) from raw agent output.
- **DiffWatcher** — `FileSystemWatcher` + `git diff --name-status HEAD` combo with debounce for live file-change tracking in worktrees.
- **Session Panel** — split-view WebView panel: stream output on the left, changed files list on the right. Includes action bar (Full Diff, Export Log), auto-scroll, and follow-up input.
- **New message types** — `streamOutput`, `fileChanges` (Host→WebView), `openDiff`, `openFullDiff`, `exportLog`, `sendFollowUp` (WebView→Host).
- **PullRequestManager** (`src/github/PullRequestManager.ts`) — create PRs via GitHub REST API with confirmation dialog, state tracking, and worktree cleanup support.
- **AgentTools** (`src/agent/AgentTools.ts`) — five tools (`read_file`, `write_file`, `run_command`, `get_diff`, `list_files`) with path traversal prevention and 30s timeout, for vscode.lm tool-calling API.
- **ChatGenAiProvider** tool-calling support — `handleToolCall()` method for executing tool calls from the model, with graceful fallback.
- **Context depth** setting (`agentBoard.contextDepth`) — `minimal` / `standard` / `full`. Full mode injects file tree and git metadata (branch, recent commits) into the prompt.
- **ContextBuilder.buildFull()** — async builder for full-depth context with shell commands for file tree and git metadata.
- **StatusBar** upgrade — shows `$(robot) N sessions` with spinner animation when sessions are active; click opens the Kanban board.
- **CopilotSessionInfo** extended with `prUrl`, `prNumber`, `prState`, `changedFiles` fields.

### Changed

- `CopilotLauncher` now creates a `StreamController` and `DiffWatcher` per session and exposes them via `getStreamRegistry()` / `getDiffWatcher()`.
- `ModelSelector` status bar now shows active session count and links to Kanban (was: link to mode picker).
- `KanbanPanel` gains `appendStreamOutput()` and `updateFileChanges()` helper methods.

### Tests

- `streamController.test.ts` — 10 tests covering buffer, circular trim, events, registry.
- `outputParser.test.ts` — 10 tests covering text, code, diff, bash, file, mixed, flush, unclosed fence, empty, no-language.
- `diffWatcher.test.ts` — 4 type-shape tests for `FileChange`.
