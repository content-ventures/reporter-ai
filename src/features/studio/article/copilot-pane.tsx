'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Conversation,
  EmptyState,
  LinkButton,
  MetaList,
  PageStack,
  PromptComposer,
  PromptModelMenu,
  Section,
  Tabs,
  type ConversationHandle,
  type PromptPreset,
} from '@content-ventures/design-system/v3';
import { Sparkles } from '@content-ventures/design-system/v3/icons';
import { assetOriginLabel, SIMULATED_MODEL, type CheckResult, type QuoteCheck } from '@/domain';
import { copilotPresets } from '@/registries';
import { ChecksList } from '@/ui/checks-list';
import { formatCount } from '@/ui/format';
import { SourceChipFor } from '@/ui/source-chip-for';
import { issueLine, type ImageToCheck } from './image-model';
import { clip, closestExcerpt } from './studio-model';
import { useStudio } from './studio-context';
import { ContextChips, GenerationTurn, RequestTurn, ReviewNoteTurn } from './copilot-turns';
import type { CopilotTab } from './use-article-studio';

/**
 * "Copiloto" (PLAN §3.5): IA — the conversation grounded on the material (review note, the
 * generation trace, requests with their suggestions) with the PromptComposer docked below
 * (context chips, presets from the registry, model "Simulação local", Enviar/Parar) — and
 * Checagem, the readiness checks of the text on screen with "Ir para o próximo".
 */

const PRESET_TOOLS = copilotPresets('article');
const MODEL_OPTIONS = [{ value: SIMULATED_MODEL.alias, label: SIMULATED_MODEL.label, meta: 'Padrão' }];

export function CopilotTabs() {
  const studio = useStudio();
  const failing = studio.checks.filter((check) => check.status === 'warn' || check.status === 'fail').length;
  const items: { value: CopilotTab; label: string; count?: number }[] = [
    { value: 'ai', label: 'IA' },
    { value: 'checks', label: 'Checagem', ...(failing > 0 ? { count: failing } : {}) },
  ];
  return <Tabs label="Copiloto" size="sm" items={items} value={studio.copilotTab} onChange={studio.setCopilotTab} />;
}

export function CopilotPane() {
  const studio = useStudio();
  return studio.copilotTab === 'ai' ? <CopilotConversation /> : <ChecksTab />;
}

function CopilotConversation() {
  const studio = useStudio();
  const conversation = useRef<ConversationHandle | null>(null);
  const hasTurns = Boolean(studio.reviewNote) || Boolean(studio.generation.run) || studio.thread.length > 0;
  const requests = studio.thread.length;
  // A new request of the person (from the text or the composer) brings the thread to its end.
  useEffect(() => {
    if (requests > 0) conversation.current?.scrollToEnd({ smooth: true });
  }, [requests]);
  return (
    <Conversation
      ref={conversation}
      label="Conversa com o copiloto"
      empty={hasTurns ? undefined : <EmptyState icon={Sparkles} title="Nenhum pedido ainda" meta={SIMULATED_MODEL.label} />}
      footer={<Composer />}
    >
      {studio.generation.run ? <GenerationTurn key="generation" /> : null}
      {studio.reviewNote ? <ReviewNoteTurn key="review" /> : null}
      {studio.thread.map((turn) => (
        <RequestTurn key={turn.id} turn={turn} />
      ))}
    </Conversation>
  );
}

/**
 * Presets that make sense now: none on an empty draft, the selection rewrite, then the
 * article-wide tools of `documentTools` (with "Encurtar para 500 palavras" from the brief).
 */
function usePresets(): PromptPreset[] {
  const { empty, documentTools } = useStudio();
  return useMemo(() => {
    if (empty) return [];
    const labels = new Map(documentTools.map((tool) => [tool.id, tool.label]));
    return PRESET_TOOLS.filter((tool) => tool.target !== 'document' || labels.has(tool.id)).map((tool) => {
      const label = labels.get(tool.id) ?? tool.label;
      return { id: tool.id, label, prompt: label };
    });
  }, [empty, documentTools]);
}

function Composer() {
  const { bindComposer, composer, setComposer, chips, removeChip, generation, activeAssist, actions, readOnly } = useStudio();
  const presets = usePresets();
  // The article generation has its own "Parar geração" in the footer: here Enviar just waits.
  const busy = generation.active || Boolean(activeAssist);
  const context = chips.length > 0 ? <ContextChips chips={chips} onRemove={removeChip} /> : undefined;
  return (
    <PromptComposer
      ref={bindComposer}
      value={composer}
      onChange={setComposer}
      onSubmit={({ text, presetId }) => {
        if (presetId) actions.runPreset(presetId);
        else actions.ask(text);
      }}
      status={busy ? 'streaming' : 'idle'}
      onStop={activeAssist && !generation.active ? () => void actions.stopAssist() : undefined}
      context={context}
      presets={presets}
      presetAction="submit"
      model={<PromptModelMenu value={SIMULATED_MODEL.alias} options={MODEL_OPTIONS} onChange={() => undefined} />}
      // A tab another tab took over asks nothing (A10): the banner above says how to edit here.
      disabled={readOnly}
      placeholder={readOnly ? 'Aberta em outra aba' : 'Peça uma mudança ou pergunte sobre a entrevista…'}
      inputLabel="Pedido ao copiloto"
      maxLength={2000}
      minRows={2}
      maxRows={8}
    />
  );
}

