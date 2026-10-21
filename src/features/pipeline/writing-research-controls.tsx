'use client';

import { Alert, DescriptionList, Field, FieldGroup, NumberField, PageStack, Panel, Section, Select, SwitchRow, Textarea } from '@content-ventures/design-system/v3';
import type { WritingResearchSettings } from '@/domain/writing-research';

/** Optional web context is managed separately from model selection and original evidence. */
export function WritingResearchControls({ settings, configured, referenceUrls, saving, onChange }: {
  settings: WritingResearchSettings; configured?: boolean; referenceUrls: readonly string[]; saving: boolean;
  onChange: (settings: WritingResearchSettings) => void;
}) {
  const patch = (value: Partial<WritingResearchSettings>) => onChange({ ...settings, ...value });
  return <Panel><Section title="Pesquisa de contexto na web">
    <PageStack>
      <DescriptionList items={[{ label: 'Tavily', value: configured === undefined ? 'Disponibilidade não informada pelo servidor' : configured ? 'Chave configurada no servidor' : 'Chave não configurada no servidor' }]} />
      {settings.enabled && configured === false && <Alert tone="warning" title="Configure a chave da Tavily antes de pesquisar">Você pode salvar as orientações. A geração aplicará a opção escolhida para falha da pesquisa enquanto a chave estiver ausente.</Alert>}
      <SwitchRow label="Pesquisar contexto com Tavily" checked={settings.enabled} disabled={saving}
        description="O planejamento propõe consultas a partir do conteúdo. Os resultados entram depois, como fontes externas identificadas."
        onCheckedChange={enabled => patch({ enabled })} />
      <Field label="Orientações para a pesquisa" hint="Defina o contexto útil e as fontes preferidas. As consultas de cada artigo ficam registradas na execução.">
        {props => <Textarea id={props.id} aria-describedby={props.describedBy} value={settings.instructions} rows={4} maxLength={4000} disabled={saving}
          onChange={event => patch({ instructions: event.target.value })} />}
      </Field>
      <FieldGroup label="Limites da pesquisa" columns={2}>
        <Field label="Máximo de consultas por artigo">
          {props => <NumberField id={props.id} aria-describedby={props.describedBy} min={1} max={3} value={settings.maxQueries} disabled={saving}
            onChange={value => { if (value !== null) patch({ maxQueries: value }); }} />}
        </Field>
        <Field label="Resultados por consulta">
          {props => <NumberField id={props.id} aria-describedby={props.describedBy} min={1} max={5} value={settings.maxResults} disabled={saving}
            onChange={value => { if (value !== null) patch({ maxResults: value }); }} />}
        </Field>
        <Field label="Máximo de fontes externas por artigo">
          {props => <NumberField id={props.id} aria-describedby={props.describedBy} min={1} max={10} value={settings.maxSources} disabled={saving}
            onChange={value => { if (value !== null) patch({ maxSources: value }); }} />}
        </Field>
        <Field label="Tempo limite por consulta" hint="Em segundos.">
          {props => <NumberField id={props.id} aria-describedby={props.describedBy} min={5} max={30} value={settings.timeoutMs / 1000} disabled={saving}
            onChange={value => { if (value !== null) patch({ timeoutMs: value * 1000 }); }} />}
        </Field>
      </FieldGroup>
      <Field label="Se a pesquisa falhar">
        {props => <Select {...props} value={settings.failureMode} disabled={saving}
          options={[{ value: 'stop', label: 'Parar e analisar a falha' }, { value: 'continue_original', label: 'Continuar com o conteúdo original' }]}
          onChange={value => patch({ failureMode: value as WritingResearchSettings['failureMode'] })} />}
      </Field>
      <Field label="Domínios excluídos da pesquisa" hint="Um domínio por linha, sem https://.">
        {props => <Textarea id={props.id} aria-describedby={props.describedBy} rows={3} value={settings.excludeDomains.join('\n')} disabled={saving}
          onChange={event => patch({ excludeDomains: event.target.value.split('\n') })}
          onBlur={event => patch({ excludeDomains: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) })} />}
      </Field>
      <Field label="URLs excluídas da pesquisa" hint="Um endereço completo por linha.">
        {props => <Textarea id={props.id} aria-describedby={props.describedBy} rows={3} value={settings.excludeUrls.join('\n')} disabled={saving}
          onChange={event => patch({ excludeUrls: event.target.value.split('\n') })}
          onBlur={event => patch({ excludeUrls: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) })} />}
      </Field>
      {referenceUrls.length > 0 && <DescriptionList items={[{ label: 'Referências do guia excluídas automaticamente', value: referenceUrls.join('\n') }]} />}
    </PageStack>
  </Section></Panel>;
}
