'use client';
import {Suspense,useEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {Alert,AppShell,Avatar,Badge,Button,ButtonLink,EmptyState,ErrorState,FilterBar,List,ListItem,PageHeader,PageStack,Pagination,SearchField,Sidebar,SidebarAccount,SkeletonText,TopBar} from '@content-ventures/design-system/v3';
import {Building2,LogOut} from '@content-ventures/design-system/v3/icons';
import {workspaceAccessHref} from '@/domain/workspace-address';
import type {WorkspaceAccess} from '@/domain/workspace-management';
import {WorkspaceDirectoryProvider,useEntryDirectory,useWorkspaceDirectoryQuery} from '@/state/workspaces';
import {lastWorkspace,rememberWorkspace} from '@/state/workspace-preference';

import {ReporterBrand} from '@/ui/reporter-brand';
import {roleLabel} from '@/domain/permissions';
import {SIDEBAR_COLLAPSED_KEY,usePersistentFlag} from '@/ui/shell/preference';

const workspaceDestination=(item:WorkspaceAccess)=>workspaceAccessHref(item);
export function WorkspaceSelectionScreen(){return<WorkspaceDirectoryProvider><Suspense fallback={<SkeletonText lines={3}/>}><SelectionView/></Suspense></WorkspaceDirectoryProvider>;}
function SelectionView(){
  const router=useRouter(),port=useEntryDirectory(),params=useSearchParams(),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const query=useWorkspaceDirectoryQuery(port,{search,limit:20,offset:(page-1)*20}),data=query.data,entry=params.get('entry')==='1';
  useEffect(()=>{
    if(!entry||search||page!==1||!data?.account)return;
    if(data.legacy){window.location.replace(data.legacy.href);return;}
    if(data.enabled===false)return;
    let live=true;
    async function openPreferred(){
      const account=data!.account!,saved=lastWorkspace(account.id);
      let target=saved?data!.items.find(item=>item.workspace.id===saved.workspaceId&&item.workspace.slug===saved.slug&&item.enterable!==false):undefined;
      if(saved&&!target){const found=await port.accessible({search:saved.slug,limit:100});if(!live)return;
        if(found.ok&&found.value.account?.id===account.id)target=found.value.items.find(item=>item.workspace.id===saved.workspaceId&&item.workspace.slug===saved.slug&&item.enterable!==false);}
      if(!target&&data!.total===1&&data!.items[0]?.enterable!==false)target=data!.items[0];
      if(live&&target){rememberWorkspace(account.id,{workspaceId:target.workspace.id,slug:target.workspace.slug});window.location.replace(workspaceDestination(target));}
    }
    void openPreferred();return()=>{live=false;};
  },[data,entry,page,port,search]);
  const account=data?.account;
  const [collapsed,setCollapsed]=usePersistentFlag(SIDEBAR_COLLAPSED_KEY);
  const empty=<EmptyState title={search?'Nenhum workspace encontrado':data?.enabled===false?'Navegação ainda não liberada':'Nenhum workspace liberado'} actions={data?.legacy?<ButtonLink href={data.legacy.href}>Entrar em {data.legacy.name}</ButtonLink>:search?<Button onClick={()=>{setSearch('');setPage(1);}}>Limpar busca</Button>:<ButtonLink href="/auth/pending">Consultar meu acesso</ButtonLink>}/>;
  return<AppShell layout="auto" collapsed={collapsed} sidebar={<Sidebar label="Menu de workspaces" product={<ReporterBrand endorsed/>} groups={[]}
    utilities={data?.administrative?[{id:'platform',label:'Plataforma',icon:Building2,href:'/platform'}]:[]}
    account={account?<SidebarAccount name={account.name} src={account.avatarUrl} detail="Sua conta" sections={[{items:[{label:'Sair',icon:LogOut,onSelect:()=>{router.push('/auth/sign-out');}}]}]}/>:<ButtonLink href="/auth/sign-out">Sair</ButtonLink>}/>}
    topbar={<TopBar breadcrumb={[{label:'Workspaces'}]} onToggleSidebar={()=>setCollapsed(!collapsed)}/> }>
    <PageHeader title="Escolher workspace" actions={<Button disabled={query.loading} onClick={query.retry}>Atualizar acessos</Button>}/>
    {data?.enabled!==false?<FilterBar filters={false} search={<SearchField label="Buscar workspace" value={search} placeholder="Cliente ou endereço" onValueChange={value=>{setSearch(value);setPage(1);}}/>}/>:null}
    <PageStack>
      {params.get('unavailable')==='1'?<Alert tone="warning" title="Workspace indisponível">Escolha um workspace liberado para continuar.</Alert>:null}
      {query.error?<ErrorState heading="h2" title="Workspaces indisponíveis" description={query.error.message} onRetry={query.retry}/>:query.loading?<SkeletonText lines={4}/>:<List label="Workspaces disponíveis" empty={empty}>
        {data?.items.map(item=><ListItem key={item.workspace.id} leading={<Avatar name={item.workspace.name}/>} title={item.workspace.name}
          description={item.administrative?'Administração da plataforma':item.roles.map(roleLabel).join(' · ')} href={workspaceDestination(item)}
          disabled={item.enterable===false&&!item.administrative}
          onClick={()=>{if(account&&item.enterable!==false)rememberWorkspace(account.id,{workspaceId:item.workspace.id,slug:item.workspace.slug});}}
          trailing={item.enterable===false?<Badge tone="gray">Consultar cadastro</Badge>:item.workspace.status==='draft'?<Badge tone="gray">Em configuração</Badge>:undefined}/>)}</List>}
      {data&&data.total>20?<Pagination page={page} pageSize={20} total={data.total} noun="workspaces" onPageChange={setPage}/>:null}
    </PageStack>
  </AppShell>;
}
