/**
 * CopilotFlow GenAI Provider.
 *
 * Implements `IGenAiProvider` so CopilotFlow can be selected and
 * launched from the Agent Board UI like any other provider.
 *
 * Internally delegates LLM calls to a wrapped provider while adding
 * the CopilotFlow orchestration layer (chains, graphs, guardrails,
 * observability, middleware).
 */

import * as vscode from 'vscode';
import { KanbanTask } from '../../../types/KanbanTask';
import { formatError } from '../../../utils/errorUtils';
import { Logger } from '../../../utils/logger';
import {
    GenAiProviderConfig,
    GenAiProviderScope,
    GenAiSettingDescriptor,
    IGenAiProvider,
} from '../../IGenAiProvider';

import { Chain } from './chain/Chain';
import { loggingMiddleware, metricsMiddleware } from './middleware/middlewares';
import { Middleware } from './middleware/types';
import { FlowEventBus, FlowTracer } from './observability/FlowEventBus';
import { sanitisePrompt } from './security/security';
import { runTask } from './task/runTask';
import { Task } from './task/types';

/** Execution mode for CopilotFlow. */
type FlowMode = 'single' | 'chain';

/**
 * IGenAiProvider adapter that orchestrates prompts through
 * the CopilotFlow pipeline (task → chain → guardrails → middleware).
 *
 * When `mode` is `single`, each prompt runs as an individual task.
 * When `mode` is `chain`, the prompt is broken into steps and
 * executed as a linear chain.
 */
