import * as vscode from 'vscode';

/** Default maximum number of lines kept in the circular buffer. */
export const DEFAULT_MAX_LINES = 10_000;

/** A stream chunk with an attached wall-clock timestamp (HH:MM:SS). */
export interface StreamChunk {
  sessionId: string;
  text: string;
  ts: string;
}

/**
 * Circular-buffer log controller for a single session.
 *
 * - Stores up to `maxLines` (default 10 000) lines.
 * - Fires `onDidAppend` with each appended chunk so the WebView
 *   can stream output in real time.
 * - `exportLog()` returns the full buffer content as a string.
 */
export class StreamController implements vscode.Disposable {
  private readonly buffer: string[] = [];
  private readonly maxLines: number;

  private readonly _onDidAppend = new vscode.EventEmitter<string>();
  /** Fires every time new text is appended. */
  readonly onDidAppend: vscode.Event<string> = this._onDidAppend.event;

  constructor(maxLines: number = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
  }

  /** Append one or more lines of output (stores raw text; timestamp prefix in export). */
  append(text: string): void {
    const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
    const lines = text.split('\n');
    for (const line of lines) {
      // Store with timestamp prefix so export is self-documenting
      this.buffer.push(`[${ts}] ${line}`);
    }
    // Trim from the front when over capacity
    while (this.buffer.length > this.maxLines) {
      this.buffer.shift();
    }
    this._onDidAppend.fire(text);
  }

  /** Return all buffered lines joined by newline. */
  exportLog(): string {
    return this.buffer.join('\n');
  }

  /** Return the number of buffered lines. */
  get lineCount(): number {
    return this.buffer.length;
  }

  /** Clear the buffer. */
  clear(): void {
    this.buffer.length = 0;
  }

  dispose(): void {
    this._onDidAppend.dispose();
  }
}

/**
 * Registry that maps `sessionId` → `StreamController`.
 *
 * Use `getOrCreate()` when launching a session and `remove()` when
 * cleaning up.
 */
export class StreamRegistry implements vscode.Disposable {
  private readonly controllers = new Map<string, StreamController>();

  private readonly _onDidAppendAny = new vscode.EventEmitter<StreamChunk>();
  /** Fires whenever any session appends new text. */
  readonly onDidAppendAny: vscode.Event<StreamChunk> = this._onDidAppendAny.event;

  /** Get or lazily create a controller for the given session. */
  getOrCreate(sessionId: string, maxLines?: number): StreamController {
    let ctrl = this.controllers.get(sessionId);
    if (!ctrl) {
      ctrl = new StreamController(maxLines);
      // Forward all appends from this session to the registry-level event
      ctrl.onDidAppend(text => {
        const ts = new Date().toISOString().slice(11, 19);
        this._onDidAppendAny.fire({ sessionId, text, ts });
      });
      this.controllers.set(sessionId, ctrl);
    }
    return ctrl;
  }

  /** Return an existing controller (or undefined). */
  get(sessionId: string): StreamController | undefined {
    return this.controllers.get(sessionId);
  }

  /** Remove and dispose a controller. */
  remove(sessionId: string): void {
    const ctrl = this.controllers.get(sessionId);
    if (ctrl) {
      ctrl.dispose();
      this.controllers.delete(sessionId);
    }
  }

  /** All tracked session ids. */
  get sessionIds(): string[] {
    return [...this.controllers.keys()];
  }

  dispose(): void {
    for (const ctrl of this.controllers.values()) {
      ctrl.dispose();
    }
    this.controllers.clear();
    this._onDidAppendAny.dispose();
  }
}
