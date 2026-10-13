'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  ConfirmDialog,
  Drawer,
  Field,
  FieldGroup,
  Input,
  PageStack,
  Select,
  SwitchRow,
  toast,
  type SelectOption,
} from '@content-ventures/design-system/v3';
import type { PersonSummary, SpeakerMapping, SourceDetail } from '@/ports';
import { useCommands, usePeople } from '@/state';
import { plural } from '@/ui/format';
import { EMPTY_PERSON, NEW_PERSON, NO_PERSON, UNSET, type PersonFields } from './material-model';

type Draft = {
  authorized: boolean;
  mapping: Record<string, string>;
  /** New people, by speaker label. */
  created: Record<string, PersonFields>;
  /** Edits to people already in the workspace ("Cargo ou função", "Organização"), by person id. */
  edits: Record<string, PersonFields>;
};

function draftOf(detail: SourceDetail): Draft {
  return {
    authorized: detail.source.rights.authorized,
    mapping: Object.fromEntries(detail.source.speakers.map((speaker) => [speaker.label, speaker.personId ?? (speaker.unattributed ? NO_PERSON : UNSET)])),
    created: {},
    edits: {},
  };
}

function fieldsOf(person: PersonSummary | undefined): PersonFields {
  return person ? { name: person.name, title: person.title ?? '', organization: person.organization ?? '' } : EMPTY_PERSON;
}

const sameFields = (a: PersonFields, b: PersonFields) => a.name.trim() === b.name.trim() && a.title.trim() === b.title.trim() && a.organization.trim() === b.organization.trim();

/** Nome completo (new people only), Cargo ou função and Organização. */
function ParticipantFields({ label, value, withName, error, onChange }: {
  label: string;
  value: PersonFields;
  withName: boolean;
  error?: string;
  onChange: (next: PersonFields) => void;
}) {
  return (
    <>
      {withName ? (
        <Field label={`Nome de “${label}”`} error={error || undefined}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} value={value.name} maxLength={80} autoComplete="off" onChange={(event) => onChange({ ...value, name: event.target.value })} />
          )}
        </Field>
      ) : null}
      <Field label="Cargo ou função" optional>
        {({ id }) => (
          <Input id={id} aria-label={`Cargo ou função de ${label}`} value={value.title} maxLength={80} autoComplete="off" onChange={(event) => onChange({ ...value, title: event.target.value })} />
        )}
      </Field>
      <Field label="Organização" optional>
        {({ id }) => (
          <Input id={id} aria-label={`Organização de ${label}`} value={value.organization} maxLength={80} autoComplete="off" onChange={(event) => onChange({ ...value, organization: event.target.value })} />
        )}
      </Field>
    </>
  );
}

/**
 * "Contexto e falantes": whether the material is authorised (generation stays blocked until it
 * is, REQ-T.1) and who each transcript label is (quote attribution, REQ-T.7): a person of the
 * workspace (whose role and organisation can be corrected here), a new person, or "Sem
 * atribuição". Changes are staged and saved together; closing with unsaved changes asks first.
 */
