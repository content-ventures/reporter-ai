import { createLocalPorts, assembleRecord, systemClock } from '../adapters/local/store/index.ts';
import { applyRunUpdate } from '../adapters/local/generation/record-sync.ts';
import { CAROUSEL_TEMPLATES } from '../fixtures/templates/catalog.ts';
import { DEFAULT_FLOW_ID, flowById, gatesFor } from '../registries/index.ts';
import { R1_FLOW } from '../domain/stage.ts';
import { foldRun, stampRunEvent } from '../domain/run-events.ts';
import type { RunEventPayload } from '../domain/run-events.ts';
import type { EditorialCheckpoint, EditorialJob } from '../ports/connected-workspace.ts';
import type { IdGenerator } from '../ports/system.ts';
import { readMaterial, isPleasantry } from '../adapters/local/generation/material.ts';
import { normalizeOutline } from '../adapters/local/generation/outline.ts';
import { segmentRef } from '../domain/refs.ts';
import type { Ref } from '../domain/refs.ts';
import { latestApproved } from '../domain/record.ts';
import { contentHash } from '../domain/text/hash.ts';
import type { ProductionRecord } from '../domain/record.ts';
import type { OutlineInput } from '../ports/generation.ts';
import type { ArticleBody } from '../domain/article.ts';
import { plannedLayouts } from '../domain/carousel.ts';
import type { CarouselTemplate } from '../domain/carousel.ts';
import { ok, refuse } from '../domain/result.ts';
import type { LocalRoleProfile, LocalRoleRefusal, SessionMember } from '../ports/session.ts';
import type { Result } from '../domain/result.ts';
import type { StoreState } from '../adapters/local/store/state.ts';
import type { Role } from '../domain/workspace.ts';
import { toSessionMember } from '../adapters/local/store/people.ts';

export const LOCAL_OPERATOR = '00000000-0000-0000-0000-000000000031';
export const LOCAL_WORKSPACE = '00000000-0000-0000-0000-000000000101';

const LOCAL_ROLE_PROFILES: LocalRoleProfile[] = [
  { id: 'all', label: 'Todos os papéis', roles: ['admin', 'editor', 'approver', 'creative_reviewer'] },
  { id: 'editor', label: 'Editor', roles: ['editor'] },
  { id: 'approver', label: 'Aprovador', roles: ['approver'] },
  { id: 'creative_reviewer', label: 'Revisor criativo', roles: ['creative_reviewer'] },
  { id: 'admin', label: 'Admin', roles: ['admin'] },
];

/** No arbitrary member, identity, workspace or role array can be supplied by the client. */
export function editorialLocalRoleProfiles(state: StoreState): LocalRoleProfile[] {
  const local = state.workspace.id === LOCAL_WORKSPACE && state.workspace.slug === 'reporter-ai-local'
    && state.sessionPersonId === LOCAL_OPERATOR && state.members.some(member => member.personId === LOCAL_OPERATOR
      && member.workspaceId === LOCAL_WORKSPACE && member.localOperator === true);
  return local ? structuredClone(LOCAL_ROLE_PROFILES) : [];
}

