import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  ARTICLE_SIZES,
  articleAssetIds,
  articleCharacters,
  articleImageSlots,
  articleStats,
  blockText,
  bodyHash,
  buildOverview,
  canExport,
  checkQuotes,
  currentSourceVersion,
  extractQuotes,
  findBlock,
  findVersion,
  foldRun,
  isApproved,
  latestDecisionOn,
  manifestImageSuggestions,
  pieceStatus,
  productionStatus,
  resolveExport,
  resolveSourceRef,
  sameVersionRef,
  sizeFit,
  slotIssues,
  toVersionRef,
} from '../domain/index.ts';
import type { ArticleBody, ProductionRecord, QuoteCheck, SourceRef } from '../domain/index.ts';
import { planFromScript } from '../adapters/local/generation/draft-plan.ts';
import type { TemplateRender as AdapterTemplateRender } from '../adapters/local/render/templates.ts';
import { normalizeSeed } from '../adapters/local/store/state.ts';
import { recipeFor } from '../registries/index.ts';
import { createFixtures, fixtureSeed, SAMPLE_FILES, sampleSrc, scriptBody } from './index.ts';
import type { FixtureSet } from './index.ts';

const NOW = '2026-10-07T15:00:00.000Z';
const fixtures = createFixtures({ now: NOW });

function record(key: string): ProductionRecord {
  const found = fixtures.records.find((entry) => entry.production.id === `prod-${key}`);
  assert.ok(found, `record ${key}`);
  return found;
}

function articleRefs(body: ArticleBody): SourceRef[] {
  return body.blocks.flatMap((block) => block.sourceRefs ?? []);
}

function allBodies(entry: ProductionRecord) {
  return [
    ...entry.versions.map((version) => ({ where: version.id, body: version.body })),
    ...entry.pieces.map((piece) => ({ where: `${piece.id} draft`, body: piece.draft.body })),
  ];
}

