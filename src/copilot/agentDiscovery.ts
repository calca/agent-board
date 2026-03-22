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
    const slug = fileName.replace(/\.md$/i, '');
    const filePath = path.join(dir, fileName);
    const displayName = extractDisplayName(filePath, slug);
    return { slug, displayName, filePath };
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

/**
 * Extract a human-readable display name from the first `# Heading` in
 * a Markdown file.  Falls back to title-casing the slug.
 */
function extractDisplayName(filePath: string, slug: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^#\s+(.+)/m);
    if (match) {
      return match[1].trim();
    }
  } catch {
    // fall through to default
  }
  return titleCase(slug);
}

/** Convert `"code-reviewer"` → `"Code Reviewer"`. */
export function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
