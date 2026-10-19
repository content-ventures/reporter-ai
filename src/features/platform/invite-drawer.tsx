'use client';

import { useState, type KeyboardEvent } from 'react';
import { Alert, Button, CopyButton, DescriptionList, Drawer, Field, Input, Select, type SelectOption } from '@content-ventures/design-system/v3';
import { invitePath, ROLES, roleLabel, type IssuedInvite, type PlatformWorkspace, type Role } from '@/domain';
import { usePlatform } from '@/state';
import { formatDateTime } from '@/ui/format';
import { inputProps } from './field-props';

const ROLE_HINTS: Readonly<Record<Role, string>> = {
  editor: 'Cria produções, escreve e envia para aprovação',
  approver: 'Aprova ou pede ajustes nos artigos',
  creative_reviewer: 'Aprova os carrosséis',
  admin: 'Tudo do editor, mais prompts e logs',
};

export const ROLE_OPTIONS: SelectOption[] = ROLES.map((role) => ({ value: role, label: roleLabel(role), description: ROLE_HINTS[role] }));

/** The full link to send: this console's own origin. */
export function inviteUrl(token: string): string {
  return `${typeof window === 'undefined' ? '' : window.location.origin}${invitePath(token)}`;
}

/** The link just issued, ready to copy, with who it opens for and until when. */
export function IssuedLink({ invite }: { invite: IssuedInvite }) {
  const url = inviteUrl(invite.token);
  return (
    <>
      <Field label="Link de acesso">
        {(props) => <Input {...inputProps(props)} value={url} readOnly trailing={<CopyButton text={url} label="link de acesso" />} onFocus={(event) => event.currentTarget.select()} />}
      </Field>
      <DescriptionList
        items={[
          { label: 'Para', value: `${invite.person.name} · ${invite.person.email}` },
          { label: 'Expira em', value: formatDateTime(invite.expiresAt), numeric: true },
        ]}
      />
    </>
  );
}

type Draft = { name: string; email: string; role: Role; workspaceId: string };

/**
 * "Novo acesso": name, e-mail and role (and the workspace, when there is more than one). The
 * answer is the link the person opens to define the password; nothing is e-mailed.
 */
export function InviteDrawer({ open, onClose, workspaces }: { open: boolean; onClose: () => void; workspaces: PlatformWorkspace[] }) {
  const platform = usePlatform();
  const blank = (): Draft => ({ name: '', email: '', role: 'editor', workspaceId: workspaces[0]?.id ?? '' });
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: 'name' | 'email'; message: string }>();
  const [issued, setIssued] = useState<IssuedInvite>();
  const workspaceId = draft.workspaceId || workspaces[0]?.id || '';
  const ready = draft.name.trim().length >= 2 && draft.email.includes('@') && Boolean(workspaceId);

  function close() {
    onClose();
    setDraft(blank());
    setIssued(undefined);
    setError(undefined);
  }

  async function submit() {
    if (busy || !ready) return;
    setBusy(true);
    setError(undefined);
    const result = await platform.invite({ ...draft, workspaceId });
    setBusy(false);
    if (result.ok) { setIssued(result.value); return; }
    const { code, message } = result.refusal;
    setError({ field: code === 'invalid_name' ? 'name' : code === 'invalid_email' || code === 'email_taken' ? 'email' : undefined, message });
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      dismissible={!busy && !draft.name && !draft.email}
      title={issued ? 'Acesso criado' : 'Novo acesso'}
      description={issued ? 'Envie o link. A pessoa define a senha ao abrir.' : undefined}
      footer={issued ? (
        <>
          <Button onClick={() => { setIssued(undefined); setDraft(blank()); }}>Criar outro</Button>
          <Button variant="primary" onClick={close}>Concluir</Button>
        </>
      ) : (
        <>
          <Button onClick={close} disabled={busy}>Cancelar</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>Criar acesso</Button>
        </>
      )}
    >
      {issued ? <IssuedLink invite={issued} /> : (
        <>
          <Field label="Nome" error={error?.field === 'name' ? error.message : undefined}>
            {(props) => <Input {...inputProps(props)} value={draft.name} autoComplete="off" maxLength={80} onKeyDown={submitOnEnter} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />}
          </Field>
          <Field label="E-mail" error={error?.field === 'email' ? error.message : undefined}>
            {(props) => <Input {...inputProps(props)} value={draft.email} type="email" autoComplete="off" onKeyDown={submitOnEnter} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />}
          </Field>
          <Field label="Função">
            {(props) => <Select {...props} value={draft.role} options={ROLE_OPTIONS} onChange={(value) => setDraft({ ...draft, role: value as Role })} />}
          </Field>
          {workspaces.length > 1 ? (
            <Field label="Workspace">
              {(props) => <Select {...props} value={workspaceId} options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))} onChange={(value) => setDraft({ ...draft, workspaceId: value })} />}
            </Field>
          ) : null}
          {error && !error.field ? <Alert tone="danger" title="Não foi possível criar">{error.message}</Alert> : null}
        </>
      )}
    </Drawer>
  );
}
