import * as assert from 'assert';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from '../../providers/ITaskProvider';
import { KanbanTask } from '../../types/KanbanTask';

/**
 * Tests for the provider configuration & diagnostics contract.
 * Uses stub providers to verify the interface without real I/O.
 */

function makeConfigurableProvider(
  id: string,
  opts: {
    enabled?: boolean;
    fields?: ProviderConfigField[];
    diagnostic?: ProviderDiagnostic;
  } = {},
): ITaskProvider {
  const fields = opts.fields ?? [];
  const diag = opts.diagnostic ?? { severity: 'ok' as const, message: 'ok' };
  const enabled = opts.enabled ?? true;
  return {
    id,
    displayName: id,
    icon: 'file',
    async getTasks(): Promise<KanbanTask[]> { return []; },
    async updateTask(): Promise<void> { /* noop */ },
    async refresh(): Promise<void> { /* noop */ },
    dispose(): void { /* noop */ },
    onDidChangeTasks: (() => ({ dispose() { /* noop */ } })) as unknown as import('vscode').Event<KanbanTask[]>,
    getConfigFields() { return fields; },
    async diagnose() { return diag; },
    isEnabled() { return enabled; },
  };
}

suite('Provider config & diagnostics contract', () => {
  test('getConfigFields returns empty array for providers with no config', () => {
    const p = makeConfigurableProvider('noop');
    assert.deepStrictEqual(p.getConfigFields(), []);
  });

  test('getConfigFields returns declared fields', () => {
    const fields: ProviderConfigField[] = [
      { key: 'owner', label: 'Owner', type: 'string', required: true },
      { key: 'repo', label: 'Repo', type: 'string', required: true },
    ];
    const p = makeConfigurableProvider('gh', { fields });
    assert.strictEqual(p.getConfigFields().length, 2);
    assert.strictEqual(p.getConfigFields()[0].key, 'owner');
    assert.strictEqual(p.getConfigFields()[1].required, true);
  });

  test('diagnose returns ok when configured', async () => {
    const p = makeConfigurableProvider('ok-provider', {
      diagnostic: { severity: 'ok', message: 'All good' },
    });
    const d = await p.diagnose();
    assert.strictEqual(d.severity, 'ok');
    assert.strictEqual(d.message, 'All good');
  });

  test('diagnose returns error when misconfigured', async () => {
    const p = makeConfigurableProvider('broken', {
      diagnostic: { severity: 'error', message: 'Binary not found' },
    });
    const d = await p.diagnose();
    assert.strictEqual(d.severity, 'error');
    assert.ok(d.message.includes('not found'));
  });

  test('diagnose returns warning', async () => {
    const p = makeConfigurableProvider('warn', {
      diagnostic: { severity: 'warning', message: 'Dir missing' },
    });
    const d = await p.diagnose();
    assert.strictEqual(d.severity, 'warning');
  });

  test('isEnabled returns true by default', () => {
    const p = makeConfigurableProvider('default');
    assert.strictEqual(p.isEnabled(), true);
  });

  test('isEnabled returns false when disabled', () => {
    const p = makeConfigurableProvider('disabled', { enabled: false });
    assert.strictEqual(p.isEnabled(), false);
  });

  test('config field types are string, boolean, or number', () => {
    const fields: ProviderConfigField[] = [
      { key: 'path', label: 'Path', type: 'string' },
      { key: 'verbose', label: 'Verbose', type: 'boolean' },
      { key: 'timeout', label: 'Timeout', type: 'number' },
    ];
    const p = makeConfigurableProvider('typed', { fields });
    const types = p.getConfigFields().map(f => f.type);
    assert.deepStrictEqual(types, ['string', 'boolean', 'number']);
  });
});
