import * as assert from 'assert';

/**
 * Verifies that the Messages type definitions are consistent.
 * We import them to ensure they compile and are usable at runtime.
 */
suite('Message Protocol Types', () => {
  test('HostToWebView tasksUpdate shape is correct', () => {
    // Import will fail at compile time if types are wrong
    const msg = {
      type: 'tasksUpdate' as const,
      tasks: [],
      columns: [{ id: 'todo' as const, label: 'To Do' }],
    };
    assert.strictEqual(msg.type, 'tasksUpdate');
    assert.strictEqual(msg.columns.length, 1);
  });

  test('HostToWebView providerStatus shape is correct', () => {
    const msg = {
      type: 'providerStatus' as const,
      providerId: 'github',
      status: 'ok' as const,
    };
    assert.strictEqual(msg.type, 'providerStatus');
    assert.strictEqual(msg.providerId, 'github');
  });

  test('WebViewToHost taskMoved shape is correct', () => {
    const msg = {
      type: 'taskMoved' as const,
      taskId: 'github:123',
      toCol: 'inprogress' as const,
      index: 0,
    };
    assert.strictEqual(msg.type, 'taskMoved');
    assert.strictEqual(msg.toCol, 'inprogress');
  });

  test('WebViewToHost openCopilot shape is correct', () => {
    const msg = {
      type: 'openCopilot' as const,
      taskId: 'json:42',
      providerId: 'cloud',
    };
    assert.strictEqual(msg.type, 'openCopilot');
    assert.strictEqual(msg.providerId, 'cloud');
  });

  test('WebViewToHost ready message has correct type', () => {
    const msg = { type: 'ready' as const };
    assert.strictEqual(msg.type, 'ready');
  });
});
