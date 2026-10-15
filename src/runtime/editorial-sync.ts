import type { ActivityEvent } from '../domain/activity.ts';
import type { FeedbackEntry } from '../domain/feedback.ts';
import type { PipelineRevision } from '../domain/pipeline.ts';
import type { RunEvent } from '../domain/run-events.ts';
import { stableStringify } from '../domain/text/hash.ts';
import type { BannerDraft, LibraryImage } from '../domain/visual-library.ts';
import type { Member, Person, Workspace } from '../domain/workspace.ts';
import type { ConnectedWorkspace, EditorialCheckpoint, EditorialJob, ServerImageAsset } from '../ports/connected-workspace.ts';
import { PART_FIELDS, PART_KINDS } from '../ports/editorial-rows.ts';
import type { EditorialChanges, EditorialRows, EventRow, ItemKind, ItemRow, JobDoc, LoadedScope, ProductionState, RunRow, WorkspaceDelta } from '../ports/editorial-rows.ts';
export { PART_FIELDS, PART_KINDS };
export type { EditorialChanges, EditorialRows, ItemKind, LoadedScope, PartKind, WorkspaceDelta } from '../ports/editorial-rows.ts';
/**
 * The editorial checkpoint as rows. A command loads only the rows it needs, the unchanged
 * engine runs on the partial state they assemble, and only rows whose content changed are
 * written back. Browsers receive the same rows as deltas.
 */
export class ScopeViolation extends Error {
  constructor(detail: string) { super('SCOPE_VIOLATION'); this.name = 'ScopeViolation'; this.cause = detail; }
}

const itemId = (kind: ItemKind, doc: unknown): string => {
  const value = doc as Record<string, unknown>;
  if (kind === 'member') return String(value.personId);
  if (kind === 'image_asset') return String((value.asset as { id: string }).id);
  return String(value.id);
};
const itemProduction = (kind: ItemKind, doc: unknown, owner: (entity: string) => string | undefined): string | null => {
  const value = doc as Record<string, unknown>;
  if (kind === 'activity' || kind === 'image_asset' || kind === 'citation') return typeof value.productionId === 'string' ? value.productionId : null;
  if (kind !== 'feedback') return null;
  // Feedback names its production directly or through the entity it is about.
  const target = (value.target ?? {}) as Record<string, unknown>;
  if (typeof target.productionId === 'string') return target.productionId;
  for (const name of ['pieceId', 'versionId', 'runId', 'suggestionId']) {
    const production = typeof target[name] === 'string' ? owner(target[name] as string) : undefined;
    if (production) return production;
  }
  return null;
};
const docs = <T,>(items: ItemRow[], kind: ItemKind) => items.filter(item => item.kind === kind).map(item => item.doc as T);
// The visual library lists newest first, as the engine always kept it; rows keep insertion order.
const newest = <T,>(values: T[], at: (value: T) => string) => [...values].sort((left, right) => at(right).localeCompare(at(left)));

