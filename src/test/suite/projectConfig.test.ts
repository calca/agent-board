import * as assert from 'assert';
import { extractGitHubConfig, ProjectConfigData, resolveConfigValue } from '../../config/configTypes';

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
      worktree: { enabled: true },
      genAiProviders: {
        'my-provider': { enabled: true, model: 'my-model', endpoint: 'http://localhost:8080/api/generate' },
        'another-provider': { enabled: true, model: 'another-model' },
      },
      kanban: { intermediateColumns: ['backlog', 'doing'] },
      logLevel: 'DEBUG',
    };

    assert.strictEqual(cfg.github?.owner, 'calca');
    assert.strictEqual(cfg.jsonProvider?.path, '.agent-board/tasks');
    assert.strictEqual(cfg.beadsProvider?.executable, '/usr/local/bin/beads');
    assert.strictEqual(cfg.worktree?.enabled, true);
    assert.strictEqual(cfg.genAiProviders?.['my-provider']?.enabled, true);
    assert.strictEqual(cfg.genAiProviders?.['my-provider']?.model, 'my-model');
    assert.strictEqual(cfg.genAiProviders?.['another-provider']?.enabled, true);
    assert.strictEqual(cfg.genAiProviders?.['another-provider']?.model, 'another-model');
    assert.deepStrictEqual(cfg.kanban?.intermediateColumns, ['backlog', 'doing']);
    assert.strictEqual(cfg.logLevel, 'DEBUG');
  });

  test('all sections are optional', () => {
    const cfg: ProjectConfigData = {};
    assert.strictEqual(cfg.github, undefined);
    assert.strictEqual(cfg.jsonProvider, undefined);
    assert.strictEqual(cfg.worktree, undefined);
    assert.strictEqual(cfg.genAiProviders, undefined);
    assert.strictEqual(cfg.logLevel, undefined);
  });

  test('genAiProviders entries are independently optional', () => {
    const cfg: ProjectConfigData = {
      genAiProviders: {
        'my-provider': { enabled: true },
        'another-provider': { model: 'small' },
      },
    };
    assert.strictEqual(cfg.genAiProviders?.['my-provider']?.enabled, true);
    assert.strictEqual(cfg.genAiProviders?.['my-provider']?.model, undefined);
    assert.strictEqual(cfg.genAiProviders?.['another-provider']?.enabled, undefined);
    assert.strictEqual(cfg.genAiProviders?.['another-provider']?.model, 'small');
  });

  test('genAiProviders supports yolo, fleet and silent flags', () => {
    const cfg: ProjectConfigData = {
      genAiProviders: {
        'copilot-cli': { yolo: true, fleet: true, silent: true },
      },
    };
    assert.strictEqual(cfg.genAiProviders?.['copilot-cli']?.yolo, true);
    assert.strictEqual(cfg.genAiProviders?.['copilot-cli']?.fleet, true);
    assert.strictEqual(cfg.genAiProviders?.['copilot-cli']?.silent, true);
  });

  test('genAiProviders yolo, fleet and silent default to undefined', () => {
    const cfg: ProjectConfigData = {
      genAiProviders: {
        'copilot-cli': { enabled: true },
      },
    };
    assert.strictEqual(cfg.genAiProviders?.['copilot-cli']?.yolo, undefined);
    assert.strictEqual(cfg.genAiProviders?.['copilot-cli']?.fleet, undefined);
    assert.strictEqual(cfg.genAiProviders?.['copilot-cli']?.silent, undefined);
  });

  test('worktree can be explicitly enabled', () => {
    const cfg: ProjectConfigData = { worktree: { enabled: true } };
    assert.strictEqual(cfg.worktree?.enabled, true);
  });

  test('worktree can be explicitly disabled', () => {
    const cfg: ProjectConfigData = { worktree: { enabled: false } };
    assert.strictEqual(cfg.worktree?.enabled, false);
  });

  test('worktree section is optional', () => {
    const cfg: ProjectConfigData = {};
    assert.strictEqual(cfg.worktree, undefined);
  });
});
