'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  Chip,
  ConfirmDialog,
  ConversationArtifact,
  ConversationTurn,
  LinkButton,
  MetaList,
  Prose,
  SuggestionCard,
  SuggestionGroup,
  type DiffBlock as DsDiffBlock,
} from '@content-ventures/design-system/v3';
import { MessageSquareText, Quote, RotateCcw, Sparkles, Type } from '@content-ventures/design-system/v3/icons';
import {
  isRunActive,
  resolveSourceRef,
  RUN_KIND_LABELS,
  type ArticleBlock,
  type GenerationRun,
  type RunId,
  type SourceRef,
  type Suggestion,
} from '@/domain';
import { EditorContent, useArticleReader } from '@/editor';
import type { RunView } from '@/ports';
import { useRun } from '@/state';
import { formatDuration, plural } from '@/ui/format';
import { usePerson } from '@/ui/person-avatar';
import { Provenance } from '@/ui/provenance';
import { RunTrace, runDuration } from '@/ui/run-trace';
import { SourceChipFor } from '@/ui/source-chip-for';
import { useRelativeTime } from '@/ui/time';
import { useStudio } from './studio-context';
import { clip, isOpenSuggestion, proposalText, suggestionHunks, targetLabel } from './studio-model';
import type { ComposerChip, SessionTurn } from './use-article-studio';

/**
 * Assistant turns (CONTRACT §3.8, tab "Assistente"): the reviewer's note after "Ajustes solicitados" (tab "Comentários"), the
 * article generation (AgentTrace with the key excerpts, Parar, retry per step, the "v1 · IA"
 * artifact) and each request of this session (the person's turn, then the AI with its trace,
 * reply and SuggestionCards). The model is said in each run's "Ver detalhes"; the turns carry how long
 * they took. No thumbs: the turns do not ask for a vote.
 */

type TraceRun = GenerationRun | RunView;

function modelMeta(run: TraceRun | undefined): string | undefined {
  if (!run) return undefined;
  const duration = runDuration(run);
  return duration !== undefined && !isRunActive(run) ? formatDuration(duration) : undefined;
}

/** One chip per transcript segment (a run cites several ranges of the same answer). */
function uniqueSegments(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = ref.locator.type === 'segment' ? `${ref.sourceId}:${ref.locator.segmentId}` : JSON.stringify(ref.locator);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const CHIP_ICON = { selection: Type, excerpt: Quote, note: MessageSquareText } as const;

export function ContextChips({ chips, onRemove }: { chips: readonly ComposerChip[]; onRemove?: (id: string) => void }) {
  return (
    <>
      {chips.map((chip) => (
        <Chip
          key={chip.id}
          size="sm"
          variant="neutral"
          icon={CHIP_ICON[chip.kind]}
          title={chip.text}
          {...(onRemove ? { onRemove: () => onRemove(chip.id), removeLabel: `Remover ${chip.label}` } : {})}
        >
          {chip.label}
        </Chip>
      ))}
    </>
  );
}

/** Read-only text of a reply, through the same reading typography as the article. */
function ReplyText({ blocks }: { blocks: readonly ArticleBlock[] }) {
  const body = useMemo(() => ({ blocks: [...blocks] }), [blocks]);
  const reader = useArticleReader({ body });
  return (
    <Prose variant="compact" measure="wide" align="start">
      <EditorContent editor={reader} />
    </Prose>
  );
}

// ——— Reviewer note ———

export function ReviewNoteTurn() {
  const studio = useStudio();
  const note = studio.reviewNote;
  const reviewer = usePerson(note?.by);
  const when = useRelativeTime(note?.at);
  if (!note) return null;
  const anchors = note.anchors ?? [];
  return (
    <ConversationTurn
      role="assistant"
      icon={MessageSquareText}
      label={reviewer?.name ?? 'Revisão'}
      meta={['Ajustes solicitados', when].filter(Boolean).join(' · ')}
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={Sparkles}
          disabled={studio.generation.active || Boolean(studio.activeAssist)}
          onClick={() =>
            studio.actions.runTool('apply-review-note', {
              prompt: 'Aplicar nota da revisão',
              question: note.note ?? '',
              // Every passage the reviewer pointed at is a target: one suggestion per passage.
              chips: [
                { id: 'review-note', kind: 'note', label: 'Nota da revisão', text: note.note ?? '' },
                ...anchors.map((anchor, index) => ({
                  id: `review-anchor-${index}`,
                  kind: 'selection' as const,
                  label: anchor.excerpt ? `“${clip(anchor.excerpt, 32)}”` : `Trecho ${index + 1}`,
                  ranges: [{ blockId: anchor.blockId, from: anchor.from, to: anchor.to }],
                  text: anchor.excerpt ?? '',
                })),
              ],
              target: anchors.map((anchor) => ({ blockId: anchor.blockId, from: anchor.from, to: anchor.to })),
            })
          }
        >
          Aplicar nota com IA
        </Button>
      }
    >
      {note.note ?? ''}
      {anchors.length > 0 ? (
        <MetaList
          size="xs"
          label="Trechos apontados"
          items={anchors.map((anchor, index) => (
            <LinkButton key={`${anchor.blockId}-${index}`} tone="quiet" size="inherit" onClick={() => studio.actions.focusRange(anchor)}>
              {anchor.excerpt ? `“${anchor.excerpt.length > 48 ? `${anchor.excerpt.slice(0, 48).trimEnd()}…` : anchor.excerpt}”` : `Trecho ${index + 1}`}
            </LinkButton>
          ))}
        />
      ) : null}
    </ConversationTurn>
  );
}

