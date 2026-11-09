'use client';

import { useState } from 'react';
import { Button, CardHeader, Field, Input, List, ListItem, ResponsiveDialog, Section, Textarea } from '@content-ventures/design-system/v3';
import type { NewsItem } from '@/domain/hard-news';

export function NewsBundleDialog({ items, busy, onClose, onCreate }: {
  items: readonly NewsItem[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; angle: string }) => void;
}) {
  const [title, setTitle] = useState(items[0]?.title.slice(0, 120) ?? '');
  const [angle, setAngle] = useState('');
  const valid = title.trim().length > 0 && angle.trim().length > 0;
  return <ResponsiveDialog open onClose={onClose} title="Reunir notícias em um artigo" size="md" dismissible={!busy}
    footer={<>
      <Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
      <Button variant="primary" loading={busy} disabled={!valid || items.length < 2} onClick={() => onCreate({ title: title.trim(), angle: angle.trim() })}>Criar artigo</Button>
    </>}>
    <Section>
      <CardHeader size="sm" titleAs="h3" title="Notícias selecionadas" meta={items.length}
        description="As fontes e atribuições serão mantidas no artigo." />
      <List label={`Notícias selecionadas (${items.length})`} maxHeight={360}>
        {items.map(item => <ListItem key={item.id} title={item.title} description={item.source} />)}
      </List>
      <Field label="Título interno" required>
        {({ id }) => <Input id={id} maxLength={120} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} />}
      </Field>
      <Field label="Ângulo editorial" required hint="Defina o fio condutor para a síntese das fontes.">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={400} value={angle} disabled={busy}
          placeholder="Ex.: comparar oferta, preços e impacto no setor." onChange={event => setAngle(event.target.value)} />}
      </Field>
    </Section>
  </ResponsiveDialog>;
}
