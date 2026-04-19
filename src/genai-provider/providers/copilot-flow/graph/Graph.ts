/**
 * CopilotFlow — Graph Engine.
 *
 * Supports dynamic branching flows with nodes, static edges,
 * conditional (function) edges, loop protection, and shared context.
 *
 * No `vscode` dependency.
 */

import { formatError } from '../../../../utils/errorUtils';
import { Middleware } from '../middleware/types';
import { EventBus } from '../observability/types';
import { runTask } from '../task/runTask';
import { Task, TaskContext, TaskResult } from '../task/types';

/** Special sentinel node ID that terminates the graph. */
export const END_NODE = '__END__';

/** Default maximum number of steps before the graph is killed. */
const DEFAULT_MAX_STEPS = 50;

/**
 * A conditional edge function.
 * Receives the current context and returns the ID of the next node.
 */
export type EdgeFn = (context: TaskContext) => string;

/** A node in the execution graph. */
export interface GraphNode {
  /** Unique node ID. */
  id: string;
  /** The task to execute at this node. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Task<any, any>;
  /** Key in context to read input from (default: `__input`). */
  inputKey?: string;
  /** Key in context to write output to (default: `<id>_output`). */
  outputKey?: string;
  /**
   * Next node(s):
   * - `string` → static edge to a fixed node ID
   * - `EdgeFn` → dynamic edge resolved at runtime
   * - `undefined` → terminal node (equivalent to END_NODE)
   */
  next?: string | EdgeFn;
}

/** Options for constructing a Graph. */
export interface GraphOptions {
  /** Human-readable name for logging. */
  name: string;
  /** The runner function (prompt → raw output). */
  runner: (prompt: string) => Promise<string>;
  /** Middleware applied to every node task. */
  middleware?: Middleware[];
  /** Maximum steps before aborting (default: 50). */
  maxSteps?: number;
  /** Event bus for observability. */
  eventBus?: EventBus;
}

/** Result of a graph execution. */
export interface GraphResult {
  ok: boolean;
  context: TaskContext;
  /** Ordered list of visited node IDs. */
  visitedNodes: string[];
  /** Per-node task results. */
  nodeResults: { nodeId: string; result: TaskResult<unknown> }[];
  error?: string;
}

/**
 * A directed graph of tasks with static and dynamic edges.
 *
 * ```ts
 * const graph = new Graph({ name: 'review-flow', runner });
 * graph.addNode({ id: 'analyse', task: analyseTask, next: 'decide' });
 * graph.addNode({ id: 'decide', task: decideTask, next: ctx => ctx.needsFix ? 'fix' : END_NODE });
 * graph.addNode({ id: 'fix', task: fixTask, next: 'analyse' });
 * const result = await graph.run('analyse', { code: '...' });
 * ```
 */
export class Graph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly options: GraphOptions;

  constructor(options: GraphOptions) {
    this.options = options;
  }

  /** Register a node. */
  addNode(node: GraphNode): this {
    this.nodes.set(node.id, node);
    return this;
  }

  /**
   * Execute the graph starting from `startNodeId`.
   *
   * @param startNodeId - ID of the first node to execute.
   * @param input - Initial input written to `context.__input`.
   * @param initialContext - Optional pre-populated context.
   */
  async run(startNodeId: string, input: unknown, initialContext?: TaskContext): Promise<GraphResult> {
    const context: TaskContext = { ...initialContext, __input: input };
    const visitedNodes: string[] = [];
    const nodeResults: GraphResult['nodeResults'] = [];
    const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
    const { runner, middleware = [], eventBus } = this.options;

    eventBus?.emit('graphStart', { graphName: this.options.name, startNode: startNodeId });

    let currentId: string | undefined = startNodeId;
    let step = 0;

    while (currentId && currentId !== END_NODE) {
      if (step >= maxSteps) {
        const error = `Graph "${this.options.name}" exceeded max steps (${maxSteps})`;
        eventBus?.emit('graphEnd', { graphName: this.options.name, success: false });
        return { ok: false, context, visitedNodes, nodeResults, error };
      }

      const node = this.nodes.get(currentId);
      if (!node) {
        const error = `Node "${currentId}" not found in graph "${this.options.name}"`;
        eventBus?.emit('graphEnd', { graphName: this.options.name, success: false });
        return { ok: false, context, visitedNodes, nodeResults, error };
      }

      step++;
      visitedNodes.push(currentId);
      eventBus?.emit('nodeEnter', { graphName: this.options.name, nodeId: currentId, step });

      const taskInput = context[node.inputKey ?? '__input'];
      const outputKey = node.outputKey ?? `${node.id}_output`;

      try {
        const result = await runTask(
          { task: node.task, input: taskInput, context, runner, middleware },
          eventBus,
        );

        nodeResults.push({ nodeId: currentId, result });

        if (!result.ok) {
          eventBus?.emit('graphEnd', { graphName: this.options.name, success: false });
          return {
            ok: false,
            context,
            visitedNodes,
            nodeResults,
            error: `Node "${currentId}" task "${node.task.name}" failed`,
          };
        }

        context[outputKey] = result.output;
      } catch (err) {
        const error = `Node "${currentId}" threw: ${formatError(err)}`;
        eventBus?.emit('graphEnd', { graphName: this.options.name, success: false });
        return { ok: false, context, visitedNodes, nodeResults, error };
      }

      // Resolve next node
      if (node.next === undefined) {
        currentId = undefined;
      } else if (typeof node.next === 'string') {
        currentId = node.next;
      } else {
        currentId = node.next(context);
      }
    }

    eventBus?.emit('graphEnd', { graphName: this.options.name, success: true });
    return { ok: true, context, visitedNodes, nodeResults };
  }
}
