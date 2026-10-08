import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { blockText, paragraphBlock } from '../article.ts';
import type { ArticleBody } from '../article.ts';
import { toVersionRef, versionLabel } from '../piece.ts';
import { isApproved } from '../record.ts';
import { baseRecord, commitVersion, createKit, pieceIn, recordDecision, sampleArticle } from '../testing/scenario.ts';
import { ensureVersion, isDraftDirty, nextVersionNumber, restoreVersion, saveVersion, settleGeneration, updateDraft } from './versions.ts';

describe('working draft', () => {
  test('autosave overwrites one slot and bumps the revision', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const piece = pieceIn(record, 'article');
    const body: ArticleBody = { type: 'article', title: 'Rascunho', blocks: [paragraphBlock('p1', 'Texto.')] };
    const saved = updateDraft(piece, body, 0, kit.ctx());
    assert.ok(saved.ok);
    assert.equal(saved.value.draft.revision, 1);
    assert.deepEqual(saved.value.draft.body, body);
    assert.notEqual(saved.value.draft.body, body, 'stored as a copy');
  });

  test('a stale base revision is a conflict, never a silent overwrite', () => {
    const kit = createKit();
    const piece = pieceIn(baseRecord(kit), 'article');
    const first = updateDraft(piece, { type: 'article', title: 'A', blocks: [] }, 0, kit.ctx());
    assert.ok(first.ok);
    const stale = updateDraft(first.value, { type: 'article', title: 'B', blocks: [] }, 0, kit.ctx());
    assert.equal(!stale.ok && stale.refusal.code, 'conflict');
    const wrongKind = updateDraft(first.value, { type: 'carousel', templateId: 't', slides: [] }, 1, kit.ctx());
    assert.equal(!wrongKind.ok && wrongKind.refusal.code, 'kind_mismatch');
  });
});

describe('versions', () => {
  test('numbers are per piece and labels describe the origin', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    const v2 = commitVersion(record, kit, 'article', { ...sampleArticle(record.sources[0]), title: 'Outro título' });
    assert.deepEqual([v1.number, v2.number], [1, 2]);
    assert.equal(nextVersionNumber(record.versions, v1.pieceId), 3);
    assert.equal(nextVersionNumber(record.versions, 'other-piece'), 1);
    assert.equal(versionLabel(v1), 'v1 · IA');
    assert.equal(versionLabel(v2), 'v2');
    assert.equal(versionLabel({ ...v1, interrupted: true }), 'v1 · interrompida');
    assert.equal(v2.basedOn, v1.id);
  });

  test('⌘S refuses when nothing changed and when empty', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const empty = saveVersion(pieceIn(record, 'article'), record.versions, kit.ctx());
    assert.equal(!empty.ok && empty.refusal.code, 'empty');
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    const unchanged = saveVersion(pieceIn(record, 'article'), record.versions, kit.ctx());
    assert.equal(!unchanged.ok && unchanged.refusal.code, 'unchanged');
    assert.equal(!unchanged.ok && unchanged.refusal.message, 'Nenhuma alteração desde a última versão.');
    const review = ensureVersion(pieceIn(record, 'article'), record.versions, kit.ctx());
    assert.ok(review.ok);
    assert.equal(review.value.created, false);
    assert.equal(review.value.version.id, v1.id);
  });

  test('dirty draft detection compares content hashes', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    assert.equal(isDraftDirty(pieceIn(record, 'article'), undefined), false);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    assert.equal(isDraftDirty(pieceIn(record, 'article'), v1), false);
    const edited = updateDraft(pieceIn(record, 'article'), { ...v1.body, title: 'Mudou' } as ArticleBody, pieceIn(record, 'article').draft.revision, kit.ctx());
    assert.ok(edited.ok);
    assert.equal(isDraftDirty(edited.value, v1), true);
  });
});

