'use client';

import type { ReactNode } from 'react';
import { DataTable, RowActions, type Column, type SortState } from '@content-ventures/design-system/v3';
import { BadgeCheck, Copy, Eye } from '@content-ventures/design-system/v3/icons';
import { claimTally, primarySource, tallyLabel } from '@/domain/fact-check';
import type { QuoteSort, QuoteSortKey, RankedQuote } from './quote-model';
import { FactSourceChip, ScoreMeter, VerdictBadge } from './verdict-view';

export type QuoteTableProps = {
  rows: RankedQuote[];
  sort: QuoteSort;
  onSort: (sort: QuoteSort) => void;
  selected: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  checking: ReadonlySet<string>;
  onOpen: (entry: RankedQuote) => void;
  /** Absent for who cannot edit the library. */
  onCheck?: (entry: RankedQuote) => void;
  onCopy: (entry: RankedQuote) => void;
  footer: ReactNode;
  empty: ReactNode;
};

const SORTABLE: readonly QuoteSortKey[] = ['score', 'uses'];
const QUOTE_PREVIEW = 64;

function clip(text: string): string {
  if (text.length <= QUOTE_PREVIEW) return text;
  const cut = text.slice(0, QUOTE_PREVIEW);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), QUOTE_PREVIEW - 16)).trimEnd()}…`;
}

/** The ranking: one row per quote, best score first, with its seal, main source and tabulation. */
export function QuoteTable({ rows, sort, onSort, selected, onSelectedChange, checking, onOpen, onCheck, onCopy, footer, empty }: QuoteTableProps) {
  const columns: Column<RankedQuote>[] = [
    // Who speaks leads the quote, and the words wrap (about two lines on a desktop): a one-line
    // truncation would widen the phone card to the whole quote. The drawer has the full text.
    { key: 'text', header: 'Fala', pinned: true, render: ({ quote }) => `${quote.author}: “${clip(quote.text)}”` },
    { key: 'score', header: 'Score', sortable: true, width: 108, hint: 'Veracidade 40, força 20, autoria e fonte 20, uso 20. Contestada: até 30.',
      render: ({ score }) => (score ? <ScoreMeter score={score} /> : undefined), fallback: '—' },
    { key: 'verdict', header: 'Veredito', width: 120, render: ({ verdict }) => <VerdictBadge verdict={verdict} /> },
    { key: 'source', header: 'Fonte', width: 176, render: ({ quote }) => {
      const source = primarySource(quote.factCheck);
      return source ? <FactSourceChip source={source} compact /> : undefined;
    }, fallback: '—' },
    { key: 'tally', header: 'Tabulação', truncate: true, width: 120, render: ({ quote }) => (quote.factCheck ? tallyLabel(claimTally(quote.factCheck)) : undefined), fallback: '—' },
    { key: 'uses', header: 'Usos', numeric: true, sortable: true, width: 60, render: ({ quote }) => String(quote.uses) },
    { key: 'actions', header: '', name: 'Ações', pinned: true, width: 116, render: (entry) => (
      <RowActions
        label={`Ações da fala de ${entry.quote.author}`}
        actions={[
          { id: 'open', label: 'Abrir', icon: Eye, onSelect: () => onOpen(entry) },
          { id: 'check', label: entry.verdict === 'pending' ? 'Checar' : 'Checar de novo', icon: BadgeCheck, hidden: !onCheck,
            disabled: checking.size > 0, hint: 'Aguarde a checagem em andamento.', onSelect: () => onCheck?.(entry) },
          { id: 'copy', label: 'Copiar com atribuição', icon: Copy, onSelect: () => onCopy(entry) },
        ]}
      />
    ) },
  ];
  return (
    <DataTable
      label="Citações"
      rows={rows}
      rowKey={({ quote }) => quote.id}
      rowLabel={({ quote }) => `a fala de ${quote.author}`}
      columns={columns}
      selectable={Boolean(onSelectedChange)}
      selected={selected}
      onSelectedChange={onSelectedChange}
      sort={sort}
      onSort={(next: SortState) => { if (SORTABLE.includes(next.key as QuoteSortKey)) onSort({ key: next.key as QuoteSortKey, direction: next.direction }); }}
      onRowClick={onOpen}
      pending={checking}
      empty={empty}
      footer={footer}
    />
  );
}
