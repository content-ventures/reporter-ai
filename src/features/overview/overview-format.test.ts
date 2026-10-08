import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  axisNumber,
  countDelta,
  dayLabel,
  dayTitle,
  decimal,
  durationDelta,
  durationFigure,
  liveExcerpt,
  parseRange,
  percentFigure,
  pointsDelta,
  rhythmLabels,
  sparklineOf,
  weeklyTicks,
} from './overview-format.ts';

describe('overview format', () => {
  test('range comes from the URL with 7 days as the default', () => {
    assert.equal(parseRange('30d'), '30d');
    assert.equal(parseRange('7d'), '7d');
    assert.equal(parseRange(null), '7d');
    assert.equal(parseRange('90d'), '7d');
  });

  test('figures use pt-BR decimals and never show -0,0', () => {
    assert.equal(decimal(4.11), '4,1');
    assert.equal(decimal(-0.01), '0,0');
    assert.deepEqual(durationFigure(14_798_868), { value: '4,1', unit: 'h' });
    assert.deepEqual(durationFigure(3_473_145), { value: '58', unit: 'min' });
    assert.deepEqual(durationFigure(10_000), { value: '1', unit: 'min' });
    assert.equal(percentFigure(0.7747), '77,5');
  });

  test('approvals delta reads as more or fewer than the previous window', () => {
    assert.deepEqual(countDelta(-1, 'worse', 7), { value: '1', trend: 'down', tone: 'bad', label: '1 a menos que nos 7 dias anteriores' });
    assert.equal(countDelta(14, 'better', 30)?.label, '14 a mais que nos 30 dias anteriores');
    assert.equal(countDelta(0, 'flat', 7)?.tone, 'flat');
    assert.equal(countDelta(null, 'unknown', 7), undefined);
  });

  test('time to approval falling is good news', () => {
    const delta = durationDelta(-3_473_145, 'better', 7);
    assert.deepEqual(delta, { value: '58 min', trend: 'down', tone: 'good', label: '58 min mais rápido que nos 7 dias anteriores' });
    assert.equal(durationDelta(7_200_000, 'worse', 7)?.label, '2,0 h mais lento que nos 7 dias anteriores');
  });

  test('AI retention changes in percentage points', () => {
    assert.deepEqual(pointsDelta(-0.0027, 'worse', 7), { value: '0,3 p.p.', trend: 'down', tone: 'bad', label: '0,3 p.p. abaixo dos 7 dias anteriores' });
    assert.equal(pointsDelta(0.0774, 'better', 30)?.value, '7,7 p.p.');
    assert.equal(pointsDelta(0.0001, 'better', 7)?.trend, 'flat');
  });

  test('rhythm axis: weekdays for 7 days, dates for 30, weekly ticks ending today', () => {
    const wednesday = new Date(2026, 9, 7, 15, 0).toISOString();
    assert.equal(dayLabel(wednesday, '7d'), 'qua');
    assert.equal(dayLabel(wednesday, '30d'), '07/10');
    assert.equal(dayTitle(wednesday), '07/10 · quarta');
    assert.equal(weeklyTicks(7), undefined);
    assert.deepEqual(weeklyTicks(30), [1, 8, 15, 22, 29]);
    assert.equal(axisNumber(2.5), '2,5');
    assert.equal(axisNumber(3), '3');
  });

  test('rhythm labels end on "Hoje"', () => {
    const days = [6, 5, 4, 3, 2, 1, 0].map((back) => ({ dayEnd: new Date(2026, 9, 7 - back, 15, 0).toISOString() }));
    assert.deepEqual(rhythmLabels(days, '7d'), ['qui', 'sex', 'sáb', 'dom', 'seg', 'ter', 'Hoje']);
    assert.deepEqual(rhythmLabels(days.slice(0, 2), '30d'), ['01/10', 'Hoje']);
    assert.deepEqual(rhythmLabels([], '7d'), []);
  });

  test('KPI sparkline skips days without a sample and reads first → last', () => {
    assert.deepEqual(sparklineOf([12, 13, null, 14], 7, String), { points: [12, 13, 14], label: 'De 12 para 14 nos últimos 7 dias' });
    assert.equal(sparklineOf([null, null, 3], 7, String), undefined, 'one point draws nothing');
    assert.equal(sparklineOf(undefined, 30, String), undefined);
    assert.equal(sparklineOf([0.7, 0.775], 30, (value) => `${percentFigure(value)}%`)?.label, 'De 70,0% para 77,5% nos últimos 30 dias');
  });

  test('live excerpt keeps the newest words', () => {
    assert.equal(liveExcerpt('  Texto curto  '), 'Texto curto');
    const long = 'O couro curtido ao vegetal virou argumento de venda quando a rastreabilidade chegou ao cliente europeu, contou Clara durante a entrevista.';
    const excerpt = liveExcerpt(long, 60);
    assert.ok(excerpt.startsWith('…'));
    assert.ok(excerpt.endsWith('entrevista.'));
    assert.ok(excerpt.length <= 61);
  });
});
