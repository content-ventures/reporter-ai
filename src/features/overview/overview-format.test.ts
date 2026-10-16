import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { approvalBars, decimal, durationFigure, durationText, parseRange } from './overview-format.ts';

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

  test('approvals per day for 7 days and per 7-day stretch for 30, the last bar ending today', () => {
    const day = (offset: number, current: number) => ({ dayEnd: new Date(2026, 9, 16 - offset, 15).toISOString(), current });
    const week = [6, 5, 4, 3, 2, 1, 0].map((offset) => day(offset, offset % 2));
    assert.deepEqual(approvalBars(week, '7d').map((bar) => [bar.label, bar.approved]), [
      ['sáb', 0], ['dom', 1], ['seg', 0], ['ter', 1], ['qua', 0], ['qui', 1], ['sex', 0],
    ]);
    assert.equal(approvalBars(week, '7d').at(-1)?.title, 'sexta · 16/10');
    const month = Array.from({ length: 30 }, (_, index) => day(29 - index, 1));
    const bars = approvalBars(month, '30d');
    assert.deepEqual(bars.map((bar) => bar.approved), [2, 7, 7, 7, 7]);
    assert.deepEqual(bars.at(-1), { label: '10/10', title: '10/10 a 16/10', approved: 7 });
    assert.equal(bars[0]?.title, '17/09 a 18/09');
  });
});
