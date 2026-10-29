'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import {
  Alert,
  Button,
  ButtonLink,
  EditableTitle,
  EmptyState,
  LinkButton,
  MetaList,
  PageStack,
  Prose,
  Progress,
  LiveRegion,
  Skeleton,
  SkeletonText,
  Tooltip,
} from '@content-ventures/design-system/v3';
import { FileText, RotateCcw, Sparkles } from '@content-ventures/design-system/v3/icons';
import { briefMaxChars, briefSizeName, sizeOf, WRITING_FLOW } from '@/domain';
import { EditorContent } from '@/editor';
import { formatCharacters, formatLaudas, plural } from '@/ui/format';
import { materialHref } from '@/ui/routes';
import { CoverSlot } from './cover-slot';
import { useGenerationFeedback } from '@/ui/use-generation-feedback';
import { useStudio } from './studio-context';
import { useSpeakersWithoutPerson } from './studio-footer';
import { ProviderPreview } from './provider-preview';

/**
 * The writing canvas (PLAN §3.5 "Texto"): the cover ("Imagem de destaque"), the article title and
 * the TipTap document inside the DS `Prose` (reading typography, `data-*` hooks for AI blocks,
 * suggestions, the lit source and the figures).
 * Placing the caret in (or selecting) a paragraph lights its transcript excerpt — hover does nothing,
 * so the transcript never scrolls under a passing pointer. While a generation streams, the
 * structure still to be written shows as skeletons; an empty draft offers "Gerar rascunho".
 */
export function EditorCanvas() {
  const studio = useStudio();
  const { editor, generation } = studio;
  const providerProgress = generation.active && generation.run?.model.engine === 'provider';
  const preview = providerProgress ? generation.live?.fold.preview : undefined;
  const writing = studio.production.flowId === WRITING_FLOW.id;
  const editable = studio.canEdit && !studio.readOnly && !studio.locked;
  useEffect(() => {
    if (writing && editable && studio.empty) editor?.commands.focus('start');
  }, [editor, writing, editable, studio.empty]);

  return (
    <Prose
      variant="edit"
      size="sm"
      label="Texto do artigo"
      header={
        <>
          <CoverSlot />
          <ArticleTitle />
          <ArticleDek />
        </>
      }
      onWheel={studio.noteUserScroll}
      onTouchMove={studio.noteUserScroll}
    >
      <PageStack>
        {providerProgress && !preview?.blocks.length ? <PendingArticle /> : null}
        {preview?.blocks.length ? <ProviderPreview body={preview} /> : <EditorContent editor={editor} />}
        {providerProgress && preview?.blocks.length ? <StreamingStatus /> : null}
        {generation.active && !providerProgress ? <PendingArticle /> : null}
        {studio.empty && !writing && !generation.active ? <EmptyDraft /> : null}
      </PageStack>
    </Prose>
  );
}

function StreamingStatus() {
  const { generation } = useStudio();
  const feedback = useGenerationFeedback(generation.run);
  return <MetaList size="sm" label="Estado da redação" items={[feedback?.detail ?? feedback?.label ?? 'Escrevendo',feedback?.elapsed,
    'Prévia em tempo real'].filter(Boolean) as string[]} />;
}

function ArticleTitle() {
  const studio = useStudio();
  const generatingTitle = studio.generation.active && !studio.storedTitle;
  return (
    // h2: the page's h1 is the production in the header line; the article title heads the text.
    <EditableTitle
      size="page"
      as="h2"
      label="Título do artigo"
      value={studio.title}
      placeholder={generatingTitle ? 'Gerando título…' : 'Título do artigo'}
      maxLength={140}
      readOnly={generatingTitle || !studio.canEdit || studio.readOnly || studio.generation.active}
      onCommit={studio.commitTitle}
    />
  );
}

/**
 * "Linha fina" of an event format (and of any text that has one): the line under the title that
 * completes it, as the outlet publishes it. Articles without a format and without one show nothing.
 */
function ArticleDek() {
  const studio = useStudio();
  if (!studio.production.brief.format && !studio.dek) return null;
  const generating = studio.generation.active && !studio.dek;
  return (
    <EditableTitle
      size="card"
      as="h3"
      label="Linha fina"
      value={studio.dek}
      placeholder={generating ? 'Gerando linha fina…' : 'Linha fina'}
      maxLength={240}
      readOnly={generating || !studio.canEdit || studio.readOnly || studio.generation.active}
      onCommit={studio.commitDek}
    />
  );
}

