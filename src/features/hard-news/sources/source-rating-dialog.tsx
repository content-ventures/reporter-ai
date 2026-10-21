'use client';

import { useRef, useState } from 'react';
import {
  Alert, Button, DescriptionList, Field, PageStack, Prose,
  ResponsiveDialog, Section, Select, Textarea, toast,
} from '@content-ventures/design-system/v3';
import type { NewsFeed } from '@/domain/hard-news';
import {
  isRateableNewsSource, SOURCE_RELEVANCE_LABELS, SOURCE_TIER_DESCRIPTIONS, SOURCE_TIER_LABELS,
  type SourceRatingInput, type SourceRelevance, type SourceTier,
} from '@/domain/news-source-rating';
import { useCan } from '@/state';
import { useHardNews } from '../state/hard-news-provider';

const TIERS = Object.entries(SOURCE_TIER_LABELS).map(([value, label]) => ({
  value, label: `${value} · ${label}`, description: SOURCE_TIER_DESCRIPTIONS[value as SourceTier],
}));
const RELEVANCE = Object.entries(SOURCE_RELEVANCE_LABELS).map(([value, label]) => ({ value, label }));

export function SourceRatingDialog({ feed, mode, onClose }: {
  feed: NewsFeed;
  mode: 'view' | 'edit';
  onClose: () => void;
}) {
  const { actions } = useHardNews();
  const canEdit = useCan('production.edit') && isRateableNewsSource(feed);
  const [editing, setEditing] = useState(mode === 'edit');
  const [tier, setTier] = useState<SourceTier | ''>(feed.rating?.tier ?? '');
  const [relevance, setRelevance] = useState<SourceRelevance | ''>(feed.rating?.relevance ?? '');
  const [rationale, setRationale] = useState(feed.rating?.rationale ?? '');
  const [saving, setSaving] = useState<'save' | 'remove'>();
  const [error, setError] = useState<string>();
  const working = useRef(false);
  const valid = tier !== '' && relevance !== '' && rationale.trim().length > 0 && rationale.trim().length <= 600;
  const dirty = tier !== (feed.rating?.tier ?? '') || relevance !== (feed.rating?.relevance ?? '') || rationale !== (feed.rating?.rationale ?? '');
  const editable = editing && canEdit;
  const close = () => { if (!working.current) onClose(); };

  function beginEdit() {
    if (editing || !canEdit) return;
    setTier(feed.rating?.tier ?? '');
    setRelevance(feed.rating?.relevance ?? '');
    setRationale(feed.rating?.rationale ?? '');
    setError(undefined);
    setEditing(true);
  }

  async function save(rating: SourceRatingInput | null) {
    if (!canEdit || working.current || (rating !== null && !valid)) return;
    working.current = true;
    setSaving(rating ? 'save' : 'remove');
    setError(undefined);
    try {
      const result = await actions.updateFeed(feed.id, { rating });
      if (!result.ok) { setError(result.message); return; }
      toast(rating ? 'Avaliação salva' : 'Avaliação removida', { description: feed.name });
      onClose();
    } catch {
      setError('Não foi possível salvar a avaliação. Tente novamente.');
    } finally {
      working.current = false;
      setSaving(undefined);
    }
  }

  return (
    <ResponsiveDialog open onClose={close} title="Avaliação editorial" description={feed.name} size="sm"
      dirty={editable && dirty} dismissible={!saving}
      footer={<>
        {editable && feed.rating ? <Button variant="ghost" tone="danger" disabled={Boolean(saving)} loading={saving === 'remove'} onClick={() => void save(null)}>Remover avaliação</Button> : null}
        <Button variant="secondary" disabled={Boolean(saving)} onClick={close}>{editable ? 'Cancelar' : 'Fechar'}</Button>
        {editable ? <Button variant="primary" disabled={!valid || Boolean(saving)} loading={saving === 'save'}
          onClick={() => { if (tier && relevance) void save({ tier, relevance, rationale: rationale.trim() }); }}>Salvar avaliação</Button>
          : canEdit ? <Button variant="primary" onClick={beginEdit}>{feed.rating ? 'Editar avaliação' : 'Avaliar fonte'}</Button> : null}
      </>}
    >
      <Section>
        <Prose variant="compact">Classificação interna da redação. Não mede audiência.</Prose>
        {error ? <Alert tone="danger" title="Não foi possível salvar">{error}</Alert> : null}
        {editable ? <>
          <Field label="Força editorial" hint={tier ? SOURCE_TIER_DESCRIPTIONS[tier] : undefined}>
            {({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={tier} options={TIERS} disabled={Boolean(saving)} onChange={(value) => { setTier(value as SourceTier); setError(undefined); }} />}
          </Field>
          <Field label="Relevância para o veículo">
            {({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={relevance} options={RELEVANCE} disabled={Boolean(saving)} onChange={(value) => { setRelevance(value as SourceRelevance); setError(undefined); }} />}
          </Field>
          <Field label="Justificativa">
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={4} maxLength={600} required
              value={rationale} disabled={Boolean(saving)} onChange={(event) => { setRationale(event.target.value); setError(undefined); }} />}
          </Field>
        </> : feed.rating ? <PageStack>
          <DescriptionList label="Avaliação da fonte" items={[
            { label: 'Força editorial', value: `${feed.rating.tier} · ${SOURCE_TIER_LABELS[feed.rating.tier]}` },
            { label: 'Relevância para o veículo', value: SOURCE_RELEVANCE_LABELS[feed.rating.relevance] },
            { label: 'Atualizada em', value: new Date(feed.rating.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) },
          ]} />
          <Prose variant="compact" label="Justificativa">{feed.rating.rationale}</Prose>
        </PageStack> : <Prose variant="compact">Fonte ainda não avaliada.</Prose>}
      </Section>
    </ResponsiveDialog>
  );
}
