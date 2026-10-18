'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CitationLibraryView } from '@/domain/citation-library';
import type { BankQuote } from '@/domain/hard-news';
import { useRuntime } from '@/state';
import { notifyRefusal, refusalOf } from '@/ui/permission-dialog';
import { useHardNews } from '../state/hard-news-provider';
import { citationInputOf, quoteOf } from './quote-model';

export type QuoteBank = {
  quotes: BankQuote[];
  ready: boolean;
  /**
   * The connected build reads the R1 citations: their words, source and speaker never change, and a
   * new quote comes from a production's transcript, not from this page.
   */
  connected: boolean;
  /** Saves a quote; resolves `false` when it failed, after saying why. */
  save: (quote: BankQuote) => Promise<boolean>;
};

/**
 * The quote bank's data. In the connected build it is the R1 citation library (`CitationLibrary`
 * port); the R2 preview runs on fixtures, which has none, and keeps the desk's quotes.
 */
export function useQuoteBank(): QuoteBank {
  const { state, ready, actions } = useHardNews();
  const port = useRuntime().runtime?.citations;
  const [view, setView] = useState<CitationLibraryView>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!port || view || failed) return undefined;
    let live = true;
    void port.get().then((value) => {
      if (live) setView(value);
    }).catch((error: unknown) => {
      if (!live) return;
      setFailed(true);
      notifyRefusal('Não foi possível abrir as citações', refusalOf(error, 'Tente de novo em instantes.'));
    });
    return () => {
      live = false;
    };
  }, [port, view, failed]);

  const quotes = useMemo(() => (port ? (view?.items ?? []).map(quoteOf) : state.quotes), [port, view, state.quotes]);

  const save = useCallback(async (quote: BankQuote) => {
    if (!port) {
      actions.saveQuote(quote);
      return true;
    }
    const citation = view?.items.find((item) => item.id === quote.id);
    if (!citation) return false;
    try {
      await port.save(citationInputOf(citation, quote), citation.id, citation.revision);
      setView(await port.get());
      return true;
    } catch (error) {
      notifyRefusal('Não foi possível salvar a citação', refusalOf(error, 'Tente de novo em instantes.'));
      return false;
    }
  }, [port, view, actions]);

  return { quotes, ready: port ? Boolean(view) || failed : ready, connected: Boolean(port), save };
}
