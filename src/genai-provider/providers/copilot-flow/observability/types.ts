/**
 * CopilotFlow — Observability types.
 *
 * Event system for tracing, logging, and debugging task execution.
 * No `vscode` dependency.
 */

/** Events emitted during CopilotFlow execution. */
export interface FlowEvents {
  taskStart: { taskName: string; attempt: number };
  taskEnd: { taskName: string; attempt: number; success: boolean };
  taskError: { taskName: string; attempt: number; error: string };
  chainStart: { chainName: string; taskCount: number };
  chainEnd: { chainName: string; success: boolean };
  graphStart: { graphName: string; startNode: string };
  graphEnd: { graphName: string; success: boolean };
  nodeEnter: { graphName: string; nodeId: string; step: number };
  planGenerated: { plannerName: string; stepCount: number };
}

export type FlowEventName = keyof FlowEvents;

export type FlowEventHandler<K extends FlowEventName> = (payload: FlowEvents[K]) => void;

/** A single recorded trace entry. */
export interface TraceEntry {
  event: FlowEventName;
  payload: FlowEvents[FlowEventName];
  timestamp: number;
}

/**
 * Simple event bus for CopilotFlow observability.
 */
export interface EventBus {
  on<K extends FlowEventName>(event: K, handler: FlowEventHandler<K>): void;
  off<K extends FlowEventName>(event: K, handler: FlowEventHandler<K>): void;
  emit<K extends FlowEventName>(event: K, payload: FlowEvents[K]): void;
}
