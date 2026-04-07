import * as vscode from 'vscode';
import { AgentTools, ToolResult } from '../../agent/AgentTools';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { ContextBuilder } from '../ContextBuilder';
import { GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/**
 * GenAI provider that calls the **`vscode.lm`** Language Model API
 * directly for streaming chat completions.
 *
 * Supports:
 * - `vscode.lm.selectChatModels({ vendor: 'copilot' })` selection
 * - Streaming via `for await (const chunk of response.text)`
 * - Error handling with `vscode.LanguageModelError` codes
 *   (`Blocked`, `NoPermissions`, `NotFound`)
 * - Cancellation wired to a `CancellationTokenSource`
 * - Tool calling via `AgentTools` for read_file, write_file, etc.
 * - System prompt with worktree path and issue context
 *
 * Requires VS Code >= 1.90 and GitHub Copilot Chat extension.
 */
export class LmApiGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-lm';
  readonly displayName = 'Copilot LM API';
  readonly icon = 'copilot';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;

  private readonly logger = Logger.getInstance();
  private readonly yolo: boolean;
  private readonly autopilot: boolean;
  private cts: vscode.CancellationTokenSource | undefined;
  /** Conversation history for multi-turn sessions. */
  private messages: vscode.LanguageModelChatMessage[] = [];
  /** Root path of the active worktree or workspace. */
  private activeRoot: string | undefined;

  constructor(config?: { yolo?: boolean; autopilot?: boolean }) {
    this.yolo = config?.yolo ?? false;
    this.autopilot = config?.autopilot ?? config?.yolo ?? false;
  }

  /** Event emitter for streaming chunks (consumed by StreamController). */
  private readonly onDidStreamEmitter = new vscode.EventEmitter<string>();
  /** Subscribe to streaming output from the model. */
  readonly onDidStream: vscode.Event<string> = this.onDidStreamEmitter.event;

  /** Event emitter for tool-call status strings shown in the card. */
  private readonly onDidToolCallEmitter = new vscode.EventEmitter<string>();
  /** Subscribe to tool-call status notifications. */
  readonly onDidToolCall: vscode.Event<string> = this.onDidToolCallEmitter.event;

  async isAvailable(): Promise<boolean> {
    if (typeof vscode.lm?.selectChatModels !== 'function') {
      return false;
    }
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async run(prompt: string, task?: KanbanTask, worktreePath?: string): Promise<void> {
    const model = await this.selectModel();
    if (!model) {
      vscode.window.showErrorMessage(
        'No Copilot language model available. Ensure GitHub Copilot Chat is installed.',
      );
      return;
    }

    this.cts = new vscode.CancellationTokenSource();

    // Build the system prompt with task context, using the worktree path when available
    let systemPrompt = task
      ? await ContextBuilder.buildFull(task, worktreePath)
      : 'You are a helpful coding assistant.';

    if (this.autopilot) {
      systemPrompt += '\n\n## Autopilot Mode\nYou are in autopilot mode. Continue working autonomously until the task is fully completed. Do NOT ask for confirmation — read files, write files, run commands, and iterate until done. If a command fails, diagnose and fix the issue yourself. When finished, summarize what you did.';
    }

    this.messages = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      vscode.LanguageModelChatMessage.User(prompt),
    ];

    // Initialise AgentTools with worktree root (or workspace root as fallback)
    const root = worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.activeRoot = root;
    const tools = root ? new AgentTools(root, { yolo: this.yolo }) : undefined;

    await this.runConversationLoop(model, tools);
  }

  /** Send a follow-up message in the current conversation. */
  async sendFollowUp(text: string): Promise<void> {
    const model = await this.selectModel();
    if (!model) { return; }

    this.cts = new vscode.CancellationTokenSource();
    this.messages.push(vscode.LanguageModelChatMessage.User(text));

    const root = this.activeRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const tools = root ? new AgentTools(root, { yolo: this.yolo }) : undefined;

    await this.runConversationLoop(model, tools);
  }

  cancel(): void {
    this.cts?.cancel();
    this.cts?.dispose();
    this.cts = undefined;
  }

  /** Reset conversation history. */
  resetConversation(): void {
    this.messages = [];
    this.activeRoot = undefined;
  }

  dispose(): void {
    this.cancel();
    this.onDidStreamEmitter.dispose();
    this.onDidToolCallEmitter.dispose();
  }

  // ── Private ────────────────────────────────────────────────────────

  private async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    try {
      const family = vscode.workspace
        .getConfiguration('agentBoard')
        .get<string>('copilotModel', '');

      const selector: vscode.LanguageModelChatSelector = { vendor: 'copilot' };
      if (family) {
        (selector as Record<string, unknown>).family = family;
      }

      const models = await vscode.lm.selectChatModels(selector);
      if (models.length === 0) {
        return undefined;
      }
      // Prefer the first model that matches
      return models[0];
    } catch {
      return undefined;
    }
  }

  /**
   * Core conversation loop with tool-call handling.
   *
   * Streams the model response and, when tool calls are returned,
   * executes them via AgentTools and feeds results back.
   */
  private async runConversationLoop(
    model: vscode.LanguageModelChat,
    tools?: AgentTools,
  ): Promise<void> {
    const token = this.cts?.token;
    if (!token) { return; }

    const MAX_TOOL_ROUNDS = this.autopilot ? 100 : 20;

    // Build vscode.lm tool definitions when tools are available
    const toolDefs: vscode.LanguageModelChatTool[] | undefined = tools
      ? tools.getToolDefinitions().map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as object,
        }))
      : undefined;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (token.isCancellationRequested) { break; }

      try {
        const options: vscode.LanguageModelChatRequestOptions = {};
        if (toolDefs && toolDefs.length > 0) {
          options.tools = toolDefs;
        }

        const response = await model.sendRequest(
          this.messages,
          options,
          token,
        );

        let assistantText = '';
        const toolCallParts: Array<{ part: vscode.LanguageModelToolCallPart; priorText: string }> = [];

        for await (const part of response.stream) {
          if (token.isCancellationRequested) { break; }

          if (part instanceof vscode.LanguageModelTextPart) {
            assistantText += part.value;
            this.onDidStreamEmitter.fire(part.value);
          } else if (part instanceof vscode.LanguageModelToolCallPart && tools) {
            toolCallParts.push({ part, priorText: assistantText });
          }
        }

        // Process tool calls collected during this round
        if (toolCallParts.length > 0 && tools) {
          // Save any assistant text before tool calls
          if (assistantText) {
            this.messages.push(vscode.LanguageModelChatMessage.Assistant(assistantText));
            assistantText = '';
          }

          for (const { part } of toolCallParts) {
            // Emit tool-call status to the UI
            const statusLabel = this.toolCallStatusLabel(part.name, part.input as Record<string, unknown>);
            this.onDidToolCallEmitter.fire(statusLabel);
            this.onDidStreamEmitter.fire(`\n🔧 ${statusLabel}\n`);

            const result = await this.executeToolCall(tools, part.name, part.input as Record<string, unknown>);
            const resultPreview = result.content.slice(0, 300) + (result.content.length > 300 ? '…' : '');
            this.onDidStreamEmitter.fire(`📄 ${resultPreview}\n`);

            // Feed tool result back for the next round
            this.messages.push(
              vscode.LanguageModelChatMessage.User(
                `Tool "${part.name}" result:\n${result.content}`,
              ),
            );
          }
          // Continue the loop for the model to process tool results
          continue;
        }

        // If we got here without a tool call, the response is complete
        if (assistantText) {
          this.messages.push(vscode.LanguageModelChatMessage.Assistant(assistantText));
        }

        // No more tool calls — exit the loop
        break;
      } catch (err) {
        this.handleError(err);
        break;
      }
    }
  }

  /** Build a human-readable label for a tool call status display. */
  private toolCallStatusLabel(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case 'read_file':   return `Leggendo ${args.path ?? '…'}`;
      case 'write_file':  return `Scrivendo ${args.path ?? '…'}`;
      case 'run_command': return `Eseguendo: ${args.command ?? '…'}`;
      case 'get_diff':    return 'Recuperando diff…';
      case 'list_files':  return `Listando ${args.path ?? '.'}`;
      default:            return `${name}(${JSON.stringify(args)})`;
    }
  }

  private async executeToolCall(
    tools: AgentTools,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    this.logger.info(`LmApiGenAiProvider: tool call "${name}"`, JSON.stringify(args));
    return tools.execute(name, args);
  }

  private handleError(err: unknown): void {
    if (err instanceof vscode.LanguageModelError) {
      const code = err.code;
      this.logger.error('LmApiGenAiProvider: LanguageModelError [%s]: %s', code, err.message);

      switch (code) {
        case 'Blocked':
          vscode.window.showWarningMessage('The request was blocked by the content filter.');
          break;
        case 'NoPermissions':
          vscode.window.showErrorMessage(
            'No permission to use the Copilot language model. Check your Copilot subscription.',
          );
          break;
        case 'NotFound':
          vscode.window.showErrorMessage(
            'The requested language model was not found. Ensure GitHub Copilot Chat is installed.',
          );
          break;
        default:
          vscode.window.showErrorMessage(`Language model error: ${err.message}`);
      }
    } else if (err instanceof vscode.CancellationError) {
      this.logger.info('LmApiGenAiProvider: request cancelled');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('LmApiGenAiProvider error:', message);
      vscode.window.showErrorMessage(`Copilot LM error: ${message}`);
    }
  }
}
