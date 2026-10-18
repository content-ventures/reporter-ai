'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  DescriptionList,
  Field,
  Input,
  List,
  ListItem,
  PageHeader,
  PageStack,
  Panel,
  PasswordField,
  Section,
  Stepper,
  toast,
} from '@content-ventures/design-system/v3';
import { Check, CheckCheck, KeyRound, Link2, Play, RefreshCw } from '@content-ventures/design-system/v3/icons';
import { ConnectionPanel, GuideSteps, TestRun } from './app-parts';
import type { TestCheck } from './app-parts';
import { connectionFrom, fieldProblems, guideOf } from './integrations-guides';
import type { ConnectGuide, CredentialField, FieldId, FieldValues } from './integrations-guides';
import { setupDefaults, setupSteps, STATUS_META } from './integrations-model';
import type { AppDef, AppRecord } from './integrations-model';

const CONNECT_MS = 1200;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TestState = 'idle' | 'running' | 'passed';

const NO_GUIDE: ConnectGuide = { method: '', steps: [], fields: [], action: 'Conectar', base: '', auth: '', calls: [] };

/**
 * Connecting an app, one step at a time on the same page:
 * - Conectar: what to do in the other app (numbered, with the link to the exact page), what to
 *   paste back there (a return address, DNS records), what the app will allow, and the credential
 *   to paste here;
 * - Configurar: the same panels the connected app keeps;
 * - Testar: each check says what it found.
 * The step's primary is always the header's. Progress is kept, so leaving and coming back resumes
 * the step; a secret is never kept, only its last characters.
 */
export function SetupPage({ def, record, update, configure, plan, onFinish }: {
  def: AppDef;
  record: AppRecord;
  update: (patch: Partial<AppRecord>) => void;
  configure: ReactNode;
  plan: TestCheck[];
  onFinish: () => void;
}) {
  const guide = guideOf(def.id) ?? NO_GUIDE;
  const steps = setupSteps(def);
  const index = Math.min(Math.max(record.setup?.step ?? 0, 0), steps.length - 1);
  const step = steps[index]?.id ?? 'configure';
  const account = record.setup?.account;
  const [values, setValues] = useState<FieldValues>({
    siteUrl: record.siteUrl,
    apiUrl: record.apiUrl,
    username: record.username,
    sender: record.sender,
    hookUrl: record.hookUrl,
  });
  const [errors, setErrors] = useState<Partial<Record<FieldId, string>>>({});
  const [connecting, setConnecting] = useState(false);
  const [test, setTest] = useState<TestState>('idle');
  const [run, setRun] = useState(0);
  const available = STATUS_META.available;

  const go = (next: number) => update({ setup: { ...record.setup, step: next } });

  /** Defaults only fill what the person has not decided yet. */
  const missing = (defaults: Partial<AppRecord>) =>
    Object.fromEntries(Object.entries(defaults).filter(([field]) => record[field as keyof AppRecord] === undefined)) as Partial<AppRecord>;

  async function connect() {
    const problems = fieldProblems(guide, values);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setConnecting(true);
    await wait(CONNECT_MS);
    setConnecting(false);
    const { account: answered, ...kept } = connectionFrom(def, guide, values);
    update({ ...missing(setupDefaults(def)), ...kept, setup: { step: index + 1, account: answered } });
    toast(def.auth === 'oauth' ? `${def.name} autorizado` : 'Credencial aceita', { description: answered });
  }

  function startTest() {
    if (step !== 'test') go(steps.length - 1);
    setTest('running');
    setRun((value) => value + 1);
  }

  const noteId = `setup-${def.id}-note`;
  const primary = step === 'connect' ? (
    <Button variant="primary" icon={def.auth === 'oauth' ? KeyRound : Link2} loading={connecting} onClick={() => void connect()}>{guide.action}</Button>
  ) : step === 'configure' ? (
    <Button variant="primary" icon={Play} onClick={startTest}>Testar conexão</Button>
  ) : (
    <Button
      variant="primary"
      icon={CheckCheck}
      aria-disabled={test !== 'passed' || undefined}
      aria-describedby={test !== 'passed' ? noteId : undefined}
      onClick={() => { if (test === 'passed') onFinish(); }}
    >
      Concluir conexão
    </Button>
  );

  return (
    <PageStack>
      <PageHeader
        title={def.name}
        status={<Badge tone={available.tone} variant="soft" dot="hollow">{available.label}</Badge>}
        actions={primary}
        actionsNote={step === 'test' && test !== 'passed' ? { id: noteId, text: test === 'running' ? 'Aguarde o teste terminar.' : 'Teste a conexão para concluir.' } : undefined}
      />
      <ConnectionPanel name={def.name} logo={def.logo} title={account ?? def.name} description={account ? record.credential ?? 'Conectado' : guide.method || def.summary}>
        <Stepper
          label={`Conexão com o ${def.name}`}
          steps={steps}
          current={index}
          onStepSelect={go}
          canSelect={(target, state) => state === 'done' && steps[target]?.id !== 'connect'}
        />
      </ConnectionPanel>
      {step === 'connect' ? (
        <ConnectStep
          def={def}
          guide={guide}
          values={values}
          errors={errors}
          busy={connecting}
          onChange={(id, value) => {
            setValues((current) => ({ ...current, [id]: value }));
            setErrors((current) => ({ ...current, [id]: undefined }));
          }}
          onSubmit={() => void connect()}
        />
      ) : step === 'configure' ? configure : (
        <Panel label="Teste">
          <Section
            title="Teste"
            action={test === 'running' ? undefined : (
              <Button variant="secondary" size="sm" icon={test === 'passed' ? RefreshCw : Play} onClick={startTest}>
                {test === 'passed' ? 'Testar de novo' : 'Testar'}
              </Button>
            )}
          >
            <TestRun key={run} plan={plan} running={test === 'running'} onDone={() => setTest('passed')} />
          </Section>
        </Panel>
      )}
    </PageStack>
  );
}

