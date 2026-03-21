import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Tasks JSON Schema', () => {
  const schemaPath = path.resolve(__dirname, '../../../schemas/tasks.schema.json');

  test('schema file exists', () => {
    assert.ok(fs.existsSync(schemaPath), 'tasks.schema.json should exist');
  });

  test('schema is valid JSON', () => {
    const raw = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(raw);
    assert.strictEqual(schema.type, 'array');
    assert.ok(schema.items, 'should have items definition');
    assert.deepStrictEqual(schema.items.required, ['id', 'title']);
  });

  test('schema validates a well-formed task array', () => {
    const raw = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(raw);

    // Verify that all expected fields are in the schema properties
    const props = Object.keys(schema.items.properties);
    assert.ok(props.includes('id'));
    assert.ok(props.includes('title'));
    assert.ok(props.includes('body'));
    assert.ok(props.includes('status'));
    assert.ok(props.includes('labels'));
    assert.ok(props.includes('assignee'));
    assert.ok(props.includes('url'));
    assert.ok(props.includes('createdAt'));
  });

  test('status enum matches ColumnId values', () => {
    const raw = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(raw);
    const statusEnum = schema.items.properties.status.enum;
    assert.deepStrictEqual(statusEnum, ['todo', 'inprogress', 'review', 'done']);
  });
});