export function MaterialDrawer({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: SourceDetail }) {
  const commands = useCommands();
  const people = usePeople();
  const [draft, setDraft] = useState<Draft>(() => draftOf(detail));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setDraft(draftOf(detail));
      setErrors({});
      setFailure(undefined);
    }
  }

  const initial = useMemo(() => draftOf(detail), [detail]);
  const byId = useMemo(() => new Map((people.data ?? []).map((person) => [person.id, person])), [people.data]);
  const labels = detail.source.speakers.map((speaker) => speaker.label);
  const participants = new Map(detail.speakers.map((participant) => [participant.label, participant]));
  const mappingChanged = labels.some((label) => draft.mapping[label] !== initial.mapping[label]);
  const editedPeople = Object.entries(draft.edits).filter(([personId, fields]) => !sameFields(fields, fieldsOf(byId.get(personId))));
  const dirty = mappingChanged || draft.authorized !== initial.authorized || editedPeople.length > 0;
  const undecided = labels.filter((label) => (draft.mapping[label] ?? UNSET) === UNSET).length;

  const options = useMemo<SelectOption[]>(
    () => [
      ...(people.data ?? []).map((person) => ({
        value: person.id,
        label: person.name,
        ...(person.line ?? person.title ? { description: person.line ?? person.title } : {}),
        leading: <Avatar name={person.name} src={person.avatarUrl} size="xs" decorative />,
      })),
      { value: NEW_PERSON, label: 'Nova pessoa' },
      { value: NO_PERSON, label: 'Sem atribuição', description: 'As falas entram sem nome' },
    ],
    [people.data],
  );

  async function save() {
    const missing: Record<string, string> = {};
    for (const label of labels) {
      if (draft.mapping[label] === NEW_PERSON && !draft.created[label]?.name.trim()) missing[label] = 'Informe o nome.';
    }
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;

    setSaving(true);
    setFailure(undefined);
    const stop = (message: string) => {
      setSaving(false);
      setFailure(message);
    };
    for (const [personId, fields] of editedPeople) {
      const result = await commands.production.updatePerson(personId, { title: fields.title.trim() || null, organization: fields.organization.trim() || null });
      if (!result.ok) return stop(result.refusal.message);
    }
    if (mappingChanged) {
      const mapping: SpeakerMapping[] = labels.map((label) => {
        const value = draft.mapping[label] ?? UNSET;
        if (value === NEW_PERSON) {
          const created = draft.created[label] ?? EMPTY_PERSON;
          return { label, personId: null, newPerson: { name: created.name.trim(), title: created.title.trim(), organization: created.organization.trim() } };
        }
        if (value === NO_PERSON) return { label, personId: null, unattributed: true };
        return { label, personId: value === UNSET ? null : value };
      });
      const result = await commands.production.updateSpeakers(detail.source.id, mapping);
      if (!result.ok) return stop(result.refusal.message);
    }
    if (draft.authorized !== initial.authorized) {
      const result = await commands.production.setMaterialAuthorization(detail.source.id, draft.authorized);
      if (!result.ok) return stop(result.refusal.message);
    }
    setSaving(false);
    onClose();
    toast(draft.authorized && !initial.authorized ? 'Material autorizado' : 'Contexto salvo');
  }

  const [discarding, setDiscarding] = useState(false);
  // Cancel asks first when there are changes (click outside and Esc are already blocked then).
  const cancel = () => (dirty ? setDiscarding(true) : onClose());

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="Contexto e falantes"
        description={`${detail.source.title} · v${detail.version.number}`}
        dismissible={!dirty}
        footer={
          <>
            <Button onClick={cancel}>Cancelar</Button>
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
              Salvar alterações
            </Button>
          </>
        }
      >
        <PageStack>
          <SwitchRow
            label="Material autorizado"
            description="Sem autorização, a geração fica bloqueada."
            checked={draft.authorized}
            onCheckedChange={(authorized) => setDraft((current) => ({ ...current, authorized }))}
          />
          <FieldGroup label="Falantes" meta={undecided > 0 ? plural(undecided, 'falante sem pessoa', 'falantes sem pessoa') : plural(labels.length, 'rótulo', 'rótulos')}>
            {labels.map((label) => {
              const value = draft.mapping[label] ?? UNSET;
              const participant = participants.get(label);
              const person = byId.get(value);
              // The first speaker without a person takes the focus when the drawer opens ("Ligar pessoas").
              const firstUndecided = labels.find((entry) => (draft.mapping[entry] ?? UNSET) === UNSET) === label;
              return (
                <Fragment key={label}>
                  <Field
                    label={label}
                    meta={participant ? plural(participant.segments, 'fala', 'falas') : undefined}
                    error={value === UNSET ? 'Escolha a pessoa ou “Sem atribuição”' : undefined}
                  >
                    {({ id, describedBy }) => (
                      <Select
                        id={id}
                        describedBy={describedBy}
                        value={value}
                        placeholder="Escolha quem fala"
                        autoFocus={firstUndecided}
                        invalid={value === UNSET}
                        options={options}
                        loading={people.status === 'loading'}
                        searchable
                        onChange={(next) => {
                          setDraft((current) => ({ ...current, mapping: { ...current.mapping, [label]: next } }));
                          setErrors((current) => ({ ...current, [label]: '' }));
                        }}
                      />
                    )}
                  </Field>
                  {value === NEW_PERSON ? (
                    <ParticipantFields
                      label={label}
                      withName
                      value={draft.created[label] ?? { ...EMPTY_PERSON, name: label }}
                      error={errors[label]}
                      onChange={(next) => {
                        setDraft((current) => ({ ...current, created: { ...current.created, [label]: next } }));
                        setErrors((current) => ({ ...current, [label]: '' }));
                      }}
                    />
                  ) : person ? (
                    <ParticipantFields
                      label={person.name}
                      withName={false}
                      value={draft.edits[person.id] ?? fieldsOf(person)}
                      onChange={(next) => setDraft((current) => ({ ...current, edits: { ...current.edits, [person.id]: next } }))}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </FieldGroup>
          {failure ? (
            <Alert tone="danger" title="Não foi possível salvar">
              {failure}
            </Alert>
          ) : null}
        </PageStack>
      </Drawer>
      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Descartar as alterações?"
        confirmLabel="Descartar alterações"
        tone="danger"
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
      />
    </>
  );
}
