import {
    BlockTypeSelect,
    BoldItalicUnderlineToggles,
    codeBlockPlugin,
    CodeToggle,
    CreateLink,
    headingsPlugin,
    InsertThematicBreak,
    linkDialogPlugin,
    linkPlugin,
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
}

export const MarkdownEditor = forwardRef<MDXEditorMethods, MarkdownEditorProps>(
  function MarkdownEditor({ editorKey, markdown, placeholder, compact }, ref) {
    injectEditorStyles();

    return (
      <div className={`md-editor-container${compact ? ' md-editor-container--compact' : ''}`}>
        <MDXEditor
          ref={ref}
          key={editorKey}
          markdown={markdown}
          placeholder={placeholder}
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <>
                  <UndoRedo />
                  <BlockTypeSelect />
                  <BoldItalicUnderlineToggles />
                  <CodeToggle />
                  <ListsToggle />
                  <CreateLink />
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
