import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paragraphBlock } from '../../domain/article.ts';
import type { VersionRef } from '../../domain/refs.ts';
import { approvedArticle, approvePiece, createSample, sampleArticle, sampleCarousel, unwrap, withPorts, writeDraft } from './fixture.ts';
import type { PortsFactory, PortsUnderTest } from './fixture.ts';

/**
 * ProductionCommands + ProductionQueries contract, part 2: gates (REQ-1.3, REQ-T.6), restore,
 * derivatives, coherent export (REQ-1.6), suggestions and runs.
 */

async function carouselApprovedFrom(ports: PortsUnderTest, productionId: string, from: VersionRef): Promise<{ pieceId: string; carousel: VersionRef }> {
  const derived = unwrap(await ports.commands.derive({ productionId, kind: 'carousel', from, templateId: ports.carouselTemplateId }), 'derive');
  await writeDraft(ports, derived.pieceId, sampleCarousel(ports.carouselTemplateId));
  return { pieceId: derived.pieceId, carousel: await approvePiece(ports, derived.pieceId) };
}

export function reviewPortsContract(name: string, make: PortsFactory): void {
  describe(`${name} · review and delivery contract`, () => {
    it('sends the exact version to review and queues it for the approver', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const requested = unwrap(await ports.commands.requestReview(sample.articleId, 'Pode revisar?'));
        assert.equal(requested.created, true);
        assert.equal(requested.version.number, 1);
        const again = await ports.commands.requestReview(sample.articleId);
        assert.equal(again.ok, false);
        if (!again.ok) assert.equal(again.refusal.code, 'already_requested');

        const detail = unwrap(await ports.queries.get(sample.productionId));
        assert.equal(detail.pieces[0].status, 'in_review');
        assert.equal((await ports.queries.list({ tab: 'in_review' })).total, 1);

        await ports.actAs(ports.people.approver);
        const overview = await ports.queries.overview('7d');
        const item = overview.awaitingYou.find((entry) => entry.pieceId === sample.articleId);
        assert.equal(item?.reason, 'review');
        assert.equal(item?.from?.id, ports.people.editor);
        assert.equal(item?.note, 'Pode revisar?');
        const review = unwrap(await ports.queries.review(sample.articleId));
        assert.equal(review.version.id, requested.version.id);
        assert.equal(review.guards.approve.allowed, true);
        assert.ok(review.evidence.length > 0 && review.evidence.every((entry) => entry.status === 'used'));
      }));

    it('refuses a decision on a hash that differs from the version on screen, changing nothing', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const { version } = unwrap(await ports.commands.requestReview(sample.articleId));
        await ports.actAs(ports.people.approver);
        const before = unwrap(await ports.queries.get(sample.productionId));
        const activityBefore = await ports.queries.activity();

        const tampered = await ports.commands.decide({ pieceId: sample.articleId, subject: { ...version.ref, hash: 'tampered' }, decision: 'approved' });
        assert.equal(tampered.ok, false);
        if (!tampered.ok) assert.equal(tampered.refusal.code, 'hash_mismatch');
        const onScreen = await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'approved', displayedHash: 'older' });
        assert.equal(onScreen.ok, false);
        if (!onScreen.ok) assert.equal(onScreen.refusal.code, 'hash_mismatch');

        assert.deepEqual(unwrap(await ports.queries.get(sample.productionId)), before, 'refused decisions leave no trace');
        assert.deepEqual(await ports.queries.activity(), activityBefore);
      }));

    it('requires a note to return a version and keeps its anchors', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const { version } = unwrap(await ports.commands.requestReview(sample.articleId));
        await ports.actAs(ports.people.approver);
        const bare = await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'changes_requested', note: '  ' });
        assert.equal(bare.ok, false);
        if (!bare.ok) assert.equal(bare.refusal.code, 'note_required');
        const anchors = [{ blockId: 'b-intro', from: 0, to: 12, excerpt: 'Doze famílias' }];
        const returned = unwrap(
          await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'changes_requested', note: 'Cite a fonte do número.', anchors }),
        );
        assert.equal(returned.by, ports.people.approver);
        assert.deepEqual(returned.anchors, anchors);
        assert.equal(unwrap(await ports.queries.get(sample.productionId)).pieces[0].status, 'changes_requested');

        await ports.actAs(ports.people.editor);
        const awaiting = (await ports.queries.overview('7d')).awaitingYou.find((entry) => entry.pieceId === sample.articleId);
        assert.equal(awaiting?.reason, 'changes_requested');
        assert.equal(awaiting?.note, 'Cite a fonte do número.');
      }));

    it('lets only gate roles decide', async (context) => {
      await withPorts(make, async (ports) => {
        const editorOnly = ports.people.editorOnly;
        if (!editorOnly) {
          context.skip('adapter has no editor-only member');
          return;
        }
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const { version } = unwrap(await ports.commands.requestReview(sample.articleId));
        await ports.actAs(editorOnly);
        const detail = unwrap(await ports.queries.get(sample.productionId));
        assert.equal(detail.guards.pieces.article?.approve.allowed, false);
        const refused = await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'approved' });
        assert.equal(refused.ok, false);
        if (!refused.ok) assert.equal(refused.refusal.code, 'forbidden_role');
      });
    });

    it('restores as a new version and never touches decisions', () =>
      withPorts(make, async (ports) => {
        const { articleId, productionId, sourceId, article } = await approvedArticle(ports);
        await writeDraft(ports, articleId, await sampleArticle(ports, sourceId, 1));
        unwrap(await ports.commands.createVersion(articleId));
        const decisionsBefore = unwrap(await ports.queries.review(articleId, article.versionId)).decisions;
        assert.equal(unwrap(await ports.queries.get(productionId)).guards.pieces.article?.requestReview.allowed, true);

        const restored = unwrap(await ports.commands.restoreVersion(articleId, article.versionId)).version;
        assert.equal(restored.number, 3);
        assert.equal(restored.origin, 'restore');
        assert.equal(restored.ref.hash, article.hash, 'a restore reproduces the exact content');
        assert.equal(restored.decision, undefined, 'the copy needs its own approval');
        assert.deepEqual(unwrap(await ports.queries.review(articleId, article.versionId)).decisions, decisionsBefore);
        const piece = unwrap(await ports.queries.get(productionId)).pieces[0];
        assert.equal(piece.approvedVersion?.id, article.versionId);
      }));

    it('refuses to resend an unchanged, already approved version', () =>
      withPorts(make, async (ports) => {
        const { articleId, productionId } = await approvedArticle(ports);
        const guard = unwrap(await ports.queries.get(productionId)).guards.pieces.article?.requestReview;
        assert.equal(guard?.allowed, false);
        const again = await ports.commands.requestReview(articleId);
        assert.equal(again.ok, false);
        if (!again.ok) assert.equal(again.refusal.code, 'already_approved');
      }));

    it('derives only from the exact, latest approved parent version', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const v1 = unwrap(await ports.commands.createVersion(sample.articleId)).version.ref;
        const early = await ports.commands.derive({ productionId: sample.productionId, kind: 'carousel', from: v1, templateId: ports.carouselTemplateId });
        assert.equal(early.ok, false);
        if (!early.ok) assert.equal(early.refusal.code, 'parent_not_approved');
        assert.equal(unwrap(await ports.queries.get(sample.productionId)).guards.derive.carousel?.allowed, false);

        const approved = await approvePiece(ports, sample.articleId);
        const tampered = await ports.commands.derive({ productionId: sample.productionId, kind: 'carousel', from: { ...approved, hash: 'x' } });
        assert.equal(tampered.ok, false);
        if (!tampered.ok) assert.equal(tampered.refusal.code, 'hash_mismatch');
        const guard = unwrap(await ports.queries.get(sample.productionId)).guards.derive.carousel;
        assert.equal(guard?.allowed, true);
        assert.deepEqual(guard?.from, approved);

        const derived = unwrap(await ports.commands.derive({ productionId: sample.productionId, kind: 'carousel', from: approved, templateId: ports.carouselTemplateId }));
        assert.equal(derived.created, true);
        assert.deepEqual(unwrap(await ports.queries.draft(derived.pieceId)).inputs, [approved]);
        const twice = await ports.commands.derive({ productionId: sample.productionId, kind: 'carousel', from: approved });
        assert.equal(twice.ok, false);
        if (!twice.ok) assert.equal(twice.refusal.code, 'already_derived');
      }));

    it('refuses a package that mixes versions and offers the consistent one', () =>
      withPorts(make, async (ports) => {
        const { articleId, productionId, sourceId, article } = await approvedArticle(ports);
        const { pieceId: carouselId, carousel } = await carouselApprovedFrom(ports, productionId, article);

        const coherent = unwrap(await ports.queries.delivery(productionId));
        assert.equal(coherent.result.ok, true);
        assert.ok(coherent.files.some((file) => file.fileName === 'artigo-v1.md'));
        assert.ok(coherent.files.some((file) => file.kind === 'manifest'));
        assert.equal(coherent.manifest?.items.length, 2);

        await writeDraft(ports, articleId, await sampleArticle(ports, sourceId, 1));
        const v2 = await approvePiece(ports, articleId);
        const mixed = unwrap(await ports.queries.delivery(productionId));
        assert.equal(mixed.result.ok, false);
        if (!mixed.result.ok) assert.equal(mixed.result.refusal.code, 'mixed_versions');
        assert.deepEqual(
          mixed.alternatives.exportWithParent?.selection.map((ref) => ref.versionId).sort(),
          [article.versionId, carousel.versionId].sort(),
        );
        assert.equal(mixed.alternatives.updateDerivative?.pieceId, carouselId);
        const detail = unwrap(await ports.queries.get(productionId));
        assert.equal(detail.pieces.find((piece) => piece.kind === 'carousel')?.status, 'stale');
        assert.ok(detail.pieces.find((piece) => piece.kind === 'carousel')?.versions.length, 'stale content is never deleted');

        const refused = await ports.commands.recordDelivery({
          productionId,
          selection: [v2, carousel],
          files: [{ fileName: 'artigo-v2.md', format: 'md', versionId: v2.versionId, ok: true }],
        });
        assert.equal(refused.ok, false);
        if (!refused.ok) assert.equal(refused.refusal.code, 'mixed_versions');

        const selection = mixed.alternatives.exportWithParent?.selection ?? [];
        const preview = unwrap(await ports.queries.delivery(productionId, { selection }));
        assert.equal(preview.result.ok, true);
        const delivery = unwrap(
          await ports.commands.recordDelivery({
            productionId,
            selection,
            files: preview.files.map((file) => ({ fileName: file.fileName, format: file.format, ...(file.versionId ? { versionId: file.versionId } : {}), ok: true })),
          }),
        );
        assert.equal(delivery.status, 'completed');
      }));

    it('records deliveries idempotently per package, keeping every attempt', () =>
      withPorts(make, async (ports) => {
        const { productionId, article } = await approvedArticle(ports);
        const { carousel } = await carouselApprovedFrom(ports, productionId, article);
        const view = unwrap(await ports.queries.delivery(productionId));
        const files = view.files.map((file) => ({ fileName: file.fileName, format: file.format, ...(file.versionId ? { versionId: file.versionId } : {}), ok: true }));
        const failing = files.map((file, index) => (index === 0 ? { ...file, ok: false, error: { code: 'render', message: 'Falhou' } } : file));

        const partial = unwrap(await ports.commands.recordDelivery({ productionId, selection: [article, carousel], files: failing }));
        assert.equal(partial.status, 'partial');
        assert.equal(unwrap(await ports.queries.get(productionId)).status, 'approved');
        await ports.advance(1_000);
        const retried = unwrap(await ports.commands.recordDelivery({ productionId, selection: [article, carousel], files: [files[0]] }));
        assert.equal(retried.id, partial.id, 'same package, same delivery');
        assert.equal(retried.status, 'completed');
        assert.ok(retried.attempts.length > partial.attempts.length);
        const detail = unwrap(await ports.queries.get(productionId));
        assert.equal(detail.status, 'completed');
        assert.equal(unwrap(await ports.queries.delivery(productionId)).delivered, true);
      }));

    it('applies a suggestion as one change, and marks it stale when the target changed', async (context) => {
      await withPorts(make, async (ports) => {
        const suggest = ports.simulate?.suggestion;
        if (!suggest) {
          context.skip('adapter cannot create suggestions directly');
          return;
        }
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const target = [{ blockId: 'b-q1', from: 0, to: 13 }];
        const first = await suggest(sample.articleId, { target, proposal: { kind: 'replace-text', text: 'O torrador' }, label: 'Mais direto' });
        const applied = unwrap(await ports.commands.decideSuggestion(first, 'accept'));
        assert.equal(applied.outcome, 'applied');
        const draft = unwrap(await ports.queries.draft(sample.articleId));
        assert.equal(draft.revision, applied.revision);
        assert.ok(draft.body.type === 'article' && JSON.stringify(draft.body.blocks).includes('O torrador'));
        const repeat = await ports.commands.decideSuggestion(first, 'accept');
        assert.equal(repeat.ok, false);

        const second = await suggest(sample.articleId, { target: [{ blockId: 'b-intro', from: 0, to: 4 }], proposal: { kind: 'replace-text', text: 'Treze' } });
        const edited = await sampleArticle(ports, sample.sourceId);
        edited.blocks[0] = paragraphBlock('b-intro', 'Quinze famílias venderam juntas.');
        await writeDraft(ports, sample.articleId, edited);
        const stale = unwrap(await ports.commands.decideSuggestion(second, 'accept'));
        assert.equal(stale.outcome, 'stale');
        const discarded = await suggest(sample.articleId, { target, proposal: { kind: 'title', text: 'Outro título' } });
        assert.equal(unwrap(await ports.commands.decideSuggestion(discarded, 'discard', { vote: 'down' })).outcome, 'discarded');
      });
    });

    it('blocks decisions and new versions while a run is in progress', async (context) => {
      await withPorts(make, async (ports) => {
        const startRun = ports.simulate?.activeRun;
        if (!startRun) {
          context.skip('adapter cannot start runs directly');
          return;
        }
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const { version } = unwrap(await ports.commands.requestReview(sample.articleId));
        const finish = await startRun(sample.articleId);
        await ports.actAs(ports.people.approver);
        const refused = await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'approved' });
        assert.equal(refused.ok, false);
        if (!refused.ok) assert.equal(refused.refusal.code, 'run_in_progress');
        const guard = unwrap(await ports.queries.review(sample.articleId)).guards.approve;
        assert.equal(guard.allowed, false);
        await ports.actAs(ports.people.editor);
        const save = await ports.commands.createVersion(sample.articleId);
        assert.equal(save.ok, false);
        const listed = (await ports.queries.list()).items.find((item) => item.id === sample.productionId);
        assert.ok(listed?.liveRun, 'the list shows the live run');
        await finish();
      });
    });
  });
}
