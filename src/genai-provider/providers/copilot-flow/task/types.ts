/**
 * CopilotFlow — Task types.
 *
 * Defines the `Task<I, O>` abstraction: the fundamental unit of work
 * in the CopilotFlow pipeline. Each task takes typed input, builds a
 * prompt, runs the LLM, parses the output, and validates the result.
 *
 * No `vscode` dependency — fully testable standalone.
 */

import { Middleware } from '../middleware/types';

/** Configuration for retry behaviour of a task. */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 0 = no retries). */
  maxRetries: number;
  /** Optional delay in ms between retries (default: 0). */
  delayMs?: number;
}

/** Result of a single task execution attempt. */
export interface TaskAttempt<O> {
  /** Whether the attempt succeeded (output passed validation). */
  ok: boolean;
  /** The parsed output (may be undefined if parsing/validation failed). */
  output?: O;
  /** Raw LLM output string. */
  raw: string;
  /** Error message if the attempt failed. */
  error?: string;
  /** Attempt number (1-based). */
  attempt: number;
}

/**
 * A composable unit of work.
 *
 * `Task<I, O>` takes typed input, constructs a prompt for the LLM,
 * runs it, parses the raw output into `O`, and validates the result.
 *
 * Tasks are stateless — all state flows through `I` / `O`.
 */
export interface Task<I, O> {
  /** Human-readable name for logging/tracing. */
  name: string;

  /**
   * Build the prompt string sent to the LLM.
   * Receives the task input and shared context.
   */
  prompt(input: I, context?: TaskContext): string;

  /**
   * Parse the raw LLM output string into the typed output `O`.
   * Should throw if the output cannot be parsed.
   */
  parse(raw: string, input: I): O;

  /**
   * Validate the parsed output.
   * Return `true` if valid, or a string describing the validation error.
   */
  validate?(output: O, input: I): true | string;

  /** Retry configuration. */
  retry?: RetryConfig;

  /**
   * Fallback task to run when all retries are exhausted.
   * Receives the same input and should return a compatible output.
   */
  fallback?: Task<I, O>;
}

/**
 * Shared context threaded through a chain/graph execution.
 *
 * Tasks can read and write arbitrary values here. The context is
 * mutable and shared across all tasks in a single execution.
 */
export interface TaskContext {
  /** Arbitrary key-value store for inter-task communication. */
  [key: string]: unknown;
}

/** Options for `runTask()`. */
export interface RunTaskOptions<I, O> {
  /** The task definition to execute. */
  task: Task<I, O>;
  /** The input value. */
  input: I;
  /** Shared context (created if not provided). */
  context?: TaskContext;
  /** The runner function that executes a prompt and returns raw output. */
  runner: (prompt: string) => Promise<string>;
  /** Middleware pipeline applied to this task execution. */
  middleware?: Middleware[];
}

/** Final result of a task execution (including retries/fallback). */
export interface TaskResult<O> {
  /** Whether the task ultimately succeeded. */
  ok: boolean;
  /** The validated output (undefined if all attempts failed). */
  output?: O;
  /** All individual attempts. */
  attempts: TaskAttempt<O>[];
  /** Name of the task that produced the final result (may be fallback). */
  taskName: string;
}
