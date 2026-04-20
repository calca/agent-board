import * as assert from 'assert';
import {
    canRetry,
    computeAvailableSlots,
    DEFAULT_ACTIVE_COLUMN,
    DEFAULT_AUTO_SQUAD_INTERVAL,
    DEFAULT_COOLDOWN_MS,
    DEFAULT_DONE_COLUMN,
    DEFAULT_MAX_RETRIES,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_SESSION_TIMEOUT,
    DEFAULT_SOURCE_COLUMN,
    isTimedOut,
    resolveSquadConfig,
} from '../../genai-provider/squadUtils';
import { KanbanTask } from '../../types/KanbanTask';

suite('SquadManager (computeAvailableSlots)', () => {
  test('all slots available when no active sessions', () => {
    assert.strictEqual(computeAvailableSlots(0, 10), 10);
  });

  test('partial slots available', () => {
    assert.strictEqual(computeAvailableSlots(3, 10), 7);
  });

  test('no slots available when at max', () => {
    assert.strictEqual(computeAvailableSlots(10, 10), 0);
  });

  test('no slots available when over max', () => {
    assert.strictEqual(computeAvailableSlots(12, 10), 0);
  });

  test('works with custom max', () => {
    assert.strictEqual(computeAvailableSlots(2, 5), 3);
  });

  test('single slot available', () => {
    assert.strictEqual(computeAvailableSlots(9, 10), 1);
  });

  test('zero max sessions returns zero', () => {
    assert.strictEqual(computeAvailableSlots(0, 0), 0);
  });
});

suite('SquadManager constants', () => {
  test('DEFAULT_MAX_SESSIONS is 10', () => {
    assert.strictEqual(DEFAULT_MAX_SESSIONS, 10);
  });

  test('DEFAULT_SOURCE_COLUMN is todo', () => {
    assert.strictEqual(DEFAULT_SOURCE_COLUMN, 'todo');
  });

  test('DEFAULT_ACTIVE_COLUMN is inprogress', () => {
    assert.strictEqual(DEFAULT_ACTIVE_COLUMN, 'inprogress');
  });

  test('DEFAULT_DONE_COLUMN is review', () => {
    assert.strictEqual(DEFAULT_DONE_COLUMN, 'review');
  });

  test('DEFAULT_AUTO_SQUAD_INTERVAL is 15000', () => {
    assert.strictEqual(DEFAULT_AUTO_SQUAD_INTERVAL, 15_000);
  });

  test('DEFAULT_MAX_RETRIES is 0', () => {
    assert.strictEqual(DEFAULT_MAX_RETRIES, 0);
  });

  test('DEFAULT_SESSION_TIMEOUT is 300000', () => {
    assert.strictEqual(DEFAULT_SESSION_TIMEOUT, 300_000);
  });

  test('DEFAULT_COOLDOWN_MS is 1000', () => {
    assert.strictEqual(DEFAULT_COOLDOWN_MS, 1000);
  });
});

suite('SquadStatus shape', () => {
  test('SquadStatus has correct fields', () => {
    const status = {
      activeCount: 3,
      maxSessions: 10,
      autoSquadEnabled: false,
    };
    assert.strictEqual(status.activeCount, 3);
    assert.strictEqual(status.maxSessions, 10);
    assert.strictEqual(status.autoSquadEnabled, false);
  });

  test('SquadStatus with auto-squad enabled', () => {
    const status = {
      activeCount: 5,
      maxSessions: 10,
      autoSquadEnabled: true,
    };
    assert.strictEqual(status.autoSquadEnabled, true);
  });
});

suite('CopilotSessionInfo shape', () => {
  test('idle session', () => {
    const session = { state: 'idle' as const };
    assert.strictEqual(session.state, 'idle');
  });

  test('running session with all fields', () => {
    const session = {
      state: 'running' as const,
      providerId: 'github-cloud',
      sessionUrl: 'vscode://session/123',
      githubCloudUrl: 'https://copilot.github.com/session/123',
      startedAt: '2026-01-01T00:00:00Z',
    };
    assert.strictEqual(session.state, 'running');
    assert.strictEqual(session.providerId, 'github-cloud');
    assert.strictEqual(session.sessionUrl, 'vscode://session/123');
    assert.strictEqual(session.githubCloudUrl, 'https://copilot.github.com/session/123');
    assert.strictEqual(session.startedAt, '2026-01-01T00:00:00Z');
  });

  test('completed session', () => {
    const session = {
      state: 'completed' as const,
      providerId: 'vscode-chat',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:05:00Z',
    };
    assert.strictEqual(session.state, 'completed');
    assert.ok(session.finishedAt);
  });

  test('failed session', () => {
    const session = {
      state: 'failed' as const,
      providerId: 'custom',
      finishedAt: '2026-01-01T00:01:00Z',
    };
    assert.strictEqual(session.state, 'failed');
  });
});

