import * as vscode from 'vscode';
import { IGenAiProvider, GenAiProviderScope, GenAiProviderConfig } from '../IGenAiProvider';
import { Logger } from '../../utils/logger';

/**
 * GenAI provider that sends prompts to the Mistral API via CLI/HTTP.
 *
 * Scope: **project** — enabled and configured per-project in
 * `.agent-board/config.json` under `genAiProviders.mistral`.
 *
 * Default endpoint: `https://api.mistral.ai/v1/chat/completions`
 * Default model: `mistral-small-latest`
 *
 * Requires `genAiProviders.mistral.apiKey` to be set (or the
 * `MISTRAL_API_KEY` environment variable).
 */
export class MistralGenAiProvider implements IGenAiProvider {
  readonly id = 'mistral';
  readonly displayName = 'Mistral';
  readonly icon = 'sparkle';
  readonly scope: GenAiProviderScope = 'project';

  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(config?: GenAiProviderConfig) {
    this.endpoint = config?.endpoint ?? 'https://api.mistral.ai/v1/chat/completions';
    this.model = config?.model ?? 'mistral-small-latest';
    this.apiKey = process.env['MISTRAL_API_KEY'] ?? '';
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();

    if (!this.apiKey) {
      vscode.window.showErrorMessage(
        'Mistral API key not configured. Set the MISTRAL_API_KEY environment variable.',
      );
      return;
    }

    const channel = vscode.window.createOutputChannel('Mistral');
    channel.show(true);
    channel.appendLine(`Sending to Mistral (${this.model})…`);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        throw new Error(`Mistral API returned ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content ?? '(empty response)';

      channel.appendLine('');
      channel.appendLine(content);

      logger.info('MistralGenAiProvider: response complete');
    } catch (err) {
      logger.error('MistralGenAiProvider error:', String(err));
      vscode.window.showErrorMessage(`Mistral API error: ${err}`);
    }
  }

  dispose(): void {
    // Nothing to clean up
  }
}
