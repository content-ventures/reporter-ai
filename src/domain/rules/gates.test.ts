import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ARTICLE_GATE, CAROUSEL_GATE } from '../decision.ts';
import { toVersionRef } from '../piece.ts';
import type { GenerationRun } from '../run.ts';
import { SIMULATED_MODEL } from '../run.ts';
import type { Suggestion } from '../suggestion.ts';
import {
  baseRecord,
  commitVersion,
  createKit,
  JOAO,
  MEMBERS,
  PEDRO,
  recordDecision,
  sampleArticle,
} from '../testing/scenario.ts';
import type { CheckResult } from '../checks.ts';
import { canDecide, decide } from './decide.ts';
import { canDerive } from './derive.ts';

function articleInReview() {
  const kit = createKit();
  const record = baseRecord(kit);
  const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
  return { kit, record, v1, ref: toVersionRef(v1) };
}

const runningRun = (pieceId: string): GenerationRun => ({
  id: 'run-live',
  kind: 'article.assist',
  productionId: 'prod-1',
  pieceId,
  prompt: { key: 'assist', version: '1', hash: 'p' },
  model: SIMULATED_MODEL,
  inputs: [],
  status: 'running',
  steps: [],
  createdBy: JOAO,
  createdAt: '2026-10-07T12:30:00.000Z',
});

describe('canDecide', () => {
  test('allows the approver (and admin self-approval) on the exact version', () => {
    const { record, ref } = articleInReview();
    assert.deepEqual(canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, decision: 'approved' }), { ok: true, value: true });
    assert.equal(canDecide({ ...record, member: MEMBERS[JOAO] }, { gate: ARTICLE_GATE, subject: ref }).ok, true);
  });

  test('refuses roles outside the gate and non-members', () => {
    const { record, ref } = articleInReview();
    const editor = canDecide({ ...record, member: MEMBERS.editorOnly }, { gate: ARTICLE_GATE, subject: ref });
    assert.equal(!editor.ok && editor.refusal.code, 'forbidden_role');
    // B06: the reason names who decides (Tooltip on "Aprovar" and the notice above the text).
    assert.equal(!editor.ok && editor.refusal.message, 'Só aprovador ou admin decide nesta etapa.');
    const stranger = canDecide({ ...record }, { gate: ARTICLE_GATE, subject: ref });
    assert.equal(!stranger.ok && stranger.refusal.code, 'forbidden_role');
    const creative = canDecide({ ...record, member: { ...MEMBERS.editorOnly, roles: ['creative_reviewer'] } }, { gate: CAROUSEL_GATE, subject: ref });
    assert.equal(creative.ok, true, 'creative reviewers decide on carousels');
  });

  test('refuses a hash mismatch between the requested, the stored and the displayed version', () => {
    const { record, ref } = articleInReview();
    const tampered = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: { ...ref, hash: 'deadbeefdeadbeef' } });
    assert.equal(!tampered.ok && tampered.refusal.code, 'hash_mismatch');
    const screen = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, displayedHash: 'aaaaaaaaaaaaaaaa' });
    assert.equal(!screen.ok && screen.refusal.code, 'hash_mismatch');
    const unknown = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: { ...ref, versionId: 'ver-x' } });
    assert.equal(!unknown.ok && unknown.refusal.code, 'unknown_version');
  });

  test('refuses while a run is in progress or a suggestion is pending', () => {
    const { record, ref, v1 } = articleInReview();
    const running = canDecide({ ...record, runs: [runningRun(v1.pieceId)], member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref });
    assert.equal(!running.ok && running.refusal.code, 'run_in_progress');
    const suggestion: Suggestion = {
      id: 'sug-1',
      runId: 'run-x',
      pieceId: v1.pieceId,
      baseRevision: 1,
      target: [],
      anchorText: [],
      proposal: { kind: 'title', text: 'x' },
      state: 'ready',
      createdAt: '2026-10-07T12:30:00.000Z',
    };
    const pending = canDecide({ ...record, suggestions: [suggestion], member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref });
    assert.equal(!pending.ok && pending.refusal.code, 'suggestion_pending');
    const decided = canDecide({ ...record, suggestions: [{ ...suggestion, state: 'discarded' }], member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref });
    assert.equal(decided.ok, true);
  });

  test('blocking checks stop approval but not a return with note', () => {
    const { record, ref } = articleInReview();
    const checks: CheckResult[] = [
      { id: 'article.length', label: 'Extensão no alvo', status: 'warn', blocking: false },
      { id: 'article.generation', label: 'Geração concluída', status: 'fail', blocking: true, detail: 'Geração em andamento' },
    ];
    const approve = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, decision: 'approved', checks });
    assert.equal(!approve.ok && approve.refusal.code, 'blocking_checks');
    assert.equal(!approve.ok && approve.refusal.message, 'Geração em andamento');
    const back = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, decision: 'changes_requested', checks });
    assert.equal(back.ok, true);
    const warnOnly = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, decision: 'approved', checks: [checks[0]] });
    assert.equal(warnOnly.ok, true, 'warnings never block: the human decides');
  });

  test('refuses decisions the gate does not offer and repeated identical decisions', () => {
    const { kit, record, ref, v1 } = articleInReview();
    const selected = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, decision: 'selected' });
    assert.equal(!selected.ok && selected.refusal.code, 'decision_not_allowed');
    recordDecision(record, kit, v1, 'approved');
    const again = canDecide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, decision: 'approved' });
    assert.equal(!again.ok && again.refusal.code, 'already_decided');
  });
});

