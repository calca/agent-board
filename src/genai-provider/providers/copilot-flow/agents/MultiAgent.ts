/**
 * CopilotFlow — Multi-Agent System.
 *
 * Orchestrates planner, executor, and reviewer agents
 * in a collaborative loop.
 *
 * No `vscode` dependency.
 */

import { formatError } from '../../../../utils/errorUtils';
import { Middleware } from '../middleware/types';
import { EventBus } from '../observability/types';
import { runTask } from '../task/runTask';
import { Task, TaskContext, TaskResult } from '../task/types';

/** Role of an agent in the multi-agent system. */
export type AgentRole = 'planner' | 'executor' | 'reviewer';

/** An agent definition with a role and a task. */
export interface AgentDefinition {
  role: AgentRole;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Task<any, any>;
}

/** Options for the multi-agent orchestrator. */
export interface MultiAgentOptions {
  name: string;
  /** The planner agent: produces a plan/instructions. */
  planner: AgentDefinition;
  /** The executor agent: carries out the plan. */
  executor: AgentDefinition;
  /** The reviewer agent: validates the result and decides whether to iterate. */
  reviewer: AgentDefinition;
  /** The runner function. */
  runner: (prompt: string) => Promise<string>;
  /** Max iterations of the plan→execute→review loop (default: 5). */
  maxIterations?: number;
  middleware?: Middleware[];
  eventBus?: EventBus;
}

/** Result of a multi-agent execution. */
export interface MultiAgentResult {
  ok: boolean;
  context: TaskContext;
  iterations: number;
  planResult?: TaskResult<unknown>;
  executorResult?: TaskResult<unknown>;
  reviewerResult?: TaskResult<unknown>;
  error?: string;
}

/**
 * Run a multi-agent plan→execute→review loop.
 *
 * 1. **Planner** generates a plan from the goal.
 * 2. **Executor** carries out the plan.
 * 3. **Reviewer** evaluates the result.
 *    - If reviewer output contains `"approved": true`, the loop ends.
 *    - Otherwise, feedback is fed back to the planner for the next iteration.
 */
export async function runMultiAgent(options: MultiAgentOptions, goal: string, initialContext?: TaskContext): Promise<MultiAgentResult> {
  const { planner, executor, reviewer, runner, middleware = [], maxIterations = 5, eventBus } = options;
  const context: TaskContext = { ...initialContext, __goal: goal };

  for (let iter = 1; iter <= maxIterations; iter++) {
    context.__iteration = iter;

    // Plan
    let planResult: TaskResult<unknown>;
    try {
      planResult = await runTask(
        { task: planner.task, input: context.__goal, context, runner, middleware },
        eventBus,
      );
    } catch (err) {
      return { ok: false, context, iterations: iter, error: `Planner error: ${formatError(err)}` };
    }

    if (!planResult.ok) {
      return { ok: false, context, iterations: iter, planResult, error: 'Planner failed' };
    }
    context.__plan = planResult.output;

    // Execute
    let executorResult: TaskResult<unknown>;
    try {
      executorResult = await runTask(
        { task: executor.task, input: planResult.output, context, runner, middleware },
        eventBus,
      );
    } catch (err) {
      return { ok: false, context, iterations: iter, planResult, error: `Executor error: ${formatError(err)}` };
    }

    if (!executorResult.ok) {
      return { ok: false, context, iterations: iter, planResult, executorResult, error: 'Executor failed' };
    }
    context.__executorOutput = executorResult.output;

    // Review
    let reviewerResult: TaskResult<unknown>;
    try {
      reviewerResult = await runTask(
        { task: reviewer.task, input: executorResult.output, context, runner, middleware },
        eventBus,
      );
    } catch (err) {
      return { ok: false, context, iterations: iter, planResult, executorResult, error: `Reviewer error: ${formatError(err)}` };
    }

    context.__reviewerOutput = reviewerResult.output;

    // Check if approved
    const reviewOutput = reviewerResult.output;
    if (reviewOutput && typeof reviewOutput === 'object' && (reviewOutput as Record<string, unknown>).approved === true) {
      return { ok: true, context, iterations: iter, planResult, executorResult, reviewerResult };
    }

    // Feed reviewer feedback back for next iteration
    if (reviewOutput && typeof reviewOutput === 'object' && typeof (reviewOutput as Record<string, unknown>).feedback === 'string') {
      context.__feedback = (reviewOutput as Record<string, unknown>).feedback;
    }
  }

  return { ok: false, context, iterations: maxIterations, error: `Max iterations (${maxIterations}) exceeded without approval` };
}
