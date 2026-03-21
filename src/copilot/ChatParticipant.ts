import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { CopilotLauncher } from './CopilotLauncher';
import { Logger } from '../utils/logger';

interface ChatContext {
  history: readonly unknown[];
}

interface SlashCommandHandler {
  (
    request: vscode.ChatRequest,
    context: ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void>;
}

/**
 * Registers the `@taskai` chat participant with slash commands:
 *   /start   — Begin working on a task
 *   /plan    — Generate a structured plan for the selected task
 *   /implement — Generate implementation suggestions
 *   /test    — Generate test suggestions
 *   /commit  — Generate commit message
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

  const participant = vscode.chat.createChatParticipant('agentBoard.taskai', async (request, context, stream, token) => {
    const command = request.command;

    switch (command) {
      case 'plan':
        stream.markdown('## Task Plan\n\n');
        stream.markdown('1. **Analyze** the requirements\n');
        stream.markdown('2. **Design** the solution architecture\n');
        stream.markdown('3. **Implement** the core logic\n');
        stream.markdown('4. **Write tests** for all branches\n');
        stream.markdown('5. **Review** and iterate\n');
        break;

      case 'implement':
        stream.markdown('## Implementation Suggestions\n\n');
        stream.markdown('Based on the task context, here are implementation steps…\n');
        break;

      case 'test':
        stream.markdown('## Test Suggestions\n\n');
        stream.markdown('Consider the following test cases…\n');
        break;

      case 'commit':
        stream.markdown('## Commit Message\n\n');
        stream.markdown('```\nfeat: implement task feature\n\nDescription of changes.\n```\n');
        break;

      default:
        stream.markdown(`Hello! I'm **@taskai**. Use one of these commands:\n\n`);
        stream.markdown('- `/plan` — Generate a task plan\n');
        stream.markdown('- `/implement` — Get implementation suggestions\n');
        stream.markdown('- `/test` — Get test suggestions\n');
        stream.markdown('- `/commit` — Generate a commit message\n');
        break;
    }
  });

  participant.iconPath = new vscode.ThemeIcon('tasklist');

  return participant;
}
