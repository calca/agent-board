import * as assert from 'assert';
import { ColumnId, DEFAULT_COLUMN_IDS, DEFAULT_COLUMN_LABELS } from '../../types/ColumnId';

suite('ColumnId types', () => {
  test('DEFAULT_COLUMN_IDS contains the four built-in columns', () => {
    assert.deepStrictEqual([...DEFAULT_COLUMN_IDS], ['todo', 'inprogress', 'review', 'done']);
  });

  test('DEFAULT_COLUMN_LABELS maps every default column to a label', () => {
    for (const id of DEFAULT_COLUMN_IDS) {
      assert.ok(DEFAULT_COLUMN_LABELS[id], `Missing label for column "${id}"`);
      assert.strictEqual(typeof DEFAULT_COLUMN_LABELS[id], 'string');
    }
  });

  test('ColumnId type accepts any string (flexible columns)', () => {
    const builtIn: ColumnId[] = ['todo', 'inprogress', 'review', 'done'];
    assert.strictEqual(builtIn.length, 4);
    // Custom column names are now valid too
    const custom: ColumnId = 'backlog';
    assert.strictEqual(typeof custom, 'string');
  });
});
