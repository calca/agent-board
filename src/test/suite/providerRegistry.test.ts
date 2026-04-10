import * as assert from 'assert';
import { ITaskProvider } from '../../providers/ITaskProvider';
import { DuplicateProviderError } from '../../providers/ProviderError';
import { ProviderRegistry } from '../../providers/ProviderRegistry';
import { KanbanTask } from '../../types/KanbanTask';

/** Minimal stub provider for testing the registry. */
function makeProvider(id: string, displayName: string): ITaskProvider {
  let disposed = false;
  return {
    id,
    displayName,
    icon: 'file',
    async getTasks(): Promise<KanbanTask[]> { return []; },
    async updateTask(): Promise<void> { /* noop */ },
    async refresh(): Promise<void> { /* noop */ },
    dispose(): void { disposed = true; },
    get isDisposed() { return disposed; },
    onDidChangeTasks: (() => ({ dispose() { /* noop */ } })) as unknown as import('vscode').Event<KanbanTask[]>,
    getConfigFields() { return []; },
    async diagnose() { return { severity: 'ok' as const, message: 'stub' }; },
    isEnabled() { return true; },
  } as ITaskProvider & { isDisposed: boolean };
}

suite('ProviderRegistry', () => {
  test('starts with no providers', () => {
    const reg = new ProviderRegistry();
    assert.deepStrictEqual(reg.getAll(), []);
  });

  test('register and get a provider', () => {
    const reg = new ProviderRegistry();
    const p = makeProvider('github', 'GitHub');
    reg.register(p);
    assert.strictEqual(reg.get('github'), p);
    assert.strictEqual(reg.getAll().length, 1);
  });

  test('register duplicate throws DuplicateProviderError', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider('json', 'JSON'));
    assert.throws(
      () => reg.register(makeProvider('json', 'JSON File')),
      (err: unknown) => err instanceof DuplicateProviderError,
    );
  });

  test('getAll returns providers sorted by displayName', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider('c', 'Charlie'));
    reg.register(makeProvider('a', 'Alpha'));
    reg.register(makeProvider('b', 'Bravo'));
    const names = reg.getAll().map(p => p.displayName);
    assert.deepStrictEqual(names, ['Alpha', 'Bravo', 'Charlie']);
  });

  test('unregister disposes and removes provider', () => {
    const reg = new ProviderRegistry();
    const p = makeProvider('temp', 'Temp') as ITaskProvider & { isDisposed: boolean };
    reg.register(p);
    assert.strictEqual(reg.unregister('temp'), true);
    assert.strictEqual(reg.get('temp'), undefined);
    assert.strictEqual(p.isDisposed, true);
  });

  test('unregister unknown id returns false', () => {
    const reg = new ProviderRegistry();
    assert.strictEqual(reg.unregister('nope'), false);
  });

  test('disposeAll clears all providers', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider('a', 'A'));
    reg.register(makeProvider('b', 'B'));
    reg.disposeAll();
    assert.deepStrictEqual(reg.getAll(), []);
  });
});
