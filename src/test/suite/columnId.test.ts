import * as assert from 'assert';
import { COLUMN_IDS, COLUMN_LABELS, ColumnId } from '../../types/ColumnId';

suite('ColumnId types', () => {
  test('COLUMN_IDS contains all four columns', () => {
    assert.deepStrictEqual([...COLUMN_IDS], ['todo', 'inprogress', 'review', 'done']);
  });

  test('COLUMN_LABELS maps every column to a human-readable label', () => {
    for (const id of COLUMN_IDS) {
      assert.ok(COLUMN_LABELS[id], `Missing label for column "${id}"`);
      assert.strictEqual(typeof COLUMN_LABELS[id], 'string');
    }
  });

  test('ColumnId type accepts valid values', () => {
    const valid: ColumnId[] = ['todo', 'inprogress', 'review', 'done'];
    assert.strictEqual(valid.length, 4);
  });
});
