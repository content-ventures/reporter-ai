import type { ActorId, IsoDateTime, PersonId, SegmentId, SourceId, WorkspaceId } from './ids.ts';
import type { SourceRef, SourceVersionRef } from './refs.ts';
import { ok, refuse } from './result.ts';
import type { CommandContext, Result } from './result.ts';
import { contentHash } from './text/hash.ts';
import { normalizeSpaces } from './text/normalize.ts';
import { formatTimestamp, parseTranscript, segmentIdAt, splitTranscriptParts } from './text/transcript-parse.ts';
import type { ParsedTranscript, TranscriptFormat } from './text/transcript-parse.ts';

/** `transcript` is live in R1; the others are reserved plug points (R2 news … R7 event). */
export type SourceKind = 'transcript' | 'news' | 'opportunity' | 'media' | 'event';

export type SourceOrigin = 'interview' | 'podcast' | 'event' | 'talk' | 'other';

/**
 * A transcript speaker label mapped (optionally) to a real person for attribution.
 * `unattributed`: the person chose "Sem atribuição" (quotes stay unnamed); a label with neither
 * is still undecided and counts as "sem pessoa".
 */
export type SpeakerPresentation = { segmentId: SegmentId; excerpt: string };
export type Speaker = { label: string; personId?: PersonId; unattributed?: true; presentation?: SpeakerPresentation };

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
  /** 1-based recording of a material sent in parts. */
  part?: number;
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

/** One recording of a material sent in parts; `startMs` is where it starts on the material's timeline. */
export type SourcePart = { fileName: string; transcriptId?: string; hash: string; startMs?: number; durationMs?: number };

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
  programName?: string;
  sourceUrl?: string;
  location?: string;
  fileName?: string;
  /** Uploaded original and provider transcript in the local database. */
  transcriptId?: string;
  /** The recordings of a material sent in parts (2+ only, in the chosen order). */
  parts?: SourcePart[];
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

/** Content hash each recording would have saved alone (same rule as a single-file source). */
export function materialPartHashes(text: string): string[] | undefined {
  return splitTranscriptParts(text)?.map((part) => {
    const parsed = parseTranscript(part);
    return sourceContentHash({ type: 'transcript', format: parsed.format, segments: parsed.segments });
  });
}

/** Where a segment of a material sent in parts is heard; `startMs` counts inside that part's file. */
export type SegmentPlace = { part: number; count: number; fileName: string; startMs?: number };

export function segmentPlace(source: Pick<Source, 'parts'>, segment: Pick<TranscriptSegment, 'part' | 'startMs'>): SegmentPlace | undefined {
  if (!source.parts || segment.part === undefined) return undefined;
  const part = source.parts[segment.part - 1];
  if (!part) return undefined;
  const place: SegmentPlace = { part: segment.part, count: source.parts.length, fileName: part.fileName };
  if (segment.startMs !== undefined && part.startMs !== undefined) place.startMs = segment.startMs - part.startMs;
  return place;
}

/** "Parte 2 · 03:12", or "Parte 2" when there is no time. */
export function placeLabel(place: Pick<SegmentPlace, 'part' | 'startMs'>, time: (ms: number) => string | undefined = formatTimestamp): string {
  const at = place.startMs === undefined ? undefined : time(place.startMs);
  return at ? `Parte ${place.part} · ${at}` : `Parte ${place.part}`;
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
  programName?: string;
  sourceUrl?: string;
  location?: string;
  fileName?: string;
  parsed: ParsedTranscript;
  /** One entry per recording of a joined material, in the order of `parsed.parts`. */
  parts?: readonly { fileName: string; transcriptId?: string; hash: string }[];
  authorized: boolean;
  /** Optional label → person mapping chosen in "Falantes". */
  speakerPeople?: Record<string, PersonId>;
  /** Labels the person marked "Sem atribuição". */
  unattributed?: readonly string[];
  /** Textually presented participants; never implies attribution of unlabeled audio. */
  presentations?: Readonly<Record<string, SpeakerPresentation>>;
};

export function createTranscriptSource(input: NewTranscriptSource, ctx: CommandContext): Source {
  const presentations = Object.fromEntries(Object.entries(input.presentations ?? {}).filter(([label, evidence]) =>
    evidence.excerpt.includes(label) && input.parsed.segments.some(segment => segment.id === evidence.segmentId && segment.text.includes(evidence.excerpt))));
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
    speakers: [...new Set([...input.parsed.speakers, ...Object.keys(presentations)])].map((label): Speaker => {
      const personId = input.speakerPeople?.[label];
      const speaker: Speaker = personId ? { label, personId } : input.unattributed?.includes(label) ? { label, unattributed: true } : { label };
      if (presentations[label]) speaker.presentation = { ...presentations[label] };
      return speaker;
    }),
    rights,
    versions: [{ number: 1, hash: sourceContentHash(content), content, createdAt: ctx.now, createdBy: ctx.actorId }],
    createdAt: ctx.now,
    createdBy: ctx.actorId,
  };
  if (input.recordedOn) source.recordedOn = input.recordedOn;
  if (input.programName?.trim()) source.programName = input.programName.trim();
  if (input.sourceUrl?.trim()) source.sourceUrl = input.sourceUrl.trim();
  if (input.location?.trim()) source.location = input.location.trim();
  if (input.fileName) source.fileName = input.fileName;
  const read = input.parsed.parts;
  if (input.parts && read && input.parts.length === read.length && read.length > 1) {
    source.parts = input.parts.map(({ fileName, transcriptId, hash }, index): SourcePart => {
      const { startMs, durationMs } = read[index];
      return {
        fileName,
        ...(transcriptId ? { transcriptId } : {}),
        hash,
        ...(startMs !== undefined ? { startMs } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
    });
  }
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
      // A new segment belongs to the recording of the segment before it (or the first one).
      const part = (index < 0 ? segments[0] : segments[index])?.part;
      if (part !== undefined) inserted.part = part;
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
      const presentation = speaker.presentation ? { presentation: speaker.presentation } : {};
      if (personId === 'none') return { label, unattributed: true, ...presentation };
      return personId ? { label, personId, ...presentation } : { label, ...presentation };
    }),
  };
}

/** Finds an existing source whose any version, or any recording sent as a part, has the same content hash ("material duplicado"). */
export function findDuplicateSource(sources: readonly Source[], hash: string): Source | undefined {
  return sources.find((source) => source.versions.some((version) => version.hash === hash) || source.parts?.some((part) => part.hash === hash));
}
