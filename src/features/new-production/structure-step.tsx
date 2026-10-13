'use client';

import {
  ErrorState,
  ExpandableText,
  Field,
  IconButton,
  Input,
  LinkButton,
  List,
  ListItem,
  MetaList,
  PageStack,
  Popover,
  PopoverHeader,
  Prose,
  SkeletonText,
  Toolbar,
  formatTimestamp,
} from '@content-ventures/design-system/v3';
import { Trash2 } from '@content-ventures/design-system/v3/icons';
import { refKey, type SourceRef } from '@/domain';
import { formatLaudas } from '@/ui/format';
import { MAX_TITLE_LENGTH } from './form';
import {
  addQuote,
  addSection,
  availableQuotes,
  hasHeadings,
  moveSection,
  partTitle,
  removeQuote,
  removeSection,
  renameSection,
  sectionBudgetAt,
  sectionLimits,
  type OutlineDraft,
  type OutlinePlace,
} from './outline-model';
import { quoteView, type QuoteMaterial, type QuoteView } from './outline-quotes';
import type { OutlineRunState } from './use-outline-run';
import { RunTrace } from '@/ui/run-trace';
import { useGenerationFeedback } from '@/ui/use-generation-feedback';

/**
 * "Estrutura" (step 3, CONTRACT §3.9, COPY §6.4): the outline the AI proposed, edited before the
 * article is written. The probable title, the introduction and the sections in order — each with
 * its intertítulo (a Curto has parts without one) and the lines of the interview it is written
 * from. Sections are renamed, reordered, removed and added; a quote belongs to one place only.
 */

export const LOADING_TEXT = 'A IA está montando a estrutura…';

export type StructureStepProps = {
  run: OutlineRunState;
  onRetry: () => void;
  onStop?: () => void;
  retrying: boolean;
  outline: OutlineDraft | null;
  onChange: (draft: OutlineDraft) => void;
  material: QuoteMaterial;
  /** "Padrão · 2 laudas · 3 seções" and what the material gives, above the structure. */
  facts: string[];
  /** The person already tried "Redigir artigo": rows that block it say so. */
  showErrors: boolean;
};

function QuoteExcerpt({ view, onRemove }: { view: QuoteView; onRemove: () => void }) {
  const time = view.startMs !== undefined ? formatTimestamp(view.startMs) : undefined;
  return <ListItem density="sm" title={time ? `${view.speaker} · ${time}` : view.speaker}
    description={<Prose variant="compact" measure="wide"><ExpandableText lines={3} moreLabel="Ler trecho completo" lessLabel="Recolher trecho">{view.excerpt || 'Trecho indisponível.'}</ExpandableText></Prose>}
    actions={<IconButton label={`Tirar citação ${time ?? view.speaker}`} icon={Trash2} variant="ghost" onClick={onRemove} />} />;
}

function QuoteChips({ quotes, material, onRemove, empty }: { quotes: readonly SourceRef[]; material: QuoteMaterial; onRemove: (ref: SourceRef) => void; empty: string }) {
  if (quotes.length === 0) return empty;
  return (
    <List label="Trechos selecionados" framed={false}>
      {quotes.map((ref) => (
        <QuoteExcerpt key={refKey(ref)} view={quoteView(ref, material)} onRemove={() => onRemove(ref)} />
      ))}
    </List>
  );
}

/** "+ citação": the quotable lines not used anywhere else, to add here. */
function AddQuote({ place, available, material, onAdd }: { place: OutlinePlace; available: readonly SourceRef[]; material: QuoteMaterial; onAdd: (place: OutlinePlace, ref: SourceRef) => void }) {
  return (
    <Popover label="Citações da entrevista" width={400} trigger={(props) => <LinkButton {...props}>+ citação</LinkButton>}>
      {({ close }) => (
        <>
          <PopoverHeader title="Citações da entrevista" meta={available.length > 0 ? String(available.length) : undefined} />
          {available.length === 0 ? (
            <MetaList size="sm" items={['Todas as citações já estão na estrutura.']} />
          ) : (
            <List label="Citações da entrevista" framed={false} maxHeight={288}>
              {available.map((ref) => {
                const view = quoteView(ref, material);
                const time = view.startMs !== undefined ? formatTimestamp(view.startMs) : undefined;
                return (
                  <ListItem
                    key={view.key}
                    density="sm"
                    titleLines={2}
                    title={view.excerpt}
                    description={time ? `${view.speaker} · ${time}` : view.speaker}
                    meta="Adicionar"
                    onClick={() => {
                      onAdd(place, ref);
                      close();
                    }}
                  />
                );
              })}
            </List>
          )}
        </>
      )}
    </Popover>
  );
}

