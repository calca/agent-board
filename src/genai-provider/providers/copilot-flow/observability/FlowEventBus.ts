/**
 * CopilotFlow — Observability implementation.
 *
 * EventBus, structured logger, and trace exporter.
 * No `vscode` dependency.
 */

import { EventBus, FlowEventHandler, FlowEventName, FlowEvents, TraceEntry } from './types';

/**
 * Simple in-memory event bus.
 */
export class FlowEventBus implements EventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, Set<FlowEventHandler<any>>>();

  on<K extends FlowEventName>(event: K, handler: FlowEventHandler<K>): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  off<K extends FlowEventName>(event: K, handler: FlowEventHandler<K>): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit<K extends FlowEventName>(event: K, payload: FlowEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const h of set) { h(payload); }
    }
  }
}

/**
 * Tracer that records all events into a timeline for export.
 */
export class FlowTracer {
  private readonly entries: TraceEntry[] = [];
  private readonly eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.wireUp();
  }

  private wireUp(): void {
    const events: FlowEventName[] = [
      'taskStart', 'taskEnd', 'taskError',
      'chainStart', 'chainEnd',
      'graphStart', 'graphEnd', 'nodeEnter',
      'planGenerated',
    ];
    for (const event of events) {
      this.eventBus.on(event, (payload) => {
        this.entries.push({ event, payload, timestamp: Date.now() });
      });
    }
  }

  /** Get all recorded trace entries. */
  getEntries(): readonly TraceEntry[] {
    return this.entries;
  }

  /** Export the full trace as a JSON string. */
  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.length = 0;
  }
}
