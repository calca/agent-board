import * as assert from 'assert';

// Task
import { runTask } from '../../genai-provider/providers/copilot-flow/task/runTask';
import { selfHealingRun } from '../../genai-provider/providers/copilot-flow/task/selfHealing';
import { Task } from '../../genai-provider/providers/copilot-flow/task/types';

// Chain
import { Chain } from '../../genai-provider/providers/copilot-flow/chain/Chain';

// Graph
import { END_NODE, Graph } from '../../genai-provider/providers/copilot-flow/graph/Graph';

// Guardrails
import {
    allOf,
    buildJsonFixPrompt,
    hasKeys,
    isArray,
    isNonEmptyString,
    safeJsonParse,
    validateWithSchema,
} from '../../genai-provider/providers/copilot-flow/guardrails/guardrails';

// Middleware
import { loggingMiddleware, metricsMiddleware, securityMiddleware } from '../../genai-provider/providers/copilot-flow/middleware/middlewares';

// Observability
import { FlowEventBus, FlowTracer } from '../../genai-provider/providers/copilot-flow/observability/FlowEventBus';

// Templates
import { TemplateLibrary, renderTemplate } from '../../genai-provider/providers/copilot-flow/templates/TemplateLibrary';

// Performance
import { RateLimiter, ResultCache, cachingMiddleware, runParallel } from '../../genai-provider/providers/copilot-flow/performance/performance';

// Security
import {
    AuditLog,
    PolicyEngine,
    buildAllowedToolFlags,
    sanitisePrompt,
    validateInput,
} from '../../genai-provider/providers/copilot-flow/security/security';

// Multi-Agent
import { runMultiAgent } from '../../genai-provider/providers/copilot-flow/agents/MultiAgent';

// ── Helpers ─────────────────────────────────────────────────────────

/** Mock runner that returns a fixed string. */
function mockRunner(output: string): (prompt: string) => Promise<string> {
  return async () => output;
}

/** Mock runner that returns the prompt itself (echo). */
function echoRunner(): (prompt: string) => Promise<string> {
  return async (prompt: string) => prompt;
}

/** Mock runner that fails N times, then succeeds. */
function failThenSucceed(failures: number, output: string): (prompt: string) => Promise<string> {
  let count = 0;
  return async () => {
    if (count++ < failures) { throw new Error('temporary failure'); }
    return output;
  };
}

/** Simple string→string task. */
function makeStringTask(name: string): Task<string, string> {
  return {
    name,
    prompt: (input: string) => `Do: ${input}`,
    parse: (raw: string) => raw.trim(),
  };
}

/** JSON-parsing task with validation. */
function _makeJsonTask<T>(name: string, validator?: (v: T) => true | string): Task<string, T> {
  return {
    name,
    prompt: (input: string) => `Return JSON for: ${input}`,
    parse: (raw: string) => JSON.parse(raw) as T,
    validate: validator,
  };
}

// =====================================================================
// TESTS
// =====================================================================

suite('CopilotFlow — runTask', () => {
  test('basic task succeeds', async () => {
    const task = makeStringTask('echo');
    const result = await runTask({ task, input: 'hello', runner: mockRunner('world') });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.output, 'world');
    assert.strictEqual(result.attempts.length, 1);
  });

  test('parse error reported', async () => {
    const task: Task<string, object> = {
      name: 'bad-parse',
      prompt: () => 'get json',
      parse: () => { throw new Error('not json'); },
    };
    const result = await runTask({ task, input: '', runner: mockRunner('garbage') });
    assert.strictEqual(result.ok, false);
    assert.ok(result.attempts[0].error?.includes('Parse error'));
  });

  test('validation failure reported', async () => {
    const task: Task<string, string> = {
      name: 'validate-fail',
      prompt: () => 'go',
      parse: (raw) => raw,
      validate: () => 'too short',
    };
    const result = await runTask({ task, input: '', runner: mockRunner('x') });
    assert.strictEqual(result.ok, false);
    assert.ok(result.attempts[0].error?.includes('Validation failed'));
  });

  test('retries on runner error', async () => {
    const task: Task<string, string> = {
      ...makeStringTask('retry-test'),
      retry: { maxRetries: 2, delayMs: 0 },
    };
    const result = await runTask({ task, input: '', runner: failThenSucceed(2, 'ok') });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.output, 'ok');
    assert.strictEqual(result.attempts.length, 3);
  });

  test('fallback on exhausted retries', async () => {
    const fallback = makeStringTask('fallback');
    const task: Task<string, string> = {
      ...makeStringTask('primary'),
      retry: { maxRetries: 0 },
      parse: () => { throw new Error('always fails'); },
      fallback,
    };
    const result = await runTask({ task, input: 'hi', runner: mockRunner('fallback-output') });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.taskName, 'fallback');
  });

  test('middleware pipeline executes', async () => {
    const log: string[] = [];
    const mw = loggingMiddleware((msg) => log.push(msg));
    const task = makeStringTask('mw-test');
    await runTask({ task, input: '', runner: mockRunner('done'), middleware: [mw] });
    assert.ok(log.some(l => l.includes('mw-test')));
  });

  test('event bus receives events', async () => {
    const events: string[] = [];
    const bus = new FlowEventBus();
    bus.on('taskStart', (p) => events.push(`start:${p.taskName}`));
    bus.on('taskEnd', (p) => events.push(`end:${p.taskName}`));
    const task = makeStringTask('bus-test');
    await runTask({ task, input: '', runner: mockRunner('ok') }, bus);
    assert.deepStrictEqual(events, ['start:bus-test', 'end:bus-test']);
  });
});

