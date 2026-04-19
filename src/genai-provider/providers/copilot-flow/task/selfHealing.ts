/**
 * CopilotFlow — Self-Healing Loop.
 *
 * Pattern that wraps a task execution with automatic corrective
 * prompting when validation fails: the error is fed back to the
 * LLM which tries to fix its own output.
 *
 * No `vscode` dependency.
 */

import { formatError } from '../../../../utils/errorUtils';
import { Task, TaskContext } from '../task/types';

/** Options for the self-healing wrapper. */
export interface SelfHealingOptions<I, O> {
  /** The primary task. */
  task: Task<I, O>;
  /** Max healing iterations (default: 3). */
  maxIterations?: number;
  /** The runner function. */
  runner: (prompt: string) => Promise<string>;
  /** Build a corrective prompt from the error and previous raw output. */
  buildCorrectivePrompt?: (error: string, previousRaw: string, input: I) => string;
}

/**
 * Default corrective prompt builder.
 */
function defaultCorrectivePrompt(error: string, previousRaw: string): string {
  return [
    'Your previous output was invalid. Please fix it.',
    '',
    `## Error: ${error}`,
    '',
    '## Previous output (first 2000 chars):',
    previousRaw.slice(0, 2000),
    '',
    'Return only the corrected output.',
  ].join('\n');
}

/**
 * Run a task with a self-healing loop.
 *
 * On validation/parse failure, feeds the error back to the LLM
 * and retries with a corrective prompt.
 */
export async function selfHealingRun<I, O>(
  options: SelfHealingOptions<I, O>,
  input: I,
  context?: TaskContext,
): Promise<{ ok: boolean; output?: O; iterations: number; errors: string[] }> {
  const { task, runner, maxIterations = 3 } = options;
  const buildFix = options.buildCorrectivePrompt ?? defaultCorrectivePrompt;
  const ctx: TaskContext = context ?? {};
  const errors: string[] = [];

  let currentPrompt = task.prompt(input, ctx);

  for (let iter = 1; iter <= maxIterations; iter++) {
    let raw: string;
    try {
      raw = await runner(currentPrompt);
    } catch (err) {
      errors.push(formatError(err));
      continue;
    }

    // Parse
    let output: O;
    try {
      output = task.parse(raw, input);
    } catch (err) {
      const error = `Parse error: ${formatError(err)}`;
      errors.push(error);
      currentPrompt = buildFix(error, raw, input);
      continue;
    }

    // Validate
    if (task.validate) {
      const result = task.validate(output, input);
      if (result !== true) {
        errors.push(result);
        currentPrompt = buildFix(result, raw, input);
        continue;
      }
    }

    return { ok: true, output, iterations: iter, errors };
  }

  return { ok: false, iterations: maxIterations, errors };
}