describe('decide', () => {
  test('"Devolver" requires a note; the decision keeps anchors and a checks snapshot', () => {
    const { kit, record, ref } = articleInReview();
    const state = { ...record, member: MEMBERS[PEDRO] };
    const missing = decide(state, { gate: ARTICLE_GATE, subject: ref, decision: 'changes_requested', note: '   ' }, kit.ctx(PEDRO));
    assert.equal(!missing.ok && missing.refusal.code, 'note_required');
    const checks: CheckResult[] = [{ id: 'article.title', label: 'Título', status: 'pass', blocking: false }];
    const returned = decide(
      state,
      {
        gate: ARTICLE_GATE,
        subject: ref,
        decision: 'changes_requested',
        note: ' Encurtar a introdução. ',
        anchors: [{ blockId: 'b-intro', from: 0, to: 10, excerpt: 'O Ateliê S' }],
        checks,
      },
      kit.ctx(PEDRO),
    );
    assert.ok(returned.ok);
    assert.equal(returned.value.note, 'Encurtar a introdução.');
    assert.equal(returned.value.by, PEDRO);
    assert.equal(returned.value.gate, 'article.approval');
    assert.deepEqual(returned.value.subject, ref);
    assert.deepEqual(returned.value.checks, checks);
    assert.notEqual(returned.value.checks[0], checks[0], 'snapshot, not a live reference');
    assert.equal(returned.value.anchors?.[0].excerpt, 'O Ateliê S');
  });

  test('approval needs no note', () => {
    const { kit, record, ref } = articleInReview();
    const approved = decide({ ...record, member: MEMBERS[PEDRO] }, { gate: ARTICLE_GATE, subject: ref, decision: 'approved' }, kit.ctx(PEDRO));
    assert.ok(approved.ok);
    assert.equal(approved.value.note, undefined);
    assert.deepEqual(approved.value.checks, []);
  });
});

describe('canDerive (REQ-1.3 / REQ-T.6)', () => {
  test('requires an approval on the exact version ref', () => {
    const { kit, record, ref, v1 } = articleInReview();
    const before = canDerive(record, ref);
    assert.equal(!before.ok && before.refusal.code, 'parent_not_approved');
    const approval = recordDecision(record, kit, v1, 'approved');
    const after = canDerive(record, ref);
    assert.ok(after.ok);
    assert.equal(after.value.decision.id, approval.id);
  });

  test('refuses a ref whose hash does not match the stored version', () => {
    const { kit, record, ref, v1 } = articleInReview();
    recordDecision(record, kit, v1, 'approved');
    const result = canDerive(record, { ...ref, hash: '0000000000000000' });
    assert.equal(!result.ok && result.refusal.code, 'hash_mismatch');
    const unknown = canDerive(record, { ...ref, versionId: 'ver-404' });
    assert.equal(!unknown.ok && unknown.refusal.code, 'unknown_version');
  });

  test('a later return on the same version withdraws it as a parent', () => {
    const { kit, record, ref, v1 } = articleInReview();
    recordDecision(record, kit, v1, 'approved');
    recordDecision(record, kit, v1, 'changes_requested', { note: 'Rever' });
    assert.equal(canDerive(record, ref).ok, false);
  });

  test('only the most recently approved version can be a parent', () => {
    const { kit, record, ref, v1 } = articleInReview();
    recordDecision(record, kit, v1, 'approved');
    const v2 = commitVersion(record, kit, 'article', { ...sampleArticle(record.sources[0]), title: 'Título revisto' });
    recordDecision(record, kit, v2, 'approved');
    const old = canDerive(record, ref);
    assert.equal(!old.ok && old.refusal.code, 'superseded');
    assert.equal(!old.ok && old.refusal.message, 'Existe uma versão aprovada mais recente (v2).');
    assert.equal(canDerive(record, toVersionRef(v2)).ok, true);
  });
});
