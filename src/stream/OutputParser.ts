/**
 * Stateful parser that extracts structured blocks from raw agent output.
 *
 * Recognised patterns:
 * - Fenced code blocks: ` ```lang … ``` ` (with special handling for `diff` and `bash`)
 * - `FILE: <path>` lines
 * - Plain text runs (everything else)
 */

/** Discriminated union of block types emitted by the parser. */
export type ParsedBlock =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'diff'; content: string }
  | { type: 'bash'; content: string }
  | { type: 'file'; path: string };

/**
 * Feed raw output lines to the parser; call `flush()` at the end to
 * retrieve all remaining blocks.
 *
 * The parser is **stateful** — it tracks whether it is currently inside
 * a fenced code block — so lines should be fed in order.
 */
export class OutputParser {
  private readonly blocks: ParsedBlock[] = [];
  private textAccumulator: string[] = [];

  // Fenced-block state
  private inFence = false;
  private fenceLanguage = '';
  private fenceLines: string[] = [];

  /** Process one or more lines of raw output (newline-separated). */
  feed(text: string): void {
    const lines = text.split('\n');
    for (const line of lines) {
      this.processLine(line);
    }
  }

  /**
   * Flush any remaining accumulated text or open fence block and
   * return all parsed blocks collected so far.
   *
   * Resets internal state so the parser can be reused.
   */
  flush(): ParsedBlock[] {
    // Close any open fence block
    if (this.inFence) {
      this.emitFenceBlock();
    }
    this.flushText();

    const result = [...this.blocks];
    this.blocks.length = 0;
    return result;
  }

  // ── internals ───────────────────────────────────────────────────────

  private processLine(line: string): void {
    // Detect fence open / close
    const fenceMatch = line.match(/^```(\w*)$/);

    if (this.inFence) {
      if (fenceMatch !== null) {
        // Closing fence
        this.emitFenceBlock();
        return;
      }
      this.fenceLines.push(line);
      return;
    }

    // Not inside a fence — check for opening
    if (fenceMatch !== null) {
      this.flushText();
      this.inFence = true;
      this.fenceLanguage = fenceMatch[1] || 'text';
      this.fenceLines = [];
      return;
    }

    // FILE: path pattern
    const fileMatch = line.match(/^FILE:\s*(.+)$/);
    if (fileMatch) {
      this.flushText();
      this.blocks.push({ type: 'file', path: fileMatch[1].trim() });
      return;
    }

    // Plain text
    this.textAccumulator.push(line);
  }

  private flushText(): void {
    if (this.textAccumulator.length === 0) {
      return;
    }
    const content = this.textAccumulator.join('\n');
    if (content.trim().length > 0) {
      this.blocks.push({ type: 'text', content });
    }
    this.textAccumulator = [];
  }

  private emitFenceBlock(): void {
    const content = this.fenceLines.join('\n');
    const lang = this.fenceLanguage.toLowerCase();

    if (lang === 'diff') {
      this.blocks.push({ type: 'diff', content });
    } else if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      this.blocks.push({ type: 'bash', content });
    } else {
      this.blocks.push({ type: 'code', language: this.fenceLanguage, content });
    }

    this.inFence = false;
    this.fenceLanguage = '';
    this.fenceLines = [];
  }
}
