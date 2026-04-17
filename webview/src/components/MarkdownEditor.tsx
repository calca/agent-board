import {
    BlockTypeSelect,
    BoldItalicUnderlineToggles,
    codeBlockPlugin,
    CodeToggle,
    headingsPlugin,
    InsertCodeBlock,
    InsertThematicBreak,
    listsPlugin,
    ListsToggle,
    markdownShortcutPlugin,
    MDXEditor,
    quotePlugin,
    thematicBreakPlugin,
    toolbarPlugin,
    UndoRedo,
    useCodeBlockEditorContext,
    type CodeBlockEditorDescriptor,
    type MDXEditorMethods,
} from '@mdxeditor/editor';
import React, { forwardRef, useCallback } from 'react';
// @ts-ignore — esbuild loader:text returns a string at runtime
import editorStylesRaw from '@mdxeditor/editor/style.css';

let editorStylesInjected = false;
function injectEditorStyles(): void {
  if (editorStylesInjected) { return; }
  const style = document.createElement('style');
  style.id = 'mdxeditor-styles';
  style.textContent = editorStylesRaw as string;
  document.head.appendChild(style);
  editorStylesInjected = true;
}

export type { MDXEditorMethods };

/** Simple textarea-based fallback code block editor. */
function PlainTextCodeEditor({ code, language }: { code: string; language: string }) {
  const { setCode } = useCodeBlockEditorContext();
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => setCode(e.target.value),
    [setCode],
  );
  return (
    <div className="md-code-block-fallback">
      {language && <span className="md-code-block-fallback__lang">{language}</span>}
      <textarea
        className="md-code-block-fallback__textarea"
        defaultValue={code}
        onChange={handleChange}
        spellCheck={false}
      />
    </div>
  );
}

const plainTextDescriptor: CodeBlockEditorDescriptor = {
  priority: -1,
  match: () => true,
  Editor: ({ code, language }) => <PlainTextCodeEditor code={code} language={language} />,
};

interface MarkdownEditorProps {
  /** Unique key to force remount when editing a different task. */
  editorKey: string;
  /** Initial markdown content. */
  markdown: string;
  /** Placeholder shown when editor is empty. */
  placeholder?: string;
  /** If true, make the editor compact (fewer rows). */
  compact?: boolean;
  /** Called on every content change with the current markdown string. */
  onChange?: (markdown: string) => void;
}

export const MarkdownEditor = forwardRef<MDXEditorMethods, MarkdownEditorProps>(
  function MarkdownEditor({ editorKey, markdown, placeholder, compact, onChange }, ref) {
    injectEditorStyles();

    return (
      <div className={`md-editor-container${compact ? ' md-editor-container--compact' : ''}`}>
        <MDXEditor
          ref={ref}
          key={editorKey}
          markdown={markdown}
          placeholder={placeholder}
          onChange={onChange}
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            codeBlockPlugin({
              defaultCodeBlockLanguage: '',
              codeBlockEditorDescriptors: [plainTextDescriptor],
            }),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <>
                  <UndoRedo />
                  <BlockTypeSelect />
                  <BoldItalicUnderlineToggles />
                  <CodeToggle />
                  <InsertCodeBlock />
                  <ListsToggle />
                  <InsertThematicBreak />
                </>
              ),
            }),
          ]}
        />
      </div>
    );
  }
);
