import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  codeBlockPlugin,
  markdownShortcutPlugin,
} from '@mdxeditor/editor';
import React from 'react';
// @ts-ignore — esbuild loader:text returns a string at runtime
import editorStylesRaw from '@mdxeditor/editor/style.css';

let injected = false;
function injectStyles(): void {
  if (injected) { return; }
  const style = document.createElement('style');
  style.id = 'mdxeditor-viewer-styles';
  style.textContent = editorStylesRaw as string;
  document.head.appendChild(style);
  injected = true;
}

interface MarkdownViewerProps {
  markdown: string;
}

export function MarkdownViewer({ markdown }: MarkdownViewerProps) {
  injectStyles();

  return (
    <div className="md-viewer">
      <MDXEditor
        markdown={markdown}
        readOnly
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
          markdownShortcutPlugin(),
        ]}
      />
    </div>
  );
}