/**
 * An AI version older than the approved one: the assistant does not offer to restore it over the
 * approval (the history drawer still does, with its confirmation).
 */
function olderThanApproved(number: number, approved: number | undefined): boolean {
  return approved !== undefined && number < approved;
}

// ——— Generation ———

export function GenerationTurn() {
  const studio = useStudio();
  const { generation } = studio;
  const [expanded, setExpanded] = useState<{ runId: string; open: boolean } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const run = generation.run;
  if (!run) return null;
  const fold = generation.live?.fold;
  // "Selecionando falas-chave" shows the key excerpts it picked (its own count), not the evidence of every block.
  const sourcesUsed: SourceRef[] = uniqueSegments(fold?.keyRefs ?? fold?.sourcesUsed ?? []);
  const active = generation.active;
  const cancelled = run.status === 'cancelled';
  const failed = run.status === 'failed';
  const version = generation.version;

  return (
    <ConversationTurn
      role="assistant"
      label={RUN_KIND_LABELS[run.kind]}
      // Once the run ends, its provenance line (model · duration · Ver detalhes) closes the turn.
      meta={active ? modelMeta(run) : undefined}
      status={active ? 'streaming' : 'done'}
    >
      <RunTrace
        run={run}
        label="Etapas"
        collapsible
        collapsed={expanded?.runId === run.id ? !expanded.open : !active && !failed}
        onCollapsedChange={(collapsed) => setExpanded({ runId: run.id, open: !collapsed })}
        onRetry={failed ? (stepId) => void (generation.retryable ? studio.actions.retryGeneration(stepId) : studio.actions.generate()) : undefined}
        retryLabel={generation.retryable ? undefined : 'Gerar de novo'}
        stepSources={(step) =>
          step.id === 'select' && sourcesUsed.length > 0 ? (
            <>
              {sourcesUsed.slice(0, 4).map((ref, index) => (
                <SourceChipFor
                  key={`${ref.sourceId}-${index}`}
                  sourceRef={ref}
                  sources={studio.sources}
                  people={studio.people}
                  show="excerpt"
                  onOpen={() => ref.locator.type === 'segment' && studio.linkSegment(ref.locator.segmentId)}
                />
              ))}
              {sourcesUsed.length > 4 ? (
                <Chip size="sm" variant="neutral">
                  {`+${sourcesUsed.length - 4}`}
                </Chip>
              ) : null}
            </>
          ) : null
        }
      />
      {version ? (
        <ConversationArtifact
          title={version.label}
          meta={plural(version.words, 'palavra', 'palavras')}
          onOpen={() => studio.panes.openDialog('history')}
          actions={
            cancelled ? (
              <Button
                size="sm"
                variant="primary"
                icon={RotateCcw}
                onClick={() => void (generation.retryable ? studio.actions.retryGeneration() : studio.actions.generate())}
              >
                {generation.retryable ? 'Continuar de onde parou' : 'Gerar de novo'}
              </Button>
            ) : (!version.isLatest || studio.draft.dirty) && !olderThanApproved(version.number, studio.piece.approvedVersion?.number) ? (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setRestoring(true)}>
                Restaurar
              </Button>
            ) : undefined
          }
        />
      ) : cancelled ? (
        <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => void (generation.retryable ? studio.actions.retryGeneration() : studio.actions.generate())}>
          {generation.retryable ? 'Continuar de onde parou' : 'Gerar de novo'}
        </Button>
      ) : null}
      {version ? (
        <ConfirmDialog
          open={restoring}
          onClose={() => setRestoring(false)}
          title={`Restaurar a ${version.label}?`}
          description={`O texto da v${version.number} volta como uma versão nova. Aprovações não mudam.`}
          confirmLabel="Restaurar versão"
          onConfirm={() => studio.actions.restoreVersion(version.id)}
        />
      ) : null}
      {!active ? <Provenance run={run} /> : null}
    </ConversationTurn>
  );
}

