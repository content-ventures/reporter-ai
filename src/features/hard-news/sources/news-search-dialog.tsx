'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, DescriptionList, Field, Input, Prose, ResponsiveDialog, Section, Select, Textarea, toast } from '@content-ventures/design-system/v3';
import type { NewsSearchConfig, NewsSearchView } from '@/domain/news-search';
import { useCan } from '@/state';
import { useHardNews } from '../state/hard-news-provider';

const INITIAL: NewsSearchConfig = { portalUrl: '', sector: '', region: 'Brasil', topics: [], languages: ['pt'],
  excludedDomains: [], everyMinutes: 60, dailyLimit: 12, enabled: true };
const STATES = { idle: 'Atualizada', queued: 'Na fila', running: 'Buscando notícias', paused: 'Pausada', limited: 'Limite diário atingido', failed: 'Falha na última busca' };
const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);

/** Saved search settings and an explicit manual collection share the same server budget. */
export function NewsSearchDialog({ onClose }: { onClose(): void }) {
  const { actions, search } = useHardNews();
  const canEdit = useCan('production.edit');
  const [view, setView] = useState<NewsSearchView>();
  const [config, setConfig] = useState(INITIAL);
  const [topics, setTopics] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void actions.readNewsSearch().then(value => {
      if (!active) return;
      setView(value); const saved = value.config ?? INITIAL;
      setConfig(saved); setTopics(saved.topics.join('\n')); setExclusions(saved.excludedDomains.join('\n')); setError(undefined);
    }).catch(() => { if (active) setError('Não foi possível carregar a configuração. Tente novamente.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actions, attempt]);
  const current = search && search.revision === view?.revision ? search : view;
  const draft = { ...config, topics: lines(topics), excludedDomains: lines(exclusions) };
  const dirty = JSON.stringify(draft) !== JSON.stringify(view?.config ?? INITIAL);
  const valid = config.portalUrl.trim() && config.sector.trim() && draft.topics.length > 0 && draft.topics.length <= 6
    && draft.excludedDomains.length <= 20 && Number.isInteger(config.dailyLimit) && config.dailyLimit >= 1 && config.dailyLimit <= 48;
  const disabled = loading || busy || !canEdit;
  const message = (error: unknown) => error instanceof Error ? error.message : 'Tente novamente.';

  async function save() {
    if (!view || busy || !valid) return;
    setBusy(true); setError(undefined);
    try {
      const saved = await actions.saveNewsSearch({ revision: view.revision, config: draft });
      setView(saved); setConfig(saved.config!); setTopics(saved.config!.topics.join('\n')); setExclusions(saved.config!.excludedDomains.join('\n'));
      toast(saved.config?.enabled ? 'Configuração salva. Busca na fila.' : 'Busca complementar pausada');
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function collect() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { setView(await actions.collectNewsSearch()); toast('Busca na fila. As notícias chegarão ao radar.'); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <ResponsiveDialog open onClose={onClose} title="Busca complementar" size="md" dirty={canEdit && dirty} dismissible={!busy}
    footer={<>
      <Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button>
      {canEdit && view?.config ? <Button variant="secondary" disabled={disabled || dirty || !current?.configured || !config.enabled || ['queued', 'running', 'limited'].includes(current?.state ?? '')}
        onClick={() => void collect()}>Buscar agora</Button> : null}
      {canEdit ? <Button variant="primary" loading={busy} disabled={disabled || !view || !valid || (!current?.configured && config.enabled)} onClick={() => void save()}>
        {config.enabled ? 'Salvar e buscar' : 'Salvar configuração'}
      </Button> : null}
    </>}>
    <Section>
      {error ? <Alert tone="danger" title="Não foi possível concluir">{error}</Alert> : null}
      {!loading && !view ? <Button variant="secondary" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Tentar novamente</Button> : null}
      {view && !view.configured ? <Alert tone="warning" title="Tavily não conectado">Um administrador precisa configurar a chave do Tavily no servidor e no worker.</Alert> : null}
      {current?.config ? <DescriptionList label="Situação da busca" items={[
        { label: 'Coleta', value: STATES[current.state] },
        { label: 'Buscas hoje (UTC)', value: `${current.usedToday} de ${current.config.dailyLimit}` },
        { label: 'Última busca', value: current.lastRunAt ? `${current.lastAdded} novas · ${new Date(current.lastRunAt).toLocaleString('pt-BR')}` : 'Ainda não executada' },
      ]} /> : null}
      {current?.state === 'failed' ? <Alert tone="warning" title="A última busca falhou">A coleta tentará novamente. Confira a conexão e os créditos do Tavily se a falha persistir.</Alert> : null}
      <Field label="Portal cliente" hint="O domínio deste portal e seus subdomínios serão excluídos da coleta.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={config.portalUrl} disabled={disabled} placeholder="https://seuportal.com.br"
          onChange={event => setConfig({ ...config, portalUrl: event.target.value })} />}
      </Field>
      <Field label="Setor">{({ id }) => <Input id={id} value={config.sector} disabled={disabled} placeholder="Pesca e aquicultura" onChange={event => setConfig({ ...config, sector: event.target.value })} />}</Field>
      <Field label="Temas para acompanhar" hint="Um por linha, até 6 temas.">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={topics} disabled={disabled}
        placeholder={'Exportação de pescado\nSanidade na aquicultura'} onChange={event => setTopics(event.target.value)} />}</Field>
      <Field label="Região">{({ id }) => <Input id={id} value={config.region} disabled={disabled} onChange={event => setConfig({ ...config, region: event.target.value })} />}</Field>
      <Field label="Idiomas de busca">{({ id }) => <Select id={id} value={config.languages.join(',')} disabled={disabled}
        options={[['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['pt,en', 'Português e inglês'], ['pt,es', 'Português e espanhol'], ['en,es', 'Inglês e espanhol'], ['pt,en,es', 'Português, inglês e espanhol']].map(([value, label]) => ({ value, label }))}
        onChange={value => setConfig({ ...config, languages: value.split(',') as NewsSearchConfig['languages'] })} />}</Field>
      <Field label="Frequência">{({ id }) => <Select id={id} value={String(config.everyMinutes)} disabled={disabled} options={[{ value: '60', label: 'A cada hora' }, { value: '120', label: 'A cada 2 horas' }, { value: '360', label: 'A cada 6 horas' }]}
        onChange={value => setConfig({ ...config, everyMinutes: Number(value) as NewsSearchConfig['everyMinutes'] })} />}</Field>
      <Field label="Limite de buscas por dia" hint="Inclui buscas automáticas, manuais e novas tentativas. Reinicia à meia-noite UTC.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={48} value={config.dailyLimit} disabled={disabled}
        onChange={event => setConfig({ ...config, dailyLimit: Number(event.target.value) })} />}</Field>
      <Field label="Outros domínios excluídos" hint="Opcional. Um domínio por linha.">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} value={exclusions} disabled={disabled} onChange={event => setExclusions(event.target.value)} />}</Field>
      <Field label="Coleta automática">{({ id }) => <Select id={id} value={String(config.enabled)} disabled={disabled} options={[{ value: 'true', label: 'Ativada' }, { value: 'false', label: 'Pausada' }]}
        onChange={value => setConfig({ ...config, enabled: value === 'true' })} />}</Field>
      <Prose variant="compact">Cada busca usa créditos do Tavily e pode completar o texto de até cinco páginas. Os resultados entram no radar com o veículo original e tradução para pt-BR.</Prose>
    </Section>
  </ResponsiveDialog>;
}
