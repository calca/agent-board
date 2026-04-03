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
    const states: SessionState[] = ['idle', 'starting', 'running', 'paused', 'done', 'error'];
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
    assert.strictEqual(badgeIcon('done'), 'check');
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

  test('maps done to completed', () => {
    assert.strictEqual(mapStateToCopilot('done'), 'completed');
  });

  test('maps error to failed', () => {
    assert.strictEqual(mapStateToCopilot('error'), 'failed');
  });

  // ── isActive ──────────────────────────────────────────────────────

  test('isActive returns true for starting/running/paused', () => {
    assert.strictEqual(isActive('starting'), true);
    assert.strictEqual(isActive('running'), true);
    assert.strictEqual(isActive('paused'), true);
  });

  test('isActive returns false for idle/done/error', () => {
    assert.strictEqual(isActive('idle'), false);
    assert.strictEqual(isActive('done'), false);
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

  test('toCopilotSessionInfo maps done to completed', () => {
    const session: PersistedSession = {
      taskId: 't:2',
      state: 'done',
      providerId: 'cloud',
      finishedAt: '2024-06-01T12:00:00Z',
    };
    assert.strictEqual(toCopilotSessionInfo(session).state, 'completed');
  });

  // ── fixInterruptedSessions ────────────────────────────────────────

  test('marks running sessions as error', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:1', state: 'running', providerId: 'chat', startedAt: '2024-01-01T00:00:00Z' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'error');
    assert.ok(fixed[0].finishedAt);
  });

  test('marks starting sessions as error', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:2', state: 'starting', providerId: 'cloud' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'error');
  });

  test('leaves done sessions unchanged', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:3', state: 'done', providerId: 'chat', finishedAt: '2024-01-01T01:00:00Z' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'done');
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
      { taskId: 't:b', state: 'done', providerId: 'cloud' },
      { taskId: 't:c', state: 'starting', providerId: 'chat' },
      { taskId: 't:d', state: 'paused', providerId: 'cloud' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'error');
    assert.strictEqual(fixed[1].state, 'done');
    assert.strictEqual(fixed[2].state, 'error');
    assert.strictEqual(fixed[3].state, 'paused');
  });

  test('does not mutate original array', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:x', state: 'running', providerId: 'chat' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(sessions[0].state, 'running');
    assert.strictEqual(fixed[0].state, 'error');
  });
});