function ChecksTab() {
  const studio = useStudio();
  const { readiness } = studio;
  const missing = studio.facts.quotes.filter((quote) => quote.status === 'missing');
  const jump = (check: CheckResult) => {
    if (check.id === 'article.ai-reviewed') studio.actions.nextAiBlock();
    else if (check.id === 'article.quotes') studio.actions.nextMissingQuote();
    else if (check.id === 'article.cover') studio.images.revealCover();
    else if (check.id === 'article.image-credits') studio.actions.nextImageIssue();
    else if (check.id === 'article.image-alt' && check.targets?.[0]) studio.actions.showImage(check.targets[0].blockId);
    else if (check.targets?.[0]) studio.actions.focusRange(check.targets[0]);
  };
  return (
    <>
      <Section
        title="Prontidão"
        titleAs="h3"
        meta={readiness.ready ? `${readiness.passed}/${readiness.total}` : 'Bloqueia a aprovação'}
        metaTone={readiness.ready ? 'muted' : 'missing'}
      >
        <ChecksList checks={studio.checks} onJump={jump} />
      </Section>
      {studio.imageIssues.length > 0 ? (
        <Section title="Imagens a conferir" titleAs="h3" meta={formatCount(studio.imageIssues.length)} metaTone="missing">
          <PageStack>
            {studio.imageIssues.map((entry) => (
              <ImageToFix key={entry.blockId} entry={entry} />
            ))}
          </PageStack>
        </Section>
      ) : null}
      {missing.length > 0 ? (
        <Section title="Citações que não batem" titleAs="h3" meta={formatCount(missing.length)} metaTone="missing">
          <PageStack>
            {missing.map((quote) => (
              <MissingQuote key={`${quote.blockId}-${quote.range.from}`} quote={quote} />
            ))}
          </PageStack>
        </Section>
      ) : null}
    </>
  );
}

/**
 * An image without credit, authorisation or file ("Imagens com crédito"): its caption (or "Imagem
 * de destaque") jumps to it, what is missing, where it came from, and the fix — "Editar legenda
 * e crédito" (credit and rights belong to the image), or "Trocar imagem" when the file is not here.
 */
function ImageToFix({ entry }: { entry: ImageToCheck }) {
  const studio = useStudio();
  const { images } = studio;
  const fix = () => {
    const missingFile = !entry.asset;
    if (entry.role === 'cover') images.openCover(missingFile ? 'choose' : 'edit');
    else if (missingFile) images.replaceFigure(entry.blockId);
    else images.editFigure(entry.blockId);
  };
  return (
    <Alert
      tone="warning"
      // A list item of Checagem, not a live announcement each time the tab opens.
      role="none"
      title={
        <LinkButton tone="inherit" size="inherit" onClick={() => studio.actions.showImage(entry.blockId)}>
          {entry.role === 'cover' ? entry.label : clip(entry.label, 90)}
        </LinkButton>
      }
      action={<LinkButton onClick={fix}>{entry.asset ? 'Editar legenda e crédito' : 'Trocar imagem'}</LinkButton>}
    >
      <MetaList size="sm" items={[issueLine(entry.issues), entry.asset ? assetOriginLabel(entry.asset.origin) : null]} />
    </Alert>
  );
}

/**
 * A quotation the transcript does not back ("Falta"): the words in the text, the closest line
 * of the material with its source chip (opens the segment, lit), and "Usar texto da fonte"
 * (replaces the quotation with the transcript's words; one undo reverts it).
 */
function MissingQuote({ quote }: { quote: QuoteCheck }) {
  const studio = useStudio();
  const closest = useMemo(() => closestExcerpt(quote, studio.sources), [quote, studio.sources]);
  const ref = quote.sourceRefs[0];
  const segmentRefFor = closest && ref?.locator.type === 'segment' ? { ...ref, locator: { type: 'segment' as const, segmentId: closest.segmentId, from: closest.from, to: closest.to } } : ref;
  return (
    <Alert
      tone="danger"
      // A list item of Checagem, not a live announcement each time the tab opens.
      role="none"
      title={<LinkButton tone="inherit" size="inherit" onClick={() => studio.actions.showQuote(quote.range)}>{`“${clip(quote.text, 90)}”`}</LinkButton>}
      action={
        closest ? (
          <LinkButton onClick={() => studio.actions.useSourceText(quote.range, closest.text)}>Usar texto da fonte</LinkButton>
        ) : undefined
      }
    >
      <MetaList
        size="sm"
        items={[
          closest ? `Na fonte: “${clip(closest.text, 120)}”` : 'Sem trecho parecido no material',
          segmentRefFor ? (
            <SourceChipFor
              key="chip"
              sourceRef={segmentRefFor}
              sources={studio.sources}
              people={studio.people}
              state="missing"
              onOpen={closest ? () => studio.actions.showInTranscript(closest.segmentId) : undefined}
            />
          ) : null,
        ]}
      />
    </Alert>
  );
}
