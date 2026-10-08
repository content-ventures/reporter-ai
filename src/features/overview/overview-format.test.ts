import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decimal, durationFigure, durationText, parseRange } from './overview-format.ts';

describe('overview format', () => {
  test('range comes from the URL with 7 days as the default', () => {
    assert.equal(parseRange('30d'), '30d');
    assert.equal(parseRange('7d'), '7d');
    assert.equal(parseRange(null), '7d');
    assert.equal(parseRange('90d'), '7d');
  });

  test('durations use pt-BR decimals and never show -0,0', () => {
    assert.equal(decimal(4.11), '4,1');
    assert.equal(decimal(-0.01), '0,0');
    assert.deepEqual(durationFigure(14_798_868), { value: '4,1', unit: 'h' });
    assert.deepEqual(durationFigure(3_473_145), { value: '58', unit: 'min' });
    assert.deepEqual(durationFigure(10_000), { value: '1', unit: 'min' });
    assert.equal(durationText(16_212_893), '4,5 h');
  });
});
