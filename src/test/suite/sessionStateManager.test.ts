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
} from '../../genai-provider/sessionStateUtils';

suite('SessionStateManager (pure utils)', () => {

  // ── badgeColor ────────────────────────────────────────────────────

  test('badgeColor returns different colors per state', () => {
    const states: SessionState[] = ['idle', 'starting', 'running', 'paused', 'completed', 'error', 'manual'];
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

  test('badgeColor manual is green', () => {
    assert.strictEqual(badgeColor('manual'), 'charts.green');
  });

  test('badgeIcon manual is person', () => {
    assert.strictEqual(badgeIcon('manual'), 'person');
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

  test('maps manual to manual', () => {
    assert.strictEqual(mapStateToCopilot('manual'), 'manual');
  });

  // ── isActive ──────────────────────────────────────────────────────

  test('isActive returns true for starting/running/paused/manual', () => {
    assert.strictEqual(isActive('starting'), true);
    assert.strictEqual(isActive('running'), true);
    assert.strictEqual(isActive('paused'), true);
    assert.strictEqual(isActive('manual'), true);
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
      providerId: 'vscode-chat',
      startedAt: '2024-01-01T00:00:00Z',
    };
    const info = toCopilotSessionInfo(session);
    assert.strictEqual(info.state, 'running');
    assert.strictEqual(info.providerId, 'vscode-chat');
    assert.strictEqual(info.startedAt, '2024-01-01T00:00:00Z');
    assert.strictEqual(info.finishedAt, undefined);
  });

  test('toCopilotSessionInfo maps completed state', () => {
    const session: PersistedSession = {
      taskId: 't:2',
      state: 'completed',
      providerId: 'github-cloud',
      finishedAt: '2024-06-01T12:00:00Z',
    };
    assert.strictEqual(toCopilotSessionInfo(session).state, 'completed');
  });

  // ── fixInterruptedSessions ────────────────────────────────────────

  test('marks running sessions as interrupted', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:1', state: 'running', providerId: 'vscode-chat', startedAt: '2024-01-01T00:00:00Z' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'interrupted');
    assert.ok(fixed[0].finishedAt);
  });

  test('marks starting sessions as interrupted', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:2', state: 'starting', providerId: 'github-cloud' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'interrupted');
  });

  test('leaves completed sessions unchanged', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:3', state: 'completed', providerId: 'vscode-chat', finishedAt: '2024-01-01T01:00:00Z' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'completed');
  });

  test('leaves error sessions unchanged', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:4', state: 'error', providerId: 'vscode-chat' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'error');
  });

  test('leaves manual sessions unchanged', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:5', state: 'manual', providerId: 'vscode-chat' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'manual');
  });

  test('handles mixed sessions', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:a', state: 'running', providerId: 'vscode-chat' },
      { taskId: 't:b', state: 'completed', providerId: 'github-cloud' },
      { taskId: 't:c', state: 'starting', providerId: 'vscode-chat' },
      { taskId: 't:d', state: 'paused', providerId: 'github-cloud' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(fixed[0].state, 'interrupted');
    assert.strictEqual(fixed[1].state, 'completed');
    assert.strictEqual(fixed[2].state, 'interrupted');
    assert.strictEqual(fixed[3].state, 'interrupted');
  });

  test('does not mutate original array', () => {
    const sessions: PersistedSession[] = [
      { taskId: 't:x', state: 'running', providerId: 'vscode-chat' },
    ];
    const fixed = fixInterruptedSessions(sessions);
    assert.strictEqual(sessions[0].state, 'running');
    assert.strictEqual(fixed[0].state, 'interrupted');
  });
});