/**
 * "Conectar", in the order the person works: in the other app (the numbered steps), what to paste
 * back there, what the app will allow, then what to paste here.
 */
function ConnectStep({ def, guide, values, errors, busy, onChange, onSubmit }: {
  def: AppDef;
  guide: ConnectGuide;
  values: FieldValues;
  errors: Partial<Record<FieldId, string>>;
  busy: boolean;
  onChange: (id: FieldId, value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Panel label="Conectar">
      {guide.steps.length ? (
        <Section title={guide.where ?? `No ${def.name}`}>
          <GuideSteps guide={guide} values={values} name={def.name} />
        </Section>
      ) : null}
      {guide.provide ? (
        <Section title={guide.provide.title}>
          <DescriptionList label={guide.provide.title} items={guide.provide.items.map((item) => ({ label: item.label, value: item.value, copy: item.value }))} />
        </Section>
      ) : null}
      {guide.scopes ? (
        <Section title="O que o app vai permitir">
          <List label="Permissões" framed={false} bleed>
            {guide.scopes.map((scope) => <ListItem key={scope.id} density="sm" icon={Check} title={scope.label} description={scope.id} />)}
          </List>
        </Section>
      ) : null}
      {guide.fields.length ? (
        <Section title="No Reporter IA">
          {guide.fields.map((field) => (
            <CredentialInput
              key={field.id}
              field={field}
              value={values[field.id] ?? ''}
              error={errors[field.id]}
              busy={busy}
              onChange={(value) => onChange(field.id, value)}
              onSubmit={onSubmit}
            />
          ))}
        </Section>
      ) : null}
    </Panel>
  );
}

function CredentialInput({ field, value, error, busy, onChange, onSubmit }: {
  field: CredentialField;
  value: string;
  error?: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const submitOnEnter = (event: { key: string }) => {
    if (event.key === 'Enter') onSubmit();
  };
  return (
    <Field label={field.label} error={error} hint={field.hint}>
      {({ id, describedBy, invalid }) => (field.kind === 'secret' ? (
        <PasswordField
          id={id}
          aria-describedby={describedBy}
          invalid={invalid}
          value={value}
          placeholder={field.placeholder}
          disabled={busy}
          autoComplete="off"
          onValueChange={onChange}
          onKeyDown={submitOnEnter}
        />
      ) : (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={invalid}
          value={value}
          type={field.kind === 'url' ? 'url' : field.kind === 'email' ? 'email' : 'text'}
          inputMode={field.kind === 'url' ? 'url' : field.kind === 'email' ? 'email' : undefined}
          placeholder={field.placeholder}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={submitOnEnter}
        />
      ))}
    </Field>
  );
}
