'use client';

import { useId, useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardLink,
  CopyButton,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  FilterBar,
  Grid,
  Input,
  MetaList,
  MetricStrip,
  PageHeader,
  Pagination,
  PageStack,
  Panel,
  Prose,
  SearchField,
  Section,
  Select,
  SwitchRow,
  Tabs,
  Textarea,
  TextLink,
  toast,
} from '@content-ventures/design-system/v3';
import { Plus, Quote } from '@content-ventures/design-system/v3/icons';
import { QUOTE_ORIGIN_LABELS } from '@/domain/hard-news';
import type { BankQuote, QuoteOrigin } from '@/domain/hard-news';
import { useCan } from '@/state';
import { useHardNews } from '../state/hard-news-provider';
import { useQuoteBank } from './use-quote-bank';

type Filter = 'all' | 'verified' | 'pending';

/** Two cards per row: pages of 6 rows, as the list footer offers (DS §12: lists always page). */
const PAGE_SIZES = [12, 24, 48];

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'verified', label: 'Conferidas' },
  { value: 'pending', label: 'A conferir' },
];

const ORIGINS = (Object.keys(QUOTE_ORIGIN_LABELS) as QuoteOrigin[]).map((value) => ({ value, label: QUOTE_ORIGIN_LABELS[value] }));

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** “…”, disse Marina Castro, diretora comercial da Cooperativa Oeste Peixes (the role only when known). */
export function attributed(quote: Pick<BankQuote, 'text' | 'author' | 'role'>): string {
  const role = quote.role.trim();
  return `“${quote.text}”, disse ${quote.author}${role ? `, ${role}` : ''}.`;
}

/** Why "Adicionar fala" waits in the connected build. */
const FROM_TRANSCRIPT = 'As falas saem da transcrição de cada produção.';

function dateOf(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR');
}

/**
 * Citações (F2.11, REQ-2.11): what people said, in their exact words, with author, context and
 * source; the position or timestamp only when the source has one. A quote is used in articles only
 * after a person checks it ("Conferida"). The draft and the enrichment read this bank (F2.13).
 */
export function QuoteBankScreen() {
  const { quotes, ready, connected, save } = useQuoteBank();
  const { state } = useHardNews();
  const canEdit = useCan('production.create');
  const addNoteId = useId();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const [open, setOpen] = useState<BankQuote | 'new' | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const counts = { all: quotes.length, verified: quotes.filter((quote) => quote.verified).length, pending: quotes.filter((quote) => !quote.verified).length };
  const topics = useMemo(() => [...new Set(quotes.map((quote) => quote.topic).filter(Boolean))], [quotes]);
  const sources = new Set(quotes.map((quote) => quote.sourceTitle)).size;
  const uses = quotes.reduce((total, quote) => total + quote.uses, 0);
  const people = new Set(quotes.map((quote) => quote.author)).size;
  const shown = quotes.filter((quote) => (filter === 'all' || (filter === 'verified' ? quote.verified : !quote.verified))
    && (topic === 'all' || quote.topic === topic)
    && fold(`${quote.text} ${quote.author} ${quote.role} ${quote.sourceTitle}`).includes(fold(query.trim())));
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages);
  const paged = shown.slice((current - 1) * pageSize, current * pageSize);

  return (
    <PageStack>
      <PageHeader
        title="Citações"
        actions={canEdit ? (
          <Button
            variant="primary"
            icon={Plus}
            aria-disabled={connected || undefined}
            aria-describedby={connected ? addNoteId : undefined}
            onClick={connected ? undefined : () => setOpen('new')}
          >
            Adicionar fala
          </Button>
        ) : undefined}
        actionsNote={canEdit && connected ? { id: addNoteId, text: FROM_TRANSCRIPT } : undefined}
      />
      <MetricStrip
        label="Banco de citações"
        items={[
          { label: 'Falas', value: ready ? String(counts.all) : undefined, loading: !ready },
          { label: 'Conferidas', value: ready ? `${counts.verified} de ${counts.all}` : undefined, loading: !ready, meter: { value: counts.verified, max: Math.max(1, counts.all), tone: 'green' } },
          connected
            ? { label: 'Fontes', value: ready ? String(sources) : undefined, loading: !ready }
            : { label: 'Usos em matérias', value: ready ? String(uses) : undefined, loading: !ready },
          { label: 'Pessoas', value: ready ? String(people) : undefined, loading: !ready },
        ]}
      />
      <FilterBar
        spacing="comfortable"
        filters={false}
        tabs={<Tabs label="Situação" value={filter} onChange={(value) => { setFilter(value); setPage(1); }} items={FILTERS.map((entry) => ({ ...entry, count: counts[entry.value] }))} />}
        search={<SearchField label="Buscar citações" value={query} onValueChange={(value) => { setQuery(value); setPage(1); }} placeholder="Fala, pessoa ou fonte" />}
        actions={topics.length > 0 ? <Select aria-label="Tema" size="sm" value={topic} onChange={(value) => { setTopic(value); setPage(1); }} options={[{ value: 'all', label: 'Todos os temas' }, ...topics.map((value) => ({ value, label: value }))]} /> : undefined}
      />
      {shown.length === 0 ? (
        <EmptyState icon={Quote} title={query || topic !== 'all' ? 'Nenhuma citação encontrada' : 'Nenhuma citação'} size="panel" />
      ) : (
        <>
          <Grid columns="1:1" collapseBelow={1024} as="ul" label="Citações">
            {paged.map((quote) => <QuoteCard key={quote.id} quote={quote} onOpen={() => setOpen(quote)} />)}
          </Grid>
          <Pagination
            page={current}
            pageSize={pageSize}
            total={shown.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            sizes={PAGE_SIZES}
            noun="citações"
          />
        </>
      )}
      <QuoteDrawer
        key={open === 'new' ? 'new' : open?.id ?? 'closed'}
        quote={open}
        topics={state.map.topics.map((entry) => entry.label)}
        canEdit={canEdit}
        connected={connected}
        onSave={save}
        onClose={() => setOpen(null)}
      />
    </PageStack>
  );
}

