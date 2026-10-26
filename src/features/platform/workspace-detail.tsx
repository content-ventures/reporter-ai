'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';
import {useState} from 'react';
import {AccessState,Alert,Badge,Button,ButtonLink,ConfirmDialog,DescriptionList,ErrorState,Field,Input,List,ListItem,PageHeader,PageStack,Section,SkeletonText} from '@content-ventures/design-system/v3';
import type {WorkspaceAdministration} from '@/ports/workspace-management';
import type {ManagedWorkspace,WorkspaceRequirement} from '@/domain/workspace-management';
import {workspacePagePath} from '@/domain/workspace-address';
import {useAdministrationQuery,usePlatformAdministration,useWorkspaceAdministration,useSession} from '@/state';
import {inputProps} from './field-props';
import {WORKSPACE_STATUS_LABELS} from './workspaces-screen';
import {WorkspaceBrand} from './workspace-brand';
import {WorkspaceTeam} from './workspace-team';
import {WorkspaceAutomation} from './workspace-automation';
import {WorkspaceFormGuard,useWorkspaceForm} from './workspace-form-guard';
import {WorkspaceCopy} from './workspace-copy';

export function WorkspaceDetailScreen({workspaceId}:{workspaceId:string}){
  const port=usePlatformAdministration();
  return port?<WorkspaceDetail key={workspaceId} port={port} workspaceId={workspaceId}/>:<AccessState kind="restricted" heading="h1" title="Gestão disponível na conexão real"/>;
}
export function ClientAdministrationScreen(){
  const port=useWorkspaceAdministration(),session=useSession();
  if(session.status==='loading')return<SkeletonText lines={3}/>;
  if(!port||!session.data?.current?.roles.includes('admin'))return<AccessState kind="restricted" heading="h1" title="Administração restrita ao responsável pelo workspace"/>;
  return<WorkspaceDetail key={session.data.workspace.id} port={port} workspaceId={session.data.workspace.id}/>;
}
function WorkspaceDetail({port,workspaceId}:{port:WorkspaceAdministration;workspaceId:string}){
  const workspaceHrefFor = useWorkspaceHref();
  const query=useAdministrationQuery(port,`workspace:${workspaceId}`,admin=>admin.get(workspaceId));
  const [copy,setCopy]=useState(false);
  if(query.error)return<ErrorState heading="h1" title="Workspace indisponível" description={query.error.message} onRetry={query.retry}/>;
  const workspace=query.data;if(!workspace)return<SkeletonText lines={4}/>;
  const path=(value:string)=>workspacePagePath(workspace.slug,value),editable=workspace.status==='draft'||workspace.status==='active';
  const labels:Record<WorkspaceRequirement,string>={editorial_map:'Mapa editorial',writing_guide:'Guia de escrita',templates:'Modelos e marca',editor:'Editor ativo',approver:'Aprovador ativo'};
  return<WorkspaceFormGuard>
    <PageHeader title={workspace.name} status={<Badge tone={workspace.status==='active'?'green':'gray'}>{WORKSPACE_STATUS_LABELS[workspace.status]}</Badge>}
      actions={editable?<ButtonLink href={workspaceHrefFor(path('/'))} variant="primary">Abrir workspace</ButtonLink>:undefined}/>
    <PageStack>
      <Section title="Prontidão para gerar" titleAs="h2" variant="panel" action={<Button size="sm" aria-label="Reavaliar configuração" onClick={query.retry}>Reavaliar</Button>}>
        <List label="Requisitos para geração" framed={false}>{Object.entries(labels).map(([key,label])=><ListItem key={key} title={label}
          href={workspaceHrefFor(editable&&(key==='editorial_map'||key==='writing_guide')?path(`/settings/${key==='editorial_map'?'editorial-map':'writing-guide'}`):undefined)}
          trailing={<Badge variant="text" tone={workspace.readiness.missing.includes(key as WorkspaceRequirement)?'orange':'green'}>{workspace.readiness.missing.includes(key as WorkspaceRequirement)?'Pendente':'Pronto'}</Badge>}/>)}</List>
        {port.global&&editable?<Button size="sm" onClick={()=>setCopy(true)}>Copiar configuração</Button>:null}
      </Section>
      {port.global?<WorkspaceIdentity key={workspace.id} port={port} workspace={workspace} reload={query.retry}/>:null}
      {editable?<><WorkspaceBrand port={port} workspaceId={workspace.id} name={workspace.name}/><WorkspaceTeam port={port} workspaceId={workspace.id}/>{port.global?<WorkspaceAutomation port={port} workspaceId={workspace.id}/>:null}</>:<Alert tone="info" title={workspace.status==='archiving'?'Aguardando o processamento terminar':'Workspace arquivado'}>O histórico permanece guardado. Reative o workspace para voltar a operar.</Alert>}
    </PageStack>
    {copy?<WorkspaceCopy port={port} target={workspace} onClose={()=>setCopy(false)}/>:null}
  </WorkspaceFormGuard>;
}
function WorkspaceIdentity({port,workspace,reload}:{port:WorkspaceAdministration;workspace:ManagedWorkspace;reload:()=>void}){
  const [name,setName]=useState(workspace.name),[revision,setRevision]=useState(workspace.revision),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[confirm,setConfirm]=useState(false);
  useWorkspaceForm(name!==workspace.name,busy);
  async function update(status:'draft'|'active'|'archived',baseRevision=revision){
    setBusy(true);setError(undefined);const saved=await port.update({workspaceId:workspace.id,name,status,revision:baseRevision});setBusy(false);setConfirm(false);
    if(saved.ok){setRevision(saved.value.revision);setName(saved.value.name);}else setError(saved.refusal.message);
  }
  async function refresh(){setBusy(true);const latest=await port.get(workspace.id);setBusy(false);if(latest.ok){setName(latest.value.name);setRevision(latest.value.revision);setError(undefined);reload();}else setError(latest.refusal.message);}
  return<Section title="Cliente" titleAs="h2" variant="panel" action={<Button size="sm" disabled={busy} onClick={()=>void refresh()}>Recarregar cadastro</Button>}>
    <PageStack>
      <DescriptionList items={[{label:'Endereço',value:workspace.slug},{label:'Geração',value:workspace.readiness.ready?'Configuração completa':'Configuração pendente'},...(workspace.pilot?[{label:'Piloto',value:'Workspace atual preservado'}]:[])]}/>
      <Field label="Nome do cliente">{props=><Input {...inputProps(props)} disabled={busy} value={name} maxLength={80} onChange={event=>setName(event.target.value)}/>}</Field>
      {error?<Alert tone="danger" title="Não foi possível alterar">{error}</Alert>:null}
      <Button loading={busy} disabled={name===workspace.name||name.trim().length<2||workspace.status==='archiving'} onClick={()=>void update(workspace.status==='archived'?'archived':workspace.status==='draft'?'draft':'active')}>Salvar nome</Button>
      {workspace.status==='active'||workspace.status==='draft'?<Button disabled={busy||name!==workspace.name} variant="danger-soft" onClick={()=>setConfirm(true)}>Arquivar workspace</Button>:null}
      {workspace.status==='archived'?<Button variant="primary" disabled={busy||name!==workspace.name} onClick={()=>void update('active',workspace.revision)}>Reativar workspace</Button>:null}
      {workspace.status==='draft'?<Button variant="primary" disabled={busy||name!==workspace.name||!workspace.readiness.ready} onClick={()=>void update('active',workspace.revision)}>Ativar workspace</Button>:null}
    </PageStack>
    <ConfirmDialog open={confirm} onClose={()=>setConfirm(false)} title="Arquivar workspace?" description="Novas operações serão interrompidas. Os trabalhos em andamento terminam antes do arquivamento, e o histórico permanece guardado." confirmLabel="Arquivar workspace" tone="danger" onConfirm={()=>void update('archived',workspace.revision)}/>
  </Section>;
}
