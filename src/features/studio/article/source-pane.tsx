'use client';

import { useMemo, useState } from 'react';
import { Button, EmptyState, ErrorState, FieldGroup, Section, Select, TranscriptViewer, toast, type TranscriptAction } from '@content-ventures/design-system/v3';
import { MessageSquareText, Quote } from '@content-ventures/design-system/v3/icons';
import { useStudio } from './studio-context';
import { quotedSegmentIds, sourceSegmentIds } from './studio-model';
import { MemorySourceRefreshDialog, type MemoryRefreshBasis } from '@/features/editorial-memory/memory-source-refresh-dialog';
import { useCan } from '@/state';
import { useMemoryLibrary } from '@/state/use-memory-library';

/** The pane header owns the controls, leaving the transcript its remaining scroll height. */
export function MaterialSourcePicker() {
  const studio = useStudio(), { production, source, sourceDetails, sourceSelection, showSource } = studio;
  const port = useMemoryLibrary(), canEdit = useCan('library.edit'), [basis, setBasis] = useState<MemoryRefreshBasis>(), [preparing, setPreparing] = useState(false);
  if (!production.sources.length) return null;
  if (production.sources.length === 1 && source && source.source.versions.length === 1 && !source.source.memory) return null;
  const selected = source?.source.id ?? sourceSelection?.sourceId ?? production.sources[0]?.id ?? '';
  return (
    <><Section variant="band">
      <FieldGroup label="Material">
        <Select label="Fonte do material" searchable={production.sources.length > 5} loading={!sourceDetails} disabled={preparing}
          value={selected} options={production.sources.map((entry, index) => ({ value: entry.id, label: entry.title, description: `Fonte ${index + 1} · versão ${entry.version}` }))}
          onChange={(id) => { const detail = sourceDetails?.find((entry) => entry.source.id === id); if (detail) showSource({ sourceId: id, sourceVersion: detail.version.number }); }} />
        {source && source.source.versions.length > 1 ? <Select label="Versão do material" value={String(source.version.number)} disabled={preparing}
          options={source.source.versions.map((version) => ({ value: String(version.number), label: `Versão ${version.number}${version.number === source.summary.version ? source.summary.retired ? ' · retirada' : '' : ' · histórica'}`, description: version.number === source.summary.version ? 'Atual' : new Date(version.createdAt).toLocaleString('pt-BR') }))}
          onChange={(number) => showSource({ sourceId: source.source.id, sourceVersion: Number(number) })} /> : null}
        {source?.source.memory && canEdit && studio.canEdit && !studio.readOnly && !studio.locked && <Button variant="secondary" loading={preparing} disabled={preparing || production.activeRuns.length > 0 || !port} onClick={async () => {
          if (source.version.number !== source.summary.version) { showSource({ sourceId: source.source.id, sourceVersion: source.summary.version }); return; }
          setPreparing(true);
          try {
            const saved = await studio.actions.prepareSourceRefresh();
            if (!saved || !port) { toast('Confira o salvamento do rascunho antes de continuar.'); return; }
            setBasis({ source: source.source, target: { productionId: production.id, updatedAt: production.production.updatedAt, draftRevision: saved.baseRevision }, port });
          } finally { setPreparing(false); }
        }}>{source.version.number !== source.summary.version ? 'Ver versão atual' : source.summary.retired ? 'Reativar fonte' : 'Atualizar fonte'}</Button>}
      </FieldGroup>
    </Section>{basis && <MemorySourceRefreshDialog basis={basis} writable={!studio.readOnly && !studio.locked && production.activeRuns.length === 0} onClose={() => setBasis(undefined)} onDone={result => { setBasis(undefined); showSource(result.source); studio.bankReadiness.retry(); }} />}</>
  );
}

/**
 * "Material" (CONTRACT §3.8, first tab of the panel): the interview in the DS TranscriptViewer —
 * search ("Buscar na entrevista"), the speakers filter, the lines the text already quotes (marked
 * "Usado"; a click on one lights the paragraph that cites it) and the selection actions "Inserir
 * citação" and "Pedir à IA". The pauta and the structure open from ⋯ in the header.
 */
export function MaterialTab() {
  const studio = useStudio();
  const { source, generation } = studio;
  // While the AI reads and picks key lines, the transcript lights what it just chose.
  const fold = generation.active ? generation.live?.fold : undefined;
  const picked = useMemo(
    () => source ? sourceSegmentIds(fold?.sourcesUsed, { sourceId: source.source.id, sourceVersion: source.version.number }) : [],
    [fold?.sourcesUsed, source],
  );
  const selecting = fold?.run.steps.some((step) => step.id === 'select' && step.state === 'current') ?? false;
  const usedIds = useMemo(() => source ? [...new Set([...quotedSegmentIds(studio.facts.quotes, { sourceId: source.source.id, sourceVersion: source.version.number }), ...picked])] : [], [studio.facts.quotes, picked, source]);
  const linked = source && studio.link?.sourceId === source.source.id && studio.link.sourceVersion === source.version.number ? studio.link.segmentId : null;
  const active = linked ?? (selecting ? (picked[picked.length - 1] ?? null) : null);
  const { insertQuote, addExcerpt } = studio.actions;
  const canEdit = studio.canEdit && Boolean(source?.source.rights.authorized)
    && (!source?.source.memory || source.version.number === source.summary.version && !source.summary.retired);
  const actions = useMemo<TranscriptAction[]>(
    () => canEdit ? [
      { id: 'quote', label: 'Inserir citação', icon: Quote, onSelect: (selection) => insertQuote(selection) },
      { id: 'ask', label: 'Pedir à IA', icon: MessageSquareText, onSelect: (selection) => addExcerpt(selection, true) },
    ] : [],
    [canEdit, insertQuote, addExcerpt],
  );
  if (studio.sourceError) {
    return <ErrorState size="panel" title="Não foi possível abrir o material" onRetry={studio.sourceError.retry} />;
  }
  if (studio.production.sources.length === 0) {
    return <EmptyState size="panel" icon={Quote} title="Artigo escrito do zero" description="Este artigo não usa uma transcrição." />;
  }
  if (studio.sourceDetails && !source) {
    const current = studio.sourceDetails.find((entry) => entry.source.id === studio.sourceSelection?.sourceId);
    return <EmptyState size="panel" icon={Quote} title="Versão do material indisponível"
      {...(current ? { actions: <Button onClick={() => studio.showSource({ sourceId: current.source.id, sourceVersion: current.version.number })}>Ver versão atual</Button> } : { description: 'Escolha uma fonte para continuar.' })} />;
  }
  if (source?.source.memory?.find(item => item.version.number === source.version.number)?.retired) return <EmptyState size="panel" icon={Quote}
    title="Fonte retirada das novas gerações" description="As versões anteriores continuam disponíveis no seletor de versões." />;
  return (
    <TranscriptViewer
      key={source ? `${source.source.id}@${source.version.number}` : 'loading'}
      label={source?.source.memory ? 'Seleção do banco' : 'Entrevista'}
      segments={studio.segments}
      activeId={active}
      usedIds={usedIds}
      height="100%"
      loading={!source}
      empty="Material sem falas"
      onSegmentClick={(segment) => studio.linkSegment(segment.id)}
      selectionActions={actions}
    />
  );
}
