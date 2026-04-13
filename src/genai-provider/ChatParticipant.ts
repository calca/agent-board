import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { KanbanTask } from '../types/KanbanTask';
import { Logger } from '../utils/logger';
import { ContextBuilder } from './ContextBuilder';

const PARTICIPANT_ID = 'agentBoard.taskai';

/** System prompts per slash command. */
const COMMAND_PROMPTS: Record<string, string> = {
  plan: 'You are a senior software architect. Given the task below, generate a structured plan with numbered steps. Be specific about files, functions, and data flow.',
  implement: 'You are an expert developer. Given the task and optional plan, generate production-ready code changes. Show full file paths, diffs, and explain each change.',
  test: 'You are a test engineer. Given the task, generate comprehensive test cases covering happy path, edge cases, and error scenarios. Use the project\'s test framework.',
  commit: 'You are writing a conventional commit message for the changes described. Use the format: type(scope): subject, followed by a body explaining what and why.',
};

/**
 * Registers the `@taskai` chat participant with LM-powered slash
 * commands that use `vscode.lm` for real responses.
 *
 * Slash commands:
 *   /plan       — Generate a structured plan
 *   /implement  — Generate implementation code
 *   /test       — Generate test suggestions
 *   /commit     — Generate a commit message
 *
 * Conversation history is maintained across turns within the same
 * chat session via the `context.history` array.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  registry: ProviderRegistry,
): vscode.Disposable | undefined {
  // Guard: vscode.chat API may not be available
  if (!vscode.chat || typeof vscode.chat.createChatParticipant !== 'function') {
    Logger.getInstance().info('Chat participant API not available — skipping @taskai registration');
    return undefined;
  }

  const logger = Logger.getInstance();

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, chatContext, stream, token) => {
    const command = request.command;

    // ── Resolve the active task (if any) for context injection ─────
    const task = await resolveActiveTask(registry);

    // ── Build messages from history + current request ──────────────
    const messages: vscode.LanguageModelChatMessage[] = [];

    // System context: task info + command-specific instruction
    const systemParts: string[] = [];

    if (command && COMMAND_PROMPTS[command]) {
      systemParts.push(COMMAND_PROMPTS[command]);
    } else {
      systemParts.push(
        'You are @taskai, an AI assistant integrated into Agent Board. '
        + 'Help the developer with their tasks. You can plan, implement, test, and commit.',
      );
    }

    if (task) {
      systemParts.push('');
      systemParts.push(ContextBuilder.build(task));
    }

    messages.push(vscode.LanguageModelChatMessage.User(systemParts.join('\n')));

    // Replay conversation history for multi-turn support
    for (const turn of chatContext.history) {
      if (turn instanceof vscode.ChatResponseTurn) {
        // Reconstruct assistant text from response parts
        const parts: string[] = [];
        for (const part of turn.response) {
          if (part instanceof vscode.ChatResponseMarkdownPart) {
            parts.push(part.value.value);
          }
        }
        if (parts.length > 0) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(parts.join('')));
        }
      } else if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      }
    }

    // Current user message
    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    // ── Select model and stream response ──────────────────────────
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        stream.markdown('⚠️ No Copilot language model available. Ensure GitHub Copilot Chat is installed.\n');
        return;
      }

      const model = models[0];
      const response = await model.sendRequest(messages, {}, token);

      for await (const part of response.stream) {
        if (token.isCancellationRequested) { break; }
        if (part instanceof vscode.LanguageModelTextPart) {
          stream.markdown(part.value);
        }
      }
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        logger.error('@taskai error [%s]: %s', err.code, err.message);
        stream.markdown(`\n\n⚠️ Language model error (${err.code}): ${err.message}\n`);
      } else if (!(err instanceof vscode.CancellationError)) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('@taskai error:', msg);
        stream.markdown(`\n\n⚠️ Error: ${msg}\n`);
      }
    }
  });

  participant.iconPath = new vscode.ThemeIcon('tasklist');

  return participant;
}

/**
 * Try to find the most relevant active task to inject as context.
 * Looks for a task in the "inprogress" column, or falls back to the
 * most recently created "todo" task.
 */
async function resolveActiveTask(registry: ProviderRegistry): Promise<KanbanTask | undefined> {
  try {
    const providers = registry.getAll();
    const allTasks = (
      await Promise.allSettled(providers.map(p => p.getTasks()))
    )
      .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Prefer tasks in progress
    const inProgress = allTasks.find(t => t.status === 'inprogress');
    if (inProgress) { return inProgress; }

    // Fall back to most recent todo
    const todos = allTasks
      .filter(t => t.status === 'todo')
      .sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });
    return todos[0];
  } catch {
    return undefined;
  }
}
