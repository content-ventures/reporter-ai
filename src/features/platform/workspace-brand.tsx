'use client';
import {useState} from 'react';
import {Alert,Button,Checkbox,CheckboxGroup,Dropzone,ErrorState,Field,Input,PageStack,Section,Select,SkeletonText} from '@content-ventures/design-system/v3';
import type {WorkspaceAdministration} from '@/ports/workspace-management';
import {WORKSPACE_TEMPLATE_FONTS,WORKSPACE_TEMPLATE_PRESETS,type WorkspaceTemplateConfiguration,type WorkspaceTemplateInput} from '@/domain/workspace-templates';
import {useAdministrationQuery} from '@/state';
import {useWorkspaceForm} from './workspace-form-guard';
import {inputProps} from './field-props';

const PRESETS={editorial:'Editorial',photo:'Fotografia',night:'Escuro',paper:'Pauta',minimal:'Minimalista'};
export function WorkspaceBrand({port,workspaceId,name}:{port:WorkspaceAdministration;workspaceId:string;name:string}){
  const query=useAdministrationQuery(port,`templates:${workspaceId}`,admin=>admin.templates(workspaceId));
  if(query.error)return<ErrorState title="Modelos indisponíveis" description={query.error.message} onRetry={query.retry}/>;
  return query.data?<BrandForm key={workspaceId} port={port} initial={query.data} name={name} reload={query.retry}/>:<SkeletonText lines={4}/>;
}
function BrandForm({port,initial,name,reload}:{port:WorkspaceAdministration;initial:WorkspaceTemplateConfiguration;name:string;reload:()=>void}){
  const [base,setBase]=useState(initial),[draft,setDraft]=useState<WorkspaceTemplateInput>(initial.active?.config??{publication:name,presets:['editorial'],defaultPreset:'editorial',font:'Inter'});
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),[notice,setNotice]=useState<string>();
  useWorkspaceForm(JSON.stringify(draft)!==JSON.stringify(base.active?.config??{publication:name,presets:['editorial'],defaultPreset:'editorial',font:'Inter'}),busy);
  async function restoreLatest(){setBusy(true);const latest=await port.templates(base.workspaceId);setBusy(false);setNotice(undefined);
    if(!latest.ok){setError(latest.refusal.message);return;}setBase(latest.value);setDraft(latest.value.active?.config??{publication:name,presets:['editorial'],defaultPreset:'editorial',font:'Inter'});setError(undefined);reload();}
  async function save(){
    setBusy(true);setError(undefined);setNotice(undefined);
    const saved=await port.saveTemplates({workspaceId:base.workspaceId,revision:base.revision,config:draft});setBusy(false);
    if(!saved.ok){setError(saved.refusal.message);return;}setBase(saved.value);setDraft(saved.value.active!.config);setNotice('Modelos e marca ativados para as próximas produções.');
  }
  async function upload(file:File){
    setBusy(true);setError(undefined);setNotice(undefined);const uploaded=await port.uploadLogo(base.workspaceId,file);setBusy(false);
    if(uploaded.ok){setDraft(value=>({...value,logoId:uploaded.value.id}));setNotice('Marca enviada. Salve os modelos para ativá-la.');}else setError(uploaded.refusal.message);
  }
  return<Section title="Modelos e marca" titleAs="h2" variant="panel" action={<Button size="sm" disabled={busy} onClick={()=>void restoreLatest()}>Recarregar configuração</Button>}>
    <PageStack>
      {base.pilot&&!base.active?<Alert tone="info" title="Catálogo atual preservado">Salvar uma nova identidade altera as opções futuras. Produções antigas mantêm seus modelos.</Alert>:null}
      <Field label="Nome do veículo">{props=><Input {...inputProps(props)} value={draft.publication} maxLength={80} disabled={busy} onChange={event=>setDraft({...draft,publication:event.target.value})}/>}</Field>
      <CheckboxGroup legend="Modelos disponíveis">{WORKSPACE_TEMPLATE_PRESETS.map(preset=><Checkbox key={preset} label={PRESETS[preset]} checked={draft.presets.includes(preset)} disabled={busy} onChange={event=>{
        const presets=WORKSPACE_TEMPLATE_PRESETS.filter(value=>value===preset?event.target.checked:draft.presets.includes(value));
        setDraft({...draft,presets,defaultPreset:presets.includes(draft.defaultPreset)?draft.defaultPreset:presets[0]??'editorial'});
      }}/>)}</CheckboxGroup>
      <Field label="Modelo padrão">{props=><Select {...props} disabled={busy} value={draft.defaultPreset} options={draft.presets.map(value=>({value,label:PRESETS[value]}))} onChange={value=>setDraft({...draft,defaultPreset:value as WorkspaceTemplateInput['defaultPreset']})}/>}</Field>
      <Field label="Fonte">{props=><Select {...props} disabled={busy} value={draft.font} options={WORKSPACE_TEMPLATE_FONTS.map(value=>({value,label:value}))} onChange={value=>setDraft({...draft,font:value as WorkspaceTemplateInput['font']})}/>}</Field>
      <Dropzone title="Enviar marca do cliente" accept="image/png,image/jpeg,image/webp" maxSize={2*1024**2} spec="PNG, JPEG ou WebP · até 2 MB" disabled={busy} onFiles={(files,rejected)=>{
        if(rejected.length){setError('Envie PNG, JPEG ou WebP de até 2 MB.');return;}if(files[0])void upload(files[0]);
      }}/>
      {draft.logoId?<Button size="sm" disabled={busy} onClick={()=>{const {logoId:_,...rest}=draft;void _;setDraft(rest);setNotice('Salve os modelos para remover a marca.');}}>Remover marca selecionada</Button>:null}
      {error?<Alert tone="danger" title="Não foi possível salvar">{error}</Alert>:null}
      {notice?<Alert tone="success" title={notice}/>:null}
      <Button variant="primary" loading={busy} disabled={!draft.presets.length||draft.publication.trim().length<2} onClick={()=>void save()}>Salvar modelos e marca</Button>
    </PageStack>
  </Section>;
}
