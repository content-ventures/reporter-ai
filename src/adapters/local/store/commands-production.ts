import { emptyArticle } from '../../../domain/article.ts';
import type { PersonId } from '../../../domain/ids.ts';
import type { Piece } from '../../../domain/piece.ts';
import type { Brief, Production } from '../../../domain/production.ts';
import { validateBrief, validatePlan } from '../../../domain/production.ts';
import { ok, refuse } from '../../../domain/result.ts';
import { isRunActive } from '../../../domain/run.ts';
import type { CommandContext, Result } from '../../../domain/result.ts';
import { createTranscriptSource, mapSpeaker, toSourceVersionRef } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import type { FlowDefinition } from '../../../domain/stage.ts';
import { WRITING_FLOW } from '../../../domain/stage.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import type { Person } from '../../../domain/workspace.ts';
import { hasAnyRole } from '../../../domain/workspace.ts';
import type { PersonSummary } from '../../../ports/common.ts';
import type {
  ArchiveRefusal,
  BriefRefusal,
  CreatedProduction,
  CreatedBlankProduction,
  CreateBlankRefusal,
  CreateProductionRefusal,
  PersonDetails,
  PersonRefusal,
  ProductionCommands,
  SpeakerAssignment,
  SpeakersRefusal,
} from '../../../ports/production-commands.ts';
import type { ActivityDraft, LocalStore, Tx } from './local-store.ts';
import { currentMember, isKnownPerson, toPersonSummary } from './people.ts';
import type { ReadContext } from './read-context.ts';
import { findProduction, productionsUsingSource, withProduction, withSource } from './state.ts';
import type { ProductionState, StoreState } from './state.ts';
import { sourceDetail } from './views-piece.ts';

/** Nova produção, title/brief edits, speakers, authorization and archive. */

type ProductionLevelCommands = Pick<
  ProductionCommands,
  'createFromSource' | 'createBlank' | 'rename' | 'updateBrief' | 'updateSpeakers' | 'updatePerson' | 'setMaterialAuthorization' | 'archive'
>;

const PRODUCTION_NOT_FOUND = refuse('not_found', 'Não encontramos esta produção.');
const SOURCE_NOT_FOUND = refuse('not_found', 'Não encontramos este material.');

type PeopleResolution = { people: Person[]; mapping: Record<string, PersonId>; unattributed: string[] };

/** A new person from "Participantes": name, "Cargo ou função" and "Organização". */
function newPerson(details: PersonDetails, ctx: CommandContext): Person | undefined {
  const name = details.name.trim();
  if (!name) return undefined;
  const person: Person = { id: ctx.newId('person'), name };
  const title = details.title?.trim();
  if (title) person.title = title;
  const organization = details.organization?.trim();
  if (organization) person.organization = organization;
  return person;
}

/** Resolves "Falantes": existing people by id, new people created with the production. */
function resolveSpeakers(
  state: StoreState,
  assignments: readonly SpeakerAssignment[],
  ctx: CommandContext,
): Result<PeopleResolution, 'unknown_person'> {
  const people: Person[] = [];
  const mapping: Record<string, PersonId> = {};
  const unattributed: string[] = [];
  for (const assignment of assignments) {
    if (assignment.personId) {
      if (!isKnownPerson(state, assignment.personId)) return refuse('unknown_person', 'Pessoa não encontrada.', { personId: assignment.personId });
      mapping[assignment.label] = assignment.personId;
      continue;
    }
    const person = assignment.newPerson ? newPerson(assignment.newPerson, ctx) : undefined;
    if (person) {
      people.push(person);
      mapping[assignment.label] = person.id;
      continue;
    }
    if (assignment.unattributed) unattributed.push(assignment.label);
  }
  return ok({ people, mapping, unattributed });
}

function authorize(source: Source, authorized: boolean, ctx: CommandContext): Source {
  return {
    ...source,
    rights: authorized ? { authorized: true, authorizedBy: ctx.actorId, authorizedAt: ctx.now } : { authorized: false },
  };
}

