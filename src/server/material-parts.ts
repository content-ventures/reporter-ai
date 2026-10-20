import 'server-only';
import { z } from 'zod';
import { MAX_MATERIAL_PARTS } from '../domain/text/transcript-parse.ts';
import { FlowError } from './errors';

/** The recordings of a material sent in several files, in the order of its joined text. */
export const materialPartsSchema = z.array(z.object({
  fileName: z.string().trim().min(1).max(255),
  transcriptId: z.string().uuid().optional(),
}).strict()).min(2).max(MAX_MATERIAL_PARTS);

/**
 * Every transcript a new material points at. Throws FlowError('MATERIAL_PARTS_INVALID', 422) when
 * the top-level id is not one of the parts' ids, or a part id repeats.
 */
export function materialTranscriptIds(material: { transcriptId?: string; parts?: readonly { transcriptId?: string }[] }): string[] {
  if (!material.parts) return material.transcriptId ? [material.transcriptId] : [];
  const ids = material.parts.flatMap((part) => (part.transcriptId ? [part.transcriptId] : []));
  if (new Set(ids).size !== ids.length) throw new FlowError('MATERIAL_PARTS_INVALID', 422);
  if (material.transcriptId && !ids.includes(material.transcriptId)) throw new FlowError('MATERIAL_PARTS_INVALID', 422);
  return ids;
}
