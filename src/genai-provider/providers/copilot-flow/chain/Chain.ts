/**
 * CopilotFlow — Chain Engine.
 *
 * Linear pipeline that sequences tasks, threading a shared context
 * through each step with beforeTask/afterTask hooks.
 *
 * No `vscode` dependency.
 */

import { formatError } from '../../../../utils/errorUtils';
import { Middleware } from '../middleware/types';
import { EventBus } from '../observability/types';
import { runTask } from '../task/runTask';
import { Task, TaskContext, TaskResult } from '../task/types';

/** Hook called before/after each task in a chain. */
export type ChainHook = (taskName: string, context: TaskContext) => void | Promise<void>;

/** A single step in a chain with typed input/output. */
interface ChainStep {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Task<any, any>;
  /** Key in context to read input from (default: previous step's output key). */
  inputKey?: string;
  /** Key in context to write output to. */
  outputKey: string;
}

/** Options for constructing a Chain. */
export interface ChainOptions {
  /** Human-readable name for logging. */
  name: string;
  /** The runner function (prompt → raw output). */
  runner: (prompt: string) => Promise<string>;
  /** Middleware applied to every task in the chain. */
  middleware?: Middleware[];
  /** Hook called before each task. */
  beforeTask?: ChainHook;
  /** Hook called after each task (only on success). */
  afterTask?: ChainHook;
  /** Event bus for observability. */
  eventBus?: EventBus;
}

/** Result of a chain execution. */
export interface ChainResult {
  ok: boolean;
  /** Final shared context (all outputs from all steps). */
  context: TaskContext;
  /** Per-step results in order. */
  stepResults: { stepName: string; result: TaskResult<unknown> }[];
  /** Error message if the chain failed. */
  error?: string;
}

/**
 * A linear pipeline of tasks.
 *
 * ```ts
 * const chain = new Chain({ name: 'review', runner });
 * chain.addStep(analyseTask, 'analysis');
 * chain.addStep(fixTask, 'fix', 'analysis');
 * const result = await chain.run({ code: '...' });
 * ```
 */
export class Chain {
  private readonly steps: ChainStep[] = [];
  private readonly options: ChainOptions;

  constructor(options: ChainOptions) {
    this.options = options;
  }

  /**
   * Add a task step to the chain.
   *
   * @param task - The task to execute.
   * @param outputKey - Key in context to store the output.
   * @param inputKey - Key in context to read input from (omit to use raw chain input for first step, or previous outputKey).
   */
  addStep<I, O>(task: Task<I, O>, outputKey: string, inputKey?: string): this {
    this.steps.push({ task, outputKey, inputKey });
    return this;
  }

  /**
   * Execute the chain.
   *
   * @param input - Initial input written to `context.__input`.
   * @param initialContext - Optional pre-populated context.
   */
  async run(input: unknown, initialContext?: TaskContext): Promise<ChainResult> {
    const context: TaskContext = { ...initialContext, __input: input };
    const stepResults: ChainResult['stepResults'] = [];
    const { runner, middleware = [], beforeTask, afterTask, eventBus } = this.options;

    eventBus?.emit('chainStart', { chainName: this.options.name, taskCount: this.steps.length });

    let prevOutputKey = '__input';

    for (const step of this.steps) {
      const taskInput = context[step.inputKey ?? prevOutputKey];

      try {
        if (beforeTask) { await beforeTask(step.task.name, context); }

        const result = await runTask(
          { task: step.task, input: taskInput, context, runner, middleware },
          eventBus,
        );

        stepResults.push({ stepName: step.task.name, result });

        if (!result.ok) {
          eventBus?.emit('chainEnd', { chainName: this.options.name, success: false });
          return {
            ok: false,
            context,
            stepResults,
            error: `Task "${step.task.name}" failed after ${result.attempts.length} attempt(s)`,
          };
        }

        context[step.outputKey] = result.output;
        prevOutputKey = step.outputKey;

        if (afterTask) { await afterTask(step.task.name, context); }
      } catch (err) {
        const error = `Task "${step.task.name}" threw: ${formatError(err)}`;
        eventBus?.emit('chainEnd', { chainName: this.options.name, success: false });
        return { ok: false, context, stepResults, error };
      }
    }

    eventBus?.emit('chainEnd', { chainName: this.options.name, success: true });
    return { ok: true, context, stepResults };
  }
}
