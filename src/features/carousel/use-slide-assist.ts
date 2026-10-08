'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import type { CarouselBody, PieceId, RunId, SlideAssistAction, SlideId } from '@/domain';
import type { DraftView, ProductionDetail } from '@/ports';
import { useCommands } from '@/state';
import { takeArmedSimulation } from '@/ui/shell';
import { slideProposalOf, type SlideProposal } from './slide-proposal';

/**
 * Slide suggestions of the carousel studio, through the generation service ("carousel.assist"):
 * each action starts a run (Lendo slide · Ajustando texto) whose proposal is stored as a
 * `Suggestion` — it survives a reload, carries provenance and is accepted or discarded like the
 * article's. One open proposal per slide; if the person edits those slots first, it turns stale
 * ("Trecho mudou · Reaplicar"). A proposal whose slide left the carousel (new version generated,
 * version restored) is discarded: nothing on screen could decide it, and it would hold the send.
 */

export type AssistState = 'streaming' | 'ready' | 'stale' | 'error';

export type PendingAssist = {
  kind: SlideAssistAction;
  state: AssistState;
  proposal?: SlideProposal;
  reason?: string;
  /** Slot text the proposal was made on (stale detection). */
  base?: Record<string, string>;
  suggestionId?: string;
  runId?: RunId;
};

export type AssistRequest = Exclude<SlideAssistAction, 'update'>;

export type SlideAssist = {
  pending: Record<SlideId, PendingAssist>;
  request: (slideId: SlideId, kind: AssistRequest) => void;
  /** Proposals for every slide whose article blocks changed ("Atualizar slides"); `none` when nothing changed. */
  requestUpdates: () => Promise<'started' | 'none' | 'refused'>;
  /** "Atualizar slides": `running` while the run writes its proposals, `failed` when it stopped. */
  updateStatus: 'idle' | 'running' | 'failed';
  accept: (slideId: SlideId) => Promise<void>;
  acceptAll: (kind: SlideAssistAction) => Promise<void>;
  discard: (slideId: SlideId) => Promise<void>;
  discardAll: (kind: SlideAssistAction) => Promise<void>;
};

type Request = { kind: SlideAssistAction; runId?: RunId; state: 'streaming' | 'error'; reason?: string };

export type SlideAssistInputs = {
  production: ProductionDetail;
  pieceId: PieceId;
  /** Stored draft (suggestions and revision). */
  draft: DraftView | undefined;
  /** The studio's local body (what the person sees). */
  body: CarouselBody | undefined;
  /** Writes pending local edits before a run reads the draft or a proposal is applied. */
  flush: () => Promise<boolean>;
};

const UPDATE_KEY = '__update__';