export function selectEditorialLocalRole(engine: ReturnType<typeof createEditorialEngine>, profileId: unknown): Result<SessionMember, LocalRoleRefusal> {
  return engine.store.transact(state => {
    const profiles = editorialLocalRoleProfiles(state);
    if (!profiles.length) return refuse('not_local_operator', 'Testar papéis só está disponível para o operador local.');
    const profile = profiles.find(candidate => candidate.id === profileId);
    if (!profile) return refuse('unknown_profile', 'Papel de teste desconhecido.');
    const member = state.members.find(candidate => candidate.personId === LOCAL_OPERATOR)!;
    const updated = { ...member, roles: [...profile.roles] };
    const value = toSessionMember(state, updated);
    if (!value) return refuse('not_local_operator', 'Operador local não encontrado.');
    return ok({ state: { ...state, members: state.members.map(candidate => candidate === member ? updated : candidate) },
      value, scope: 'session', productionIds: [], persist: 'none' });
  });
}
export function editorialTemplates() { return structuredClone(CAROUSEL_TEMPLATES); }
/** A quote-shaped layout is never used to turn indirect prose into an attributed quotation. */
export function editorialCarouselLayouts(template: CarouselTemplate, count: number, article: ArticleBody) {
  const layouts = plannedLayouts(template,count);
  if (article.blocks.some(block => block.type === 'quote')) return layouts;
  const prose = template.layouts.find(layout => layout.id === 'point')
    ?? template.layouts.find(layout => layout.slots.some(slot => slot.role === 'body') && !layout.slots.some(slot => slot.role === 'quote'));
  return layouts.map(layout => layout.slots.some(slot => slot.role === 'quote') && prose ? prose : layout);
}
/** Reject a changed source/brief/template/approved parent instead of attributing it to old inputs. */
export function editorialContextHash(record: ProductionRecord, pieceId: string, inputs: Ref[]): string {
  const body = record.pieces.find(piece => piece.id === pieceId)?.draft.body;
  return contentHash({ brief: record.production.brief, sources: record.sources,
    parents: inputs.filter(ref => ref.kind === 'version').map(ref => latestApproved(record, ref.pieceId)?.ref),
    templateId: body?.type === 'carousel' ? body.templateId : undefined });
}
export function editorialCandidates(record: ProductionRecord) {
  const material = readMaterial(record.sources);
  return material.lines.filter(line => (!material.interviewer || line.speaker !== material.interviewer) && !line.question)
    .flatMap(line => line.sentences.filter(sentence => !isPleasantry(sentence)).map(sentence => ({
      text: sentence.text, speaker: line.speaker,
      ref: segmentRef(line.sourceId,line.sourceVersion,line.segmentId,{ from: sentence.from,to: sentence.to }),
    }))).map((candidate,index) => ({ ...candidate,key: String(index) }));
}
export function validateEditorialOutline(record: ProductionRecord, outline: OutlineInput) {
  return normalizeOutline(outline,{ size: record.production.brief.size,material: readMaterial(record.sources),defaultTitle: () => record.production.title });
}
export type EditorialIdentity = { workspaceId: string;workspaceName: string;workspaceSlug: string;personId: string;name: string;email?: string;avatarUrl?: string;roles: Role[];localOperator?: boolean };
const LOCAL_IDENTITY: EditorialIdentity = { workspaceId: LOCAL_WORKSPACE,workspaceName: 'Repórter AI',workspaceSlug: 'reporter-ai-local',personId: LOCAL_OPERATOR,
  name: 'Operador local',email: 'operator@reporter.local.invalid',roles: ['admin','editor','approver','creative_reviewer'],localOperator: true };

export function emptyEditorialCheckpoint(identity: EditorialIdentity = LOCAL_IDENTITY): EditorialCheckpoint {
  const now = new Date().toISOString();
  return { state: {
    workspace: { id: identity.workspaceId, name: identity.workspaceName, slug: identity.workspaceSlug, createdAt: now },
    people: [{ id: identity.personId, name: identity.name,email: identity.email,avatarUrl: identity.avatarUrl }],
    members: [{ workspaceId: identity.workspaceId, personId: identity.personId, roles: [...identity.roles],...(identity.localOperator ? { localOperator: true as const } : {}) }],
    sessionPersonId: identity.personId, sources: [], productions: [], activity: [], feedback: [], history: [], runFolds: {},
  }, jobs: {} };
}

/** Session identity is server-derived and never accepted from the checkpoint client payload. */
export function adoptEditorialIdentity(checkpoint: EditorialCheckpoint, identity: EditorialIdentity) {
  const state = checkpoint.state;
  state.workspace = { ...state.workspace,id: identity.workspaceId,name: identity.workspaceName,slug: identity.workspaceSlug };
  const person = { id: identity.personId,name: identity.name,email: identity.email,avatarUrl: identity.avatarUrl };
  state.people = [...state.people.filter(candidate => candidate.id !== identity.personId),person];
  const member = { workspaceId: identity.workspaceId,personId: identity.personId,roles: [...identity.roles],...(identity.localOperator ? { localOperator: true as const } : {}) };
  state.members = [...state.members.filter(candidate => candidate.personId !== identity.personId),member];
  state.sessionPersonId = identity.personId;
}
/** Tested domain commands execute on the server without a UI dependency. */
export function createEditorialEngine(checkpoint: EditorialCheckpoint, ids: IdGenerator) {
  const state = checkpoint.state;
  return createLocalPorts({
    seed: () => ({ ...state, records: state.productions.map(p => assembleRecord(state, p)) }),
    clock: systemClock(), ids, templates: CAROUSEL_TEMPLATES,
    flow: flowById(DEFAULT_FLOW_ID) ?? R1_FLOW, gates: gatesFor(), recoverOrphanedRuns: false,
  });
}
export function appendEditorialEvent(engine: ReturnType<typeof createEditorialEngine>, job: EditorialJob, payload: RunEventPayload) {
  const event = stampRunEvent(payload, job.meta.runId, job.events.length + 1, new Date().toISOString());
  job.events.push(event);
  const fold = foldRun(job.events);
  if (!fold) throw new Error('INVALID_RUN_STREAM');
  const result = engine.records.apply(job.meta.productionId, (record, ctx) => applyRunUpdate(record, {
    meta: job.meta, fold, event,
  }, ctx), { runFold: fold, persist: 'none' });
  if (!result.ok) throw new Error('RUN_PRODUCTION_MISSING');
  return fold;
}
