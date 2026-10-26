'use client';
import {useState} from 'react';
import {Combobox,Field,FieldGroup} from '@content-ventures/design-system/v3';
import type {PlatformFilter} from '@/ports/platform';
import {useAdministrationQuery,usePlatformAdministration,usePlatformDirectory} from '@/state';

/** These are report filters; they never change the signed-in account or editorial context. */
export function PlatformFilters({value,onChange}:{value:PlatformFilter;onChange:(next:PlatformFilter)=>void}){
  const admin=usePlatformAdministration(),[workspaceSearch,setWorkspaceSearch]=useState(''),[personSearch,setPersonSearch]=useState('');
  const workspaces=useAdministrationQuery(admin,`filter-workspaces:${workspaceSearch}`,port=>port.list({search:workspaceSearch,limit:50}));
  const selected=useAdministrationQuery(value.workspaceId?admin:undefined,`filter-workspace:${value.workspaceId}`,port=>port.get(value.workspaceId!));
  const people=usePlatformDirectory({search:personSearch,workspaceId:value.workspaceId,limit:50});
  const person=usePlatformDirectory(value.personId?{personId:value.personId,limit:1}:{limit:1});
  const choices=[...(selected.data?[selected.data]:[]),...(workspaces.data?.items??[])].filter((entry,index,all)=>all.findIndex(item=>item.id===entry.id)===index);
  const members=[...(value.personId?person.data?.people??[]:[]),...(people.data?.people??[])].filter((entry,index,all)=>!entry.id.startsWith('auth:')&&all.findIndex(item=>item.id===entry.id)===index);
  return<FieldGroup label="Filtros do relatório" columns={2}>
    <Field label="Filtrar por workspace">{props=><Combobox {...props} value={value.workspaceId??''} options={[{value:'',label:'Todos os workspaces'},...choices.map(workspace=>({value:workspace.id,label:workspace.name}))]}
      onChange={workspaceId=>onChange({...value,workspaceId:workspaceId||undefined})} onQuery={setWorkspaceSearch} loading={workspaces.loading}/>}</Field>
    <Field label="Filtrar por pessoa">{props=><Combobox {...props} value={value.personId??''} options={[{value:'',label:'Todas as pessoas'},...members.map(member=>({value:member.id,label:member.name,description:member.email}))]}
      onChange={personId=>onChange({...value,personId:personId||undefined})} onQuery={setPersonSearch} loading={people.status==='loading'}/>}</Field>
  </FieldGroup>;
}