export class CopilotFlowGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-flow';
  readonly displayName = 'Copilot Flow';
  readonly description = 'AI orchestration with chains, graphs, and guardrails';
  readonly icon = 'circuit-board';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;

  private readonly logger = Logger.getInstance();
  private mode: FlowMode = 'single';
  private maxRetries = 2;
  private enableTracing = true;

  private _cancelled = false;
  private readonly _onDidStreamEmitter = new vscode.EventEmitter<string>();
  readonly onDidStream: vscode.Event<string> = this._onDidStreamEmitter.event;

  /** The underlying provider used for actual LLM calls. */
  private innerProvider: IGenAiProvider | undefined;

  constructor(config?: GenAiProviderConfig) {
    if (config) { this.applyConfig(config); }
  }

  /** Inject the provider that handles the actual LLM execution. */
  setInnerProvider(provider: IGenAiProvider): void {
    this.innerProvider = provider;
  }

  // ── IGenAiProvider implementation ─────────────────────────────────

  getSettingsDescriptors(): GenAiSettingDescriptor[] {
    return [
      {
        key: 'mode',
        title: 'Execution mode',
        description: 'single = one prompt; chain = multi-step pipeline',
        type: 'select',
        defaultValue: 'single',
        options: [
          { label: 'Single task', value: 'single' },
          { label: 'Chain (multi-step)', value: 'chain' },
        ],
      },
      {
        key: 'maxRetries',
        title: 'Max retries',
        description: 'Maximum retry attempts per task on failure',
        type: 'number',
        defaultValue: 2,
      },
      {
        key: 'enableTracing',
        title: 'Enable tracing',
        description: 'Record a full execution trace for debugging',
        type: 'boolean',
        defaultValue: true,
      },
    ];
  }

  applyConfig(config: GenAiProviderConfig): void {
    if (config.mode !== undefined) { this.mode = config.mode as FlowMode; }
    if (config.maxRetries !== undefined) { this.maxRetries = Number(config.maxRetries); }
    if (config.enableTracing !== undefined) { this.enableTracing = Boolean(config.enableTracing); }
  }

  async isAvailable(): Promise<boolean> {
    return this.innerProvider !== undefined;
  }

  async run(prompt: string, task?: KanbanTask, worktreePath?: string): Promise<void> {
    this._cancelled = false;

    if (!this.innerProvider) {
      this._emit('[copilot-flow] Nessun provider interno configurato.\n');
      return;
    }

    const cleanPrompt = sanitisePrompt(prompt);

    // Setup observability
    const eventBus = new FlowEventBus();
    const tracer = this.enableTracing ? new FlowTracer(eventBus) : undefined;

    // Wire inner provider stream → our stream
    const innerSub = this.innerProvider.onDidStream?.((chunk) => {
      this._emit(chunk);
    });

    // Build runner: delegates to inner provider, collects output
    const runner = this.buildRunner(worktreePath);

    // Middleware stack
    const middleware: Middleware[] = [
      loggingMiddleware((msg) => {
        this.logger.info(msg);
        this._emit(`${msg}\n`);
      }),
    ];

    if (this.enableTracing) {
      middleware.push(metricsMiddleware());
    }

    try {
      this._emit(`[copilot-flow] Avvio (mode=${this.mode}, retries=${this.maxRetries})\n`);

      if (this.mode === 'chain') {
        await this.runAsChain(cleanPrompt, task, runner, middleware, eventBus);
      } else {
        await this.runSingleTask(cleanPrompt, task, runner, middleware, eventBus);
      }

      // Export trace
      if (tracer) {
        const traceJson = tracer.exportJson();
        this._emit(`\n[copilot-flow] Trace: ${tracer.getEntries().length} eventi registrati.\n`);
        this.logger.debug('CopilotFlow trace: %s', traceJson);
      }

      this._emit('\n[copilot-flow] Completato.\n');
    } catch (err) {
      this._emit(`\n[copilot-flow] Errore: ${formatError(err)}\n`);
      this.logger.error('CopilotFlow: %s', formatError(err));
    } finally {
      innerSub?.dispose();
    }
  }

  cancel(): void {
    this._cancelled = true;
    this.innerProvider?.cancel?.();
    this._emit('\n[copilot-flow] Annullato.\n');
  }

  dispose(): void {
    this.cancel();
    this._onDidStreamEmitter.dispose();
  }

  // ── Private ───────────────────────────────────────────────────────

  private _emit(text: string): void {
    this._onDidStreamEmitter.fire(text);
  }

  /**
   * Build a runner function that sends a prompt to the inner provider
   * and collects its streamed output.
   */
  private buildRunner(worktreePath?: string): (prompt: string) => Promise<string> {
    return async (prompt: string): Promise<string> => {
      if (this._cancelled) { throw new Error('Cancelled'); }
      if (!this.innerProvider) { throw new Error('No inner provider'); }

      let output = '';
      const sub = this.innerProvider.onDidStream?.((chunk) => {
        output += chunk;
      });

      try {
        await this.innerProvider.run(prompt, undefined, worktreePath);
      } finally {
        sub?.dispose();
      }

      return output;
    };
  }

  /**
   * Execute as a single CopilotFlow task with retries.
   */
  private async runSingleTask(
    prompt: string,
    _task: KanbanTask | undefined,
    runner: (p: string) => Promise<string>,
    middleware: Middleware[],
    eventBus: FlowEventBus,
  ): Promise<void> {
    const flowTask: Task<string, string> = {
      name: 'copilot-flow-single',
      prompt: (input: string) => input,
      parse: (raw: string) => raw,
      retry: { maxRetries: this.maxRetries, delayMs: 1000 },
    };

    const result = await runTask(
      { task: flowTask, input: prompt, runner, middleware },
      eventBus,
    );

    if (!result.ok) {
      const lastError = result.attempts[result.attempts.length - 1]?.error ?? 'unknown';
      throw new Error(`Task fallito dopo ${result.attempts.length} tentativi: ${lastError}`);
    }
  }

  /**
   * Execute as a chain: split the prompt into analysis → execution → review.
   */
  private async runAsChain(
    prompt: string,
    _task: KanbanTask | undefined,
    runner: (p: string) => Promise<string>,
    middleware: Middleware[],
    eventBus: FlowEventBus,
  ): Promise<void> {
    const analyseTask: Task<string, string> = {
      name: 'analyse',
      prompt: (input: string) => `Analizza il seguente task e produci un piano dettagliato:\n\n${input}`,
      parse: (raw: string) => raw,
      retry: { maxRetries: this.maxRetries, delayMs: 500 },
    };

    const executeTask: Task<string, string> = {
      name: 'execute',
      prompt: (input: string) => `Esegui il piano seguente:\n\n${input}`,
      parse: (raw: string) => raw,
      retry: { maxRetries: this.maxRetries, delayMs: 1000 },
    };

    const reviewTask: Task<string, string> = {
      name: 'review',
      prompt: (input: string) => `Verifica il risultato e suggerisci correzioni:\n\n${input}`,
      parse: (raw: string) => raw,
    };

    const chain = new Chain({
      name: 'copilot-flow-chain',
      runner,
      middleware,
      eventBus,
      beforeTask: (name) => this._emit(`\n[copilot-flow] ▶ Step: ${name}\n`),
      afterTask: (name) => this._emit(`[copilot-flow] ✓ Step: ${name} completato\n`),
    });

    chain.addStep(analyseTask, 'analysis');
    chain.addStep(executeTask, 'execution', 'analysis');
    chain.addStep(reviewTask, 'review', 'execution');

    const result = await chain.run(prompt);

    if (!result.ok) {
      throw new Error(`Chain fallita: ${result.error}`);
    }
  }
}