suite('KanbanTask with copilotSession', () => {
  test('task without copilot session', () => {
    const task: KanbanTask = {
      id: 'github:42',
      nativeId: '42',
      title: 'Test task',
      body: 'Description',
      status: 'todo',
      labels: [],
      providerId: 'github',
      meta: {},
    };
    assert.strictEqual(task.copilotSession, undefined);
  });

  test('task with copilot session', () => {
    const task: KanbanTask = {
      id: 'github:42',
      nativeId: '42',
      title: 'Test task',
      body: 'Description',
      status: 'inprogress',
      labels: ['wip'],
      providerId: 'github',
      meta: {},
      copilotSession: {
        state: 'running',
        providerId: 'github-cloud',
        sessionUrl: 'vscode://session/abc',
      },
    };
    assert.strictEqual(task.copilotSession?.state, 'running');
    assert.strictEqual(task.copilotSession?.providerId, 'github-cloud');
    assert.strictEqual(task.copilotSession?.sessionUrl, 'vscode://session/abc');
  });
});

suite('Squad Message Types', () => {
  test('HostToWebView squadStatus shape', () => {
    const msg = {
      type: 'squadStatus' as const,
      status: {
        activeCount: 2,
        maxSessions: 10,
        autoSquadEnabled: true,
      },
    };
    assert.strictEqual(msg.type, 'squadStatus');
    assert.strictEqual(msg.status.activeCount, 2);
    assert.strictEqual(msg.status.maxSessions, 10);
    assert.strictEqual(msg.status.autoSquadEnabled, true);
  });

  test('WebViewToHost startSquad shape', () => {
    const msg = { type: 'startSquad' as const };
    assert.strictEqual(msg.type, 'startSquad');
  });

  test('WebViewToHost toggleAutoSquad shape', () => {
    const msg = { type: 'toggleAutoSquad' as const };
    assert.strictEqual(msg.type, 'toggleAutoSquad');
  });
});

suite('ProjectConfigData squad/notifications', () => {
  test('squad config is optional', () => {
    const cfg = {} as Record<string, unknown>;
    assert.strictEqual(cfg.squad, undefined);
  });

  test('squad config with maxSessions', () => {
    const cfg = { squad: { maxSessions: 5 } };
    assert.strictEqual(cfg.squad.maxSessions, 5);
  });

  test('squad config with column overrides', () => {
    const cfg = {
      squad: {
        maxSessions: 5,
        sourceColumn: 'backlog',
        activeColumn: 'doing',
        doneColumn: 'done',
      },
    };
    assert.strictEqual(cfg.squad.sourceColumn, 'backlog');
    assert.strictEqual(cfg.squad.activeColumn, 'doing');
    assert.strictEqual(cfg.squad.doneColumn, 'done');
  });

  test('notifications config is optional', () => {
    const cfg = {} as Record<string, unknown>;
    assert.strictEqual(cfg.notifications, undefined);
  });

  test('full config with squad', () => {
    const cfg = {
      github: { owner: 'calca', repo: 'agent-board' },
      squad: { maxSessions: 8 },
    };
    assert.strictEqual(cfg.squad.maxSessions, 8);
  });

  test('squad config with new autonomy settings', () => {
    const cfg = {
      squad: {
        maxSessions: 5,
        autoSquadInterval: 30000,
        maxRetries: 3,
        sessionTimeout: 600000,
      },
    };
    assert.strictEqual(cfg.squad.autoSquadInterval, 30000);
    assert.strictEqual(cfg.squad.maxRetries, 3);
    assert.strictEqual(cfg.squad.sessionTimeout, 600000);
  });

  test('squad config with cooldown', () => {
    const cfg = {
      squad: {
        maxSessions: 5,
        cooldownMs: 2000,
      },
    };
    assert.strictEqual(cfg.squad.cooldownMs, 2000);
  });
});

