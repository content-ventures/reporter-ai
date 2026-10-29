import type { MemoryEvidence } from './editorial-memory.ts';
import type { CommandContext } from './result.ts';

/** Change availability/context only. Both literal observations, periods and original anchors survive. */
export function replaceMemoryEvidence(previous: MemoryEvidence, current: MemoryEvidence, reason: string, ctx: CommandContext) {
  if (!reason.trim()) throw new Error('MEMORY_REASON_REQUIRED');
  if (previous.id === current.id || previous.workspaceId !== current.workspaceId || previous.kind !== current.kind
    || previous.status !== 'active' || current.status !== 'active'
    || previous.deduplication?.state === 'pending' || current.deduplication?.state === 'pending') throw new Error('MEMORY_REPLACEMENT_INVALID');
  if (previous.kind === 'citation' && (previous.anchor.source.sourceId !== current.anchor.source.sourceId
    || previous.anchor.source.sourceVersion >= current.anchor.source.sourceVersion)) throw new Error('MEMORY_REPLACEMENT_ORIGINAL');
  const correction = { reason: 'Substituição editorial registrada.', personId: ctx.actorId, at: ctx.now };
  return { previous: { ...structuredClone(previous), status: 'superseded' as const, revision: previous.revision + 1, updatedAt: ctx.now, correction },
    current: { ...structuredClone(current), revision: current.revision + 1, updatedAt: ctx.now, correction } };
}
