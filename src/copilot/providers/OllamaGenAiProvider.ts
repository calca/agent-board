import * as vscode from 'vscode';
import { IGenAiProvider, GenAiProviderScope, GenAiProviderConfig } from '../IGenAiProvider';
import { Logger } from '../../utils/logger';

/**
 * GenAI provider that sends prompts to a local Ollama endpoint.
 *
 * Scope: **project** — enabled and configured per-project in
 * `.agent-board/config.json` under `genAiProviders.ollama`.
 *
 * Default endpoint: `http://localhost:11434/api/generate`
 * Default model: `llama3`
 */
export class OllamaGenAiProvider implements IGenAiProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';
  readonly icon = 'server';
  readonly scope: GenAiProviderScope = 'project';

  private readonly endpoint: string;
  private readonly model: string;

  constructor(config?: GenAiProviderConfig) {
    this.endpoint = config?.endpoint ?? 'http://localhost:11434/api/generate';
    this.model = config?.model ?? 'llama3';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Quick connectivity check — HEAD to the Ollama root
      const base = new URL(this.endpoint).origin;
      const res = await fetch(base, {
        method: 'GET',
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();

    const channel = vscode.window.createOutputChannel('Ollama');
    channel.show(true);
    channel.appendLine(`Sending to Ollama (${this.model})…`);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
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

      logger.info('OllamaGenAiProvider: response complete');
    } catch (err) {
      logger.error('OllamaGenAiProvider error:', String(err));
      vscode.window.showErrorMessage(`Ollama connection error: ${err}`);
    }
  }

  dispose(): void {
    // Nothing to clean up
  }
}
