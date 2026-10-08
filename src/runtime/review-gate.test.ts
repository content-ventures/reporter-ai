import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIdGenerator, manualClock, memoryStorage } from '../adapters/local/store/index.ts';
import { markTextReviewed } from '../domain/article.ts';
import type { ArticleBody } from '../domain/article.ts';
import { createRuntime } from './create-runtime.ts';
import type { Runtime } from './runtime.ts';

/**
 * A03: "Enviar para aprovação" waits for the blocking checks. The text of an interrupted
 * generation (Horizonte: intro + Seção 1, "v1 · interrompida") cannot be sent until it is
 * continued or edited: the button opens the pre-send dialog, whose first "Falta" says why, and
 * the command refuses with `checks_blocking`, so the approver never lands on a request they
 * cannot approve.
 */

const NOW = '2026-10-07T12:00:00.000Z';
const HORIZONTE = 'prod-horizonte';

function open(): Runtime {
  const clock = manualClock(NOW);
  return createRuntime({
    storage: memoryStorage(),
    ids: createIdGenerator({ salt: 'gate' }),
    latency: false,
    sleep: async (ms: number) => {
      clock.advance(Math.max(0, Math.round(ms)));
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    adoptLiveRuns: false,
    clock,
  });
}

async function article(runtime: Runtime) {
  const found = await runtime.queries.get(HORIZONTE);
  assert.ok(found.ok);
  const piece = found.value.pieces.find((entry) => entry.kind === 'article');
  assert.ok(piece);
  return { production: found.value, piece };
}

describe('sending an article for approval (A03)', () => {
  it('waits for an interrupted generation to be continued or edited', async () => {
    const runtime = open();
    const { production, piece } = await article(runtime);
    // The button opens the dialog (sending is possible); the dialog's first "Falta" says why not yet.
    assert.equal(production.guards.pieces.article?.requestReview.allowed, true);
    const items = production.approvals.article?.send.items ?? [];
    assert.deepEqual(items[0] && { id: items[0].id, level: items[0].level, text: items[0].text }, { id: 'generation', level: 'missing', text: 'A IA não terminou o texto' });

    const refused = await runtime.commands.requestReview(piece.id);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok ? null : refused.refusal.code, 'checks_blocking');
    assert.equal(refused.ok ? null : refused.refusal.message, 'A IA não terminou o texto.');

    // Editing the text settles it: the check passes and the request goes through.
    const draft = await runtime.queries.draft(piece.id);
    assert.ok(draft.ok);
    const body = draft.value.body as ArticleBody;
    const edited: ArticleBody = { ...body, blocks: [...body.blocks.slice(0, -1), { id: 'fecho-1', type: 'paragraph', inlines: [{ text: 'Um fecho escrito pela redação.' }] }] };
    const saved = await runtime.commands.saveDraft(piece.id, edited, draft.value.revision);
    assert.ok(saved.ok, saved.ok ? '' : saved.refusal.message);
    const after = await article(runtime);
    assert.equal(after.production.guards.pieces.article?.requestReview.allowed, true);
    // The AI text is still not reviewed: that is the one "Falta" left, and the command says so.
    assert.deepEqual(after.production.approvals.article?.send.items.filter((item) => item.level === 'missing').map((item) => item.id), ['text-review']);
    const unreviewed = await runtime.commands.requestReview(piece.id);
    assert.equal(unreviewed.ok ? null : unreviewed.refusal.code, 'send_blocked');
    assert.equal(unreviewed.ok ? null : unreviewed.refusal.message, 'Texto não revisado.');

    // "Marcar como revisado": every AI block of the draft, as the studio saves it; then it goes through.
    const reviewed = await runtime.commands.saveDraft(piece.id, markTextReviewed(edited), saved.value.revision);
    assert.ok(reviewed.ok, reviewed.ok ? '' : reviewed.refusal.message);
    const done = await article(runtime);
    assert.equal(done.production.approvals.article?.send.items.some((item) => item.level === 'missing'), false);
    const sent = await runtime.commands.requestReview(piece.id);
    assert.ok(sent.ok, sent.ok ? '' : sent.refusal.message);
  });
});
