'use client';
import {PortalSwitcher,type Portal} from '@content-ventures/design-system/v3';
import {useRuntime,useSession} from '@/state';
import {useWorkspaceDirectoryQuery} from '@/state/workspaces';
import {rememberWorkspace} from '@/state/workspace-preference';
import {workspaceAccessHref} from '@/domain/workspace-address';
import {roleLabel} from '@/domain/permissions';
import {useWorkspaceDeparture} from '../workspace-navigation';
import {requestLeave} from './leave-guard';

export function WorkspaceSwitcher(){
  const prepare=useWorkspaceDeparture();
  const runtime=useRuntime(),session=useSession().data,port=runtime.runtime?.workspaceDirectory;
  const directory=useWorkspaceDirectoryQuery(port,{limit:100}),data=directory.data;
  if(!port||!session?.current)return null;
  const choices:Portal[]=(data?.items??[]).map(item=>({id:item.workspace.id,name:item.workspace.name,
    detail:item.administrative?'Administração da plataforma':item.roles.map(roleLabel).join(' · '),
    status:item.workspace.status==='archiving'?'archived':item.workspace.status,
    statusLabel:item.workspace.status==='archived'?'Arquivado':item.workspace.status==='archiving'?'Encerrando processamento':item.workspace.status==='draft'?'Em configuração':undefined}));
  if(!choices.some(item=>item.id===session.workspace.id))choices.unshift({id:session.workspace.id,name:session.workspace.name,detail:session.current.roles.map(roleLabel).join(' · ')});
  return<PortalSwitcher label="Trocar workspace" portals={choices} value={session.workspace.id}
    onChange={id=>{
      if(id===session.workspace.id)return;
      const selected=data?.items.find(item=>item.workspace.id===id);if(!selected)return;
      const href=workspaceAccessHref(selected);if(!requestLeave(href))return;
      void prepare().then(allowed=>{if(!allowed)return;if(data?.account&&selected.enterable!==false)rememberWorkspace(data.account.id,{workspaceId:selected.workspace.id,slug:selected.workspace.slug});window.location.assign(href);});
    }}
    action={{label:data?.administrative?'Gerenciar workspaces':'Ver todos os workspaces',onSelect:()=>{const href=data?.administrative?'/platform/workspaces':'/workspaces';if(requestLeave(href))void prepare().then(allowed=>{if(allowed)window.location.assign(href);});}}}/>;
}
