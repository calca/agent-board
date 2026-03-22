import * as assert from 'assert';
import { formatError } from '../../utils/errorUtils';

suite('formatError', () => {
  test('extracts message from Error instance', () => {
    assert.strictEqual(formatError(new Error('boom')), 'boom');
  });

  test('returns string values as-is', () => {
    assert.strictEqual(formatError('plain string'), 'plain string');
  });

  test('converts numbers to string', () => {
    assert.strictEqual(formatError(42), '42');
  });

  test('converts null to string', () => {
    assert.strictEqual(formatError(null), 'null');
  });

  test('converts undefined to string', () => {
    assert.strictEqual(formatError(undefined), 'undefined');
  });

  test('converts objects to string', () => {
    assert.strictEqual(formatError({ code: 500 }), '[object Object]');
  });

  test('handles TypeError subclass', () => {
    assert.strictEqual(formatError(new TypeError('bad type')), 'bad type');
  });
});