suite('CopilotFlow — selfHealingRun', () => {
  test('succeeds on first try', async () => {
    const task: Task<string, string> = {
      name: 'heal-ok',
      prompt: () => 'go',
      parse: (raw) => raw.trim(),
      validate: (v) => v.length > 0 ? true : 'empty',
    };
    const result = await selfHealingRun({ task, runner: mockRunner('good') }, 'input');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.iterations, 1);
  });

  test('heals on parse failure', async () => {
    let attempt = 0;
    const runner = async () => {
      attempt++;
      return attempt === 1 ? 'bad' : '42';
    };
    const task: Task<string, number> = {
      name: 'heal-parse',
      prompt: () => 'get number',
      parse: (raw) => {
        const n = Number(raw);
        if (isNaN(n)) { throw new Error('not a number'); }
        return n;
      },
    };
    const result = await selfHealingRun({ task, runner, maxIterations: 3 }, '');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.output, 42);
    assert.strictEqual(result.iterations, 2);
  });
});

suite('CopilotFlow — Chain', () => {
  test('linear chain executes all steps', async () => {
    const upper: Task<string, string> = {
      name: 'upper',
      prompt: (input) => `uppercase: ${input}`,
      parse: (raw) => raw.toUpperCase(),
    };
    const exclaim: Task<string, string> = {
      name: 'exclaim',
      prompt: (input) => `exclaim: ${input}`,
      parse: (raw) => `${raw}!`,
    };

    const chain = new Chain({ name: 'test-chain', runner: echoRunner() });
    chain.addStep(upper, 'uppered');
    chain.addStep(exclaim, 'exclaimed', 'uppered');

    const result = await chain.run('hello');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.stepResults.length, 2);
  });

  test('chain fails fast on task failure', async () => {
    const failing: Task<string, string> = {
      name: 'fail',
      prompt: () => 'go',
      parse: () => { throw new Error('nope'); },
    };
    const never: Task<string, string> = {
      name: 'never',
      prompt: () => 'go',
      parse: (raw) => raw,
    };

    const chain = new Chain({ name: 'fail-chain', runner: mockRunner('x') });
    chain.addStep(failing, 'a');
    chain.addStep(never, 'b');

    const result = await chain.run('');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.stepResults.length, 1);
    assert.ok(result.error?.includes('fail'));
  });

  test('beforeTask/afterTask hooks called', async () => {
    const hooks: string[] = [];
    const task = makeStringTask('hooked');
    const chain = new Chain({
      name: 'hook-chain',
      runner: mockRunner('ok'),
      beforeTask: (name) => { hooks.push(`before:${name}`); },
      afterTask: (name) => { hooks.push(`after:${name}`); },
    });
    chain.addStep(task, 'out');
    await chain.run('');
    assert.deepStrictEqual(hooks, ['before:hooked', 'after:hooked']);
  });
});

