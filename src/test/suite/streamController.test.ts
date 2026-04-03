import * as assert from 'assert';
import { DEFAULT_MAX_LINES, StreamController, StreamRegistry } from '../../stream/StreamController';

suite('StreamController', () => {
  test('append stores lines', () => {
    const sc = new StreamController();
    sc.append('line1\nline2');
    assert.strictEqual(sc.lineCount, 2);
    assert.strictEqual(sc.exportLog(), 'line1\nline2');
    sc.dispose();
  });

  test('exportLog returns all lines', () => {
    const sc = new StreamController();
    sc.append('a');
    sc.append('b');
    assert.strictEqual(sc.exportLog(), 'a\nb');
    sc.dispose();
  });

  test('circular buffer trims oldest lines', () => {
    const sc = new StreamController(3);
    sc.append('1\n2\n3\n4');
    // 4 lines but max is 3, oldest ("1") trimmed
    assert.strictEqual(sc.lineCount, 3);
    assert.strictEqual(sc.exportLog(), '2\n3\n4');
    sc.dispose();
  });

  test('clear empties the buffer', () => {
    const sc = new StreamController();
    sc.append('foo');
    sc.clear();
    assert.strictEqual(sc.lineCount, 0);
    assert.strictEqual(sc.exportLog(), '');
    sc.dispose();
  });

  test('onDidAppend fires with appended text', () => {
    const sc = new StreamController();
    const received: string[] = [];
    sc.onDidAppend(text => received.push(text));
    sc.append('hello');
    assert.deepStrictEqual(received, ['hello']);
    sc.dispose();
  });

  test('DEFAULT_MAX_LINES is 10000', () => {
    assert.strictEqual(DEFAULT_MAX_LINES, 10_000);
  });
});

suite('StreamRegistry', () => {
  test('getOrCreate returns the same controller for same id', () => {
    const reg = new StreamRegistry();
    const c1 = reg.getOrCreate('s1');
    const c2 = reg.getOrCreate('s1');
    assert.strictEqual(c1, c2);
    reg.dispose();
  });

  test('get returns undefined for unknown id', () => {
    const reg = new StreamRegistry();
    assert.strictEqual(reg.get('unknown'), undefined);
    reg.dispose();
  });

  test('remove disposes and deletes controller', () => {
    const reg = new StreamRegistry();
    reg.getOrCreate('s1');
    reg.remove('s1');
    assert.strictEqual(reg.get('s1'), undefined);
    reg.dispose();
  });

  test('sessionIds lists all tracked sessions', () => {
    const reg = new StreamRegistry();
    reg.getOrCreate('a');
    reg.getOrCreate('b');
    assert.deepStrictEqual(reg.sessionIds.sort(), ['a', 'b']);
    reg.dispose();
  });

  test('dispose clears all controllers', () => {
    const reg = new StreamRegistry();
    reg.getOrCreate('x');
    reg.dispose();
    assert.deepStrictEqual(reg.sessionIds, []);
  });
});
