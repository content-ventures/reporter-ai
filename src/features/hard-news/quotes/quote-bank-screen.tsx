'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { useId, useMemo, useState } from 'react';
import {
  Avatar,
  BulkBar,
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
  PageHeader,
  Pagination,
  PageStack,
  Panel,
  Prose,
  SearchField,
  Section,
  Segmented,
  Select,
  SwitchRow,
  Tabs,
  Textarea,
  TextLink,
  toast,
} from '@content-ventures/design-system/v3';
import { BadgeCheck, LayoutGrid, Plus, Quote, Rows3 } from '@content-ventures/design-system/v3/icons';
import { QUOTE_ORIGIN_LABELS } from '@/domain/hard-news';
import type { BankQuote, QuoteOrigin } from '@/domain/hard-news';
import { checkable } from '@/domain/fact-check';
import { useCan } from '@/state';
import { useHardNews } from '../state/hard-news-provider';
import { DecisionDialog } from './decision-dialog';
import { FactCheckPanel } from './fact-check-panel';
import { DEFAULT_SORT, identified, inTab, matchesFilters, NO_FILTERS, pendingBatch, QUOTE_TABS, rankQuote, sortQuotes } from './quote-model';
import type { QuoteFilters, QuoteSort, QuoteTab, RankedQuote } from './quote-model';
import { filterCount, QUOTE_FILTER_BAND_ID, QuoteActiveFilters, QuoteFilterBand } from './quote-filters';
import { QuoteOverview } from './quote-overview';
import { QuoteTable } from './quote-table';
import { useQuoteBank } from './use-quote-bank';
import { QuoteSeal } from './verdict-view';

type View = 'table' | 'cards';

/** Lists always page (DS §12). */
const PAGE_SIZES = [12, 24, 48];

const VIEWS = [
  { value: 'table' as const, label: 'Tabela', icon: Rows3, iconOnly: true },
  { value: 'cards' as const, label: 'Cartões', icon: LayoutGrid, iconOnly: true },
];

const ORIGINS = (Object.keys(QUOTE_ORIGIN_LABELS) as QuoteOrigin[]).map((value) => ({ value, label: QUOTE_ORIGIN_LABELS[value] }));

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** “…”, disse Marina Castro, diretora comercial da Cooperativa Oeste Peixes (the role only when known). */
export function attributed(quote: Pick<BankQuote, 'text' | 'author' | 'role'>): string {
  const role = quote.role.trim();
  return `“${quote.text}”, disse ${quote.author}${role ? `, ${role}` : ''}.`;
}

/** Why "Adicionar fala" waits in the connected build. */
const FROM_TRANSCRIPT = 'As falas saem da transcrição de cada produção.';

/** What the authorship check says about a quote the outline suggested and nobody confirmed yet. */
const SUGGESTED_NOTE = 'Sugerida pela estrutura. Confira com a fonte antes de usar.';

function dateOf(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR');
}

/**
 * Citações (F2.11, REQ-2.11) as the management of the quote bank: what people said, in their exact
 * words, with author and source; whether it is true (fact check with web sources), what each
 * claim is (fact, declared figure, opinion, forecast), how many articles used it, and a 0–100
 * score that ranks the best and the worst. A person confirms the author ("Autoria conferida") and
 * may correct a verdict; the words never change. An outline passage the text did not quote arrives
 * as "Sugerida", in its own tab, and is never shown as confirmed.
 */
