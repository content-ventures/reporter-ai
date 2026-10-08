import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paragraphBlock } from '../../domain/article.ts';
import type { VersionRef } from '../../domain/refs.ts';
import type { RequestReviewInput } from '../production-commands.ts';
import { approvedArticle, approvePiece, createSample, firstNameOf, localDay, sampleArticle, sampleCarousel, unwrap, withPorts, writeDraft } from './fixture.ts';
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
        const requested = unwrap(await ports.commands.requestReview(sample.articleId, { note: 'Pode revisar?' }));
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

    it('takes a pending send back ("Retirar envio"): only the sender or an admin, only while it waits', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const nothing = await ports.commands.withdrawReview(sample.articleId);
        assert.equal(!nothing.ok && nothing.refusal.code, 'not_awaiting');
        const { request } = unwrap(await ports.commands.requestReview(sample.articleId, { assigneeId: ports.people.approver, dueOn: '2099-12-31' }));
        assert.equal(request.assigneeId, ports.people.approver);
        assert.equal(request.dueOn, '2099-12-31');

        await ports.actAs(ports.people.approver);
        const notSender = await ports.commands.withdrawReview(sample.articleId);
        assert.equal(!notSender.ok && notSender.refusal.code, 'forbidden');

        await ports.actAs(ports.people.editor);
        const withdrawn = unwrap(await ports.commands.withdrawReview(sample.articleId));
        assert.equal(withdrawn.request.id, request.id);
        assert.ok(withdrawn.request.withdrawnAt);
        const detail = unwrap(await ports.queries.get(sample.productionId));
        assert.equal(detail.pieces[0].status, 'draft');
        assert.equal(detail.approvals.article?.locked, false);
        const again = unwrap(await ports.commands.requestReview(sample.articleId));
        assert.notEqual(again.request.id, request.id, 'sending again opens a new request');
        assert.equal(unwrap(await ports.queries.get(sample.productionId)).approvals.article?.state, 'awaiting');
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

    it('sends to "Quem aprova" with a "Recado" and "Para quando", and refuses an invalid send without a trace', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const approverName = await firstNameOf(ports, ports.people.approver);
        const before = unwrap(await ports.queries.get(sample.productionId)).approvals.article;
        assert.equal(before?.state, 'none');
        assert.equal(before?.send.guard.allowed, true);
        assert.deepEqual(before?.send.approvers.map((person) => person.id), [ports.people.approver], 'article approvers, never the sender');
        assert.equal(before?.send.suggestedAssigneeId, ports.people.approver, 'the only approver comes prefilled');
        assert.equal(before?.send.isResend, false);
        assert.equal(before?.viewer.canSend, true);

        const today = localDay(unwrap(await ports.queries.draft(sample.articleId)).updatedAt);
        const activityBefore = await ports.queries.activity();
        const refused = async (input: RequestReviewInput, code: string) => {
          const result = await ports.commands.requestReview(sample.articleId, input);
          assert.equal(result.ok ? 'sent' : result.refusal.code, code, JSON.stringify(input));
          return result.ok ? '' : result.refusal.message;
        };
        assert.equal(await refused({ assigneeId: 'person-nobody' }, 'unknown_assignee'), 'Pessoa não encontrada.');
        assert.equal(await refused({ assigneeId: ports.people.editor }, 'self_assign'), 'Escolha outra pessoa para aprovar.');
        if (ports.people.editorOnly) {
          const name = await firstNameOf(ports, ports.people.editorOnly);
          assert.equal(await refused({ assigneeId: ports.people.editorOnly }, 'assignee_cannot_approve'), `${name} não aprova esta peça.`);
        }
        assert.equal(await refused({ dueOn: '2000-01-01' }, 'invalid_due'), 'Escolha hoje ou uma data futura.');
        await refused({ dueOn: '31/12/2099' }, 'invalid_due');
        await refused({ dueOn: '2099-02-30' }, 'invalid_due');
        assert.deepEqual(await ports.queries.activity(), activityBefore, 'refused sends leave no trace');
        assert.equal(unwrap(await ports.queries.get(sample.productionId)).approvals.article?.requests.length, 0);

        const { request } = unwrap(await ports.commands.requestReview(sample.articleId, { assigneeId: ports.people.approver, note: '  Pode revisar hoje?  ', dueOn: today }));
        assert.equal(request.assigneeId, ports.people.approver);
        assert.equal(request.note, 'Pode revisar hoje?');
        assert.equal(request.dueOn, today);
        const detail = unwrap(await ports.queries.get(sample.productionId));
        const approval = detail.approvals.article;
        assert.equal(approval?.state, 'awaiting');
        assert.equal(approval?.locked, true);
        assert.equal(approval?.request?.assignee?.id, ports.people.approver);
        assert.equal(approval?.request?.due, 'today');
        assert.equal(approval?.request?.round, 1);
        assert.deepEqual(
          approval && { isRequester: approval.viewer.isRequester, canWithdraw: approval.viewer.canWithdraw, canDecide: approval.viewer.canDecide },
          { isRequester: true, canWithdraw: true, canDecide: false },
          'the sender withdraws, never decides',
        );
        assert.equal(approval?.send.guard.allowed, false, 'nothing to send while it waits');
        assert.equal(detail.situation.line, `Artigo · Aguardando aprovação de ${approverName}`);
        assert.equal(detail.stages.find((stage) => stage.id === 'approval')?.detail, `Com ${approverName}`);
        assert.equal(detail.nextStep, null, 'the sender waits: no button');
      }));

    it('locks the text while it waits: edits, versions, restores and accepted suggestions are refused', async (context) => {
      await withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const v1 = unwrap(await ports.commands.createVersion(sample.articleId)).version;
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId, 1));
        const discarded = ports.simulate?.suggestion
          ? await ports.simulate.suggestion(sample.articleId, { target: [{ blockId: 'b-q1', from: 0, to: 13 }], proposal: { kind: 'replace-text', text: 'O torrador' } })
          : undefined;
        if (discarded) unwrap(await ports.commands.decideSuggestion(discarded, 'discard'));
        unwrap(await ports.commands.requestReview(sample.articleId, { assigneeId: ports.people.approver }));
        const approverName = await firstNameOf(ports, ports.people.approver);
        const draft = unwrap(await ports.queries.draft(sample.articleId));

        const edit = await ports.commands.saveDraft(sample.articleId, await sampleArticle(ports, sample.sourceId, 2), draft.revision);
        assert.equal(edit.ok ? 'saved' : edit.refusal.code, 'locked');
        assert.equal(edit.ok ? '' : edit.refusal.message, `O texto está com ${approverName} para aprovação. Retire o envio para editar.`);
        assert.equal(unwrap(await ports.commands.saveDraft(sample.articleId, draft.body, draft.revision)).pieceId, sample.articleId, 'an autosave of the same text still goes through');
        const version = await ports.commands.createVersion(sample.articleId);
        assert.equal(version.ok ? 'saved' : version.refusal.code, 'locked');
        const restore = await ports.commands.restoreVersion(sample.articleId, v1.id);
        assert.equal(restore.ok ? 'restored' : restore.refusal.code, 'locked');
        if (discarded && ports.simulate?.suggestion) {
          const reopen = await ports.commands.decideSuggestion(discarded, 'restore');
          assert.equal(reopen.ok ? 'restored' : reopen.refusal.code, 'locked', 'reopening a suggestion would block the decision');
          const late = await ports.simulate.suggestion(sample.articleId, { target: [{ blockId: 'b-q1', from: 0, to: 13 }], proposal: { kind: 'replace-text', text: 'O torrador' } });
          const accept = await ports.commands.decideSuggestion(late, 'accept');
          assert.equal(accept.ok ? 'applied' : accept.refusal.code, 'locked');
          assert.equal(unwrap(await ports.commands.decideSuggestion(late, 'discard')).outcome, 'discarded', 'discarding leaves the text as it is');
        } else context.diagnostic('adapter cannot create suggestions directly: accept-while-locked not checked');

        await ports.actAs(ports.people.approver);
        const { request } = unwrap(await ports.queries.get(sample.productionId)).approvals.article ?? {};
        assert.ok(request);
        unwrap(await ports.commands.decide({ pieceId: sample.articleId, subject: request.version.ref, decision: 'changes_requested', note: 'Cite a fonte do número.' }));
        await ports.actAs(ports.people.editor);
        assert.equal(unwrap(await ports.queries.get(sample.productionId)).approvals.article?.locked, false, 'a decision unlocks the text');
        const fresh = unwrap(await ports.queries.draft(sample.articleId));
        assert.ok((await ports.commands.saveDraft(sample.articleId, await sampleArticle(ports, sample.sourceId, 3), fresh.revision)).ok);
      });
    });

    it('never lets the sender decide on their own send (two-person gate, admins included)', () =>
      withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
        const { version } = unwrap(await ports.commands.requestReview(sample.articleId));
        const review = unwrap(await ports.queries.review(sample.articleId));
        assert.equal(review.approval.viewer.canDecide, false);
        assert.equal(review.guards.approve.allowed ? 'allowed' : review.guards.approve.code, 'self_decision');
        const own = await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'approved', displayedHash: version.ref.hash });
        assert.equal(own.ok ? 'decided' : own.refusal.code, 'self_decision');
        assert.equal(own.ok ? '' : own.refusal.message, 'Quem enviou não aprova o próprio envio.');
        const returned = await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'changes_requested', note: 'Rever.' });
        assert.equal(returned.ok ? 'decided' : returned.refusal.code, 'self_decision');

        await ports.actAs(ports.people.approver);
        assert.equal(unwrap(await ports.queries.review(sample.articleId)).approval.viewer.canDecide, true);
        unwrap(await ports.commands.decide({ pieceId: sample.articleId, subject: version.ref, decision: 'approved', displayedHash: version.ref.hash }));
      }));

    it('keeps an approval when the text changes afterwards and asks to resend ("Aprovação desatualizada")', () =>
      withPorts(make, async (ports) => {
        const { articleId, productionId, sourceId, article } = await approvedArticle(ports);
        await writeDraft(ports, articleId, await sampleArticle(ports, sourceId, 1));
        const detail = unwrap(await ports.queries.get(productionId));
        assert.equal(detail.pieces[0].status, 'approval_outdated');
        assert.equal(detail.pieces[0].statusLabel, 'Aprovação desatualizada');
        assert.equal(detail.status, 'stale');
        assert.equal(detail.situation.line, 'Artigo · Aprovação desatualizada');
        assert.equal(detail.stages.find((stage) => stage.id === 'approval')?.detail, 'Aprovação desatualizada');
        const approval = detail.approvals.article;
        assert.equal(approval?.state, 'approval_outdated');
        assert.equal(approval?.approvedVersion?.id, article.versionId, 'carousel and delivery keep the approved version');
        assert.equal(approval?.send.guard.allowed, true, 'it can be sent again');
        assert.equal(approval?.send.isResend, true);
        assert.deepEqual(detail.guards.derive.carousel?.from, article, 'the carousel is still made from the approved version');
        assert.equal(detail.nextStep?.kind, 'resend');

        unwrap(await ports.commands.restoreVersion(articleId, article.versionId));
        const undone = unwrap(await ports.queries.get(productionId));
        assert.equal(undone.approvals.article?.state, 'approved', '"Desfazer mudanças" brings the approved text back');
        assert.equal(undone.pieces[0].status, 'approved');
        assert.equal(undone.approvals.article?.send.guard.allowed, false, 'the approved text needs no new send');
        const again = await ports.commands.requestReview(articleId);
        assert.equal(again.ok ? 'sent' : again.refusal.code, 'already_approved');
      }));

    it('refuses a send while a "Falta" remains, naming it; "Aviso" items never block', async (context) => {
      await withPorts(make, async (ports) => {
        const sample = await createSample(ports);
        const body = await sampleArticle(ports, sample.sourceId);
        await writeDraft(ports, sample.articleId, { ...body, title: '  ' });
        const untitled = unwrap(await ports.queries.get(sample.productionId)).approvals.article;
        assert.equal(untitled?.send.guard.allowed, true, 'the button opens the pre-send dialog');
        assert.deepEqual(untitled?.send.items.filter((item) => item.level === 'missing').map((item) => item.id), ['title']);
        const noTitle = await ports.commands.requestReview(sample.articleId);
        assert.deepEqual(noTitle.ok ? 'sent' : [noTitle.refusal.code, noTitle.refusal.message], ['send_blocked', 'Falta o título.']);

        const wrongQuote = { ...body, blocks: body.blocks.map((block) => (block.id === 'b-q1' ? { ...block, inlines: [{ text: 'Uma frase que ninguém disse na entrevista.' }] } : block)) };
        await writeDraft(ports, sample.articleId, wrongQuote as typeof body);
        const quote = await ports.commands.requestReview(sample.articleId);
        assert.deepEqual(quote.ok ? 'sent' : [quote.refusal.code, quote.refusal.message], ['send_blocked', '1 citação não confere com a entrevista.']);

        if (ports.simulate?.suggestion) {
          await writeDraft(ports, sample.articleId, body);
          await ports.simulate.suggestion(sample.articleId, { target: [{ blockId: 'b-q1', from: 0, to: 13 }], proposal: { kind: 'replace-text', text: 'O torrador' } });
          const open = await ports.commands.requestReview(sample.articleId);
          assert.deepEqual(open.ok ? 'sent' : [open.refusal.code, open.refusal.message], ['suggestion_pending', '1 sugestão da IA sem decisão.']);
        } else context.diagnostic('adapter cannot create suggestions directly: open-suggestion Falta not checked');

        const sample2 = await createSample(ports, { title: 'Cooperativa Vale Verde (IA)' });
        const aiBody = await sampleArticle(ports, sample2.sourceId);
        const unreviewed = { ...aiBody, blocks: aiBody.blocks.map((block) => ({ ...block, ai: 'unreviewed' as const })) };
        await writeDraft(ports, sample2.articleId, unreviewed);
        const items = unwrap(await ports.queries.get(sample2.productionId)).approvals.article?.send.items ?? [];
        assert.deepEqual(
          items.map((item) => [item.id, item.level]),
          [
            ['text-review', 'missing'],
            ['summary', 'ok'],
          ],
        );
        assert.equal(items[0].text, 'Texto não revisado');
        const notReviewed = await ports.commands.requestReview(sample2.articleId);
        assert.deepEqual(notReviewed.ok ? 'sent' : [notReviewed.refusal.code, notReviewed.refusal.message], ['send_blocked', 'Texto não revisado.']);

        // "Marcar como revisado": every AI block of the draft at once, as the studio saves it.
        await writeDraft(ports, sample2.articleId, { ...unreviewed, blocks: unreviewed.blocks.map((block) => ({ ...block, ai: 'reviewed' as const })) });
        const reviewedItems = unwrap(await ports.queries.get(sample2.productionId)).approvals.article?.send.items ?? [];
        assert.deepEqual(
          reviewedItems.map((item) => [item.id, item.level, item.text]),
          [
            ['text-review', 'ok', 'Texto revisado'],
            ['summary', 'ok', reviewedItems[1].text],
          ],
        );
        assert.ok(unwrap(await ports.commands.requestReview(sample2.articleId)).request, 'the text reviewed sends');
      });
    });

    it('queues sends per role: the assignee (or the gate roles), never the sender', () =>
      withPorts(make, async (ports) => {
        const a = await createSample(ports);
        await writeDraft(ports, a.articleId, await sampleArticle(ports, a.sourceId));
        unwrap(await ports.commands.requestReview(a.articleId, { assigneeId: ports.people.approver, note: 'Pode revisar?', dueOn: '2099-12-31' }));
        const editorName = await firstNameOf(ports, ports.people.editor);

        // The sender: nothing to approve, the piece waits for someone else.
        const own = await ports.queries.approvals('to_approve');
        assert.equal(own.counts.to_approve, 0);
        const waiting = (await ports.queries.overview('7d')).desk.groups.find((group) => group.id === 'waiting_other')?.items.find((item) => item.pieceId === a.articleId);
        assert.equal(waiting?.withPerson?.id, ports.people.approver);
        assert.equal(waiting?.nextStep, null);

        await ports.actAs(ports.people.approver);
        const queue = await ports.queries.approvals('to_approve');
        assert.deepEqual(queue.items.map((item) => item.pieceId), [a.articleId]);
        assert.deepEqual(
          { due: queue.items[0].due, round: queue.items[0].round, note: queue.items[0].note, requester: queue.items[0].requester?.id, size: queue.items[0].size },
          { due: 'later', round: 1, note: 'Pode revisar?', requester: ports.people.editor, size: 'standard' },
        );
        assert.ok((queue.items[0].characters ?? 0) > 0);
        const desk = (await ports.queries.overview('7d')).desk;
        const toApprove = desk.groups.find((group) => group.id === 'to_approve');
        assert.deepEqual(toApprove?.items.map((item) => item.pieceId), [a.articleId], 'Início and Aprovações read the same queue');
        assert.equal(toApprove?.items[0].nextStep?.kind, 'review');
        assert.equal(desk.needsYou, queue.counts.to_approve);
        const listed = (await ports.queries.list()).items.find((item) => item.id === a.productionId);
        assert.deepEqual(listed?.nextStep && [listed.nextStep.kind, listed.nextStep.mine], ['review', true]);

        if (ports.people.editorOnly) {
          await ports.actAs(ports.people.editorOnly);
          assert.deepEqual((await ports.queries.approvals('to_approve')).counts, { to_approve: 0, approved_by_me: 0, returned: 0 });
        }
        if (ports.people.creativeReviewer) {
          await ports.actAs(ports.people.creativeReviewer);
          assert.equal((await ports.queries.approvals('to_approve')).counts.to_approve, 0, 'articles are not for a creative reviewer');
        }

        // Returned: the sender's desk shows it with the note; the decider's "Devolvidas" lists it.
        await ports.actAs(ports.people.approver);
        const sent = unwrap(await ports.queries.review(a.articleId));
        unwrap(await ports.commands.decide({ pieceId: a.articleId, subject: sent.version.ref, decision: 'changes_requested', note: 'Cite a fonte do número.' }));
        const returnedTab = await ports.queries.approvals('returned');
        assert.deepEqual(returnedTab.items.map((item) => [item.pieceId, item.decision, item.decisionNote]), [[a.articleId, 'changes_requested', 'Cite a fonte do número.']]);
        await ports.actAs(ports.people.editor);
        const back = (await ports.queries.overview('7d')).desk.groups.find((group) => group.id === 'returned')?.items[0];
        assert.deepEqual(back && [back.pieceId, back.note, back.nextStep?.kind], [a.articleId, 'Cite a fonte do número.', 'adjust']);

        // 2º envio: "Quem aprova" defaults to the last decider; the review opens on "O que mudou".
        assert.equal(unwrap(await ports.queries.get(a.productionId)).approvals.article?.send.isResend, true);
        await writeDraft(ports, a.articleId, await sampleArticle(ports, a.sourceId, 1));
        const resent = unwrap(await ports.commands.requestReview(a.articleId));
        assert.equal(resent.request.assigneeId, ports.people.approver);
        await ports.actAs(ports.people.approver);
        const second = unwrap(await ports.queries.review(a.articleId));
        assert.equal(second.approval.request?.round, 2);
        assert.equal(second.previous?.decision, 'changes_requested');
        assert.equal(second.previous?.version.id, sent.version.id);
        assert.equal(second.defaultView, 'changes');
        unwrap(await ports.commands.decide({ pieceId: a.articleId, subject: second.version.ref, decision: 'approved', displayedHash: second.version.hash }));
        const approvedTab = await ports.queries.approvals('approved_by_me');
        assert.deepEqual(approvedTab.items.map((item) => [item.pieceId, item.round, item.requester?.name.split(' ')[0]]), [[a.articleId, 2, editorName]]);
        assert.equal((await ports.queries.approvals('to_approve')).counts.to_approve, 0);
      }));

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
