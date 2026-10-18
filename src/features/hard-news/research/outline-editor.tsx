'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Counter,
  Field,
  FieldGroup,
  IconButton,
  Input,
  List,
  MetaList,
  Panel,
  Section,
  Segmented,
  SourceChip,
  TagInput,
  Textarea,
} from '@content-ventures/design-system/v3';
import { Plus, Sparkles, Trash2 } from '@content-ventures/design-system/v3/icons';
import { ARTICLE_SIZES } from '@/domain';
import type { HardNewsDossier, HardNewsOutline, OutlineSection } from '@/domain/hard-news';
import { useHardNews } from '../state/hard-news-provider';

const HEADLINE_MAX = 90;
const LEAD_MAX = 280;

const SIZES: { value: HardNewsOutline['size']; label: string }[] = [
  { value: 'short', label: `${ARTICLE_SIZES.short.label} · ${ARTICLE_SIZES.short.laudas} lauda` },
  { value: 'standard', label: `${ARTICLE_SIZES.standard.label} · ${ARTICLE_SIZES.standard.laudas} laudas` },
];

/**
 * F2.7 · the outline the draft follows, in two blocks: headline, lead and keywords, then the
 * intertitles with their points and the sources that hold them up. Edits are kept when the field
 * is left; "Escrever artigo" uses exactly what is here, in this order.
 */
export function OutlineEditor({ dossier, disabled }: { dossier: HardNewsDossier; disabled: boolean }) {
  const { actions } = useHardNews();
  const outline = dossier.outline;

  if (!outline) {
    return (
      <Panel label="Outline">
        <Section title="Outline">
          <List label="Outline" framed={false} bleed empty="A IA monta o outline com as fontes da matéria." />
        </Section>
      </Panel>
    );
  }

  const save = (next: HardNewsOutline) => actions.updateOutline(dossier.productionId, next);
  const sources = new Map(dossier.sources.map((source) => [source.id, source]));

  return (
    <Panel label="Outline">
      <Section
        title="Outline"
        action={<Segmented label="Tamanho" size="sm" options={SIZES} value={outline.size} disabled={disabled} onChange={(size) => save({ ...outline, size })} />}
      >
        <TextField
          label="Título"
          value={outline.headline}
          max={HEADLINE_MAX}
          disabled={disabled}
          onCommit={(headline) => save({ ...outline, headline })}
        />
        <TextField
          label="Lead"
          value={outline.lead}
          max={LEAD_MAX}
          multiline
          disabled={disabled}
          onCommit={(lead) => save({ ...outline, lead })}
        />
        <Field label="Palavras-chave" meta={<Badge tone="violet" variant="soft" size="sm" icon={Sparkles}>Sugestão da IA</Badge>}>
          {({ id, describedBy }) => (
            <TagInput id={id} describedBy={describedBy} disabled={disabled} values={outline.keywords ?? []} onChange={(keywords) => save({ ...outline, keywords })} />
          )}
        </Field>
      </Section>
      <Section
        title="Intertítulos"
        meta={String(outline.sections.length)}
        action={(
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            disabled={disabled}
            onClick={() => save({ ...outline, sections: [...outline.sections, { id: `o-${Date.now().toString(36)}`, heading: '', points: [], sourceIds: [] }] })}
          >
            Adicionar intertítulo
          </Button>
        )}
      >
        {outline.sections.map((section, index) => (
          <SectionFields
            key={section.id}
            index={index}
            section={section}
            sources={section.sourceIds.flatMap((id) => {
              const source = sources.get(id);
              return source ? [source] : [];
            })}
            disabled={disabled}
            onChange={(next) => save({ ...outline, sections: outline.sections.map((item) => (item.id === section.id ? next : item)) })}
            onRemove={outline.sections.length > 1 ? () => save({ ...outline, sections: outline.sections.filter((item) => item.id !== section.id) }) : undefined}
          />
        ))}
      </Section>
    </Panel>
  );
}

function TextField({ label, value, max, multiline = false, disabled, onCommit }: {
  label: string;
  value: string;
  max: number;
  multiline?: boolean;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()); };
  return (
    <Field label={label} meta={<Counter value={draft.length} max={max} />}>
      {({ id, describedBy }) => (multiline ? (
        <Textarea id={id} aria-describedby={describedBy} value={draft} rows={3} autoSize disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
      ) : (
        <Input id={id} aria-describedby={describedBy} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
      ))}
    </Field>
  );
}

function SectionFields({ index, section, sources, disabled, onChange, onRemove }: {
  index: number;
  section: OutlineSection;
  sources: { id: string; outlet: string; kind: string; url: string; excerpt: string }[];
  disabled: boolean;
  onChange: (section: OutlineSection) => void;
  onRemove?: () => void;
}) {
  const [heading, setHeading] = useState(section.heading);
  const [points, setPoints] = useState(section.points.join('\n'));
  return (
    <FieldGroup
      label={`Intertítulo ${index + 1}`}
      meta={onRemove ? <IconButton label={`Remover intertítulo ${index + 1}`} icon={Trash2} variant="ghost" size="sm" disabled={disabled} onClick={onRemove} /> : undefined}
    >
      <Field label="Texto do intertítulo">
        {({ id, describedBy }) => (
          <Input id={id} aria-describedby={describedBy} value={heading} disabled={disabled} placeholder="Intertítulo"
            onChange={(event) => setHeading(event.target.value)}
            onBlur={() => { if (heading.trim() !== section.heading) onChange({ ...section, heading: heading.trim() }); }} />
        )}
      </Field>
      <Field label="Pontos" hint="Um por linha.">
        {({ id, describedBy }) => (
          <Textarea id={id} aria-describedby={describedBy} value={points} rows={3} autoSize disabled={disabled}
            onChange={(event) => setPoints(event.target.value)}
            onBlur={() => {
              const next = points.split('\n').map((line) => line.trim()).filter(Boolean);
              if (next.join('\n') !== section.points.join('\n')) onChange({ ...section, points: next });
            }} />
        )}
      </Field>
      {sources.length > 0 ? (
        <MetaList
          size="sm"
          separator=" "
          label="Fontes do intertítulo"
          items={sources.map((source) => (
            <SourceChip
              key={source.id}
              kind={source.kind === 'archive' ? 'archive' : 'url'}
              label={source.outlet}
              state="used"
              preview={`“${source.excerpt}”`}
              onOpen={() => window.open(source.url, '_blank', 'noopener')}
              openLabel="Abrir fonte"
            />
          ))}
        />
      ) : null}
    </FieldGroup>
  );
}
