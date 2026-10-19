import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorialEngine, editorialLocalRoleProfiles, selectEditorialLocalRole, emptyEditorialCheckpoint, adoptEditorialIdentity, LOCAL_OPERATOR, LOCAL_WORKSPACE, editorialCandidates, appendEditorialEvent, editorialContextHash, editorialCarouselLayouts, editorialTemplates } from './editorial-engine.ts';
import { refKey } from '../domain/refs.ts';
import { plannedLayouts } from '../domain/carousel.ts';
import { contentHash } from '../domain/text/hash.ts';
import { toVersionRef } from '../domain/piece.ts';
import type { EditorialJob } from '../ports/connected-workspace.ts';

let sequence = 0;
const ids = { next: (prefix: string) => prefix+'-'+(++sequence) };
const material = 'Material sintético. A biblioteca oferecerá quatro oficinas gratuitas em novembro. As inscrições ainda não estão abertas. A programação depende da confirmação dos voluntários. Nenhum resultado foi medido.';
const input = { title: 'Teste sintético de integração',material: { text: material,origin: 'podcast' as const,authorized: true,transcriptId: '00000000-0000-0000-0000-000000000999' },brief: { sections: 2,size: 'short' as const },plan: ['article' as const,'carousel' as const] };

test('bounded local test profiles change roles without changing identity, productions or two-person policy', async () => {
  const engine = createEditorialEngine(emptyEditorialCheckpoint(), ids);
  const profiles = editorialLocalRoleProfiles(engine.store.state);
  assert.deepEqual(profiles.map(profile => profile.id), ['all', 'editor', 'approver', 'creative_reviewer', 'admin']);
  profiles[0].roles.length = 0;
  assert.equal(editorialLocalRoleProfiles(engine.store.state)[0].roles.length, 4);
  for (const profile of editorialLocalRoleProfiles(engine.store.state)) {
    const selected = selectEditorialLocalRole(engine, profile.id);
    assert.ok(selected.ok);
    assert.equal(selected.value.id, LOCAL_OPERATOR);
    assert.deepEqual(selected.value.roles, profile.roles);
    assert.equal(engine.store.state.members[0].localOperator, true);
    assert.equal(engine.store.state.productions.length, 0);
  }
  const before = contentHash(engine.store.state);
  assert.equal(selectEditorialLocalRole(engine, 'root').ok, false);
  assert.equal(selectEditorialLocalRole(engine, { personId: LOCAL_OPERATOR, roles: ['admin'] }).ok, false);
  assert.equal(contentHash(engine.store.state), before);
  selectEditorialLocalRole(engine, 'editor');
  const created = await engine.commands.createFromSource(input); assert.ok(created.ok);
  const id = created.value.pieces.find(piece => piece.kind === 'article')!.pieceId;
  await engine.commands.saveDraft(id, { type: 'article', title: 'Teste fictício', blocks: [{ id: 'p', type: 'paragraph', inlines: [{ text: material }], ai: 'reviewed' }] }, 0);
  const requested = await engine.commands.requestReview(id, { assigneeId: LOCAL_OPERATOR }); assert.ok(requested.ok);
  assert.equal((await engine.queries.approvals('to_approve')).items.length, 0, 'Editor has no approval tasks');
  selectEditorialLocalRole(engine, 'editor');
  const denied = await engine.commands.decide({ pieceId: id, subject: requested.value.request.subject, decision: 'approved', displayedHash: requested.value.request.subject.hash });
  assert.equal(denied.ok, false);
  assert.equal(engine.store.state.productions[0].decisions.length, 0);
  selectEditorialLocalRole(engine, 'approver');
  const readyToReview = await engine.queries.get(created.value.productionId);
  assert.ok(readyToReview.ok);
  assert.equal(readyToReview.value.nextStep?.label, 'Revisar');
  assert.equal((await engine.queries.approvals('to_approve')).items[0]?.pieceId, id);
  assert.ok((await engine.commands.decide({ pieceId: id, subject: requested.value.request.subject, decision: 'approved', displayedHash: requested.value.request.subject.hash })).ok);
  selectEditorialLocalRole(engine, 'editor');
  const carousel = await engine.commands.derive({ productionId: created.value.productionId, kind: 'carousel', from: requested.value.request.subject });
  assert.ok(carousel.ok);
  const carouselId = carousel.value.pieceId;
  const carouselBody = engine.records.record(created.value.productionId)!.pieces.find(piece => piece.id === carouselId)!.draft.body;
  assert.ok(carouselBody.type === 'carousel');
  const template = editorialTemplates().find(template => template.id === carouselBody.templateId)!;
  const filled = { ...carouselBody, slides: plannedLayouts(template, template.minSlides).map((layout, index) => ({
    id: 'test-slide-' + index, layout: layout.id, slots: Object.fromEntries(layout.slots.map(slot => [slot.id, 'Texto sintético.'])),
    sourceBlockIds: ['p'], ai: 'reviewed' as const,
  })) };
  assert.ok((await engine.commands.saveDraft(carouselId, filled, 0)).ok);
  const carouselReview = await engine.commands.requestReview(carouselId, { assigneeId: LOCAL_OPERATOR });
  assert.ok(carouselReview.ok, !carouselReview.ok ? carouselReview.refusal.message : '');
  selectEditorialLocalRole(engine, 'approver');
  const carouselSubject = carouselReview.value.request.subject;
  assert.equal((await engine.queries.approvals('to_approve')).items[0]?.pieceId, carouselId);
  assert.ok((await engine.commands.decide({ pieceId: carouselId, subject: carouselSubject, decision: 'approved', displayedHash: carouselSubject.hash })).ok);
  engine.store.dispose();
});

