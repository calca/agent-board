/**
 * MDXEditor wrapper for task description editing.
 * Provides mount/unmount/getValue helpers that integrate with the
 * vanilla-TS kanban webview.
 */

import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  UndoRedo,
  CreateLink,
  InsertThematicBreak,
  ListsToggle,
  BlockTypeSelect,
  codeBlockPlugin,
  CodeToggle,
} from '@mdxeditor/editor';

// Import MDXEditor styles as raw text and inject once into the document.
// The webview CSP allows 'unsafe-inline' for style-src.
// @ts-ignore — esbuild loader:text returns a string at runtime
import editorStylesRaw from '@mdxeditor/editor/style.css';

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) { return; }
  const style = document.createElement('style');
  style.id = 'mdxeditor-styles';
  style.textContent = editorStylesRaw as string;
  document.head.appendChild(style);
  stylesInjected = true;
}

const editorRoots = new Map<string, Root>();
const editorValues = new Map<string, string>();

interface EditorProps {
  initialValue: string;
  containerId: string;
  placeholder?: string;
}

function MarkdownEditorComponent({ initialValue, containerId, placeholder }: EditorProps): React.ReactElement {
  const handleChange = React.useCallback((val: string) => {
    editorValues.set(containerId, val);
  }, [containerId]);

  return (
    <MDXEditor
      key={`${containerId}::${initialValue.slice(0, 32)}`}
      markdown={initialValue}
      onChange={handleChange}
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
  );
}

/**
 * Mount an MDXEditor inside the element with the given id.
 * If an editor is already mounted there, it is unmounted first.
 */
export function mountMarkdownEditor(containerId: string, initialValue: string, placeholder?: string): void {
  injectStyles();
  const container = document.getElementById(containerId);
  if (!container) { return; }

  unmountMarkdownEditor(containerId);

  const root = createRoot(container);
  editorRoots.set(containerId, root);
  editorValues.set(containerId, initialValue);

  root.render(
    <MarkdownEditorComponent
      initialValue={initialValue}
      containerId={containerId}
      placeholder={placeholder}
    />,
  );
}

/**
 * Return the current markdown value for the editor with the given id.
 * Falls back to the initial value if the editor was never changed.
 */
export function getMarkdownEditorValue(containerId: string): string {
  return editorValues.get(containerId) ?? '';
}

/**
 * Unmount the editor with the given id and clean up its state.
 */
export function unmountMarkdownEditor(containerId: string): void {
  const root = editorRoots.get(containerId);
  if (root) {
    root.unmount();
    editorRoots.delete(containerId);
  }
  editorValues.delete(containerId);
}

/**
 * Unmount all currently mounted editors.
 * Call this before replacing the DOM (e.g. before root.innerHTML = …).
 */
export function unmountAllMarkdownEditors(): void {
  for (const id of Array.from(editorRoots.keys())) {
    unmountMarkdownEditor(id);
  }
}
