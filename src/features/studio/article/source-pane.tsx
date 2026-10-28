'use client';

import { useMemo } from 'react';
import { Button, EmptyState, ErrorState, FieldGroup, Section, Select, TranscriptViewer, type TranscriptAction } from '@content-ventures/design-system/v3';
import { MessageSquareText, Quote } from '@content-ventures/design-system/v3/icons';
import { useStudio } from './studio-context';
import { quotedSegmentIds, sourceSegmentIds } from './studio-model';

/** The pane header owns the controls, leaving the transcript its remaining scroll height. */
export function MaterialSourcePicker() {
  const { production, source, sourceDetails, sourceSelection, showSource } = useStudio();
  if (!production.sources.length) return null;
  if (production.sources.length === 1 && source && source.source.versions.length === 1 && !source.source.memory) return null;
  const selected = source?.source.id ?? sourceSelection?.sourceId ?? production.sources[0]?.id ?? '';
  return (
    <Section variant="band">
      <FieldGroup label="Material">
        <Select label="Fonte do material" searchable={production.sources.length > 5} loading={!sourceDetails}
          value={selected} options={production.sources.map((entry, index) => ({ value: entry.id, label: entry.title, description: `Fonte ${index + 1} · versão ${entry.version}` }))}
          onChange={(id) => { const detail = sourceDetails?.find((entry) => entry.source.id === id); if (detail) showSource({ sourceId: id, sourceVersion: detail.version.number }); }} />
        {source && source.source.versions.length > 1 ? <Select label="Versão do material" value={String(source.version.number)}
          options={source.source.versions.map((version) => ({ value: String(version.number), label: `Versão ${version.number}`, description: version.number === source.summary.version ? 'Atual' : 'Histórica' }))}
          onChange={(number) => showSource({ sourceId: source.source.id, sourceVersion: Number(number) })} /> : null}
      </FieldGroup>
    </Section>
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
  const canEdit = studio.canEdit;
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
