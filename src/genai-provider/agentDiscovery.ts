/**
 * Pure helper for discovering GitHub Copilot agent definition files.
 *
 * Agents are Markdown files stored in `.github/agents/` at the workspace
 * root.  Each file name (without extension) becomes the agent slug.
 * The first `# Heading` line (if any) is used as the display name;
 * otherwise the slug is title-cased.
 *
 * This module is free of VS Code dependencies so it can be tested in
 * any environment.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Describes one discovered agent file. */
export interface AgentInfo {
  /** File name without extension, e.g. `"code-reviewer"`. */
  slug: string;
  /** Human-readable name (from first `# Heading`, or title-cased slug). */
  displayName: string;
  /** Absolute path to the `.md` file. */
  filePath: string;
  /** Whether this agent can participate in squad mode. Parsed from `agent-board-squad: true` frontmatter. */
  canSquad: boolean;
}

/** Directory name relative to the workspace root. */
export const AGENTS_DIR = '.github/agents';

/**
 * Discover agent files under `<workspaceRoot>/.github/agents/`.
 *
 * Returns an empty array when the directory does not exist or contains
 * no `.md` files.
 */
export function discoverAgents(workspaceRoot: string): AgentInfo[] {
  const dir = path.join(workspaceRoot, AGENTS_DIR);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }

  const entries = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  return entries.map(fileName => {
    const slug = fileName.replace(/(?:\.agent)?\.md$/i, '');
    const filePath = path.join(dir, fileName);
    const content = readFileContent(filePath);
    const frontmatter = parseFrontmatter(content);
    const displayName = extractDisplayNameFromContent(content, slug);
    const canSquad = frontmatter['agent-board-squad'] === true;
    return { slug, displayName, filePath, canSquad };
  });
}

/**
 * Read the content of a specific agent file.
 *
 * Returns `undefined` when the file does not exist.
 */
export function readAgentInstructions(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

// ── Internals ───────────────────────────────────────────────────────────────

/** Read file content safely, returning empty string on failure. */
function readFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Parse YAML-like frontmatter delimited by `---`.
 * Returns a simple key-value record. Supports boolean and string values.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) { return {}; }
  const result: Record<string, unknown> = {};
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.+)$/);
    if (!kv) { continue; }
    const [, key, raw] = kv;
    const val = raw.trim();
    if (val === 'true') { result[key] = true; }
    else if (val === 'false') { result[key] = false; }
    else { result[key] = val; }
  }
  return result;
}

/**
 * Extract a human-readable display name from the first `# Heading` in
 * a Markdown string.  Falls back to title-casing the slug.
 */
function extractDisplayNameFromContent(content: string, slug: string): string {
  const match = content.match(/^#\s+(.+)/m);
  if (match) {
    return match[1].trim();
  }
  return titleCase(slug);
}

/** Convert `"code-reviewer"` → `"Code Reviewer"`. */
export function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
