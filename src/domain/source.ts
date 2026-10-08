import type { ActorId, IsoDateTime, PersonId, SegmentId, SourceId, WorkspaceId } from './ids.ts';
import type { SourceRef, SourceVersionRef } from './refs.ts';
import { ok, refuse } from './result.ts';
import type { CommandContext, Result } from './result.ts';
import { contentHash } from './text/hash.ts';
import { normalizeSpaces } from './text/normalize.ts';
import { segmentIdAt } from './text/transcript-parse.ts';
import type { ParsedTranscript, TranscriptFormat } from './text/transcript-parse.ts';

/** `transcript` is live in R1; the others are reserved plug points (R2 news … R7 event). */
export type SourceKind = 'transcript' | 'news' | 'opportunity' | 'media' | 'event';

export type SourceOrigin = 'interview' | 'podcast' | 'event' | 'talk' | 'other';

/**
 * A transcript speaker label mapped (optionally) to a real person for attribution.
 * `unattributed`: the person chose "Sem atribuição" (quotes stay unnamed); a label with neither
 * is still undecided and counts as "sem pessoa".
 */
export type Speaker = { label: string; personId?: PersonId; unattributed?: true };

/** Labels still waiting for a person (not linked, not explicitly "Sem atribuição"). */
export function speakersWithoutPerson(source: Pick<Source, 'speakers'>): string[] {
  return source.speakers.filter((speaker) => !speaker.personId && !speaker.unattributed).map((speaker) => speaker.label);
}

export type TranscriptSegment = {
  /** Stable across source versions: a correction keeps the id, a new segment gets a new one. */
  id: SegmentId;
  speaker?: string;
  text: string;
  startMs?: number;
  endMs?: number;
};

export type TranscriptContent = { type: 'transcript'; format: TranscriptFormat; segments: TranscriptSegment[] };

/** Version payload per source kind. R2+ add their own members to this union. */
export type SourceContent = TranscriptContent;

export type SourceVersion = {
  number: number;
  hash: string;
  content: SourceContent;
  createdAt: IsoDateTime;
  createdBy: ActorId;
  note?: string;
};

export type SourceRights = {
  /** R1 is "transcrição autorizada": generation stays disabled until this is true (REQ-T.1). */
  authorized: boolean;
  authorizedBy?: PersonId;
  authorizedAt?: IsoDateTime;
  note?: string;
};

export type Source = {
  id: SourceId;
  workspaceId: WorkspaceId;
  kind: SourceKind;
  title: string;
  origin: SourceOrigin;
  /** Calendar date of the interview/event (YYYY-MM-DD), when informed. */
  recordedOn?: string;
  fileName?: string;
  speakers: Speaker[];
  rights: SourceRights;
  /** Ascending by `number`; never empty. */
  versions: SourceVersion[];
  createdAt: IsoDateTime;
  createdBy: ActorId;
};

export function sourceContentHash(content: SourceContent): string {
  return contentHash({
    type: content.type,
    segments: content.segments.map((segment) => ({
      id: segment.id,
      speaker: segment.speaker,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
    })),
  });
}

export function currentSourceVersion(source: Source): SourceVersion {
  return source.versions[source.versions.length - 1];
}

export function sourceVersion(source: Source, number: number): SourceVersion | undefined {
  return source.versions.find((version) => version.number === number);
}

export function toSourceVersionRef(source: Source, version: SourceVersion = currentSourceVersion(source)): SourceVersionRef {
  return { kind: 'source-version', sourceId: source.id, sourceVersion: version.number, hash: version.hash };
}

export function findSegment(source: Source, versionNumber: number, segmentId: SegmentId): TranscriptSegment | undefined {
  return sourceVersion(source, versionNumber)?.content.segments.find((segment) => segment.id === segmentId);
}

export type ResolvedSourceRef = {
  source: Source;
  segment?: TranscriptSegment;
  /** The exact excerpt the reference points at (segment slice, URL excerpt…). */
  excerpt: string;
  speaker?: Speaker;
};

/** Resolves a reference to its excerpt; `undefined` means the evidence is missing. */
export function resolveSourceRef(sources: readonly Source[], ref: SourceRef): ResolvedSourceRef | undefined {
  const source = sources.find((candidate) => candidate.id === ref.sourceId);
  if (!source) return undefined;
  const { locator } = ref;
  if (locator.type === 'url') return { source, excerpt: locator.excerpt };
  if (locator.type !== 'segment') return undefined;
  const segment = findSegment(source, ref.sourceVersion, locator.segmentId);
  if (!segment) return undefined;
  const from = locator.from ?? 0;
  const to = locator.to ?? segment.text.length;
  if (from < 0 || to > segment.text.length || from > to) return undefined;
  const speaker = segment.speaker ? source.speakers.find((entry) => entry.label === segment.speaker) : undefined;
  const resolved: ResolvedSourceRef = { source, segment, excerpt: segment.text.slice(from, to) };
  if (speaker) resolved.speaker = speaker;
  return resolved;
}

export type NewTranscriptSource = {
  workspaceId: WorkspaceId;
  title: string;
  origin: SourceOrigin;
  recordedOn?: string;
  fileName?: string;
  parsed: ParsedTranscript;
  authorized: boolean;
  /** Optional label → person mapping chosen in "Falantes". */
  speakerPeople?: Record<string, PersonId>;
  /** Labels the person marked "Sem atribuição". */
  unattributed?: readonly string[];
};

