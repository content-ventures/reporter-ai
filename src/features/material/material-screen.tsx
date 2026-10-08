'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  DescriptionList,
  EmptyState,
  ErrorState,
  LinkButton,
  List,
  ListItem,
  Panel,
  Section,
  Skeleton,
  SplitLayout,
  TranscriptViewer,
  toast,
  type DescriptionItem,
  type TranscriptAction,
} from '@content-ventures/design-system/v3';
import { ArrowRight, Copy, Pencil, ScrollText, Sparkles } from '@content-ventures/design-system/v3/icons';
import { LENGTH_TARGETS, shortHash, type Brief, type ProductionId } from '@/domain';
import type { Participant, SourceDetail } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { useCommands, usePiece, useSource } from '@/state';
import { formatCount, formatDate, formatDateTime, formatDuration, plural } from '@/ui/format';
import { PersonAvatar, usePerson } from '@/ui/person-avatar';
import { materialHref, pieceHref } from '@/ui/routes';
import { useCommandGroup } from '@/ui/shell';
import { ProductionHeader, StagePage, useProductionFrame } from '@/features/production/production-frame';
import { BriefDrawer } from './brief-drawer';
import { MaterialDrawer } from './material-drawer';
import { citedSegmentIds, viewerSegments } from './material-model';

/** The transcript scrolls inside a fixed height (the DS viewer has no "fill the rest" option yet). */
const TRANSCRIPT_HEIGHT = 600;
const ASIDE_LABEL_WIDTH = 104;

function AuthorizationValue({ detail }: { detail: SourceDetail }) {
  const rights = detail.source.rights;
  const by = usePerson(rights.authorizedBy);
  if (!rights.authorized) {
    return (
      <Badge tone="red" variant="text">
        Falta autorização
      </Badge>
    );
  }
  return (
    <Badge tone="teal" variant="text">
      {by ? `Autorizado por ${by.name}` : 'Autorizado'}
    </Badge>
  );
}

function materialFacts(detail: SourceDetail): DescriptionItem[] {
  const { source, version, summary } = detail;
  const items: DescriptionItem[] = [
    { label: 'Origem', value: SOURCE_ORIGIN_LABELS[source.origin] },
    { label: 'Data', value: source.recordedOn ? formatDate(source.recordedOn) : undefined, numeric: true },
    { label: 'Arquivo', value: source.fileName ?? 'Texto colado' },
    {
      label: 'Autorização',
      value: <AuthorizationValue detail={detail} />,
      hint: source.rights.authorizedAt ? formatDateTime(source.rights.authorizedAt) : undefined,
    },
    { label: 'Versão', value: `v${version.number}`, hint: formatDateTime(version.createdAt), numeric: true },
    { label: 'Hash', value: `#${shortHash(version.hash)}`, copy: version.hash, numeric: true },
    { label: 'Extensão', value: `${plural(summary.words, 'palavra', 'palavras')} · ${summary.readingMinutes} min de leitura`, numeric: true },
  ];
  if (summary.hasTimestamps && summary.durationMs !== undefined) items.push({ label: 'Duração', value: formatDuration(summary.durationMs), numeric: true });
  return items;
}

function SpeakerItem({ participant }: { participant: Participant }) {
  const person = participant.person;
  const name = person?.name ?? participant.label;
  const description = person
    ? [person.line ?? person.title, person.name !== participant.label ? `“${participant.label}”` : null].filter(Boolean).join(' · ') || undefined
    : participant.unattributed
      ? 'Sem atribuição'
      : 'Sem pessoa ligada';
  return (
    <ListItem
      leading={<PersonAvatar person={person} name={participant.label} size="sm" decorative />}
      title={name}
      description={description}
      meta={plural(participant.segments, 'fala', 'falas')}
      trailing={
        person || participant.unattributed ? undefined : (
          <Badge tone="red" variant="text" size="sm">
            Falta
          </Badge>
        )
      }
    />
  );
}

/** Speakers nobody decided yet (not linked to a person, not "Sem atribuição"). */
function withoutPerson(detail: SourceDetail): number {
  return detail.speakers.filter((participant) => !participant.person && !participant.unattributed).length;
}

function briefFacts(brief: Brief): DescriptionItem[] {
  const target = LENGTH_TARGETS[brief.length];
  return [
    { label: 'Orientação', value: brief.angle || undefined },
    { label: 'Estrutura', value: `Introdução + ${plural(brief.sections, 'seção', 'seções')}` },
    { label: 'Extensão', value: `${target.label} · ≈ ${formatCount(target.words)} palavras`, numeric: true },
  ];
}