test('ordinary members, another workspace and another identity cannot select local operator profiles', () => {
  for (const variant of ['ordinary', 'workspace', 'identity', 'slug']) {
    const checkpoint = emptyEditorialCheckpoint();
    if (variant === 'ordinary') delete checkpoint.state.members[0].localOperator;
    if (variant === 'workspace') checkpoint.state.workspace.id = 'another-workspace';
    if (variant === 'identity') checkpoint.state.sessionPersonId = 'another-person';
    if (variant === 'slug') checkpoint.state.workspace.slug = 'production';
    const engine = createEditorialEngine(checkpoint, ids), before = contentHash(engine.store.state);
    assert.deepEqual(editorialLocalRoleProfiles(engine.store.state), []);
    const refused = selectEditorialLocalRole(engine, 'all');
    assert.equal(!refused.ok && refused.refusal.code, 'not_local_operator');
    assert.equal(contentHash(engine.store.state), before);
    engine.store.dispose();
  }
});

test('trusted local identity restores the test capability and preserves a selected profile across requests', () => {
  const checkpoint = emptyEditorialCheckpoint();
  const identity = { workspaceId: LOCAL_WORKSPACE, workspaceName: 'Local', workspaceSlug: 'reporter-ai-local',
    personId: LOCAL_OPERATOR, name: 'Operador local', roles: ['admin', 'editor', 'approver', 'creative_reviewer'] as typeof checkpoint.state.members[0]['roles'], localOperator: true };
  delete checkpoint.state.members[0].localOperator; // Legacy requests erased this server-owned marker.
  adoptEditorialIdentity(checkpoint, identity);
  assert.equal(checkpoint.state.members[0].localOperator, true);
  const engine = createEditorialEngine(checkpoint, ids);
  try {
    assert.ok(selectEditorialLocalRole(engine, 'editor').ok);
    checkpoint.state = engine.store.state;
    adoptEditorialIdentity(checkpoint, identity);
    assert.deepEqual(checkpoint.state.members[0].roles, ['editor']);
    const reloaded = createEditorialEngine(JSON.parse(JSON.stringify(checkpoint)), ids);
    try {
      assert.ok(selectEditorialLocalRole(reloaded, 'approver').ok);
      checkpoint.state = reloaded.store.state;
      adoptEditorialIdentity(checkpoint, identity);
      assert.deepEqual(checkpoint.state.members[0].roles, ['approver', 'creative_reviewer']);
      assert.equal(checkpoint.state.sessionPersonId, LOCAL_OPERATOR);
    } finally { reloaded.store.dispose(); }
    adoptEditorialIdentity(checkpoint, { ...identity, localOperator: undefined, roles: ['editor'] });
    assert.deepEqual(checkpoint.state.members[0].roles, ['editor'], 'cloud identity roles replace checkpoint roles');
    assert.equal(checkpoint.state.members[0].localOperator, undefined, 'a cloud identity never receives local approval exceptions');
  } finally { engine.store.dispose(); }
});