/** Loading lives in the editor until the first preview replaces the skeleton paragraphs. */
function PendingArticle() {
  const studio = useStudio();
  const run = studio.generation.run;
  const feedback = useGenerationFeedback(run);
  const fold = studio.generation.live?.fold;
  const count = useMemo(() => {
    if (!fold) return 2;
    if (fold.outline.length === 0) return fold.blocks.length === 0 ? 2 : 0;
    const written = new Set(fold.blocks.map((block) => block.id));
    return fold.outline.filter((section) => !section.blockId || !written.has(section.blockId)).length;
  }, [fold]);
  if (run?.model.engine === 'provider') return <PageStack>
    <MetaList size="sm" label="Preparo do artigo" items={[feedback?.detail ?? feedback?.label ?? 'Preparando o artigo', feedback?.elapsed].filter(Boolean) as string[]} />
    <Progress aria-label="Preparando o artigo" />
    <SkeletonText lines={4} lineHeight={28} label="Aguardando os primeiros parágrafos" />
    <SkeletonText lines={3} lineHeight={28} />
    <LiveRegion message={feedback?.label ?? 'Preparando o artigo'} />
  </PageStack>;
  if (count === 0) return null;
  return (
    <PageStack>
      {Array.from({ length: count }, (_, index) => (
        <PageStack key={index}>
          <Skeleton width="44%" height={18} delay={index * 80} />
          <SkeletonText lines={3} lineHeight={28} label="Seção a escrever" />
        </PageStack>
      ))}
    </PageStack>
  );
}

function EmptyDraft() {
  const workspaceHrefFor = useWorkspaceHref();
  const studio = useStudio();
  const { generation } = studio;
  const guard = studio.production.guards.pieces.article?.generate;
  const source = studio.production.sources[0];
  const brief = studio.production.brief;
  const maxChars = briefMaxChars(brief);
  const run = generation.run;
  const stopped = run && (run.status === 'failed' || run.status === 'cancelled') ? run : undefined;
  const failedStep = stopped?.steps.find((step) => step.state === 'error');
  const resume = stopped && generation.retryable;
  const meta = [
    source ? `Material v${source.version} · ${plural(source.words, 'palavra', 'palavras')}` : null,
    brief.format ? `${briefSizeName(brief)}: até ${formatCharacters(maxChars)}` : `${sizeOf(brief.size).label}: até ${formatLaudas(maxChars)} (${formatCharacters(maxChars)})`,
  ]
    .filter(Boolean)
    .join(' · ');
  const blocked = guard && !guard.allowed ? guard.reason : studio.bankReadiness.reason;
  // Quotes are attributed from "Falantes" (REQ-T.7): who speaks is decided before the AI writes.
  const router = useRouter();
  const unmapped = useSpeakersWithoutPerson();
  const [asked, setAsked] = useState(false);
  const generate = (
    <Button
      variant={resume ? 'secondary' : 'primary'}
      icon={Sparkles}
      aria-disabled={blocked ? true : undefined}
      onClick={() => {
        if (blocked) return;
        if (unmapped > 0) setAsked(true);
        else void studio.actions.generate();
      }}
    >
      {stopped ? 'Gerar do início' : 'Gerar rascunho'}
    </Button>
  );
  const title = stopped
    ? stopped.status === 'failed'
      ? `Geração parou em ${failedStep?.label ?? 'uma etapa'}`
      : 'Geração interrompida'
    : 'Texto em branco';
  const speakers =
    asked && unmapped > 0 ? (
      <Alert
        tone="danger"
        title={plural(unmapped, 'falante sem pessoa', 'falantes sem pessoa')}
        action={<LinkButton onClick={() => router.push(materialHref(studio.production.id))}>Ligar pessoas</LinkButton>}
      >
        Ligue cada falante a uma pessoa ou marque “Sem atribuição” para gerar o artigo.
      </Alert>
    ) : null;
  return (
    <PageStack>
      {speakers}
      <EmptyState
        icon={stopped ? RotateCcw : FileText}
        title={title}
        meta={meta}
        actions={!studio.canEdit ? undefined : (
          <>
            {resume ? (
              <Button variant="primary" icon={RotateCcw} onClick={() => void studio.actions.retryGeneration(failedStep?.id)}>
                Continuar de onde parou
              </Button>
            ) : null}
            {blocked ? <Tooltip content={blocked}>{generate}</Tooltip> : generate}
            {blocked ? (
              <ButtonLink href={workspaceHrefFor(materialHref(studio.production.id))}>Abrir material</ButtonLink>
            ) : resume ? null : (
              <Button onClick={() => studio.editor?.commands.focus('start')}>Escrever do zero</Button>
            )}
          </>
        )}
      />
    </PageStack>
  );
}
