import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIdGenerator, manualClock, memoryStorage } from '../adapters/local/store/index.ts';
import type { ArticleBody } from '../domain/article.ts';
import { createRuntime } from './create-runtime.ts';
import type { Runtime } from './runtime.ts';

/**
 * A03: "Enviar para aprovação" waits for the blocking checks. The text of an interrupted
 * generation (Horizonte: intro + Seção 1, "v1 · interrompida") cannot be sent until it is
 * continued or edited: the guard says why (the studio's Tooltip and ⌘K) and the command refuses
 * with `checks_blocking`, so the approver never lands on a request they cannot approve.
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
    const guard = production.guards.pieces.article?.requestReview;
    assert.equal(guard?.allowed, false);
    assert.equal(guard && !guard.allowed ? guard.code : null, 'checks_blocking');
    assert.match(guard && !guard.allowed ? guard.reason : '', /Geração interrompida/);

    const refused = await runtime.commands.requestReview(piece.id);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok ? null : refused.refusal.code, 'checks_blocking');

    // Editing the text settles it: the check passes and the request goes through.
    const draft = await runtime.queries.draft(piece.id);
    assert.ok(draft.ok);
    const body = draft.value.body as ArticleBody;
    const edited: ArticleBody = { ...body, blocks: [...body.blocks.slice(0, -1), { id: 'fecho-1', type: 'paragraph', inlines: [{ text: 'Um fecho escrito pela redação.' }] }] };
    const saved = await runtime.commands.saveDraft(piece.id, edited, draft.value.revision);
    assert.ok(saved.ok, saved.ok ? '' : saved.refusal.message);
    const after = await article(runtime);
    assert.equal(after.production.guards.pieces.article?.requestReview.allowed, true);
    const sent = await runtime.commands.requestReview(piece.id);
    assert.ok(sent.ok, sent.ok ? '' : sent.refusal.message);
  });
});
