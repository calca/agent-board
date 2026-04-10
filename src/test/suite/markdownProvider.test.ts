import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Test-doubles ──────────────────────────────────────────────────────────

/**
 * Minimal stub for vscode.EventEmitter so we can test MarkdownProvider
 * without a VS Code host.
 */
class FakeEventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T) { this.listeners.forEach(l => l(data)); }
  dispose() { this.listeners = []; }
}

/**
 * Minimal stub for vscode.FileSystemWatcher.
 */
class FakeWatcher {
  onDidChange = (_h: () => void) => ({ dispose: () => {} });
  onDidCreate = (_h: () => void) => ({ dispose: () => {} });
  onDidDelete = (_h: () => void) => ({ dispose: () => {} });
  dispose() {}
}

/**
 * Inject test doubles into vscode namespace before importing MarkdownProvider.
 * We use module-level `require` so we can control the import order.
 */
// Stub global `vscode` for the module loader
const vscodeMock = {
  EventEmitter: FakeEventEmitter,
  workspace: {
    workspaceFolders: undefined as unknown,
    createFileSystemWatcher: (_glob: string) => new FakeWatcher(),
    getConfiguration: (_section?: string) => ({
      get: (_key: string, defaultVal: unknown) => defaultVal,
    }),
  },
  Uri: { fsPath: '' },
};

// Inject vscode mock BEFORE importing the provider
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as NodeJS.Module & { _resolveFilename: (r: string, p: unknown) => string };
const originalLoad = (Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load;
(Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'vscode') { return vscodeMock; }
  return originalLoad.call(Module, request, parent, isMain);
};

// Also mock ProjectConfig to return a config from our test state
let mockConfig: Record<string, unknown> | undefined;
const ProjectConfigMock = {
  getProjectConfig: () => mockConfig,
  resolve: (_fileValue: unknown, _key: string, defaultValue: unknown) =>
    _fileValue !== undefined && _fileValue !== '' ? _fileValue : defaultValue,
};

// Inject the mock at the module cache level
const resolvedConfigPath = require.resolve('../../config/ProjectConfig');
require.cache[resolvedConfigPath] = {
  id: resolvedConfigPath,
  filename: resolvedConfigPath,
  loaded: true,
  parent: null,
  children: [],
  paths: [],
  exports: { ProjectConfig: ProjectConfigMock },
} as unknown as NodeJS.Module;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MarkdownProvider } = require('../../providers/MarkdownProvider') as typeof import('../../providers/MarkdownProvider');

// ── Helpers ──────────────────────────────────────────────────────────────

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-md-test-'));
}

function setWorkspaceRoot(root: string) {
  (vscodeMock.workspace as { workspaceFolders: unknown }).workspaceFolders = [
    { uri: { fsPath: root } },
  ];
}

// ── Suite ────────────────────────────────────────────────────────────────

