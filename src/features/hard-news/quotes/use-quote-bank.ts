'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CitationLibraryView, CitationView } from '@/domain/citation-library';
import { recheck } from '@/domain/fact-check';
import type { FactCheck } from '@/domain/fact-check';
import type { BankQuote } from '@/domain/hard-news';
import type { ClaimDecision } from '@/ports/citation-library';
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
  /**
   * Fact-checks the quotes one after the other; a quote the server no longer allows is skipped,
   * any other refusal stops the batch. Resolves how many were checked and skipped.
   */
  check: (ids: readonly string[], force?: boolean) => Promise<{ done: number; skipped: number }>;
  /** The editor's verdict on one claim of the last check. */
  decide: (id: string, decision: ClaimDecision) => Promise<boolean>;
  /** Quotes being checked now. */
  checking: ReadonlySet<string>;
  /** "3 de 20" while a batch runs. */
  progress?: { done: number; total: number };
};

/** The preview has no web search: its check marks every claim as not validated, and says so. */
function previewCheck(quote: BankQuote, now: string): FactCheck {
  const factual = /\d/.test(quote.text);
  return recheck(quote.factCheck, { id: quote.id, checkedAt: now, model: 'Demonstração', strength: { score: factual ? 4 : 3, reason: 'Demonstração sem modelo.' },
    claims: [factual ? { text: quote.text, kind: 'fact', verdict: 'not_validated', reason: 'Demonstração: a busca na web roda na versão conectada.', sources: [] }
      : { text: quote.text, kind: 'opinion', sources: [] }] });
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The quote bank's data. In the connected build it is the R1 citation library (`CitationLibrary`
 * port); the R2 preview runs on fixtures, which has none, and keeps the desk's quotes.
 */
export function useQuoteBank(): QuoteBank {
  const { state, ready, actions } = useHardNews();
  const port = useRuntime().runtime?.citations;
  const [view, setView] = useState<CitationLibraryView>();
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const quotesRef = useRef<BankQuote[]>([]);
  // One batch at a time, and none after the page is gone: each check spends search credits.
  const running = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

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
  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  const replace = useCallback((item: CitationView) => {
    setView((current) => current && { ...current, items: current.items.map((entry) => (entry.id === item.id ? item : entry)) });
  }, []);

  const save = useCallback(async (quote: BankQuote) => {
    if (!port) {
      actions.saveQuote(quote);
      return true;
    }
    const citation = view?.items.find((item) => item.id === quote.id);
    if (!citation) return false;
    try {
      // The saved citation alone: a full reload could land after, and undo, a check applied meanwhile.
      replace(await port.save(citationInputOf(citation, quote), citation.id, citation.revision));
      return true;
    } catch (error) {
      notifyRefusal('Não foi possível salvar a citação', refusalOf(error, 'Tente de novo em instantes.'));
      return false;
    }
  }, [port, view, actions, replace]);

  const check = useCallback(async (ids: readonly string[], force = false) => {
    if (running.current) return { done: 0, skipped: 0 };
    running.current = true;
    let done = 0, skipped = 0;
    if (ids.length > 1) setProgress({ done: 0, total: ids.length });
    try {
      for (const id of ids) {
        if (!live.current) break;
        setChecking(new Set([id]));
        try {
          if (port) replace(await port.check(id, force));
          else {
            const quote = quotesRef.current.find((item) => item.id === id);
            if (!quote) continue;
            await pause(600);
            actions.saveQuote({ ...quote, factCheck: previewCheck(quote, new Date().toISOString()) });
          }
        } catch (error) {
          // A source withdrawn or a quote removed since the page loaded: skip it, the rest can still be checked.
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
          if (ids.length > 1 && (code === 'SOURCE_NOT_AUTHORIZED' || code === 'NOT_FOUND')) {
            skipped += 1;
            // Not offered again by "Checar pendentes" until the library is read again.
            setView((current) => current && { ...current, items: current.items.map((item) => (item.id === id ? { ...item, authorized: false } : item)) });
            continue;
          }
          notifyRefusal(done ? `Checagem parada depois de ${done} ${done === 1 ? 'fala' : 'falas'}` : 'Não foi possível checar a fala',
            refusalOf(error, 'Tente de novo em instantes.'));
          return { done, skipped };
        }
        done += 1;
        if (ids.length > 1) setProgress({ done, total: ids.length });
      }
      return { done, skipped };
    } finally {
      running.current = false;
      if (live.current) {
        setChecking(new Set());
        setProgress(undefined);
      }
    }
  }, [port, replace, actions]);

  const decide = useCallback(async (id: string, decision: ClaimDecision) => {
    try {
      if (port) replace(await port.decide(id, decision));
      else {
        const quote = quotesRef.current.find((item) => item.id === id);
        if (!quote?.factCheck) return false;
        actions.saveQuote({ ...quote, factCheck: { ...quote.factCheck, overrides: [...quote.factCheck.overrides,
          { ...decision, personId: 'preview', at: new Date().toISOString() }] } });
      }
      return true;
    } catch (error) {
      notifyRefusal('Não foi possível salvar o veredito', refusalOf(error, 'Tente de novo em instantes.'));
      return false;
    }
  }, [port, replace, actions]);

  return { quotes, ready: port ? Boolean(view) || failed : ready, connected: Boolean(port), save, check, decide, checking, ...(progress ? { progress } : {}) };
}