export function QuoteBankScreen() {
  const { quotes, ready, connected, save, check, decide, checking, progress } = useQuoteBank();
  const { state } = useHardNews();
  const canEdit = useCan('production.create');
  const addNoteId = useId();
  const [tab, setTab] = useState<QuoteTab>('all');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<QuoteFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<QuoteSort>(DEFAULT_SORT);
  const [view, setView] = useState<View>('table');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const ranked = useMemo(() => quotes.map(rankQuote), [quotes]);
  // The bank is made of quotes with their author; the others wait under "Sem autor".
  const bank = useMemo(() => ranked.filter((entry) => identified(entry.quote)), [ranked]);
  const counts = Object.fromEntries(QUOTE_TABS.map((entry) => [entry.value, ranked.filter((item) => inTab(item, entry.value)).length])) as Record<QuoteTab, number>;
  const authors = useMemo(() => [...new Set(quotes.map((quote) => quote.author))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [quotes]);
  const sources = useMemo(() => [...new Set(quotes.map((quote) => quote.sourceTitle))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [quotes]);
  const shown = sortQuotes(ranked.filter((entry) => inTab(entry, tab) && matchesFilters(entry, filters)
    && fold(`${entry.quote.text} ${entry.quote.author} ${entry.quote.role} ${entry.quote.sourceTitle}`).includes(fold(query.trim()))), sort);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages);
  const paged = shown.slice((current - 1) * pageSize, current * pageSize);
  const pending = pendingBatch(bank);
  const busy = checking.size > 0;
  const opened: BankQuote | 'new' | null = open === 'new' ? 'new' : open ? quotes.find((quote) => quote.id === open) ?? null : null;
  const reset = () => { setPage(1); setSelected(new Set()); };

  async function run(ids: readonly string[], force: boolean) {
    const { done, skipped, queued } = await check(ids, force);
    if (queued) toast('Checagem na fila', { description: 'Começa quando a checagem em andamento terminar.' });
    if (ids.length > 1 && done + skipped === ids.length) toast(`${done} ${done === 1 ? 'fala checada' : 'falas checadas'}`,
      skipped ? { description: `${skipped} ${skipped === 1 ? 'ignorada' : 'ignoradas'}: fonte sem autorização ou fala removida.` } : undefined);
  }
  const copy = (entry: RankedQuote) => {
    void navigator.clipboard.writeText(attributed(entry.quote)).then(() => toast('Fala copiada com atribuição'));
  };
  const empty = <EmptyState icon={Quote} title={query || filterCount(filters) || tab !== 'all' ? 'Nenhuma citação encontrada' : 'Nenhuma citação'} size="panel" />;
  const pagination = (
    <Pagination page={current} pageSize={pageSize} total={shown.length} onPageChange={setPage}
      onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} sizes={PAGE_SIZES} noun="citações" />
  );

  return (
    <PageStack>
      <PageHeader
        title="Citações"
        actions={canEdit ? (
          <>
            {/* Only when there is something to check; while a batch runs it says how far it is. */}
            {pending.length || progress ? (
              <Button variant="secondary" icon={BadgeCheck} loading={busy} onClick={busy ? undefined : () => void run(pending, false)}>
                {progress ? `Checando ${Math.min(progress.done + 1, progress.total)} de ${progress.total}` : 'Checar pendentes'}
              </Button>
            ) : null}
            <Button
              variant="primary"
              icon={Plus}
              aria-disabled={connected || undefined}
              aria-describedby={connected ? addNoteId : undefined}
              onClick={connected ? undefined : () => setOpen('new')}
            >
              Adicionar fala
            </Button>
          </>
        ) : undefined}
        actionsNote={canEdit && connected ? { id: addNoteId, text: FROM_TRANSCRIPT } : undefined}
      />
      <QuoteOverview entries={bank} ready={ready} />
      <FilterBar
        spacing="comfortable"
        tabs={<Tabs label="Ranking" value={tab} onChange={(value) => { setTab(value); reset(); }}
          items={QUOTE_TABS.filter((entry) => entry.value !== 'suggested' || counts.suggested > 0 || tab === 'suggested').map((entry) => ({ ...entry, count: counts[entry.value] }))} />}
        search={<SearchField label="Buscar citações" value={query} onValueChange={(value) => { setQuery(value); reset(); }} placeholder="Fala, pessoa ou fonte" />}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        filterCount={filterCount(filters)}
        bandId={QUOTE_FILTER_BAND_ID}
        actions={<Segmented label="Visualização" size="sm" value={view} onChange={setView} options={VIEWS} />}
      />
      <PageStack>
        <QuoteFilterBand open={filtersOpen} filters={filters} onChange={(next) => { setFilters(next); reset(); }} authors={authors} sources={sources} />
        {!filtersOpen && filterCount(filters) > 0 && (
          <QuoteActiveFilters filters={filters} onChange={(next) => { setFilters(next); reset(); }} onEdit={() => setFiltersOpen(true)} />
        )}
        {view === 'table' ? (
          <QuoteTable
            rows={paged}
            sort={sort}
            onSort={(next) => { setSort(next); setPage(1); }}
            selected={selected}
            {...(canEdit ? { onSelectedChange: setSelected, onCheck: (entry: RankedQuote) => void run([entry.quote.id], true) } : {})}
            checking={checking}
            onOpen={(entry) => setOpen(entry.quote.id)}
            onCopy={copy}
            footer={shown.length ? pagination : undefined}
            empty={empty}
          />
        ) : shown.length === 0 ? empty : (
          <>
            <Grid columns="1:1" collapseBelow={1024} as="ul" label="Citações">
              {paged.map((entry) => <QuoteCard key={entry.quote.id} entry={entry} onOpen={() => setOpen(entry.quote.id)} />)}
            </Grid>
            {pagination}
          </>
        )}
      </PageStack>
      {canEdit ? (
        <BulkBar
          count={selected.size}
          noun={selected.size === 1 ? 'selecionada' : 'selecionadas'}
          dock
          processing={busy ? 'Checar' : undefined}
          onClear={() => setSelected(new Set())}
          actions={[{ label: 'Checar', icon: BadgeCheck, disabled: busy, hint: 'Aguarde a checagem em andamento.',
            onSelect: () => {
              const ids = quotes.filter((quote) => selected.has(quote.id) && quote.checkable !== false && identified(quote)).map((quote) => quote.id);
              setSelected(new Set()); void run(ids, true);
            } }]}
        />
      ) : null}
      <QuoteDrawer
        key={open ?? 'closed'}
        quote={opened}
        topics={state.map.topics.map((entry) => entry.label)}
        canEdit={canEdit}
        connected={connected}
        checking={opened !== null && opened !== 'new' && checking.has(opened.id)}
        busy={busy}
        onSave={async (next) => {
          const before = quotes.find((quote) => quote.id === next.id);
          if (!(await save(next))) return false;
          // A quote that just got its author enters the bank: check it at once, again if it had a check
          // made without its author (before checks needed one).
          if (connected && before && !identified(before) && next.personId) void run([next.id], Boolean(before.factCheck));
          return true;
        }}
        onCheck={(quote) => void run([quote.id], Boolean(quote.factCheck))}
        onCorrect={() => setCorrecting(true)}
        onClose={() => setOpen(null)}
      />
      {opened && opened !== 'new' && opened.factCheck ? (
        // Beside the drawer, not inside it: closing a nested dialog would close the drawer too.
        <DecisionDialog
          key={`${opened.id}-${opened.factCheck.checkedAt}-${opened.factCheck.overrides.length}`}
          open={correcting}
          claims={opened.factCheck.claims.flatMap((claim, index) => (checkable(claim.kind) ? [{ index, text: claim.text }] : []))}
          onClose={() => setCorrecting(false)}
          onSave={async (claim, verdict, reason) => {
            const saved = await decide(opened.id, { claim, verdict, reason, checkedAt: opened.factCheck!.checkedAt });
            if (saved) toast('Veredito salvo');
            return saved;
          }}
        />
      ) : null}
    </PageStack>
  );
}

