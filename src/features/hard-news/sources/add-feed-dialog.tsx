'use client';

import { useRef, useState } from 'react';
import { Alert, Button, Dialog, Field, Input, Section, Segmented, Select, toast } from '@content-ventures/design-system/v3';
import type { SegmentOption } from '@content-ventures/design-system/v3';
import type { NewSource } from '@/ports/news-intake';
import { useCan } from '@/state';
import { refusalOf } from '@/ui/permission-dialog';
import { useHardNews } from '../state/hard-news-provider';
import { DEFAULT_INTERVAL, INTERVAL_OPTIONS } from './feed-format';

type Mode = 'feed' | 'site' | 'keyword';

/**
 * F2.1 · "Adicionar fonte": an outlet's feed (or its site, whose feed is found), a site without a
 * feed or a keyword (both made by RSS.app), and how often to read it. The first read happens here:
 * the source arrives with its news.
 */
export function AddFeedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions, rssApp } = useHardNews();
  const canEdit = useCan('production.edit');
  const [mode, setMode] = useState<Mode>('feed');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [every, setEvery] = useState(String(DEFAULT_INTERVAL));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string; error: string }>();
  const working = useRef(false);
  const modes: SegmentOption<Mode>[] = [
    { value: 'feed', label: 'Feed ou site' },
    { value: 'site', label: 'Site sem feed', ...(rssApp ? {} : { disabled: true, disabledReason: 'O RSS.app não está conectado' }) },
    { value: 'keyword', label: 'Palavra-chave', ...(rssApp ? {} : { disabled: true, disabledReason: 'O RSS.app não está conectado' }) },
  ];
  const ready = mode === 'keyword' ? keyword.trim().length > 0 : address.trim().length > 0;

  function close() {
    if (working.current) return;
    setMode('feed');
    setAddress('');
    setName('');
    setKeyword('');
    setEvery(String(DEFAULT_INTERVAL));
    setError(undefined);
    setSaved(undefined);
    onClose();
  }

  async function submit() {
    if (!ready || working.current || !canEdit) return;
    const everyMinutes = Number(every);
    const input: NewSource = mode === 'keyword'
      ? { kind: 'rss-app', keyword: keyword.trim(), everyMinutes }
      : mode === 'site'
        ? { kind: 'rss-app', site: address.trim(), name: name.trim() || undefined, everyMinutes }
        : { kind: 'rss', url: address.trim(), name: name.trim() || undefined, everyMinutes };
    working.current = true;
    setSaving(true);
    try {
      const result = await actions.addFeed(input);
      if (!result.ok) { setError(result.message); return; }
      if (result.feed.state === 'failing') {
        setSaved({ id: result.feed.id, name: result.feed.name, error: result.feed.lastError ?? 'A fonte não respondeu à primeira coleta.' });
        return;
      }
      toast('Fonte adicionada', { description: `${result.feed.name} · ${result.inserted} ${result.inserted === 1 ? 'notícia nova' : 'notícias novas'}` });
      working.current = false;
      close();
    } catch (cause) {
      setError(refusalOf(cause, 'Não foi possível adicionar a fonte.').message);
    } finally {
      working.current = false;
      setSaving(false);
    }
  }

  async function retry() {
    if (!saved || working.current || !canEdit) return;
    working.current = true;
    setSaving(true);
    try {
      const feed = await actions.retryFeed(saved.id);
      if (!feed || feed.state === 'failing') {
        setSaved({ ...saved, error: feed?.lastError ?? 'A fonte não respondeu. Tente novamente.' });
        return;
      }
      toast('Coleta concluída', { description: feed.name });
      working.current = false;
      close();
    } finally {
      working.current = false;
      setSaving(false);
    }
  }

  const onEnter = (event: { key: string }) => { if (event.key === 'Enter') void submit(); };
  const change = (set: (value: string) => void) => (event: { target: { value: string } }) => { set(event.target.value); setError(undefined); };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Adicionar fonte"
      divided={false}
      dismissible={!saving}
      dirty={address.trim().length > 0 || keyword.trim().length > 0 || name.trim().length > 0}
      footer={(
        <>
          <Button variant="secondary" disabled={saving} onClick={close}>{saved ? 'Concluir' : 'Cancelar'}</Button>
          <Button variant="primary" disabled={!canEdit || (!saved && !ready)} loading={saving} onClick={() => void (saved ? retry() : submit())}>
            {saved ? 'Tentar coleta' : 'Adicionar fonte'}
          </Button>
        </>
      )}
    >
      {/* A headless Section gives the fields the form rhythm (20 px between them). */}
      {saved ? <Alert tone="danger" title={`${saved.name}: coleta pendente`}>{saved.error} A fonte já está cadastrada.</Alert> : <Section>
        <Field label="Tipo">
          {() => <Segmented label="Tipo de fonte" options={modes} value={mode} onChange={(value) => { setMode(value); setError(undefined); }} full />}
        </Field>
        {mode === 'keyword' ? (
          <Field label="Palavra-chave" error={error}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} invalid={invalid} value={keyword} placeholder="Ex.: tilápia" autoFocus onChange={change(setKeyword)} onKeyDown={onEnter} />
            )}
          </Field>
        ) : (
          <>
            <Field label={mode === 'site' ? 'Endereço do site' : 'Endereço do site ou do feed'} error={error}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={address}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  autoFocus
                  onChange={change(setAddress)}
                  onKeyDown={onEnter}
                />
              )}
            </Field>
            <Field label="Nome" optional>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} value={name} placeholder="O nome do feed" onChange={change(setName)} onKeyDown={onEnter} />
              )}
            </Field>
          </>
        )}
        <Field label="Frequência">
          {({ id, describedBy }) => (
            <Select id={id} describedBy={describedBy} value={every} options={INTERVAL_OPTIONS} onChange={setEvery} />
          )}
        </Field>
      </Section>}
    </Dialog>
  );
}
