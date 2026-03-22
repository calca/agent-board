import * as assert from 'assert';
import { extractGitHubConfig, resolveConfigValue, ProjectConfigData } from '../../config/configTypes';

suite('ProjectConfig (extractGitHubConfig)', () => {
  test('extracts owner and repo from file config', () => {
    const file: ProjectConfigData = { github: { owner: 'fileOwner', repo: 'fileRepo' } };
    const result = extractGitHubConfig(file);
    assert.strictEqual(result.owner, 'fileOwner');
    assert.strictEqual(result.repo, 'fileRepo');
  });

  test('returns empty strings when file config is undefined', () => {
    const result = extractGitHubConfig(undefined);
    assert.strictEqual(result.owner, '');
    assert.strictEqual(result.repo, '');
  });

  test('returns empty strings when file config has no github key', () => {
    const file: ProjectConfigData = {};
    const result = extractGitHubConfig(file);
    assert.strictEqual(result.owner, '');
    assert.strictEqual(result.repo, '');
  });

  test('partial file config returns empty for missing field', () => {
    const file: ProjectConfigData = { github: { owner: 'fileOwner' } };
    const result = extractGitHubConfig(file);
    assert.strictEqual(result.owner, 'fileOwner');
    assert.strictEqual(result.repo, '');
  });

  test('empty strings in file config return empty strings', () => {
    const file: ProjectConfigData = { github: { owner: '', repo: '' } };
    const result = extractGitHubConfig(file);
    assert.strictEqual(result.owner, '');
    assert.strictEqual(result.repo, '');
  });

  test('falls back to settingConfig when file config is undefined', () => {
    const result = extractGitHubConfig(undefined, { owner: 'sOwner', repo: 'sRepo' });
    assert.strictEqual(result.owner, 'sOwner');
    assert.strictEqual(result.repo, 'sRepo');
  });

  test('file config takes priority over settingConfig', () => {
    const file: ProjectConfigData = { github: { owner: 'fileOwner', repo: 'fileRepo' } };
    const result = extractGitHubConfig(file, { owner: 'sOwner', repo: 'sRepo' });
    assert.strictEqual(result.owner, 'fileOwner');
    assert.strictEqual(result.repo, 'fileRepo');
  });

  test('partial file config falls back to settingConfig for missing fields', () => {
    const file: ProjectConfigData = { github: { owner: 'fileOwner' } };
    const result = extractGitHubConfig(file, { owner: 'sOwner', repo: 'sRepo' });
    assert.strictEqual(result.owner, 'fileOwner');
    assert.strictEqual(result.repo, 'sRepo');
  });

  test('empty file config values fall back to settingConfig', () => {
    const file: ProjectConfigData = { github: { owner: '', repo: '' } };
    const result = extractGitHubConfig(file, { owner: 'sOwner', repo: 'sRepo' });
    assert.strictEqual(result.owner, 'sOwner');
    assert.strictEqual(result.repo, 'sRepo');
  });

  test('settingConfig with empty strings returns empty strings', () => {
    const result = extractGitHubConfig(undefined, { owner: '', repo: '' });
    assert.strictEqual(result.owner, '');
    assert.strictEqual(result.repo, '');
  });
});

suite('resolveConfigValue', () => {
  test('file value takes priority over setting value', () => {
    assert.strictEqual(resolveConfigValue('fromFile', 'fromSetting'), 'fromFile');
  });

  test('falls back to setting when file value is undefined', () => {
    assert.strictEqual(resolveConfigValue(undefined, 'fromSetting'), 'fromSetting');
  });

  test('falls back to setting when file value is empty string', () => {
    assert.strictEqual(resolveConfigValue('', 'fromSetting'), 'fromSetting');
  });

  test('numeric file value takes priority', () => {
    assert.strictEqual(resolveConfigValue(5000, 30000), 5000);
  });

  test('numeric zero is treated as defined', () => {
    assert.strictEqual(resolveConfigValue(0, 30000), 0);
  });

  test('falls back to numeric setting when file value is undefined', () => {
    assert.strictEqual(resolveConfigValue(undefined, 30000), 30000);
  });

  test('array file value takes priority', () => {
    const fileVal = ['a', 'b'];
    const settingVal = ['x', 'y', 'z'];
    assert.deepStrictEqual(resolveConfigValue(fileVal, settingVal), ['a', 'b']);
  });

  test('falls back to array setting when file value is undefined', () => {
    const settingVal = ['x', 'y'];
    assert.deepStrictEqual(resolveConfigValue(undefined, settingVal), ['x', 'y']);
  });
});

suite('ProjectConfigData (full shape)', () => {
  test('supports all config sections', () => {
    const cfg: ProjectConfigData = {
      github: { owner: 'calca', repo: 'agent-board' },
      jsonProvider: { path: '.agent-board/tasks' },
      beadsProvider: { executable: '/usr/local/bin/beads' },
      copilot: { defaultMode: 'local', localModel: 'codellama' },
      genAiProviders: {
        ollama: { enabled: true, model: 'llama3', endpoint: 'http://localhost:11434/api/generate' },
        mistral: { enabled: true, model: 'mistral-small-latest' },
      },
      kanban: { columns: ['backlog', 'todo', 'done'] },
      pollInterval: 10000,
      logLevel: 'DEBUG',
    };

    assert.strictEqual(cfg.github?.owner, 'calca');
    assert.strictEqual(cfg.jsonProvider?.path, '.agent-board/tasks');
    assert.strictEqual(cfg.beadsProvider?.executable, '/usr/local/bin/beads');
    assert.strictEqual(cfg.copilot?.defaultMode, 'local');
    assert.strictEqual(cfg.copilot?.localModel, 'codellama');
    assert.strictEqual(cfg.genAiProviders?.ollama?.enabled, true);
    assert.strictEqual(cfg.genAiProviders?.ollama?.model, 'llama3');
    assert.strictEqual(cfg.genAiProviders?.mistral?.enabled, true);
    assert.strictEqual(cfg.genAiProviders?.mistral?.model, 'mistral-small-latest');
    assert.deepStrictEqual(cfg.kanban?.columns, ['backlog', 'todo', 'done']);
    assert.strictEqual(cfg.pollInterval, 10000);
    assert.strictEqual(cfg.logLevel, 'DEBUG');
  });

  test('all sections are optional', () => {
    const cfg: ProjectConfigData = {};
    assert.strictEqual(cfg.github, undefined);
    assert.strictEqual(cfg.jsonProvider, undefined);
    assert.strictEqual(cfg.copilot, undefined);
    assert.strictEqual(cfg.genAiProviders, undefined);
    assert.strictEqual(cfg.pollInterval, undefined);
    assert.strictEqual(cfg.logLevel, undefined);
  });

  test('genAiProviders entries are independently optional', () => {
    const cfg: ProjectConfigData = {
      genAiProviders: {
        ollama: { enabled: true },
        mistral: { model: 'mistral-tiny' },
      },
    };
    assert.strictEqual(cfg.genAiProviders?.ollama?.enabled, true);
    assert.strictEqual(cfg.genAiProviders?.ollama?.model, undefined);
    assert.strictEqual(cfg.genAiProviders?.mistral?.enabled, undefined);
    assert.strictEqual(cfg.genAiProviders?.mistral?.model, 'mistral-tiny');
  });
});
