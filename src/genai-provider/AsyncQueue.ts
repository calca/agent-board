/**
 * Generic async iterable queue for real-time streaming.
 *
 * Usage:
 *   const q = new AsyncQueue<string>();
 *   q.push('hello');
 *   q.end();
 *
 *   for await (const chunk of q) { ... }
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private resolve: ((value: IteratorResult<T>) => void) | null = null;
  private done = false;
  private error: Error | null = null;

  /** Enqueue a value. Wakes a pending consumer if one is waiting. */
  push(value: T): void {
    if (this.done) { return; }
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value, done: false });
    } else {
      this.buffer.push(value);
    }
  }

  /** Signal that no more values will be produced. */
  end(): void {
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as T, done: true });
    }
  }

  /** Signal an error to the consumer. */
  throw(err: Error): void {
    this.error = err;
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      // We resolve with done:true and let next() throw on subsequent call
      r({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.error) {
          return Promise.reject(this.error);
        }
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}