test('connected workspace starts empty, has one local operator and never imports demo productions', () => {
  const state = emptyEditorialCheckpoint();
  assert.equal(state.state.productions.length,0);
  assert.deepEqual(state.state.people.map(p => p.id),[LOCAL_OPERATOR]);
  assert.equal(state.state.members[0].localOperator,true);
  assert.deepEqual(state.jobs,{});
});

test('editorial commands survive a JSON checkpoint with the uploaded transcript reference', async () => {
  const checkpoint = emptyEditorialCheckpoint(),engine = createEditorialEngine(checkpoint,ids);
  const created = await engine.commands.createFromSource(input);
  assert.ok(created.ok);
  const record = engine.records.record(created.value.productionId)!;
  assert.equal(record.sources[0].transcriptId,input.material.transcriptId);
  checkpoint.state = engine.store.state;
  const restored = createEditorialEngine(JSON.parse(JSON.stringify(checkpoint)),ids);
  assert.equal(contentHash(restored.store.state),contentHash(engine.store.state));
  assert.ok((await restored.queries.get(created.value.productionId)).ok);
  assert.ok(editorialCandidates(record).length>=4);
  const candidate = editorialCandidates(record)[1].ref;
  const reordered = Object.fromEntries(Object.entries(candidate).reverse()) as typeof candidate;
  assert.equal(refKey(candidate),refKey(reordered));
  engine.store.dispose(); restored.store.dispose();
});

test('generation context detects changes to the brief and source authorization', async () => {
  const engine = createEditorialEngine(emptyEditorialCheckpoint(),ids);
  const created = await engine.commands.createFromSource(input); assert.ok(created.ok);
  const before = engine.records.record(created.value.productionId)!;
  const pieceId = before.pieces[0].id, hash = editorialContextHash(before,pieceId,[]);
  assert.notEqual(hash,editorialContextHash({ ...before,production: { ...before.production,brief: { ...before.production.brief,sections: 3 } } },pieceId,[]));
  assert.notEqual(hash,editorialContextHash({ ...before,sources: before.sources.map(source => ({ ...source,rights: { ...source.rights,authorized: false } })) },pieceId,[]));
  engine.store.dispose();
});

test('without a literal quote, the carousel uses an existing prose layout instead of fabricating a quotation', () => {
  const template = editorialTemplates()[0];
  const layouts = editorialCarouselLayouts(template,5,{ type: 'article',title: 'Simulação',blocks: [{ id: 'p',type: 'paragraph',inlines: [{ text: 'Prosa indireta, não uma citação.' }] }] });
  assert.equal(layouts.length,5);
  assert.ok(layouts.every(layout => layout.slots.every(slot => slot.role !== 'quote')));
});