function touch(production: ProductionState, patch: Partial<Production>, now: string): ProductionState {
  return { ...production, production: { ...production.production, ...patch, updatedAt: now } };
}

export function createProductionCommands(store: LocalStore, read: () => ReadContext, flow: FlowDefinition): ProductionLevelCommands {
  return {
    async createBlank(input) {
      return store.transact((state, ctx): Tx<CreatedBlankProduction, CreateBlankRefusal> => {
        const member = currentMember(state);
        if (!member || !hasAnyRole(member, ['editor', 'admin'])) return refuse('forbidden', 'Você não tem permissão para criar artigos.');
        const title = input.title.trim();
        if (!title) return refuse('empty_title', 'Dê um título à produção.');
        const brief = validateBrief({ ...input.brief, revision: 1 });
        if (!brief.ok) return brief;
        const production: Production = {
          id: ctx.newId('prod'), workspaceId: state.workspace.id, flowId: WRITING_FLOW.id,
          title, sourceIds: [], brief: brief.value, plan: ['article'], relations: [],
          ownerId: ctx.actorId, createdAt: ctx.now, createdBy: ctx.actorId, updatedAt: ctx.now,
        };
        const article: Piece = {
          id: ctx.newId('piece'), productionId: production.id, kind: 'article', slug: 'article',
          draft: { body: emptyArticle(), revision: 0, inputs: [], sources: [], updatedAt: ctx.now, updatedBy: ctx.actorId },
          createdAt: ctx.now, createdBy: ctx.actorId,
        };
        const entry: ProductionState = {
          production, pieces: [article], versions: [], decisions: [], reviewRequests: [],
          runs: [], suggestions: [], deliveries: [],
        };
        return ok({
          state: { ...state, productions: [...state.productions, entry] },
          value: { productionId: production.id, pieceId: article.id },
          productionIds: [production.id],
          activity: [{ type: 'production.created', productionId: production.id, data: { title } }],
        });
      });
    },

    async createFromSource(input) {
      return store.transact((state, ctx): Tx<CreatedProduction, CreateProductionRefusal> => {
        const title = input.title.trim();
        if (!title) return refuse('empty_title', 'Dê um título interno à produção.');
        const brief = validateBrief({ ...input.brief, revision: 1 });
        if (!brief.ok) return brief;
        const plan = validatePlan(input.plan);
        if (!plan.ok) return plan;
        const ownerId = input.ownerId ?? ctx.actorId;
        if (!isKnownPerson(state, ownerId)) return refuse('unknown_person', 'Responsável não encontrado.', { personId: ownerId });
        const speakers = resolveSpeakers(state, input.speakers ?? [], ctx);
        if (!speakers.ok) return speakers;

        let source: Source;
        const isNewSource = input.reuseSourceId === undefined;
        let newlyAuthorized = input.material.authorized;
        if (input.reuseSourceId !== undefined) {
          const existing = state.sources.find((candidate) => candidate.id === input.reuseSourceId);
          if (!existing) return refuse('unknown_source', 'Material não encontrado.');
          source = Object.entries(speakers.value.mapping).reduce((current, [label, personId]) => mapSpeaker(current, label, personId), existing);
          source = speakers.value.unattributed.reduce((current, label) => mapSpeaker(current, label, 'none'), source);
          newlyAuthorized = input.material.authorized && !existing.rights.authorized;
          if (newlyAuthorized) source = authorize(source, true, ctx);
        } else {
          const parsed = parseTranscript(input.material.text, {
            ...(input.material.format ? { format: input.material.format } : {}),
            ...(input.material.fileName ? { fileName: input.material.fileName } : {}),
          });
          if (parsed.segments.length === 0) return refuse('empty_material', 'Cole ou envie o material antes de continuar.');
          source = createTranscriptSource(
            {
              workspaceId: state.workspace.id,
              title: input.material.title?.trim() || title,
              origin: input.material.origin,
              parsed,
              authorized: input.material.authorized,
              speakerPeople: speakers.value.mapping,
              unattributed: speakers.value.unattributed,
              ...(input.material.recordedOn ? { recordedOn: input.material.recordedOn } : {}),
              ...(input.material.fileName ? { fileName: input.material.fileName } : {}),
            },
            ctx,
          );
        }

        const production: Production = {
          id: ctx.newId('prod'),
          workspaceId: state.workspace.id,
          flowId: flow.id,
          title,
          sourceIds: [source.id],
          brief: brief.value,
          plan: plan.value,
          relations: [],
          ownerId,
          createdAt: ctx.now,
          createdBy: ctx.actorId,
          updatedAt: ctx.now,
        };
        const article: Piece = {
          id: ctx.newId('piece'),
          productionId: production.id,
          kind: 'article',
          slug: 'article',
          draft: { body: emptyArticle(), revision: 0, inputs: [], sources: [toSourceVersionRef(source)], updatedAt: ctx.now, updatedBy: ctx.actorId },
          createdAt: ctx.now,
          createdBy: ctx.actorId,
        };
        const entry: ProductionState = {
          production,
          pieces: [article],
          versions: [],
          decisions: [],
          reviewRequests: [],
          runs: [],
          suggestions: [],
          deliveries: [],
        };
        const sources = isNewSource ? [...state.sources, source] : state.sources.map((candidate) => (candidate.id === source.id ? source : candidate));
        const activity: ActivityDraft[] = [{ type: 'production.created', productionId: production.id, data: { title } }];
        if (isNewSource) {
          activity.push({ type: 'source.added', productionId: production.id, subject: toSourceVersionRef(source), data: { title: source.title } });
        }
        if (newlyAuthorized) {
          activity.push({ type: 'source.authorized', productionId: production.id, subject: toSourceVersionRef(source) });
        }
        return ok({
          state: { ...state, people: [...state.people, ...speakers.value.people], sources, productions: [...state.productions, entry] },
          value: { productionId: production.id, sourceId: source.id, pieces: [{ kind: 'article' as const, pieceId: article.id }] },
          productionIds: [production.id],
          activity,
        });
      });
    },

    async rename(productionId, rawTitle) {
      return store.transact((state, ctx): Tx<{ title: string }, 'not_found' | 'empty_title'> => {
        const production = findProduction(state, productionId);
        if (!production) return PRODUCTION_NOT_FOUND;
        const title = rawTitle.trim();
        if (!title) return refuse('empty_title', 'O título não pode ficar vazio.');
        return ok({ state: withProduction(state, touch(production, { title }, ctx.now)), value: { title }, productionIds: [productionId] });
      });
    },

    async updateBrief(productionId, input, baseRevision) {
      return store.transact((state, ctx): Tx<Brief, BriefRefusal> => {
        const production = findProduction(state, productionId);
        if (!production) return PRODUCTION_NOT_FOUND;
        const current = production.production.brief;
        if (baseRevision !== undefined && baseRevision !== current.revision) {
          return refuse('conflict', 'A pauta mudou depois que você começou a editar. Confira a versão atual e salve de novo.', { expected: current.revision, received: baseRevision });
        }
        const brief = validateBrief({ ...input, revision: current.revision + 1 });
        if (!brief.ok) return brief;
        return ok({ state: withProduction(state, touch(production, { brief: brief.value }, ctx.now)), value: brief.value, productionIds: [productionId] });
      });
    },

    async updateSpeakers(sourceId, mappings) {
      const result = store.transact((state, ctx): Tx<undefined, SpeakersRefusal> => {
        const source = state.sources.find((candidate) => candidate.id === sourceId);
        if (!source) return SOURCE_NOT_FOUND;
        const unknown = mappings.find((mapping) => !source.speakers.some((speaker) => speaker.label === mapping.label));
        if (unknown) return refuse('unknown_speaker', `Falante “${unknown.label}” não aparece no material.`);
        const resolved = resolveSpeakers(
          state,
          mappings
            .filter((mapping) => mapping.personId !== null || mapping.newPerson)
            .map((mapping) => ({ label: mapping.label, ...(mapping.personId ? { personId: mapping.personId } : {}), ...(mapping.newPerson ? { newPerson: mapping.newPerson } : {}) })),
          ctx,
        );
        if (!resolved.ok) return resolved;
        let next = source;
        for (const mapping of mappings) {
          const personId = resolved.value.mapping[mapping.label];
          next = mapSpeaker(next, mapping.label, personId ?? (mapping.unattributed ? 'none' : null));
        }
        return ok({
          state: { ...withSource(state, next), people: [...state.people, ...resolved.value.people] },
          value: undefined,
          productionIds: productionsUsingSource(state, sourceId).map((entry) => entry.production.id),
        });
      });
      if (!result.ok) return result;
      const detail = sourceDetail(read(), sourceId);
      return detail.ok ? ok(structuredClone(detail.value)) : SOURCE_NOT_FOUND;
    },

    async updatePerson(personId, patch) {
      return store.transact((state): Tx<PersonSummary, PersonRefusal> => {
        const current = state.people.find((person) => person.id === personId);
        if (!current) return refuse('not_found', 'Pessoa não encontrada.');
        const next: Person = { ...current };
        if (patch.name !== undefined) {
          const name = patch.name.trim();
          if (!name) return refuse('empty_name', 'Informe o nome da pessoa.');
          next.name = name;
        }
        for (const field of ['title', 'organization'] as const) {
          if (patch[field] === undefined) continue;
          const value = patch[field]?.trim();
          if (value) next[field] = value;
          else delete next[field];
        }
        const sourceIds = new Set(state.sources.filter((source) => source.speakers.some((speaker) => speaker.personId === personId)).map((source) => source.id));
        const productionIds = state.productions.filter((entry) => entry.production.sourceIds.some((id) => sourceIds.has(id))).map((entry) => entry.production.id);
        return ok({
          state: { ...state, people: state.people.map((person) => (person.id === personId ? next : person)) },
          value: toPersonSummary(next),
          productionIds,
        });
      });
    },

    async setMaterialAuthorization(sourceId, authorized) {
      return store.transact((state, ctx): Tx<{ authorized: boolean }, 'not_found'> => {
        const source = state.sources.find((candidate) => candidate.id === sourceId);
        if (!source) return SOURCE_NOT_FOUND;
        const users = productionsUsingSource(state, sourceId).map((entry) => entry.production.id);
        if (source.rights.authorized === authorized) return ok({ state, value: { authorized }, persist: 'none' as const, silent: true });
        const next = authorize(source, authorized, ctx);
        const activity: ActivityDraft[] = authorized
          ? users.map((productionId) => ({ type: 'source.authorized' as const, productionId, subject: toSourceVersionRef(next) }))
          : [];
        return ok({ state: withSource(state, next), value: { authorized }, productionIds: users, activity });
      });
    },

    async archive(productionIds) {
      return store.transact((state, ctx): Tx<{ archived: number }, ArchiveRefusal> => {
        let next = state;
        const activity: ActivityDraft[] = [];
        for (const productionId of new Set(productionIds)) {
          const production = findProduction(next, productionId);
          if (!production) return PRODUCTION_NOT_FOUND;
          if (production.production.archivedAt) continue;
          if (production.runs.some(isRunActive)) {
            return refuse('run_in_progress', `Aguarde a geração de “${production.production.title}” terminar.`);
          }
          next = withProduction(next, touch(production, { archivedAt: ctx.now }, ctx.now));
          activity.push({ type: 'production.archived', productionId });
        }
        return ok({ state: next, value: { archived: activity.length }, productionIds: [...new Set(productionIds)], activity });
      });
    },
  };
}
