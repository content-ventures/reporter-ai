'use client';
import {useState} from 'react';
import {Alert,Badge,Button,DescriptionList,Drawer,ErrorState,Field,PageStack,Select,SkeletonText,toast} from '@content-ventures/design-system/v3';
import type {WorkspaceActivation,WorkspaceRollout} from '@/domain/workspace-management';
import type {WorkspaceAdministration} from '@/ports/workspace-management';
import {useAdministrationQuery} from '@/state';
import {useWorkspaceForm} from './workspace-form-guard';

const LABELS:Record<WorkspaceRollout,string>={off:'Pausada',admin:'Administração da plataforma',all:'Equipes dos clientes'};
type Draft={mode:WorkspaceRollout;original:WorkspaceRollout;revision:number};
export function WorkspaceActivationDrawer({port,onClose}:{port:WorkspaceAdministration;onClose:()=>void}){
  const query=useAdministrationQuery(port,'workspace-activation',admin=>admin.activation());
  const [confirmed,setConfirmed]=useState<WorkspaceActivation>(),[draft,setDraft]=useState<Draft>(),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
  const policy=confirmed&&(!query.data||confirmed.revision>query.data.revision)?confirmed:query.data;
  const dirty=Boolean(draft&&draft.mode!==draft.original);
  useWorkspaceForm(dirty,busy);
  async function save(){
    if(!draft||!dirty||busy)return;setBusy(true);setError(undefined);
    const result=await port.setActivation({mode:draft.mode,revision:draft.revision});setBusy(false);
    if(!result.ok){setError(result.refusal.code==='conflict'?'A disponibilidade mudou em outra sessão. Recarregue antes de salvar.':result.refusal.message);return;}
    setConfirmed(result.value);setDraft(undefined);toast('Disponibilidade atualizada',{description:LABELS[result.value.effective]});
  }
  async function reload(){
    setBusy(true);const result=await port.activation();setBusy(false);
    if(!result.ok){setError(result.refusal.message);return;}setConfirmed(result.value);setDraft(undefined);setError(undefined);query.retry();
  }
  return<Drawer open onClose={onClose} dismissible={!busy&&!dirty} title="Navegação dos workspaces"
    footer={<><Button disabled={busy} onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} disabled={!dirty||query.refreshing} onClick={()=>void save()}>Salvar disponibilidade</Button></>}>
    <PageStack>
      {!policy?query.error?<ErrorState title="Disponibilidade indisponível" description={query.error.message} onRetry={query.retry}/>:<SkeletonText lines={3}/>:<>
        <DescriptionList items={[{label:'Disponível para',value:<Badge tone={policy.effective==='all'?'green':'gray'}>{LABELS[policy.effective]}</Badge>}]}/>
        <Field label="Disponibilidade da navegação" hint="Os vínculos de cada cliente continuam definindo as permissões de acesso.">{props=><Select {...props} value={draft?.mode??policy.mode} disabled={busy||query.refreshing}
          options={(['admin','all','off']as const).map(value=>({value,label:LABELS[value]}))} onChange={mode=>{setError(undefined);setDraft(current=>({mode:mode as WorkspaceRollout,original:current?.original??policy.mode,revision:current?.revision??policy.revision}));}}/>}</Field>
        {policy.mode!==policy.effective?<Alert tone="warning" title="Liberação limitada neste ambiente">A disponibilidade aplicada é: {LABELS[policy.effective]}.</Alert>:null}
        <Button size="sm" disabled={busy} onClick={()=>void reload()}>Recarregar disponibilidade</Button>
      </>}
      {error?<Alert tone="danger" title="Não foi possível alterar a disponibilidade">{error}</Alert>:null}
    </PageStack>
  </Drawer>;
}
