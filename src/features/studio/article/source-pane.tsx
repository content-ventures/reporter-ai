'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  ConfirmDialog,
  DescriptionList,
  ErrorState,
  IconButton,
  LinkButton,
  List,
  ListItem,
  Pagination,
  Section,
  Tabs,
  Tooltip,
  TranscriptViewer,
  type TranscriptAction,
} from '@content-ventures/design-system/v3';
import { Heading2, Heading3, MessageSquareText, Paperclip, Quote, RotateCcw } from '@content-ventures/design-system/v3/icons';
import { LENGTH_TARGETS, shortHash, type VersionView } from '@/domain';
import { BriefDrawer } from '@/features/material/brief-drawer';
import { formatCount, plural } from '@/ui/format';
import { usePerson } from '@/ui/person-avatar';
import { StatusBadge } from '@/ui/status-badge';
import { useRelativeTime } from '@/ui/time';
import { useStudio } from './studio-context';
import { RegenerateDialog } from './studio-footer';
import type { SourceTab } from './use-article-studio';

/**
 * "Fonte" (PLAN §3.5): Transcrição (the DS TranscriptViewer with speakers, search, filter, the
 * excerpts the text uses and selection actions) · Estrutura (the pauta, editable, and the outline
 * that scrolls the text) · Versões (immutable versions with hash and "Restaurar", which never
 * touches decisions).
 */

const TABS: { value: SourceTab; label: string }[] = [
  { value: 'transcript', label: 'Transcrição' },
  { value: 'structure', label: 'Estrutura' },
  { value: 'versions', label: 'Versões' },
];

export function SourceTabs() {
  const studio = useStudio();
  return (
    <Tabs
      label="Fonte"
      size="sm"
      items={TABS.map((tab) => ({
        ...tab,
        ...(tab.value === 'versions' && studio.piece.versions.length > 0 ? { count: studio.piece.versions.length } : {}),
      }))}
      value={studio.sourceTab}
      onChange={studio.setSourceTab}
    />
  );
}

export function SourcePane() {
  const studio = useStudio();
  switch (studio.sourceTab) {
    case 'transcript':
      return <TranscriptTab />;
    case 'structure':
      return <StructureTab />;
    case 'versions':
      return <VersionsTab />;
  }
}

