'use client';

import type { Ref } from 'react';
import {
  ChoiceCard,
  DatePicker,
  FormRow,
  FormSection,
  Grid,
  Input,
  Segmented,
  Select,
  Switch,
  Textarea,
  type SectionState,
  type SegmentOption,
  type SelectOption,
} from '@content-ventures/design-system/v3';
import { expectedDraftWords, LENGTH_TARGETS, type ArticleLength, type SourceOrigin } from '@/domain';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { formatCount } from '@/ui/format';
import {
  MAX_ANGLE_LENGTH,
  MAX_TITLE_LENGTH,
  SECTION_OPTIONS,
  structureLabel,
  type DeliveryPlan,
  type NewProductionDraft,
} from './form';

/**
 * "Contexto", "Artigo" and "Entregas" (PLAN §3.3): what the production is called and where the
 * material comes from, the editorial brief the generation follows, and which pieces it delivers.
 * "Material autorizado" is the gate of "Gerar artigo" (REQ-T.1).
 */

type Patch = (patch: Partial<NewProductionDraft>) => void;

const ORIGINS: SelectOption[] = (Object.keys(SOURCE_ORIGIN_LABELS) as SourceOrigin[]).map((origin) => ({
  value: origin,
  label: SOURCE_ORIGIN_LABELS[origin],
}));

const SECTIONS: SegmentOption<(typeof SECTION_OPTIONS)[number]>[] = SECTION_OPTIONS.map((value) => ({ value, label: value }));

const LENGTHS: SegmentOption<ArticleLength>[] = (Object.keys(LENGTH_TARGETS) as ArticleLength[]).map((length) => ({
  value: length,
  label: LENGTH_TARGETS[length].label,
}));

export type ContextSectionProps = {
  draft: NewProductionDraft;
  update: Patch;
  titleError: string | undefined;
  titleRef: Ref<HTMLInputElement>;
  authorizationId: string;
  /** Today (YYYY-MM-DD): the recording date cannot be in the future. */
  /** Latest selectable date (after hydration). */
  today?: string;
};

export function ContextSection({ draft, update, titleError, titleRef, authorizationId, today }: ContextSectionProps) {
  const state: SectionState = titleError ? 'error' : draft.title.trim() && draft.authorized ? 'done' : draft.title.trim() ? 'active' : 'empty';
  return (
    <FormSection title="Contexto" titleAs="h2" state={state} open>
      <FormRow label="Título interno" required error={titleError}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            ref={titleRef}
            aria-describedby={describedBy}
            invalid={invalid}
            value={draft.title}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Ex.: Entrevista Ateliê Sul"
            onChange={(event) => update({ title: event.target.value })}
          />
        )}
      </FormRow>
      <FormRow label="Origem">
        {({ id, describedBy }) => (
          <Select id={id} describedBy={describedBy} value={draft.origin} options={ORIGINS} onChange={(value) => update({ origin: value as SourceOrigin })} />
        )}
      </FormRow>
      <FormRow label="Data" optional>
        {({ id, describedBy }) => (
          <DatePicker id={id} describedBy={describedBy} value={draft.recordedOn} max={today} editable onChange={(value) => update({ recordedOn: value })} />
        )}
      </FormRow>
      <FormRow label="Material autorizado" description="Obrigatório para gerar">
        <Switch
          id={authorizationId}
          label="Os falantes autorizaram o uso"
          checked={draft.authorized}
          onCheckedChange={(authorized) => update({ authorized })}
        />
      </FormRow>
    </FormSection>
  );
}

export function ArticleSection({ draft, update, wordsAvailable }: { draft: NewProductionDraft; update: Patch; wordsAvailable?: number }) {
  const target = LENGTH_TARGETS[draft.length];
  // A short material gives all it has, never invented text: the field says so before generating (A09).
  const expected = wordsAvailable !== undefined && wordsAvailable > 0 ? expectedDraftWords(draft.length, wordsAvailable) : undefined;
  const short = expected && !expected.reachesTarget ? expected.words : undefined;
  const lengthHint = short ? `O material rende ≈ ${formatCount(short)} palavras` : `${formatCount(target.min)}–${formatCount(target.max)} palavras`;
  return (
    <FormSection title="Artigo" titleAs="h2" state="done" open meta={short ? `≈ ${formatCount(short)} de ${formatCount(target.words)} palavras` : `≈ ${formatCount(target.words)} palavras`}>
      <FormRow label="Orientação editorial" optional>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={MAX_ANGLE_LENGTH}
            value={draft.angle}
            placeholder="Ex.: foco no que muda para o lojista"
            onChange={(event) => update({ angle: event.target.value })}
          />
        )}
      </FormRow>
      <FormRow label="Seções" hint={structureLabel(draft.sections)}>
        <Segmented
          label="Seções depois da introdução"
          options={SECTIONS}
          value={String(draft.sections) as (typeof SECTION_OPTIONS)[number]}
          onChange={(value) => update({ sections: Number(value) })}
          size="sm"
        />
      </FormRow>
      <FormRow label="Extensão" hint={lengthHint}>
        <Segmented label="Extensão do artigo" options={LENGTHS} value={draft.length} onChange={(length) => update({ length })} size="sm" />
      </FormRow>
    </FormSection>
  );
}

export function DeliverySection({ draft, update }: { draft: NewProductionDraft; update: Patch }) {
  const choose = (value: string) => update({ plan: value as DeliveryPlan });
  return (
    <FormSection title="Entregas" titleAs="h2" state="done" open>
      <FormRow label="Peças">
        <Grid columns="1:1" gap="sm" collapseBelow={480}>
          <ChoiceCard
            name="production-plan"
            value="article"
            checked={draft.plan === 'article'}
            onChange={choose}
            title="Artigo"
            description="Texto aprovado e exportado"
          />
          <ChoiceCard
            name="production-plan"
            value="article-carousel"
            checked={draft.plan === 'article-carousel'}
            onChange={choose}
            title="Artigo e carrossel"
            description="Carrossel derivado do artigo aprovado"
          />
        </Grid>
      </FormRow>
    </FormSection>
  );
}
