'use client';

import { useState, type Ref } from 'react';
import {
  Alert,
  Button,
  ChoiceCard,
  DatePicker,
  Disclosure,
  Field,
  FieldGroup,
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
import { EDITORIAL_FORMATS, FORMAT_SPECS, SIZE_RULE, formatRangeLabel, suggestedFormatSize, type ArticleSize, type EditorialFormat, type EventContext, type SourceOrigin } from '@/domain';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { podcastLink } from '@/domain/citation-library';
import { SIZE_OPTIONS } from '@/ui/format';
import {
  MAX_ANGLE_LENGTH,
  MAX_TITLE_LENGTH,
  draftAutomaticSections,
  draftSectionOptions,
  draftStructureLabel,
  shortfallSentence,
  withFormat,
  withFormatSize,
  withSize,
  type DeliveryPlan,
  type EventDraft,
  type NewProductionDraft,
} from './form';

const ARTICLE = 'article';
const FORMAT_OPTIONS: { value: string; title: string; description: string }[] = [
  { value: ARTICLE, title: 'Artigo', description: 'Curto ou Padrão, a partir de entrevista ou palestra.' },
  ...EDITORIAL_FORMATS.map((format) => ({ value: format, title: FORMAT_SPECS[format].label, description: FORMAT_SPECS[format].summary })),
];
const EVENT_MAX = 600;

/**
 * "Pauta" (step 2, CONTRACT §3.9, COPY §6.3): the size of the article, the sections, the angle,
 * the pieces to deliver and the internal title, with "Origem" and "Data da entrevista" behind
 * "Mais detalhes". When editing an existing production only the pauta itself is
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
  /** Minutes of speech in the material, when known (a stand interview of 3 min fills "Completo"). */
  materialMinutes?: number;
  /** The production already exists: only size, sections and angle can change. */
  existing?: boolean;
  titleError?: string;
  titleRef: Ref<HTMLInputElement>;
  /** Today (YYYY-MM-DD, after hydration): the interview cannot be dated in the future. */
  today?: string;
  /** The event of the previous coverage on this device, offered while the field is empty. */
  eventSuggestion?: EventDraft;
  /** The reporter used the suggested event (true) or dismissed it (false). */
  onEventSuggestion?: (use: boolean) => void;
};