export function createTranscriptSource(input: NewTranscriptSource, ctx: CommandContext): Source {
  const content: TranscriptContent = {
    type: 'transcript',
    format: input.parsed.format,
    segments: input.parsed.segments.map((segment) => ({ ...segment })),
  };
  const rights: SourceRights = input.authorized
    ? { authorized: true, authorizedBy: ctx.actorId, authorizedAt: ctx.now }
    : { authorized: false };
  const source: Source = {
    id: ctx.newId('src'),
    workspaceId: input.workspaceId,
    kind: 'transcript',
    title: input.title.trim(),
    origin: input.origin,
    speakers: input.parsed.speakers.map((label): Speaker => {
      const personId = input.speakerPeople?.[label];
      if (personId) return { label, personId };
      return input.unattributed?.includes(label) ? { label, unattributed: true } : { label };
    }),
    rights,
    versions: [{ number: 1, hash: sourceContentHash(content), content, createdAt: ctx.now, createdBy: ctx.actorId }],
    createdAt: ctx.now,
    createdBy: ctx.actorId,
  };
  if (input.recordedOn) source.recordedOn = input.recordedOn;
  if (input.fileName) source.fileName = input.fileName;
  return source;
}

/** Corrections for R4 (REQ-4.2): edit text/speaker, remove, or insert segments. */
export type SegmentEdit =
  | { type: 'update'; segmentId: SegmentId; text?: string; speaker?: string | null }
  | { type: 'remove'; segmentId: SegmentId }
  | { type: 'insert'; afterSegmentId: SegmentId | null; text: string; speaker?: string };

function maxSegmentNumber(source: Source): number {
  let max = 0;
  for (const version of source.versions) {
    for (const segment of version.content.segments) {
      const match = /(\d+)$/.exec(segment.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

export type ReviseSourceRefusal = 'unknown_segment' | 'no_changes' | 'empty_text';

/**
 * Creates a new source version. Segment ids are preserved (refs keep resolving) and new
 * segments never reuse an id from any earlier version. Dependent pieces become stale through
 * `versionFreshness` because their versions record the source version they were built from.
 */
export function reviseSource(
  source: Source,
  edits: readonly SegmentEdit[],
  ctx: CommandContext,
  note?: string,
): Result<Source, ReviseSourceRefusal> {
  const current = currentSourceVersion(source);
  let segments = current.content.segments.map((segment) => ({ ...segment }));
  let nextNumber = maxSegmentNumber(source);

  for (const edit of edits) {
    if (edit.type === 'insert') {
      const text = normalizeSpaces(edit.text).trim();
      if (!text) return refuse('empty_text', 'O trecho não pode ficar vazio.');
      nextNumber += 1;
      const inserted: TranscriptSegment = { id: segmentIdAt(nextNumber - 1), text };
      if (edit.speaker) inserted.speaker = edit.speaker;
      const index = edit.afterSegmentId === null ? -1 : segments.findIndex((segment) => segment.id === edit.afterSegmentId);
      if (edit.afterSegmentId !== null && index < 0) {
        return refuse('unknown_segment', 'Trecho não encontrado nesta versão.', { segmentId: edit.afterSegmentId });
      }
      segments = [...segments.slice(0, index + 1), inserted, ...segments.slice(index + 1)];
      continue;
    }
    const index = segments.findIndex((segment) => segment.id === edit.segmentId);
    if (index < 0) return refuse('unknown_segment', 'Trecho não encontrado nesta versão.', { segmentId: edit.segmentId });
    if (edit.type === 'remove') {
      segments = segments.filter((segment) => segment.id !== edit.segmentId);
      continue;
    }
    const updated = { ...segments[index] };
    if (edit.text !== undefined) {
      const text = normalizeSpaces(edit.text).trim();
      if (!text) return refuse('empty_text', 'O trecho não pode ficar vazio.');
      updated.text = text;
    }
    if (edit.speaker === null) delete updated.speaker;
    else if (edit.speaker !== undefined) updated.speaker = edit.speaker;
    segments[index] = updated;
  }

  const content: TranscriptContent = { ...current.content, segments };
  const hash = sourceContentHash(content);
  if (hash === current.hash) return refuse('no_changes', 'Nenhuma alteração no material.');
  const version: SourceVersion = { number: current.number + 1, hash, content, createdAt: ctx.now, createdBy: ctx.actorId };
  if (note) version.note = note;
  const labels = new Set(segments.map((segment) => segment.speaker).filter((label): label is string => Boolean(label)));
  const speakers = [...source.speakers.filter((speaker) => labels.has(speaker.label))];
  for (const label of labels) {
    if (!speakers.some((speaker) => speaker.label === label)) speakers.push({ label });
  }
  return ok({ ...source, speakers, versions: [...source.versions, version] });
}

/** Links a label to a person, marks it "Sem atribuição" (`'none'`), or leaves it undecided (`null`). */
export function mapSpeaker(source: Source, label: string, personId: PersonId | 'none' | null): Source {
  return {
    ...source,
    speakers: source.speakers.map((speaker): Speaker => {
      if (speaker.label !== label) return speaker;
      if (personId === 'none') return { label, unattributed: true };
      return personId ? { label, personId } : { label };
    }),
  };
}

/** Finds an existing source whose any version has the same content hash ("material duplicado"). */
export function findDuplicateSource(sources: readonly Source[], hash: string): Source | undefined {
  return sources.find((source) => source.versions.some((version) => version.hash === hash));
}