suite('CopilotFlow — Graph', () => {
  test('simple linear graph', async () => {
    const t1 = makeStringTask('node-a');
    const t2 = makeStringTask('node-b');

    const graph = new Graph({ name: 'linear', runner: mockRunner('done') });
    graph.addNode({ id: 'a', task: t1, next: 'b' });
    graph.addNode({ id: 'b', task: t2 });

    const result = await graph.run('a', 'start');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.visitedNodes, ['a', 'b']);
  });

  test('dynamic edge routing', async () => {
    const decide: Task<unknown, { choice: string }> = {
      name: 'decide',
      prompt: () => 'choose',
      parse: () => ({ choice: 'left' }),
    };
    const left = makeStringTask('left');
    const right = makeStringTask('right');

    const graph = new Graph({ name: 'branch', runner: mockRunner('x') });
    graph.addNode({
      id: 'decide', task: decide, outputKey: 'decision',
      next: (ctx) => (ctx.decision as { choice: string }).choice === 'left' ? 'left' : 'right',
    });
    graph.addNode({ id: 'left', task: left });
    graph.addNode({ id: 'right', task: right });

    const result = await graph.run('decide', null);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.visitedNodes, ['decide', 'left']);
  });

  test('max steps protection', async () => {
    const loop = makeStringTask('loop');
    const graph = new Graph({ name: 'infinite', runner: mockRunner('x'), maxSteps: 3 });
    graph.addNode({ id: 'loop', task: loop, next: 'loop' });

    const result = await graph.run('loop', '');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes('exceeded max steps'));
    assert.strictEqual(result.visitedNodes.length, 3);
  });

  test('END_NODE terminates graph', async () => {
    const t = makeStringTask('end-test');
    const graph = new Graph({ name: 'end', runner: mockRunner('x') });
    graph.addNode({ id: 'start', task: t, next: END_NODE });

    const result = await graph.run('start', '');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.visitedNodes, ['start']);
  });

  test('missing node returns error', async () => {
    const graph = new Graph({ name: 'missing', runner: mockRunner('x') });
    const result = await graph.run('ghost', '');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes('not found'));
  });
});

suite('CopilotFlow — Guardrails', () => {
  test('safeJsonParse parses valid JSON', () => {
    const result = safeJsonParse<{ a: number }>('{"a": 1}');
    assert.strictEqual(result.ok, true);
    if (result.ok) { assert.deepStrictEqual(result.data, { a: 1 }); }
  });

  test('safeJsonParse strips markdown fences', () => {
    const result = safeJsonParse('```json\n{"x": true}\n```');
    assert.strictEqual(result.ok, true);
    if (result.ok) { assert.deepStrictEqual(result.data, { x: true }); }
  });

  test('safeJsonParse returns error for invalid JSON', () => {
    const result = safeJsonParse('{bad}');
    assert.strictEqual(result.ok, false);
  });

  test('validateWithSchema passes', () => {
    const result = validateWithSchema('hello', isNonEmptyString);
    assert.strictEqual(result.ok, true);
  });

  test('validateWithSchema fails', () => {
    const result = validateWithSchema('', isNonEmptyString);
    assert.strictEqual(result.ok, false);
  });

  test('isArray validator', () => {
    assert.strictEqual(isArray([]), true);
    assert.notStrictEqual(isArray('not array'), true);
  });

  test('hasKeys validator', () => {
    const v = hasKeys('name', 'age');
    assert.strictEqual(v({ name: 'a', age: 1 }), true);
    assert.notStrictEqual(v({ name: 'a' }), true);
    assert.notStrictEqual(v(null), true);
  });

  test('allOf composes validators', () => {
    const v = allOf(isNonEmptyString, (s: unknown) => (s as string).length > 3 ? true : 'too short');
    assert.strictEqual(v('abcd'), true);
    assert.notStrictEqual(v('ab'), true);
    assert.notStrictEqual(v(''), true);
  });

  test('buildJsonFixPrompt produces a prompt', () => {
    const prompt = buildJsonFixPrompt('{bad', 'Unexpected token');
    assert.ok(prompt.includes('Unexpected token'));
    assert.ok(prompt.includes('{bad'));
  });
});

