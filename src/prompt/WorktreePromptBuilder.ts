// ---------------------------------------------------------------------------
// WorktreePromptBuilder
//
// Pure prompt generation — no VSCode, no git, no filesystem dependencies.
// Consumers (AgentRunner, LmProvider, CliProvider, etc.) are responsible for
// resolving context (diff, plan content) and dispatching the built prompts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueContext {
  number: number;
  title: string;
  body: string;
  labels?: string[];
}

export interface WorktreeContext {
  path: string;
  branch: string;
  baseBranch: string;
}

export interface PlanContext {
  /** Raw PLAN.md content (already truncated by caller if needed) */
  content: string;
  totalTasks: number;
  completedTasks: number;
  hasOpenQuestions: boolean;
}

export interface WorktreePromptContext {
  issue: IssueContext;
  worktree: WorktreeContext;
  plan: PlanContext;
  /** git diff output (already truncated by caller if needed) */
  diff: string;
}

export type AgentMode = 'init' | 'resume' | 'coordinate';

// ---------------------------------------------------------------------------
// Output types — transport-agnostic
// ---------------------------------------------------------------------------

/** A single chat message with an explicit role. */
export interface PromptMessage {
  /** 'system' is informational — callers map it to their runtime's convention.
   *  e.g. vscode.lm: prepend system as first User message.
   *       OpenAI / Anthropic: pass system as-is. */
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Result of any build* method. Ready to be handed to any AI provider. */
export interface BuiltPrompt {
  mode: AgentMode;
  system: string;
  messages: PromptMessage[];
  /** Original context, useful for logging / tracing */
  context: WorktreePromptContext | CoordinatorContext;
}

// ---------------------------------------------------------------------------
// Coordinator-specific types
// ---------------------------------------------------------------------------

export interface CoordinatorWorktreeSummary {
  branch: string;
  issue: Pick<IssueContext, 'title' | 'number'>;
  plan: Pick<PlanContext, 'completedTasks' | 'totalTasks'>;
  modifiedFiles: string[];
}

export interface CoordinatorContext {
  worktrees: CoordinatorWorktreeSummary[];
}

// ---------------------------------------------------------------------------
// WorktreePromptBuilder
// ---------------------------------------------------------------------------

const PLAN_FILENAME = 'PLAN.md';

export class WorktreePromptBuilder {

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Prompt for a brand-new worktree: agent must create PLAN.md first.
   */
  static buildInit(
    issue: IssueContext,
    worktree: WorktreeContext,
    plan: PlanContext,
    diff: string
  ): BuiltPrompt {
    const ctx: WorktreePromptContext = { issue, worktree, plan, diff };
    return {
      mode: 'init',
      system: WorktreePromptBuilder.renderSystem(ctx),
      messages: [{ role: 'user', content: WorktreePromptBuilder.renderInit(ctx) }],
      context: ctx,
    };
  }

  /**
   * Prompt to resume an existing worktree that already has a PLAN.md.
   */
  static buildResume(
    issue: IssueContext,
    worktree: WorktreeContext,
    plan: PlanContext,
    diff: string
  ): BuiltPrompt {
    const ctx: WorktreePromptContext = { issue, worktree, plan, diff };
    return {
      mode: 'resume',
      system: WorktreePromptBuilder.renderSystem(ctx),
      messages: [{ role: 'user', content: WorktreePromptBuilder.renderResume(ctx) }],
      context: ctx,
    };
  }

  /**
   * Selects init vs resume based on whether PLAN.md has content.
   * Caller is responsible for reading the plan and providing it.
   */
  static buildAuto(
    issue: IssueContext,
    worktree: WorktreeContext,
    plan: PlanContext,
    diff: string
  ): BuiltPrompt {
    return plan.content.trim().length === 0
      ? WorktreePromptBuilder.buildInit(issue, worktree, plan, diff)
      : WorktreePromptBuilder.buildResume(issue, worktree, plan, diff);
  }

  /**
   * Prompt for the coordinator agent that oversees parallel worktrees.
   */
  static buildCoordinator(worktrees: CoordinatorWorktreeSummary[]): BuiltPrompt {
    const ctx: CoordinatorContext = { worktrees };
    return {
      mode: 'coordinate',
      system: 'You are the coordinator agent for a multi-worktree git repository.',
      messages: [{ role: 'user', content: WorktreePromptBuilder.renderCoordinator(ctx) }],
      context: ctx,
    };
  }