export function useSlideAssist({ production, pieceId, draft, body, flush }: SlideAssistInputs): SlideAssist {
  const commands = useCommands();
  const [requests, setRequests] = useState<Record<string, Request>>({});
  // Stored proposals (newest per slide), then this session's requests still running or refused.
  const open = useMemo(
    () =>
      (draft?.suggestions ?? [])
        .filter((suggestion) => suggestion.proposal.kind === 'slide' && (suggestion.state === 'ready' || suggestion.state === 'stale'))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [draft?.suggestions],
  );
  const pending = useMemo(() => {
    const runOf = (runId: RunId | undefined) => (runId ? production.runs.find((run) => run.id === runId) : undefined);
    const out: Record<SlideId, PendingAssist> = {};
    for (const suggestion of open) {
      const read = slideProposalOf(suggestion);
      if (!read) continue;
      out[read.proposal.slideId] = {
        kind: read.proposal.kind,
        state: suggestion.state === 'stale' ? 'stale' : 'ready',
        proposal: read.proposal,
        base: read.base,
        suggestionId: suggestion.id,
        runId: suggestion.runId,
      };
    }
    for (const [slideId, request] of Object.entries(requests)) {
      if (slideId === UPDATE_KEY) continue;
      const stored = out[slideId];
      if (request.state === 'error') {
        out[slideId] = { kind: request.kind, state: 'error', ...(request.reason ? { reason: request.reason } : {}) };
        continue;
      }
      if (stored?.runId && stored.runId === request.runId) continue;
      const run = runOf(request.runId);
      if (run?.status === 'failed') out[slideId] = { kind: request.kind, state: 'error', reason: run.error?.message ?? 'A sugestão não foi gerada.' };
      else if (run?.status === 'cancelled') continue;
      else out[slideId] = { kind: request.kind, state: 'streaming', ...(request.runId ? { runId: request.runId } : {}) };
    }
    return out;
  }, [open, requests, production.runs]);
  const orphans = useMemo(() => {
    if (!body) return [];
    const slides = new Set(body.slides.map((slide) => slide.id));
    return open.filter((suggestion) => {
      const slideId = slideProposalOf(suggestion)?.proposal.slideId;
      return slideId !== undefined && !slides.has(slideId);
    });
  }, [body, open]);
  const discarded = useRef(new Set<string>());
  useEffect(() => {
    const fresh = orphans.filter((suggestion) => !discarded.current.has(suggestion.id));
    if (fresh.length === 0) return;
    for (const suggestion of fresh) discarded.current.add(suggestion.id);
    void (async () => {
      for (const suggestion of fresh) await commands.production.decideSuggestion(suggestion.id, 'discard');
    })();
  }, [commands, orphans]);

  const updateRequest = requests[UPDATE_KEY];
  const updateRun = updateRequest?.runId ? production.runs.find((run) => run.id === updateRequest.runId) : undefined;
  const updateStored = Boolean(updateRequest?.runId) && open.some((suggestion) => suggestion.runId === updateRequest?.runId);
  const updateStatus: SlideAssist['updateStatus'] = !updateRequest || updateStored || updateRun?.status === 'cancelled'
    ? 'idle'
    : updateRun?.status === 'failed'
      ? 'failed'
      : 'running';

  const setRequest = useCallback((key: string, request: Request | null) => {
    setRequests((current) => {
      const next = { ...current };
      if (request) next[key] = request;
      else delete next[key];
      return next;
    });
  }, []);

  const start = useCallback(
    async (action: SlideAssistAction, slideIds: SlideId[]) => {
      await flush();
      if (!body || !draft) return { ok: false as const, message: 'O carrossel ainda está carregando.' };
      const simulation = takeArmedSimulation('carousel.assist');
      const result = await commands.generation.start(
        'carousel.assist',
        { productionId: production.id, pieceId, baseRevision: draft.revision, body, action, slideIds },
        simulation ? { simulation } : undefined,
      );
      return result.ok ? { ok: true as const, runId: result.value.runId } : { ok: false as const, message: result.refusal.message, code: result.refusal.code };
    },
    [body, commands, draft, flush, pieceId, production.id],
  );

  const request = useCallback(
    (slideId: SlideId, kind: AssistRequest) => {
      const previous = pending[slideId];
      setRequest(slideId, { kind, state: 'streaming' });
      void (async () => {
        // A new request replaces the slide's open proposal.
        if (previous?.suggestionId) await commands.production.decideSuggestion(previous.suggestionId, 'discard');
        const started = await start(kind, [slideId]);
        setRequest(slideId, started.ok ? { kind, state: 'streaming', runId: started.runId } : { kind, state: 'error', reason: started.message });
      })();
    },
    [commands, pending, setRequest, start],
  );

  const requestUpdates = useCallback(async () => {
    setRequest(UPDATE_KEY, { kind: 'update', state: 'streaming' });
    const started = await start('update', []);
    if (started.ok) {
      setRequest(UPDATE_KEY, { kind: 'update', state: 'streaming', runId: started.runId });
      return 'started' as const;
    }
    setRequest(UPDATE_KEY, null);
    if (started.code === 'no_change') return 'none' as const;
    toast('Não foi possível atualizar os slides', { tone: 'error', description: started.message });
    return 'refused' as const;
  }, [setRequest, start]);

  const decide = useCallback(
    async (ids: readonly string[], decision: 'accept' | 'discard') => {
      if (decision === 'accept') await flush();
      for (const id of ids) {
        const result = await commands.production.decideSuggestion(id, decision);
        if (!result.ok) {
          toast(decision === 'accept' ? 'Sugestão não aplicada' : 'Não foi possível descartar', { tone: 'error', description: result.refusal.message });
          return;
        }
        if (decision === 'accept' && result.value.outcome === 'stale') toast('O slide mudou', { tone: 'info', description: 'Reaplique a sugestão sobre o texto atual.' });
      }
    },
    [commands, flush],
  );

  const accept = useCallback(
    async (slideId: SlideId) => {
      const entry = pending[slideId];
      if (!entry?.suggestionId || entry.state !== 'ready') return;
      setRequest(slideId, null);
      await decide([entry.suggestionId], 'accept');
    },
    [decide, pending, setRequest],
  );

  const ofKind = (kind: SlideAssistAction, state?: AssistState) =>
    Object.values(pending).filter((entry) => entry.kind === kind && entry.suggestionId && (!state || entry.state === state));

  const discard = useCallback(
    async (slideId: SlideId) => {
      const entry = pending[slideId];
      setRequest(slideId, null);
      if (entry?.state === 'streaming' && entry.runId) await commands.generation.cancel(entry.runId);
      if (entry?.suggestionId) await decide([entry.suggestionId], 'discard');
    },
    [commands, decide, pending, setRequest],
  );

  return {
    pending: withStale(pending, body),
    request,
    requestUpdates,
    updateStatus,
    accept,
    acceptAll: async (kind) => decide(ofKind(kind, 'ready').map((entry) => entry.suggestionId as string), 'accept'),
    discard,
    discardAll: async (kind) => decide(ofKind(kind).map((entry) => entry.suggestionId as string), 'discard'),
  };
}

/** A ready proposal whose slots were edited since turns stale. */
function withStale(pending: Record<SlideId, PendingAssist>, body: CarouselBody | undefined): Record<SlideId, PendingAssist> {
  if (!body) return pending;
  const out: Record<SlideId, PendingAssist> = {};
  for (const [id, entry] of Object.entries(pending)) {
    const slide = body.slides.find((candidate) => candidate.id === id);
    const stale =
      entry.state === 'ready' && entry.base !== undefined && (!slide || Object.entries(entry.base).some(([slot, text]) => (slide.slots[slot] ?? '') !== text));
    out[id] = stale ? { ...entry, state: 'stale' } : entry;
  }
  return out;
}
