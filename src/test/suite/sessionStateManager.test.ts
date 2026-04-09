import * as assert from 'assert';
import {
    badgeColor,
    badgeIcon,
    fixInterruptedSessions,
    isActive,
    mapStateToCopilot,
    PersistedSession,
    SessionState,
    toCopilotSessionInfo,
} from '../../copilot/sessionStateUtils';

suite('SessionStateManager (pure utils)', () => {

  // ── badgeColor ────────────────────────────────────────────────────

  test('badgeColor returns different colors per state', () => {
    const states: SessionState[] = ['idle', 'starting', 'running', 'paused', 'completed', 'error'];
    const colors = states.map(s => badgeColor(s));
    for (const c of colors) {
      assert.ok(c.length > 0);
    }
    assert.notStrictEqual(badgeColor('running'), badgeColor('error'));
  });

  test('badgeColor running is green', () => {
    assert.strictEqual(badgeColor('running'), 'charts.green');
  });

  test('badgeColor error is red', () => {
    assert.strictEqual(badgeColor('error'), 'charts.red');
  });

  // ── badgeIcon ─────────────────────────────────────────────────────

  test('badgeIcon returns correct icons', () => {
    assert.strictEqual(badgeIcon('running'), 'play-circle');
    assert.strictEqual(badgeIcon('error'), 'error');
    assert.strictEqual(badgeIcon('completed'), 'check');
    assert.strictEqual(badgeIcon('paused'), 'debug-pause');
    assert.strictEqual(badgeIcon('starting'), 'loading~spin');
    assert.strictEqual(badgeIcon('idle'), 'circle-outline');
  });

  // ── mapStateToCopilot ─────────────────────────────────────────────

  test('maps idle to idle', () => {
    assert.strictEqual(mapStateToCopilot('idle'), 'idle');
  });

  test('maps starting/running/paused to running', () => {
    assert.strictEqual(mapStateToCopilot('starting'), 'running');
    assert.strictEqual(mapStateToCopilot('running'), 'running');
    assert.strictEqual(mapStateToCopilot('paused'), 'running');
  });

  test('maps completed to completed', () => {
    assert.strictEqual(mapStateToCopilot('completed'), 'completed');
  });

  test('maps error to error', () => {
    assert.strictEqual(mapStateToCopilot('error'), 'error');
  });

  // ── isActive ──────────────────────────────────────────────────────

  test('isActive returns true for starting/running/paused', () => {
    assert.strictEqual(isActive('starting'), true);
    assert.strictEqual(isActive('running'), true);
    assert.strictEqual(isActive('paused'), true);
  });

  test('isActive returns false for idle/completed/error', () => {
    assert.strictEqual(isActive('idle'), false);
    assert.strictEqual(isActive('completed'), false);
    assert.strictEqual(isActive('error'), false);
  });

  // ── toCopilotSessionInfo ──────────────────────────────────────────

  test('toCopilotSessionInfo maps fields correctly', () => {
    const session: PersistedSession = {
      taskId: 't:1',
      state: 'running',
      providerId: 'chat',
      startedAt: '2024-01-01T00:00:00Z',
    };
    const info = toCopilotSessionInfo(session);
    assert.strictEqual(info.state, 'running');
    assert.strictEqual(info.providerId, 'chat');
    assert.strictEqual(info.startedAt, '2024-01-01T00:00:00Z');
    assert.strictEqual(info.finishedAt, undefined);
  });

  test('toCopilotSessionInfo maps completed state', () => {
    const session: PersistedSession = {
      taskId: 't:2',
      state: 'completed',
      providerId: 'cloud',
      finishedAt: '2024-06-01T12:00:00Z',
    };
    assert.strictEqual(toCopilotSessionInfo(session).state, 'completed');
  });

  // ── fixInterruptedSessions ────────────────────────────────────────

  test('marks running sessions as interrupted', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:1', state: 'running', providerId: 'chat', startedAt: '2024-01-01T00:00:00Z' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'interrupted');
    assert.ok(fixed[0].finishedAt);
  });

  test('marks starting sessions as interrupted', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:2', state: 'starting', providerId: 'cloud' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'interrupted');
  });

  test('leaves completed sessions unchanged', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:3', state: 'completed', providerId: 'chat', finishedAt: '2024-01-01T01:00:00Z' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'completed');
  });

  test('leaves error sessions unchanged', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:4', state: 'error', providerId: 'chat' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'error');
  });

  test('handles mixed sessions', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:a', state: 'running', providerId: 'chat' },
      { taskId: 't:b', state: 'completed', providerId: 'cloud' },
      { taskId: 't:c', state: 'starting', providerId: 'chat' },
      { taskId: 't:d', state: 'paused', providerId: 'cloud' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'interrupted');
    assert.strictEqual(fixed[1].state, 'completed');
    assert.strictEqual(fixed[2].state, 'interrupted');
    assert.strictEqual(fixed[3].state, 'interrupted');
  });

  test('does not mutate original array', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:x', state: 'running', providerId: 'chat' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(sessions[0].state, 'running');
    assert.strictEqual(fixed[0].state, 'interrupted');
  });
});