  // ── Renderers (private) ───────────────────────────────────────────────────

  private static renderSystem(ctx: WorktreePromptContext): string {
    const { issue, worktree, plan, diff } = ctx;
    const progress = plan.totalTasks > 0
      ? `${plan.completedTasks}/${plan.totalTasks} tasks completed`
      : 'No tasks defined yet';

    return `\
You are an autonomous coding agent operating inside an isolated git worktree.

## Context
- Issue #${issue.number}: ${issue.title}
- Description: ${issue.body || '(no description)'}
- Worktree path: ${worktree.path}
- Branch: ${worktree.branch}
- Base branch: ${worktree.baseBranch}
- Progress: ${progress}

## Plan (${PLAN_FILENAME})
${plan.content || '(empty — needs to be created)'}

## Current diff
${diff || 'No changes yet.'}

## Operating rules
- Work ONLY inside the worktree path above
- After each file change, explain what you changed and why
- If a task is ambiguous, ask ONE clarifying question before proceeding
- Never modify files outside the worktree
- Mark tasks as [x] in ${PLAN_FILENAME} as you complete them

## Mode inference
- ${PLAN_FILENAME} missing or empty     → create it first, then wait for confirmation
- ${PLAN_FILENAME} has unchecked tasks  → execute them one by one
- ${PLAN_FILENAME} has open questions   → address them before writing code
- All tasks [x]                         → write a completion summary
`;
  }

  private static renderInit(ctx: WorktreePromptContext): string {
    const { issue, worktree } = ctx;
    return `\
A new worktree has been created for issue #${issue.number}.

## Your first task
Analyze the issue and generate a ${PLAN_FILENAME} at: ${worktree.path}/${PLAN_FILENAME}

Use this structure:

# Plan: ${issue.title}

## Objective
<one sentence summary>

## Steps
- [ ] Step 1
- [ ] Step 2

## Files likely involved
- path/to/file.ts

## Open questions
- (or remove this section if none)

After writing the plan, briefly summarize your analysis.
Wait for approval before making any code changes.
`;
  }

  private static renderResume(ctx: WorktreePromptContext): string {
    const { issue, plan, diff } = ctx;
    const remaining = plan.totalTasks - plan.completedTasks;

    if (remaining === 0) {
      return `\
All ${plan.totalTasks} tasks in ${PLAN_FILENAME} are complete for issue #${issue.number}.

Write a completion summary covering:
1. What was implemented
2. Files modified
3. Any follow-up actions or open PRs needed
`;
    }

    return `\
Resuming work on issue #${issue.number}: "${issue.title}".

## State
- ${plan.completedTasks} of ${plan.totalTasks} tasks done — ${remaining} remaining
- Diff: ${diff ? 'see system prompt' : 'no uncommitted changes yet'}
${plan.hasOpenQuestions ? '\n⚠️  Open questions in PLAN.md — address them before coding.\n' : ''}
## Your job
1. Review the diff to understand what has already been done
2. Find the next unchecked [ ] task in ${PLAN_FILENAME}
3. Execute it, or explain what is blocking you

Do not redo completed work.
`;
  }

  private static renderCoordinator(ctx: CoordinatorContext): string {
    const list = ctx.worktrees.map((w) =>
      `- Branch: ${w.branch} | Issue #${w.issue.number}: ${w.issue.title} | ` +
      `Progress: ${w.plan.completedTasks}/${w.plan.totalTasks} | ` +
      `Modified: ${w.modifiedFiles.length > 0 ? w.modifiedFiles.join(', ') : 'none'}`
    ).join('\n');

    return `\
Multiple worktrees are active in parallel.

## Active worktrees
${list}

## Your job
Report:
1. **Conflicts** — worktrees modifying the same files (file + branches)
2. **Dependencies** — worktrees that must complete before others can start
3. **Merge order** — recommended integration sequence
4. **Safe to merge** — branches with no conflicts ready now

Be concise. Do not suggest code changes.
`;
  }
}