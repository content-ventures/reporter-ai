import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionDetail, auditInstant, itemContext, itemLabel, lastSeen } from './audit-format.ts';
import {
  auditFilter,
  auditFilterCount,
  DEFAULT_AUDIT_PARAMS,
  parseAuditParams,
  patchAuditParams,
  serializeAuditParams,
} from './audit-params.ts';

const parse = (query: string) => parseAuditParams(new URLSearchParams(query));

describe('Logs URL state', () => {
  it('a clean address is the default view', () => {
    assert.deepEqual(parse(''), DEFAULT_AUDIT_PARAMS);
    assert.equal(serializeAuditParams(DEFAULT_AUDIT_PARAMS), '');
  });

  it('round-trips every filter, the order, the page and the open event', () => {
    const query = 'from=2026-10-01&to=2026-10-07&person=person-pedro&type=access&result=denied&q=aurora&sort=oldest&page=2&size=50&event=aud-s-0012';
    const params = parse(query);
    assert.equal(params.type, 'access');
    assert.equal(params.result, 'denied');
    assert.equal(serializeAuditParams(params), query);
  });

  it('falls back on anything malformed and swaps an inverted period', () => {
    const params = parse('type=nada&result=talvez&size=7&page=-1&person=<x>&from=2026-10-07&to=2026-10-01&event=../x');
    assert.equal(params.type, null);
    assert.equal(params.result, null);
    assert.equal(params.size, 25);
    assert.equal(params.page, 1);
    assert.equal(params.person, null);
    assert.equal(params.event, null);
    assert.deepEqual([params.from, params.to], ['2026-10-01', '2026-10-07']);
  });

  it('a new filter goes back to page 1; opening an event keeps the page', () => {
    const onPage3 = { ...DEFAULT_AUDIT_PARAMS, page: 3 };
    assert.equal(patchAuditParams(onPage3, { result: 'failure' }).page, 1);
    assert.equal(patchAuditParams(onPage3, { event: 'aud-s-0001' }).page, 3);
    assert.equal(patchAuditParams(onPage3, { page: 4 }).page, 4);
  });

  it('builds the port filter (local day boundaries, one value per filter) and counts the band', () => {
    const params = parse('from=2026-10-01&to=2026-10-07&person=person-pedro&type=session&result=failure&q=%20senha%20');
    const filter = auditFilter(params);
    assert.deepEqual(filter.actorIds, ['person-pedro']);
    assert.deepEqual(filter.types, ['session']);
    assert.deepEqual(filter.results, ['failure']);
    assert.equal(filter.search, 'senha');
    assert.ok(filter.from && filter.to && filter.from < filter.to);
    assert.equal(auditFilterCount(params), 4);
    assert.deepEqual(auditFilter(DEFAULT_AUDIT_PARAMS), { sort: 'newest' });
  });
});

describe('Logs text', () => {
  const entry = {
    result: 'success' as const,
    type: 'article' as const,
    target: { kind: 'version' as const, id: 'ver-4', label: 'Artigo v4', productionId: 'prod-1', pieceKind: 'article' as const },
    productionTitle: 'Aurora Calçados: app de reposição',
    origin: { channel: 'web' as const },
  };

  it('says why a denial or failure happened, else which fields changed', () => {
    assert.equal(actionDetail({ result: 'denied', reason: 'Somente administradores consultam os logs.' }), 'Somente administradores consultam os logs.');
    assert.equal(
      actionDetail({ result: 'success', changes: [{ field: 'Título', before: 'a', after: 'b' }, { field: 'Seções', before: '3', after: '2' }, { field: 'Extensão', before: 'x', after: 'y' }] }),
      'Título · Seções +1',
    );
    assert.equal(actionDetail({ result: 'success' }), undefined);
  });

  it('names the record and its production (current title)', () => {
    assert.equal(itemLabel(entry), 'Artigo v4');
    assert.equal(itemContext(entry), 'Aurora Calçados: app de reposição');
    assert.equal(itemLabel({ ...entry, target: { kind: 'production', id: 'prod-1', label: 'Título antigo', productionId: 'prod-1' }, productionTitle: 'Título novo' }), 'Título novo');
    const signIn = { type: 'session' as const, target: undefined, origin: { channel: 'web' as const, device: 'Chrome · macOS', ip: '189.6.•••.•••' } };
    assert.equal(itemLabel(signIn), 'Chrome · macOS', 'a sign-in shows where it came from');
    assert.equal(itemContext(signIn), '189.6.•••.•••');
    assert.equal(itemContext({ ...signIn, origin: { channel: 'web' as const } }), 'Login e sessão');
    assert.equal(itemContext({ ...entry, productionTitle: undefined }), 'Produção removida');
  });

  it('reads the latest denial or failure in pt-BR', () => {
    assert.equal(lastSeen('há 2 h', 'm'), 'Último há 2 h');
    assert.equal(lastSeen('ontem', 'f'), 'Última ontem');
    assert.equal(lastSeen('12 out', 'm'), 'Último em 12 out');
    assert.equal(lastSeen('', 'm'), undefined);
    assert.match(auditInstant('2026-10-07T15:04:05.000Z'), /^07\/10\/2026 às \d{2}:04:05$/);
  });
});
