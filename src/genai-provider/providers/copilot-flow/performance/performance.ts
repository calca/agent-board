/**
 * CopilotFlow — Performance & Scaling.
 *
 * Result caching, rate limiting, parallel execution, and batch execution.
 * No `vscode` dependency.
 */

import * as crypto from 'crypto';
import { Middleware, MiddlewareTaskInfo, NextFn } from '../middleware/types';
import { Task, TaskContext, TaskResult } from '../task/types';
import { runTask } from '../task/runTask';
import { EventBus } from '../observability/types';

// ── Result Cache ────────────────────────────────────────────────────

/** LRU cache for prompt → result. */
export class ResultCache {
  private readonly cache = new Map<string, { result: string; ts: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  private hash(prompt: string): string {
    return crypto.createHash('sha256').update(prompt).digest('hex');
  }

  get(prompt: string): string | undefined {
    const key = this.hash(prompt);
    const entry = this.cache.get(key);
    if (!entry) { return undefined; }
    if (Date.now() - entry.ts > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  set(prompt: string, result: string): void {
    const key = this.hash(prompt);
    if (this.cache.size >= this.maxSize) {
      // Evict oldest entry
      const first = this.cache.keys().next().value;
      if (first !== undefined) { this.cache.delete(first); }
    }
    this.cache.set(key, { result, ts: Date.now() });
  }

  clear(): void { this.cache.clear(); }
  get size(): number { return this.cache.size; }
}

/**
 * Caching middleware: returns cached results for identical prompts.
 */
export function cachingMiddleware(cache: ResultCache): Middleware {
  return {
    name: 'cache',
    async execute(info: MiddlewareTaskInfo, _ctx: TaskContext, next: NextFn): Promise<string> {
      const cached = cache.get(info.prompt);
      if (cached !== undefined) { return cached; }
      const result = await next();
      cache.set(info.prompt, result);
      return result;
    },
  };
}

// ── Rate Limiter ────────────────────────────────────────────────────

/**
 * Token-bucket rate limiter.
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;

  constructor(maxTokens: number, refillRate: number) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    // Wait for a token to become available
    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
    await new Promise(resolve => setTimeout(resolve, Math.ceil(waitMs)));
    this.refill();
    this.tokens--;
  }
}

/**
 * Rate-limiting middleware.
 */
export function rateLimitMiddleware(limiter: RateLimiter): Middleware {
  return {
    name: 'rate-limit',
    async execute(_info: MiddlewareTaskInfo, _ctx: TaskContext, next: NextFn): Promise<string> {
      await limiter.acquire();
      return next();
    },
  };
}

// ── Parallel Execution ──────────────────────────────────────────────

/** Input for parallel execution: a batch of tasks with their inputs. */
export interface ParallelItem<I, O> {
  task: Task<I, O>;
  input: I;
}

/**
 * Execute multiple tasks in parallel with a concurrency limit.
 */
export async function runParallel<I, O>(
  items: ParallelItem<I, O>[],
  runner: (prompt: string) => Promise<string>,
  options: {
    concurrency?: number;
    middleware?: Middleware[];
    eventBus?: EventBus;
  } = {},
): Promise<TaskResult<O>[]> {
  const { concurrency = 3, middleware = [], eventBus } = options;
  const results: TaskResult<O>[] = new Array(items.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      results[i] = await runTask({ task: item.task, input: item.input, runner, middleware }, eventBus);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
