import * as assert from 'assert';
import { AgentManager } from '../../agentManager';
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

suite('AgentManager', () => {
  test('starts with no agents', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    assert.deepStrictEqual(am.getAgents(), []);
  });

  test('createAgent creates an idle agent', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    const agent = am.createAgent('Test Agent');
    assert.strictEqual(agent.name, 'Test Agent');
    assert.strictEqual(agent.status, 'idle');
    assert.ok(agent.id.startsWith('agent-'));
  });

  test('startAgent transitions to running', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    const agent = am.createAgent('Runner');
    const started = am.startAgent(agent.id);
    assert.ok(started);
    assert.strictEqual(started!.status, 'running');
    assert.ok(started!.startedAt);
  });

  test('startAgent returns undefined when agent is already running', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    const agent = am.createAgent('Runner');
    am.startAgent(agent.id);
    assert.strictEqual(am.startAgent(agent.id), undefined);
  });

  test('stopAgent transitions running agent to failed', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    const agent = am.createAgent('Runner');
    am.startAgent(agent.id);
    const stopped = am.stopAgent(agent.id);
    assert.ok(stopped);
    assert.strictEqual(stopped!.status, 'failed');
  });

  test('completeAgent marks agent as completed and records output', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    const agent = am.createAgent('Runner');
    am.startAgent(agent.id);
    const completed = am.completeAgent(agent.id, 'Done!');
    assert.ok(completed);
    assert.strictEqual(completed!.status, 'completed');
    assert.strictEqual(completed!.output, 'Done!');
  });

  test('completeAgent completes the linked task', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    const task = ts.addTask('Linked task');
    const agent = am.createAgent('Runner', task.id);
    am.startAgent(agent.id);
    am.completeAgent(agent.id, 'Done!');
    const updatedTask = ts.getTask(task.id);
    assert.strictEqual(updatedTask!.status, 'completed');
  });

  test('deleteAgent removes the agent', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am = new AgentManager(ctx, ts);
    const agent = am.createAgent('To delete');
    assert.strictEqual(am.getAgents().length, 1);
    assert.strictEqual(am.deleteAgent(agent.id), true);
    assert.strictEqual(am.getAgents().length, 0);
  });

  test('running agents are set to failed on reload', () => {
    const ctx = makeMockContext();
    const ts = new TaskStore(ctx);
    const am1 = new AgentManager(ctx, ts);
    const agent = am1.createAgent('Crash test');
    am1.startAgent(agent.id);

    // Simulate reload by creating a new AgentManager with the same context
    const am2 = new AgentManager(ctx, ts);
    const reloaded = am2.getAgent(agent.id);
    assert.ok(reloaded);
    assert.strictEqual(reloaded!.status, 'failed');
  });
});
