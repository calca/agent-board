# PLAN.md — CLI Provider Integration + AgentChatLog UI

## Context

This plan covers the implementation of streaming CLI provider support (starting with
`copilot-cli`, extensible to `claude-cli`, `ollama`, etc.) and the replacement of the
flat Activity Log with a Copilot-style chat UI (`AgentChatLog`) in the `agent-board`
VSCode extension.

All code changes are additive or replace existing sections — no existing public API is
broken.

---

## Phase 1 — Shared Types

**Goal:** Establish the message contract between extension host and webview.

### Files to create or modify

#### `src/dataprovider/types.ts` — extend with new message types

Add to `WebviewToHostMessage` union:
```typescript
| { type: 'startAgent'; taskId: string; provider: string; prompt: string }
| { type: 'cancelAgent'; taskId: string }
```

Add to `HostToWebviewMessage` union:
```typescript
| { type: 'agentLog'; taskId: string; chunk: string; done: boolean }
| { type: 'agentError'; taskId: string; error: string }
```

Add `LogEntry` type:
```typescript
export interface LogEntry {
  ts: string;
  source: 'board' | 'agent' | 'tool' | 'system' | 'raw';
  text: string;
  providerId?: string;
}
```

Add `ChatMessage` type (or keep in component — team preference):
```typescript
export type ChatRole = 'user' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  done: boolean;
  providerId?: string;
  ts: string;
}
```

### Acceptance criteria
- [ ] TypeScript compilation passes with no new errors
- [ ] All existing message types preserved

---

## Phase 2 — Transport Layer

**Goal:** Split VsCodeTransport and HttpTransport behind a common `ITransport` interface.
Support concurrent requests via `requestId`. Support push events (agentLog, tasksUpdate).

### Files to create

```
src/dataprovider/transport/
├── ITransport.ts
├── VsCodeTransport.ts
├── HttpTransport.ts        (preserves existing HTTP/fetch logic + adds SSE)
└── index.ts                (factory: vscode vs browser detection)
```

#### `ITransport.ts`
```typescript
export interface ITransport {
  send(msg: WebviewToHostMessage): void;
  request<T extends HostToWebviewMessage>(
    msg: WebviewToHostMessage & { requestId: string },
    matchType: T['type'],
    timeoutMs?: number,
  ): Promise<T>;
  onPush(handler: PushHandler): () => void;
}
```

#### `VsCodeTransport.ts`
- Listen to `window.addEventListener('message', ...)`
- Route by `requestId` to pending resolvers, remainder to push handlers
- `send` calls `vsCodeApi.postMessage`

#### `HttpTransport.ts`
- `request` → fetch REST endpoint (map message type to URL/method in `toHttpRequest`)
- `onPush` → SSE on `/events` endpoint, auto-reconnect on error
- Preserve all existing fetch logic from current `DataProviderImpl`

#### `index.ts`
```typescript
export const transport: ITransport =
  typeof (globalThis as any).acquireVsCodeApi !== 'undefined'
    ? new VsCodeTransport()
    : new HttpTransport();
```

### Files to modify

#### `src/dataprovider/DataProvider.ts`
- Remove internal environment detection
- Remove `responseResolvers` map
- Import `transport` from `./transport/index.ts`
- Add methods:
  - `startAgent(taskId, provider, prompt)`
  - `cancelAgent(taskId)`
  - `onAgentLog(taskId, callback)` → returns unsubscribe
  - `onAgentError(taskId, callback)` → returns unsubscribe
  - `onTasksUpdate(callback)` → returns unsubscribe
- `getTasks` uses `transport.request` with `requestId`

### Acceptance criteria
- [ ] `getTasks()` called twice concurrently resolves both independently
- [ ] `onAgentLog` callback fires when `agentLog` message is received
- [ ] HTTP transport: existing task CRUD still works in browser mode
- [ ] SSE: `onPush` fires for `agentLog` and `tasksUpdate` events in browser mode

---

## Phase 3 — Extension Host: CLI Runner

**Goal:** Spawn the CLI process, pipe stdout/stderr to the webview via postMessage.

### Files to create

#### `src/extension/providers/ICliProvider.ts`
```typescript
export interface ICliProvider {
  readonly name: string;
  run(prompt: string, signal?: AbortSignal): AsyncIterable<string>;
}
```

#### `src/extension/providers/AsyncQueue.ts`
Generic async iterable queue for real-time streaming.

#### `src/extension/providers/CopilotCliProvider.ts`
- Spawns `gh copilot suggest -t shell <prompt>`
- `stdout` → `queue.push(chunk)`
- `stderr` → `logger.warn`
- `close` → `queue.end()`
- Respects `AbortSignal` → `proc.kill('SIGTERM')`

#### `src/extension/providers/ProviderRegistry.ts`
```typescript
class ProviderRegistry {
  register(provider: ICliProvider): void
  get(name: string): ICliProvider
  list(): string[]
}
export const providerRegistry = new ProviderRegistry();
```

#### `src/extension/AgentRunner.ts`
```typescript
export async function runAgent(
  panel: vscode.WebviewPanel,
  taskId: string,
  providerName: string,
  prompt: string,
): Promise<void>
```
- Gets provider from registry
- Creates `AbortController`, stores by `taskId`
- Iterates `AsyncIterable<string>` from provider
- Each chunk → `panel.webview.postMessage({ type: 'agentLog', taskId, chunk, done: false })`
- On complete → `postMessage({ type: 'agentLog', taskId, chunk: '', done: true })`
- On error → `postMessage({ type: 'agentError', taskId, error: err.message })`

