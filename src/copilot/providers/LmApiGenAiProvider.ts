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
  private cts: vscode.CancellationTokenSource | undefined;
  /** Conversation history for multi-turn sessions. */
  private messages: vscode.LanguageModelChatMessage[] = [];

  /** Event emitter for streaming chunks (consumed by StreamController). */
  private readonly onDidStreamEmitter = new vscode.EventEmitter<string>();
  /** Subscribe to streaming output from the model. */
  readonly onDidStream: vscode.Event<string> = this.onDidStreamEmitter.event;

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

  async run(prompt: string, task?: KanbanTask): Promise<void> {
    const model = await this.selectModel();
    if (!model) {
      vscode.window.showErrorMessage(
        'No Copilot language model available. Ensure GitHub Copilot Chat is installed.',
      );
      return;
    }

    this.cts = new vscode.CancellationTokenSource();

    // Build the system prompt with task context
    const systemPrompt = task
      ? await ContextBuilder.buildFull(task)
      : 'You are a helpful coding assistant.';

    this.messages = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      vscode.LanguageModelChatMessage.User(prompt),
    ];

    // Initialise AgentTools if workspace is available
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const tools = root ? new AgentTools(root) : undefined;

    await this.runConversationLoop(model, tools);
  }

  /** Send a follow-up message in the current conversation. */
  async sendFollowUp(text: string): Promise<void> {
    const model = await this.selectModel();
    if (!model) { return; }

    this.cts = new vscode.CancellationTokenSource();
    this.messages.push(vscode.LanguageModelChatMessage.User(text));

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const tools = root ? new AgentTools(root) : undefined;

    await this.runConversationLoop(model, tools);
  }

  /** Cancel the running request. */
  cancel(): void {
    this.cts?.cancel();
    this.cts?.dispose();
    this.cts = undefined;
  }

  /** Reset conversation history. */
  resetConversation(): void {
    this.messages = [];
  }

  dispose(): void {
    this.cancel();
    this.onDidStreamEmitter.dispose();
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

    const MAX_TOOL_ROUNDS = 20;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (token.isCancellationRequested) { break; }

      try {
        const response = await model.sendRequest(
          this.messages,
          {},
          token,
        );

        let assistantText = '';

        for await (const part of response.stream) {
          if (token.isCancellationRequested) { break; }

          if (part instanceof vscode.LanguageModelTextPart) {
            assistantText += part.value;
            this.onDidStreamEmitter.fire(part.value);
          } else if (part instanceof vscode.LanguageModelToolCallPart && tools) {
            // Execute the tool and feed result back
            this.onDidStreamEmitter.fire(`\n[Tool: ${part.name}(${JSON.stringify(part.input)})]\n`);
            const result = await this.executeToolCall(tools, part.name, part.input as Record<string, unknown>);
            this.onDidStreamEmitter.fire(`[Result: ${result.content.slice(0, 200)}${result.content.length > 200 ? '…' : ''}]\n`);

            // Feed tool result back as user message for next round
            this.messages.push(
              vscode.LanguageModelChatMessage.Assistant(assistantText || `Calling tool: ${part.name}`),
              vscode.LanguageModelChatMessage.User(
                `Tool "${part.name}" returned:\n${result.content}`,
              ),
            );

            // Continue the loop for the model to process tool results
            continue;
          }
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
