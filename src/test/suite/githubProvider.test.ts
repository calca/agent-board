import * as assert from 'assert';
import type { GitHubIssue } from '../../providers/GitHubProvider';

/**
 * Tests for GitHubProvider's pure mapping logic, extracted to avoid
 * the vscode runtime dependency.
 */

/** Pure re-implementation of GitHubProvider.mapStatus for unit testing. */
function mapStatus(state: string, labels: Array<{ name: string }>): string {
  if (state === 'closed') {
    return 'done';
  }
  const labelNames = labels.map(l => l.name.toLowerCase());
  if (labelNames.includes('in progress') || labelNames.includes('wip')) {
    return 'inprogress';
  }
  if (labelNames.includes('review') || labelNames.includes('needs review')) {
    return 'review';
  }
  return 'todo';
}

/** Pure re-implementation of GitHubProvider.mapIssue for unit testing. */
function mapIssue(issue: GitHubIssue): {
  id: string;
  title: string;
  body: string;
  status: string;
  labels: string[];
  assignee?: string;
  providerId: string;
} {
  return {
    id: `github:${issue.number}`,
    title: issue.title,
    body: issue.body ?? '',
    status: mapStatus(issue.state, issue.labels),
    labels: issue.labels.map(l => l.name),
    assignee: issue.assignee?.login,
    providerId: 'github',
  };
}

function fakeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: 'Test issue',
    body: 'Some description',
    state: 'open',
    labels: [],
    assignee: null,
    html_url: 'https://github.com/owner/repo/issues/42',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

suite('GitHubProvider (mapping logic)', () => {
  // ── mapStatus ──────────────────────────────────────────────────────

  test('closed issue maps to done', () => {
    assert.strictEqual(mapStatus('closed', []), 'done');
  });

  test('open issue with no labels maps to todo', () => {
    assert.strictEqual(mapStatus('open', []), 'todo');
  });

  test('open issue with "in progress" label maps to inprogress', () => {
    assert.strictEqual(
      mapStatus('open', [{ name: 'In Progress' }]),
      'inprogress',
    );
  });

  test('open issue with "wip" label maps to inprogress', () => {
    assert.strictEqual(
      mapStatus('open', [{ name: 'WIP' }]),
      'inprogress',
    );
  });

  test('open issue with "review" label maps to review', () => {
    assert.strictEqual(
      mapStatus('open', [{ name: 'Review' }]),
      'review',
    );
  });

  test('open issue with "needs review" label maps to review', () => {
    assert.strictEqual(
      mapStatus('open', [{ name: 'Needs Review' }]),
      'review',
    );
  });

  // ── mapIssue ───────────────────────────────────────────────────────

  test('mapIssue produces correct id format', () => {
    const task = mapIssue(fakeIssue({ number: 123 }));
    assert.strictEqual(task.id, 'github:123');
    assert.strictEqual(task.providerId, 'github');
  });

  test('mapIssue uses empty string for null body', () => {
    const task = mapIssue(fakeIssue({ body: null }));
    assert.strictEqual(task.body, '');
  });

  test('mapIssue maps labels to string array', () => {
    const task = mapIssue(fakeIssue({ labels: [{ name: 'bug' }, { name: 'P1' }] }));
    assert.deepStrictEqual(task.labels, ['bug', 'P1']);
  });

  test('mapIssue extracts assignee login', () => {
    const task = mapIssue(fakeIssue({ assignee: { login: 'octocat' } }));
    assert.strictEqual(task.assignee, 'octocat');
  });

  test('mapIssue assignee is undefined when null', () => {
    const task = mapIssue(fakeIssue({ assignee: null }));
    assert.strictEqual(task.assignee, undefined);
  });
});
