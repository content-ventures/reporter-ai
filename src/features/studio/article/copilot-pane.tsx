'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Conversation,
  EmptyState,
  LinkButton,
  List,
  ListItem,
  MetaList,
  PageStack,
  PromptComposer,
  Section,
  Tabs,
  type ConversationHandle,
  type PromptPreset,
} from '@content-ventures/design-system/v3';
import { ImagePlus, Sparkles } from '@content-ventures/design-system/v3/icons';
import { assetOriginLabel, IMAGE_ORIENTATION_LABELS, type CheckResult, type ImageSlotUse, type QuoteCheck } from '@/domain';
import { copilotPresets } from '@/registries';
import { ChecksList } from '@/ui/checks-list';
import { formatCount } from '@/ui/format';
import { SourceChipFor } from '@/ui/source-chip-for';
import { issueLine, type ImageToCheck } from './image-model';
import { checagemGroups, clip, closestExcerpt } from './studio-model';
import { useStudio } from './studio-context';
import { MaterialTab } from './source-pane';
import { ContextChips, GenerationTurn, RequestTurn, ReviewNoteTurn } from './copilot-turns';
import type { PanelTab } from './use-article-studio';

/**
 * The studio's one panel ("Painel", CONTRACT §3.8) and its tabs: Material (the interview) ·
 * Assistente (the conversation grounded on the material: the generation trace, requests with their
 * suggestions, the PromptComposer docked below with its context chips and presets) · Checagem
 * (what is missing before sending and the warnings, with "Ir ao trecho", then what to fix one by
 * one: images to check, suggested images to fill, quotations that do not match) · Comentários
 * (the reviewer's note, only after "Ajustes solicitados").
 */

const PRESET_TOOLS = copilotPresets('article');

/** The tab on screen: "Comentários" only exists while adjustments are requested. */
function usePanelTab(): PanelTab {
  const { panes, reviewNote } = useStudio();
  return panes.panelTab === 'comments' && !reviewNote ? 'assistant' : panes.panelTab;
}

export function PanelTabs() {
  const studio = useStudio();
  const tab = usePanelTab();
  const groups = useMemo(() => checagemGroups(studio.checks, studio.openSuggestions), [studio.checks, studio.openSuggestions]);
  const pending = groups.missing.length + groups.warnings.length;
  const items: { value: PanelTab; label: string; count?: number }[] = [
    { value: 'material', label: 'Material' },
    { value: 'assistant', label: 'Assistente' },
    { value: 'checks', label: 'Checagem', ...(pending > 0 ? { count: pending } : {}) },
    ...(studio.reviewNote ? [{ value: 'comments' as const, label: 'Comentários', count: 1 }] : []),
  ];
  return <Tabs label="Painel" size="sm" items={items} value={tab} onChange={studio.panes.setPanelTab} />;
}

export function PanelPane() {
  switch (usePanelTab()) {
    case 'material':
      return <MaterialTab />;
    case 'assistant':
      return <AssistantTab />;
    case 'checks':
      return <ChecksTab />;
    case 'comments':
      return <CommentsTab />;
  }
}

function AssistantTab() {
  const studio = useStudio();
  const conversation = useRef<ConversationHandle | null>(null);
  const hasTurns = Boolean(studio.generation.run) || studio.thread.length > 0;
  const requests = studio.thread.length;
  // A new request of the person (from the text or the composer) brings the thread to its end.
  useEffect(() => {
    if (requests > 0) conversation.current?.scrollToEnd({ smooth: true });
  }, [requests]);
  return (
    <Conversation
      ref={conversation}
      label="Conversa com o Assistente"
      empty={hasTurns ? undefined : <EmptyState icon={Sparkles} title="Pergunte sobre a entrevista ou peça uma mudança no texto." />}
      footer={<Composer />}
    >
      {studio.generation.run ? <GenerationTurn key="generation" /> : null}
      {studio.thread.map((turn) => (
        <RequestTurn key={turn.id} turn={turn} />
      ))}
    </Conversation>
  );
}

