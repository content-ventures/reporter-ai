'use client';
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Combobox,Field,List,ListItem,PageStack} from '@content-ventures/design-system/v3';
import type {PlatformPerson} from '@/domain/platform';
import type {WorkspaceMembership} from '@/domain/workspace-management';
import {usePlatformMemberViewing} from '@/state';

const canEnter=(link:WorkspaceMembership)=>link.status==='active'&&(link.workspace.status==='active'||link.workspace.status==='draft'&&link.roles.includes('admin'));
/** These links filter the real operator's consultation; only the final action starts a member view. */
export function PersonWorkspaceInspection({person,active}:{person:PlatformPerson;active:boolean}){
  const port=usePlatformMemberViewing(),memberships=person.memberships??[];
  const [workspace,setWorkspace]=useState(()=>memberships.find(canEnter)?.workspace.id??memberships[0]?.workspace.id??'');
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),live=useRef(active),pending=useRef(false);
  useEffect(()=>{live.current=active;return()=>{live.current=false;};},[active]);
  if(!port||!memberships.length)return null;
  const selected=memberships.find(link=>link.workspace.id===workspace),filter=new URLSearchParams({workspace,person:person.id}).toString();
  const enterable=Boolean(selected&&canEnter(selected)&&person.accountStatus!=='suspended');
  async function preview(){
    if(!selected||!port||!enterable||pending.current)return;
    pending.current=true;setBusy(true);setError(undefined);
    const result=await port.start(selected.workspace.id,person.id);
    if(!live.current){if(result.ok)void port.end(result.value.id);return;}
    if(!result.ok){pending.current=false;setBusy(false);setError(result.refusal.message);return;}
    // A new effective identity starts a fresh document, disposing the operator's private runtime.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/w/${encodeURIComponent(result.value.workspace.slug)}/?view=${encodeURIComponent(result.value.id)}`);
  }
  return<PageStack>
    <Field label="Workspace da consulta">{props=><Combobox {...props} value={workspace} disabled={busy} onChange={value=>{setWorkspace(value);setError(undefined);}}
      options={memberships.map(link=>({value:link.workspace.id,label:link.workspace.name}))}/>}</Field>
    <List label="Consultas desta pessoa" framed={false}>
      {selected&&(selected.workspace.status==='active'||selected.workspace.status==='draft')?<ListItem title="Produções desta pessoa" href={`/w/${encodeURIComponent(selected.workspace.slug)}/productions?owner=${encodeURIComponent(person.id)}`}/>:null}
      <ListItem title="Uso desta pessoa" href={`/platform/usage?${filter}`}/>
      <ListItem title="Atividade desta pessoa" href={`/platform/log?${filter}`}/>
    </List>
    <Button loading={busy} disabled={!enterable} onClick={()=>void preview()}>Visualizar como usuário</Button>
    {error?<Alert tone="danger" title="Não foi possível abrir a visualização">{error}</Alert>:null}
  </PageStack>;
}
