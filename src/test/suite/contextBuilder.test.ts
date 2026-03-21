import * as assert from 'assert';

/**
 * Tests for ContextBuilder prompt generation logic.
 * Uses a standalone extraction of the template engine to avoid vscode dependency.
 */

interface MockTask {
  id: string;
  title: string;
  body: string;
  status: string;
  labels: string[];
  assignee?: string;
  url?: string;
  providerId: string;
}

/** Extracted template engine from ContextBuilder */
function buildPrompt(task: MockTask): string {
  const parts: string[] = [];

  parts.push(`# Task: ${task.title}`);
  parts.push(`Status: ${task.status}`);

  if (task.labels.length > 0) {
    parts.push(`Labels: ${task.labels.join(', ')}`);
  }

  if (task.assignee) {
    parts.push(`Assignee: ${task.assignee}`);
  }

  if (task.url) {
    parts.push(`Source: ${task.url}`);
  }

  if (task.body) {
    parts.push('');
    parts.push('## Description');
    parts.push(task.body);
  }

  return parts.join('\n');
}

function buildFromTemplate(template: string, task: MockTask): string {
  const vars: Record<string, string> = {
    title: task.title,
    body: task.body,
    labels: task.labels.join(', '),
    status: task.status,
    assignee: task.assignee ?? '',
    url: task.url ?? '',
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function makeTask(overrides: Partial<MockTask> = {}): MockTask {
  return {
    id: 'test:1',
    title: 'Fix the bug',
    body: 'This is the **description** of the task.',
    status: 'inprogress',
    labels: ['bug', 'urgent'],
    assignee: 'alice',
    url: 'https://github.com/example/repo/issues/1',
    providerId: 'test',
    ...overrides,
  };
}

suite('ContextBuilder', () => {
  test('build includes task title', () => {
    const result = buildPrompt(makeTask());
    assert.ok(result.includes('Fix the bug'));
  });

  test('build includes status', () => {
    const result = buildPrompt(makeTask());
    assert.ok(result.includes('inprogress'));
  });

  test('build includes labels', () => {
    const result = buildPrompt(makeTask());
    assert.ok(result.includes('bug'));
    assert.ok(result.includes('urgent'));
  });

  test('build includes assignee', () => {
    const result = buildPrompt(makeTask());
    assert.ok(result.includes('alice'));
  });

  test('build includes URL', () => {
    const result = buildPrompt(makeTask());
    assert.ok(result.includes('https://github.com/example/repo/issues/1'));
  });

  test('build includes body', () => {
    const result = buildPrompt(makeTask());
    assert.ok(result.includes('**description**'));
  });

  test('build handles empty body', () => {
    const result = buildPrompt(makeTask({ body: '' }));
    assert.ok(!result.includes('## Description'));
  });

  test('build handles empty labels', () => {
    const result = buildPrompt(makeTask({ labels: [] }));
    assert.ok(!result.includes('Labels:'));
  });

  test('build handles missing assignee', () => {
    const result = buildPrompt(makeTask({ assignee: undefined }));
    assert.ok(!result.includes('Assignee:'));
  });

  test('build handles missing URL', () => {
    const result = buildPrompt(makeTask({ url: undefined }));
    assert.ok(!result.includes('Source:'));
  });

  test('buildFromTemplate replaces variables', () => {
    const template = 'Task: {{title}} | Status: {{status}} | Labels: {{labels}}';
    const result = buildFromTemplate(template, makeTask());
    assert.strictEqual(result, 'Task: Fix the bug | Status: inprogress | Labels: bug, urgent');
  });

  test('buildFromTemplate replaces unknown variables with empty string', () => {
    const template = 'Unknown: {{unknown}}';
    const result = buildFromTemplate(template, makeTask());
    assert.strictEqual(result, 'Unknown: ');
  });
});