describe('fixture set', () => {
  test('is deterministic for a given clock', () => {
    const again = createFixtures({ now: NOW });
    assert.equal(JSON.stringify(again.records), JSON.stringify(fixtures.records));
    assert.equal(JSON.stringify(again.history), JSON.stringify(fixtures.history));
    assert.equal(JSON.stringify(again.activity), JSON.stringify(fixtures.activity));
  });

  test('dates are relative to the injected clock', () => {
    const later = createFixtures({ now: '2027-03-01T09:30:00.000Z' });
    const shift = Date.parse('2027-03-01T09:30:00.000Z') - Date.parse(NOW);
    const a = fixtures.records[0].production.createdAt;
    const b = later.records[0].production.createdAt;
    assert.equal(Date.parse(b) - Date.parse(a), shift);
  });

  test('covers every demo state with one production each', () => {
    assert.equal(fixtures.records.length, 9);
    assert.deepEqual(
      fixtures.stories.map((story) => story.expect.productionStatus).sort(),
      ['changes_requested', 'completed', 'draft', 'failed', 'generating', 'in_review', 'in_review', 'stale', 'unauthorized'],
    );
    assert.equal(fixtures.records[0].production.id, 'prod-atelie-sul', 'flagship first');
  });

  test('derived statuses match each story (single source: domain rules)', () => {
    for (const story of fixtures.stories) {
      const entry = fixtures.records.find((candidate) => candidate.production.id === story.productionId);
      assert.ok(entry);
      assert.equal(productionStatus(entry), story.expect.productionStatus, `${story.key} production`);
      for (const [kind, expected] of Object.entries(story.expect.pieces)) {
        assert.equal(pieceStatus(entry, kind as 'article' | 'carousel'), expected, `${story.key} ${kind}`);
      }
    }
  });

  test('ids are unique across the workspace', () => {
    const ids = fixtures.records.flatMap((entry) => [
      entry.production.id,
      ...entry.sources.map((source) => source.id),
      ...entry.pieces.map((piece) => piece.id),
      ...entry.versions.map((version) => version.id),
      ...entry.runs.map((run) => run.id),
      ...entry.decisions.map((decision) => decision.id),
      ...entry.reviewRequests.map((request) => request.id),
      ...entry.suggestions.map((suggestion) => suggestion.id),
      ...entry.deliveries.map((delivery) => delivery.id),
    ]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('plugs into the local adapters as is (store seed, render data, script plans)', () => {
    const state = normalizeSeed(fixtureSeed(fixtures));
    assert.equal(state.productions.length, fixtures.records.length);
    assert.equal(state.sessionPersonId, fixtures.viewerId);
    assert.equal(Object.keys(state.runFolds).length, 2);
    assert.equal(state.history.length, fixtures.history.approvals.length);
    const renders: Readonly<Record<string, AdapterTemplateRender>> = fixtures.templateRenders;
    assert.deepEqual(Object.keys(renders).sort(), fixtures.templates.map((template) => template.id).sort());
    for (const entry of fixtures.records) {
      const script = fixtures.scriptBook.draft(entry.sources[0].id);
      if (!script) continue;
      const plan = planFromScript(script, entry.sources, (prefix) => `${prefix}-test`);
      assert.ok(plan, `${entry.production.id} script applies`);
      assert.equal(plan.origin, 'script');
      assert.equal(plan.sections.length, entry.production.brief.sections);
      assert.equal(plan.keyQuotes.length, script.keySegments.length, 'every key line resolves');
    }
  });

  test('"Começar vazio" keeps the team and templates only', () => {
    const empty = createFixtures({ now: NOW, empty: true });
    assert.equal(empty.records.length, 0);
    assert.equal(empty.history.approvals.length, 0);
    assert.equal(empty.members.length, fixtures.members.length);
    assert.deepEqual(empty.templates.map((template) => template.id), fixtures.templates.map((template) => template.id), 'the whole template library');
  });
});

describe('people and sources', () => {
  test('members and mapped speakers are known people; João and Pedro hold the pilot roles', () => {
    const people = new Set(fixtures.people.map((person) => person.id));
    for (const member of fixtures.members) assert.ok(people.has(member.personId));
    const joao = fixtures.members.find((member) => member.personId === fixtures.viewerId);
    assert.deepEqual(joao?.roles, ['editor', 'admin']);
    assert.deepEqual(fixtures.members.find((member) => member.personId === 'person-pedro')?.roles, ['approver']);
    for (const entry of fixtures.records) {
      for (const speaker of entry.sources.flatMap((source) => source.speakers)) {
        if (speaker.personId) assert.ok(people.has(speaker.personId), speaker.label);
      }
    }
    assert.equal(fixtures.workspace.name, 'Content Ventures');
  });

  test('flagship transcript: ≈5k words, 3 mapped speakers, a few timestamps', () => {
    const source = record('atelie-sul').sources[0];
    const segments = currentSourceVersion(source).content.segments;
    const words = articleStats({ type: 'article', title: '', blocks: segments.map((segment) => ({ id: segment.id, type: 'paragraph', inlines: [{ text: segment.text }] })) }).words;
    assert.ok(words >= 4500 && words <= 6000, `${words} words`);
    assert.equal(source.speakers.length, 3);
    assert.ok(source.speakers.every((speaker) => speaker.personId));
    const timed = segments.filter((segment) => segment.startMs !== undefined).length;
    assert.ok(timed >= 4 && timed < segments.length / 4, `${timed} timestamps`);
  });

  test('sources exercise authorisation, unmapped labels and the .vtt parser', () => {
    const painel = record('couro-nobre').sources[0];
    assert.equal(painel.rights.authorized, false);
    assert.ok(painel.speakers.some((speaker) => speaker.label === 'Mediador' && !speaker.personId));
    const podcast = record('horizonte').sources[0];
    assert.equal(currentSourceVersion(podcast).content.format, 'vtt');
    assert.ok(currentSourceVersion(podcast).content.segments.every((segment) => segment.startMs !== undefined));
  });

  test('material is fictional and never the internal 02/10 meeting', () => {
    for (const entry of fixtures.records) {
      for (const segment of currentSourceVersion(entry.sources[0]).content.segments) {
        assert.ok(!/02\/10|reunião interna/i.test(segment.text), segment.text);
      }
    }
  });
});

describe('evidence and quotes', () => {
  test('every SourceRef (versions, drafts, scripts, run logs) resolves to its exact excerpt', () => {
    for (const entry of fixtures.records) {
      const refs: SourceRef[] = [];
      for (const { body } of allBodies(entry)) if (body.type === 'article') refs.push(...articleRefs(body));
      const script = fixtures.scriptBook.draft(entry.sources[0].id);
      if (script) refs.push(...articleRefs(scriptBody(script)), ...script.keySegments);
      for (const run of entry.runs) {
        for (const event of fixtures.runEvents[run.id] ?? []) {
          if (event.type === 'source.used') refs.push(event.ref);
          if (event.type === 'block.completed') refs.push(...(event.block.sourceRefs ?? []));
        }
      }
      for (const ref of refs) {
        const resolved = resolveSourceRef(entry.sources, ref);
        assert.ok(resolved && resolved.excerpt.length > 0, `${entry.production.id}: unresolved ${JSON.stringify(ref)}`);
      }
    }
  });

  test('quotations match the transcript exactly, except the declared paraphrase in a draft', () => {
    for (const story of fixtures.stories) {
      const entry = fixtures.records.find((candidate) => candidate.production.id === story.productionId);
      assert.ok(entry);
      for (const version of entry.versions) {
        if (version.body.type !== 'article') continue;
        const missing: QuoteCheck[] = checkQuotes(version.body, entry.sources).filter((check: QuoteCheck) => check.status !== 'verified');
        assert.deepEqual(
          missing.map((check) => check.text),
          [],
          `${version.id}`,
        );
      }
      const article = entry.pieces.find((piece) => piece.kind === 'article');
      if (article?.draft.body.type === 'article' && story.expect.draftQuotes) {
        const checks = checkQuotes(article.draft.body, entry.sources);
        const verified = checks.filter((check) => check.status === 'verified').length;
        assert.deepEqual({ verified, total: checks.length }, story.expect.draftQuotes, `${story.key} draft quotes`);
      }
    }
  });

  test('hand-written drafts: every quote verified, every block AI-unreviewed, inside the size of the brief', () => {
    for (const entry of fixtures.records) {
      const script = fixtures.scriptBook.draft(entry.sources[0].id);
      if (!script) continue;
      const body = scriptBody(script);
      assert.ok(checkQuotes(body, entry.sources).every((check) => check.status === 'verified'), entry.production.id);
      // Image slots carry no review flag: a person fills or dismisses them.
      assert.ok(body.blocks.every((block) => (block.type === 'figure' ? block.ai === undefined : block.ai === 'unreviewed')));
      // The lauda rule: what the simulation writes lands inside the brief's size, never above its maximum.
      const chars = articleCharacters(body);
      assert.equal(sizeFit(entry.production.brief.size, chars), 'inside', `${entry.production.id}: ${chars} characters for ${entry.production.brief.size}`);
      const steps = recipeFor('article.generate').steps({ sections: entry.production.brief.sections }).map((step) => step.id);
      for (const section of script.sections) assert.ok(steps.includes(section.id), `${entry.production.id} section ${section.id}`);
      assert.equal(script.sections.length, entry.production.brief.sections + 1);
      assert.equal(script.outline.length, entry.production.brief.sections);
    }
  });

  test('flagship article v1: Padrão near its 3.600 target (never above 4.000), intro + 3 sections, 4–6 direct quotes', () => {
    const script = fixtures.scriptBook.draft('src-atelie-sul');
    assert.ok(script);
    const body = scriptBody(script);
    const chars = articleCharacters(body);
    const { targetChars, maxChars } = ARTICLE_SIZES.standard;
    assert.ok(Math.abs(chars - targetChars) <= targetChars * 0.1 && chars <= maxChars, `${chars} characters`);
    assert.equal(body.blocks.filter((block) => block.type === 'heading').length, 3);
    const quotes = extractQuotes(body).length;
    assert.ok(quotes >= 4 && quotes <= 6, `${quotes} quotes`);
  });

  test('sizes by lauda: approved and delivered articles land inside their size; one production is Curto', () => {
    for (const entry of fixtures.records) {
      const { brief } = entry.production;
      const { sections } = ARTICLE_SIZES[brief.size];
      assert.ok(brief.sections >= sections.min && brief.sections <= sections.max, `${entry.production.id}: ${brief.sections} sections in a ${brief.size}`);
      for (const version of entry.versions) {
        if (version.body.type !== 'article' || !isApproved(entry, toVersionRef(version))) continue;
        const chars = articleCharacters(version.body);
        assert.equal(sizeFit(brief.size, chars), 'inside', `${version.id}: ${chars} characters for ${brief.size}`);
      }
    }
    const curto = fixtures.records.filter((entry) => entry.production.brief.size === 'short');
    assert.ok(curto.length >= 1, 'the 1-lauda path is visible');
    for (const entry of curto) {
      const draft = entry.pieces.find((piece) => piece.kind === 'article')?.draft.body;
      assert.ok(entry.production.brief.sections <= 2, entry.production.id);
      // A Curto has no intertítulos: its sections only guide the drafting.
      assert.ok(draft?.type !== 'article' || !draft.blocks.some((block) => block.type === 'heading'), `${entry.production.id}: no H2 in a Curto`);
    }
  });
});

describe('versions, decisions and runs', () => {
  test('version hashes, numbering and lineage are consistent', () => {
    for (const entry of fixtures.records) {
      for (const piece of entry.pieces) {
        const versions = entry.versions.filter((version) => version.pieceId === piece.id).sort((a, b) => a.number - b.number);
        versions.forEach((version, index) => {
          assert.equal(version.number, index + 1, version.id);
          assert.equal(version.hash, bodyHash(version.body), version.id);
          if (version.basedOn) assert.ok(findVersion(entry, version.basedOn), version.id);
        });
        if (piece.draft.basedOn) assert.ok(findVersion(entry, piece.draft.basedOn));
      }
    }
  });

  test('derived versions point at approved, exact parent versions (REQ-1.3)', () => {
    for (const entry of fixtures.records) {
      for (const version of entry.versions) {
        for (const input of version.inputs) {
          const parent = findVersion(entry, input.versionId);
          assert.ok(parent && parent.hash === input.hash, `${version.id} input`);
          assert.ok(isApproved(entry, input), `${version.id} parent approved`);
        }
        if (version.body.type === 'carousel') assert.equal(version.inputs.length, 1, `${version.id} carousel parent`);
      }
    }
  });

  test('decisions are on exact versions, returned ones carry notes and valid anchors', () => {
    for (const entry of fixtures.records) {
      for (const decision of entry.decisions) {
        assert.equal(decision.subject.kind, 'version');
        if (decision.subject.kind !== 'version') continue;
        const version = findVersion(entry, decision.subject.versionId);
        assert.ok(version && version.hash === decision.subject.hash);
        assert.ok(decision.checks.length > 0, 'checks snapshot stored with the decision');
        if (decision.decision === 'changes_requested') {
          assert.ok(decision.note && decision.note.length > 20);
          assert.ok(decision.anchors && decision.anchors.length > 0);
          for (const anchor of decision.anchors) {
            assert.equal(version.body.type, 'article');
            if (version.body.type !== 'article') continue;
            const block = findBlock(version.body, anchor.blockId);
            assert.ok(block);
            assert.equal(blockText(block).slice(anchor.from, anchor.to), anchor.excerpt);
          }
        }
      }
    }
    const returned = record('casa-forma').decisions.at(-1);
    assert.equal(returned?.decision, 'changes_requested');
    assert.equal(returned?.by, 'person-pedro');
  });

  test('runs are simulated, honest (no cost) and linked to their outputs', () => {
    for (const entry of fixtures.records) {
      for (const run of entry.runs) {
        assert.equal(run.model.label, 'Simulação local');
        assert.equal(run.model.engine, 'simulated');
        assert.equal(run.cost, undefined);
        assert.equal(run.usage, undefined);
        assert.ok(run.prompt.key && run.prompt.version);
        if (run.kind === 'article.generate' || run.kind === 'carousel.generate') {
          assert.ok(run.inputs.some((input) => input.kind === 'source-version'));
        }
      }
      for (const version of entry.versions.filter((candidate) => candidate.runId)) {
        const run = entry.runs.find((candidate) => candidate.id === version.runId);
        assert.ok(run?.output && sameVersionRef(run.output, toVersionRef(version)), version.id);
      }
    }
  });

  test('run logs fold into exactly the stored run and never pass "now"', () => {
    const logs = Object.entries(fixtures.runEvents);
    assert.equal(logs.length, 2);
    for (const [runId, events] of logs) {
      const entry = fixtures.records.find((candidate) => candidate.runs.some((run) => run.id === runId));
      const stored = entry?.runs.find((run) => run.id === runId);
      // A settled run points at the version it produced (as `settleRun` records it live); the log does not.
      const logged = stored ? { ...stored } : undefined;
      delete logged?.output;
      assert.deepEqual(foldRun(events)?.run, logged);
      assert.ok(events.every((event) => Date.parse(event.at) <= Date.parse(NOW)));
      assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index + 1));
    }
    const live = record('atelie-sul').runs[0];
    assert.equal(live.status, 'running');
    assert.deepEqual(
      live.steps.map((step) => step.state),
      ['done', 'done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
    );
    const failed = record('horizonte').runs[0];
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error?.retryable, true);
    assert.equal(failed.error?.stepId, 'section-2');
    const kept = foldRun(fixtures.runEvents[failed.id])?.blocks.filter((block) => block.complete).length;
    assert.ok(kept && kept >= 3, 'introduction and section 1 survive the failure');
  });

  test('the failed generation is seeded as the live path leaves it', () => {
    const entry = record('horizonte');
    const [run] = entry.runs;
    const [version] = entry.versions;
    const article = entry.pieces.find((piece) => piece.kind === 'article');
    assert.equal(entry.versions.length, 1);
    assert.equal(version.origin, 'generation');
    assert.equal(version.interrupted, true);
    assert.equal(version.runId, run.id);
    assert.ok(run.output && sameVersionRef(run.output, toVersionRef(version)));
    assert.ok(article && article.draft.body.type === 'article');
    const blocks = article.draft.body.type === 'article' ? article.draft.body.blocks : [];
    const fold = foldRun(fixtures.runEvents[run.id]);
    assert.deepEqual(
      blocks.map((block) => block.id),
      fold?.blocks.filter((block) => block.complete).map((block) => block.id),
      'the draft is the introduction and section 1, nothing of section 2',
    );
    assert.equal(article.draft.basedOn, version.id);
    assert.equal(pieceStatus(entry, 'article'), 'failed');
  });

  test('the pending suggestion targets the current draft text', () => {
    const entry = record('estudio-norte');
    const [suggestion] = entry.suggestions;
    assert.equal(suggestion.state, 'ready');
    const piece = entry.pieces.find((candidate) => candidate.id === suggestion.pieceId);
    assert.ok(piece && piece.draft.body.type === 'article');
    assert.equal(suggestion.baseRevision, piece.draft.revision);
    const block = findBlock(piece.draft.body, suggestion.target[0].blockId);
    assert.equal(block && blockText(block), suggestion.anchorText[0]);
  });
});

describe('carousel and delivery', () => {
  test('carousel copy fits the provisional template slots', () => {
    for (const entry of fixtures.records) {
      for (const version of entry.versions) {
        const body = version.body;
        if (body.type !== 'carousel') continue;
        const template = fixtures.templates.find((candidate) => candidate.id === body.templateId);
        assert.ok(template, version.id);
        assert.deepEqual(slotIssues(body, template), [], version.id);
      }
      const copy = fixtures.scriptBook.carousel(entry.sources[0].id);
      if (!copy) continue;
      const slides = copy.map((slide, index) => ({ id: `s${index}`, ...slide }));
      assert.deepEqual(slotIssues({ type: 'carousel', templateId: fixtures.templates[0].id, slides }, fixtures.templates[0]), []);
      assert.deepEqual(copy.map((slide) => slide.layout), ['cover', 'context', 'point', 'quote', 'closing']);
    }
  });

  test('the concluded package exported exactly the approved versions with the manifest files', () => {
    const entry = record('bella-passo');
    const [delivery] = entry.deliveries;
    assert.equal(delivery.status, 'completed');
    assert.equal(delivery.channel, 'export');
    const versions = [...new Map(delivery.items.map((item) => [item.version.versionId, item.version])).values()];
    assert.ok(canExport(entry, versions).ok);
    for (const item of delivery.items) assert.equal(latestDecisionOn(entry, item.version)?.id, item.decisionId);
    assert.ok(delivery.attempts[0].items?.includes('manifesto.json'));
    assert.equal(fixtures.feedback[0]?.rating, 'positive');
  });

  test('the outdated carousel makes the default package incoherent, with the consistent option', () => {
    const { result } = resolveExport(record('patio-couro'));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.code, 'mixed_versions');
    assert.ok(result.refusal.details?.exportWithParent);
  });
});

