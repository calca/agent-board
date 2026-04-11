import Markdown from 'react-markdown';
import { sanitizeHtml } from '../utils';

interface MarkdownBodyProps {
  body: string;
  className?: string;
  /** When true, truncate to a short snippet. */
  snippet?: boolean;
  snippetLength?: number;
}

/** Lightweight markdown renderer for read-only bodies (cards, details, edit form). */
export function MarkdownBody({ body, className, snippet, snippetLength = 80 }: MarkdownBodyProps) {
  const isHtml = /<[a-z][\s\S]*>/i.test(body);

  if (snippet) {
    const plain = isHtml ? body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : body;
    const text = plain.slice(0, snippetLength).replace(/\n/g, ' ') + (plain.length > snippetLength ? '…' : '');
    return (
      <div className={className}>
        <Markdown>{text}</Markdown>
      </div>
    );
  }

  if (isHtml) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }} />;
  }

  return (
    <div className={className}>
      <Markdown>{body}</Markdown>
    </div>
  );
}