/** A quote of the bank: who said it, the exact words, and where it comes from. */
function QuoteCard({ quote, onOpen }: { quote: BankQuote; onOpen: () => void }) {
  return (
    <Card padding="md" interactive as="div">
      <PageStack>
        <CardHeader
          titleAs="h2"
          leading={<Avatar name={quote.author} size="sm" decorative />}
          title={<CardLink onClick={onOpen} aria-label={`Abrir a fala de ${quote.author}`}>{quote.author}</CardLink>}
          description={quote.role}
          badge={quote.verified ? <Badge tone="green" variant="soft" size="sm">Conferida</Badge> : <Badge tone="amber" variant="soft" size="sm">A conferir</Badge>}
          actions={quote.verified ? <CopyButton text={attributed(quote)} label="fala com atribuição" reveal="always" /> : undefined}
        />
        <Prose variant="compact" measure="wide">{`“${quote.text}”`}</Prose>
        <MetaList
          size="sm"
          items={[
            quote.topic,
            `${QUOTE_ORIGIN_LABELS[quote.origin]} · ${quote.sourceTitle}`,
            quote.locator ?? null,
            dateOf(quote.recordedOn),
            quote.uses ? `${quote.uses} ${quote.uses === 1 ? 'uso' : 'usos'}` : null,
          ]}
        />
      </PageStack>
    </Card>
  );
}

const EMPTY: Omit<BankQuote, 'id'> = {
  text: '', author: '', role: '', topic: '', origin: 'transcript', sourceTitle: '', context: '',
  recordedOn: new Date().toISOString().slice(0, 10), verified: false, uses: 0,
};