/** The reviewer's note and the passages it points at, with "Aplicar nota com IA". */
function CommentsTab() {
  return (
    <Conversation label="Comentários da revisão">
      <ReviewNoteTurn />
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
  // The article generation has its own "Parar" in the header banner: here Enviar just waits.
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
      // A tab another tab took over asks nothing (A10): the banner above says how to edit here.
      disabled={readOnly}
      placeholder={readOnly ? 'Aberta em outra aba' : 'Pergunte sobre a entrevista ou peça uma mudança no texto'}
      inputLabel="Pedir ao Assistente"
      maxLength={2000}
      minRows={2}
      maxRows={8}
    />
  );
}

function ChecksTab() {
  const studio = useStudio();
  const groups = useMemo(() => checagemGroups(studio.checks, studio.openSuggestions), [studio.checks, studio.openSuggestions]);
  const missing = studio.facts.quotes.filter((quote) => quote.status === 'missing');
  const jump = (check: CheckResult) => {
    if (check.id === 'article.suggestions') studio.actions.nextSuggestion();
    else if (check.id === 'article.quotes') studio.actions.nextMissingQuote();
    else if (check.id === 'article.cover') studio.images.revealCover();
    else if (check.id === 'article.image-credits') studio.actions.nextImageIssue();
    else if (check.id === 'article.image-alt' && check.targets?.[0]) studio.actions.showImage(check.targets[0].blockId);
    else if (check.id === 'article.image-slots') studio.actions.nextImageSlot();
    else if (check.targets?.[0]) studio.actions.focusRange(check.targets[0]);
  };
  const allClear = groups.missing.length === 0 && groups.warnings.length === 0;
  return (
    <>
      {allClear ? <Alert tone="success" title="Tudo certo para enviar" /> : null}
      {groups.missing.length > 0 ? (
        <Section title="Falta para enviar" titleAs="h3" meta={formatCount(groups.missing.length)} metaTone="missing">
          <ChecksList checks={groups.missing} onJump={jump} />
        </Section>
      ) : null}
      {groups.warnings.length > 0 ? (
        <Section title="Avisos" titleAs="h3" meta={formatCount(groups.warnings.length)}>
          <ChecksList checks={groups.warnings} onJump={jump} defaultOpen={[]} />
        </Section>
      ) : null}
      {studio.imageIssues.length > 0 ? (
        <Section title="Imagens a conferir" titleAs="h3" meta={formatCount(studio.imageIssues.length)} metaTone="missing">
          <PageStack>
            {studio.imageIssues.map((entry) => (
              <ImageToFix key={entry.blockId} entry={entry} />
            ))}
          </PageStack>
        </Section>
      ) : null}
      {studio.imageSlots.length > 0 && !studio.generation.active ? (
        <Section title="Imagens a preencher" titleAs="h3" meta={formatCount(studio.imageSlots.length)}>
          <List label="Imagens sugeridas a preencher" framed={false} dividers={false} bleed>
            {studio.imageSlots.map((use) => (
              <SlotToFill key={use.blockId} use={use} />
            ))}
          </List>
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
 * A suggested image nobody filled yet: what it should show (jumps to its frame in the text, which
 * opens its bar), its orientation when it is not the column's, and "Enviar imagem" right here.
 */
function SlotToFill({ use }: { use: ImageSlotUse }) {
  const studio = useStudio();
  const orientation = use.slot.orientation && use.slot.orientation !== 'landscape' ? IMAGE_ORIENTATION_LABELS[use.slot.orientation] : undefined;
  return (
    <ListItem
      icon={ImagePlus}
      title={use.slot.subject}
      titleLines={2}
      description={orientation}
      onClick={() => studio.actions.showImageSlot(use.blockId)}
      actions={
        studio.readOnly ? undefined : (
          <LinkButton size="sm" onClick={() => studio.images.fillSlot(use.blockId, { tab: 'upload' })}>
            Enviar imagem
          </LinkButton>
        )
      }
    />
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
