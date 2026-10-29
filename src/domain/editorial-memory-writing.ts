import type { ArticleBody, ArticleBlock } from './article.ts';
import { blockText, paragraphBlock, quoteBlock } from './article.ts';
import type { MemoryEvidenceView, MemoryPolicy, MemorySelection, MemorySourceBinding } from './editorial-memory.ts';
import { memoryEvidenceRef, sameMemoryEvidence } from './editorial-memory.ts';
import { memoryMarketWritingText, memoryStatisticMarketContext } from './editorial-memory-market.ts';
import type { Source, TranscriptContent } from './source.ts';
import { sourceContentHash } from './source.ts';
import { segmentRef, type SourceVersionRef } from './refs.ts';
import type { Person } from './workspace.ts';
import type { CommandContext, Result } from './result.ts';
import { ok, refuse } from './result.ts';

export type MemoryWritingItem = { view: MemoryEvidenceView; policy: MemoryPolicy; author?: Pick<Person, 'id' | 'name' | 'title' | 'organization'> };
export type MemoryWritingSource = Source & { memory: MemorySourceBinding[] };
type Refusal = 'selection_changed' | 'evidence_not_ready' | 'author_missing' | 'empty_title';

/** Build one explicit collection, retaining each original anchor and every selected proof. */
export function prepareMemoryWriting(selection: MemorySelection, items: MemoryWritingItem[], title: string, ctx: CommandContext):
  Result<{ source: MemoryWritingSource; body: ArticleBody }, Refusal> {
  if (!title.trim()) return refuse('empty_title', 'Dê um título à produção.');
  if (!selection.items.length || selection.items.length > 100 || new Set(selection.items.map(item => item.evidence.id)).size !== selection.items.length)
    return refuse('selection_changed', 'Confira a seleção antes de escrever.');
  const content: TranscriptContent = { type: 'transcript', format: 'plain', segments: [] };
  const sourceId = ctx.newId('memory-writing-source'), bindings: MemorySourceBinding['items'] = [], speakers: Source['speakers'] = [], blocks: ArticleBlock[] = [];
  for (const [index, selected] of selection.items.entries()) {
    const current = items.find(item => item.view.evidence.id === selected.evidence.id), view = current?.view;
    if (!current || !view || selection.workspaceId !== view.evidence.workspaceId || current.policy.workspaceId !== selection.workspaceId
      || !sameMemoryEvidence(selected.evidence, memoryEvidenceRef(view.evidence)) || selected.policyRevision !== current.policy.revision
      || (view.check?.id ?? null) !== (selected.check?.id ?? null) || (view.check?.revision ?? null) !== (selected.check?.revision ?? null)
      || (view.decision?.id ?? null) !== selected.decisionId) return refuse('selection_changed', 'A evidência ou sua revisão mudou. Atualize a seleção.');
    if (!view.eligibility.usable || view.checkState === 'outdated' || view.checkState === 'restricted' || view.reviewRestricted)
      return refuse('evidence_not_ready', 'Há uma evidência que precisa de revisão antes de escrever.');
    const evidence = view.evidence, author = current.author;
    if (evidence.kind === 'citation' && (!author || author.id !== evidence.personId || !author.name.trim()))
      return refuse('author_missing', 'Confira o nome de quem fez a declaração.');
    const segmentId = `memory-item-${index + 1}`, text = evidence.anchor.excerpt;
    const marketContext = evidence.kind === 'statistic' ? memoryStatisticMarketContext(evidence) : {};
    const label = evidence.kind === 'citation' ? `memory-person-${author!.id}` : undefined;
    if (label && !speakers.some(speaker => speaker.label === label)) speakers.push({ label, personId: author!.id });
    content.segments.push({ id: segmentId, text, ...(label ? { speaker: label } : {}) });
    bindings.push({ segmentId, materialId: evidence.materialId, kind: evidence.kind, anchor: structuredClone(evidence.anchor),
      metadata: structuredClone(evidence.metadata), selected: structuredClone(selected),
      ...(evidence.kind === 'statistic' && evidence.market ? { market: structuredClone(evidence.market) } : {}),
      ...(Object.keys(marketContext).length ? { marketContext } : {}) });
    const sourceRefs = [segmentRef(sourceId, 1, segmentId, { from: 0, to: text.length })];
    blocks.push(evidence.kind === 'citation' ? quoteBlock(ctx.newId('memory-quote'), text, { sourceRefs })
      : paragraphBlock(ctx.newId('memory-statistic'), memoryMarketWritingText(evidence.market, text, marketContext), { sourceRefs }));
    if (evidence.kind === 'citation' && author) blocks.push(paragraphBlock(ctx.newId('memory-attribution'),
      `— ${[author.name, author.title, author.organization].filter(Boolean).join(', ')}`));
  }
  const hash = sourceContentHash(content);
  return ok({ source: { id: sourceId, workspaceId: selection.workspaceId, kind: 'news', origin: 'other', title: `Seleção do banco: ${title.trim()}`,
    speakers, memory: [{ selection: { id: selection.id, revision: selection.revision }, version: { number: 1, hash }, items: bindings }],
    rights: { authorized: true, authorizedAt: ctx.now, authorizedBy: ctx.actorId, note: 'Coleção de evidências revisadas do banco.' },
    versions: [{ number: 1, hash, content, createdAt: ctx.now, createdBy: ctx.actorId, note: 'Somente os trechos selecionados.' }], createdAt: ctx.now, createdBy: ctx.actorId },
    body: { type: 'article', title: title.trim(), blocks } });
}

