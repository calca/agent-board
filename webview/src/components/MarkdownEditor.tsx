import {
    BlockTypeSelect,
    BoldItalicUnderlineToggles,
    headingsPlugin,
    InsertThematicBreak,
    listsPlugin,
    ListsToggle,
    markdownShortcutPlugin,
    MDXEditor,
    quotePlugin,
    thematicBreakPlugin,
    toolbarPlugin,
    UndoRedo,
    type MDXEditorMethods,
} from '@mdxeditor/editor';
import { forwardRef } from 'react';
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
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <>
                  <UndoRedo />
                  <BlockTypeSelect />
                  <BoldItalicUnderlineToggles />
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