/** Rebuilds the engine's checkpoint from loaded rows. Missing collections are simply empty. */
export function assembleCheckpoint(rows: EditorialRows, fallbackWorkspace: Workspace, loaded: LoadedScope): EditorialCheckpoint {
  const pipelines = new Map(rows.pipelines.map(row => [row.hash, row.doc]));
  const events = new Map<string, RunEvent[]>();
  for (const row of rows.events) events.set(row.runId, [...(events.get(row.runId) ?? []), row.event]);
  const productions: ProductionState[] = rows.productions.map(row => {
    const state = { production: row.doc, pieces: [], versions: [], decisions: [], reviewRequests: [], runs: [], suggestions: [], deliveries: [] } as unknown as ProductionState;
    for (const part of rows.parts) if (part.productionId === row.id && !part.deleted) (state[PART_FIELDS[part.kind]] as unknown[]).push(part.doc);
    return state;
  });
  const jobs: Record<string, EditorialJob> = {};
  for (const run of rows.runs) {
    if (!run.job) continue;
    const { pipelineHash, ...job } = run.job;
    const pipeline = pipelineHash ? pipelines.get(pipelineHash) : undefined;
    // A snapshot that was not loaded keeps its hash, so writing the job back never drops it.
    jobs[run.id] = { ...job, events: events.get(run.id) ?? [], attempts: run.attempts ?? 0, availableAt: run.availableAt ?? 0,
      ...(run.lease ? { lease: run.lease } : {}), ...(pipeline ? { pipeline } : pipelineHash ? { pipelineHash } : {}) } as EditorialJob;
  }
  const workspace = rows.workspace;
  const members = docs<Member>(rows.items, 'member');
  const checkpoint: EditorialCheckpoint = {
    // The server adopts the signed-in identity before any command; a worker acts as a member.
    state: { workspace: workspace?.workspace ?? fallbackWorkspace, people: docs<Person>(rows.items, 'person'), members,
      sessionPersonId: members[0]?.personId ?? '', sources: rows.sources.map(row => row.doc), productions,
      activity: docs<ActivityEvent>(rows.items, 'activity'), feedback: docs<FeedbackEntry>(rows.items, 'feedback'), history: [],
      runFolds: Object.fromEntries(rows.runs.map(run => [run.id, run.fold])) },
    jobs,
    imageAssets: docs<ServerImageAsset>(rows.items, 'image_asset'),
  };
  const active = workspace?.pipelineHash ? pipelines.get(workspace.pipelineHash) : undefined;
  if (active) checkpoint.pipeline = active;
  if (loaded.history) checkpoint.pipelineHistory = (workspace?.historyHashes ?? []).map(hash => pipelines.get(hash)).filter((entry): entry is PipelineRevision => Boolean(entry));
  if (loaded.items.includes('citation')) checkpoint.citations = docs(rows.items, 'citation');
  if (loaded.items.includes('library_image') || loaded.items.includes('banner'))
    checkpoint.visuals = { images: newest(docs<LibraryImage>(rows.items, 'library_image'), image => image.createdAt),
      banners: newest(docs<BannerDraft>(rows.items, 'banner'), banner => banner.updatedAt) };
  return checkpoint;
}

/** The rows a checkpoint corresponds to, without ordinals (the database keeps insertion order). */
export function splitCheckpoint(checkpoint: EditorialCheckpoint, previous: EditorialRows, loaded: LoadedScope): EditorialRows {
  const state = checkpoint.state;
  const pipelines = new Map<string, PipelineRevision>();
  const keep = (revision?: PipelineRevision) => { if (revision) pipelines.set(revision.hash, revision); };
  keep(checkpoint.pipeline);
  for (const revision of checkpoint.pipelineHistory ?? []) keep(revision);
  const runs: RunRow[] = [], events: EventRow[] = [];
  for (const [runId, fold] of Object.entries(state.runFolds)) {
    const job = checkpoint.jobs[runId];
    keep(job?.pipeline);
    const productionId = job?.meta.productionId ?? fold.run.productionId;
    if (!job) { runs.push({ id: runId, productionId, status: fold.run.status, job: null, fold }); continue; }
    const { events: jobEvents, attempts, availableAt, lease, pipeline, ...rest } = job;
    const jobDoc: JobDoc = { ...rest, ...(pipeline ? { pipelineHash: pipeline.hash } : {}) };
    for (const event of jobEvents) events.push({ runId, event });
    runs.push({ id: runId, productionId, status: fold.run.status, availableAt, lease: lease ?? null, attempts, job: jobDoc, fold });
  }
  const owners = new Map<string, string>();
  for (const entry of state.productions) for (const kind of PART_KINDS)
    for (const part of entry[PART_FIELDS[kind]] as { id: string }[]) owners.set(part.id, entry.production.id);
  const items: ItemRow[] = [];
  const add = (kind: ItemKind, values: readonly unknown[] | undefined) => {
    for (const doc of values ?? []) items.push({ kind, id: itemId(kind, doc), productionId: itemProduction(kind, doc, id => owners.get(id)), doc });
  };
  add('person', state.people); add('member', state.members); add('activity', state.activity); add('feedback', state.feedback);
  add('image_asset', checkpoint.imageAssets);
  if (loaded.items.includes('citation')) add('citation', checkpoint.citations);
  if (loaded.items.includes('library_image')) add('library_image', checkpoint.visuals?.images);
  if (loaded.items.includes('banner')) add('banner', checkpoint.visuals?.banners);
  return {
    seq: previous.seq,
    workspace: { workspace: state.workspace, ...(checkpoint.pipeline ? { pipelineHash: checkpoint.pipeline.hash } : previous.workspace?.pipelineHash ? { pipelineHash: previous.workspace.pipelineHash } : {}),
      historyHashes: loaded.history ? (checkpoint.pipelineHistory ?? []).map(revision => revision.hash) : previous.workspace?.historyHashes ?? [] },
    productions: state.productions.map(entry => ({ id: entry.production.id, doc: entry.production,
      sourceIds: [...entry.production.sourceIds], archived: Boolean(entry.production.archivedAt) })),
    parts: state.productions.flatMap(entry => PART_KINDS.flatMap(kind => (entry[PART_FIELDS[kind]] as { id: string }[])
      .map(doc => ({ kind, id: doc.id, productionId: entry.production.id, doc })))),
    sources: state.sources.map(doc => ({ id: doc.id, doc })),
    runs, events, items,
    pipelines: [...pipelines].map(([hash, doc]) => ({ hash, doc })),
  };
}