// ——— Requests of this session (and open suggestions from before a reload) ———

function SuggestionCards({ runId, suggestions }: { runId: RunId; suggestions: Suggestion[] }) {
  const studio = useStudio();
  const titles = suggestions.filter((suggestion) => suggestion.proposal.kind === 'title');
  const others = suggestions.filter((suggestion) => suggestion.proposal.kind !== 'title');
  return (
    <>
      {/* The run's turn above says who wrote them ("Ver detalhes"); the cards keep to the passage. */}
      {titles.length > 0 ? <TitleChoices key={`${runId}-titles`} suggestions={titles} /> : null}
      {others.map((suggestion) => {
        const state = studio.stateOf(suggestion);
        const hunks = suggestionHunks(suggestion);
        const where = targetLabel(studio.body, suggestion.target);
        const diff: DsDiffBlock[] | undefined = hunks ? [{ id: suggestion.id, change: 'modified', hunks }] : undefined;
        return (
          <SuggestionCard
            key={suggestion.id}
            title={[suggestion.label ?? 'Sugestão', where].filter(Boolean).join(' · ')}
            state={state}
            {...(diff && isOpenSuggestion(suggestion) ? { diff } : { proposal: proposalText(suggestion.proposal) })}
            shortcuts={studio.focusedSuggestion?.id === suggestion.id}
            onFocus={() => studio.actions.revealSuggestion(suggestion)}
            onAccept={() => void studio.actions.accept(suggestion)}
            onDiscard={() => void studio.actions.discard(suggestion)}
            onReapply={() => void studio.actions.reapply(suggestion)}
          />
        );
      })}
    </>
  );
}

function TitleChoices({ suggestions }: { suggestions: Suggestion[] }) {
  const studio = useStudio();
  const open = suggestions.filter(isOpenSuggestion);
  const applied = suggestions.find((suggestion) => suggestion.state === 'applied');
  const [choice, setChoice] = useState<string | null>(null);
  const state = open.length > 0 ? 'ready' : applied ? 'applied' : 'discarded';
  return (
    <SuggestionCard
      title="Títulos alternativos"
      state={state}
      acceptLabel="Usar título"
      acceptBlockedReason={choice ? undefined : 'Escolha um título'}
      onAccept={() => {
        const picked = open.find((suggestion) => suggestion.id === choice);
        if (!picked) return;
        void (async () => {
          await studio.actions.accept(picked);
          for (const other of open) if (other.id !== picked.id) await studio.actions.discard(other);
        })();
      }}
      onDiscard={() => {
        void (async () => {
          for (const suggestion of open) await studio.actions.discard(suggestion);
        })();
      }}
    >
      {open.length > 0 ? (
        <SuggestionGroup label="Títulos alternativos" value={choice} onValueChange={setChoice}>
          {open.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              variant="compact"
              value={suggestion.id}
              proposal={proposalText(suggestion.proposal)}
              meta={`${proposalText(suggestion.proposal).length} caracteres`}
            />
          ))}
        </SuggestionGroup>
      ) : applied ? (
        proposalText(applied.proposal)
      ) : undefined}
    </SuggestionCard>
  );
}

