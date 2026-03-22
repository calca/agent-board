import * as assert from 'assert';
import { GenAiProviderRegistry } from '../../copilot/GenAiProviderRegistry';
import { IGenAiProvider, GenAiProviderScope } from '../../copilot/IGenAiProvider';
import { buildOptimisationPrefix, YOLO_PREFIX, FLEET_PREFIX } from '../../copilot/copilotCliUtils';

/** Minimal stub GenAI provider for testing the registry. */
function makeGenAiProvider(
  id: string,
  displayName: string,
  scope: GenAiProviderScope = 'global',
  available = true,
): IGenAiProvider & { isDisposed: boolean } {
  let disposed = false;
  return {
    id,
    displayName,
    icon: 'beaker',
    scope,
    async isAvailable(): Promise<boolean> { return available; },
    async run(): Promise<void> { /* noop */ },
    dispose(): void { disposed = true; },
    get isDisposed() { return disposed; },
  };
}

suite('GenAiProviderRegistry', () => {
  test('starts with no providers', () => {
    const reg = new GenAiProviderRegistry();
    assert.deepStrictEqual(reg.getAll(), []);
  });

  test('register and get a provider', () => {
    const reg = new GenAiProviderRegistry();
    const p = makeGenAiProvider('chat', 'Chat');
    reg.register(p);
    assert.strictEqual(reg.get('chat'), p);
    assert.strictEqual(reg.getAll().length, 1);
  });

  test('register duplicate throws', () => {
    const reg = new GenAiProviderRegistry();
    reg.register(makeGenAiProvider('cloud', 'Cloud'));
    assert.throws(
      () => reg.register(makeGenAiProvider('cloud', 'Cloud v2')),
      /already registered/,
    );
  });

  test('getAll returns providers sorted by displayName', () => {
    const reg = new GenAiProviderRegistry();
    reg.register(makeGenAiProvider('c', 'Zulu'));
    reg.register(makeGenAiProvider('a', 'Alpha'));
    reg.register(makeGenAiProvider('b', 'Mike'));
    const names = reg.getAll().map(p => p.displayName);
    assert.deepStrictEqual(names, ['Alpha', 'Mike', 'Zulu']);
  });

  test('getByScope filters by scope', () => {
    const reg = new GenAiProviderRegistry();
    reg.register(makeGenAiProvider('chat', 'Chat', 'global'));
    reg.register(makeGenAiProvider('ollama', 'Ollama', 'project'));
    reg.register(makeGenAiProvider('cloud', 'Cloud', 'global'));

    const globals = reg.getByScope('global');
    assert.strictEqual(globals.length, 2);
    assert.ok(globals.every(p => p.scope === 'global'));

    const projects = reg.getByScope('project');
    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].id, 'ollama');
  });

  test('getAvailable returns only available providers', async () => {
    const reg = new GenAiProviderRegistry();
    reg.register(makeGenAiProvider('a', 'Available', 'global', true));
    reg.register(makeGenAiProvider('b', 'Unavailable', 'global', false));
    reg.register(makeGenAiProvider('c', 'Also Available', 'project', true));

    const available = await reg.getAvailable();
    assert.strictEqual(available.length, 2);
    const ids = available.map(p => p.id);
    assert.ok(ids.includes('a'));
    assert.ok(ids.includes('c'));
    assert.ok(!ids.includes('b'));
  });

  test('unregister disposes and removes provider', () => {
    const reg = new GenAiProviderRegistry();
    const p = makeGenAiProvider('temp', 'Temp');
    reg.register(p);
    assert.strictEqual(reg.unregister('temp'), true);
    assert.strictEqual(reg.get('temp'), undefined);
    assert.strictEqual(p.isDisposed, true);
  });

  test('unregister unknown id returns false', () => {
    const reg = new GenAiProviderRegistry();
    assert.strictEqual(reg.unregister('nope'), false);
  });

  test('disposeAll clears all providers', () => {
    const reg = new GenAiProviderRegistry();
    const a = makeGenAiProvider('a', 'A');
    const b = makeGenAiProvider('b', 'B');
    reg.register(a);
    reg.register(b);
    reg.disposeAll();
    assert.deepStrictEqual(reg.getAll(), []);
    assert.strictEqual(a.isDisposed, true);
    assert.strictEqual(b.isDisposed, true);
  });
});

suite('IGenAiProvider interface shape', () => {
  test('provider has all required properties', () => {
    const p = makeGenAiProvider('test', 'Test Provider', 'project');
    assert.strictEqual(typeof p.id, 'string');
    assert.strictEqual(typeof p.displayName, 'string');
    assert.strictEqual(typeof p.icon, 'string');
    assert.ok(p.scope === 'global' || p.scope === 'project');
    assert.strictEqual(typeof p.isAvailable, 'function');
    assert.strictEqual(typeof p.run, 'function');
    assert.strictEqual(typeof p.dispose, 'function');
  });

  test('global scope providers have scope "global"', () => {
    const p = makeGenAiProvider('chat', 'Chat', 'global');
    assert.strictEqual(p.scope, 'global');
  });

  test('project scope providers have scope "project"', () => {
    const p = makeGenAiProvider('ollama', 'Ollama', 'project');
    assert.strictEqual(p.scope, 'project');
  });

  test('supportsWorktree defaults to undefined when not set', () => {
    const p = makeGenAiProvider('chat', 'Chat', 'global');
    assert.strictEqual(p.supportsWorktree, undefined);
  });

  test('supportsWorktree can be set to true', () => {
    const p: IGenAiProvider = {
      ...makeGenAiProvider('cli', 'CLI', 'global'),
      supportsWorktree: true,
    };
    assert.strictEqual(p.supportsWorktree, true);
  });

  test('supportsWorktree can be set to false', () => {
    const p: IGenAiProvider = {
      ...makeGenAiProvider('chat', 'Chat', 'global'),
      supportsWorktree: false,
    };
    assert.strictEqual(p.supportsWorktree, false);
  });
});

suite('buildOptimisationPrefix (CopilotCliGenAiProvider)', () => {
  test('returns empty string when both flags are false', () => {
    assert.strictEqual(buildOptimisationPrefix(false, false), '');
  });

  test('returns yolo prefix when yolo is true', () => {
    const result = buildOptimisationPrefix(true, false);
    assert.strictEqual(result, YOLO_PREFIX);
    assert.ok(result.includes('/yolo'));
  });

  test('returns fleet prefix when fleet is true', () => {
    const result = buildOptimisationPrefix(false, true);
    assert.strictEqual(result, FLEET_PREFIX);
    assert.ok(result.includes('/fleet'));
  });

  test('returns both prefixes when both flags are true', () => {
    const result = buildOptimisationPrefix(true, true);
    assert.strictEqual(result, YOLO_PREFIX + FLEET_PREFIX);
    assert.ok(result.includes('/yolo'));
    assert.ok(result.includes('/fleet'));
  });

  test('yolo prefix appears before fleet prefix', () => {
    const result = buildOptimisationPrefix(true, true);
    const yoloIdx = result.indexOf('/yolo');
    const fleetIdx = result.indexOf('/fleet');
    assert.ok(yoloIdx < fleetIdx, 'yolo should appear before fleet');
  });
});
