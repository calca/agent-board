import * as assert from 'assert';

/**
 * Tests for aggregation logic — isolated from vscode runtime dependency.
 * Verifies the core deduplication and failure-isolation behavior.
 */

interface MockTask {
  id: string;
  title: string;
  providerId: string;
}

interface MockProvider {
  id: string;
  getTasks(): Promise<MockTask[]>;
}

/** Pure aggregation logic extracted from AggregatorProvider. */
async function aggregateTasks(providers: MockProvider[]): Promise<MockTask[]> {
  const results = await Promise.allSettled(
    providers.map(p => p.getTasks()),
  );

  const seen = new Set<string>();
  const tasks: MockTask[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const task of result.value) {
        if (!seen.has(task.id)) {
          seen.add(task.id);
          tasks.push(task);
        }
      }
    }
  }

  return tasks;
}

function makeTask(id: string, title: string, providerId: string): MockTask {
  return { id, title, providerId };
}

function makeMockProvider(id: string, tasks: MockTask[], shouldFail = false): MockProvider {
  return {
    id,
    async getTasks() {
      if (shouldFail) { throw new Error('provider failed'); }
      return tasks;
    },
  };
}

suite('AggregatorProvider (aggregation logic)', () => {
  test('aggregates tasks from multiple providers', async () => {
    const p1 = makeMockProvider('a', [makeTask('a:1', 'Task A1', 'a')]);
    const p2 = makeMockProvider('b', [makeTask('b:1', 'Task B1', 'b')]);

    const tasks = await aggregateTasks([p1, p2]);
    assert.strictEqual(tasks.length, 2);
  });

  test('deduplicates tasks by id', async () => {
    const shared = makeTask('shared:1', 'Shared', 'shared');
    const p1 = makeMockProvider('a', [shared, makeTask('a:1', 'A', 'a')]);
    const p2 = makeMockProvider('b', [shared]);

    const tasks = await aggregateTasks([p1, p2]);
    assert.strictEqual(tasks.length, 2); // shared:1 + a:1
  });

  test('failing provider does not block others', async () => {
    const p1 = makeMockProvider('ok', [makeTask('ok:1', 'OK', 'ok')]);
    const p2 = makeMockProvider('fail', [], true);

    const tasks = await aggregateTasks([p1, p2]);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].id, 'ok:1');
  });

  test('empty providers returns empty array', async () => {
    const tasks = await aggregateTasks([]);
    assert.deepStrictEqual(tasks, []);
  });

  test('all providers failing returns empty array', async () => {
    const p1 = makeMockProvider('fail1', [], true);
    const p2 = makeMockProvider('fail2', [], true);

    const tasks = await aggregateTasks([p1, p2]);
    assert.deepStrictEqual(tasks, []);
  });
});
