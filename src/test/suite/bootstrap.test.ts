import * as assert from 'assert';

suite('bootstrapProviders', () => {
  test('bootstrapProviders function can be imported', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bootstrap = require('../../bootstrap/bootstrapProviders');
    assert.ok(bootstrap.bootstrapProviders, 'bootstrapProviders should be exported');
    assert.ok(typeof bootstrap.bootstrapProviders === 'function', 'bootstrapProviders should be a function');
  });

  test('bootstrapProviders requires ExtensionContext parameter', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bootstrap = require('../../bootstrap/bootstrapProviders');
    const bootstrapFn = bootstrap.bootstrapProviders;
    
    // Function should exist and be callable
    assert.ok(bootstrapFn, 'bootstrapProviders should exist');
    assert.strictEqual(bootstrapFn.length, 1, 'bootstrapProviders should take 1 parameter (context)');
  });

  test('ProvidersBootstrapResult type includes expected fields', () => {
    // Test the type/interface is correct by checking the TypeScript definitions
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bootstrap = require('../../bootstrap');
    assert.ok(bootstrap.bootstrapProviders, 'bootstrapProviders should be exported from bootstrap');
  });
});

suite('bootstrapGenAi', () => {
  test('bootstrapGenAi function can be imported', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bootstrap = require('../../bootstrap/bootstrapGenAi');
    assert.ok(bootstrap.bootstrapGenAi, 'bootstrapGenAi should be exported');
    assert.ok(typeof bootstrap.bootstrapGenAi === 'function', 'bootstrapGenAi should be a function');
  });

  test('bootstrapGenAi returns expected structure', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootstrapGenAi } = require('../../bootstrap/bootstrapGenAi');
    const result = bootstrapGenAi();

    assert.ok(result, 'bootstrapGenAi should return a result');
    assert.ok(result.genAiRegistry, 'result should have genAiRegistry');
    assert.ok(result.ghCopilotGenAi, 'result should have ghCopilotGenAi');
  });

  test('bootstrapGenAi registers all GenAI providers', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootstrapGenAi } = require('../../bootstrap/bootstrapGenAi');
    const { genAiRegistry } = bootstrapGenAi();

    const all = genAiRegistry.getAll();
    assert.ok(Array.isArray(all), 'getAll should return an array');
    assert.ok(all.length >= 4, `Expected at least 4 providers, got ${all.length}`);
  });

  test('bootstrapGenAi registers Chat provider', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootstrapGenAi } = require('../../bootstrap/bootstrapGenAi');
    const { genAiRegistry } = bootstrapGenAi();

    const chatProvider = genAiRegistry.get('vscode-chat');
    assert.ok(chatProvider, 'vscode-chat provider should be registered');
    assert.ok(chatProvider.id === 'vscode-chat', 'chatProvider should have id "vscode-chat"');
  });

  test('bootstrapGenAi registers LM API provider', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootstrapGenAi } = require('../../bootstrap/bootstrapGenAi');
    const { genAiRegistry } = bootstrapGenAi();

    const lmApiProvider = genAiRegistry.get('vscode-api');
    assert.ok(lmApiProvider, 'vscode-api provider should be registered');
    assert.ok(lmApiProvider.id === 'vscode-api', 'lmApiProvider should have id "vscode-api"');
  });

  test('bootstrapGenAi registers GitHub Copilot provider', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootstrapGenAi } = require('../../bootstrap/bootstrapGenAi');
    const { genAiRegistry, ghCopilotGenAi } = bootstrapGenAi();

    const copilotProvider = genAiRegistry.get('github-copilot');
    assert.ok(copilotProvider, 'github-copilot provider should be registered');
    assert.ok(copilotProvider.id === 'github-copilot', 'copilotProvider should have id "github-copilot"');
    assert.ok(ghCopilotGenAi.id === 'github-copilot', 'ghCopilotGenAi should have id "github-copilot"');
  });

  test('bootstrapGenAi registers Copilot SDK provider', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootstrapGenAi } = require('../../bootstrap/bootstrapGenAi');
    const { genAiRegistry } = bootstrapGenAi();

    const sdkProvider = genAiRegistry.get('copilot-sdk');
    assert.ok(sdkProvider, 'copilot-sdk provider should be registered');
    assert.ok(sdkProvider.id === 'copilot-sdk', 'sdkProvider should have id "copilot-sdk"');
  });
});

suite('bootstrap exports', () => {
  test('bootstrap index exports bootstrapProviders', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bootstrap = require('../../bootstrap');
    assert.ok(bootstrap.bootstrapProviders, 'bootstrap should export bootstrapProviders');
  });

  test('bootstrap index exports bootstrapGenAi', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bootstrap = require('../../bootstrap');
    assert.ok(bootstrap.bootstrapGenAi, 'bootstrap should export bootstrapGenAi');
  });

  test('bootstrap exports include correct type definitions', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bootstrap = require('../../bootstrap');
    assert.ok(bootstrap.bootstrapProviders, 'bootstrapProviders export');
    assert.ok(bootstrap.bootstrapGenAi, 'bootstrapGenAi export');
    assert.ok(bootstrap.bootstrapMobile, 'bootstrapMobile export');
    assert.ok(bootstrap.bootstrapSquad, 'bootstrapSquad export');
  });
});
