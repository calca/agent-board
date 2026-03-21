import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * Copilot Local runner — sends prompts to a local Ollama endpoint.
 *
 * Default endpoint: `http://localhost:11434/api/generate`
 */
export class LocalRunner {
  static async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();
    const endpoint = 'http://localhost:11434/api/generate';
    const cfg = vscode.workspace.getConfiguration('agentBoard');
    const model = cfg.get<string>('copilot.localModel', 'llama3');

    const channel = vscode.window.createOutputChannel('Copilot Local');
    channel.show(true);
    channel.appendLine('Sending to Ollama…');

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        throw new Error(`Ollama returned ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as { response?: string };
      channel.appendLine('');
      channel.appendLine(data.response ?? '(empty response)');

      logger.info('LocalRunner: response complete');
    } catch (err) {
      logger.error('LocalRunner error:', String(err));
      vscode.window.showErrorMessage(`Ollama connection error: ${err}`);
    }
  }
}