function QuoteDrawer({ quote, topics, canEdit, connected, onSave, onClose }: {
  quote: BankQuote | 'new' | null;
  topics: string[];
  canEdit: boolean;
  /** R1 citations: the words, source and speaker are fixed; context, date and the check change. */
  connected: boolean;
  onSave: (quote: BankQuote) => Promise<boolean>;
  onClose: () => void;
}) {
  const creating = quote === 'new';
  const [draft, setDraft] = useState<BankQuote>(() => (quote && quote !== 'new' ? quote : { id: `q-${Date.now().toString(36)}`, ...EMPTY, topic: topics[0] ?? '' }));
  const [tried, setTried] = useState(false);
  const patch = (next: Partial<BankQuote>) => setDraft((current) => ({ ...current, ...next }));
  const missing = { text: !draft.text.trim(), author: !draft.author.trim(), source: !draft.sourceTitle.trim() };
  const editable = canEdit && !connected && (creating || !draft.verified || quote === null);

  async function save() {
    setTried(true);
    if (missing.text || missing.author || missing.source) return;
    if (!(await onSave(draft))) return;
    toast(creating ? 'Fala adicionada' : 'Citação salva', { description: draft.verified ? undefined : 'Fica a conferir até alguém confirmar com a fonte.' });
    onClose();
  }

  return (
    <Drawer
      open={quote !== null}
      onClose={onClose}
      size="md"
      title={creating ? 'Nova fala' : draft.author}
      description={creating ? undefined : draft.role}
      footer={canEdit ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()}>{creating ? 'Adicionar fala' : 'Salvar'}</Button>
        </>
      ) : undefined}
    >
      <PageStack>
        <Panel label="Fala">
          <Section title="Fala">
            <Field label="Palavras exatas" required error={tried && missing.text ? 'Escreva a fala.' : undefined}>
              {({ id, describedBy, invalid }) => (
                <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} autoSize disabled={!editable} value={draft.text} onChange={(event) => patch({ text: event.target.value })} />
              )}
            </Field>
              <Field label="Quem disse" required error={tried && missing.author ? 'Diga quem falou.' : undefined}>
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} disabled={!editable} value={draft.author} onChange={(event) => patch({ author: event.target.value })} />}
              </Field>
              <Field label="Cargo">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={!editable} value={draft.role} onChange={(event) => patch({ role: event.target.value })} />}
              </Field>
            <Field label="Contexto">
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} autoSize disabled={!canEdit} value={draft.context} onChange={(event) => patch({ context: event.target.value })} />}
            </Field>
          </Section>
        </Panel>
        <Panel label="Fonte">
          <Section title="Fonte">
              <Field label="Origem">
                {({ id, describedBy }) => <Select id={id} describedBy={describedBy} disabled={!editable} value={draft.origin} options={ORIGINS} onChange={(origin) => patch({ origin: origin as QuoteOrigin })} />}
              </Field>
              {connected ? null : (
                <Field label="Tema">
                  {({ id, describedBy }) => <Select id={id} describedBy={describedBy} disabled={!canEdit} value={draft.topic} options={topics.map((value) => ({ value, label: value }))} onChange={(value) => patch({ topic: value })} />}
                </Field>
              )}
            <Field label="Fonte" required error={tried && missing.source ? 'Diga de onde veio a fala.' : undefined}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} disabled={!editable} placeholder="Ex.: Podcast Cadeia do Pescado #41" value={draft.sourceTitle} onChange={(event) => patch({ sourceTitle: event.target.value })} />}
            </Field>
              <Field label="Minuto ou parágrafo" optional>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={!editable} placeholder="Ex.: 14:32" value={draft.locator ?? ''} onChange={(event) => patch({ locator: event.target.value || undefined })} />}
              </Field>
              <Field label="Data">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" disabled={!(editable || (connected && canEdit))} value={draft.recordedOn} onChange={(event) => patch({ recordedOn: event.target.value })} />}
              </Field>
            {draft.sourceUrl ? <TextLink href={draft.sourceUrl} external>Abrir fonte</TextLink> : null}
          </Section>
        </Panel>
        {!creating && !connected ? (
          <Panel label="Uso">
            <Section title="Uso">
              <DescriptionList items={[{ label: 'Em matérias', value: String(draft.uses) }, { label: 'Registro', value: QUOTE_ORIGIN_LABELS[draft.origin] }]} />
            </Section>
          </Panel>
        ) : null}
        {canEdit ? (
          <SwitchRow
            label="Conferida com a fonte"
            description={draft.verified ? 'Pode entrar nos artigos.' : 'Só entra nos artigos depois de conferida.'}
            checked={draft.verified}
            onCheckedChange={(verified) => patch({ verified })}
          />
        ) : null}
      </PageStack>
    </Drawer>
  );
}