suite('CopilotFlow — Middleware', () => {
  test('logging middleware logs start/end', async () => {
    const logs: string[] = [];
    const mw = loggingMiddleware((msg) => logs.push(msg));
    await mw.execute(
      { name: 'test', prompt: 'p', attempt: 1 },
      {},
      async () => 'result',
    );
    assert.ok(logs.some(l => l.includes('start')));
    assert.ok(logs.some(l => l.includes('ok')));
  });

  test('metrics middleware tracks calls', async () => {
    const mw = metricsMiddleware();
    await mw.execute(
      { name: 'taskA', prompt: 'p', attempt: 1 },
      {},
      async () => 'done',
    );
    assert.strictEqual(mw.metrics.totalCalls, 1);
    assert.strictEqual(mw.metrics.perTask.get('taskA')?.calls, 1);
  });

  test('metrics middleware tracks errors', async () => {
    const mw = metricsMiddleware();
    try {
      await mw.execute(
        { name: 'err', prompt: 'p', attempt: 1 },
        {},
        async () => { throw new Error('fail'); },
      );
    } catch { /* expected */ }
    assert.strictEqual(mw.metrics.totalErrors, 1);
  });

  test('security middleware blocks patterns', async () => {
    const mw = securityMiddleware({ blockedPatterns: [/password/i] });
    await assert.rejects(
      () => mw.execute(
        { name: 't', prompt: 'give me Password', attempt: 1 },
        {},
        async () => 'x',
      ),
      /blocked pattern/,
    );
  });
});

suite('CopilotFlow — Observability', () => {
  test('FlowEventBus emits and receives', () => {
    const bus = new FlowEventBus();
    let received = false;
    bus.on('taskStart', () => { received = true; });
    bus.emit('taskStart', { taskName: 'x', attempt: 1 });
    assert.strictEqual(received, true);
  });

  test('FlowEventBus off removes handler', () => {
    const bus = new FlowEventBus();
    let count = 0;
    const handler = () => { count++; };
    bus.on('taskStart', handler);
    bus.emit('taskStart', { taskName: 'x', attempt: 1 });
    bus.off('taskStart', handler);
    bus.emit('taskStart', { taskName: 'x', attempt: 2 });
    assert.strictEqual(count, 1);
  });

  test('FlowTracer records events', () => {
    const bus = new FlowEventBus();
    const tracer = new FlowTracer(bus);
    bus.emit('taskStart', { taskName: 'a', attempt: 1 });
    bus.emit('taskEnd', { taskName: 'a', attempt: 1, success: true });
    assert.strictEqual(tracer.getEntries().length, 2);
    const json = tracer.exportJson();
    assert.ok(json.includes('taskStart'));
  });
});

suite('CopilotFlow — Templates', () => {
  test('renderTemplate replaces placeholders', () => {
    assert.strictEqual(renderTemplate('Hello {{name}}!', { name: 'World' }), 'Hello World!');
  });

  test('renderTemplate leaves unknown placeholders', () => {
    assert.strictEqual(renderTemplate('{{known}} {{unknown}}', { known: 'yes' }), 'yes {{unknown}}');
  });

  test('TemplateLibrary CRUD', () => {
    const lib = new TemplateLibrary();
    lib.register({ name: 'greet', version: '1.0.0', body: 'Hi {{name}}' });
    assert.strictEqual(lib.list().length, 1);
    assert.strictEqual(lib.render('greet', { name: 'Alice' }), 'Hi Alice');
    lib.remove('greet');
    assert.strictEqual(lib.list().length, 0);
  });

  test('TemplateLibrary throws for missing template', () => {
    const lib = new TemplateLibrary();
    assert.throws(() => lib.render('nope', {}), /not found/);
  });
});

suite('CopilotFlow — Performance', () => {
  test('ResultCache get/set', () => {
    const cache = new ResultCache(10, 60_000);
    cache.set('prompt1', 'result1');
    assert.strictEqual(cache.get('prompt1'), 'result1');
    assert.strictEqual(cache.get('prompt2'), undefined);
  });

  test('ResultCache evicts oldest', () => {
    const cache = new ResultCache(2, 60_000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.get('a'), undefined);
  });

  test('cachingMiddleware returns cached result', async () => {
    const cache = new ResultCache();
    const mw = cachingMiddleware(cache);
    let calls = 0;
    const next = async () => { calls++; return 'fresh'; };
    const info = { name: 't', prompt: 'hello', attempt: 1 };

    const r1 = await mw.execute(info, {}, next);
    const r2 = await mw.execute(info, {}, next);
    assert.strictEqual(r1, 'fresh');
    assert.strictEqual(r2, 'fresh');
    assert.strictEqual(calls, 1); // only called once
  });

  test('RateLimiter allows burst', async () => {
    const limiter = new RateLimiter(3, 10);
    // Should acquire 3 tokens immediately
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // This is fine — just testing no errors
  });

  test('runParallel executes all tasks', async () => {
    const items = [
      { task: makeStringTask('p1'), input: 'a' },
      { task: makeStringTask('p2'), input: 'b' },
      { task: makeStringTask('p3'), input: 'c' },
    ];
    const results = await runParallel(items, mockRunner('done'), { concurrency: 2 });
    assert.strictEqual(results.length, 3);
    assert.ok(results.every(r => r.ok));
  });
});

