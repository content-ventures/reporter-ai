'use client';
import {useState} from 'react';
import {PortalSwitcher,ThemeV3,useShell,type Portal} from '@content-ventures/design-system/v3';
import {useRuntime,useSession} from '@/state';
import {useWorkspaceDirectoryQuery} from '@/state/workspaces';
import {rememberWorkspace} from '@/state/workspace-preference';
import {workspaceAccessHref} from '@/domain/workspace-address';
import type {WorkspaceAccess} from '@/domain/workspace-management';
import {roleLabel} from '@/domain/permissions';
import {useWorkspaceDeparture} from '../workspace-navigation';
import {requestLeave} from './leave-guard';
import {WorkspacePicker} from './workspace-picker';

export function WorkspaceSwitcher(){
  const prepare=useWorkspaceDeparture(),{closeNav}=useShell(),[picking,setPicking]=useState(false);
  const runtime=useRuntime(),session=useSession().data,port=runtime.runtime?.workspaceDirectory;
  const directory=useWorkspaceDirectoryQuery(port,{limit:3}),data=directory.data;
  if(!port||!session?.current)return null;
  const currentId=session.workspace.id,administrative=Boolean(session.navigation?.administrative),accountId=session.navigation?.accountId??session.current.id;
  const choices:Portal[]=[{id:session.workspace.id,name:session.workspace.name,detail:administrative?'Administração da plataforma':session.current.roles.map(roleLabel).join(' · ')},
    ...(data?.items??[]).filter(item=>item.workspace.id!==session.workspace.id&&item.enterable!==false).slice(0,2).map(item=>({id:item.workspace.id,name:item.workspace.name,
      detail:item.administrative?'Administração da plataforma':item.roles.map(roleLabel).join(' · '),status:item.workspace.status==='archiving'?'archived' as const:item.workspace.status,
      statusLabel:item.workspace.status==='draft'?'Em configuração':undefined}))];
  function choose(selected:WorkspaceAccess){
    setPicking(false);if(selected.workspace.id===currentId)return;
    const href=workspaceAccessHref(selected);closeNav();if(!requestLeave(href))return;
    void prepare().then(allowed=>{if(!allowed)return;if(selected.enterable!==false)rememberWorkspace(accountId,{workspaceId:selected.workspace.id,slug:selected.workspace.slug});window.location.assign(new URL(href,window.location.href).href);});
  }
  function manage(){setPicking(false);closeNav();const href='/platform/workspaces';if(requestLeave(href))void prepare().then(allowed=>{if(allowed)window.location.assign(new URL(href,window.location.href).href);});}
  return<>
    <ThemeV3><PortalSwitcher label="Trocar workspace" portals={choices} value={session.workspace.id} onChange={id=>{const selected=data?.items.find(item=>item.workspace.id===id);if(selected)choose(selected);}}
      action={{label:'Ver todos os workspaces',onSelect:()=>{closeNav();setPicking(true);}}}/></ThemeV3>
    {picking?<WorkspacePicker port={port} currentId={session.workspace.id} administrative={administrative} onClose={()=>setPicking(false)} onChoose={choose} onManage={manage}/>:null}
  </>;
}
