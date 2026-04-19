/**
 * CopilotFlow — Middleware types.
 *
 * Middleware intercepts task execution for logging, metrics,
 * security, etc.  No `vscode` dependency.
 */

import { TaskContext } from '../task/types';

/** Information about the task being executed, passed to middleware. */
export interface MiddlewareTaskInfo {
  /** Task name. */
  name: string;
  /** The prompt that will be sent to the LLM. */
  prompt: string;
  /** Attempt number (1-based). */
  attempt: number;
}

/** The next function in the middleware chain. */
export type NextFn = () => Promise<string>;

/**
 * A middleware function.
 *
 * Receives task info, shared context, and a `next` function.
 * Must call `next()` to continue the chain, or return a string
 * directly to short-circuit.
 */
export interface Middleware {
  /** Human-readable name for tracing. */
  name: string;
  /**
   * Execute the middleware.
   * Call `next()` to proceed to the next middleware / runner.
   */
  execute(info: MiddlewareTaskInfo, context: TaskContext, next: NextFn): Promise<string>;
}
