import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paragraphBlock } from '../../domain/article.ts';
import type { ChangeNotice } from '../common.ts';
import {
  CONTRACT_TRANSCRIPT,
  createSample,
  firstNameOf,
  newProductionInput,
  sampleArticle,
  sampleCarousel,
  unwrap,
  withPorts,
  writeDraft,
} from './fixture.ts';
import type { PortsFactory } from './fixture.ts';

/**
 * ProductionCommands + ProductionQueries contract, part 1: creation, drafts, versions, list,
 * activity, notifications, archive, feedback. Any adapter (local simulation, Supabase…) must pass.
 */

export function productionPortsContract(name: string, make: PortsFactory): void {
  describe(`${name} · production ports contract`, () => {
    it('creates a blank owned article without a transcript or generation and resumes in the studio', () =>
      withPorts(make, async (ports) => {
        const created = unwrap(await ports.commands.createBlank({ title: 'Artigo sem título', brief: { size: 'standard', sections: 3 } }));
        const detail = unwrap(await ports.queries.get(created.productionId));
        assert.equal(detail.flowId, 'writing-article');
        assert.equal(detail.ownerId, ports.people.editor);
        assert.deepEqual(detail.plan, ['article']);
        assert.deepEqual(detail.sources, []);
        assert.deepEqual(detail.runs, []);
        assert.deepEqual(detail.stages.map((stage) => stage.id), ['article', 'approval', 'delivery']);
        assert.equal(detail.currentStageId, 'article');
        assert.equal(detail.nextStep?.kind, 'continue');
        assert.deepEqual(detail.nextStep?.target, { kind: 'studio', pieceKind: 'article' });
        assert.deepEqual(unwrap(await ports.queries.draft(created.pieceId)).body, { type: 'article', title: '', blocks: [] });
        assert.deepEqual((await ports.queries.activity({ productionId: created.productionId })).items.map((item) => item.type), ['production.created']);
        assert.equal(detail.guards.pieces.article?.generate.allowed, false, 'manual creation never invents source material for the AI');
      }));

    it('refuses invalid or unauthorised blank article creation atomically', () =>
      withPorts(make, async (ports) => {
        const before = await ports.queries.list();
        for (const [input, code] of [
          [{ title: ' ', brief: { size: 'standard', sections: 3 } }, 'empty_title'],
          [{ title: 'Nova história', brief: { size: 'standard', sections: 9 } }, 'sections_out_of_range'],
        ] as const) {
          const result = await ports.commands.createBlank(input);
          assert.ok(!result.ok && result.refusal.code === code);
        }
        await ports.actAs(ports.people.approver);
        const forbidden = await ports.commands.createBlank({ title: 'Nova história', brief: { size: 'standard', sections: 3 } });
        assert.ok(!forbidden.ok && forbidden.refusal.code === 'forbidden');
        assert.deepEqual(await ports.queries.list(), before);
        assert.equal((await ports.queries.activity()).total, 0);
      }));

    it('autosaves manual text and reuses the existing version and approval workflow', () =>
      withPorts(make, async (ports) => {
        const created = unwrap(await ports.commands.createBlank({ title: 'Uma praça para o bairro', brief: { size: 'standard', sections: 3 } }));
        const draft = unwrap(await ports.queries.draft(created.pieceId));
        const body = { type: 'article' as const, title: 'Uma praça para o bairro', blocks: [paragraphBlock('manual-paragraph', 'A praça reúne moradores que cuidam dos jardins e dos espaços de leitura. '.repeat(35).trim())] };
        unwrap(await ports.commands.saveDraft(created.pieceId, body, draft.revision));
        assert.deepEqual(unwrap(await ports.queries.draft(created.pieceId)).body, body);
        const requested = unwrap(await ports.commands.requestReview(created.pieceId, { assigneeId: ports.people.approver }));
        const version = unwrap(await ports.queries.version(requested.version.id));
        assert.deepEqual(version.body, body);
        assert.deepEqual(version.sources, []);
        await ports.actAs(ports.people.approver);
        unwrap(await ports.commands.decide({ pieceId: created.pieceId, subject: requested.version.ref, decision: 'approved' }));
        const approved = unwrap(await ports.queries.get(created.productionId));
        assert.equal(approved.status, 'approved');
        assert.equal(approved.currentStageId, 'delivery');
        assert.equal(approved.guards.export.allowed, true);
        assert.deepEqual(approved.sources, []);
        assert.deepEqual(approved.runs, []);
      }));

    it('creates a production from material and saves the source before any run', () =>
      withPorts(make, async (ports) => {
        const analysis = unwrap(await ports.ingest.analyze(CONTRACT_TRANSCRIPT), 'analyze');
        assert.equal(analysis.duplicate, undefined);
        const sample = await createSample(ports, {
          speakers: [{ label: 'Helena Duarte', newPerson: { name: 'Helena Duarte', title: 'presidente da Vale Verde' } }],
        });

        const detail = unwrap(await ports.queries.get(sample.productionId), 'get');
        assert.equal(detail.sources[0]?.id, sample.sourceId);
        assert.ok(detail.sources[0].words > 0);
        assert.deepEqual(detail.runs, [], 'creating never starts a run');
        assert.equal(detail.pieces.find((piece) => piece.kind === 'article')?.status, 'not_started');
        assert.equal(detail.currentStageId, 'article');
        const carousel = detail.stages.find((stage) => stage.id === 'carousel');
        assert.equal(carousel?.state, 'blocked');
        assert.ok(carousel?.blockedReason);
        assert.ok(detail.participants.some((participant) => participant.person?.name === 'Helena Duarte'));

        const source = unwrap(await ports.queries.source(sample.sourceId), 'source');
        assert.equal(source.version.hash, analysis.hash, 'saved source hash equals the analysed material');
        assert.equal(source.version.content.segments.length, analysis.segments.length);

        const again = unwrap(await ports.ingest.analyze(CONTRACT_TRANSCRIPT), 'analyze again');
        assert.equal(again.duplicate?.sourceId, sample.sourceId);
        assert.ok(again.duplicate?.productions.some((production) => production.id === sample.productionId));
        assert.ok((await ports.queries.people()).some((person) => person.name === 'Helena Duarte'));
      }));

    it('refuses invalid productions without leaving a trace', () =>
      withPorts(make, async (ports) => {
        const before = await ports.queries.list();
        const attempts = [
          [newProductionInput({ title: '   ' }), 'empty_title'],
          [newProductionInput({ plan: ['carousel'] }), 'article_required'],
          [newProductionInput({ brief: { sections: 9, size: 'standard' } }), 'sections_out_of_range'],
          [newProductionInput({ brief: { sections: 4, size: 'short' } }), 'sections_out_of_range'],
          [newProductionInput({ brief: { sections: 3, size: 'long' as never } }), 'unknown_size'],
          [newProductionInput({ material: { text: ' \n ', origin: 'interview', authorized: true } }), 'empty_material'],
        ] as const;
        for (const [input, code] of attempts) {
          const result = await ports.commands.createFromSource(input);
          assert.equal(result.ok, false);
          if (!result.ok) assert.equal(result.refusal.code, code);
        }
        assert.deepEqual(await ports.queries.list(), before);
        assert.equal((await ports.queries.activity()).total, 0);
      }));

    it('keeps generation blocked until the material is authorised', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports, { material: { text: CONTRACT_TRANSCRIPT, origin: 'interview', authorized: false } });
        let detail = unwrap(await ports.queries.get(sample.productionId));
        const generate = detail.guards.pieces.article?.generate;
        assert.equal(generate?.allowed, false);
        if (generate && !generate.allowed) assert.equal(generate.code, 'source_not_authorized');
        assert.equal(detail.nextAction.kind, 'authorize');

        unwrap(await ports.commands.setMaterialAuthorization(sample.sourceId, true));
        detail = unwrap(await ports.queries.get(sample.productionId));
        assert.equal(detail.guards.pieces.article?.generate.allowed, true);
      }));

    it('autosaves into one draft slot and refuses a stale baseRevision', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        const body = await sampleArticle(ports, sample.sourceId);
        const start = unwrap(await ports.queries.draft(sample.articleId));
        const saved = unwrap(await ports.commands.saveDraft(sample.articleId, body, start.revision));
        assert.ok(saved.revision > start.revision);
        assert.equal(saved.persisted, true);

        const stale = await ports.commands.saveDraft(sample.articleId, await sampleArticle(ports, sample.sourceId, 1), start.revision);
        assert.equal(stale.ok, false);
        if (!stale.ok) assert.equal(stale.refusal.code, 'conflict');
        const draft = unwrap(await ports.queries.draft(sample.articleId));
        assert.deepEqual(draft.body, body, 'a conflict never overwrites');
        assert.equal(draft.revision, saved.revision);

        const mismatch = await ports.commands.saveDraft(sample.articleId, sampleCarousel(ports.carouselTemplateId), draft.revision);
        assert.equal(mismatch.ok, false);
        if (!mismatch.ok) assert.equal(mismatch.refusal.code, 'kind_mismatch');

        body.title = 'mutated after save';
        const kept = unwrap(await ports.queries.draft(sample.articleId)).body;
        assert.ok(kept.type === 'article' && kept.title !== 'mutated after save', 'the adapter keeps its own copy');
        const types = (await ports.queries.activity({ productionId: sample.productionId })).items.map((item) => item.type);
        assert.ok(!types.some((type) => type.startsWith('version') || type.startsWith('draft')), 'autosave is not activity');
      }));

    it('freezes versions in order and refuses an unchanged draft', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        const first = await sampleArticle(ports, sample.sourceId);
        await writeDraft(ports, sample.articleId, first);
        const v1 = unwrap(await ports.commands.createVersion(sample.articleId)).version;
        assert.equal(v1.number, 1);
        const unchanged = await ports.commands.createVersion(sample.articleId);
        assert.equal(unchanged.ok, false);
        if (!unchanged.ok) assert.equal(unchanged.refusal.code, 'unchanged');

        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId, 2));
        assert.equal(unwrap(await ports.queries.draft(sample.articleId)).dirty, true);
        const v2 = unwrap(await ports.commands.createVersion(sample.articleId)).version;
        assert.equal(v2.number, 2);
        assert.equal(unwrap(await ports.queries.draft(sample.articleId)).dirty, false);

        const stored = unwrap(await ports.queries.version(v1.id));
        assert.deepEqual(stored.body, first, 'versions are immutable');
        assert.equal(stored.hash, v1.ref.hash);
        const versions = unwrap(await ports.queries.get(sample.productionId)).pieces[0].versions.map((version) => version.number);
        assert.deepEqual(versions, [1, 2]);
        const compare = unwrap(await ports.queries.compare(sample.articleId, v1.id, v2.id));
        assert.ok(compare.summary.modified + compare.summary.added + compare.summary.removed > 0);
      }));

    it('lists by last activity with filters, tab counts and clamped pages', () =>
      withPorts(make, async (ports) => {
        const a = await createSample(ports, { title: 'Alfa: feira de cafés' });
        await ports.advance(60_000);
        const b = await createSample(ports, { title: 'Beta: festival de inverno' });
        await ports.advance(60_000);
        const c = await createSample(ports, { title: 'Gama: oficina de barismo' });
        await ports.advance(60_000);
        await writeDraft(ports, a.articleId, await sampleArticle(ports, a.sourceId));

        const all = await ports.queries.list();
        assert.deepEqual(all.items.map((item) => item.id), [a.productionId, c.productionId, b.productionId]);
        assert.equal(all.counts.all, 3);
        assert.equal(all.counts.editing, 3);
        assert.equal(all.items[0].owner.id, ports.people.editor);

        const first = await ports.queries.list({}, { page: 1, size: 2 });
        assert.equal(first.pageCount, 2);
        assert.equal(first.items.length, 2);
        const clamped = await ports.queries.list({}, { page: 99, size: 2 });
        assert.equal(clamped.page, 2);
        assert.deepEqual(clamped.items.map((item) => item.id), [b.productionId]);

        const search = await ports.queries.list({ search: 'FESTIVAL' });
        assert.deepEqual(search.items.map((item) => item.id), [b.productionId]);
        const byParticipant = await ports.queries.list({ search: 'helena' });
        assert.equal(byParticipant.total, 3);
        const review = await ports.queries.list({ tab: 'in_review' });
        assert.equal(review.total, 0);
        assert.equal(review.counts.all, 3);
      }));

    it('sorts by urgency and says where each production stands ("Situação") and what the viewer does next', () =>
      withPorts(make, async (ports) => {
        const approverName = await firstNameOf(ports, ports.people.approver);
        const fresh = await createSample(ports, { title: 'Alfa: sem texto' });
        await ports.advance(60_000);
        const draft = await createSample(ports, { title: 'Beta: rascunho' });
        await writeDraft(ports, draft.articleId, await sampleArticle(ports, draft.sourceId));
        await ports.advance(60_000);
        const sent = await createSample(ports, { title: 'Gama: enviada' });
        await writeDraft(ports, sent.articleId, await sampleArticle(ports, sent.sourceId));
        unwrap(await ports.commands.requestReview(sent.articleId, { assigneeId: ports.people.approver }));
        await ports.advance(60_000);
        const returned = await createSample(ports, { title: 'Delta: devolvida' });
        await writeDraft(ports, returned.articleId, await sampleArticle(ports, returned.sourceId));
        const { version } = unwrap(await ports.commands.requestReview(returned.articleId, { assigneeId: ports.people.approver }));
        await ports.actAs(ports.people.approver);
        unwrap(await ports.commands.decide({ pieceId: returned.articleId, subject: version.ref, decision: 'changes_requested', note: 'Cite a fonte do número.' }));
        await ports.actAs(ports.people.editor);
        await ports.advance(60_000);
        const unauthorized = await createSample(ports, { title: 'Épsilon: sem autorização', material: { text: CONTRACT_TRANSCRIPT, origin: 'interview', authorized: false } });

        const byUrgency = await ports.queries.list({ sort: 'urgency' });
        assert.deepEqual(
          byUrgency.items.map((item) => [item.title.split(':')[0], item.situation.line, item.nextStep?.label ?? null, item.urgency]),
          [
            ['Delta', `Artigo · Ajustes solicitados por ${approverName}`, 'Ajustar', 1],
            ['Gama', `Artigo · Aguardando aprovação de ${approverName}`, null, 2],
            ['Épsilon', 'Material · Falta autorização', 'Autorizar', 3],
            ['Beta', 'Artigo · Rascunho', 'Continuar', 6],
            ['Alfa', 'Artigo · Não iniciado', 'Montar estrutura', 6],
          ],
        );
        assert.deepEqual(byUrgency.items.find((item) => item.id === fresh.productionId)?.nextStep?.target, { kind: 'structure' });
        assert.deepEqual(byUrgency.items.find((item) => item.id === unauthorized.productionId)?.situation.status, 'unauthorized');
        assert.equal(byUrgency.items.find((item) => item.id === sent.productionId)?.situation.withPersonId, ports.people.approver);
        assert.equal((await ports.queries.list()).items[0].id, unauthorized.productionId, 'the default order is still the latest activity');

        await ports.actAs(ports.people.approver);
        const approverView = await ports.queries.list({ sort: 'urgency' });
        const step = (productionId: string) => approverView.items.find((item) => item.id === productionId)?.nextStep;
        assert.deepEqual(step(sent.productionId), { kind: 'review', label: 'Revisar', target: { kind: 'review', pieceKind: 'article' }, mine: true });
        assert.equal(step(draft.productionId)?.kind, 'open', 'an approver reads drafts, never edits them');
        assert.equal(step(returned.productionId)?.kind, 'open');
      }));

    it('logs only semantic activity, newest first, with readable lines', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await ports.advance(1_000);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        await ports.advance(1_000);
        unwrap(await ports.commands.createVersion(sample.articleId));
        const page = await ports.queries.activity({ productionId: sample.productionId });
        const types = page.items.map((item) => item.type);
        assert.equal(types[0], 'version.created');
        assert.equal(types[types.length - 1], 'production.created');
        for (let index = 1; index < page.items.length; index += 1) {
          assert.ok(Date.parse(page.items[index - 1].at) >= Date.parse(page.items[index].at));
        }
        assert.ok(page.items.every((item) => item.summary.length > 0));
        assert.equal(page.items[0].actor?.id, ports.people.editor);
      }));

    it('notifies subscribers after each accepted command and stops after unsubscribe', () =>
      withPorts(make, async (ports) => {
        const notices: ChangeNotice[] = [];
        const unsubscribe = ports.queries.subscribe((notice) => notices.push(notice));
        const sample = await createSample(ports);
        assert.ok(notices.some((notice) => notice.productionIds.includes(sample.productionId)));
        const count = notices.length;
        await ports.commands.saveDraft(sample.articleId, await sampleArticle(ports, sample.sourceId), -1);
        assert.equal(notices.length, count, 'a refused command does not notify');
        unsubscribe();
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        assert.equal(notices.length, count);
      }));

    it('resolves unknown ids as not_found', () =>
      withPorts(make, async (ports) => {
        const lookups = [
          await ports.queries.get('missing'),
          await ports.queries.draft('missing'),
          await ports.queries.version('missing'),
          await ports.queries.source('missing'),
          await ports.queries.review('missing'),
          await ports.queries.delivery('missing'),
          await ports.queries.compare('missing', 'a', 'b'),
        ];
        for (const lookup of lookups) {
          assert.equal(lookup.ok, false);
          if (!lookup.ok) assert.equal(lookup.refusal.code, 'not_found');
        }
        const save = await ports.commands.saveDraft('missing', { type: 'article', title: '', blocks: [] }, 0);
        assert.equal(save.ok, false);
      }));

    it('archives out of the default tab and blocks further archiving', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await createSample(ports, { title: 'Outra produção' });
        assert.equal(unwrap(await ports.commands.archive([sample.productionId])).archived, 1);
        const list = await ports.queries.list();
        assert.equal(list.counts.all, 1);
        assert.equal(list.counts.archived, 1);
        assert.ok(!list.items.some((item) => item.id === sample.productionId));
        const detail = unwrap(await ports.queries.get(sample.productionId));
        assert.equal(detail.status, 'archived');
        assert.equal(detail.guards.archive.allowed, false);
        const unknown = await ports.commands.archive(['missing']);
        assert.equal(unknown.ok, false);
      }));

    it('records feedback (REQ-T.8) and refuses an empty one', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        const target = { kind: 'production' as const, productionId: sample.productionId };
        const empty = await ports.commands.recordFeedback({ target });
        assert.equal(empty.ok, false);
        if (!empty.ok) assert.equal(empty.refusal.code, 'empty_feedback');
        const entry = unwrap(await ports.commands.recordFeedback({ target, rating: 'mixed', note: '  Faltou contexto.  ' }));
        assert.equal(entry.note, 'Faltou contexto.');
        assert.equal(entry.by, ports.people.editor);
        await ports.advance(1_000);
        unwrap(await ports.feedback.record({ target, rating: 'positive' }));
        const listed = await ports.feedback.list({ productionId: sample.productionId });
        assert.deepEqual(listed.map((item) => item.rating), ['positive', 'mixed']);
      }));
  });
}