/** A quote of the bank: who said it, the exact words, its seal, score and where it comes from. */
function QuoteCard({ entry, onOpen }: { entry: RankedQuote; onOpen: () => void }) {
  const { quote, score } = entry;
  return (
    <Card padding="md" interactive as="div">
      <PageStack>
        <CardHeader
          titleAs="h2"
          leading={<Avatar name={quote.author} size="sm" decorative />}
          title={<CardLink onClick={onOpen} aria-label={`Abrir a fala de ${quote.author}`}>{quote.author}</CardLink>}
          description={quote.role}
          badge={<QuoteSeal entry={entry} />}
          actions={quote.verified ? <CopyButton text={attributed(quote)} label="fala com atribuição" reveal="always" /> : undefined}
        />
        <Prose variant="compact" measure="wide">{`“${quote.text}”`}</Prose>
        <MetaList
          size="sm"
          items={[
            score ? `Score ${score.total}` : null,
            quote.verified || quote.suggested ? null : 'Autoria a conferir',
            quote.topic,
            `${QUOTE_ORIGIN_LABELS[quote.origin]} · ${quote.sourceTitle}`,
            quote.locator ?? null,
            quote.recordedOn ? dateOf(quote.recordedOn) : null,
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

function QuoteDrawer({ quote, topics, canEdit, connected, checking, busy, onSave, onCheck, onCorrect, onClose }: {
  quote: BankQuote | 'new' | null;
  topics: string[];
  canEdit: boolean;
  /** R1 citations: the words, source and speaker are fixed; context, date and the check change. */
  connected: boolean;
  checking: boolean;
  busy: boolean;
  onSave: (quote: BankQuote) => Promise<boolean>;
  onCheck: (quote: BankQuote) => void;
  onCorrect: () => void;
  onClose: () => void;
}) {
  const workspaceHrefFor = useWorkspaceHref();
  // The fact check moves on its own (a check, a verdict): read it live, never from the draft.
  const live = quote && quote !== 'new' ? quote : undefined;
  const creating = quote === 'new';
  const [draft, setDraft] = useState<BankQuote>(() => (quote && quote !== 'new' ? quote : { id: `q-${Date.now().toString(36)}`, ...EMPTY, topic: topics[0] ?? '' }));
  const [tried, setTried] = useState(false);
  const patch = (next: Partial<BankQuote>) => setDraft((current) => ({ ...current, ...next }));
  const missing = { text: !draft.text.trim(), author: !draft.author.trim(), source: !draft.sourceTitle.trim() };
  const editable = canEdit && !connected && (creating || !draft.verified || quote === null);
  // A connected quote without its person: the editor links one of the material's confirmed participants.
  const linking = canEdit && connected && Boolean(live) && !identified(live!);

  async function save() {
    setTried(true);
    if (missing.text || missing.author || missing.source) return;
    if (!(await onSave({ ...draft, ...(live?.factCheck ? { factCheck: live.factCheck } : {}) }))) return;
    toast(creating ? 'Fala adicionada' : 'Citação salva', { description: draft.verified ? undefined : draft.suggested ? 'Fica sugerida até alguém conferir com a fonte.' : 'Fica a conferir até alguém confirmar com a fonte.' });
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
        {live && identified(live) ? (
          <FactCheckPanel quote={live} canEdit={canEdit} checking={checking} busy={busy} onCheck={() => onCheck(live)} onCorrect={onCorrect} />
        ) : null}
        <Panel label="Fala">
          <Section title="Fala">
            <Field label="Palavras exatas" required error={tried && missing.text ? 'Escreva a fala.' : undefined}>
              {({ id, describedBy, invalid }) => (
                <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} autoSize disabled={!editable} value={draft.text} onChange={(event) => patch({ text: event.target.value })} />
              )}
            </Field>
              {linking ? (
                <Field label="Quem disse" required hint={draft.participants?.length ? undefined : 'Nenhum participante confirmado no material.'}>
                  {({ id, describedBy }) => (
                    <Select id={id} describedBy={describedBy} disabled={!draft.participants?.length} placeholder="Escolha quem falou" value={draft.personId ?? ''}
                      options={(draft.participants ?? []).map((person) => ({ value: person.id, label: person.name }))}
                      onChange={(personId) => {
                        const person = draft.participants?.find((entry) => entry.id === personId);
                        if (person) patch({ personId: person.id, author: person.name, verified: true });
                      }} />
                  )}
                </Field>
              ) : (
                <Field label="Quem disse" required error={tried && missing.author ? 'Diga quem falou.' : undefined}>
                  {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} disabled={!editable} value={draft.author} onChange={(event) => patch({ author: event.target.value })} />}
                </Field>
              )}
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
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} disabled={!editable} placeholder="Ex.: Podcast do veículo #41" value={draft.sourceTitle} onChange={(event) => patch({ sourceTitle: event.target.value })} />}
            </Field>
              <Field label="Minuto ou parágrafo" optional>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={!editable} placeholder="Ex.: 14:32" value={draft.locator ?? ''} onChange={(event) => patch({ locator: event.target.value || undefined })} />}
              </Field>
              <Field label="Data">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" disabled={!(editable || (connected && canEdit))} value={draft.recordedOn}
                  onChange={(event) => patch({ recordedOn: event.target.value, ...(draft.attribution ? { attribution: { ...draft.attribution, dated: Boolean(event.target.value) } } : {}) })} />}
              </Field>
            {draft.sourceUrl ? <TextLink href={workspaceHrefFor(draft.sourceUrl)} external>Abrir fonte</TextLink> : null}
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
            label="Autoria conferida"
            description={draft.verified ? 'Pode entrar nos artigos.' : draft.suggested ? SUGGESTED_NOTE : 'Só entra nos artigos depois de conferida.'}
            checked={draft.verified}
            onCheckedChange={(verified) => patch({ verified })}
          />
        ) : null}
      </PageStack>
    </Drawer>
  );
}
