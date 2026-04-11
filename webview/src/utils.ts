/** Utility functions shared across webview components. */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strip dangerous tags/attributes but allow safe formatting HTML. */
export function sanitizeHtml(html: string): string {
  const allowedTags = new Set([
    'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'code', 'pre', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'hr', 'img',
  ]);
  const allowedAttrs = new Set(['href', 'src', 'alt', 'title', 'class', 'id']);

  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  function walk(node: Element): void {
    const children = Array.from(node.children);
    for (const child of children) {
      if (!allowedTags.has(child.tagName.toLowerCase())) {
        const text = document.createTextNode(child.textContent ?? '');
        node.replaceChild(text, child);
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        if (!allowedAttrs.has(attr.name.toLowerCase())) {
          child.removeAttribute(attr.name);
        }
      }
      for (const urlAttr of ['href', 'src']) {
        const val = child.getAttribute(urlAttr);
        if (val && !/^https?:\/\//i.test(val.trim()) && !val.trim().startsWith('#')) {
          child.removeAttribute(urlAttr);
        }
      }
      walk(child);
    }
  }
  walk(tmp);
  return tmp.innerHTML;
}

export function relativeWorktreePath(absPath: string, workspaceRoot: string): string {
  if (!workspaceRoot) { return absPath; }
  const root = workspaceRoot.endsWith('/') ? workspaceRoot : workspaceRoot + '/';
  const parent = root.replace(/[^/]+\/$/, '');
  if (absPath.startsWith(parent)) { return absPath.slice(parent.length); }
  return absPath;
}
