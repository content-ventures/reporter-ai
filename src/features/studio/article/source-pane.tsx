'use client';

import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, TranscriptViewer, type TranscriptAction } from '@content-ventures/design-system/v3';
import { MessageSquareText, Quote } from '@content-ventures/design-system/v3/icons';
import { useStudio } from './studio-context';

/**
 * "Material" (CONTRACT §3.8, first tab of the panel): the interview in the DS TranscriptViewer —
 * search ("Buscar na entrevista"), the speakers filter, the lines the text already quotes (marked
 * "Usado"; a click on one lights the paragraph that cites it) and the selection actions "Inserir
 * citação" and "Pedir à IA". The pauta and the structure open from ⋯ in the header.
 */
export function MaterialTab() {
  const studio = useStudio();
  const { source, generation } = studio;
  const [query, setQuery] = useState('');
  const [speaker, setSpeaker] = useState<string | null>(null);
  // While the AI reads and picks key lines, the transcript lights what it just chose.
  const fold = generation.active ? generation.live?.fold : undefined;
  const picked = useMemo(
    () => (fold?.sourcesUsed ?? []).flatMap((ref) => (ref.locator.type === 'segment' ? [ref.locator.segmentId] : [])),
    [fold?.sourcesUsed],
  );
  const selecting = fold?.run.steps.some((step) => step.id === 'select' && step.state === 'current') ?? false;
  const usedIds = useMemo(() => [...new Set([...studio.facts.usedSegmentIds, ...picked])], [studio.facts.usedSegmentIds, picked]);
  const active = studio.link?.segmentId ?? (selecting ? (picked[picked.length - 1] ?? null) : null);
  const { insertQuote, addExcerpt } = studio.actions;
  const actions = useMemo<TranscriptAction[]>(
    () => [
      { id: 'quote', label: 'Inserir citação', icon: Quote, onSelect: (selection) => insertQuote(selection) },
      { id: 'ask', label: 'Pedir à IA', icon: MessageSquareText, onSelect: (selection) => addExcerpt(selection, true) },
    ],
    [insertQuote, addExcerpt],
  );
  if (studio.sourceError) {
    return <ErrorState size="panel" title="Não foi possível abrir o material" onRetry={studio.sourceError.retry} />;
  }
  if (studio.production.sources.length === 0) {
    return <EmptyState size="panel" icon={Quote} title="Artigo escrito do zero" description="Este artigo não usa uma transcrição." />;
  }
  return (
    <TranscriptViewer
      label="Entrevista"
      segments={studio.segments}
      query={query}
      onQueryChange={setQuery}
      speakerFilter={speaker}
      onSpeakerFilterChange={setSpeaker}
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
