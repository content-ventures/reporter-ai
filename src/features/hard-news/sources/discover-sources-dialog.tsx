'use client';

import { useRef, useState } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import {
  Alert, Button, EmptyState, Field, FieldGroup, Input, LiveRegion, PageStack, Progress,
  ProgressSteps, Prose, ResponsiveDialog, Section, Stepper,
} from '@content-ventures/design-system/v3';
import type { ProgressStep } from '@content-ventures/design-system/v3';
import { Rss } from '@content-ventures/design-system/v3/icons';
import type { NewsDiscoveryResult, NewsSourceSuggestion } from '@/domain/news-discovery';
import { useCan } from '@/state';
import { refusalOf } from '@/ui/permission-dialog';
import { NEWS_HREF } from '../routes';
import { useHardNews } from '../state/hard-news-provider';
import { DiscoveryResults, registeredSource, selectableSource } from './discovery-results';
import { DEFAULT_INTERVAL } from './feed-format';

type Collection = {
  suggestion: NewsSourceSuggestion;
  state: ProgressStep['state'];
  feedId?: string;
  inserted?: number;
  error?: string;
};
const STEPS = [{ id: 'context', label: 'Contexto' }, { id: 'sources', label: 'Fontes' }, { id: 'collect', label: 'Coleta' }];