function TranscriptTab() {
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
      { id: 'context', label: 'Usar como contexto', icon: Paperclip, onSelect: (selection) => addExcerpt(selection) },
      { id: 'ask', label: 'Perguntar à IA', icon: MessageSquareText, onSelect: (selection) => addExcerpt(selection, true) },
    ],
    [insertQuote, addExcerpt],
  );
  if (studio.sourceError) {
    return <ErrorState size="panel" title="Não foi possível abrir o material" onRetry={studio.sourceError.retry} />;
  }
  return (
    <TranscriptViewer
      label="Transcrição do material"
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

/**
 * "Estrutura": the pauta (orientação, seções, extensão) with "Editar pauta" — saved over the
 * revision the form opened with, so a change made meanwhile elsewhere is never overwritten
 * silently — and, once it changed after the text was written, "Gerar nova versão" with the new one.
 */
function StructureTab() {
  const studio = useStudio();
  const { brief } = studio.production;
  const target = LENGTH_TARGETS[brief.length];
  const outline = studio.facts.outline;
  const sections = outline.filter((entry) => entry.level === 2).length;
  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const canRegenerate = studio.briefChanged && !studio.generation.active && !studio.empty;
  return (
    <>
      {canRegenerate ? (
        <Alert tone="info" title="A pauta mudou depois deste texto" action={<LinkButton onClick={() => setRegenerating(true)}>Gerar nova versão</LinkButton>} />
      ) : null}
      <Section
        title="Pauta"
        titleAs="h3"
        action={
          <LinkButton disabled={studio.generation.active || studio.readOnly} onClick={() => setEditing(true)}>
            Editar pauta
          </LinkButton>
        }
      >
        <DescriptionList
          labelWidth={104}
          label="Pauta do artigo"
          items={[
            { label: 'Orientação editorial', value: brief.angle, ...(brief.angle ? {} : { state: 'empty' as const }) },
            { label: 'Estrutura', value: `Introdução + ${plural(brief.sections, 'seção', 'seções')}` },
            { label: 'Extensão', value: `${target.label} · ≈${formatCount(target.words)} palavras`, numeric: true },
          ]}
        />
      </Section>
      <Section title="Intertítulos" titleAs="h3" meta={`${sections}/${brief.sections}`}>
        <List label="Intertítulos do artigo" empty="Sem intertítulos ainda" framed={false}>
          {outline.map((entry) => (
            <ListItem
              key={entry.blockId}
              icon={entry.level === 2 ? Heading2 : Heading3}
              title={entry.text || 'Sem texto'}
              meta={`§${entry.number}`}
              density="sm"
              onClick={() => {
                studio.setView('main');
                studio.actions.scrollToBlock(entry.blockId);
              }}
            />
          ))}
        </List>
      </Section>
      <BriefDrawer productionId={studio.production.id} open={editing} onClose={() => setEditing(false)} />
      <RegenerateDialog open={regenerating} onClose={() => setRegenerating(false)} />
    </>
  );
}

const PAGE_SIZE = 8;

function restoreDescription(version: VersionView | null, latest: number, dirty: boolean): string {
  if (!version) return '';
  const next = latest + (dirty ? 2 : 1);
  const kept = dirty ? `O texto atual fica salvo como v${latest + 1}. ` : '';
  return `${kept}O texto da v${version.number} volta como v${next}. Aprovações não mudam.`;
}

function VersionsTab() {
  const studio = useStudio();
  const versions = useMemo(() => [...studio.piece.versions].reverse(), [studio.piece.versions]);
  const [page, setPage] = useState(1);
  const [restoring, setRestoring] = useState<VersionView | null>(null);
  const shown = versions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pending = studio.piece.pendingReview?.subject.versionId;
  return (
    <>
      <List label="Versões do artigo" empty="Nenhuma versão ainda" framed={false}>
        {shown.map((version) => (
          <VersionRow
            key={version.id}
            version={version}
            pending={version.id === pending}
            highlighted={version.id === studio.highlightVersionId}
            onRestore={() => setRestoring(version)}
          />
        ))}
      </List>
      {versions.length > PAGE_SIZE ? (
        <Pagination page={page} pageSize={PAGE_SIZE} total={versions.length} onPageChange={setPage} noun="versões" variant="compact" />
      ) : null}
      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title={`Restaurar a ${restoring?.label ?? 'versão'}?`}
        description={restoreDescription(restoring, studio.piece.latestVersion?.number ?? 0, studio.draft.dirty)}
        confirmLabel="Restaurar versão"
        onConfirm={() => (restoring ? studio.actions.restoreVersion(restoring.id) : undefined)}
      />
    </>
  );
}

function VersionRow({ version, pending, highlighted, onRestore }: { version: VersionView; pending: boolean; highlighted: boolean; onRestore: () => void }) {
  const studio = useStudio();
  const author = usePerson(version.createdBy);
  const when = useRelativeTime(version.createdAt);
  const isCurrent = version.isLatest && !studio.draft.dirty;
  const status = pending ? (
    <StatusBadge kind="piece" status="in_review" size="sm" variant="text" />
  ) : version.decision?.kind === 'approved' ? (
    <StatusBadge kind="piece" status="approved" size="sm" variant="text" />
  ) : version.decision?.kind === 'changes_requested' ? (
    <StatusBadge kind="piece" status="changes_requested" size="sm" variant="text" />
  ) : null;
  const restore = `Restaurar v${version.number}`;
  return (
    <ListItem
      title={version.label}
      description={[author?.name, when, plural(version.words, 'palavra', 'palavras')].filter(Boolean).join(' · ')}
      meta={status ?? `#${shortHash(version.ref.hash)}`}
      selected={highlighted}
      density="sm"
      actions={
        isCurrent ? undefined : (
          <Tooltip content={restore}>
            <IconButton label={restore} icon={RotateCcw} variant="ghost" size="sm" disabled={studio.generation.active} onClick={onRestore} />
          </Tooltip>
        )
      }
    />
  );
}
