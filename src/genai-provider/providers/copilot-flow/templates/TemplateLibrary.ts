/**
 * CopilotFlow — Prompt Templates.
 *
 * Simple template engine with `{{variable}}` placeholder support.
 * Supports a template library and versioning.
 *
 * No `vscode` dependency.
 */

/** A registered prompt template. */
export interface PromptTemplate {
  /** Unique template name. */
  name: string;
  /** Template version (semver-like string). */
  version: string;
  /** The template body with `{{placeholder}}` variables. */
  body: string;
}

/**
 * Render a template string by replacing `{{key}}` placeholders
 * with values from the data object.
 *
 * Unknown placeholders are left as-is.
 */
export function renderTemplate(template: string, data: Record<string, string | number | boolean>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in data) { return String(data[key]); }
    return match;
  });
}

/**
 * In-memory template library.
 *
 * ```ts
 * const lib = new TemplateLibrary();
 * lib.register({ name: 'code-review', version: '1.0.0', body: 'Review {{file}}...' });
 * const prompt = lib.render('code-review', { file: 'auth.ts' });
 * ```
 */
export class TemplateLibrary {
  private readonly templates = new Map<string, PromptTemplate>();

  /** Register or update a template. */
  register(template: PromptTemplate): void {
    this.templates.set(template.name, template);
  }

  /** Get a template by name. */
  get(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /** List all registered templates. */
  list(): PromptTemplate[] {
    return [...this.templates.values()];
  }

  /** Remove a template. */
  remove(name: string): boolean {
    return this.templates.delete(name);
  }

  /**
   * Render a named template with the given data.
   * Throws if the template is not found.
   */
  render(name: string, data: Record<string, string | number | boolean>): string {
    const tmpl = this.templates.get(name);
    if (!tmpl) { throw new Error(`Template "${name}" not found`); }
    return renderTemplate(tmpl.body, data);
  }
}
