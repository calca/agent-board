/**
 * CopilotFlow — Security & Governance.
 *
 * Input validation, prompt sanitisation, audit logging, and policy engine.
 * No `vscode` dependency.
 */

// ── Prompt Sanitisation ─────────────────────────────────────────────

/** Characters and patterns to strip from user-provided prompts. */
const DANGEROUS_PATTERNS = [
  /\x00/g,         // null bytes
  /\x1b\[[0-9;]*m/g, // ANSI escape sequences
];

/**
 * Sanitise a prompt string by removing dangerous patterns.
 */
export function sanitisePrompt(prompt: string): string {
  let cleaned = prompt;
  for (const pattern of DANGEROUS_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

// ── Input Validation ────────────────────────────────────────────────

/**
 * Validate that a prompt is safe and within bounds.
 */
export function validateInput(prompt: string, maxLength = 100_000): { ok: true } | { ok: false; error: string } {
  if (!prompt || typeof prompt !== 'string') {
    return { ok: false, error: 'Prompt must be a non-empty string' };
  }
  if (prompt.length > maxLength) {
    return { ok: false, error: `Prompt exceeds maximum length (${maxLength} chars)` };
  }
  return { ok: true };
}

// ── Audit Log ───────────────────────────────────────────────────────

/** A single audit log entry. */
export interface AuditEntry {
  timestamp: number;
  action: string;
  taskName?: string;
  promptLength?: number;
  resultLength?: number;
  success?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * In-memory audit log with bounded capacity.
 */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  /** Record an action. */
  record(entry: Omit<AuditEntry, 'timestamp'>): void {
    this.entries.push({ ...entry, timestamp: Date.now() });
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /** Get all entries. */
  getEntries(): readonly AuditEntry[] {
    return this.entries;
  }

  /** Export as JSON. */
  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

// ── Policy Engine ───────────────────────────────────────────────────

/** A policy rule that can allow or deny an action. */
export interface PolicyRule {
  /** Rule name for logging. */
  name: string;
  /** Return `true` to allow, or a string reason to deny. */
  check(action: string, context: Record<string, unknown>): true | string;
}

/**
 * Evaluates a set of policy rules. All rules must pass.
 */
export class PolicyEngine {
  private readonly rules: PolicyRule[] = [];

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  evaluate(action: string, context: Record<string, unknown> = {}): { allowed: true } | { allowed: false; deniedBy: string; reason: string } {
    for (const rule of this.rules) {
      const result = rule.check(action, context);
      if (result !== true) {
        return { allowed: false, deniedBy: rule.name, reason: result };
      }
    }
    return { allowed: true };
  }
}

// ── CLI Permission Limiter ──────────────────────────────────────────

/**
 * Build a safe set of `--allow-tool` flags based on a whitelist.
 */
export function buildAllowedToolFlags(whitelist: string[]): string[] {
  const flags: string[] = [];
  for (const tool of whitelist) {
    // Only allow alphanumeric + dash + underscore tool names
    if (/^[\w-]+$/.test(tool)) {
      flags.push('--allow-tool', tool);
    }
  }
  return flags;
}
