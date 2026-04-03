import * as assert from 'assert';
import { FileChange } from '../../diff/DiffWatcher';

suite('DiffWatcher (types)', () => {
  test('FileChange added has correct shape', () => {
    const fc: FileChange = { path: 'src/foo.ts', status: 'added' };
    assert.strictEqual(fc.status, 'added');
    assert.strictEqual(fc.path, 'src/foo.ts');
  });

  test('FileChange modified has correct shape', () => {
    const fc: FileChange = { path: 'src/bar.ts', status: 'modified' };
    assert.strictEqual(fc.status, 'modified');
  });

  test('FileChange deleted has correct shape', () => {
    const fc: FileChange = { path: 'old.ts', status: 'deleted' };
    assert.strictEqual(fc.status, 'deleted');
  });

  test('FileChange path is a string', () => {
    const fc: FileChange = { path: 'dir/file.js', status: 'added' };
    assert.strictEqual(typeof fc.path, 'string');
  });
});
