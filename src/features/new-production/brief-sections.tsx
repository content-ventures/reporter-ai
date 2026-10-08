'use client';

import type { Ref } from 'react';
import {
  Alert,
  ChoiceCard,
  DatePicker,
  Disclosure,
  FormRow,
  FormSection,
  Grid,
  Input,
  Segmented,
  Select,
  Textarea,
  useNotice,
  type SelectOption,
} from '@content-ventures/design-system/v3';
import { SIZE_RULE, sizeOf, type ArticleSize, type SourceOrigin } from '@/domain';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { SIZE_OPTIONS } from '@/ui/format';
import {
  MAX_ANGLE_LENGTH,
  MAX_TITLE_LENGTH,
  sectionOptions,
  shortfallSentence,
  structureChoiceLabel,
  withSize,
  type DeliveryPlan,
  type NewProductionDraft,
} from './form';

/**
 * "Pauta" (step 2, CONTRACT §3.9, COPY §6.3): the size of the article, the sections, the angle,
 * the pieces to deliver and the internal title, with "Origem" and "Data da entrevista" behind
 * "Mais detalhes". Once the production exists (back from "Estrutura") only the pauta itself is
 * editable: the pieces, the title and the details were fixed when it was created.
 */

type Patch = (patch: Partial<NewProductionDraft>) => void;

const ORIGINS: SelectOption[] = (Object.keys(SOURCE_ORIGIN_LABELS) as SourceOrigin[]).map((origin) => ({
  value: origin,
  label: SOURCE_ORIGIN_LABELS[origin],
}));

const AUTOMATIC = 'auto';
const CHOSEN = 'chosen';

export type BriefStepProps = {
  draft: NewProductionDraft;
  update: Patch;
  /** Characters of the longest article the material supports, when known. */
  charsAvailable?: number;
  /** The production already exists: only size, sections and angle can change. */
  existing?: boolean;
  titleError?: string;
  titleRef: Ref<HTMLInputElement>;
  /** Today (YYYY-MM-DD, after hydration): the interview cannot be dated in the future. */
  today?: string;
};

export function BriefStep({ draft, update, charsAvailable, existing = false, titleError, titleRef, today }: BriefStepProps) {
  const [notice, showNotice] = useNotice();
  const shortfall = shortfallSentence(draft.size, charsAvailable);
  const automaticSections = sizeOf(draft.size).sections.default;

  const chooseSize = (size: ArticleSize) => {
    const next = withSize(draft, size);
    update({ size: next.size, sections: next.sections });
    showNotice(next.notice ?? null);
  };
  const chooseStructure = (value: string) => {
    if (value === AUTOMATIC) update({ sections: automaticSections, sectionsCustom: false });
  };
  const structureOptions: SelectOption[] = [
    { value: AUTOMATIC, label: structureChoiceLabel(draft.size, automaticSections, false) },
    ...(draft.sectionsCustom ? [{ value: CHOSEN, label: structureChoiceLabel(draft.size, draft.sections, true) }] : []),
  ];
  const choosePlan = (value: string) => update({ plan: value as DeliveryPlan });

  return (
    <FormSection title="Pauta" titleAs="h2" state="active" open>
      <FormRow label="Tamanho do artigo" hint={SIZE_RULE}>
        <Grid columns="1:1" gap="sm" collapseBelow={480}>
          {SIZE_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              name="article-size"
              value={option.value}
              checked={draft.size === option.value}
              onChange={(value) => chooseSize(value as ArticleSize)}
              title={option.label}
              description={option.description}
            />
          ))}
        </Grid>
        {shortfall ? (
          <Alert compact tone="info">
            {shortfall}
          </Alert>
        ) : null}
      </FormRow>
      <FormRow label="Seções" hint={notice ?? undefined}>
        {({ id, describedBy }) => (
          <>
            <Select
              id={id}
              describedBy={describedBy}
              value={draft.sectionsCustom ? CHOSEN : AUTOMATIC}
              options={structureOptions}
              onChange={chooseStructure}
            />
            <Disclosure summary="Avançado" defaultOpen={draft.sectionsCustom}>
              <Segmented
                label="Número de seções"
                options={sectionOptions(draft.size).map((value) => ({ value, label: value }))}
                value={String(draft.sections)}
                onChange={(value) => update({ sections: Number(value), sectionsCustom: true })}
                size="sm"
              />
            </Disclosure>
          </>
        )}
      </FormRow>
      <FormRow label="Ângulo" optional>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={MAX_ANGLE_LENGTH}
            value={draft.angle}
            placeholder="Ex.: foco no custo para pequenas fábricas"
            onChange={(event) => update({ angle: event.target.value })}
          />
        )}
      </FormRow>
      {existing ? null : (
        <>
          <FormRow label="Entregas">
            <Grid columns="1:1" gap="sm" collapseBelow={480}>
              <ChoiceCard
                name="production-plan"
                value="article"
                checked={draft.plan === 'article'}
                onChange={choosePlan}
                title="Artigo"
                description="Só o texto"
              />
              <ChoiceCard
                name="production-plan"
                value="article-carousel"
                checked={draft.plan === 'article-carousel'}
                onChange={choosePlan}
                title="Artigo e carrossel"
                description="Texto e slides para redes"
              />
            </Grid>
          </FormRow>
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
          <Disclosure summary="Mais detalhes">
            <FormRow label="Origem">
              {({ id, describedBy }) => (
                <Select id={id} describedBy={describedBy} value={draft.origin} options={ORIGINS} onChange={(value) => update({ origin: value as SourceOrigin })} />
              )}
            </FormRow>
            <FormRow label="Data da entrevista" optional>
              {({ id, describedBy }) => (
                <DatePicker id={id} describedBy={describedBy} value={draft.recordedOn} max={today} editable onChange={(value) => update({ recordedOn: value })} />
              )}
            </FormRow>
          </Disclosure>
        </>
      )}
    </FormSection>
  );
}
