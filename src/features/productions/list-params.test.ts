import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeFilterCount,
  dayBoundary,
  DEFAULT_LIST_PARAMS,
  listFilter,
  localDay,
  parseListParams,
  patchListParams,
  periodLabel,
  serializeListParams,
} from './list-params.ts';

const parse = (query: string) => parseListParams(new URLSearchParams(query));

describe('Produções URL state', () => {
  it('reads an empty URL as the defaults and writes the defaults as an empty query', () => {
    assert.deepEqual(parse(''), DEFAULT_LIST_PARAMS);
    assert.equal(serializeListParams(DEFAULT_LIST_PARAMS), '');
  });

  it('round-trips every field', () => {
    const query = 'status=in_review&q=lume&owner=p-clara&origin=interview&from=2026-10-01&to=2026-10-07&sort=updated_asc&page=2&size=25';
    const params = parse(query);
    assert.deepEqual(params, {
      tab: 'in_review',
      q: 'lume',
      page: 2,
      size: 25,
      owner: 'p-clara',
      origin: 'interview',
      from: '2026-10-01',
      to: '2026-10-07',
      sort: 'updated_asc',
    });
    assert.deepEqual(parse(serializeListParams(params)), params);
  });

  it('falls back to defaults for unknown or malformed values', () => {
    const params = parse('status=kanban&page=-3&size=7&origin=radio&from=2026-13-40&owner=%3Cscript%3E&sort=title');
    assert.equal(params.tab, 'all');
    assert.equal(params.page, 1);
    assert.equal(params.size, 10);
    assert.equal(params.origin, null);
    assert.equal(params.from, null);
    assert.equal(params.owner, null);
    assert.equal(params.sort, 'urgency');
  });

  it('sorts by urgency by default; the last activity is an explicit choice', () => {
    assert.equal(parse('').sort, 'urgency');
    assert.equal(parse('sort=urgency').sort, 'urgency');
    assert.equal(parse('sort=updated_desc').sort, 'updated_desc');
    assert.equal(serializeListParams({ ...DEFAULT_LIST_PARAMS, sort: 'urgency' }), '');
    assert.equal(serializeListParams({ ...DEFAULT_LIST_PARAMS, sort: 'updated_desc' }), 'sort=updated_desc');
  });

  it('swaps a reversed period', () => {
    const params = parse('from=2026-10-07&to=2026-10-01');
    assert.equal(params.from, '2026-10-01');
    assert.equal(params.to, '2026-10-07');
  });

  it('goes back to page 1 when what matches changes, but not when only the page changes', () => {
    const onPage3 = { ...DEFAULT_LIST_PARAMS, page: 3 };
    assert.equal(patchListParams(onPage3, { tab: 'approved' }).page, 1);
    assert.equal(patchListParams(onPage3, { q: 'aurora' }).page, 1);
    assert.equal(patchListParams(onPage3, { size: 25 }).page, 1);
    assert.equal(patchListParams(onPage3, { page: 4 }).page, 4);
    assert.equal(patchListParams(onPage3, { tab: 'all' }).page, 3, 'an unchanged value is not a change');
  });

  it('builds the port filter from the URL state', () => {
    const filter = listFilter({ ...DEFAULT_LIST_PARAMS, q: '  bella  ', owner: 'p-joao', origin: 'podcast', from: '2026-10-01', to: '2026-10-07' });
    assert.deepEqual(filter, {
      tab: 'all',
      sort: 'urgency',
      search: 'bella',
      ownerIds: ['p-joao'],
      origins: ['podcast'],
      updatedFrom: dayBoundary('2026-10-01', 'start'),
      updatedTo: dayBoundary('2026-10-07', 'end'),
    });
    assert.ok(Date.parse(filter.updatedTo ?? '') > Date.parse(filter.updatedFrom ?? ''));
    assert.deepEqual(listFilter(DEFAULT_LIST_PARAMS), { tab: 'all', sort: 'urgency' });
  });

  it('counts the band filters, not the tab or the search', () => {
    assert.equal(activeFilterCount({ ...DEFAULT_LIST_PARAMS, tab: 'approved', q: 'x' }), 0);
    assert.equal(activeFilterCount({ ...DEFAULT_LIST_PARAMS, owner: 'p-joao', from: '2026-10-01' }), 2);
  });

  it('labels periods in the contract format', () => {
    assert.equal(periodLabel('2026-10-05', '2026-10-31'), '05/10 – 31/10');
    assert.equal(periodLabel('2026-10-05', null), 'a partir de 05/10');
    assert.equal(periodLabel(null, '2026-10-31'), 'até 31/10');
    assert.equal(periodLabel('2026-10-05', '2026-10-05'), '05/10');
  });

  it('computes local calendar days', () => {
    const now = new Date(2026, 9, 7, 9, 30);
    assert.equal(localDay(now), '2026-10-07');
    assert.equal(localDay(now, 7), '2026-09-30');
  });
});