suite('CopilotFlow — Security', () => {
  test('sanitisePrompt removes null bytes', () => {
    assert.strictEqual(sanitisePrompt('hello\x00world'), 'helloworld');
  });

  test('sanitisePrompt removes ANSI escapes', () => {
    assert.strictEqual(sanitisePrompt('hello\x1b[31mred\x1b[0m'), 'hellored');
  });

  test('validateInput rejects empty', () => {
    const result = validateInput('');
    assert.strictEqual(result.ok, false);
  });

  test('validateInput rejects oversized', () => {
    const result = validateInput('a'.repeat(101), 100);
    assert.strictEqual(result.ok, false);
  });

  test('validateInput accepts valid', () => {
    const result = validateInput('hello');
    assert.strictEqual(result.ok, true);
  });

  test('AuditLog records and exports', () => {
    const log = new AuditLog(5);
    log.record({ action: 'run', taskName: 'test', success: true });
    assert.strictEqual(log.getEntries().length, 1);
    assert.ok(log.exportJson().includes('test'));
    log.clear();
    assert.strictEqual(log.getEntries().length, 0);
  });

  test('AuditLog respects max entries', () => {
    const log = new AuditLog(2);
    log.record({ action: 'a' });
    log.record({ action: 'b' });
    log.record({ action: 'c' });
    assert.strictEqual(log.getEntries().length, 2);
    assert.strictEqual(log.getEntries()[0].action, 'b');
  });

  test('PolicyEngine allows when no rules', () => {
    const engine = new PolicyEngine();
    assert.deepStrictEqual(engine.evaluate('run'), { allowed: true });
  });

  test('PolicyEngine denies on rule failure', () => {
    const engine = new PolicyEngine();
    engine.addRule({ name: 'no-delete', check: (action) => action === 'delete' ? 'Not allowed' : true });
    const result = engine.evaluate('delete');
    assert.strictEqual(result.allowed, false);
    if (!result.allowed) {
      assert.strictEqual(result.deniedBy, 'no-delete');
    }
  });

  test('buildAllowedToolFlags filters unsafe names', () => {
    const flags = buildAllowedToolFlags(['read-file', 'write-file', 'bad name!']);
    assert.deepStrictEqual(flags, ['--allow-tool', 'read-file', '--allow-tool', 'write-file']);
  });
});

suite('CopilotFlow — MultiAgent', () => {
  test('approve on first iteration', async () => {
    const planner = {
      role: 'planner' as const,
      task: {
        name: 'planner',
        prompt: (input: unknown) => `plan: ${input}`,
        parse: (raw: string) => raw,
      },
    };
    const executor = {
      role: 'executor' as const,
      task: {
        name: 'executor',
        prompt: (input: unknown) => `execute: ${input}`,
        parse: (raw: string) => raw,
      },
    };
    const reviewer = {
      role: 'reviewer' as const,
      task: {
        name: 'reviewer',
        prompt: (input: unknown) => `review: ${input}`,
        parse: () => ({ approved: true }),
      },
    };

    const result = await runMultiAgent(
      { name: 'test-ma', planner, executor, reviewer, runner: mockRunner('ok') },
      'do something',
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.iterations, 1);
  });

  test('max iterations without approval', async () => {
    const agent = (name: string) => ({
      role: name as 'planner' | 'executor' | 'reviewer',
      task: {
        name,
        prompt: () => name,
        parse: (raw: string) => name === 'reviewer' ? { approved: false, feedback: 'try again' } : raw,
      },
    });
    const result = await runMultiAgent(
      {
        name: 'nopass',
        planner: agent('planner'),
        executor: agent('executor'),
        reviewer: agent('reviewer'),
        runner: mockRunner('x'),
        maxIterations: 2,
      },
      'goal',
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.iterations, 2);
  });
});