### Files to modify

#### `src/extension/extension.ts` (or main message handler)
Add cases in `webview.onDidReceiveMessage`:
```typescript
case 'startAgent':
  runAgent(panel, msg.taskId, msg.provider, msg.prompt);
  break;
case 'cancelAgent':
  agentRunner.cancel(msg.taskId);
  break;
```

Register `CopilotCliProvider` on activation:
```typescript
providerRegistry.register(new CopilotCliProvider());
```

### Acceptance criteria
- [ ] Launching agent from FullView → chunks appear in webview in real time
- [ ] Stop button → process killed, no further chunks
- [ ] stderr from CLI visible in VSCode Output channel (`LogOutputChannel`)
- [ ] Non-zero exit code → `agentError` message sent

---

## Phase 4 — React: AgentChatLog Component

**Goal:** Replace flat Activity Log rows with chat-bubble UI and streaming markdown.

### Files to create

#### `src/components/AgentChatLog.tsx`
Components: `AgentChatLog`, `ChatBubble`, `BubbleAvatar`, `StreamCursor`, `TypingIndicator`

- `AgentChatLog` — scrollable container, auto-scroll when near bottom
- `ChatBubble` — role-aware layout (user right-aligned, agent/system left)
- Agent/system body → `<Markdown>` from `react-markdown` + `<StreamCursor />` while `!done`
- User body → plain `<p>`
- `TypingIndicator` — shown when `isRunning && last message is done`

#### `src/hooks/useAgentChat.ts`
```typescript
export function useAgentChat(taskId: string | undefined): {
  messages: ChatMessage[];
  sendUserMessage: (text: string) => void;
  appendSystem: (text: string) => void;
}
```
- `useEffect` on `taskId`: resets messages, subscribes to `DataProvider.onAgentLog` and `onAgentError`
- Accumulates chunks into current agent message via `setMessages` functional update
- New agent message created when previous is `done` or none exists
- Returns `sendUserMessage` for future input box

#### `src/components/AgentChatLog.css` (or inline in existing CSS)
- `.acl` — flex column, gap, overflow-y scroll
- `.acl__bubble--agent` — left-aligned, `var(--vscode-editor-inactiveSelectionBackground)`
- `.acl__bubble--user` — right-aligned, `var(--vscode-button-background)`
- `.acl__bubble--system` — transparent, italic, muted
- `.acl__cursor` — 2px blinking caret, `acl-blink` keyframe
- `.acl__typing` — 3-dot bounce animation

### Files to modify

#### `src/components/FullView.tsx`
- Import `AgentChatLog`, `useAgentChat`
- Add `const { messages, sendUserMessage, appendSystem } = useAgentChat(fullViewTaskId ?? undefined)`
- Replace ROW 2 log content: swap `fv-log-scroll` + `fv-log-entries` with `<AgentChatLog messages={messages} isRunning={isRunning} />`
- Remove `logVersion` / `appendLog` logic if previously added
- Keep panel header (expand/collapse button)

### Acceptance criteria
- [ ] Agent response streams token by token with blinking cursor
- [ ] Cursor disappears when `done: true`
- [ ] Typing indicator shown before first chunk arrives
- [ ] Code blocks in agent response rendered as `<pre>` with mono font
- [ ] User messages right-aligned, agent left-aligned
- [ ] Auto-scroll follows stream; pauses if user scrolls up

---

## Phase 5 — Future Providers (non-blocking)

These require no changes to Phases 1–4. Each is a new file implementing `ICliProvider`.

| Provider | Command | Notes |
|---|---|---|
| `ClaudeCliProvider` | `claude -p "<prompt>"` | stream via `--stream` flag |
| `OllamaProvider` | `ollama run <model> "<prompt>"` | parse JSON lines from stdout |
| `VscodeLmProvider` | `vscode.lm` API | no spawn needed, use existing `vscode.lm.selectChatModels` |

Register each in `extension.ts`:
```typescript
providerRegistry.register(new ClaudeCliProvider());
providerRegistry.register(new OllamaProvider());
```

---

## Dependency Map

```
Phase 1 (types)
  └── Phase 2 (transport)
        └── Phase 3 (CLI runner)     ← extension host
        └── Phase 4 (React UI)       ← webview
              └── Phase 5 (providers)
```

Phases 3 and 4 can be developed in parallel once Phase 2 is complete.

---

## File Tree (net new files)

```
src/
├── dataprovider/
│   ├── types.ts                          MODIFY
│   ├── DataProvider.ts                   MODIFY
│   └── transport/
│       ├── ITransport.ts                 NEW
│       ├── VsCodeTransport.ts            NEW
│       ├── HttpTransport.ts              NEW
│       └── index.ts                      NEW
├── components/
│   ├── AgentChatLog.tsx                  NEW
│   └── FullView.tsx                      MODIFY
├── hooks/
│   └── useAgentChat.ts                   NEW
└── extension/
    ├── providers/
    │   ├── ICliProvider.ts               NEW
    │   ├── AsyncQueue.ts                 NEW
    │   ├── CopilotCliProvider.ts         NEW
    │   └── ProviderRegistry.ts           NEW
    ├── AgentRunner.ts                    NEW
    └── extension.ts                      MODIFY
```

---

## Out of Scope

- Input box for user prompt inside chat (structure ready via `sendUserMessage`, UI deferred)
- Syntax highlighting inside code blocks (can add `react-syntax-highlighter` later)
- Persisting chat history across sessions
- Multi-turn conversation with the CLI (current CLIs are single-shot)