describe('overview, history and activity', () => {
  function overview(set: FixtureSet, rangeDays: number) {
    return buildOverview({
      records: set.records,
      history: set.history.approvals,
      activity: set.activity,
      rangeDays,
      viewer: set.members.find((member) => member.personId === set.viewerId),
      now: set.now,
      templates: set.templates,
    });
  }

  test('"Visão geral" for João: live run, two approvals waiting, three items for him', () => {
    const view = overview(fixtures, 7);
    assert.equal(view.metrics.generatingNow, 1);
    assert.equal(view.activeRuns[0]?.productionTitle, 'Entrevista Ateliê Sul');
    assert.equal(view.metrics.awaitingApproval, 2);
    assert.equal(view.metrics.inProduction, 8);
    assert.deepEqual(view.awaitingYou.map((item) => item.id).sort(), ['prod-aurora', 'prod-casa-forma', 'prod-lume']);
    assert.equal(view.continueWith?.id, 'prod-estudio-norte');
    assert.equal(view.rhythm.length, 7);
  });

  test('history makes 7- and 30-day deltas believable', () => {
    for (const range of [7, 30]) {
      const { approved, timeToApprovalMs, aiRetention } = overview(fixtures, range).metrics;
      assert.ok((approved.value ?? 0) > 0 && (approved.previous ?? 0) > 0, `approved ${range}d`);
      assert.ok(timeToApprovalMs.value !== null && timeToApprovalMs.previous !== null);
      assert.ok(aiRetention.value !== null && aiRetention.value > 0.5 && aiRetention.value < 0.95);
    }
    assert.equal(fixtures.history.days.length, 60);
    const ids = new Set(fixtures.records.map((entry) => entry.production.id));
    assert.ok(fixtures.history.approvals.every((point) => !ids.has(point.productionId)));
    assert.ok(fixtures.history.approvals.every((point) => Date.parse(point.approvedAt) < Date.parse(NOW)));
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const sorted = [...fixtures.history.approvals].sort((a, b) => Date.parse(a.approvedAt) - Date.parse(b.approvedAt));
    const early = sorted.slice(0, 20);
    const recent = sorted.slice(-20);
    assert.ok(average(recent.map((point) => point.timeToApprovalMs ?? 0)) < average(early.map((point) => point.timeToApprovalMs ?? 0)));
    assert.ok(average(recent.map((point) => point.aiRetention ?? 0)) > average(early.map((point) => point.aiRetention ?? 0)));
    const other = createFixtures({ now: NOW, historySeed: 7 });
    assert.notEqual(JSON.stringify(other.history), JSON.stringify(fixtures.history));
  });

  test('activity is semantic, ascending and tied to known productions', () => {
    const ids = new Set(fixtures.records.map((entry) => entry.production.id));
    const times = fixtures.activity.map((event) => Date.parse(event.at));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.equal(new Set(fixtures.activity.map((event) => event.id)).size, fixtures.activity.length);
    for (const event of fixtures.activity) {
      assert.ok(event.productionId && ids.has(event.productionId));
      assert.ok(Date.parse(event.at) <= Date.parse(NOW));
    }
    const types = new Set(fixtures.activity.map((event) => event.type));
    for (const type of ['production.created', 'run.completed', 'run.failed', 'review.requested', 'decision.recorded', 'delivery.completed', 'feedback.recorded']) {
      assert.ok(types.has(type as never), type);
    }
  });
});

