'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Alert,Badge,Button,DataTable,Drawer,EmptyState,ErrorState,Field,FilterBar,Input,PageHeader,PageStack,Pagination,SearchField,type Column} from '@content-ventures/design-system/v3';
import {Plus} from '@content-ventures/design-system/v3/icons';
import type {ManagedWorkspace} from '@/domain/workspace-management';
import {useAdministrationQuery,usePlatformAdministration} from '@/state';
import {useWorkspaceForm,WorkspaceFormGuard} from './workspace-form-guard';
import {inputProps} from './field-props';
import {WorkspaceActivationDrawer} from './workspace-activation';

export const WORKSPACES_HREF='/platform/workspaces';
export const workspaceManagementHref=(id:string)=>`${WORKSPACES_HREF}/${encodeURIComponent(id)}`;
export const WORKSPACE_STATUS_LABELS={draft:'Em configuração',active:'Ativo',archiving:'Encerrando processamento',archived:'Arquivado'} as const;

export function WorkspacesScreen(){return<WorkspaceFormGuard><WorkspaceList/></WorkspaceFormGuard>;}
function WorkspaceList(){
  const port=usePlatformAdministration(),router=useRouter();
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[creating,setCreating]=useState(false),[activation,setActivation]=useState(false);
  const result=useAdministrationQuery(port,`workspaces:${search}:${page}`,admin=>admin.list({search,limit:20,offset:(page-1)*20}));
  const columns:Column<ManagedWorkspace>[]=[
    {key:'name',header:'Cliente',pinned:true,render:row=>row.name},
    {key:'slug',header:'Endereço',truncate:true,render:row=>row.slug},
    {key:'status',header:'Status',render:row=><Badge variant="text" dot tone={row.status==='active'?'green':'gray'}>{WORKSPACE_STATUS_LABELS[row.status]}</Badge>},
    {key:'readiness',header:'Geração',render:row=>row.readiness.ready?'Pronto':`${row.readiness.missing.length} pendências`},
    {key:'pilot',header:'Piloto',render:row=>row.pilot?'Sim':'—'},
  ];
  return<>
    <PageHeader title="Workspaces" actions={<>{port?<Button onClick={()=>setActivation(true)}>Navegação</Button>:null}<Button variant="primary" icon={Plus} disabled={!port} onClick={()=>setCreating(true)}>Criar workspace</Button></>}/>
    <FilterBar filters={false} search={<SearchField label="Buscar workspace" placeholder="Cliente ou endereço" value={search} onValueChange={value=>{setSearch(value);setPage(1);}}/>}/>
    <PageStack><DataTable label="Workspaces dos clientes" rows={result.data?.items??[]} rowKey={row=>row.id} columns={columns} loading={result.loading} loadingRows={5}
      onRowClick={row=>router.push(workspaceManagementHref(row.id))} empty={<EmptyState title={port?'Nenhum workspace encontrado':'Gestão disponível na conexão real'}/>}
      error={result.error?<ErrorState title="Workspaces indisponíveis" description={result.error.message} onRetry={result.retry}/>:undefined}
      footer={result.data&&result.data.total>20?<Pagination page={page} pageSize={20} total={result.data.total} noun="workspaces" onPageChange={setPage}/>:undefined}/></PageStack>
    {activation&&port?<WorkspaceActivationDrawer port={port} onClose={()=>setActivation(false)}/>:null}
    {creating&&port?<CreateWorkspace onClose={()=>setCreating(false)} onCreate={async input=>{
      const saved=await port.create(input);if(saved.ok){setCreating(false);router.push(workspaceManagementHref(saved.value.id));}return saved;
    }}/>:null}
  </>;
}
function CreateWorkspace({onClose,onCreate}:{onClose:()=>void;onCreate:(input:{name:string;slug:string})=>Promise<{ok:boolean;refusal?:{message:string}}>}){
  const [name,setName]=useState(''),[slug,setSlug]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
  useWorkspaceForm(Boolean(name||slug),busy);
  async function submit(){setBusy(true);setError(undefined);const saved=await onCreate({name,slug});setBusy(false);if(!saved.ok)setError(saved.refusal?.message);}
  return<Drawer open onClose={onClose} dismissible={!busy&&!name&&!slug} title="Criar workspace" footer={<Button variant="primary" loading={busy} disabled={name.trim().length<2||slug.length<3} onClick={()=>void submit()}>Criar workspace</Button>}>
    <Field label="Cliente">{props=><Input {...inputProps(props)} value={name} maxLength={80} onChange={event=>setName(event.target.value)}/>}</Field>
    <Field label="Endereço" hint="Letras minúsculas, números e hífens. O endereço será permanente.">{props=><Input {...inputProps(props)} value={slug} maxLength={63} onChange={event=>setSlug(event.target.value)}/>}</Field>
    {error?<Alert tone="danger" title="Não foi possível criar">{error}</Alert>:null}
  </Drawer>;
}
