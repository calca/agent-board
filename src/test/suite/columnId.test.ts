import * as assert from 'assert';
import { COLUMN_IDS, COLUMN_LABELS, DEFAULT_COLUMN_IDS, DEFAULT_COLUMN_LABELS, ColumnId } from '../../types/ColumnId';

suite('ColumnId types', () => {
  test('DEFAULT_COLUMN_IDS contains the four built-in columns', () => {
    assert.deepStrictEqual([...DEFAULT_COLUMN_IDS], ['todo', 'inprogress', 'review', 'done']);
  });

  test('COLUMN_IDS is an alias for DEFAULT_COLUMN_IDS', () => {
    assert.deepStrictEqual([...COLUMN_IDS], [...DEFAULT_COLUMN_IDS]);
  });

  test('DEFAULT_COLUMN_LABELS maps every default column to a label', () => {
    for (const id of DEFAULT_COLUMN_IDS) {
      assert.ok(DEFAULT_COLUMN_LABELS[id], `Missing label for column "${id}"`);
      assert.strictEqual(typeof DEFAULT_COLUMN_LABELS[id], 'string');
    }
  });

  test('COLUMN_LABELS is an alias for DEFAULT_COLUMN_LABELS', () => {
    assert.deepStrictEqual(COLUMN_LABELS, DEFAULT_COLUMN_LABELS);
  });

  test('ColumnId type accepts any string (flexible columns)', () => {
    const builtIn: ColumnId[] = ['todo', 'inprogress', 'review', 'done'];
    assert.strictEqual(builtIn.length, 4);
    // Custom column names are now valid too
    const custom: ColumnId = 'backlog';
    assert.strictEqual(typeof custom, 'string');
  });
});
