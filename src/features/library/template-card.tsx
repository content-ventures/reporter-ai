'use client';

import { Badge, Card, CardHeader, CardLink, ChoiceCard, LinkButton, MediaFrame } from '@content-ventures/design-system/v3';
import type { AssetId, TemplateId } from '@/domain';
import type { TemplateInfo } from '@/ports';
import { statusBadge } from './library-model';
import { useTemplateThumbnail } from './use-template-images';

/**
 * A model of the library as a card: its cover drawn by the RenderService (the creative itself,
 * content and not UI) at the model's own proportion, the name — with "Aprovado" when Marketing
 * approved it — and its one-line description. `TemplateCard` opens the model (the "Modelos"
 * page); `TemplateChoice` is the same card as a radio, with "Ver modelo" outside the choosing area
 * (the carousel's start and "Trocar modelo").
 */

export type TemplateCover = {
  /** The article's featured image (or the library's sample photo), for models that draw it. */
  articleCover?: AssetId;
  /** The carousel's own cover texts instead of the sample copy. */
  slots?: Readonly<Record<string, string>>;
};

/** The cover at the model's proportion (the grid shows one format at a time). */
export function TemplateThumb({ template, cover }: { template: TemplateInfo; cover?: TemplateCover }) {
  const image = useTemplateThumbnail(template.id, cover);
  const state = image.src ? undefined : image.status === 'error' ? 'error' : 'loading';
  return <MediaFrame ratio={template.formatInfo.ratio} src={image.src} alt="" fit="contain" radius="sm" state={state} />;
}

function ApprovedBadge({ template }: { template: TemplateInfo }) {
  const badge = statusBadge(template.status);
  return badge ? (
    <Badge tone={badge.tone} size="sm">
      {badge.label}
    </Badge>
  ) : null;
}

function line(template: TemplateInfo, note: string | undefined): string {
  return note ? `${template.description} · ${note}` : template.description;
}

export function TemplateCard({
  template,
  cover,
  note,
  onOpen,
}: {
  template: TemplateInfo;
  cover?: TemplateCover;
  /** Appended to the line under the name ("Padrão"). */
  note?: string;
  onOpen: (id: TemplateId) => void;
}) {
  return (
    <Card as="div" padding="sm" interactive>
      <TemplateThumb template={template} cover={cover} />
      <CardHeader
        size="sm"
        titleAs="h2"
        title={<CardLink onClick={() => onOpen(template.id)}>{template.name}</CardLink>}
        badge={<ApprovedBadge template={template} />}
        description={line(template, note)}
      />
    </Card>
  );
}

export function TemplateChoice({
  template,
  name,
  checked,
  onChange,
  onPreview,
  cover,
  note,
}: {
  template: TemplateInfo;
  /** Radio group name. */
  name: string;
  checked: boolean;
  onChange: (id: TemplateId) => void;
  onPreview: (id: TemplateId) => void;
  cover?: TemplateCover;
  /** Appended to the line under the name ("Em uso"). */
  note?: string;
}) {
  return (
    <ChoiceCard
      name={name}
      value={template.id}
      checked={checked}
      onChange={onChange}
      media={<TemplateThumb template={template} cover={cover} />}
      title={
        template.status === 'aprovado' ? (
          <>
            {template.name} <ApprovedBadge template={template} />
          </>
        ) : (
          template.name
        )
      }
      description={line(template, note)}
      footer={
        <LinkButton onClick={() => onPreview(template.id)} aria-label={`Ver modelo ${template.name}`}>
          Ver modelo
        </LinkButton>
      }
    />
  );
}
