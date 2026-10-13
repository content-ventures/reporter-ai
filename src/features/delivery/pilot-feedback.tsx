'use client';

import { useState } from 'react';
import {
  Button,
  DescriptionList,
  Field,
  FieldGroup,
  LinkButton,
  Panel,
  Section,
  Textarea,
  ToggleGroup,
  toast,
  type DescriptionItem,
} from '@content-ventures/design-system/v3';
import { FEEDBACK_RATING_LABELS, type FeedbackEntry, type FeedbackRating, type ProductionId } from '@/domain';
import { useCommands, useFeedback } from '@/state';
import { formatDuration, formatListDateTime } from '@/ui/format';
import { usePerson } from '@/ui/person-avatar';
import { formatSpan, STAGE_DURATION_LABELS } from './delivery-model';

const RATINGS: { value: FeedbackRating; label: string }[] = [
  { value: 'positive', label: FEEDBACK_RATING_LABELS.positive },
  { value: 'mixed', label: FEEDBACK_RATING_LABELS.mixed },
  { value: 'negative', label: FEEDBACK_RATING_LABELS.negative },
];

const NOTE_MAX = 600;

function isPilotOutcome(entry: FeedbackEntry, productionId: ProductionId): boolean {
  return entry.target.kind === 'production' && entry.target.productionId === productionId && entry.rating !== undefined;
}

function RecordedOutcome({ entry }: { entry: FeedbackEntry }) {
  const person = usePerson(entry.by);
  const items: DescriptionItem[] = [
    { label: 'Resultado', value: entry.rating ? FEEDBACK_RATING_LABELS[entry.rating] : undefined },
    { label: 'Nota', value: entry.note },
    { label: 'Registro', value: [person?.name, formatListDateTime(entry.at)].filter(Boolean).join(' · '), numeric: true },
  ];
  return <DescriptionList items={items} labelWidth={96} label="Retorno registrado" />;
}

/**
 * "Retorno do piloto" (REQ-T.8): Funcionou · Com ressalvas · Não funcionou with an optional note,
 * recorded through the feedback port together with the automatic stage timings shown below.
 */
export function PilotFeedbackPanel({ productionId, durations }: { productionId: ProductionId; durations: Record<string, number> }) {
  const commands = useCommands();
  const feedback = useFeedback({ productionId });
  const latest = feedback.data?.find((entry) => isPilotOutcome(entry, productionId));
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const showForm = editing || (feedback.status === 'ready' && !latest);

  async function submit() {
    if (!rating) {
      setError('Escolha um resultado.');
      return;
    }
    setSaving(true);
    const result = await commands.feedback.record({
      target: { kind: 'production', productionId },
      rating,
      note: note.trim() || undefined,
      durations,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.refusal.message);
      return;
    }
    setEditing(false);
    setRating(null);
    setNote('');
    setError(undefined);
    toast('Retorno registrado', { description: FEEDBACK_RATING_LABELS[rating] });
  }

  const timings: DescriptionItem[] = STAGE_DURATION_LABELS.filter((stage) => durations[stage.id] !== undefined).map((stage) => ({
    label: stage.label,
    value: formatSpan(durations[stage.id] ?? 0, formatDuration),
    numeric: true,
  }));

  return (
    <Panel>
      <Section
        title="Retorno do piloto"
        action={
          !showForm && latest ? (
            <LinkButton onClick={() => setEditing(true)}>Registrar novo</LinkButton>
          ) : editing ? (
            <LinkButton tone="quiet" onClick={() => setEditing(false)}>
              Cancelar
            </LinkButton>
          ) : undefined
        }
      >
        {showForm ? (
          <FieldGroup label="Resultado" error={error}>
            <ToggleGroup
              type="single"
              label="Resultado do piloto"
              items={RATINGS}
              value={rating}
              invalid={Boolean(error) && !rating}
              onChange={(value) => {
                setRating(value as FeedbackRating | null);
                setError(undefined);
              }}
            />
            <Field label="Nota" optional>
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  value={note}
                  maxLength={NOTE_MAX}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
            <Button loading={saving} onClick={() => void submit()}>
              Registrar retorno
            </Button>
          </FieldGroup>
        ) : latest ? (
          <RecordedOutcome entry={latest} />
        ) : (
          <DescriptionList items={[]} loading loadingRows={3} label="Retorno do piloto" />
        )}
      </Section>
      {timings.length > 0 ? (
        <Section title="Tempos por etapa">
          <DescriptionList items={timings} labelWidth={96} label="Tempos por etapa" />
        </Section>
      ) : null}
    </Panel>
  );
}