suite('canRetry', () => {
  test('returns false when maxRetries is 0', () => {
    assert.strictEqual(canRetry(0, 0), false);
  });

  test('returns false when maxRetries is 0 regardless of attempt', () => {
    assert.strictEqual(canRetry(5, 0), false);
  });

  test('returns true when attempt is below maxRetries', () => {
    assert.strictEqual(canRetry(1, 3), true);
  });

  test('returns true for first attempt with maxRetries > 0', () => {
    assert.strictEqual(canRetry(0, 1), true);
  });

  test('returns false when attempt equals maxRetries', () => {
    assert.strictEqual(canRetry(3, 3), false);
  });

  test('returns false when attempt exceeds maxRetries', () => {
    assert.strictEqual(canRetry(5, 3), false);
  });

  test('returns true for maxRetries of 1 and attempt 0', () => {
    assert.strictEqual(canRetry(0, 1), true);
  });

  test('returns false for maxRetries of 1 and attempt 1', () => {
    assert.strictEqual(canRetry(1, 1), false);
  });
});

suite('isTimedOut', () => {
  test('returns false when timeout is 0 (disabled)', () => {
    const startedAt = new Date(Date.now() - 600_000).toISOString();
    assert.strictEqual(isTimedOut(startedAt, 0), false);
  });

  test('returns false when timeout is negative (disabled)', () => {
    const startedAt = new Date(Date.now() - 600_000).toISOString();
    assert.strictEqual(isTimedOut(startedAt, -1), false);
  });

  test('returns false when elapsed time is less than timeout', () => {
    const now = new Date('2026-01-01T00:10:00Z');
    const startedAt = '2026-01-01T00:05:00Z'; // 5 minutes ago
    assert.strictEqual(isTimedOut(startedAt, 600_000, now), false); // 10 min timeout
  });

  test('returns true when elapsed time equals timeout', () => {
    const now = new Date('2026-01-01T00:10:00Z');
    const startedAt = '2026-01-01T00:05:00Z'; // 5 minutes ago
    assert.strictEqual(isTimedOut(startedAt, 300_000, now), true); // 5 min timeout
  });

  test('returns true when elapsed time exceeds timeout', () => {
    const now = new Date('2026-01-01T01:00:00Z');
    const startedAt = '2026-01-01T00:00:00Z'; // 1 hour ago
    assert.strictEqual(isTimedOut(startedAt, 300_000, now), true); // 5 min timeout
  });

  test('works with recently started session', () => {
    const now = new Date('2026-01-01T00:00:01Z');
    const startedAt = '2026-01-01T00:00:00Z'; // 1 second ago
    assert.strictEqual(isTimedOut(startedAt, 300_000, now), false);
  });
});

suite('resolveSquadConfig', () => {
  test('returns all defaults when called with no arguments', () => {
    const cfg = resolveSquadConfig();
    assert.strictEqual(cfg.maxSessions, DEFAULT_MAX_SESSIONS);
    assert.strictEqual(cfg.sourceColumn, DEFAULT_SOURCE_COLUMN);
    assert.strictEqual(cfg.activeColumn, DEFAULT_ACTIVE_COLUMN);
    assert.strictEqual(cfg.doneColumn, DEFAULT_DONE_COLUMN);
    assert.strictEqual(cfg.autoSquadInterval, DEFAULT_AUTO_SQUAD_INTERVAL);
    assert.strictEqual(cfg.maxRetries, DEFAULT_MAX_RETRIES);
    assert.strictEqual(cfg.sessionTimeout, DEFAULT_SESSION_TIMEOUT);
    assert.strictEqual(cfg.cooldownMs, DEFAULT_COOLDOWN_MS);
  });

  test('overrides individual squad values', () => {
    const cfg = resolveSquadConfig({ maxSessions: 5, maxRetries: 3 });
    assert.strictEqual(cfg.maxSessions, 5);
    assert.strictEqual(cfg.maxRetries, 3);
    // defaults preserved
    assert.strictEqual(cfg.sourceColumn, DEFAULT_SOURCE_COLUMN);
  });

  test('custom column names are supported', () => {
    const cfg = resolveSquadConfig({
      sourceColumn: 'backlog',
      activeColumn: 'doing',
      doneColumn: 'shipped',
    });
    assert.strictEqual(cfg.sourceColumn, 'backlog');
    assert.strictEqual(cfg.activeColumn, 'doing');
    assert.strictEqual(cfg.doneColumn, 'shipped');
  });
});
