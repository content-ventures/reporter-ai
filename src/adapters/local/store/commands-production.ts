import { emptyArticle } from '../../../domain/article.ts';
import { citationDay } from '../../../domain/citation-library.ts';
import type { PersonId } from '../../../domain/ids.ts';
import type { Piece } from '../../../domain/piece.ts';
import type { Brief, Production } from '../../../domain/production.ts';
import { canOpenProduction, validateBrief, validatePlan } from '../../../domain/production.ts';
import { ok, refuse } from '../../../domain/result.ts';
import { isRunActive } from '../../../domain/run.ts';
import type { CommandContext, Result } from '../../../domain/result.ts';
import { createTranscriptSource, mapSpeaker, materialPartHashes, toSourceVersionRef } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import type { FlowDefinition } from '../../../domain/stage.ts';
import { WRITING_FLOW } from '../../../domain/stage.ts';
import { MAX_MATERIAL_PARTS, PART_BREAK, parseTranscript } from '../../../domain/text/transcript-parse.ts';
import type { Person } from '../../../domain/workspace.ts';
import { can, forbidden } from '../../../domain/permissions.ts';
import type { PersonSummary } from '../../../ports/common.ts';
import type {
  ArchiveRefusal,
  BriefRefusal,
  CreatedProduction,
  CreatedBlankProduction,
  CreateBlankRefusal,
  CreateProductionRefusal,
  PersonDetails,
  ProductionMaterialInput,
  PersonRefusal,
  ProductionCommands,
  SpeakerAssignment,
  SpeakersRefusal,
  SourceDateRefusal,
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
  'createFromSource' | 'createBlank' | 'rename' | 'updateBrief' | 'updateSpeakers' | 'updateSourceRecordedOn' | 'updatePerson' | 'setMaterialAuthorization' | 'archive'
>;

const PRODUCTION_NOT_FOUND = refuse('not_found', 'Não encontramos esta produção.');
const SOURCE_NOT_FOUND = refuse('not_found', 'Não encontramos este material.');
const INVALID_PARTS = refuse('invalid_parts', 'As partes do material não conferem. Envie os arquivos de novo.');
const INVALID_MATERIALS = refuse('invalid_materials', 'Não é possível reutilizar uma fonte e incluir outros materiais ao mesmo tempo.');

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

function sourceFromMaterial(input: ProductionMaterialInput, title: string, workspaceId: string, speakers: PeopleResolution, speakerInputs: readonly SpeakerAssignment[], ctx: CommandContext): Result<Source, CreateProductionRefusal> {
  if (!input.text.trim()) return refuse('empty_material', 'Cole ou envie o material antes de continuar.');
  const parsed = parseTranscript(input.text, {
    ...(input.format ? { format: input.format } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
  });
  const sent = input.parts;
  const count = parsed.parts?.length ?? 0;
  if ((sent?.length ?? 0) !== count || (sent && sent.length > MAX_MATERIAL_PARTS) || (!count && input.text.includes(PART_BREAK))) return INVALID_PARTS;
  const empty = parsed.parts?.findIndex((part) => part.segments === 0) ?? -1;
  if (empty >= 0) return refuse('empty_material', `A parte ${empty + 1} não tem falas.`, { part: empty + 1 });
  if (parsed.segments.length === 0) return refuse('empty_material', 'Cole ou envie o material antes de continuar.');
  const hashes = sent ? materialPartHashes(input.text) : undefined;
  const source = createTranscriptSource({
    workspaceId, title: input.title?.trim() || title, kind: input.kind ?? 'transcript', origin: input.origin, parsed,
    authorized: input.authorized, speakerPeople: speakers.mapping, unattributed: speakers.unattributed,
    presentations: Object.fromEntries(speakerInputs.filter(speaker => speaker.presentation).map(speaker => [speaker.label, speaker.presentation!])),
    ...(input.recordedOn ? { recordedOn: input.recordedOn } : {}),
    ...(input.programName ? { programName: input.programName } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(sent && hashes ? { parts: sent.map((part, index) => ({ ...part, hash: hashes[index] })) } : {}),
  }, ctx);
  return ok(input.transcriptId ? { ...source, transcriptId: input.transcriptId } : source);
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
        if (!can(currentMember(state), 'production.create')) return forbidden('production.create');
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
        if (!can(currentMember(state), 'production.create')) return forbidden('production.create');
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

        const additionalMaterials = input.additionalMaterials ?? [];
        if (input.reuseSourceId !== undefined && additionalMaterials.length) return INVALID_MATERIALS;
        let sources: Source[];
        const isNewSource = input.reuseSourceId === undefined;
        let newlyAuthorized = false;
        if (input.reuseSourceId !== undefined) {
          if (input.material.parts) return INVALID_PARTS;
          const existing = state.sources.find((candidate) => candidate.id === input.reuseSourceId);
          if (!existing) return refuse('unknown_source', 'Material não encontrado.');
          let source = Object.entries(speakers.value.mapping).reduce((current, [label, personId]) => mapSpeaker(current, label, personId), existing);
          source = speakers.value.unattributed.reduce((current, label) => mapSpeaker(current, label, 'none'), source);
          if (input.material.transcriptId) source = { ...source, transcriptId: input.material.transcriptId };
          newlyAuthorized = input.material.authorized && !existing.rights.authorized;
          if (newlyAuthorized) source = authorize(source, true, ctx);
          sources = [source];
        } else {
          const materials = [input.material, ...additionalMaterials];
          sources = [];
          for (const [index, material] of materials.entries()) {
            const created = sourceFromMaterial(material, title, state.workspace.id, index === 0 ? speakers.value : { people: [], mapping: {}, unattributed: [] }, index === 0 ? input.speakers ?? [] : [], ctx);
            if (!created.ok) return created;
            sources.push(created.value);
          }
          newlyAuthorized = sources.some(source => source.rights.authorized);
        }
        const source = sources[0];
        const production: Production = {
          id: ctx.newId('prod'),
          workspaceId: state.workspace.id,
          flowId: flow.id,
          title,
          sourceIds: sources.map(source => source.id),
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
          draft: { body: emptyArticle(), revision: 0, inputs: [], sources: sources.map(entry => toSourceVersionRef(entry)), updatedAt: ctx.now, updatedBy: ctx.actorId },
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
        const storedSources = isNewSource ? [...state.sources, ...sources] : state.sources.map((candidate) => (candidate.id === source.id ? source : candidate));
        const activity: ActivityDraft[] = [{ type: 'production.created', productionId: production.id, data: { title } }];
        if (isNewSource) {
          for (const added of sources) {
            activity.push({ type: 'source.added', productionId: production.id, subject: toSourceVersionRef(added), data: { title: added.title } });
            if (added.rights.authorized) activity.push({ type: 'source.authorized', productionId: production.id, subject: toSourceVersionRef(added) });
          }
        }
        if (newlyAuthorized && !isNewSource) {
          activity.push({ type: 'source.authorized', productionId: production.id, subject: toSourceVersionRef(source) });
        }
        return ok({
          state: { ...state, people: [...state.people, ...speakers.value.people], sources: storedSources, productions: [...state.productions, entry] },
          value: { productionId: production.id, sourceId: source.id, pieces: [{ kind: 'article' as const, pieceId: article.id }] },
          productionIds: [production.id],
          activity,
        });
      });
    },

    async rename(productionId, rawTitle) {
      return store.transact((state, ctx): Tx<{ title: string }, 'not_found' | 'forbidden' | 'empty_title'> => {
        if (!can(currentMember(state), 'production.edit')) return forbidden('production.edit');
        const production = findProduction(state, productionId);
        if (!production) return PRODUCTION_NOT_FOUND;
        const title = rawTitle.trim();
        if (!title) return refuse('empty_title', 'O título não pode ficar vazio.');
        return ok({ state: withProduction(state, touch(production, { title }, ctx.now)), value: { title }, productionIds: [productionId] });
      });
    },

    async updateBrief(productionId, input, baseRevision) {
      return store.transact((state, ctx): Tx<Brief, BriefRefusal> => {
        if (!can(currentMember(state), 'production.edit')) return forbidden('production.edit');
        const production = findProduction(state, productionId);
        if (!production) return PRODUCTION_NOT_FOUND;
        const current = production.production.brief;
        if (baseRevision !== undefined && baseRevision !== current.revision) {
          return refuse('conflict', 'A pauta mudou depois que você começou a editar. Confira a versão atual e salve de novo.', { expected: current.revision, received: baseRevision });
        }
        // The drawer edits angle, size and sections: a format and its event stay unless the input sets them.
        const brief = validateBrief({ format: current.format, formatSize: current.formatSize, event: current.event, ...input, revision: current.revision + 1 });
        if (!brief.ok) return brief;
        return ok({ state: withProduction(state, touch(production, { brief: brief.value }, ctx.now)), value: brief.value, productionIds: [productionId] });
      });
    },

    async updateSpeakers(sourceId, mappings) {
      const result = store.transact((state, ctx): Tx<undefined, SpeakersRefusal> => {
        if (!can(currentMember(state), 'production.edit')) return forbidden('production.edit');
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

    async updateSourceRecordedOn(sourceId, recordedOn, baseRecordedOn) {
      return store.transact((state, ctx): Tx<{ recordedOn: string | null }, SourceDateRefusal> => {
        if (!can(currentMember(state), 'production.edit')) return forbidden('production.edit');
        const source = state.sources.find((candidate) => candidate.id === sourceId);
        if (!source) return SOURCE_NOT_FOUND;
        const users = productionsUsingSource(state, sourceId);
        if (users.some(({ production }) => !canOpenProduction(production, currentMember(state))))
          return refuse('forbidden', 'Você precisa de acesso a todas as produções que usam este material para alterar a data.');
        const validDate = (value: unknown) => value === null || typeof value === 'string' && value.length === 10 && citationDay(value);
        if (!validDate(recordedOn) || !validDate(baseRecordedOn)) return refuse('invalid_date', 'Informe uma data válida ou deixe o campo vazio.');
        const previous = source.recordedOn || null;
        if (previous !== baseRecordedOn) return refuse('conflict', 'A data do material mudou depois que você começou a editar. Reabra o contexto para conferir a data atual.');
        if (previous === recordedOn) return ok({ state, value: { recordedOn }, persist: 'none', silent: true });
        const next = { ...source };
        if (recordedOn === null) delete next.recordedOn;
        else next.recordedOn = recordedOn;
        let updated = withSource(state, next);
        for (const production of users) updated = withProduction(updated, touch(production, {}, ctx.now));
        const activity: ActivityDraft[] = users.map(({ production }) => ({
          type: 'source.date_updated', productionId: production.id, subject: toSourceVersionRef(next),
          data: { title: source.title, before: previous ?? '', after: recordedOn ?? '' },
        }));
        return ok({ state: updated, value: { recordedOn }, productionIds: users.map(({ production }) => production.id), activity });
      });
    },

    async updatePerson(personId, patch) {
      return store.transact((state): Tx<PersonSummary, PersonRefusal> => {
        // Everyone edits their own profile; other people are production data.
        const self = personId === state.sessionPersonId && can(currentMember(state), 'profile.edit_self');
        if (!self && !can(currentMember(state), 'production.edit')) return forbidden('production.edit');
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
      return store.transact((state, ctx): Tx<{ authorized: boolean }, 'not_found' | 'forbidden'> => {
        if (!can(currentMember(state), 'production.edit')) return forbidden('production.edit');
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
        if (!can(currentMember(state), 'production.archive')) return forbidden('production.archive');
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
