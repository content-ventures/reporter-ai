'use client';

import { useState } from 'react';
import { Button, ChoiceCard, Field, FieldGroup, Grid, Input, ResponsiveDialog, Section, Textarea } from '@content-ventures/design-system/v3';
import type { NewsItem } from '@/domain/hard-news';
import { FORMAT_SPECS, formatRangeLabel } from '@/domain/formats';
import { NEWS_CONTENT_TYPES } from './news-content';
import type { NewsContentSettings, NewsContentType } from './news-content';

export function NewsBundleDialog({ items, busy, onClose, onCreate }: {
  items: readonly NewsItem[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; angle: string } & NewsContentSettings) => void;
}) {
  const [title, setTitle] = useState(items.length === 1 ? items[0].title.slice(0, 120) : `Síntese de ${items.length} notícias`);
  const [angle, setAngle] = useState('');
  const [format, setFormat] = useState<NewsContentType>('article');
  const [formatSize, setFormatSize] = useState<string>();
  const spec = format === 'article' || format === 'carousel' ? undefined : FORMAT_SPECS[format];
  return <ResponsiveDialog open onClose={onClose} title="Criar conteúdo com notícias" size="lg" dismissible={!busy}
    footer={<>
      <Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
      <Button variant="primary" loading={busy} disabled={!title.trim() || !items.length}
        onClick={() => onCreate({ title: title.trim(), angle: angle.trim(), format, formatSize })}>Gerar conteúdo</Button>
    </>}>
    <Section>
      <FieldGroup label={`Tipo de conteúdo · ${items.length} ${items.length === 1 ? 'notícia selecionada' : 'notícias selecionadas'}`}>
        <Grid columns="1:1" gap="sm" collapseBelow={480}>
          {NEWS_CONTENT_TYPES.map(option => <ChoiceCard key={option.value} name="news-content-type" value={option.value}
            checked={format === option.value} disabled={busy} title={option.title} description={option.description}
            onChange={value => { setFormat(value as NewsContentType); setFormatSize(undefined); }} />)}
        </Grid>
      </FieldGroup>
      {spec && spec.sizes.length > 1 ? <FieldGroup label="Tamanho">
        <Grid columns="1:1" gap="sm" collapseBelow={480}>
          {spec.sizes.map(size => <ChoiceCard key={size.id} name="news-content-size" value={size.id}
            checked={(formatSize ?? spec.defaultSize) === size.id} disabled={busy} onChange={setFormatSize}
            title={size.label} description={formatRangeLabel(size)} />)}
        </Grid>
      </FieldGroup> : null}
      <Field label="Título interno" required>
        {({ id }) => <Input id={id} maxLength={120} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} />}
      </Field>
      <Field label="Recorte editorial">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={250} value={angle} disabled={busy}
          placeholder="Ex.: comparar oferta, preços e impacto no setor." onChange={event => setAngle(event.target.value)} />}
      </Field>
    </Section>
  </ResponsiveDialog>;
}
