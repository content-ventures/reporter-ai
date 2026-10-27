'use client';
import {useState} from 'react';
import {Alert,Avatar,Badge,Button,Checkbox,CheckboxGroup,ConfirmDialog,DataTable,Drawer,EmptyState,ErrorState,Field,FilterBar,Input,PageStack,Pagination,SearchField,Section,Select,type Column} from '@content-ventures/design-system/v3';
import type {WorkspaceAdministration} from '@/ports/workspace-management';
import type {WorkspaceTeamMember} from '@/domain/workspace-management';
import {ROLES,roleLabel,type Role} from '@/domain';
import type {IssuedInvite} from '@/domain/platform';
import {useAdministrationQuery} from '@/state';
import {IssuedLink,ROLE_OPTIONS} from './invite-drawer';
import {useWorkspaceForm} from './workspace-form-guard';
import {inputProps} from './field-props';
import {rolesLabel} from './format';

export function WorkspaceTeam({port,workspaceId}:{port:WorkspaceAdministration;workspaceId:string}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[inviting,setInviting]=useState(false),[opened,setOpened]=useState<WorkspaceTeamMember>();
  const query=useAdministrationQuery(port,`team:${workspaceId}:${search}:${page}`,admin=>admin.members(workspaceId,{search,limit:20,offset:(page-1)*20}));
  const columns:Column<WorkspaceTeamMember>[]=[
    {key:'name',header:'Pessoa',pinned:true,render:member=>member.name},
    {key:'email',header:'E-mail',truncate:true,render:member=>member.email},
    {key:'roles',header:'Funções neste workspace',render:member=>rolesLabel(member.roles)},
    {key:'status',header:'Vínculo',render:member=><Badge variant="text" tone={member.status==='active'?'green':'gray'}>{member.status==='active'?'Ativo':member.status==='invited'?'Convidado':'Suspenso'}</Badge>},
    {key:'account',header:'Conta',render:member=>member.accountSuspended?'Suspensa na plataforma':'Disponível'},
  ];
  return<Section title="Equipe" titleAs="h2" variant="panel" action={<Button size="sm" disabled={port.readOnly} onClick={()=>setInviting(true)}>Convidar pessoa</Button>}>
    <FilterBar filters={false} search={<SearchField label="Buscar pessoa na equipe" value={search} onValueChange={value=>{setSearch(value);setPage(1);}}/>}/>
    <DataTable label="Equipe do workspace" variant="plain" rows={query.data?.items??[]} columns={columns} rowKey={member=>member.id} onRowClick={setOpened}
      loading={query.loading} empty={<EmptyState title="Nenhuma pessoa encontrada"/>} error={query.error?<ErrorState title="Equipe indisponível" description={query.error.message} onRetry={query.retry}/>:undefined}
      footer={query.data&&query.data.total>20?<Pagination page={page} pageSize={20} total={query.data.total} noun="pessoas" onPageChange={setPage}/>:undefined}/>
    {inviting?<TeamInvitation key={workspaceId} port={port} workspaceId={workspaceId} onClose={()=>setInviting(false)}/>:null}
    {opened?<TeamMember key={opened.id} port={port} member={opened} onClose={()=>setOpened(undefined)}/>:null}
  </Section>;
}
function TeamInvitation({port,workspaceId,onClose}:{port:WorkspaceAdministration;workspaceId:string;onClose:()=>void}){
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState<Role>('editor'),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[issued,setIssued]=useState<IssuedInvite>();
  useWorkspaceForm(!issued&&Boolean(name||email),busy);
  async function submit(){setBusy(true);setError(undefined);const saved=await port.invite({workspaceId,name,email,role});setBusy(false);if(saved.ok)setIssued(saved.value);else setError(saved.refusal.message);}
  return<Drawer open onClose={onClose} dismissible={!busy&&!name&&!email} title={issued?'Convite criado':'Convidar pessoa'} description={issued?'Copie e envie o link à pessoa.':undefined}
    footer={<Button variant="primary" loading={busy} disabled={!issued&&(name.trim().length<2||!email.includes('@'))} onClick={()=>issued?onClose():void submit()}>{issued?'Concluir':'Criar convite'}</Button>}>
    {issued?<IssuedLink invite={issued}/>:<>
      <Field label="Nome">{props=><Input {...inputProps(props)} maxLength={80} value={name} onChange={event=>setName(event.target.value)}/>}</Field>
      <Field label="E-mail" hint="Uma conta existente recebe apenas um novo vínculo.">{props=><Input {...inputProps(props)} type="email" value={email} onChange={event=>setEmail(event.target.value)}/>}</Field>
      <Field label="Função neste workspace">{props=><Select {...props} value={role} options={ROLE_OPTIONS} onChange={value=>setRole(value as Role)}/>}</Field>
    </>}
    {error?<Alert title="Não foi possível convidar" tone="danger">{error}</Alert>:null}
  </Drawer>;
}
export function TeamMember({port,member,onClose}:{port:WorkspaceAdministration;member:WorkspaceTeamMember;onClose:()=>void}){
  const [chosen,setChosen]=useState(member.roles),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[confirm,setConfirm]=useState(false),[issued,setIssued]=useState<IssuedInvite>();
  useWorkspaceForm(chosen.join()!==member.roles.join(),busy);
  const base={workspaceId:member.workspace.id,personId:member.personId,revision:member.revision};
  async function act(operation:'roles'|'status'|'renew'){
    setBusy(true);setError(undefined);
    if(operation==='renew'){const saved=await port.renewInvite(base);setBusy(false);if(saved.ok)setIssued(saved.value);else setError(saved.refusal.message);return;}
    const saved=operation==='roles'?await port.setRoles({...base,roles:chosen}):await port.setStatus({...base,status:member.status==='suspended'?'active':'suspended'});
    setBusy(false);setConfirm(false);if(saved.ok)onClose();else setError(saved.refusal.message);
  }
  return<>
    <Drawer open onClose={onClose} dismissible={!busy&&chosen.join()===member.roles.join()} title={member.name} description={member.email} leading={<Avatar name={member.name} src={member.avatarUrl}/>}
      footer={port.readOnly?<Button onClick={onClose}>Fechar</Button>:issued?<Button onClick={onClose}>Concluir</Button>:<>
        <Button disabled={busy} onClick={()=>setConfirm(true)}>{member.status==='suspended'?'Reativar vínculo':'Suspender vínculo'}</Button>
        {member.status==='invited'||member.status==='suspended'?<Button disabled={busy} onClick={()=>void act('renew')}>Gerar novo link</Button>:null}
        <Button variant="primary" loading={busy} disabled={!chosen.length||chosen.join()===member.roles.join()} onClick={()=>void act('roles')}>Salvar funções</Button>
      </>}>
      <PageStack>
        {member.accountSuspended?<Alert title="Conta suspensa na plataforma" tone="warning">Somente o operador da plataforma pode reativar a conta. O vínculo deste workspace é independente.</Alert>:null}
        <CheckboxGroup legend="Funções neste workspace">{ROLES.map(role=><Checkbox key={role} label={roleLabel(role)} checked={chosen.includes(role)} disabled={port.readOnly||busy||Boolean(issued)} onChange={event=>setChosen(ROLES.filter(value=>value===role?event.target.checked:chosen.includes(value)))}/>)}</CheckboxGroup>
        {issued?<IssuedLink invite={issued}/>:null}
        {error?<Alert title="Não foi possível alterar" tone="danger">{error}</Alert>:null}
      </PageStack>
    </Drawer>
    <ConfirmDialog open={confirm} onClose={()=>setConfirm(false)} title={`${member.status==='suspended'?'Reativar':'Suspender'} vínculo?`}
      description={`A alteração afeta somente ${member.workspace.name}.`} confirmLabel={member.status==='suspended'?'Reativar vínculo':'Suspender vínculo'} onConfirm={()=>void act('status')}/>
  </>;
}