export function StructureStep({ run, onRetry, onStop, retrying, outline, onChange, material, facts, showErrors }: StructureStepProps) {
  const feedback = useGenerationFeedback(run.status === 'running' ? run.run : undefined);
  if (run.status === 'failed') {
    return <PageStack>
      <ErrorState size="panel" title={run.run?.status === 'cancelled' ? 'Geração interrompida.' : 'Não foi possível montar a estrutura.'} description={run.message} onRetry={onRetry} retrying={retrying} />
      {run.run && <RunTrace run={run.run} label="Etapas da estrutura" />}
    </PageStack>;
  }
  if (run.status !== 'ready' || !outline) {
    return (
      <PageStack>
        {run.status === 'running' ? <>
          <RunTrace run={run.run} label="Montando a estrutura" collapsible={false} />
          <MetaList size="sm" items={[feedback?.elapsed,feedback?.background].filter(Boolean) as string[]} />
          {onStop && <LinkButton onClick={onStop}>Parar geração</LinkButton>}
        </> : <SkeletonText lines={5} label="Iniciando a geração…" />}
      </PageStack>
    );
  }

  const headings = hasHeadings(outline);
  const limits = sectionLimits(outline);
  const available = availableQuotes(outline);
  const place = (target: OutlinePlace, ref: SourceRef) => onChange(addQuote(outline, target, ref));
  const reason = [limits.canAdd ? undefined : limits.addReason, limits.canRemove ? undefined : limits.removeReason].filter(Boolean) as string[];
  const note = headings ? undefined : 'Notícia de 1 lauda não leva intertítulos.';

  return (
    <PageStack>
      <MetaList size="sm" items={facts} label="Resumo da estrutura" />
      <Field label="Título provável" required error={showErrors && !outline.title.trim() ? 'Dê um título ao artigo.' : undefined}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={outline.title}
            maxLength={MAX_TITLE_LENGTH}
            onChange={(event) => onChange({ ...outline, title: event.target.value })}
          />
        )}
      </Field>
      <List label="Estrutura" framed onReorder={(from, to) => onChange(moveSection(outline, from - 1, to - 1))}>
        <ListItem
          title="Introdução"
          description={
            <><QuoteChips
              quotes={outline.intro}
              material={material}
              empty="Sem citações."
              onRemove={(ref) => onChange(removeQuote(outline, 'intro', ref))}
            /><Toolbar label="Ações da introdução" overflow="wrap">
              <MetaList size="sm" items={[`≈ ${formatLaudas(outline.introBudget)}`]} />
              <AddQuote place="intro" available={available} material={material} onAdd={place} />
            </Toolbar></>
          }
        />
        {outline.sections.map((section, index) => {
          const missingTitle = showErrors && headings && !section.title.trim();
          const missingQuote = showErrors && section.quotes.length === 0;
          return (
            <ListItem
              key={section.key}
              draggable
              title={
                headings ? (
                  <Input
                    aria-label={`Intertítulo ${index + 1}`}
                    invalid={missingTitle}
                    value={section.title}
                    maxLength={MAX_TITLE_LENGTH}
                    placeholder={`Intertítulo ${index + 1}`}
                    onChange={(event) => onChange(renameSection(outline, section.key, event.target.value))}
                  />
                ) : (
                  partTitle(index)
                )
              }
              description={
                <><QuoteChips
                  quotes={section.quotes}
                  material={material}
                  empty={missingQuote ? 'Cada seção precisa de pelo menos uma citação.' : 'Sem citações ainda.'}
                  onRemove={(ref) => onChange(removeQuote(outline, section.key, ref))}
                /><Toolbar label={`Ações da seção ${index + 1}`} overflow="wrap">
                  <MetaList size="sm" items={[`≈ ${formatLaudas(sectionBudgetAt(outline, index))}`]} />
                  <AddQuote place={section.key} available={available} material={material} onAdd={place} />
                  <IconButton
                    label="Tirar seção"
                    icon={Trash2}
                    variant="ghost"
                    disabled={!limits.canRemove}
                    onClick={() => onChange(removeSection(outline, section.key))}
                  />
                </Toolbar></>
              }
            />
          );
        })}
      </List>
      <LinkButton disabled={!limits.canAdd} onClick={() => onChange(addSection(outline).draft)}>
        + Seção
      </LinkButton>
      {note || reason.length > 0 ? <MetaList size="sm" items={[note, ...reason].filter(Boolean) as string[]} /> : null}
    </PageStack>
  );
}