const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);

/** Rows to write: new or changed rows, tombstones for removed loaded rows, new events only. */
export function diffRows(before: EditorialRows, after: EditorialRows, loaded: LoadedScope): EditorialChanges {
  const changes: EditorialChanges = { productions: [], parts: [], sources: [], runs: [], events: [], items: [], pipelines: [] };
  if (!before.workspace || !same(before.workspace, after.workspace)) changes.workspace = after.workspace!;
  const loadedProductions = new Set(before.productions.map(row => row.id));
  const productions = new Map(before.productions.map(row => [row.id, row]));
  for (const row of after.productions) if (!same(productions.get(row.id)?.doc, row.doc)) changes.productions.push(row);
  const partKey = (row: { kind: string; id: string }) => `${row.kind}:${row.id}`;
  const parts = new Map(before.parts.map(row => [partKey(row), row]));
  const kept = new Set<string>();
  for (const row of after.parts) {
    kept.add(partKey(row));
    const previous = parts.get(partKey(row));
    if (previous && same(previous.doc, row.doc)) continue;
    if (!previous && loadedProductions.has(row.productionId) && (!loaded.parts.includes(row.kind) || loaded.partIds && !loaded.partIds.includes(row.id)))
      throw new ScopeViolation(`${row.kind} added outside the loaded scope`);
    changes.parts.push(row);
  }
  for (const row of before.parts) if (!kept.has(partKey(row))) changes.parts.push({ ...row, doc: null, deleted: true });
  const sources = new Map(before.sources.map(row => [row.id, row]));
  for (const row of after.sources) if (!same(sources.get(row.id)?.doc, row.doc)) changes.sources.push(row);
  const runs = new Map(before.runs.map(row => [row.id, row]));
  const lastSeq = new Map<string, number>();
  for (const row of before.runs) lastSeq.set(row.id, row.fold.seq);
  for (const row of before.events) lastSeq.set(row.runId, Math.max(lastSeq.get(row.runId) ?? 0, row.event.seq));
  for (const row of after.runs) {
    const previous = runs.get(row.id);
    if (!previous || !same({ ...previous, productionId: undefined }, { ...row, productionId: undefined })) changes.runs.push(row);
  }
  for (const row of after.events) if (row.event.seq > (lastSeq.get(row.runId) ?? 0)) changes.events.push(row);
  const itemKey = (row: { kind: string; id: string }) => `${row.kind}:${row.id}`;
  const items = new Map(before.items.map(row => [itemKey(row), row]));
  const present = new Set<string>();
  for (const row of after.items) {
    present.add(itemKey(row));
    if (!same(items.get(itemKey(row))?.doc, row.doc)) changes.items.push(row);
  }
  for (const row of before.items) if (loaded.items.includes(row.kind) && !present.has(itemKey(row)))
    changes.items.push({ ...row, doc: null, deleted: true });
  const pipelines = new Set(before.pipelines.map(row => row.hash));
  changes.pipelines = after.pipelines.filter(row => !pipelines.has(row.hash));
  return changes;
}

