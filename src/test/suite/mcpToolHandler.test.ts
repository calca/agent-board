import * as assert from 'assert';
import {
  MCP_TOOLS,
  McpTaskAdapter,
  handleListTasks,
  handleGetTask,
  handleUpdateTask,
  handleToolCall,
  successResult,
  errorResult,
} from '../../mcp/mcpToolHandler';
import { KanbanTask } from '../../types/KanbanTask';

// ── Helpers ─────────────────────────────────────────────────────────

function makeTask(id: string, overrides?: Partial<KanbanTask>): KanbanTask {
  return {
    id,
    title: `Task ${id}`,
    body: `Body of ${id}`,
    status: 'todo',
    labels: [],
    providerId: 'test',
    meta: {},
    ...overrides,
  };
}

function createAdapter(tasks: KanbanTask[]): McpTaskAdapter & { tasks: KanbanTask[] } {
  const store = [...tasks];
  return {
    tasks: store,
    async getTasks() {
      return store;
    },
    async updateTask(task: KanbanTask) {
      const idx = store.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        store[idx] = task;
      }
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

suite('MCP_TOOLS catalogue', () => {
  test('exposes list_tasks, get_task, update_task', () => {
    const names = MCP_TOOLS.map(t => t.name);
    assert.deepStrictEqual(names, ['list_tasks', 'get_task', 'update_task']);
  });

  test('every tool has a description and inputSchema', () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(tool.description, `${tool.name} missing description`);
      assert.strictEqual(tool.inputSchema.type, 'object');
    }
  });

  test('get_task requires taskId', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'get_task')!;
    assert.deepStrictEqual(tool.inputSchema.required, ['taskId']);
  });

  test('update_task requires taskId', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'update_task')!;
    assert.deepStrictEqual(tool.inputSchema.required, ['taskId']);
  });

  test('list_tasks has no required params', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'list_tasks')!;
    assert.strictEqual(tool.inputSchema.required, undefined);
  });
});

suite('successResult / errorResult', () => {
  test('successResult wraps value as JSON text', () => {
    const r = successResult({ a: 1 });
    assert.strictEqual(r.content.length, 1);
    assert.strictEqual(r.content[0].type, 'text');
    assert.deepStrictEqual(JSON.parse(r.content[0].text), { a: 1 });
    assert.strictEqual(r.isError, undefined);
  });

  test('errorResult sets isError flag', () => {
    const r = errorResult('boom');
    assert.strictEqual(r.content[0].text, 'boom');
    assert.strictEqual(r.isError, true);
  });
});

suite('handleListTasks', () => {
  test('returns all tasks when no column filter', async () => {
    const adapter = createAdapter([
      makeTask('t:1', { status: 'todo' }),
      makeTask('t:2', { status: 'inprogress' }),
    ]);
    const result = await handleListTasks(adapter, {});
    assert.strictEqual(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.length, 2);
  });

  test('filters by column', async () => {
    const adapter = createAdapter([
      makeTask('t:1', { status: 'todo' }),
      makeTask('t:2', { status: 'inprogress' }),
      makeTask('t:3', { status: 'todo' }),
    ]);
    const result = await handleListTasks(adapter, { column: 'todo' });
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.length, 2);
    assert.ok(data.every((t: { status: string }) => t.status === 'todo'));
  });

  test('returns empty array when no tasks match', async () => {
    const adapter = createAdapter([makeTask('t:1', { status: 'todo' })]);
    const result = await handleListTasks(adapter, { column: 'done' });
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.length, 0);
  });

  test('returns summary fields only', async () => {
    const adapter = createAdapter([
      makeTask('t:1', { labels: ['bug'], assignee: 'alice', url: 'https://example.com' }),
    ]);
    const result = await handleListTasks(adapter, {});
    const data = JSON.parse(result.content[0].text);
    const task = data[0];
    assert.strictEqual(task.id, 't:1');
    assert.strictEqual(task.title, 'Task t:1');
    assert.strictEqual(task.status, 'todo');
    assert.deepStrictEqual(task.labels, ['bug']);
    assert.strictEqual(task.assignee, 'alice');
    assert.strictEqual(task.url, 'https://example.com');
    // body should NOT be in the summary
    assert.strictEqual(task.body, undefined);
  });
});

