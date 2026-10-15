'use client';
import { useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, ChoiceCard, ConfirmDialog, DescriptionList, Field, FieldGroup, Grid, Input, PageHeader, PageStack, Panel, Prose, Section, Select, SplitLayout, Stepper, toast } from '@content-ventures/design-system/v3';
import { Webhook, X } from '@content-ventures/design-system/v3/icons';
import { usePrototype } from './prototype-state';
import { validWebUrl } from './demo-data';

export function CmsScreen() {
  const { cms, setCms } = usePrototype();
  const [url, setUrl] = useState(cms.url);
  const [platform, setPlatform] = useState(cms.platform);
  const [tested, setTested] = useState(cms.connected);
  const [error, setError] = useState('');
  const [disconnect, setDisconnect] = useState(false);
  return <PageStack>
    <PageHeader title="CMS do portal" status={<Badge tone={cms.connected ? 'blue' : 'gray'}>{cms.connected ? 'Conexão simulada' : 'Não conectado'}</Badge>}
      actions={cms.connected ? <Button icon={X} onClick={() => setDisconnect(true)}>Desconectar</Button> : undefined} />
    <Stepper current={cms.connected ? 2 : tested ? 1 : 0} label="Configuração do CMS" steps={[
      { id: 'portal', label: 'Portal', state: tested ? 'done' : 'active' },
      { id: 'permissions', label: 'Permissões', state: cms.connected ? 'done' : tested ? 'active' : 'upcoming' },
      { id: 'mapping', label: 'Mapeamento', state: cms.connected ? 'active' : 'upcoming' },
    ]} />
    <SplitLayout main={<PageStack>
      <Panel><Section title="Identificação do portal"><FieldGroup label="Portal" columns={1}>
        <Grid columns="1:1" collapseBelow={640}>
          <ChoiceCard name="cms-platform" value="wordpress" title="WordPress" description="Matérias, categorias e autores do portal." layout="stacked" checked={platform === 'wordpress'} disabled={cms.connected} onChange={value => { setPlatform(value); setTested(false); }} />
          <ChoiceCard name="cms-platform" value="custom" title="CMS próprio" description="Integração com a estrutura do seu veículo." layout="stacked" checked={platform === 'custom'} disabled={cms.connected} onChange={value => { setPlatform(value); setTested(false); }} />
        </Grid>
        <Field label="Endereço do portal">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} type="url" value={url} disabled={cms.connected} placeholder="https://portal.example" onChange={event => { setUrl(event.target.value); setTested(false); setError(''); }} />}</Field>
        <Prose variant="compact">Esta tela simula a autorização. Não informe senhas ou chaves reais.</Prose>
        {error && <Alert tone="danger" title="Revise o endereço">{error}</Alert>}
        {!cms.connected && <Button icon={Webhook} variant="primary" onClick={() => { if (!validWebUrl(url)) { setError('Informe um endereço http ou https válido.'); return; } setTested(true); setError(''); }}>Simular verificação</Button>}
      </FieldGroup></Section></Panel>
      {tested && <Panel><Section title="Permissões solicitadas"><PageStack>
        <DescriptionList items={[{ label: 'Consultar', value: 'Matérias publicadas, categorias, autores e imagens' }, { label: 'Criar', value: 'Rascunhos no portal após uma ação editorial' }, { label: 'Publicar', value: 'Não autorizado nesta configuração' }]} />
        {!cms.connected && <Button variant="primary" onClick={() => { setCms({ ...cms, url, platform, connected: true }); toast('Conexão simulada; nenhuma chamada ao portal'); }}>Confirmar conexão simulada</Button>}
      </PageStack></Section></Panel>}
      {cms.connected && <Panel><Section title="Destino dos rascunhos"><FieldGroup label="Mapeamento editorial" columns={1}>
        <Field label="Categoria padrão">{props => <Select {...props} value={cms.section} onChange={section => setCms({ ...cms, section })} options={['Indústria', 'Mercado', 'Aquicultura'].map(value => ({ value, label: value }))} />}</Field>
        <Field label="Autor no portal">{props => <Select {...props} value={cms.author} onChange={author => setCms({ ...cms, author })} options={['Redação', 'Editor de exemplo'].map(value => ({ value, label: value }))} />}</Field>
        <Badge tone="gray">Alterações mantidas nesta sessão</Badge>
      </FieldGroup></Section></Panel>}
    </PageStack>} asideLabel="Estado da integração" aside={<PageStack><Panel><Section title="Destino editorial"><PageStack>
      <DescriptionList items={[{ label: 'Portal', value: cms.connected ? cms.url : 'A definir' }, { label: 'Categoria', value: cms.connected ? cms.section : 'Definida após a conexão' }, { label: 'Assinatura', value: cms.connected ? cms.author : 'A definir' }, { label: 'Estado de envio', value: 'Rascunho para revisão no portal' }]} />
      {cms.connected && <ButtonGroup label="Conferir integração"><Button disabled={cms.imported} onClick={() => { setCms({ ...cms, imported: true }); toast('Categorias e autores de exemplo carregados'); }}>{cms.imported ? 'Dados de exemplo carregados' : 'Simular sincronização'}</Button></ButtonGroup>}
    </PageStack></Section></Panel>
      <Panel><Section title="Da redação ao portal"><DescriptionList items={[
        { label: '1 · Conectar', value: 'Identifique o portal e confira as permissões.' },
        { label: '2 · Mapear', value: 'Escolha a categoria e a assinatura padrão.' },
        { label: '3 · Revisar', value: 'O conteúdo chega como rascunho. A publicação depende da equipe editorial.' },
      ]} /></Section></Panel></PageStack>} />
    <ConfirmDialog open={disconnect} onClose={() => setDisconnect(false)} title="Desconectar o CMS de exemplo?" description="O mapeamento desta sessão será removido. Nenhum portal real será afetado." confirmLabel="Desconectar" cancelLabel="Cancelar" tone="danger" onConfirm={() => { setCms({ url: '', platform: 'wordpress', connected: false, section: 'Indústria', author: 'Redação', imported: false }); setTested(false); setDisconnect(false); setUrl(''); }} />
  </PageStack>;
}
