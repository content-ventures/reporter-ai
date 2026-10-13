'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  Skeleton,
  SkeletonText,
  Tooltip,
} from '@content-ventures/design-system/v3';
import { FileText, RotateCcw, Sparkles } from '@content-ventures/design-system/v3/icons';
import { sizeOf, WRITING_FLOW } from '@/domain';
import { EditorContent } from '@/editor';
import { formatCharacters, formatLaudas, plural } from '@/ui/format';
import { materialHref } from '@/ui/routes';
import { CoverSlot } from './cover-slot';
import { RunTrace } from '@/ui/run-trace';
import { useGenerationFeedback } from '@/ui/use-generation-feedback';
import { useStudio } from './studio-context';
import { useSpeakersWithoutPerson } from './studio-footer';
import { ProviderPreview } from './provider-preview';
import { useRuntime } from '@/state';
import { contentHash } from '@/domain/text/hash';

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
        </>
      }
      onWheel={studio.noteUserScroll}
      onTouchMove={studio.noteUserScroll}
    >
      <PageStack>
        {!generation.active ? <AutomaticArticleImages /> : null}
        {providerProgress && !preview?.blocks.length ? <PendingStructure /> : null}
        {preview?.blocks.length ? <ProviderPreview body={preview} /> : <EditorContent editor={editor} />}
        {providerProgress && preview?.blocks.length ? <StreamingStatus /> : null}
        {generation.active && !providerProgress ? <PendingStructure /> : null}
        {studio.empty && !writing && !generation.active ? <EmptyDraft /> : null}
      </PageStack>
    </Prose>
  );
}

function AutomaticArticleImages() {
  const studio = useStudio(),{ runtime } = useRuntime();
  const [busy,setBusy] = useState(false),[error,setError] = useState<string>();
  const slots = [studio.body.coverSlot,...studio.body.blocks.flatMap(block => block.type === 'figure' && block.slot ? [block.slot] : [])].filter(Boolean);
  const unavailable = slots.find(slot => slot?.availability)?.availability;
  const port = runtime?.visuals;
  if (!slots.length || !port?.illustrate) return null;
  async function search() {
    if (!port?.illustrate || busy) return;
    setBusy(true);setError(undefined);
    try {
      await studio.sync.idle();
      const result = await port.illustrate(studio.production.id,studio.sync.base(),contentHash(studio.body));
      if (!result.filled) setError(result.codes.includes('PIXABAY_ORIGINAL_REQUIRED') ? 'Libere os originais no Pixabay para preencher as imagens em alta resolução.' : 'Nenhuma foto pertinente foi preenchida. Você pode tentar novamente ou escolher outra na biblioteca.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível buscar fotos. Seu artigo continua salvo.'); }
    finally { setBusy(false); }
  }
  return <Alert compact tone={unavailable || error ? 'warning' : 'info'} title={busy ? 'Buscando fotos no Pixabay' : 'Imagens do artigo'}>
    {error ?? unavailable?.message ?? 'Preencha os espaços planejados sem subir arquivos manualmente.'}
    <Button size="sm" loading={busy} disabled={!studio.canEdit || studio.locked || studio.sync.status.status !== 'saved'} onClick={() => void search()}>Buscar imagens automaticamente</Button>
    {unavailable?.code === 'PIXABAY_ORIGINAL_REQUIRED' ? <ButtonLink href="https://pixabay.com/api/docs/#api_support" target="_blank" rel="noopener noreferrer" size="sm">Liberar originais no Pixabay</ButtonLink> : null}
  </Alert>;
}

function StreamingStatus() {
  const { generation } = useStudio();
  const feedback = useGenerationFeedback(generation.run);
  return <MetaList size="sm" label="Estado da redação" items={[feedback?.detail ?? feedback?.label ?? 'Escrevendo',feedback?.elapsed,
    'Prévia em tempo real. Edição liberada após validar o artigo.'].filter(Boolean) as string[]} />;
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
      readOnly={generatingTitle || studio.readOnly || studio.generation.active}
      onCommit={studio.commitTitle}
    />
  );
}

/** Sections the generation planned but has not written yet ("skeleton pela estrutura"). */
function PendingStructure() {
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
    <RunTrace run={run} label="Preparando o artigo" collapsible={false} />
    <MetaList size="sm" items={[feedback?.elapsed,'O texto aparecerá aqui assim que a IA começar a escrever.',feedback?.background].filter(Boolean) as string[]} />
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
  const studio = useStudio();
  const { generation } = studio;
  const guard = studio.production.guards.pieces.article?.generate;
  const source = studio.production.sources[0];
  const spec = sizeOf(studio.production.brief.size);
  const run = generation.run;
  const stopped = run && (run.status === 'failed' || run.status === 'cancelled') ? run : undefined;
  const failedStep = stopped?.steps.find((step) => step.state === 'error');
  const resume = stopped && generation.retryable;
  const meta = [
    source ? `Material v${source.version} · ${plural(source.words, 'palavra', 'palavras')}` : null,
    `${spec.label}: até ${formatLaudas(spec.maxChars)} (${formatCharacters(spec.maxChars)})`,
  ]
    .filter(Boolean)
    .join(' · ');
  const blocked = guard && !guard.allowed ? guard.reason : null;
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
        actions={
          <>
            {resume ? (
              <Button variant="primary" icon={RotateCcw} onClick={() => void studio.actions.retryGeneration(failedStep?.id)}>
                Continuar de onde parou
              </Button>
            ) : null}
            {blocked ? <Tooltip content={blocked}>{generate}</Tooltip> : generate}
            {blocked ? (
              <ButtonLink href={materialHref(studio.production.id)}>Abrir material</ButtonLink>
            ) : resume ? null : (
              <Button onClick={() => studio.editor?.commands.focus('start')}>Escrever do zero</Button>
            )}
          </>
        }
      />
    </PageStack>
  );
}
