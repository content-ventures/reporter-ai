'use client';
import { useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, DescriptionList, Field, FieldGroup, Input, MetaList, Meter, NumberField, PageHeader, PageStack, Panel, Prose, Section, SplitLayout, Tabs, TagInput, Textarea, toast } from '@content-ventures/design-system/v3';
import { Save } from '@content-ventures/design-system/v3/icons';
import { usePrototype } from './prototype-state';

export function EditorialSettings({ kind }: { kind: 'editorial-map' | 'writing-guide' }) {
  const { map, setMap, guide, setGuide } = usePrototype();
  const [draftMap, updateMap] = useState(map);
  const [draftGuide, updateGuide] = useState(guide);
  const isMap = kind === 'editorial-map';
  const [tab, setTab] = useState<'focus' | 'rules'>('focus');
  const dirty = JSON.stringify(isMap ? draftMap : draftGuide) !== JSON.stringify(isMap ? map : guide);
  const total = draftMap.relevance + draftMap.impact + draftMap.freshness;
  const invalid = isMap ? total !== 100 || !draftMap.topics.length || !draftMap.audience.trim() : !draftGuide.tone.trim() || !draftGuide.attribution.trim();
  const save = () => { if (isMap) setMap(draftMap); else setGuide(draftGuide); toast('Configuração salva nesta sessão do protótipo'); };
  return <PageStack>
    <PageHeader title={isMap ? 'Mapa editorial' : 'Guia de escrita'} status={<Badge tone={dirty ? 'amber' : 'gray'}>{dirty ? 'Alterações não salvas' : 'Versão de demonstração'}</Badge>}
      actions={<ButtonGroup label="Configuração editorial"><Button disabled={!dirty} onClick={() => { updateMap(map); updateGuide(guide); }}>Descartar alterações</Button><Button variant="primary" icon={Save} disabled={!dirty || invalid} onClick={save}>Salvar configuração</Button></ButtonGroup>} />
    <Tabs label="Configuração editorial" value={tab} onChange={setTab} items={isMap
      ? [{ value: 'focus', label: 'Cobertura' }, { value: 'rules', label: 'Priorização' }]
      : [{ value: 'focus', label: 'Voz e abertura' }, { value: 'rules', label: 'Fontes e linguagem' }]} />
    <SplitLayout main={<PageStack>
      {isMap ? <>
        {tab === 'focus' && <Panel><Section title="Foco do veículo"><FieldGroup label="Cobertura editorial" columns={1}>
          <Field label="Para quem escrevemos">{props => <Textarea id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} rows={3} value={draftMap.audience} onChange={event => updateMap({ ...draftMap, audience: event.target.value })} />}</Field>
          <Field label="Abrangência geográfica">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={draftMap.geography} onChange={event => updateMap({ ...draftMap, geography: event.target.value })} />}</Field>
          <Field label="Editorias e temas prioritários">{props => <TagInput {...props} label="Editorias e temas prioritários" values={draftMap.topics} onChange={topics => updateMap({ ...draftMap, topics })} />}</Field>
          <Field label="Fora da cobertura">{props => <TagInput {...props} label="Fora da cobertura" values={draftMap.exclusions} onChange={exclusions => updateMap({ ...draftMap, exclusions })} />}</Field>
        </FieldGroup></Section></Panel>}
        {tab === 'rules' && <Panel><Section title="Critérios de relevância" meta={`${total}/100 pontos`}><PageStack>
          <FieldGroup label="Pesos da classificação" columns={3}>
            {([{ key: 'relevance', label: 'Aderência ao veículo' }, { key: 'impact', label: 'Impacto para o leitor' }, { key: 'freshness', label: 'Atualidade' }] as const).map(item => <Field key={item.key} label={item.label}>{props => <NumberField id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={draftMap[item.key]} min={0} max={100} onChange={value => updateMap({ ...draftMap, [item.key]: value ?? 0 })} />}</Field>)}
          </FieldGroup>
          {total !== 100 && <Alert tone="warning" title="A soma precisa ser 100">Ajuste os pesos para salvar o mapa.</Alert>}
        </PageStack></Section></Panel>}
      </> : <>
        <Panel><Section title={tab === 'focus' ? 'Voz e estrutura' : 'Fontes e linguagem'}><FieldGroup label="Guia editorial" columns={1}>
          {tab === 'focus' && <>
          <Field label="Tom de voz">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={draftGuide.tone} onChange={event => updateGuide({ ...draftGuide, tone: event.target.value })} />}</Field>
          <Field label="Como abrir a notícia">{props => <Textarea id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} rows={4} value={draftGuide.lead} onChange={event => updateGuide({ ...draftGuide, lead: event.target.value })} />}</Field>
          </>}
          {tab === 'rules' && <>
          <Field label="Evidências e atribuição">{props => <Textarea id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} rows={4} value={draftGuide.attribution} onChange={event => updateGuide({ ...draftGuide, attribution: event.target.value })} />}</Field>
          <Field label="Expressões a evitar">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={draftGuide.avoid} onChange={event => updateGuide({ ...draftGuide, avoid: event.target.value })} />}</Field>
          </>}
        </FieldGroup></Section></Panel>
        {tab === 'focus' && <Panel><Section title="Exemplo aprovado"><Field label="Texto de referência">{props => <Textarea id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} rows={4} value={draftGuide.example} onChange={event => updateGuide({ ...draftGuide, example: event.target.value })} />}</Field></Section></Panel>}
      </>}
    </PageStack>} asideLabel="Prévia editorial" aside={<PageStack>
      <Panel><Section title={isMap ? 'Identidade da cobertura' : 'Na voz do veículo'}><PageStack>
        <MetaList items={[<Badge key="preview" tone="blue">{isMap ? 'Direção editorial' : 'Texto de referência'}</Badge>]} />
        <Prose variant="read">{isMap ? draftMap.audience : draftGuide.example}</Prose>
        <DescriptionList items={isMap ? [{ label: 'Abrangência', value: draftMap.geography }, { label: 'Editorias', value: draftMap.topics.join(' · ') }]
          : [{ label: 'Tom de voz', value: draftGuide.tone }]} />
      </PageStack></Section></Panel>
      <Panel><Section title={isMap ? 'O que define uma boa pauta' : 'Antes de concluir'}><PageStack>
        {isMap ? <>
          <Meter value={draftMap.relevance} label="Peso de aderência" start="Aderência ao veículo" end={`${draftMap.relevance} pontos`} />
          <Meter value={draftMap.impact} label="Peso de impacto" start="Impacto para o leitor" end={`${draftMap.impact} pontos`} />
          <Meter value={draftMap.freshness} label="Peso de atualidade" start="Atualidade" end={`${draftMap.freshness} pontos`} />
        </> : <DescriptionList items={[{ label: 'Atribuição', value: draftGuide.attribution }, { label: 'Evitar', value: draftGuide.avoid }]} />}
      </PageStack></Section></Panel>
    </PageStack>} />
  </PageStack>;
}