export function BriefStep({ draft, update, charsAvailable, materialMinutes, existing = false, titleError, titleRef, today, eventSuggestion, onEventSuggestion }: BriefStepProps) {
  const [notice, showNotice] = useNotice();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const shortfall = draft.format ? undefined : shortfallSentence(draft.size, charsAvailable);
  const automaticSections = draftAutomaticSections(draft);
  const formatSpec = draft.format ? FORMAT_SPECS[draft.format] : undefined;
  const sizeSuggestion = suggestedFormatSize(draft.format, draft.formatSize, materialMinutes);
  const chooseFormat = (value: string) => update(withFormat(value === ARTICLE ? undefined : (value as EditorialFormat)));
  const setEvent = (key: keyof EventContext, value: string) => update({ event: { ...draft.event, [key]: value } });

  const chooseSize = (size: ArticleSize) => {
    const next = withSize(draft, size);
    update({ size: next.size, sections: next.sections });
    showNotice(next.notice ?? null);
  };
  const chooseStructure = (value: string) => {
    if (value === AUTOMATIC) update({ sections: automaticSections, sectionsCustom: false });
  };
  const structureOptions: SelectOption[] = [
    { value: AUTOMATIC, label: draftStructureLabel(draft, automaticSections, false) },
    ...(draft.sectionsCustom ? [{ value: CHOSEN, label: draftStructureLabel(draft, draft.sections, true) }] : []),
  ];
  const choosePlan = (value: string) => update({ plan: value as DeliveryPlan });

  return (
    <FormSection title="Pauta" titleAs="h2" state="active" open>
      {existing ? null : (
        <FormRow label="Formato">
          <Grid columns="1:1:1" gap="sm" collapseBelow={760}>
            {FORMAT_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                name="production-format"
                value={option.value}
                checked={(draft.format ?? ARTICLE) === option.value}
                onChange={chooseFormat}
                title={option.title}
                description={option.description}
              />
            ))}
          </Grid>
        </FormRow>
      )}
      {formatSpec ? (
        formatSpec.sizes.length > 1 ? (
          <FormRow label="Tamanho">
            <Grid columns="1:1" gap="sm" collapseBelow={480}>
              {formatSpec.sizes.map((option) => (
                <ChoiceCard
                  key={option.id}
                  name="format-size"
                  value={option.id}
                  checked={(draft.formatSize ?? formatSpec.defaultSize) === option.id}
                  onChange={(value) => update(withFormatSize(draft, value))}
                  title={option.label}
                  description={formatRangeLabel(option)}
                />
              ))}
            </Grid>
            {sizeSuggestion && materialMinutes !== undefined ? (
              <Alert compact tone="info"
                action={<Button size="sm" onClick={() => update(withFormatSize(draft, sizeSuggestion.id))}>{`Usar ${sizeSuggestion.label}`}</Button>}>
                {`Material de ${Math.floor(materialMinutes)} min: o ${sizeSuggestion.label} aproveita melhor as falas.`}
              </Alert>
            ) : null}
          </FormRow>
        ) : null
      ) : (
      <FormRow label="Tamanho do artigo" hint={SIZE_RULE}>
        <Grid columns="1:1" gap="sm" collapseBelow={480}>
          {SIZE_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              name="article-size"
              value={option.value}
              checked={draft.size === option.value}
              disabled={option.value === 'short'}
              onChange={(value) => chooseSize(value as ArticleSize)}
              title={option.label}
              description={option.value === 'short' ? 'Fora da R1: o teto de 2.000 caracteres é menor que o mínimo obrigatório.' : option.description}
            />
          ))}
        </Grid>
        {shortfall ? (
          <Alert compact tone="info">
            {shortfall}
          </Alert>
        ) : null}
      </FormRow>
      )}
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
                options={draftSectionOptions(draft).map((value) => ({ value, label: value }))}
                value={String(draft.sections)}
                onChange={(value) => update({ sections: Number(value), sectionsCustom: true })}
                size="sm"
              />
            </Disclosure>
          </>
        )}
      </FormRow>
      {formatSpec && !existing ? (
        <>
          <FormRow label="Evento" optional>
            {({ id, describedBy }) => (
              <>
                <Input id={id} aria-describedby={describedBy} value={draft.event.name} maxLength={EVENT_MAX}
                  placeholder="Ex.: Seafood Show Latin America 2026" onChange={(event) => setEvent('name', event.target.value)} />
                {eventSuggestion ? (
                  <Alert compact tone="info" onDismiss={() => onEventSuggestion?.(false)} dismissLabel="Não é este evento"
                    action={<Button size="sm" onClick={() => onEventSuggestion?.(true)}>Usar</Button>}>
                    {`Mesmo evento da última cobertura: ${eventSuggestion.name}?`}
                  </Alert>
                ) : null}
              </>
            )}
          </FormRow>
          {draft.event.name.trim() ? (
            <>
              <FormRow label="Box do evento">
                <FieldGroup label="Serviço" columns={1}>
                  <Grid columns="1:1" collapseBelow={480}>
                    {([
                      ['boxTitle', 'Título do box', `Seafood Brasil na ${draft.event.name.trim()}`],
                      ['dates', 'Data', 'De 20 a 22 de outubro de 2026'],
                      ['hours', 'Horário', 'Das 13h às 20h'],
                      ['venue', 'Local', 'Distrito Anhembi'],
                      ['address', 'Endereço', 'Av. Olavo Fontoura, 1209 – São Paulo/SP'],
                      ['cta', 'Chamada final', 'Acompanhe a cobertura no site e nas redes'],
                    ] as const).map(([key, label, example]) => (
                      <Field key={key} label={label}>
                        {(props) => (
                          <Input id={props.id} aria-describedby={props.describedBy} value={draft.event[key]} maxLength={EVENT_MAX}
                            placeholder={example} onChange={(event) => setEvent(key, event.target.value)} />
                        )}
                      </Field>
                    ))}
                  </Grid>
                </FieldGroup>
              </FormRow>
              <FormRow label="Texto do box" optional>
                {({ id, describedBy }) => (
                  <Textarea id={id} aria-describedby={describedBy} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={EVENT_MAX} value={draft.event.about}
                    placeholder="Parágrafo sobre o evento, como no portal" onChange={(event) => setEvent('about', event.target.value)} />
                )}
              </FormRow>
            </>
          ) : null}
        </>
      ) : null}
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
                title={formatSpec ? 'Texto' : 'Artigo'}
                description="Só o texto"
              />
              <ChoiceCard
                name="production-plan"
                value="article-carousel"
                checked={draft.plan === 'article-carousel'}
                onChange={choosePlan}
                title={formatSpec ? 'Texto e carrossel' : 'Artigo e carrossel'}
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
          <FormRow label="Mais detalhes">
            <Button size="sm" variant="ghost" aria-expanded={detailsOpen} aria-label={detailsOpen ? 'Ocultar mais detalhes' : 'Mostrar mais detalhes'} onClick={() => setDetailsOpen(!detailsOpen)}>
              {detailsOpen ? 'Ocultar' : 'Mostrar'}
            </Button>
          </FormRow>
          {detailsOpen && <>
            <FormRow label="Podcast ou programa" optional>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={draft.programName ?? ''} maxLength={160} placeholder="Ex.: Podcast Seafood Brasil" onChange={event => update({ programName: event.target.value })} />}
            </FormRow>
            <FormRow label="Link do episódio" optional error={draft.sourceUrl?.trim() && !podcastLink(draft.sourceUrl) ? 'Informe um link HTTPS válido.' : undefined}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={draft.sourceUrl ?? ''} maxLength={2000} inputMode="url" placeholder="https://" onChange={event => update({ sourceUrl: event.target.value })} />}
            </FormRow>
            <FormRow label="Local da gravação" optional>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={draft.location ?? ''} maxLength={160} onChange={event => update({ location: event.target.value })} />}
            </FormRow>
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
          </>}
        </>
      )}
    </FormSection>
  );
}