function MaterialAside({ detail, productionId, brief, onEdit, onEditBrief }: { detail: SourceDetail; productionId: ProductionId; brief: Brief | undefined; onEdit: () => void; onEditBrief: () => void }) {
  const unmapped = withoutPerson(detail);
  const others = detail.productions.filter((production) => production.id !== productionId);
  return (
    <Panel>
      <Section title="Material">
        <DescriptionList items={materialFacts(detail)} labelWidth={ASIDE_LABEL_WIDTH} label="Dados do material" />
      </Section>
      {brief ? (
        <Section title="Pauta" action={<LinkButton onClick={onEditBrief}>Editar pauta</LinkButton>}>
          <DescriptionList items={briefFacts(brief)} labelWidth={ASIDE_LABEL_WIDTH} label="Pauta da produção" />
        </Section>
      ) : null}
      <Section
        title="Falantes"
        meta={unmapped > 0 ? plural(unmapped, 'falante sem pessoa', 'falantes sem pessoa') : String(detail.speakers.length)}
        metaTone={unmapped > 0 ? 'missing' : 'muted'}
        action={<LinkButton onClick={onEdit}>Ligar pessoas</LinkButton>}
      >
        <List label="Falantes do material" framed={false}>
          {detail.speakers.map((participant) => (
            <SpeakerItem key={participant.label} participant={participant} />
          ))}
        </List>
      </Section>
      {others.length > 0 ? (
        <Section title="Também usado em" meta={String(others.length)}>
          <List label="Outras produções com este material" framed={false}>
            {others.map((production) => (
              <ListItem key={production.id} title={production.title} href={materialHref(production.id)} density="sm" />
            ))}
          </List>
        </Section>
      ) : null}
    </Panel>
  );
}

function LoadingMaterial() {
  return (
    <SplitLayout
      main={
        <Panel>
          <Section title="Transcrição">
            <TranscriptViewer label="Transcrição" segments={[]} loading height={TRANSCRIPT_HEIGHT} />
          </Section>
        </Panel>
      }
      aside={
        <Panel>
          <Section title="Material">
            <DescriptionList items={[]} loading loadingRows={6} label="Dados do material" />
          </Section>
        </Panel>
      }
    />
  );
}

/**
 * Material (`/productions/[id]/source`, PLAN §3.4): the full transcript (search, speaker filter,
 * the passages the article cites marked "Usado", copy a passage), the source facts (origin,
 * date, authorisation, version, hash) and the speakers with the person each one is. Context and
 * speaker mapping are edited in a Drawer. The text itself is never edited in R1: the source is
 * versioned (stable segment ids), and a correction will create a new version (R4).
 */
