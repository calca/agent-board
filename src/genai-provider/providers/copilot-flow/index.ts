/**
 * CopilotFlow — Modular AI orchestration framework.
 *
 * Integrated as an IGenAiProvider for the Agent Board UI.
 * Provides pipeline, graph, and planner workflows with
 * validation, retry, middleware, and observability.
 */

// Provider (IGenAiProvider adapter)
export { CopilotFlowGenAiProvider } from './CopilotFlowGenAiProvider';

// Task Abstraction (FASE 2)
export { RetryConfig, runTask, RunTaskOptions, Task, TaskAttempt, TaskContext, TaskResult } from './task';
export { SelfHealingOptions, selfHealingRun } from './task/selfHealing';

// Chain Engine (FASE 3)
export { Chain, ChainHook, ChainOptions, ChainResult } from './chain';

// Guardrails & Validation (FASE 4)
export {
    allOf,
    buildJsonFixPrompt, hasKeys, isArray, isNonEmptyString, safeJsonParse, validateWithSchema, Validator
} from './guardrails';

// Graph Engine (FASE 5)
export { EdgeFn, END_NODE, Graph, GraphNode, GraphOptions, GraphResult } from './graph';

// Planner (FASE 6)
export { Planner, PlannerOptions, PlannerResult, PlanStep } from './planner';

// Middleware (FASE 8)
export {
    FlowMetrics, loggingMiddleware, metricsMiddleware, Middleware, MiddlewareTaskInfo, NextFn, securityMiddleware, SecurityMiddlewareOptions
} from './middleware';

// Observability (FASE 9)
export {
    EventBus, FlowEventBus, FlowEventHandler, FlowEventName, FlowEvents, FlowTracer, TraceEntry
} from './observability';

// Prompt Templates (FASE 10)
export { PromptTemplate, renderTemplate, TemplateLibrary } from './templates';

// Performance & Scaling (FASE 13)
export { cachingMiddleware, ParallelItem, RateLimiter, rateLimitMiddleware, ResultCache, runParallel } from './performance';

// Security & Governance (FASE 14)
export { AuditEntry, AuditLog, buildAllowedToolFlags, PolicyEngine, PolicyRule, sanitisePrompt, validateInput } from './security';

// Multi-Agent (FASE 15)
export {
    AgentDefinition, AgentRole, MultiAgentOptions, MultiAgentResult, runMultiAgent
} from './agents';

