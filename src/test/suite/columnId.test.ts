import * as assert from 'assert';
import { ColumnId, DEFAULT_COLUMN_IDS, DEFAULT_COLUMN_LABELS, DEFAULT_INTERMEDIATE_IDS, FIRST_COLUMN, LAST_COLUMN, buildColumnOrder } from '../../types/ColumnId';

suite('ColumnId types', () => {
  test('DEFAULT_COLUMN_IDS contains the four built-in columns', () => {
    assert.deepStrictEqual([...DEFAULT_COLUMN_IDS], ['todo', 'inprogress', 'review', 'done']);
  });

  test('FIRST_COLUMN is todo and LAST_COLUMN is done', () => {
    assert.strictEqual(FIRST_COLUMN, 'todo');
    assert.strictEqual(LAST_COLUMN, 'done');
  });

  test('DEFAULT_INTERMEDIATE_IDS are inprogress and review', () => {
    assert.deepStrictEqual([...DEFAULT_INTERMEDIATE_IDS], ['inprogress', 'review']);
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

  test('buildColumnOrder with no args returns defaults', () => {
    assert.deepStrictEqual(buildColumnOrder(), ['todo', 'inprogress', 'review', 'done']);
  });

  test('buildColumnOrder with custom intermediate columns', () => {
    assert.deepStrictEqual(buildColumnOrder(['doing', 'qa']), ['todo', 'doing', 'qa', 'done']);
  });

  test('buildColumnOrder with empty array returns defaults', () => {
    assert.deepStrictEqual(buildColumnOrder([]), ['todo', 'inprogress', 'review', 'done']);
  });
});