suite('MarkdownProvider', () => {
  let tmpDir: string;
  let inboxDir: string;
  let doneDir: string;

  setup(() => {
    tmpDir = mkTmpDir();
    inboxDir = path.join(tmpDir, 'inbox');
    doneDir = path.join(tmpDir, 'done');
    fs.mkdirSync(inboxDir, { recursive: true });

    mockConfig = {
      markdownProvider: {
        enabled: true,
        inboxPath: inboxDir,   // absolute path — avoids workspace resolution
        donePath: doneDir,
      },
    };
    setWorkspaceRoot(tmpDir);
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mockConfig = undefined;
  });

  test('isEnabled returns false when config omits markdownProvider', () => {
    mockConfig = {};
    const provider = new MarkdownProvider();
    assert.strictEqual(provider.isEnabled(), false);
    provider.dispose();
  });

  test('isEnabled returns true when markdownProvider.enabled is true', () => {
    const provider = new MarkdownProvider();
    assert.strictEqual(provider.isEnabled(), true);
    provider.dispose();
  });

  test('getTasks returns empty list when inbox is empty', async () => {
    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
    provider.dispose();
  });

  test('getTasks maps .md files to tasks', async () => {
    fs.writeFileSync(path.join(inboxDir, 'my-feature.md'), '# My Feature\n\nDescription here.');
    fs.writeFileSync(path.join(inboxDir, 'bug-fix.md'), 'Fix the bug.');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);

    const ids = tasks.map(t => t.id).sort();
    assert.ok(ids.includes('markdown:my-feature'));
    assert.ok(ids.includes('markdown:bug-fix'));
    provider.dispose();
  });

  test('task body contains markdown file content', async () => {
    const content = '# My Feature\n\nSome description.';
    fs.writeFileSync(path.join(inboxDir, 'my-feature.md'), content);

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].body, content);
    provider.dispose();
  });

  test('task title is derived from filename', async () => {
    fs.writeFileSync(path.join(inboxDir, 'hello-world.md'), 'content');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.strictEqual(tasks[0].title, 'hello world');
    provider.dispose();
  });

  test('task status defaults to todo', async () => {
    fs.writeFileSync(path.join(inboxDir, 'task.md'), 'content');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.strictEqual(tasks[0].status, 'todo');
    provider.dispose();
  });

  test('task providerId is "markdown"', async () => {
    fs.writeFileSync(path.join(inboxDir, 'task.md'), 'content');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.strictEqual(tasks[0].providerId, 'markdown');
    provider.dispose();
  });

  test('updateTask to done moves .md file to done directory', async () => {
    const srcFile = path.join(inboxDir, 'task.md');
    fs.writeFileSync(srcFile, 'content');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 1);

    await provider.updateTask({ ...tasks[0], status: 'done' });

    assert.ok(!fs.existsSync(srcFile), 'Source file should be removed from inbox');
    assert.ok(fs.existsSync(path.join(doneDir, 'task.md')), 'File should be moved to done dir');
    provider.dispose();
  });

  test('updateTask to done creates done directory if missing', async () => {
    fs.writeFileSync(path.join(inboxDir, 'task.md'), 'content');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();

    // done dir does not exist yet
    assert.ok(!fs.existsSync(doneDir));

    await provider.updateTask({ ...tasks[0], status: 'done' });

    assert.ok(fs.existsSync(doneDir), 'Done directory should be created');
    provider.dispose();
  });

  test('updateTask to done removes task from in-memory list', async () => {
    fs.writeFileSync(path.join(inboxDir, 'task.md'), 'content');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 1);

    await provider.updateTask({ ...tasks[0], status: 'done' });

    const remaining = await provider.getTasks();
    assert.strictEqual(remaining.length, 0);
    provider.dispose();
  });

  test('updateTask to non-done status keeps file in inbox', async () => {
    const srcFile = path.join(inboxDir, 'task.md');
    fs.writeFileSync(srcFile, 'content');

    const provider = new MarkdownProvider();
    const tasks = await provider.getTasks();

    await provider.updateTask({ ...tasks[0], status: 'inprogress' });

    assert.ok(fs.existsSync(srcFile), 'File should remain in inbox');
    provider.dispose();
  });

  test('getConfigFields returns inboxPath and donePath fields', () => {
    const provider = new MarkdownProvider();
    const fields = provider.getConfigFields();
    const keys = fields.map(f => f.key);
    assert.ok(keys.includes('inboxPath'));
    assert.ok(keys.includes('donePath'));
    provider.dispose();
  });

  test('diagnose returns ok when inbox directory is writable', async () => {
    const provider = new MarkdownProvider();
    const result = await provider.diagnose();
    assert.strictEqual(result.severity, 'ok');
    provider.dispose();
  });

  test('diagnose returns warning when inbox directory does not exist', async () => {
    mockConfig = {
      markdownProvider: {
        enabled: true,
        inboxPath: path.join(tmpDir, 'nonexistent-inbox'),
        donePath: doneDir,
      },
    };
    const provider = new MarkdownProvider();
    const result = await provider.diagnose();
    assert.strictEqual(result.severity, 'warning');
    provider.dispose();
  });
});
