'use client';
import {useState} from 'react';
import {Avatar,Badge,Button,Dialog,EmptyState,ErrorState,List,ListItem,PageStack,Pagination,SearchField,SkeletonText} from '@content-ventures/design-system/v3';
import type {WorkspaceDirectory} from '@/ports/workspace-management';
import type {WorkspaceAccess} from '@/domain/workspace-management';
import {roleLabel} from '@/domain/permissions';
import {useWorkspaceDirectoryQuery} from '@/state/workspaces';
/** The full directory stays searchable and bounded instead of overflowing the quick menu. */
export function WorkspacePicker({open,port,currentId,administrative,onClose,onChoose,onManage}:{open:boolean;port:WorkspaceDirectory;currentId:string;administrative:boolean;onClose:()=>void;onChoose:(item:WorkspaceAccess)=>void;onManage:()=>void}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),query=useWorkspaceDirectoryQuery(open?port:undefined,{search,limit:20,offset:(page-1)*20}),data=query.data;
  return<Dialog open={open} onClose={onClose} title="Trocar workspace" footer={<Button onClick={onClose}>Cancelar</Button>} footerStart={administrative?<Button onClick={onManage}>Gerenciar workspaces</Button>:undefined}>
    <PageStack>
      <SearchField label="Buscar workspace" placeholder="Cliente ou endereço" value={search} onValueChange={value=>{setSearch(value);setPage(1);}}/>
      {query.error?<ErrorState title="Workspaces indisponíveis" description={query.error.message} onRetry={query.retry}/>:query.loading?<SkeletonText lines={3}/>:<List label="Workspaces disponíveis" empty={<EmptyState title="Nenhum workspace encontrado"/>}>
        {data?.items.map(item=>{const status=item.workspace.id===currentId?'Atual':item.enterable===false?'Consultar cadastro':item.workspace.status==='draft'?'Em configuração':undefined;return <ListItem key={item.workspace.id} leading={<Avatar name={item.workspace.name}/>} title={item.workspace.name}
          description={item.administrative?'Administração da plataforma':item.roles.map(roleLabel).join(' · ')} disabled={item.enterable===false&&!item.administrative} onClick={()=>onChoose(item)}
          trailing={status?<Badge tone="gray" variant="text">{status}</Badge>:undefined}/>;})}</List>}
      {data&&data.total>20?<Pagination page={page} pageSize={20} total={data.total} noun="workspaces" onPageChange={setPage}/>:null}
    </PageStack>
  </Dialog>;
}