export function hasChanges(changes: EditorialChanges) {
  return Boolean(changes.workspace) || [changes.productions, changes.parts, changes.sources, changes.runs, changes.events, changes.items, changes.pipelines]
    .some(rows => rows.length > 0);
}

function upsert<T>(list: readonly T[], id: string, idOf: (entry: T) => string, next: T | null): T[] {
  const index = list.findIndex(entry => idOf(entry) === id);
  if (next === null) return index < 0 ? [...list] : [...list.slice(0, index), ...list.slice(index + 1)];
  return index < 0 ? [...list, next] : [...list.slice(0, index), next, ...list.slice(index + 1)];
}

/**
 * Merges a delta into the browser's workspace. Unchanged productions keep their object
 * identity, so cached views stay valid; the result equals a fresh snapshot of the same rows.
 */
export function applyWorkspaceDelta(current: ConnectedWorkspace, delta: WorkspaceDelta): { workspace: ConnectedWorkspace; productionIds: string[] } {
  const touched = new Set<string>();
  const productions = [...current.state.productions];
  const production = (id: string) => productions.findIndex(entry => entry.production.id === id);
  for (const row of delta.productions) {
    touched.add(row.id);
    const index = production(row.id);
    if (index < 0) productions.push({ production: row.doc, pieces: [], versions: [], decisions: [], reviewRequests: [], runs: [], suggestions: [], deliveries: [] } as unknown as ProductionState);
    else productions[index] = { ...productions[index], production: row.doc };
  }
  for (const row of delta.parts) {
    const index = production(row.productionId);
    if (index < 0) continue;
    touched.add(row.productionId);
    const field = PART_FIELDS[row.kind];
    const list = productions[index][field] as unknown as { id: string }[];
    productions[index] = { ...productions[index], [field]: upsert(list, row.id, entry => entry.id, row.deleted ? null : row.doc as { id: string }) };
  }
  let sources = current.state.sources;
  for (const row of delta.sources) sources = upsert(sources, row.id, entry => entry.id, row.doc);
  const runFolds = { ...current.state.runFolds };
  const jobs = { ...current.jobs };
  for (const row of delta.runs) {
    runFolds[row.id] = row.fold;
    touched.add(row.productionId);
    const job = jobs[row.id];
    jobs[row.id] = job ? { ...job, meta: row.job.meta, kind: row.job.kind } : { meta: row.job.meta, kind: row.job.kind, events: [] } as unknown as EditorialJob;
  }
  for (const row of delta.events) {
    const job = jobs[row.runId];
    if (!job || job.events.some(event => event.seq >= row.event.seq)) continue;
    jobs[row.runId] = { ...job, events: [...job.events, row.event] };
  }
  const state = { ...current.state, productions, sources, runFolds };
  let imageAssets = current.imageAssets ?? [];
  for (const row of delta.items) {
    const next = row.deleted ? null : row.doc;
    if (row.kind === 'person') state.people = upsert(state.people, row.id, entry => entry.id, next as Person | null);
    if (row.kind === 'member') state.members = upsert(state.members, row.id, entry => entry.personId, next as Member | null);
    if (row.kind === 'activity') state.activity = upsert(state.activity, row.id, entry => entry.id, next as ActivityEvent | null);
    if (row.kind === 'feedback') state.feedback = upsert(state.feedback, row.id, entry => entry.id, next as FeedbackEntry | null);
    if (row.kind === 'image_asset') imageAssets = upsert(imageAssets, row.id, entry => entry.asset.id, next as ServerImageAsset | null);
    if (row.productionId) touched.add(row.productionId);
  }
  return { workspace: { ...current, state, jobs, imageAssets, revision: delta.seq }, productionIds: [...touched] };
}
