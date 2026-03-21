import * as assert from 'assert';
import { TaskStore } from '../../taskStore';
import { ExtensionContext } from 'vscode';

function makeMockContext(): ExtensionContext {
  const store: Record<string, unknown> = {};
  return {
    workspaceState: {
      get: <T>(key: string, defaultValue: T): T => (store[key] as T) ?? defaultValue,
      update: (key: string, value: unknown): Thenable<void> => {
        store[key] = value;
        return Promise.resolve();
      },
      keys: () => Object.keys(store),
    },
  } as unknown as ExtensionContext;
}

suite('TaskStore', () => {
  test('starts with no tasks', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    assert.deepStrictEqual(ts.getTasks(), []);
  });

  test('addTask creates a pending task', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const task = ts.addTask('Buy milk', 'Semi-skimmed');
    assert.strictEqual(task.title, 'Buy milk');
    assert.strictEqual(task.description, 'Semi-skimmed');
    assert.strictEqual(task.status, 'pending');
    assert.ok(task.id.startsWith('task-'));
    assert.strictEqual(ts.getTasks().length, 1);
  });

  test('completeTask marks task as completed', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const task = ts.addTask('Write tests');
    const completed = ts.completeTask(task.id);
    assert.ok(completed);
    assert.strictEqual(completed!.status, 'completed');
    assert.ok(completed!.completedAt);
  });

  test('completeTask returns undefined for unknown id', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    assert.strictEqual(ts.completeTask('nonexistent'), undefined);
  });

  test('deleteTask removes the task', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const task = ts.addTask('Delete me');
    assert.strictEqual(ts.getTasks().length, 1);
    const result = ts.deleteTask(task.id);
    assert.strictEqual(result, true);
    assert.strictEqual(ts.getTasks().length, 0);
  });

  test('deleteTask returns false for unknown id', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    assert.strictEqual(ts.deleteTask('nonexistent'), false);
  });

  test('getTasksByStatus filters correctly', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    ts.addTask('Pending 1');
    const t2 = ts.addTask('To complete');
    ts.completeTask(t2.id);
    assert.strictEqual(ts.getTasksByStatus('pending').length, 1);
    assert.strictEqual(ts.getTasksByStatus('completed').length, 1);
  });

  test('updateTask updates title and description', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const task = ts.addTask('Old title', 'Old desc');
    const updated = ts.updateTask(task.id, { title: 'New title', description: 'New desc' });
    assert.ok(updated);
    assert.strictEqual(updated!.title, 'New title');
    assert.strictEqual(updated!.description, 'New desc');
  });

  test('tasks are persisted and reloaded across instances', () => {
    const ctx = makeMockContext();
    const ts1 = new TaskStore(ctx);
    ts1.addTask('Persisted task');

    const ts2 = new TaskStore(ctx); // reuses same mock context
    assert.strictEqual(ts2.getTasks().length, 1);
    assert.strictEqual(ts2.getTasks()[0].title, 'Persisted task');
  });
});