describe('script book', () => {
  test('flagship: rewrites per tone for three paragraphs, three titles, five slides', () => {
    const book = fixtures.scriptBook;
    assert.ok(book.sourceIds().includes('src-atelie-sul'));
    for (const blockId of ['as-intro-1', 'as-s2-p1', 'as-s3-p1']) {
      for (const variant of ['direct', 'didactic', 'formal', 'shorter'] as const) {
        assert.ok(book.rewrite('src-atelie-sul', blockId, variant), `${blockId} ${variant}`);
      }
    }
    assert.equal(book.titles('src-atelie-sul').length, 3);
    assert.equal(book.subheadings('src-atelie-sul').length, 3);
    assert.equal(book.carousel('src-atelie-sul')?.length, 5);
    assert.equal(book.draft('src-couro-nobre'), undefined, 'unscripted material goes extractive');
    assert.equal(book.rewrite('src-atelie-sul', 'unknown', 'direct'), undefined);
  });

  test('accepting a rewrite never breaks a verified quotation', () => {
    for (const entry of fixtures.records) {
      const script = fixtures.scriptBook.draft(entry.sources[0].id);
      if (!script) continue;
      const body = scriptBody(script);
      for (const block of body.blocks) {
        for (const variant of ['direct', 'didactic', 'formal', 'shorter'] as const) {
          const text = fixtures.scriptBook.rewrite(entry.sources[0].id, block.id, variant);
          if (!text || block.type !== 'paragraph') continue;
          const rewritten: ArticleBody = { ...body, blocks: body.blocks.map((candidate) => (candidate.id === block.id ? { ...block, inlines: [{ text }] } : candidate)) };
          assert.ok(checkQuotes(rewritten, entry.sources).every((check) => check.status === 'verified'), `${block.id} ${variant}`);
        }
      }
    }
  });
});

