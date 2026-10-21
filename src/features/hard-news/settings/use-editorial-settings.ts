'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultEditorialPolicy } from '@/domain/editorial-policy';
import type { EditorialMap, WritingGuide } from '@/domain/hard-news';
import type { PipelineView } from '@/domain/pipeline';
import type { PipelineSettings } from '@/ports/pipeline-settings';
import { useCan, useRuntime } from '@/state';
import { useHardNews } from '../state/hard-news-provider';
import { editorialHistory } from './editorial-settings';

/** Connected settings use the server's revision as their optimistic base, never local fixtures. */
export function useEditorialSettings() {
  const { runtime, error: runtimeError } = useRuntime();
  const desk = useHardNews();
  const canEdit = useCan('pipeline.edit');
  const port = runtime?.pipeline;
  const demo = runtime?.mode === 'simulated' && !port;
  const [loaded, setLoaded] = useState<{ port: PipelineSettings; view: PipelineView }>();
  const [feedback, setFeedback] = useState<{ port: PipelineSettings | undefined; error?: string; conflict?: boolean; saving?: boolean; loading?: boolean }>();
  const [epoch, setEpoch] = useState(0);
  const busy = useRef<{ port: PipelineSettings; ticket: number } | undefined>(undefined);
  const request = useRef(0);
  const view = loaded?.port === port ? loaded?.view : undefined;
  const currentFeedback = feedback?.port === port ? feedback : undefined;
  const { error, conflict = false, saving = false, loading = false } = currentFeedback ?? {};

  const reload = useCallback(async () => {
    if (demo) {
      setEpoch(value => value + 1);
      setFeedback({ port });
      return;
    }
    if (!port || busy.current?.port === port) return;
    const ticket = ++request.current;
    setFeedback({ port, loading: true });
    try {
      const next = await port.get();
      if (ticket !== request.current) return;
      setLoaded({ port, view: next });
      setFeedback({ port });
      setEpoch(value => value + 1);
    } catch {
      if (ticket === request.current) setFeedback({ port, error: 'Não foi possível carregar as configurações editoriais. Tente de novo.' });
    }
  }, [demo, port]);

  useEffect(() => {
    if (!port) return;
    const ticket = ++request.current;
    void port.get().then(next => {
      if (ticket === request.current) {
        setLoaded({ port, view: next });
        setFeedback({ port });
      }
    }).catch(() => {
      if (ticket === request.current) setFeedback({ port, error: 'Não foi possível carregar as configurações editoriais. Tente de novo.' });
    });
    return () => { request.current += 1; if (busy.current?.port === port) busy.current = undefined; };
  }, [port]);

  async function save(kind: 'map' | 'guide', draft: EditorialMap | WritingGuide, changes: string[]) {
    if (!canEdit || (port && busy.current?.port === port) || conflict) return undefined;
    if (demo) {
      if (draft.version !== desk.state[kind].version) {
        setFeedback({ port, conflict: true, error: 'A configuração mudou em outra aba. Copie suas mudanças antes de carregar a versão atual.' });
        return undefined;
      }
      if (kind === 'map') desk.actions.saveMap(draft as EditorialMap, changes);
      else desk.actions.saveGuide(draft as WritingGuide, changes);
      setEpoch(value => value + 1);
      return draft.version + 1;
    }
    if (!port || !view) return undefined;
    const ticket = ++request.current;
    busy.current = { port, ticket };
    setFeedback({ port, saving: true });
    try {
      const policy = view.active.definition.editorial ?? defaultEditorialPolicy();
      const result = await port.save({ ...view.active.definition, editorial: { ...policy, [kind]: draft } }, view.active.revision);
      if (ticket !== request.current) return undefined;
      if (!result.ok) {
        setFeedback({ port, conflict: result.refusal.code === 'conflict', error: result.refusal.code === 'conflict'
          ? 'Outra pessoa alterou a configuração. Suas mudanças continuam aqui. Copie o que deseja manter antes de carregar a versão atual.'
          : result.refusal.message });
        return undefined;
      }
      setLoaded({ port, view: result.value });
      setFeedback({ port });
      setEpoch(value => value + 1);
      return result.value.active.definition.editorial?.[kind].version;
    } catch {
      if (ticket === request.current) setFeedback({ port, error: 'Não foi possível salvar. Suas mudanças continuam nesta página.' });
      return undefined;
    } finally {
      if (busy.current?.ticket === ticket) busy.current = undefined;
    }
  }

  const policy = demo ? { map: desk.state.map, guide: desk.state.guide } : view?.active.definition.editorial ?? defaultEditorialPolicy();
  return {
    ...policy, demo, saving, conflict, reload,
    ready: Boolean(runtime && !loading && (demo ? desk.ready : view)),
    error: runtimeError?.message ?? error ?? (runtime && !port && !demo ? 'Configurações indisponíveis nesta sessão.' : undefined),
    editorKey: demo ? `demo-${epoch}` : `server-${view?.active.revision}-${epoch}`,
    mapHistory: demo ? desk.state.mapHistory ?? [] : view ? editorialHistory(view, 'map') : [],
    guideHistory: demo ? desk.state.guideHistory ?? [] : view ? editorialHistory(view, 'guide') : [],
    saveMap: (draft: EditorialMap, changes: string[]) => save('map', draft, changes),
    saveGuide: (draft: WritingGuide, changes: string[]) => save('guide', draft, changes),
  };
}

export type EditorialSettings = ReturnType<typeof useEditorialSettings>;