export function RequestTurn({ turn }: { turn: SessionTurn }) {
  const studio = useStudio();
  const live = useRun(turn.runId ?? null);
  const fold = live.status === 'ready' ? live.data?.fold : undefined;
  const view = turn.runId ? studio.production.runs.find((run) => run.id === turn.runId) : undefined;
  const run: TraceRun | undefined = fold?.run ?? view;
  const suggestions = useMemo(() => studio.suggestions.filter((suggestion) => suggestion.runId === turn.runId), [studio.suggestions, turn.runId]);
  // Streamed blocks are the reply or the preview of a proposal (same id as its suggestion). A
  // finished preview is AI text to review (`ai: 'unreviewed'`); a reply is not. While a block is
  // still streaming, only "Perguntar à IA" writes a reply first; every other tool writes proposals.
  const stored = new Set(suggestions.map((suggestion) => suggestion.id));
  const proposed = new Set(fold?.suggestions.map((suggestion) => suggestion.id) ?? []);
  const isPreview = (block: NonNullable<typeof fold>['blocks'][number], index: number, all: NonNullable<typeof fold>['blocks']): boolean => {
    if (proposed.has(block.id)) return true;
    if (block.final) return block.final.ai === 'unreviewed';
    return turn.toolId !== 'ask' || all.slice(0, index).some((earlier) => proposed.has(earlier.id) || earlier.final?.ai === 'unreviewed');
  };
  const streamed = fold ? fold.blocks.filter((block) => !stored.has(block.id)) : [];
  const replies = streamed
    .filter((block, index, all) => !isPreview(block, index, all))
    .map((block) => block.final ?? { id: block.id, type: 'paragraph' as const, inlines: block.text ? [{ text: block.text }] : [] });
  const previews = streamed.filter((block, index, all) => isPreview(block, index, all));
  const replySources = replies.flatMap((block) => block.sourceRefs ?? []);
  /** Excerpts of the material the reply found, ready to go into the text as quotes. */
  const quotable = uniqueSegments(replySources).flatMap((ref) => {
    if (ref.locator.type !== 'segment') return [];
    const resolved = resolveSourceRef(studio.sources, ref);
    if (!resolved?.segment) return [];
    const start = ref.locator.from ?? 0;
    return [{ segmentId: ref.locator.segmentId, start, end: ref.locator.to ?? resolved.segment.text.length, text: resolved.excerpt }];
  });
  const active = run ? isRunActive(run) : Boolean(turn.runId);
  const failed = run?.status === 'failed';
  const cancelled = run?.status === 'cancelled';
  const runId = turn.runId;

  return (
    <>
      <ConversationTurn role="user" context={turn.chips.length > 0 ? <ContextChips chips={turn.chips} /> : undefined}>
        {turn.prompt}
      </ConversationTurn>
      <ConversationTurn
        role="assistant"
        meta={turn.reply ? undefined : modelMeta(run)}
        status={turn.reply ? 'done' : active ? 'streaming' : failed ? 'error' : cancelled ? 'stopped' : 'done'}
        error={failed ? (run?.error?.message ?? 'A sugestão não foi gerada.') : undefined}
        onRetry={
          runId && failed
            ? () => void (fold ? studio.actions.retryRun(runId) : studio.actions.repeatTurn(turn))
            : runId && !active && !turn.reply
              ? () => studio.actions.repeatTurn(turn)
              : undefined
        }
        onContinue={runId && cancelled ? () => void (fold ? studio.actions.retryRun(runId) : studio.actions.repeatTurn(turn)) : undefined}
        actions={
          !active && quotable.length > 0 ? (
            <Button size="sm" variant="ghost" icon={Quote} onClick={() => quotable.forEach((excerpt) => studio.actions.insertQuote(excerpt))}>
              {quotable.length === 1 ? 'Inserir citação' : 'Inserir citações'}
            </Button>
          ) : undefined
        }
      >
        {turn.reply ? turn.reply : null}
        {active && run ? <RunTrace run={run} label={turn.prompt} variant="compact" announce={false} /> : null}
        {replies.length === 1 && replies[0]?.type === 'paragraph' && !replies[0].sourceRefs ? (
          replies[0].inlines.map((inline) => inline.text).join('')
        ) : replies.length > 0 ? (
          <ReplyText blocks={replies} />
        ) : null}
        {replySources.length > 0 ? (
          <MetaList
            size="xs"
            label="Trechos citados"
            items={replySources.slice(0, 4).map((ref, index) => (
              <SourceChipFor
                key={`${ref.sourceId}-${index}`}
                sourceRef={ref}
                sources={studio.sources}
                people={studio.people}
                index={index + 1}
                variant="inline"
                onOpen={() => ref.locator.type === 'segment' && studio.linkSegment(ref.locator.segmentId)}
              />
            ))}
          />
        ) : null}
        {previews.map((block) => (
          <SuggestionCard key={block.id} title="Escrevendo proposta" state="streaming" proposal={block.text} />
        ))}
        {runId && suggestions.length > 0 ? <SuggestionCards runId={runId} suggestions={suggestions} /> : null}
      </ConversationTurn>
    </>
  );
}
