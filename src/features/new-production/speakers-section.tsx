'use client';

import { useEffect, useMemo } from 'react';
import {
  Avatar,
  Field,
  FormRow,
  FormSection,
  Input,
  Select,
  type SectionState,
  type SelectOption,
} from '@content-ventures/design-system/v3';
import type { PersonSummary, SourceAnalysis } from '@/ports';
import { plural } from '@/ui/format';
import { speakerChoice, speakersWithoutPerson, withoutPersonLabel, type NewProductionDraft, type SpeakerChoice } from './form';

/**
 * "Falantes" (PLAN §3.3, REQ-1.1, REQ-T.7, wireframe R1·1 "Participantes"): each label found in
 * the material is linked to a person of the workspace, to a new person (name, role and
 * organisation, which the article uses after the name), or explicitly left "Sem atribuição".
 * A label nobody decided is "sem pessoa": "Gerar artigo" asks for it before writing.
 */

const NONE = 'none';
const NEW = 'new';
const PERSON = 'person:';

function choiceValue(choice: SpeakerChoice): string {
  if (choice.kind === 'person') return `${PERSON}${choice.personId}`;
  if (choice.kind === 'unset') return '';
  return choice.kind === 'new' ? NEW : NONE;
}

type NewChoice = Extract<SpeakerChoice, { kind: 'new' }>;

export type SpeakersSectionProps = {
  draft: NewProductionDraft;
  analysis: SourceAnalysis | undefined;
  people: readonly PersonSummary[];
  peopleLoading: boolean;
  state: SectionState;
  /** Validation messages after a save attempt, by speaker label. */
  errors: Readonly<Record<string, string>>;
  onChange: (label: string, choice: SpeakerChoice) => void;
  /** Registers the name field of a new person (ErrorSummary focus). */
  nameRef: (label: string) => (node: HTMLInputElement | null) => void;
  /** Registers the id of a speaker's person picker (ErrorSummary focus for "sem pessoa"). */
  registerPicker: (label: string, id: string | null) => void;
};

/** Reports the picker id to the screen while it is mounted. */
function PickerId({ label, id, register }: { label: string; id: string; register: SpeakersSectionProps['registerPicker'] }) {
  useEffect(() => {
    register(label, id);
    return () => register(label, null);
  }, [label, id, register]);
  return null;
}

function NewPersonFields({ label, choice, invalid, describedBy, onChange, nameRef }: {
  label: string;
  choice: NewChoice;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (choice: NewChoice) => void;
  nameRef: (node: HTMLInputElement | null) => void;
}) {
  return (
    <>
      <Field label="Nome completo">
        {({ id }) => (
          <Input
            id={id}
            ref={nameRef}
            aria-describedby={describedBy}
            invalid={invalid}
            value={choice.name}
            maxLength={80}
            autoComplete="off"
            onChange={(event) => onChange({ ...choice, name: event.target.value })}
          />
        )}
      </Field>
      <Field label="Cargo ou função" optional>
        {({ id }) => (
          <Input
            id={id}
            aria-label={`Cargo ou função de ${label}`}
            value={choice.title ?? ''}
            maxLength={80}
            autoComplete="off"
            onChange={(event) => onChange({ ...choice, title: event.target.value })}
          />
        )}
      </Field>
      <Field label="Organização" optional>
        {({ id }) => (
          <Input
            id={id}
            aria-label={`Organização de ${label}`}
            value={choice.organization ?? ''}
            maxLength={80}
            autoComplete="off"
            onChange={(event) => onChange({ ...choice, organization: event.target.value })}
          />
        )}
      </Field>
    </>
  );
}

export function SpeakersSection({ draft, analysis, people, peopleLoading, state, errors, onChange, nameRef, registerPicker }: SpeakersSectionProps) {
  const speakers = analysis?.speakers ?? [];
  const peopleOptions = useMemo<SelectOption[]>(
    () =>
      people.map((person) => {
        const option: SelectOption = {
          value: `${PERSON}${person.id}`,
          label: person.name,
          leading: <Avatar name={person.name} src={person.avatarUrl} size="xs" decorative />,
        };
        const line = person.line ?? person.title;
        if (line) option.description = line;
        return option;
      }),
    [people],
  );

  const open = speakers.length > 0;
  const summary = !analysis ? 'Detectados no material' : 'Nenhum falante identificado';
  const undecided = speakersWithoutPerson(draft, analysis, people).length;
  const meta = open ? [plural(speakers.length, 'falante', 'falantes'), undecided > 0 ? withoutPersonLabel(undecided) : null].filter(Boolean).join(' · ') : undefined;

  return (
    <FormSection title="Falantes" titleAs="h2" state={state} open={open} summary={open ? undefined : summary} meta={meta}>
      {speakers.map((speaker) => {
        const choice = speakerChoice(draft, speaker.label, people);
        const options: SelectOption[] = [
          ...peopleOptions,
          { value: NEW, label: 'Nova pessoa', leading: <Avatar name={choice.kind === 'new' && choice.name.trim() ? choice.name : speaker.label} size="xs" decorative /> },
          { value: NONE, label: 'Sem atribuição', description: 'As falas entram sem nome' },
        ];
        return (
          <FormRow
            key={speaker.label}
            label={speaker.label}
            description={`${plural(speaker.segments, 'fala', 'falas')} · ${plural(speaker.words, 'palavra', 'palavras')}`}
            error={errors[speaker.label]}
          >
            {({ id, describedBy, invalid }) => (
              <>
                <PickerId label={speaker.label} id={id} register={registerPicker} />
                <Select
                  id={id}
                  describedBy={choice.kind === 'new' ? undefined : describedBy}
                  invalid={choice.kind === 'unset' && invalid}
                  value={choiceValue(choice)}
                  placeholder="Escolha quem fala"
                  options={options}
                  searchable
                  loading={peopleLoading}
                  onChange={(value) => {
                    if (value === NONE) onChange(speaker.label, { kind: 'none' });
                    else if (value === NEW) onChange(speaker.label, choice.kind === 'new' ? choice : { kind: 'new', name: speaker.label });
                    else onChange(speaker.label, { kind: 'person', personId: value.slice(PERSON.length) });
                  }}
                />
                {choice.kind === 'new' ? (
                  <NewPersonFields
                    label={speaker.label}
                    choice={choice}
                    invalid={invalid}
                    describedBy={describedBy}
                    onChange={(next) => onChange(speaker.label, next)}
                    nameRef={nameRef(speaker.label)}
                  />
                ) : null}
              </>
            )}
          </FormRow>
        );
      })}
    </FormSection>
  );
}
