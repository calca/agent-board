/**
 * CopilotFlow — Planner System.
 *
 * Agentic planning: generates a JSON plan of steps from a goal,
 * then executes them sequentially using the task runner.
 *
 * No `vscode` dependency.
 */

import { formatError } from '../../../../utils/errorUtils';
import { buildJsonFixPrompt, safeJsonParse } from '../guardrails/guardrails';
import { Middleware } from '../middleware/types';
import { EventBus } from '../observability/types';
import { runTask } from '../task/runTask';
import { Task, TaskContext, TaskResult } from '../task/types';

/** A single step in a generated plan. */
export interface PlanStep {
  /** Unique step ID. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** The prompt to execute for this step. */
  prompt: string;
}

/** Options for the Planner. */
export interface PlannerOptions {
  /** Human-readable name. */
  name: string;
  /** The runner function (prompt → raw output). */
  runner: (prompt: string) => Promise<string>;
  /** Middleware applied to each step. */
  middleware?: Middleware[];
  /** Max retries for plan generation itself. */
  planRetries?: number;
  /** Event bus for observability. */
  eventBus?: EventBus;
}

/** Result of a planner execution. */
export interface PlannerResult {
  ok: boolean;
  /** The generated plan. */
  plan: PlanStep[];
  /** Results for each executed step. */
  stepResults: { stepId: string; result: TaskResult<string> }[];
  /** Final context. */
  context: TaskContext;
  error?: string;
}

/** Default prompt for plan generation. */
const PLAN_SYSTEM_PROMPT = [
  'You are a planning agent. Given a goal, break it down into sequential steps.',
  'Return ONLY a JSON array of objects with { "id", "description", "prompt" }.',
  'Each "prompt" should be a self-contained instruction for an AI agent.',
  'Do NOT include any text outside the JSON array.',
].join('\n');

/**
 * Agentic planner: plan → execute.
 *
 * ```ts
 * const planner = new Planner({ name: 'refactor', runner });
 * const result = await planner.run('Refactor the auth module to use JWT');
 * ```
 */
export class Planner {
  private readonly options: PlannerOptions;

  constructor(options: PlannerOptions) {
    this.options = options;
  }

  async run(goal: string, initialContext?: TaskContext): Promise<PlannerResult> {
    const context: TaskContext = { ...initialContext, __goal: goal };
    const { runner, middleware = [], planRetries = 2, eventBus } = this.options;

    // Step 1: Generate plan
    let plan: PlanStep[];
    try {
      plan = await this.generatePlan(goal, runner, planRetries);
    } catch (err) {
      return {
        ok: false,
        plan: [],
        stepResults: [],
        context,
        error: `Plan generation failed: ${formatError(err)}`,
      };
    }

    eventBus?.emit('planGenerated', { plannerName: this.options.name, stepCount: plan.length });
    context.__plan = plan;

    // Step 2: Execute each step
    const stepResults: PlannerResult['stepResults'] = [];

    for (const step of plan) {
      const stepTask: Task<string, string> = {
        name: `${this.options.name}/${step.id}`,
        prompt: (input: string) => `${input}\n\n## Step: ${step.description}\n${step.prompt}`,
        parse: (raw: string) => raw,
        retry: { maxRetries: 1 },
      };

      const result = await runTask(
        { task: stepTask, input: goal, context, runner, middleware },
        eventBus,
      );

      stepResults.push({ stepId: step.id, result });

      if (!result.ok) {
        return {
          ok: false,
          plan,
          stepResults,
          context,
          error: `Step "${step.id}" (${step.description}) failed`,
        };
      }

      context[`step_${step.id}`] = result.output;
    }

    return { ok: true, plan, stepResults, context };
  }

  private async generatePlan(goal: string, runner: (p: string) => Promise<string>, maxRetries: number): Promise<PlanStep[]> {
    const prompt = `${PLAN_SYSTEM_PROMPT}\n\n## Goal\n${goal}`;
    let lastError = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const effectivePrompt = attempt === 0
        ? prompt
        : buildJsonFixPrompt(lastError, lastError);

      const raw = await runner(effectivePrompt);
      const parsed = safeJsonParse<PlanStep[]>(raw);

      if (parsed.ok && Array.isArray(parsed.data)) {
        // Validate structure
        const valid = parsed.data.every(
          (s): s is PlanStep =>
            typeof s.id === 'string' &&
            typeof s.description === 'string' &&
            typeof s.prompt === 'string',
        );
        if (valid && parsed.data.length > 0) {
          return parsed.data;
        }
        lastError = 'Plan array has invalid step objects or is empty';
      } else {
        lastError = parsed.ok ? 'Expected an array' : parsed.error;
      }
    }

    throw new Error(`Failed to generate valid plan after ${maxRetries + 1} attempts: ${lastError}`);
  }
}
