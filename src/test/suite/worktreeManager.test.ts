import * as assert from 'assert';
import {
  sanitiseBranchName,
  worktreePath,
  worktreeBranch,
} from '../../copilot/WorktreeManager';
import * as path from 'path';

suite('WorktreeManager — sanitiseBranchName', () => {
  test('passes through simple alphanumeric ids', () => {
    assert.strictEqual(sanitiseBranchName('abc123'), 'abc123');
  });

  test('replaces colons with dashes', () => {
    assert.strictEqual(sanitiseBranchName('github:42'), 'github-42');
  });

  test('replaces spaces and special chars', () => {
    assert.strictEqual(sanitiseBranchName('my task #1!'), 'my-task-1');
  });

  test('collapses consecutive dashes', () => {
    assert.strictEqual(sanitiseBranchName('a---b'), 'a-b');
  });

  test('strips leading and trailing dashes', () => {
    assert.strictEqual(sanitiseBranchName('--hello--'), 'hello');
  });

  test('truncates to 60 characters', () => {
    const long = 'a'.repeat(100);
    assert.strictEqual(sanitiseBranchName(long).length, 60);
  });

  test('preserves slashes, dots, and underscores', () => {
    assert.strictEqual(sanitiseBranchName('feat/my_task.v2'), 'feat/my_task.v2');
  });
});

suite('WorktreeManager — worktreePath', () => {
  test('returns path under .agent-board/worktrees', () => {
    const result = worktreePath('/repo', 'github:42');
    assert.strictEqual(result, path.join('/repo', '.agent-board', 'worktrees', 'github-42'));
  });
});

suite('WorktreeManager — worktreeBranch', () => {
  test('returns prefixed branch name', () => {
    assert.strictEqual(worktreeBranch('github:42'), 'agent-board/github-42');
  });

  test('sanitises special characters', () => {
    assert.strictEqual(worktreeBranch('json:task #5'), 'agent-board/json-task-5');
  });
});
