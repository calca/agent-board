/**
 * Standardised error formatting utility.
 *
 * Provides a consistent way to extract a human-readable message from
 * unknown `catch` values across the entire codebase.
 */

/**
 * Extract a human-readable message from an unknown error value.
 *
 * - `Error` instances → `err.message`
 * - Strings → returned as-is
 * - Everything else → `String(value)`
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return String(err);
}