export function MaterialScreen({ productionId }: { productionId: ProductionId }) {
  const { production } = useProductionFrame();
  const detail = production.data;
  const sourceId = detail?.sources[0]?.id;
  const source = useSource(sourceId);
  const articleId = detail?.pieces.find((piece) => piece.kind === 'article')?.id;
  const draft = usePiece(articleId);
  const [editing, setEditing] = useState(false);
  const [editingBrief, setEditingBrief] = useState(false);
  /** "Gerar artigo" was asked while speakers still had no person: the warning stays until they do. */
  const [askedToGenerate, setAskedToGenerate] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const commands = useCommands();
  const router = useRouter();

  const data = source.data;
  const segments = useMemo(() => (data ? viewerSegments(data.version, data.speakers) : []), [data]);
  const usedIds = useMemo(() => (sourceId ? citedSegmentIds(draft.data?.body, sourceId) : []), [draft.data?.body, sourceId]);
  const speakerName = useMemo(() => new Map(segments.map((segment) => [segment.id, segment.speaker?.name])), [segments]);

  const actions: TranscriptAction[] = [
    {
      id: 'copy',
      label: 'Copiar trecho',
      icon: Copy,
      onSelect: (selection) => {
        const who = speakerName.get(selection.segmentId);
        const text = `“${selection.text.trim()}”${who ? ` — ${who}` : ''}`;
        const failed = () => toast('Não foi possível copiar', { tone: 'error' });
        try {
          // The clipboard is missing (or throws) outside a secure origin.
          if (!navigator.clipboard) throw new Error('clipboard');
          navigator.clipboard.writeText(text).then(() => toast('Trecho copiado', { description: who }), failed);
        } catch {
          failed();
        }
      },
    },
  ];

  useCommandGroup(
    data
      ? {
          label: 'Material',
          items: [
            { id: 'material-edit-context', label: 'Editar contexto e falantes', icon: Pencil, keywords: 'autorizar falantes pessoas participantes', onSelect: () => setEditing(true) },
            { id: 'material-edit-brief', label: 'Editar pauta', icon: Pencil, keywords: 'orientação seções extensão briefing', onSelect: () => setEditingBrief(true) },
          ],
        }
      : null,
  );

  // Once the material is authorised, the next step is the article: generate it, or open it.
  const article = detail?.pieces.find((piece) => piece.kind === 'article');
  const canGenerate = Boolean(article && detail?.guards.pieces.article?.generate.allowed && draft.data && draft.data.body.type === 'article' && draft.data.body.blocks.length === 0 && data?.source.rights.authorized);
  const [starting, setStarting] = useState(false);
  const undecided = data ? withoutPerson(data) : 0;
  async function generateArticle() {
    if (!article) return;
    // Quotes are attributed from "Falantes" (REQ-T.7): ask who speaks before writing.
    if (undecided > 0) {
      setAskedToGenerate(true);
      return;
    }
    setStarting(true);
    const result = await commands.generation.start('article.draft', { productionId, pieceId: article.id });
    setStarting(false);
    if (!result.ok) {
      toast('Geração não iniciada', { tone: 'error', description: result.refusal.message });
      return;
    }
    router.push(pieceHref(productionId, 'article'));
  }
  // Header-line actions are `sm`, like every stage's (B02: one line, same height loading or loaded).
  const next = canGenerate ? (
    <Button variant="primary" size="sm" icon={Sparkles} loading={starting} onClick={() => void generateArticle()}>
      Gerar artigo
    </Button>
  ) : article && data?.source.rights.authorized && draft.data && draft.data.body.type === 'article' && draft.data.body.blocks.length > 0 ? (
    <ButtonLink href={pieceHref(productionId, 'article')} size="sm" trailingIcon={ArrowRight}>
      Abrir artigo
    </ButtonLink>
  ) : null;

  const header = (
    <ProductionHeader
      actions={
        data ? (
          <>
            {next}
            <Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>
              Editar contexto e falantes
            </Button>
          </>
        ) : source.status === 'error' || (production.status === 'ready' && !sourceId) ? undefined : (
          // Holds the actions' place while the material loads (on a phone they take their own row).
          <Skeleton width={180} height={32} />
        )
      }
    />
  );

  if (production.status === 'ready' && !sourceId) {
    return (
      <StagePage header={header} label="Material">
        <EmptyState icon={ScrollText} size="page" title="Produção sem material" />
      </StagePage>
    );
  }

  if (source.status === 'error') {
    return (
      <StagePage header={header} label="Material">
        <ErrorState title="Não foi possível abrir o material" onRetry={source.retry} size="page" />
      </StagePage>
    );
  }

  if (!data) {
    return (
      <StagePage header={header} label="Material">
        <LoadingMaterial />
      </StagePage>
    );
  }

  const summary = data.summary;
  const meta = [plural(summary.segments, 'fala', 'falas'), plural(summary.words, 'palavra', 'palavras'), usedIds.length > 0 ? plural(usedIds.length, 'usada', 'usadas') : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <StagePage header={header} label="Material">
      {!data.source.rights.authorized ? (
        <Alert tone="attention" title="Material não autorizado" action={<LinkButton onClick={() => setEditing(true)}>Autorizar material</LinkButton>} />
      ) : null}
      {askedToGenerate && undecided > 0 ? (
        <Alert tone="danger" title={plural(undecided, 'falante sem pessoa', 'falantes sem pessoa')} action={<LinkButton onClick={() => setEditing(true)}>Ligar pessoas</LinkButton>}>
          Ligue cada falante a uma pessoa ou marque “Sem atribuição” para gerar o artigo.
        </Alert>
      ) : null}
      <SplitLayout
        asideLabel="Dados do material"
        main={
          <Panel>
            <Section title="Transcrição" meta={meta}>
              <TranscriptViewer
                label={`Transcrição de ${data.source.title}`}
                segments={segments}
                usedIds={usedIds}
                activeId={activeId}
                onSegmentClick={(segment) => setActiveId((current) => (current === segment.id ? null : segment.id))}
                selectionActions={actions}
                height={TRANSCRIPT_HEIGHT}
              />
            </Section>
          </Panel>
        }
        aside={<MaterialAside detail={data} productionId={productionId} brief={detail?.brief} onEdit={() => setEditing(true)} onEditBrief={() => setEditingBrief(true)} />}
      />
      <MaterialDrawer open={editing} onClose={() => setEditing(false)} detail={data} />
      <BriefDrawer productionId={productionId} open={editingBrief} onClose={() => setEditingBrief(false)} />
    </StagePage>
  );
}
