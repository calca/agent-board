/**
 * CopilotFlow — Task Runner.
 *
 * `runTask()` executes a `Task<I, O>` through the full lifecycle:
 * prompt → middleware → LLM → parse → validate → retry → fallback.
 *
 * No `vscode` dependency — fully testable standalone.
 */

import { formatError } from '../../../../utils/errorUtils';
import { Middleware, MiddlewareTaskInfo, NextFn } from '../middleware/types';
import { EventBus } from '../observability/types';
import { RunTaskOptions, TaskAttempt, TaskContext, TaskResult } from './types';

/**
 * Build a middleware pipeline that wraps the runner function.
 */
function buildPipeline(
  middlewares: Middleware[],
  runner: (prompt: string) => Promise<string>,
  info: MiddlewareTaskInfo,
  context: TaskContext,
): () => Promise<string> {
  let idx = middlewares.length;
  let chain: NextFn = () => runner(info.prompt);

  while (idx-- > 0) {
    const mw = middlewares[idx];
    const next = chain;
    chain = () => mw.execute(info, context, next);
  }
  return chain;
}

/**
 * Execute a task with retries, validation, middleware, and fallback.
 */
export async function runTask<I, O>(
  options: RunTaskOptions<I, O>,
  eventBus?: EventBus,
): Promise<TaskResult<O>> {
  const { task, input, runner, middleware = [] } = options;
  const context: TaskContext = options.context ?? {};
  const maxRetries = task.retry?.maxRetries ?? 0;
  const delayMs = task.retry?.delayMs ?? 0;
  const attempts: TaskAttempt<O>[] = [];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    eventBus?.emit('taskStart', { taskName: task.name, attempt });

    const info: MiddlewareTaskInfo = {
      name: task.name,
      prompt: task.prompt(input, context),
      attempt,
    };

    let raw = '';
    try {
      const pipeline = buildPipeline(middleware, runner, info, context);
      raw = await pipeline();
    } catch (err) {
      const error = formatError(err);
      attempts.push({ ok: false, raw: '', error, attempt });
      eventBus?.emit('taskError', { taskName: task.name, attempt, error });
      if (attempt <= maxRetries && delayMs > 0) {
        await delay(delayMs);
      }
      continue;
    }

    // Parse
    let output: O;
    try {
      output = task.parse(raw, input);
    } catch (err) {
      const error = `Parse error: ${formatError(err)}`;
      attempts.push({ ok: false, raw, error, attempt });
      eventBus?.emit('taskError', { taskName: task.name, attempt, error });
      if (attempt <= maxRetries && delayMs > 0) {
        await delay(delayMs);
      }
      continue;
    }

    // Validate
    if (task.validate) {
      const result = task.validate(output, input);
      if (result !== true) {
        const error = `Validation failed: ${result}`;
        attempts.push({ ok: false, output, raw, error, attempt });
        eventBus?.emit('taskError', { taskName: task.name, attempt, error });
        if (attempt <= maxRetries && delayMs > 0) {
          await delay(delayMs);
        }
        continue;
      }
    }

    // Success
    attempts.push({ ok: true, output, raw, attempt });
    eventBus?.emit('taskEnd', { taskName: task.name, attempt, success: true });
    return { ok: true, output, attempts, taskName: task.name };
  }

  // All retries exhausted — try fallback
  if (task.fallback) {
    eventBus?.emit('taskStart', { taskName: task.fallback.name, attempt: 1 });
    const fallbackResult = await runTask(
      { task: task.fallback, input, context, runner, middleware },
      eventBus,
    );
    return {
      ok: fallbackResult.ok,
      output: fallbackResult.output,
      attempts: [...attempts, ...fallbackResult.attempts],
      taskName: fallbackResult.taskName,
    };
  }

  eventBus?.emit('taskEnd', { taskName: task.name, attempt: attempts.length, success: false });
  return { ok: false, attempts, taskName: task.name };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
