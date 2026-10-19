'use client';

import { useState } from 'react';
import { Alert, Avatar, Badge, Button, Checkbox, CheckboxGroup, ConfirmDialog, DescriptionList, Drawer, MetricStrip, PageStack, Section } from '@content-ventures/design-system/v3';
import { ROLES, roleLabel, type IssuedInvite, type PersonUsage, type PlatformPerson, type Role } from '@/domain';
import { usePlatform } from '@/state';
import { formatCount, formatDateTime } from '@/ui/format';
import { RelativeTime } from '@/ui/time';
import { IssuedLink } from './invite-drawer';
import { formatCompact, formatUsd, rolesLabel, statusLabel, STATUS_TONES } from './format';

type Confirm = 'suspend' | 'restore' | null;

/**
 * One person: who they are, their usage in the last 30 days, their roles and what the operator
 * can do now (release a sign-up, a new link, suspend, restore). The operator's own row is read-only.
 */
export function PersonDrawer({ person: open, usage, onClose }: { person: PlatformPerson | undefined; usage: PersonUsage | undefined; onClose: () => void }) {
  const platform = usePlatform();
  // The last person stays on screen while the drawer slides out.
  const [last, setLast] = useState<PlatformPerson>();
  if (open && open !== last) setLast(open);
  const person = open ?? last;
  const [roles, setRoles] = useState<{ id: string; value: Role[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [issued, setIssued] = useState<IssuedInvite>();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [shownId, setShownId] = useState<string>();

  // A different person resets what the drawer was doing.
  if (person && person.id !== shownId) {
    setShownId(person.id);
    setRoles(undefined);
    setError(undefined);
    setIssued(undefined);
  }

  const chosen = roles && person && roles.id === person.id ? roles.value : person?.roles ?? [];
  const changed = Boolean(person) && chosen.join() !== person?.roles.join();
  const self = person?.operator ?? false;
  const pending = person?.status === 'pending';

  async function act<T>(run: () => Promise<{ ok: true; value: T } | { ok: false; refusal: { message: string } }>, after?: (value: T) => void) {
    setBusy(true);
    setError(undefined);
    const result = await run();
    setBusy(false);
    if (!result.ok) { setError(result.refusal.message); return false; }
    after?.(result.value);
    return true;
  }

  function toggle(role: Role, on: boolean) {
    if (!person) return;
    const next = on ? [...chosen, role] : chosen.filter((entry) => entry !== role);
    setRoles({ id: person.id, value: ROLES.filter((entry) => next.includes(entry)) });
  }

  if (!person) return null;

  const details = [
    { label: 'Status', value: <Badge tone={STATUS_TONES[person.status]} variant="text" dot>{statusLabel(person.status)}</Badge> },
    { label: 'Workspace', value: person.workspace?.name, state: person.workspace ? undefined : ('empty' as const) },
    { label: 'Funções', value: rolesLabel(person.roles) },
    { label: 'Último acesso', value: person.lastSeenAt ? <RelativeTime at={person.lastSeenAt} /> : undefined, state: person.lastSeenAt ? undefined : ('empty' as const) },
    { label: 'Criado em', value: formatDateTime(person.createdAt), numeric: true },
    ...(person.inviteExpiresAt ? [{ label: 'Link expira em', value: formatDateTime(person.inviteExpiresAt), numeric: true }] : []),
  ];

  const footer = self ? undefined : pending ? (
    <Button variant="primary" loading={busy} disabled={!chosen.length} onClick={() => void act(() => platform.approve(person.id, chosen))}>Liberar acesso</Button>
  ) : person.status === 'suspended' ? (
    <Button variant="primary" loading={busy} onClick={() => setConfirm('restore')}>Reativar acesso</Button>
  ) : (
    <>
      <Button variant="danger-soft" disabled={busy} onClick={() => setConfirm('suspend')}>Suspender acesso</Button>
      {person.status === 'invited' ? <Button loading={busy && !changed} onClick={() => void act(() => platform.renewInvite(person.id), setIssued)}>Gerar novo link</Button> : null}
      <Button variant="primary" loading={busy && changed} disabled={!changed || !chosen.length} onClick={() => void act(() => platform.setRoles(person.id, chosen))}>Salvar funções</Button>
    </>
  );

  return (
    <>
      <Drawer
        open={Boolean(open)}
        onClose={onClose}
        title={person.name}
        description={person.email}
        leading={<Avatar name={person.name} src={person.avatarUrl} size="md" decorative />}
        footer={footer}
      >
        <PageStack>
          {self ? <Badge tone="blue">Você · operador da plataforma</Badge> : null}
          <DescriptionList items={details} />
          {usage ? (
            <Section title="Últimos 30 dias" titleAs="h3">
              <MetricStrip
                label="Uso nos últimos 30 dias"
                items={[
                  { label: 'Dias ativos', value: formatCount(usage.activeDays) },
                  { label: 'Gerações', value: formatCount(usage.generations) },
                  { label: 'Tokens', value: formatCompact(usage.tokens) },
                  { label: 'Custo', value: formatUsd(usage.costUsd) },
                ]}
              />
            </Section>
          ) : null}
          {!self && person.status !== 'suspended' ? (
            <CheckboxGroup legend={pending ? 'Liberar como' : 'Funções'}>
              {ROLES.map((role) => (
                <Checkbox key={role} label={roleLabel(role)} checked={chosen.includes(role)} disabled={busy} onChange={(event) => toggle(role, event.target.checked)} />
              ))}
            </CheckboxGroup>
          ) : null}
          {issued ? <IssuedLink invite={issued} /> : null}
          {error ? <Alert tone="danger" title="Não foi possível concluir">{error}</Alert> : null}
        </PageStack>
      </Drawer>
      <ConfirmDialog
        open={confirm === 'suspend'}
        onClose={() => setConfirm(null)}
        title={`Suspender ${person.name}?`}
        description="O acesso termina agora. Um link aberto deixa de funcionar."
        confirmLabel="Suspender acesso"
        tone="danger"
        onConfirm={() => act(() => platform.suspend(person.id))}
      />
      <ConfirmDialog
        open={confirm === 'restore'}
        onClose={() => setConfirm(null)}
        title={`Reativar ${person.name}?`}
        description={person.lastSeenAt ? 'A pessoa volta a entrar com a mesma senha.' : 'Um novo link de acesso será gerado.'}
        confirmLabel="Reativar acesso"
        onConfirm={() => act(() => platform.restore(person.id), (value) => { if (value.invite) setIssued(value.invite); })}
      />
    </>
  );
}