describe('image slots', () => {
  test('every hand-written draft suggests a cover and asks for an image after the intro and in section 2, with evidence', () => {
    let drafts = 0;
    for (const entry of fixtures.records) {
      const script = fixtures.scriptBook.draft(entry.sources[0].id);
      if (!script) continue;
      drafts += 1;
      assert.ok(script.coverSlot?.subject, `${entry.production.id} cover suggestion`);
      const intro = script.sections.find((section) => section.id === 'intro');
      const second = script.sections.find((section) => section.id === 'section-2');
      assert.equal(intro?.blocks.at(-1)?.type, 'figure', `${entry.production.id}: a slot closes the intro`);
      assert.ok(second?.blocks.some((block) => block.type === 'figure'), `${entry.production.id}: a slot inside section 2`);
      const slots = articleImageSlots(scriptBody(script));
      assert.equal(slots.length, 3, `${entry.production.id}: cover + 2 figures`);
      for (const slot of slots.filter((use) => use.role === 'figure')) {
        assert.ok(slot.sourceRefs && slot.sourceRefs.length > 0, `${slot.blockId} has evidence`);
        assert.ok(slot.sourceRefs.every((ref) => resolveSourceRef(entry.sources, ref)), `${slot.blockId} evidence resolves`);
      }
    }
    assert.equal(drafts, 8);
  });

  test('the fixture runs stream slots whole and announce the cover suggestion with the outline', () => {
    const live = record('atelie-sul').runs.flatMap((run) => fixtures.runEvents[run.id] ?? []);
    assert.ok(live.some((event) => event.type === 'outline' && event.cover?.subject), 'the live run announced the cover suggestion');
    const failed = record('horizonte');
    const events = failed.runs.flatMap((run) => fixtures.runEvents[run.id] ?? []);
    const slotIds = new Set(events.flatMap((event) => (event.type === 'block.completed' && event.block.type === 'figure' ? [event.block.id] : [])));
    assert.deepEqual([...slotIds], ['gh-img-1'], 'the failed run wrote the intro slot before stopping');
    assert.ok(!events.some((event) => event.type === 'block.started' && slotIds.has(event.block.id)));
    const draft = failed.pieces.find((piece) => piece.kind === 'article')?.draft.body;
    assert.ok(draft?.type === 'article' && draft.coverSlot?.subject && draft.blocks.some((block) => block.id === 'gh-img-1'), '"v1 · interrompida" keeps them');
  });

  test('approved and delivered articles keep their open slots: the manifest lists them, the files never do', () => {
    const lume = record('lume');
    const approved = lume.versions.filter((version) => version.body.type === 'article' && isApproved(lume, toVersionRef(version)));
    assert.ok(approved.length > 0);
    for (const version of approved) {
      assert.ok(version.body.type === 'article' && manifestImageSuggestions(version.body, version.id).length === 3);
    }
  });

  test('the delivered article reads with its images: cover and both figures filled, credited and authorised', () => {
    const bella = record('bella-passo');
    const approved = bella.versions.filter((version) => version.body.type === 'article' && isApproved(bella, toVersionRef(version)));
    assert.equal(approved.length, 1);
    const body = approved[0].body as ArticleBody;
    assert.equal(manifestImageSuggestions(body, approved[0].id).length, 0, 'no suggestion left open');
    const used = articleAssetIds(body);
    assert.equal(used.length, 3);
    assert.equal(body.cover?.assetId, 'img-bella-passo-par');
    for (const assetId of used) {
      const image = fixtures.images.find((entry) => entry.asset.id === assetId);
      assert.ok(image, assetId);
      assert.equal(image.productionId, bella.production.id);
      assert.ok(image.asset.credit && image.asset.rights.authorized, assetId);
      assert.match(image.src, /^\/samples\/[a-z-]+\.jpg$/);
    }
    assert.deepEqual(createFixtures({ now: fixtures.now, empty: true }).images, []);
  });

  test('every sample image is a JPEG in public/ with the size and dimensions the fixtures declare', () => {
    for (const sample of Object.values(SAMPLE_FILES)) {
      const bytes = readFileSync(new URL(`../../public${sampleSrc(sample)}`, import.meta.url));
      assert.equal(bytes.length, sample.bytes, sample.file);
      assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], `${sample.file} is a JPEG`);
      // The first baseline/progressive frame header carries height then width.
      let at = 2;
      let size: [number, number] | undefined;
      while (at < bytes.length && !size) {
        const marker = bytes[at + 1];
        const length = (bytes[at + 2] << 8) | bytes[at + 3];
        if (marker === 0xc0 || marker === 0xc2) size = [(bytes[at + 7] << 8) | bytes[at + 8], (bytes[at + 5] << 8) | bytes[at + 6]];
        at += 2 + length;
      }
      assert.deepEqual(size, [sample.width, sample.height], sample.file);
    }
  });
});
