import * as assert from 'assert';
import { extractGitHubConfig, ProjectConfigData } from '../../config/configTypes';

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
});
