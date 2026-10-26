'use client';

import { useState } from 'react';
import { Alert, Avatar, Badge, Button,ButtonLink, Checkbox, CheckboxGroup,Combobox, ConfirmDialog, DescriptionList, Drawer,Field, MetricStrip, PageStack,Panel, Section,List,ListItem } from '@content-ventures/design-system/v3';
import { ROLES, roleLabel, type IssuedInvite, type PersonUsage, type PlatformPerson, type Role } from '@/domain';
import { usePlatform,usePlatformAdministration,useAdministrationQuery,usePlatformOperator } from '@/state';
import type {WorkspaceTeamMember} from '@/domain/workspace-management';
import {TeamMember} from './workspace-team';
import {workspaceManagementHref} from './workspaces-screen';
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
  const operatorId=usePlatformOperator().data?.id;
  const administration=usePlatformAdministration();
  const [membership,setMembership]=useState<WorkspaceTeamMember>();
  const [signupWorkspace,setSignupWorkspace]=useState(''),[workspaceSearch,setWorkspaceSearch]=useState('');
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
    setMembership(undefined);
    setSignupWorkspace('');setWorkspaceSearch('');
  }

  const chosen = roles && person && roles.id === person.id ? roles.value : person?.roles ?? [];
  const changed = Boolean(person) && chosen.join() !== person?.roles.join();
  const self = Boolean(person&&person.id===operatorId);
  const pending = person?.status === 'pending';
  const signupTargets=useAdministrationQuery(pending?administration:undefined,`signup-targets:${workspaceSearch}`,admin=>admin.list({search:workspaceSearch,limit:50}));

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
  const managed=platform.mode==='connected'&&!pending;

  const details = [
    { label: managed?'Conta na plataforma':'Status', value: <Badge tone={STATUS_TONES[managed?person.accountStatus??person.status:person.status]} variant="text" dot>{statusLabel(managed?person.accountStatus??person.status:person.status)}</Badge> },
    ...(managed?[{label:'Vínculos',value:person.memberships?.length??0}]:[
      { label: 'Workspace', value: person.workspace?.name, state: person.workspace ? undefined : ('empty' as const) },
      { label: 'Funções', value: rolesLabel(person.roles) },
    ]),
    { label: 'Último acesso', value: person.lastSeenAt ? <RelativeTime at={person.lastSeenAt} /> : undefined, state: person.lastSeenAt ? undefined : ('empty' as const) },
    { label: 'Criado em', value: formatDateTime(person.createdAt), numeric: true },
    ...(person.inviteExpiresAt ? [{ label: 'Link expira em', value: formatDateTime(person.inviteExpiresAt), numeric: true }] : []),
  ];

  const footer = managed ? (!self&&platform.accountStatus?<Button variant="danger-soft" disabled={busy} onClick={()=>setConfirm(person.accountStatus==='suspended'?'restore':'suspend')}>{person.accountStatus==='suspended'?'Reativar conta na plataforma':'Suspender conta na plataforma'}</Button>:undefined) : self ? undefined : pending ? (
    <Button variant="primary" loading={busy} disabled={!chosen.length||(Boolean(administration)&&!signupWorkspace)} onClick={() => void act(() => administration?administration.approveSignup({workspaceId:signupWorkspace,personId:person.id,roles:chosen}):platform.approve(person.id, chosen))}>Liberar acesso</Button>
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
          {pending&&administration?<Field label="Workspace do novo vínculo">{props=><Combobox {...props} value={signupWorkspace} onChange={setSignupWorkspace} onQuery={setWorkspaceSearch} loading={signupTargets.loading}
            options={(signupTargets.data?.items??[]).filter(workspace=>workspace.status==='active'||workspace.status==='draft').map(workspace=>({value:workspace.id,label:workspace.name}))}/>}</Field>:null}
          {managed||usage?<Panel>
          {managed?<Section title="Vínculos por workspace" titleAs="h3">
            <List label="Vínculos desta pessoa" framed={false} empty="Esta conta ainda não tem vínculos.">{person.memberships?.map(link=><ListItem key={link.id} title={link.workspace.name}
              description={`${rolesLabel(link.roles)} · ${link.status==='active'?'Ativo':link.status==='invited'?'Convidado':'Suspenso'}`}
              onClick={!self&&administration?()=>setMembership({...link,name:person.name,email:person.email,avatarUrl:person.avatarUrl,accountSuspended:person.accountStatus==='suspended'}):undefined}
              trailing={<ButtonLink size="sm" href={workspaceManagementHref(link.workspace.id)}>Administrar</ButtonLink>}/>)}</List>
          </Section>:null}
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
          </Panel>:null}
          {!managed&&!self && person.status !== 'suspended' ? (
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
        title={`Suspender ${person.name}${managed?' na plataforma':''}?`}
        description={managed?'Esta conta perderá acesso a todos os workspaces. Para afetar apenas um cliente, altere o vínculo correspondente.':'O acesso termina agora. Um link aberto deixa de funcionar.'}
        confirmLabel={managed?'Suspender conta':'Suspender acesso'}
        tone="danger"
        onConfirm={() => act(() => managed?platform.accountStatus!(person.id,true):platform.suspend(person.id))}
      />
      <ConfirmDialog
        open={confirm === 'restore'}
        onClose={() => setConfirm(null)}
        title={`Reativar ${person.name}?`}
        description={person.lastSeenAt ? 'A pessoa volta a entrar com a mesma senha.' : 'Um novo link de acesso será gerado.'}
        confirmLabel="Reativar acesso"
        onConfirm={() => managed?act(()=>platform.accountStatus!(person.id,false)):act(() => platform.restore(person.id), (value) => { if (value.invite) setIssued(value.invite); })}
      />
      {membership&&administration?<TeamMember key={membership.id} port={administration} member={membership} onClose={()=>setMembership(undefined)}/>:null}
    </>
  );
}
