import { parseTranscript, segmentRef, sourceContentHash } from '../../domain/index.ts';
import type {
  ActorId,
  IsoDateTime,
  PersonId,
  Source,
  SourceId,
  SourceOrigin,
  SourceRef,
  TranscriptContent,
} from '../../domain/index.ts';
import { WORKSPACE_ID } from '../people.ts';

/**
 * Builds fixture sources with the same parser the product uses, so segment ids, speakers and
 * timestamps are exactly what a real upload of the same text would produce.
 */

export type TranscriptSpec = {
  id: SourceId;
  title: string;
  origin: SourceOrigin;
  text: string;
  fileName?: string;
  /** Speaker label → person (the "Falantes" mapping). Unmapped labels stay as plain labels. */
  speakers: Record<string, PersonId>;
  authorized: boolean;
  recordedOn?: string;
  createdAt: IsoDateTime;
  createdBy: ActorId;
  /** Who confirmed the authorisation (defaults to the creator). */
  authorizedBy?: PersonId;
  /** Rights note shown next to the switch ("Aguardando o termo de uso assinado"). */
  rightsNote?: string;
};

export function buildTranscriptSource(spec: TranscriptSpec): Source {
  const parsed = parseTranscript(spec.text, spec.fileName ? { fileName: spec.fileName } : {});
  if (parsed.segments.length === 0) throw new Error(`Fixture source ${spec.id} has no segments`);
  const content: TranscriptContent = { type: 'transcript', format: parsed.format, segments: parsed.segments.map((segment) => ({ ...segment })) };
  const source: Source = {
    id: spec.id,
    workspaceId: WORKSPACE_ID,
    kind: 'transcript',
    title: spec.title,
    origin: spec.origin,
    speakers: parsed.speakers.map((label) => {
      const personId = spec.speakers[label];
      return personId ? { label, personId } : { label };
    }),
    rights: spec.authorized
      ? { authorized: true, authorizedBy: spec.authorizedBy ?? spec.createdBy, authorizedAt: spec.createdAt }
      : { authorized: false },
    versions: [{ number: 1, hash: sourceContentHash(content), content, createdAt: spec.createdAt, createdBy: spec.createdBy }],
    createdAt: spec.createdAt,
    createdBy: spec.createdBy,
  };
  if (spec.rightsNote) source.rights = { ...source.rights, note: spec.rightsNote };
  if (spec.recordedOn) source.recordedOn = spec.recordedOn;
  if (spec.fileName) source.fileName = spec.fileName;
  return source;
}

/**
 * Evidence pointer to an exact excerpt of the current source version. The excerpt must occur
 * exactly once in exactly one segment: fixtures fail loudly instead of pointing at the wrong line.
 */
export function excerptRef(source: Source, excerpt: string): SourceRef {
  const version = source.versions[source.versions.length - 1];
  const hits: { segmentId: string; from: number }[] = [];
  for (const segment of version.content.segments) {
    let from = segment.text.indexOf(excerpt);
    while (from >= 0) {
      hits.push({ segmentId: segment.id, from });
      from = segment.text.indexOf(excerpt, from + 1);
    }
  }
  if (hits.length !== 1) {
    throw new Error(`Excerpt must occur exactly once in ${source.id} (found ${hits.length}): "${excerpt}"`);
  }
  const [hit] = hits;
  return segmentRef(source.id, version.number, hit.segmentId, { from: hit.from, to: hit.from + excerpt.length });
}
