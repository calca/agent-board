/**
 * CopilotFlow — Built-in Middlewares.
 *
 * Logging, metrics, and security middlewares.
 * No `vscode` dependency.
 */

import { Middleware, MiddlewareTaskInfo, NextFn } from './types';
import { TaskContext } from '../task/types';

// ── Logging Middleware ───────────────────────────────────────────────

/**
 * Logs task start/end/error with timing to a provided log function.
 */
export function loggingMiddleware(
  log: (message: string) => void = console.log,
): Middleware {
  return {
    name: 'logging',
    async execute(info: MiddlewareTaskInfo, _ctx: TaskContext, next: NextFn): Promise<string> {
      const start = Date.now();
      log(`[flow] ${info.name} attempt=${info.attempt} start`);
      try {
        const result = await next();
        const ms = Date.now() - start;
        log(`[flow] ${info.name} attempt=${info.attempt} ok (${ms}ms, ${result.length} chars)`);
        return result;
      } catch (err) {
        const ms = Date.now() - start;
        log(`[flow] ${info.name} attempt=${info.attempt} error (${ms}ms): ${err}`);
        throw err;
      }
    },
  };
}

// ── Metrics Middleware ───────────────────────────────────────────────

/** Accumulated metrics from task executions. */
export interface FlowMetrics {
  totalCalls: number;
  totalErrors: number;
  totalDurationMs: number;
  perTask: Map<string, { calls: number; errors: number; durationMs: number }>;
}

/**
 * Collects execution metrics (calls, errors, durations).
 * Access `metrics` on the returned object for the accumulated data.
 */
export function metricsMiddleware(): Middleware & { metrics: FlowMetrics } {
  const metrics: FlowMetrics = {
    totalCalls: 0,
    totalErrors: 0,
    totalDurationMs: 0,
    perTask: new Map(),
  };

  const mw: Middleware & { metrics: FlowMetrics } = {
    name: 'metrics',
    metrics,
    async execute(info: MiddlewareTaskInfo, _ctx: TaskContext, next: NextFn): Promise<string> {
      metrics.totalCalls++;
      let entry = metrics.perTask.get(info.name);
      if (!entry) {
        entry = { calls: 0, errors: 0, durationMs: 0 };
        metrics.perTask.set(info.name, entry);
      }
      entry.calls++;

      const start = Date.now();
      try {
        const result = await next();
        const dur = Date.now() - start;
        metrics.totalDurationMs += dur;
        entry.durationMs += dur;
        return result;
      } catch (err) {
        const dur = Date.now() - start;
        metrics.totalDurationMs += dur;
        entry.durationMs += dur;
        metrics.totalErrors++;
        entry.errors++;
        throw err;
      }
    },
  };

  return mw;
}

// ── Security Middleware ──────────────────────────────────────────────

/** Options for the security middleware. */
export interface SecurityMiddlewareOptions {
  /** Maximum prompt length (characters). Prompts exceeding this are truncated. */
  maxPromptLength?: number;
  /** Patterns that must NOT appear in the prompt (regex). */
  blockedPatterns?: RegExp[];
}

/**
 * Enforces prompt size limits and blocks forbidden patterns.
 */
export function securityMiddleware(
  options: SecurityMiddlewareOptions = {},
): Middleware {
  const { maxPromptLength = 100_000, blockedPatterns = [] } = options;

  return {
    name: 'security',
    async execute(info: MiddlewareTaskInfo, _ctx: TaskContext, next: NextFn): Promise<string> {
      // Check blocked patterns
      for (const pattern of blockedPatterns) {
        if (pattern.test(info.prompt)) {
          throw new Error(`Security: prompt matches blocked pattern ${pattern}`);
        }
      }

      // Truncate oversized prompts
      if (info.prompt.length > maxPromptLength) {
        info.prompt = info.prompt.slice(0, maxPromptLength);
      }

      return next();
    },
  };
}
