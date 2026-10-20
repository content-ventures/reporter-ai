'use client';

import { useCallback } from 'react';
import { Accordion, Alert, Badge, Button, CopyButton, DescriptionList, Drawer, Field, FieldGroup, List, ListItem, NumberField, PageStack, Prose, ResponsiveDialog, Select, Textarea } from '@content-ventures/design-system/v3';
import { PIPELINE_MODELS, PIPELINE_SCHEMAS, PIPELINE_VARIABLES, pipelineModelLabel, pipelineModelProvider, pipelineModelReasons, pipelineTokenLimit } from '@/domain/pipeline';
import type { PipelineDefinition, PipelineStep, PipelineView } from '@/domain/pipeline';
import { useMediaQuery } from '@/ui/use-media-query';
import { PROMPTS, funnelOf, promptInactive, promptStep, promptUsage, type PromptKey } from './pipeline-catalog';

const VARIABLE_LABELS: Record<typeof PIPELINE_VARIABLES[number], string> = {
  source: 'Transcrição e evidências da fonte', brief: 'Pauta e quantidade de seções', sizing: 'Metas e limites de tamanho',
  outline: 'Estrutura do artigo', section: 'Seção atual ou pedido ao assistente', history: 'Texto já escrito',
  futureSections: 'Seções ainda não redigidas', layouts: 'Espaços e limites do modelo visual', approvedArticle: 'Versão aprovada do artigo',
  event: 'Evento digitado na pauta e data de hoje', people: 'Pessoas confirmadas: nome, cargo e empresa',
};

export function PipelineEditor({ promptKey, draft, view, saving, dirty, invalid, error, onClose, onUpdate, onUpdateStep, onSave }: {
  promptKey: PromptKey; draft: PipelineDefinition; view: PipelineView; saving: boolean; dirty: boolean; invalid: boolean; error?: string;
  onClose: () => void; onUpdate: (patch: Partial<PipelineDefinition>) => void;
  onUpdateStep: (patch: Partial<PipelineStep>) => void; onSave: () => void;
}) {
  const startAtTop = useCallback((element: HTMLTextAreaElement | null) => { element?.setSelectionRange(0, 0); }, []);
  const selected = promptStep(promptKey, draft);
  const schemaKey = funnelOf(promptKey)?.step ?? promptKey;
  const prompt = selected?.prompt ?? draft.systemPrompt;
  const used = new Set([...prompt.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(match => match[1]));
  const schema = promptKey === 'system' ? undefined : promptKey === 'carousel'
    ? 'O formato é definido pelo modelo de carrossel escolhido: cada slide recebe os campos e limites do layout, com referências ao artigo aprovado.'
    : JSON.stringify(PIPELINE_SCHEMAS[schemaKey as keyof typeof PIPELINE_SCHEMAS], null, 2);
  const narrow = useMediaQuery('(max-width: 640px)');
  const status = <Badge tone={dirty ? 'amber' : 'gray'}>{dirty ? 'Configuração com alterações' : `Revisão ${view.active.revision} ativa`}</Badge>;
  const footer = <><Button onClick={onClose}>Fechar edição</Button><Button variant="primary" loading={saving} disabled={!dirty || invalid} onClick={onSave}>Salvar e ativar tudo</Button></>;
  const content = (
    <PageStack>
      {narrow && status}
      {promptInactive(promptKey, draft) && <Alert tone="warning" title="Este prompt está fora do fluxo">
        Ele fica salvo, mas só será executado quando você habilitar esta etapa nas configurações do worker Gerar artigo.
      </Alert>}
      {error && <Alert tone="danger" title="Revise antes de salvar">{error}</Alert>}
      <Field label="Instruções do prompt" hint={promptKey === 'system'
        ? 'Regras compartilhadas. Este campo não aceita variáveis.'
        : 'Os termos entre {{chaves}} recebem os dados da produção automaticamente.'}>
        {props => <Textarea ref={startAtTop} id={props.id} aria-describedby={props.describedBy} rows={16} value={prompt} disabled={saving}
          maxLength={selected ? 20000 : 12000} onChange={event => selected ? onUpdateStep({ prompt: event.target.value }) : onUpdate({ systemPrompt: event.target.value })} />}
      </Field>
      {selected && <Field label="Modelo de IA" error={view.providers?.[pipelineModelProvider(selected.model)] === false ? 'Este provedor está sem chave configurada no servidor.' : undefined}>
        {props => <Select {...props} value={selected.model} disabled={saving} options={PIPELINE_MODELS.map(value => ({ value, label: pipelineModelLabel(value) }))}
          onChange={model => onUpdateStep({ model: model as PipelineStep['model'], temperature: Math.min(selected.temperature, pipelineModelProvider(model) === 'anthropic' ? 1 : 2) })} />}
      </Field>}
      <Accordion items={[
        ...(selected ? [{ id: 'variables', title: 'Dados disponíveis para este prompt', content: <List label="Variáveis do prompt" framed={false}>
          {PIPELINE_VARIABLES.map(key => <ListItem key={key} title={`{{${key}}}`} titleLines={2} description={`${used.has(key) ? 'Em uso · ' : ''}${VARIABLE_LABELS[key]}`} trailing={<CopyButton text={`{{${key}}}`} label={`{{${key}}}`} />} />)}
        </List> }] : []),
        ...(selected ? [{ id: 'settings', title: 'Ajustes avançados do modelo', content: <FieldGroup label="Geração" columns={1}>
          {pipelineModelReasons(selected.model) ? <DescriptionList items={[{ label: 'Raciocínio', value: 'Baixo · sem temperatura' }]} />
            : <Field label="Temperatura" hint="Valores menores tornam a resposta mais previsível.">{props => <NumberField id={props.id} aria-describedby={props.describedBy}
              value={selected.temperature} decimals={1} min={0} max={pipelineModelProvider(selected.model) === 'anthropic' ? 1 : 2} step={0.1} disabled={saving}
              onChange={value => { if (value !== null) onUpdateStep({ temperature: value }); }} />}</Field>}
          <Field label="Limite de tokens" hint={pipelineModelReasons(selected.model) ? 'Inclui raciocínio e texto produzido.' : 'Limite máximo de saída da IA; não é a quantidade de palavras do artigo.'}>
            {props => <NumberField id={props.id} aria-describedby={props.describedBy} value={selected.maxTokens} min={512} max={pipelineTokenLimit(selected.model)} step={256} disabled={saving}
              onChange={value => { if (value !== null) onUpdateStep({ maxTokens: value }); }} />}
          </Field>
        </FieldGroup> }] : []),
        ...(schema ? [{ id: 'schema', title: 'Formato de resposta exigido', content: <Field label="Contrato de saída">{props => <Textarea id={props.id} readOnly rows={8} value={schema} />}</Field> }] : []),
        { id: 'activation', title: 'Quando esta alteração será usada?', content: <Prose variant="compact" measure="wide">
          Salvar e ativar tudo cria uma revisão com todas as alterações desta página. Ela será usada nas próximas gerações; execuções em andamento mantêm a revisão original. Fechar o editor mantém as alterações na página, ainda sem ativar.
        </Prose> },
      ]} />
      <DescriptionList items={[{ label: 'Uso nesta configuração', value: promptUsage(promptKey, draft) }]} />
    </PageStack>
  );
  const common = { open: true, onClose, title: PROMPTS[promptKey].title, description: PROMPTS[promptKey].description, footer };
  return narrow ? <ResponsiveDialog {...common} snap="full">{content}</ResponsiveDialog>
    : <Drawer {...common} size="lg" footerStart={status}>{content}</Drawer>;
}