suite('handleGetTask', () => {
  test('returns full task details', async () => {
    const adapter = createAdapter([
      makeTask('t:1', { body: 'detailed body', labels: ['p1'] }),
    ]);
    const result = await handleGetTask(adapter, { taskId: 't:1' });
    assert.strictEqual(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.id, 't:1');
    assert.strictEqual(data.body, 'detailed body');
    assert.deepStrictEqual(data.labels, ['p1']);
  });

  test('returns error for missing taskId', async () => {
    const adapter = createAdapter([]);
    const result = await handleGetTask(adapter, { taskId: '' });
    assert.strictEqual(result.isError, true);
  });

  test('returns error for unknown task', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleGetTask(adapter, { taskId: 't:999' });
    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('not found'));
  });
});

suite('handleUpdateTask', () => {
  test('moves task to a new column', async () => {
    const adapter = createAdapter([makeTask('t:1', { status: 'todo' })]);
    const result = await handleUpdateTask(adapter, { taskId: 't:1', column: 'inprogress' });
    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(adapter.tasks[0].status, 'inprogress');
  });

  test('updates title', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleUpdateTask(adapter, { taskId: 't:1', title: 'New Title' });
    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(adapter.tasks[0].title, 'New Title');
  });

  test('updates body', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleUpdateTask(adapter, { taskId: 't:1', body: 'Updated body' });
    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(adapter.tasks[0].body, 'Updated body');
  });

  test('updates labels', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleUpdateTask(adapter, { taskId: 't:1', labels: ['bug', 'urgent'] });
    assert.strictEqual(result.isError, undefined);
    assert.deepStrictEqual(adapter.tasks[0].labels, ['bug', 'urgent']);
  });

  test('updates assignee', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleUpdateTask(adapter, { taskId: 't:1', assignee: 'bob' });
    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(adapter.tasks[0].assignee, 'bob');
  });

  test('returns error for missing taskId', async () => {
    const adapter = createAdapter([]);
    const result = await handleUpdateTask(adapter, { taskId: '' });
    assert.strictEqual(result.isError, true);
  });

  test('returns error for unknown task', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleUpdateTask(adapter, { taskId: 't:999', column: 'done' });
    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('not found'));
  });

  test('returns error for invalid column', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleUpdateTask(adapter, { taskId: 't:1', column: 'invalid' });
    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('Invalid column'));
  });

  test('multiple fields updated at once', async () => {
    const adapter = createAdapter([makeTask('t:1', { status: 'todo' })]);
    const result = await handleUpdateTask(adapter, {
      taskId: 't:1',
      column: 'review',
      title: 'Reviewed Task',
      assignee: 'charlie',
    });
    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(adapter.tasks[0].status, 'review');
    assert.strictEqual(adapter.tasks[0].title, 'Reviewed Task');
    assert.strictEqual(adapter.tasks[0].assignee, 'charlie');
  });
});

suite('handleToolCall routing', () => {
  test('routes list_tasks correctly', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleToolCall(adapter, 'list_tasks', {});
    assert.strictEqual(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.length, 1);
  });

  test('routes get_task correctly', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleToolCall(adapter, 'get_task', { taskId: 't:1' });
    assert.strictEqual(result.isError, undefined);
  });

  test('routes update_task correctly', async () => {
    const adapter = createAdapter([makeTask('t:1')]);
    const result = await handleToolCall(adapter, 'update_task', { taskId: 't:1', column: 'done' });
    assert.strictEqual(result.isError, undefined);
  });

  test('returns error for unknown tool', async () => {
    const adapter = createAdapter([]);
    const result = await handleToolCall(adapter, 'nonexistent_tool', {});
    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('Unknown tool'));
  });
});

suite('MCP ProjectConfigData mcp section', () => {
  test('mcp config is optional', () => {
    const cfg = {} as Record<string, unknown>;
    assert.strictEqual(cfg.mcp, undefined);
  });

  test('mcp config with enabled flag', () => {
    const cfg = { mcp: { enabled: true } };
    assert.strictEqual(cfg.mcp.enabled, true);
  });

  test('mcp config with tasksPath', () => {
    const cfg = { mcp: { enabled: true, tasksPath: '/custom/tasks.json' } };
    assert.strictEqual(cfg.mcp.tasksPath, '/custom/tasks.json');
  });
});
