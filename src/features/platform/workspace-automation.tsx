'use client';
import {useState} from 'react';
import {Alert,Button,Checkbox,Combobox,ConfirmDialog,CopyButton,DescriptionList,Field,Input,PageStack,Section,SkeletonText} from '@content-ventures/design-system/v3';
import type {WorkspaceAdministration} from '@/ports/workspace-management';
import type {IssuedIntegration,WorkspaceIntegration,WorkspaceProcessing} from '@/domain/workspace-management';
import {useAdministrationQuery} from '@/state';
import {inputProps} from './field-props';

export function WorkspaceAutomation({port,workspaceId}:{port:WorkspaceAdministration;workspaceId:string}){
  const processing=useAdministrationQuery(port,`processing:${workspaceId}`,admin=>admin.processing(workspaceId));
  const integrations=useAdministrationQuery(port,`integrations:${workspaceId}`,admin=>admin.integrations(workspaceId));
  return<>
    {processing.data?<ProcessingForm key={workspaceId} port={port} initial={processing.data}/>:<Section title="Processamento" titleAs="h2" variant="panel">{processing.error?<Alert tone="danger" title={processing.error.message} action={<Button onClick={processing.retry}>Tentar novamente</Button>}/>:<SkeletonText lines={2}/>}</Section>}
    {integrations.data?<DriveForm key={workspaceId} port={port} workspaceId={workspaceId} initial={integrations.data[0]}/>:<Section title="Entrada pelo Drive" titleAs="h2" variant="panel">{integrations.error?<Alert tone="danger" title={integrations.error.message} action={<Button onClick={integrations.retry}>Tentar novamente</Button>}/>:<SkeletonText lines={2}/>}</Section>}
  </>;
}
function ProcessingForm({port,initial}:{port:WorkspaceAdministration;initial:WorkspaceProcessing}){
  const [base,setBase]=useState(initial),[limit,setLimit]=useState(initial.dailyLimit===null?'':String(initial.dailyLimit)),[busy,setBusy]=useState(false),[message,setMessage]=useState<{error:boolean;text:string}>();
  async function save(){setBusy(true);const saved=await port.setProcessing({workspaceId:base.workspaceId,revision:base.revision,dailyLimit:limit===''?null:Number(limit)});setBusy(false);
    if(saved.ok)setBase(saved.value);setMessage({error:!saved.ok,text:saved.ok?'Limite atualizado.':saved.refusal.message});}
  async function reload(){setBusy(true);const latest=await port.processing(base.workspaceId);setBusy(false);if(latest.ok){setBase(latest.value);setLimit(latest.value.dailyLimit===null?'':String(latest.value.dailyLimit));setMessage(undefined);}else setMessage({error:true,text:latest.refusal.message});}
  return<Section title="Processamento automático" titleAs="h2" variant="panel" action={<Button size="sm" disabled={busy} onClick={()=>void reload()}>Recarregar limite</Button>}>
    <PageStack><DescriptionList items={[{label:'Operações usadas hoje · UTC',value:initial.usedToday},{label:'Situação',value:initial.state==='limited'?'Limite atingido':'Disponível'}]}/>
      <Field label="Limite diário de operações" hint="Vazio significa sem teto por cliente. Este limite não representa cobrança dos provedores.">{props=><Input {...inputProps(props)} type="number" min={1} max={10000} value={limit} onChange={event=>setLimit(event.target.value)} disabled={busy}/>}</Field>
      {message?<Alert tone={message.error?'danger':'success'} title={message.text}/>:null}
      <Button variant="primary" loading={busy} disabled={limit!==''&&(!Number.isInteger(Number(limit))||Number(limit)<1||Number(limit)>10000)} onClick={()=>void save()}>Salvar limite</Button>
    </PageStack>
  </Section>;
}
function DriveForm({port,workspaceId,initial}:{port:WorkspaceAdministration;workspaceId:string;initial?:WorkspaceIntegration}){
  const [base,setBase]=useState(initial),[owner,setOwner]=useState(initial?.ownerId??''),[enabled,setEnabled]=useState(initial?.enabled??true),[search,setSearch]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),[issued,setIssued]=useState<IssuedIntegration['credential']>(),[rotate,setRotate]=useState(false);
  const team=useAdministrationQuery(port,`drive-team:${workspaceId}:${search}`,admin=>admin.members(workspaceId,{search,limit:50}));
  const selected=useAdministrationQuery(port,`drive-owner:${workspaceId}:${owner}`,admin=>admin.members(workspaceId,{search:owner||'__none__',limit:1}));
  const editors=[...(selected.data?.items??[]),...(team.data?.items??[])].filter((member,index,all)=>all.findIndex(item=>item.id===member.id)===index&&member.status==='active'&&!member.accountSuspended&&member.roles.some(role=>role==='editor'||role==='admin'));
  async function save(rotating=false){setBusy(true);setError(undefined);const saved=await port.saveIntegration({workspaceId,ownerId:owner,enabled,revision:base?.revision??0,...(rotating?{rotate:true}:{})});setBusy(false);setRotate(false);
    if(saved.ok){setBase(saved.value);setIssued(saved.value.credential);}else setError(saved.refusal.message);}
  async function reload(){setBusy(true);const latest=await port.integrations(workspaceId);setBusy(false);if(latest.ok){const record=latest.value[0];setBase(record);setOwner(record?.ownerId??'');setEnabled(record?.enabled??true);setError(undefined);setIssued(undefined);}else setError(latest.refusal.message);}
  return<Section title="Entrada pelo Drive" titleAs="h2" variant="panel" action={<Button size="sm" disabled={busy} onClick={()=>void reload()}>Recarregar integração</Button>}>
    <PageStack>
      <Field label="Responsável pelos materiais">{props=><Combobox {...props} value={owner} options={editors.map(member=>({value:member.personId,label:member.name,description:member.email}))} onChange={setOwner} onQuery={setSearch} loading={team.loading} disabled={busy} emptyText="Ative um editor na equipe para receber os materiais."/>}</Field>
      <Checkbox label="Receber materiais deste cliente" checked={enabled} disabled={busy} onChange={event=>setEnabled(event.target.checked)}/>
      {base?<DescriptionList items={[{label:'Último recebimento',value:base.lastUsedAt?new Date(base.lastUsedAt).toLocaleString('pt-BR'):'Sem recebimentos'}]}/>:null}
      {issued?<>
        <Alert tone="warning" title="Copie a credencial agora">Ela aparece somente nesta resposta. Guarde-a na integração deste cliente.</Alert>
        <Field label="Endpoint do Drive">{props=><Input {...inputProps(props)} value={issued.endpoint} readOnly trailing={<CopyButton text={issued.endpoint} label="endpoint do Drive"/>}/>}</Field>
        <Field label="Credencial do Drive">{props=><Input {...inputProps(props)} value={issued.token} readOnly trailing={<CopyButton text={issued.token} label="credencial do Drive"/>}/>}</Field>
        <Button size="sm" onClick={()=>setIssued(undefined)}>Ocultar credencial</Button>
      </>:null}
      {error?<Alert tone="danger" title="Não foi possível configurar">{error}</Alert>:null}
      <Button variant="primary" loading={busy} disabled={!owner} onClick={()=>void save()}>{base?'Salvar integração':'Criar integração'}</Button>
      {base?<Button disabled={busy||!owner} onClick={()=>setRotate(true)}>Trocar credencial</Button>:null}
    </PageStack>
    <ConfirmDialog open={rotate} onClose={()=>setRotate(false)} title="Trocar credencial do Drive?" description="A credencial anterior deixa de funcionar imediatamente. Atualize a integração deste cliente com a nova." confirmLabel="Trocar credencial" onConfirm={()=>void save(true)}/>
  </Section>;
}
