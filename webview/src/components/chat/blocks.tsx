import { escapeHtml } from '../../utils';
import type { UIBlock } from './chatTypes';

/* ── Block components ─────────────────────────────────────────────────── */

export function TextBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="cb-text">
      {content}
      {streaming && <span className="cb-cursor" />}
    </div>
  );
}

export function CodeBlock({ content, language }: { content: string; language?: string }) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
  };

  return (
    <div className="cb-code">
      <div className="cb-code__header">
        <span className="cb-code__lang">{language ?? 'text'}</span>
        <button className="cb-code__copy" onClick={handleCopy} title="Copy">⎘</button>
      </div>
      <pre className="cb-code__body"><code>{content}</code></pre>
    </div>
  );
}

export function CommandBlock({ content }: { content: string }) {
  return (
    <div className="cb-command">
      <span className="cb-command__icon">▶</span>
      <code className="cb-command__text">{content}</code>
    </div>
  );
}

export function ResultBlock({ content }: { content: string }) {
  return (
    <div className="cb-result">
      <pre className="cb-result__body">{content}</pre>
    </div>
  );
}

export function StepBlock({ label, status }: { label: string; status?: 'running' | 'done' }) {
  const icon = status === 'done' ? '✓' : '⟳';
  const cls = `cb-step ${status === 'done' ? 'cb-step--done' : 'cb-step--running'}`;
  return (
    <div className={cls}>
      <span className="cb-step__icon">{icon}</span>
      <span className="cb-step__label">{label}</span>
    </div>
  );
}
