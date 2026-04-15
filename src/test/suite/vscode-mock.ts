/**
 * Global vscode module mock for mocha tests run outside the VS Code host.
 *
 * Loaded via `--require out/test/suite/vscode-mock.js` before any test file.
 * Intercepts `require('vscode')` and returns a minimal stub that satisfies
 * the public surface used by the extension source modules.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('module') as NodeJS.Module & { _load: (r: string, p: unknown, m: boolean) => unknown };
const originalLoad = NodeModule._load.bind(NodeModule);

class FakeEventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T) { this.listeners.forEach(l => l(data)); }
  dispose() { this.listeners = []; }
}

class FakeUri {
  readonly scheme: string;
  readonly fsPath: string;
  constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
  }
  toString() { return this.fsPath; }
  static file(p: string) { return new FakeUri('file', p); }
  static parse(s: string) { return new FakeUri('file', s); }
}

const vscodeMock: Record<string, unknown> = {
  EventEmitter: FakeEventEmitter,
  Uri: FakeUri,
  Disposable: class { static from() { return { dispose() {} }; } dispose() {} },
  window: {
    createOutputChannel: () => ({
      appendLine() {},
      append() {},
      show() {},
      dispose() {},
    }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (_key: string, defaultVal?: unknown) => defaultVal,
      has: () => false,
      inspect: () => undefined,
      update: async () => undefined,
    }),
    createFileSystemWatcher: () => ({
      onDidChange: () => ({ dispose() {} }),
      onDidCreate: () => ({ dispose() {} }),
      onDidDelete: () => ({ dispose() {} }),
      dispose() {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    fs: {
      readFile: async () => Buffer.from(''),
      writeFile: async () => {},
    },
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
  },
  TreeItem: class { constructor(public label: string) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string) {} },
  MarkdownString: class { constructor(public value = '') {} },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { One: 1, Two: 2, Three: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
};

(NodeModule as unknown as { _load: typeof originalLoad })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad(request, parent, isMain);
};