/** Discovery reads and verifies sources; only the explicit selection starts their first collection. */
export function DiscoverSourcesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useHardNews();
  const canEdit = useCan('production.edit');
  const router = useRouter();
  const [portalUrl, setPortalUrl] = useState('');
  const [sector, setSector] = useState('');
  const [region, setRegion] = useState('Brasil');
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<NewsDiscoveryResult>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rows, setRows] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // React's next render is later than a second click or Enter; this lock guards the actual work.
  const working = useRef(false);
  const inputReady = Boolean(portalUrl.trim() || sector.trim());
  const completed = rows.filter(row => row.state === 'done').length;
  const failed = rows.filter(row => row.state === 'error');
  const chosen = (result?.suggestions ?? []).filter(suggestion => selected.has(suggestion.id)
    && selectableSource(suggestion) && !registeredSource(suggestion, state.feeds));

  function close() { if (!working.current) onClose(); }

  async function discover() {
    if (working.current || !inputReady || !canEdit) return;
    working.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const found = await actions.discoverSources({ portalUrl: portalUrl.trim() || undefined, sector: sector.trim() || undefined, region: region.trim() || undefined });
      setResult(found);
      setSelected(new Set());
      setStep(1);
    } catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
      setError(code === 'TAVILY_KEY_MISSING'
        ? 'A busca de fontes ainda não está conectada. Peça ao administrador para configurar a integração de busca.'
        : refusalOf(cause, 'Não foi possível buscar fontes. Tente novamente.').message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function collect(retry = false) {
    if (working.current || !canEdit) return;
    const work: Collection[] = retry ? rows.filter(row => row.state === 'error') : chosen.map(suggestion => ({ suggestion, state: 'upcoming' }));
    if (!work.length) return;
    working.current = true;
    setBusy(true);
    setStep(2);
    if (!retry) setRows(work);
    const patch = (id: string, update: Partial<Collection>) => setRows(current => current.map(row => row.suggestion.id === id ? { ...row, ...update } : row));
    try {
      for (const row of work) {
        const id = row.suggestion.id;
        patch(id, { state: 'current', error: undefined });
        try {
          // A source can have been saved even when its first read failed: retry its read, never add it again.
          const existing = row.feedId ?? registeredSource(row.suggestion, state.feeds)?.id;
          if (existing) {
            const feed = await actions.retryFeed(existing);
            patch(id, feed && feed.state !== 'failing'
              ? { state: 'done', feedId: existing, inserted: undefined }
              : { state: 'error', feedId: existing, error: feed?.lastError ?? 'A fonte não respondeu. Tente novamente.' });
            continue;
          }
          const added = await actions.addFeed({ kind: 'rss', url: row.suggestion.feedUrl!, name: row.suggestion.name, everyMinutes: DEFAULT_INTERVAL });
          if (!added.ok) patch(id, { state: 'error', error: added.message });
          else patch(id, added.feed.state === 'failing'
            ? { state: 'error', feedId: added.feed.id, error: added.feed.lastError ?? 'Fonte cadastrada, mas a primeira coleta falhou.' }
            : { state: 'done', feedId: added.feed.id, inserted: added.inserted });
        } catch (cause) {
          patch(id, { state: 'error', error: refusalOf(cause, 'Não foi possível coletar esta fonte.').message });
        }
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  function finish() {
    close();
    router.push(NEWS_HREF);
  }

  const progress: ProgressStep[] = rows.map(row => ({
    id: row.suggestion.id, label: row.suggestion.name, state: row.state,
    meta: row.state === 'done' ? row.inserted === undefined ? 'Coleta concluída'
      : `${row.inserted} ${row.inserted === 1 ? 'notícia nova' : 'notícias novas'}` : undefined,
    detail: row.error,
  }));
  const onEnter = (event: { key: string }) => { if (event.key === 'Enter') void discover(); };

  return (
    <ResponsiveDialog open={open} onClose={close} title="Descobrir fontes" size="lg" dismissible={!busy}
      footer={step === 0 ? (
        <>
          <Button variant="secondary" disabled={busy} onClick={close}>Cancelar</Button>
          <Button variant="primary" loading={busy} disabled={!inputReady || !canEdit} onClick={() => void discover()}>Buscar fontes</Button>
        </>
      ) : step === 1 ? (
        <>
          <Button variant="secondary" onClick={() => { setStep(0); setError(undefined); }}>Ajustar busca</Button>
          <Button variant="primary" disabled={!chosen.length || !canEdit} onClick={() => void collect()}>
            {chosen.length ? `Adicionar ${chosen.length} ${chosen.length === 1 ? 'fonte' : 'fontes'}` : 'Adicionar fontes'}
          </Button>
        </>
      ) : (
        <>
          {failed.length ? <Button variant="secondary" disabled={busy || !canEdit} onClick={() => void collect(true)}>Tentar fontes com falha</Button> : null}
          <Button variant="primary" disabled={busy} onClick={finish}>Ir para notícias</Button>
        </>
      )}>
      <Section>
        <Stepper label="Configuração das fontes" steps={STEPS} current={step} />
        {step === 0 ? (
          <>
            <FieldGroup label="Contexto da cobertura" hint="Informe seu site ou setor. O site serve como contexto e não entra nas fontes sugeridas.">
              <Field label="Site do seu veículo (contexto)" optional>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="url" inputMode="url" placeholder="https://"
                  value={portalUrl} disabled={busy} autoFocus onChange={event => { setPortalUrl(event.target.value); setError(undefined); }} onKeyDown={onEnter} />}
              </Field>
              <Field label="Setor ou tema" optional>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={sector} disabled={busy} placeholder="Ex.: alimentos e bebidas"
                  onChange={event => { setSector(event.target.value); setError(undefined); }} onKeyDown={onEnter} />}
              </Field>
            </FieldGroup>
            <Field label="Região" optional>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={region} disabled={busy}
                onChange={event => setRegion(event.target.value)} onKeyDown={onEnter} />}
            </Field>
            {busy ? <Progress aria-label="Buscando e verificando fontes" valueText="Buscando e verificando fontes" /> : null}
            {error ? <Alert tone="danger" title="Não foi possível buscar fontes">{error}</Alert> : null}
          </>
        ) : step === 1 ? (
          result?.suggestions.length ? (
            <>
              <Prose variant="compact" measure="wide">Escolha as fontes que deseja acompanhar.</Prose>
              <DiscoveryResults suggestions={result.suggestions} feeds={state.feeds} selected={selected}
                toggle={id => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
            </>
          ) : <EmptyState icon={Rss} title="Nenhuma fonte encontrada" description="Ajuste o site ou o setor para buscar outras fontes." size="panel" />
        ) : (
          <PageStack>
            <Prose variant="compact" measure="wide">{busy ? 'Lendo as fontes selecionadas' : `${completed} de ${rows.length} fontes prontas`}</Prose>
            <ProgressSteps label="Primeira coleta das fontes" steps={progress} />
            <LiveRegion message={busy ? '' : `${completed} fontes prontas.${failed.length ? ` ${failed.length} com falha; tente novamente.` : ''}`} />
          </PageStack>
        )}
      </Section>
    </ResponsiveDialog>
  );
}
