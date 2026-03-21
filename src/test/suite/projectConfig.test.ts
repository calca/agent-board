import * as assert from 'assert';
import { mergeGitHubConfig, ProjectConfigData } from '../../config/configTypes';

suite('ProjectConfig (mergeGitHubConfig)', () => {
  test('file config takes priority over settings', () => {
    const file: ProjectConfigData = { github: { owner: 'fileOwner', repo: 'fileRepo' } };
    const result = mergeGitHubConfig(file, 'settingsOwner', 'settingsRepo');
    assert.strictEqual(result.owner, 'fileOwner');
    assert.strictEqual(result.repo, 'fileRepo');
  });

  test('falls back to settings when file config is undefined', () => {
    const result = mergeGitHubConfig(undefined, 'settingsOwner', 'settingsRepo');
    assert.strictEqual(result.owner, 'settingsOwner');
    assert.strictEqual(result.repo, 'settingsRepo');
  });

  test('falls back to settings when file config has no github key', () => {
    const file: ProjectConfigData = {};
    const result = mergeGitHubConfig(file, 'settingsOwner', 'settingsRepo');
    assert.strictEqual(result.owner, 'settingsOwner');
    assert.strictEqual(result.repo, 'settingsRepo');
  });

  test('partial file config falls back per-field', () => {
    const file: ProjectConfigData = { github: { owner: 'fileOwner' } };
    const result = mergeGitHubConfig(file, 'settingsOwner', 'settingsRepo');
    assert.strictEqual(result.owner, 'fileOwner');
    assert.strictEqual(result.repo, 'settingsRepo');
  });

  test('empty strings in file config fall back to settings', () => {
    const file: ProjectConfigData = { github: { owner: '', repo: '' } };
    const result = mergeGitHubConfig(file, 'settingsOwner', 'settingsRepo');
    assert.strictEqual(result.owner, 'settingsOwner');
    assert.strictEqual(result.repo, 'settingsRepo');
  });

  test('both empty returns empty strings', () => {
    const result = mergeGitHubConfig(undefined, '', '');
    assert.strictEqual(result.owner, '');
    assert.strictEqual(result.repo, '');
  });
});
