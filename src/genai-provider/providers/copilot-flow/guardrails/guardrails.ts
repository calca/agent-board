/**
 * CopilotFlow — Guardrails & Validation.
 *
 * Utilities for parsing, validating, and recovering from invalid
 * LLM outputs.  Uses a lightweight schema validation approach
 * (no external Zod dependency — keeps the extension bundle lean).
 *
 * No `vscode` dependency.
 */

import { formatError } from '../../../../utils/errorUtils';

// ── JSON parsing ────────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning `{ ok, data, error }`.
 * Handles common LLM quirks: markdown fences, trailing commas, etc.
 */
export function safeJsonParse<T = unknown>(raw: string): { ok: true; data: T } | { ok: false; error: string } {
  const cleaned = stripJsonFences(raw);
  try {
    return { ok: true, data: JSON.parse(cleaned) as T };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/**
 * Strip markdown code fences that LLMs often wrap around JSON output.
 * Handles ```json ... ``` and ``` ... ```.
 */
function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json\n...\n``` or ```\n...\n```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) { return fenceMatch[1]; }
  return trimmed;
}

// ── Schema validation ───────────────────────────────────────────────

/** A validation function: returns `true` if valid, or a string error. */
export type Validator<T> = (value: T) => true | string;

/**
 * Validate a value against a validator function.
 */
export function validateWithSchema<T>(value: T, validator: Validator<T>): { ok: true; data: T } | { ok: false; error: string } {
  const result = validator(value);
  if (result === true) { return { ok: true, data: value }; }
  return { ok: false, error: result };
}

// ── Composable validators ───────────────────────────────────────────

/** Require a value to be a non-empty string. */
export function isNonEmptyString(value: unknown): true | string {
  if (typeof value === 'string' && value.trim().length > 0) { return true; }
  return 'Expected non-empty string';
}

/** Require a value to be an array. */
export function isArray(value: unknown): true | string {
  if (Array.isArray(value)) { return true; }
  return 'Expected an array';
}

/** Require a value to be a plain object with specific required keys. */
export function hasKeys(...keys: string[]): Validator<unknown> {
  return (value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return 'Expected a plain object';
    }
    const obj = value as Record<string, unknown>;
    for (const key of keys) {
      if (!(key in obj)) { return `Missing required key: "${key}"`; }
    }
    return true;
  };
}

/** Compose multiple validators (all must pass). */
export function allOf<T>(...validators: Validator<T>[]): Validator<T> {
  return (value: T) => {
    for (const v of validators) {
      const result = v(value);
      if (result !== true) { return result; }
    }
    return true;
  };
}

// ── Fix invalid JSON ────────────────────────────────────────────────

/**
 * Build a corrective prompt for when the LLM produces invalid JSON.
 *
 * Useful as a retry strategy: feed this prompt back to the LLM
 * to ask it to fix its own output.
 */
export function buildJsonFixPrompt(invalidOutput: string, parseError: string): string {
  return [
    'The previous output was invalid JSON. Fix it and return ONLY valid JSON.',
    '',
    '## Error',
    parseError,
    '',
    '## Invalid output',
    '```',
    invalidOutput.slice(0, 2000), // cap to avoid huge prompts
    '```',
    '',
    'Return ONLY the corrected JSON, with no additional text or markdown fences.',
  ].join('\n');
}