describe('restoreVersion', () => {
  test('creates a new version with the old body and never alters decisions', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    const approval = recordDecision(record, kit, v1, 'approved');
    const v2 = commitVersion(record, kit, 'article', { ...(v1.body as ArticleBody), title: 'Título editado' });
    const decisionsBefore = structuredClone(record.decisions);

    kit.advance();
    const restored = restoreVersion(pieceIn(record, 'article'), record.versions, v1.id, kit.ctx());
    assert.ok(restored.ok);
    const { version, piece } = restored.value;
    assert.equal(version.number, 3);
    assert.equal(version.origin, 'restore');
    assert.equal(version.restoredFrom, v1.id);
    assert.equal(version.basedOn, v2.id);
    assert.equal(version.hash, v1.hash, 'same content, same hash');
    assert.notEqual(version.id, v1.id);
    assert.deepEqual(piece.draft.body, v1.body);
    assert.equal(piece.draft.basedOn, version.id);
    assert.equal(versionLabel(version, [v1, v2, version]), 'v3 · restaurada da v1');

    assert.deepEqual(record.decisions, decisionsBefore, 'decisions untouched');
    assert.equal(isApproved(record, toVersionRef(v1)), true, 'v1 stays approved');
    assert.equal(isApproved(record, toVersionRef(version)), false, 'the restored copy needs its own approval');
    assert.equal(approval.subject.kind === 'version' && approval.subject.versionId, v1.id);
  });

  test('refuses unknown versions and no-op restores', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    const unknown = restoreVersion(pieceIn(record, 'article'), record.versions, 'ver-404', kit.ctx());
    assert.equal(!unknown.ok && unknown.refusal.code, 'unknown_version');
    const noop = restoreVersion(pieceIn(record, 'article'), record.versions, v1.id, kit.ctx());
    assert.equal(!noop.ok && noop.refusal.code, 'nothing_to_restore');
  });
});

describe('settleGeneration', () => {
  test('v1 · IA is the pure run output when nobody edited during streaming', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const runStartedAt = kit.now();
    const output = sampleArticle(record.sources[0]);
    const settled = settleGeneration({ piece: pieceIn(record, 'article'), versions: [], output, runId: 'run-1', runStartedAt, interrupted: false }, kit.ctx());
    assert.equal(settled.versions.length, 1);
    assert.equal(settled.versions[0].origin, 'generation');
    assert.equal(settled.versions[0].runId, 'run-1');
    assert.deepEqual(settled.piece.draft.body, output);
  });

  test('edits made while later sections streamed become a separate edit version', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const runStartedAt = kit.now();
    const output = sampleArticle(record.sources[0]);
    kit.advance(5_000);
    const piece = pieceIn(record, 'article');
    const edited: ArticleBody = { ...output, blocks: [paragraphBlock('b-intro', 'Introdução reescrita pela editora.'), ...output.blocks.slice(1)] };
    const draft = updateDraft(piece, edited, piece.draft.revision, kit.ctx());
    assert.ok(draft.ok);
    const settled = settleGeneration({ piece: draft.value, versions: [], output, runId: 'run-1', runStartedAt, interrupted: false }, kit.ctx());
    assert.deepEqual(
      settled.versions.map((version) => [version.number, version.origin]),
      [
        [1, 'generation'],
        [2, 'edit'],
      ],
    );
    assert.equal(settled.versions[0].body.type === 'article' && blockText(settled.versions[0].body.blocks[0]), 'O Ateliê Sul nasceu numa garagem e hoje abastece vinte lojistas.');
    assert.equal(settled.versions[1].basedOn, settled.versions[0].id);
    assert.equal(settled.piece.draft.basedOn, settled.versions[1].id);
  });

  test('an untouched older draft is not mistaken for an edit; interruption is recorded', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    kit.advance();
    const runStartedAt = kit.now();
    const output: ArticleBody = { type: 'article', title: 'Nova versão', blocks: [paragraphBlock('n1', 'Parcial.')] };
    const settled = settleGeneration(
      { piece: pieceIn(record, 'article'), versions: record.versions, output, runId: 'run-2', runStartedAt, interrupted: true },
      kit.ctx(),
    );
    assert.equal(settled.versions.length, 1);
    assert.equal(settled.versions[0].number, 2);
    assert.equal(settled.versions[0].interrupted, true);
    assert.notEqual(settled.versions[0].hash, v1.hash);
  });
});