test('a writer can derive each Seafood variation from the exact approved article, and the engine keeps that template for generation', async () => {
  const templates = editorialTemplates().filter(template => template.id.startsWith('tpl-seafood-'));
  assert.equal(templates.length, 10);
  for (const template of templates) {
    const engine = createEditorialEngine(emptyEditorialCheckpoint(), ids);
    const created = await engine.commands.createFromSource(input); assert.ok(created.ok);
    const articleId = created.value.pieces.find(piece => piece.kind === 'article')!.pieceId;
    const body = { type: 'article' as const, title: 'Teste fictício de escolha', blocks: [{ id: 'p', type: 'paragraph' as const, inlines: [{ text: material }], ai: 'reviewed' as const }] };
    assert.ok((await engine.commands.saveDraft(articleId, body, 0)).ok);
    const sent = await engine.commands.requestReview(articleId, { assigneeId: LOCAL_OPERATOR }); assert.ok(sent.ok);
    const subject = sent.value.request.subject;
    assert.ok((await engine.commands.decide({ pieceId: articleId, subject, decision: 'approved', displayedHash: subject.hash })).ok);
    assert.ok(selectEditorialLocalRole(engine, 'editor').ok);
    const derived = await engine.commands.derive({ productionId: created.value.productionId, kind: 'carousel', from: subject, templateId: template.id }); assert.ok(derived.ok);
    const draft = engine.records.record(created.value.productionId)!.pieces.find(piece => piece.id === derived.value.pieceId)!.draft.body;
    assert.ok(draft?.type === 'carousel');
    assert.equal(draft.templateId, template.id);
    assert.ok(editorialCarouselLayouts(template, 5, body).every(layout => layout.slots.every(slot => slot.role !== 'quote')), 'even a Podcast design must not invent a quotation');
    engine.store.dispose();
  }
});

test('the local operator manually requests and approves one exact version; normal two-person policy remains enabled', async () => {
  const checkpoint = emptyEditorialCheckpoint(),engine = createEditorialEngine(checkpoint,ids);
  const created = await engine.commands.createFromSource(input); assert.ok(created.ok);
  const pieceId = created.value.pieces.find(piece => piece.kind === 'article')!.pieceId;
  const body = { type: 'article' as const,title: 'Simulação de oficinas',blocks: [{ id: 'p',type: 'paragraph' as const,inlines: [{ text: material }],ai: 'reviewed' as const }] };
  assert.ok((await engine.commands.saveDraft(pieceId,body,0)).ok);
  const sent = await engine.commands.requestReview(pieceId,{ assigneeId: LOCAL_OPERATOR }); assert.ok(sent.ok);
  const subject = sent.value.request.subject;
  const decision = await engine.commands.decide({ pieceId,subject,decision: 'approved',displayedHash: subject.hash }); assert.ok(decision.ok);
  assert.ok(decision.value.subject.kind === 'version');
  assert.equal(decision.value.subject.versionId,subject.versionId);
  assert.ok((await engine.commands.derive({ productionId: created.value.productionId,kind: 'carousel',from: subject })).ok);
  engine.store.dispose();
  const ordinary = emptyEditorialCheckpoint(); delete ordinary.state.members[0].localOperator;
  // Without admin (who runs the flow alone), the two-person gate holds.
  ordinary.state.members[0].roles = ordinary.state.members[0].roles.filter(role => role !== 'admin');
  const normal = createEditorialEngine(ordinary,ids);
  const p = await normal.commands.createFromSource(input); assert.ok(p.ok);
  const id = p.value.pieces.find(piece => piece.kind === 'article')!.pieceId;
  await normal.commands.saveDraft(id,body,0);
  const denied = await normal.commands.requestReview(id,{ assigneeId: LOCAL_OPERATOR });
  assert.equal(!denied.ok && denied.refusal.code,'self_assign');
  normal.store.dispose();
});

