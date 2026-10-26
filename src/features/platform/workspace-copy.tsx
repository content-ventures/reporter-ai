'use client';
import {useState} from 'react';
import {Accordion,Alert,Button,Checkbox,CheckboxGroup,Combobox,DescriptionList,Drawer,Field,PageStack,Textarea} from '@content-ventures/design-system/v3';
import type {WorkspaceAdministration} from '@/ports/workspace-management';
import type {ManagedWorkspace} from '@/domain/workspace-management';
import {CONFIGURATION_COPY_FIELDS,type ConfigurationCopyField,type ConfigurationCopyPreview} from '@/domain/configuration-copy';
import {useAdministrationQuery} from '@/state';
import {inputProps} from './field-props';

const LABELS:Record<ConfigurationCopyField,string>={editorial_map:'Mapa editorial',writing_guide:'Guia de escrita',prompts:'Prompts',templates:'Composições e fonte dos modelos'};
export function WorkspaceCopy({port,target,onClose}:{port:WorkspaceAdministration;target:ManagedWorkspace;onClose:()=>void}){
  const [search,setSearch]=useState(''),[source,setSource]=useState(''),[fields,setFields]=useState<ConfigurationCopyField[]>(['editorial_map','writing_guide']);
  const [preview,setPreview]=useState<ConfigurationCopyPreview>(),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
  const sources=useAdministrationQuery(port,`copy-sources:${search}`,admin=>admin.list({search,limit:50}));
  async function inspect(){setBusy(true);setError(undefined);const plan=await port.previewCopy({sourceId:source,targetId:target.id,fields});setBusy(false);if(plan.ok)setPreview(plan.value);else setError(plan.refusal.message);}
  async function apply(){if(!preview)return;setBusy(true);setError(undefined);const saved=await port.applyCopy(preview.token);setBusy(false);if(saved.ok)onClose();else{setError(saved.refusal.message);setPreview(undefined);}}
  return<Drawer open onClose={onClose} dismissible={!busy} title={`Copiar configuração para ${target.name}`} footer={preview?<Button variant="primary" loading={busy} onClick={()=>void apply()}>Aplicar cópia revisada</Button>:<Button variant="primary" loading={busy} disabled={!source||!fields.length} onClick={()=>void inspect()}>Revisar alterações</Button>}>
    <PageStack>
      <Field label="Workspace de origem">{props=><Combobox {...props} value={source} disabled={busy} onChange={value=>{setSource(value);setPreview(undefined);}} onQuery={setSearch} loading={sources.loading}
        options={(sources.data?.items??[]).filter(workspace=>workspace.id!==target.id).map(workspace=>({value:workspace.id,label:workspace.name}))}/>}</Field>
      <CheckboxGroup legend="Configurações a copiar">{CONFIGURATION_COPY_FIELDS.map(field=><Checkbox key={field} label={LABELS[field]} checked={fields.includes(field)} disabled={busy} onChange={event=>{
        setFields(CONFIGURATION_COPY_FIELDS.filter(value=>value===field?event.target.checked:fields.includes(value)));setPreview(undefined);
      }}/>)}</CheckboxGroup>
      <Alert tone="info" title="A identidade do destino é preservada">Marca e nome do veículo continuam pertencendo a {target.name}. Pessoas, produções, aprovações e credenciais ficam fora da cópia.</Alert>
      {preview?<>
        <DescriptionList items={[{label:'Origem',value:preview.source.name},{label:'Destino',value:preview.target.name},{label:'Prévia válida até',value:new Date(preview.expiresAt).toLocaleTimeString('pt-BR')}]}/>
        <Accordion items={preview.changes.map(change=>({id:change.field,title:LABELS[change.field],content:<PageStack>
          <Field label="Configuração atual">{props=><Textarea {...inputProps(props)} value={JSON.stringify(change.before,null,2)} rows={8} readOnly/>}</Field>
          <Field label="Configuração proposta">{props=><Textarea {...inputProps(props)} value={JSON.stringify(change.after,null,2)} rows={8} readOnly/>}</Field>
        </PageStack>}))}/>
      </>:null}
      {error?<Alert tone="danger" title="Não foi possível copiar">{error}</Alert>:null}
    </PageStack>
  </Drawer>;
}
