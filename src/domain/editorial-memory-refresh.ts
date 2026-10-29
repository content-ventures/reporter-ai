import type { ArticleBody } from './article.ts';
import type { MemorySelection, MemorySourceBinding } from './editorial-memory.ts';
import { prepareMemoryWriting, type MemoryWritingItem } from './editorial-memory-writing.ts';
import type { Source, SourceVersion, TranscriptContent } from './source.ts';
import { currentSourceVersion, resolveSourceRef, sourceContentHash, toSourceVersionRef } from './source.ts';
import { sameRef, type SourceVersionRef } from './refs.ts';
import { ok, refuse, type CommandContext, type Result } from './result.ts';

export type MemoryRefreshConcern = { blockId: string; evidenceId: string | null; reason: 'changed' | 'removed' | 'unresolved' | 'kept' };
export type MemoryRefresh = { source: Source; body: ArticleBody; updatedReferences: number; concerns: MemoryRefreshConcern[]; retired: boolean };
type Replacement = { selection: MemorySelection; items: MemoryWritingItem[] } | null;
type Refusal = 'source_changed' | 'invalid_selection' | 'evidence_not_ready' | 'no_changes' | 'reason_required';

/** Append a collection version. Earlier evidence, words, speaker mappings and approvals stay immutable. */
export function refreshMemoryWriting(source: Source, expected: SourceVersionRef, replacement: Replacement, body: ArticleBody,
  updateDraftReferences: boolean, reason: string, ctx: CommandContext): Result<MemoryRefresh, Refusal> {
  if (!reason.trim()) return refuse('reason_required', 'Informe o motivo da atualização.');
  const current = currentSourceVersion(source), previous = source.memory?.find(receipt => receipt.version.number === current.number && receipt.version.hash === current.hash);
  if (!previous || !sameRef(toSourceVersionRef(source), expected) || sourceContentHash(current.content) !== current.hash)
    return refuse('source_changed', 'A fonte mudou. Atualize a consulta antes de continuar.');
  if (!replacement && previous.retired) return refuse('no_changes', 'Esta fonte já foi retirada das próximas gerações.');
  if (replacement && replacement.selection.workspaceId !== source.workspaceId) return refuse('invalid_selection', 'A seleção não pertence a este cliente.');
  let content: TranscriptContent = { type: 'transcript', format: 'plain', segments: [] }, receipt: MemorySourceBinding;
  const speakers = structuredClone(source.speakers), number = current.number + 1;
  if (replacement) {
    const prepared = prepareMemoryWriting(replacement.selection, replacement.items, source.title, ctx);
    if (!prepared.ok) return refuse('evidence_not_ready', prepared.refusal.message);
    const fresh = prepared.value.source, ids = new Map<string, string>(), occupied = new Set<string>();
    for (const snapshot of source.memory ?? []) for (const item of snapshot.items) {
      const id = item.selected.evidence.id;
      if (ids.has(id) && ids.get(id) !== item.segmentId || occupied.has(item.segmentId) && !ids.has(id))
        return refuse('source_changed', 'Confira os identificadores da fonte antes de continuar.');
      ids.set(id, item.segmentId); occupied.add(item.segmentId);
    }
    let next = 1;
    const items = fresh.memory[0].items.map(item => {
      let id = ids.get(item.selected.evidence.id);
      if (!id) { while (occupied.has(`memory-item-${next}`)) next++; id = `memory-item-${next++}`; occupied.add(id); ids.set(item.selected.evidence.id, id); }
      return { ...item, segmentId: id };
    });
    content = { ...fresh.versions[0].content, segments: fresh.versions[0].content.segments.map((segment, index) => ({ ...segment, id: items[index].segmentId })) };
    for (const speaker of fresh.speakers) {
      const old = speakers.find(item => item.label === speaker.label);
      if (old && (old.personId !== speaker.personId || old.unattributed)) return refuse('source_changed', 'Confira a autoria da fonte antes de continuar.');
      if (!old) speakers.push(structuredClone(speaker));
    }
    receipt = { selection: { id: replacement.selection.id, revision: replacement.selection.revision }, version: { number, hash: sourceContentHash(content) }, items };
  } else receipt = { selection: structuredClone(previous.selection), version: { number, hash: sourceContentHash(content) }, retired: true, items: [] };
  const version: SourceVersion = { number, hash: receipt.version.hash, content, createdAt: ctx.now, createdBy: ctx.actorId, note: reason.trim() };
  const updated: Source = { ...structuredClone(source), speakers, versions: [...structuredClone(source.versions), version], memory: [...structuredClone(source.memory ?? []), receipt] };
  if (replacement) updated.rights = { authorized: true, authorizedAt: ctx.now, authorizedBy: ctx.actorId, note: reason.trim() };
  const concerns: MemoryRefreshConcern[] = [], result = structuredClone(body);
  let updatedReferences = 0;
  const concern = (value: MemoryRefreshConcern) => { if (!concerns.some(item => item.blockId === value.blockId && item.evidenceId === value.evidenceId && item.reason === value.reason)) concerns.push(value); };
  for (const block of result.blocks) {
    if (!block.sourceRefs) continue;
    block.sourceRefs = block.sourceRefs.map(ref => {
      if (ref.sourceId !== source.id) return ref;
      if (ref.locator.type !== 'segment') { concern({ blockId: block.id, evidenceId: null, reason: 'unresolved' }); return ref; }
      const oldVersion = source.versions.find(version => version.number === ref.sourceVersion);
      const oldReceipt = oldVersion && source.memory?.find(item => item.version.number === oldVersion.number && item.version.hash === oldVersion.hash);
      const segmentId = ref.locator.segmentId, old = oldReceipt?.items.find(item => item.segmentId === segmentId);
      const next = old && receipt.items.find(item => item.selected.evidence.id === old.selected.evidence.id);
      const base = { blockId: block.id, evidenceId: old?.selected.evidence.id ?? null };
      const resolved = resolveSourceRef([source], ref), from = ref.locator.from ?? 0, to = ref.locator.to ?? resolved?.segment?.text.length ?? 0;
      if (!old || !resolved || !Number.isInteger(from) || !Number.isInteger(to) || to <= from) { concern({ ...base, reason: 'unresolved' }); return ref; }
      if (!next) { concern({ ...base, reason: 'removed' }); return ref; }
      if (old.selected.evidence.hash !== next.selected.evidence.hash || old.anchor.excerpt !== next.anchor.excerpt || old.kind !== next.kind) {
        concern({ ...base, reason: 'changed' }); return ref;
      }
      if (!updateDraftReferences) { concern({ ...base, reason: 'kept' }); return ref; }
      updatedReferences++;
      return { ...ref, sourceVersion: number, locator: { ...ref.locator, segmentId: next.segmentId } };
    });
  }
  return ok({ source: updated, body: result, updatedReferences, concerns, retired: !replacement });
}