test('real generation events settle one immutable version, require review, and retain provider provenance', async () => {
  const checkpoint = emptyEditorialCheckpoint(),engine = createEditorialEngine(checkpoint,ids);
  const created = await engine.commands.createFromSource(input); assert.ok(created.ok);
  const pieceId = created.value.pieces.find(p => p.kind === 'article')!.pieceId;
  const begin = engine.runs.begin({ productionId: created.value.productionId,kind: 'article.generate',prompt: { key: 'groq.article',version: '2',hash: 'prompt' },model: { alias: 'groq-model',label: 'Groq',engine: 'provider' },steps: [{ id: 'generate',label: 'Gerar artigo' }] });
  assert.ok(begin.ok); const run = begin.value.run;
  const job: EditorialJob = { kind: 'article.draft',input: { productionId: created.value.productionId,pieceId },attempts: 1,availableAt: 0,events: [],meta: { runId: run.id,productionId: created.value.productionId,pieceId,label: 'Gerar artigo',request: { kind: 'article.draft',input: { productionId: created.value.productionId,pieceId } } } };
  appendEditorialEvent(engine,job,{ type: 'run.started',kind: run.kind,productionId: run.productionId,pieceId,model: run.model,prompt: run.prompt,inputs: run.inputs,steps: [{ id: 'generate',label: 'Gerar artigo' }],createdBy: LOCAL_OPERATOR });
  appendEditorialEvent(engine,job,{ type: 'outline',title: 'Oficinas fictícias previstas',sections: [] });
  const candidate = editorialCandidates(engine.records.record(run.productionId)!)[1];
  appendEditorialEvent(engine,job,{ type: 'block.started',block: { id: 'block-real',type: 'paragraph' } });
  appendEditorialEvent(engine,job,{ type: 'block.completed',block: { id: 'block-real',type: 'paragraph',inlines: [{ text: 'Em uma simulação, a biblioteca prevê oficinas gratuitas em novembro.' }],sourceRefs: [candidate.ref],ai: 'unreviewed' } });
  appendEditorialEvent(engine,job,{ type: 'run.completed' });
  const record = engine.records.record(run.productionId)!;
  assert.equal(record.versions.length,1); assert.equal(record.versions[0].origin,'generation');
  assert.equal(record.runs[0].model.engine,'provider'); assert.equal(record.decisions.length,0);
  assert.equal((await engine.commands.derive({ productionId: run.productionId,kind: 'carousel',from: toVersionRef(record.versions[0]) })).ok,false);
  engine.store.dispose();
});

test('events continue from the stored fold when the job carries only events not yet persisted', async () => {
  const checkpoint = emptyEditorialCheckpoint(),engine = createEditorialEngine(checkpoint,ids);
  const created = await engine.commands.createFromSource(input); assert.ok(created.ok);
  const pieceId = created.value.pieces.find(p => p.kind === 'article')!.pieceId;
  const begin = engine.runs.begin({ productionId: created.value.productionId,kind: 'article.generate',prompt: { key: 'groq.article',version: '2',hash: 'prompt' },model: { alias: 'groq-model',label: 'Groq',engine: 'provider' },steps: [{ id: 'generate',label: 'Gerar artigo' }] });
  assert.ok(begin.ok); const run = begin.value.run;
  const meta = { runId: run.id,productionId: created.value.productionId,pieceId,label: 'Gerar artigo',request: { kind: 'article.draft' as const,input: { productionId: created.value.productionId,pieceId } } };
  const persisted: EditorialJob = { kind: 'article.draft',input: meta.request.input,attempts: 1,availableAt: 0,events: [],meta };
  appendEditorialEvent(engine,persisted,{ type: 'run.started',kind: run.kind,productionId: run.productionId,pieceId,model: run.model,prompt: run.prompt,inputs: run.inputs,steps: [{ id: 'generate',label: 'Gerar artigo' }],createdBy: LOCAL_OPERATOR });
  appendEditorialEvent(engine,persisted,{ type: 'outline',title: 'Oficinas fictícias previstas',sections: [] });
  // A later transaction loads the fold but none of the two stored events.
  const resumed: EditorialJob = { ...persisted,events: [] };
  const fold = appendEditorialEvent(engine,resumed,{ type: 'run.completed' });
  assert.deepEqual(resumed.events.map(event => event.seq),[3],'numbering continues after the persisted events');
  assert.equal(fold.seq,3);
  assert.equal(fold.title,'Oficinas fictícias previstas','the stored fold keeps earlier events');
  assert.equal(fold.run.status,'completed');
  engine.store.dispose();
});