export type MemoryWritingOccurrence = { blockId: string; from: number; to: number; sourceFrom: number; sourceTo: number; sourceVersion: number; binding: MemorySourceBinding['items'][number] };
/** Observe actual referenced words in a saved article; selecting a source alone is never use. */
export function memoryWritingOccurrences(body: ArticleBody, source: Source): MemoryWritingOccurrence[] {
  const output: MemoryWritingOccurrence[] = [];
  if (!source.memory) return output;
  for (const block of body.blocks) for (const ref of block.sourceRefs ?? []) {
    if (ref.sourceId !== source.id || ref.locator.type !== 'segment') continue;
    const receipt = source.memory.find(item => item.version.number === ref.sourceVersion);
    if (!receipt) continue;
    const version = source.versions.find(version => version.number === receipt.version.number && version.hash === receipt.version.hash);
    if (!version || sourceContentHash(version.content) !== receipt.version.hash) continue;
    const segmentId = ref.locator.segmentId, binding = receipt.items.find(item => item.segmentId === segmentId);
    const segment = version.content.segments.find(item => item.id === segmentId);
    if (!binding || !segment || segment.text !== binding.anchor.excerpt) continue;
    const sourceFrom = binding.kind === 'statistic' ? 0 : ref.locator.from ?? 0, sourceTo = binding.kind === 'statistic' ? segment.text.length : ref.locator.to ?? segment.text.length;
    if (!Number.isInteger(sourceFrom) || !Number.isInteger(sourceTo) || sourceFrom < 0 || sourceTo <= sourceFrom || sourceTo > segment.text.length) continue;
    const literal = segment.text.slice(sourceFrom, sourceTo), text = blockText(block);
    if (!literal.trim()) continue;
    for (let from = text.indexOf(literal); from >= 0; from = text.indexOf(literal, from + literal.length)) {
      const to = from + literal.length;
      if (!output.some(item => item.blockId === block.id && item.from === from && item.to === to && item.binding.selected.evidence.id === binding.selected.evidence.id))
        output.push({ blockId: block.id, from, to, sourceFrom, sourceTo, sourceVersion: version.number, binding });
    }
  }
  return output;
}

export type MemoryWritingProvenance = Omit<MemorySourceBinding['items'][number], 'segmentId'> & {
  selection: MemorySourceBinding['selection'];
  collection: { source: SourceVersionRef; segmentId: string; from: number; to: number };
  article: { blockId: string; from: number; to: number };
};
/** Export the approved body's actual occurrences and their original immutable selection proof. */
export function memoryWritingProvenance(body: ArticleBody, sources: readonly Source[]): MemoryWritingProvenance[] {
  const proofs: MemoryWritingProvenance[] = [];
  for (const source of sources) for (const occurrence of memoryWritingOccurrences(body, source)) {
    const receipt = source.memory!.find(receipt => receipt.version.number === occurrence.sourceVersion)!;
    const { segmentId, ...binding } = occurrence.binding;
    proofs.push({ ...structuredClone(binding), selection: { ...receipt.selection },
      collection: { source: { kind: 'source-version', sourceId: source.id, sourceVersion: occurrence.sourceVersion, hash: receipt.version.hash },
        segmentId, from: occurrence.sourceFrom, to: occurrence.sourceTo },
      article: { blockId: occurrence.blockId, from: occurrence.from, to: occurrence.to } });
  }
  const order = new Map(body.blocks.map((block, index) => [block.id, index]));
  return proofs.sort((a, b) => order.get(a.article.blockId)! - order.get(b.article.blockId)! || a.article.from - b.article.from
    || a.collection.source.sourceId.localeCompare(b.collection.source.sourceId));
}
