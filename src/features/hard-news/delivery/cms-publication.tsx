'use client';

import { useState } from 'react';
import {
  ActionBar,
  Alert,
  Button,
  ButtonLink,
  Counter,
  DescriptionList,
  Field,
  Grid,
  Input,
  LinkButton,
  MetaList,
  Panel,
  Section,
  Select,
  TagInput,
  TextLink,
  Textarea,
  formatRelative,
} from '@content-ventures/design-system/v3';
import { ArrowUpRight, Send } from '@content-ventures/design-system/v3/icons';
import { CMS_MODE_LABELS, slugify } from '@/domain/hard-news';
import type { CmsDelivery } from '@/domain/hard-news';
import { useCan, useVersion } from '@/state';
import { DemoBadge } from '../demo-badge';
import { useDossier, useHardNews } from '../state/hard-news-provider';

const EXCERPT_MAX = 200;

/**
 * F2.10 · "Portal": the approved article goes to the connected CMS in the agreed mode (R2 starts
 * with drafts). Category, author, slug, excerpt and tags first; then the CMS answer stays on the
 * page: the post id and its address, or the failure with "Tentar de novo". A newer approved
 * version updates the same post (REQ-2.10: never a second one).
 */
export function CmsPublication({ productionId, title, lead, version, owner }: {
  productionId: string;
  title: string;
  lead: string;
  /** Approved article version on its way out. */
  version: number;
  owner: string;
}) {
  const { state, actions } = useHardNews();
  const canDeliver = useCan('delivery.record');
  const cms = state.cms;
  const saved = state.deliveries[productionId];
  const keywords = state.dossiers[productionId]?.outline?.keywords ?? [];
  const delivery: CmsDelivery = saved ?? {
    productionId,
    state: 'idle',
    slug: slugify(title),
    tags: keywords,
    excerpt: lead.length > EXCERPT_MAX ? `${lead.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : lead,
    authorId: cms.authorMap[owner],
    attempts: 0,
  };
  const [tried, setTried] = useState(false);
  const patch = (next: Partial<CmsDelivery>) => actions.saveDelivery(productionId, { ...delivery, ...next });
  const missingCategory = cms.requires.category && !delivery.categoryId;
  const missingExcerpt = cms.requires.excerpt && !delivery.excerpt.trim();
  const sending = delivery.state === 'sending';
  const sent = delivery.state === 'sent';
  const outdated = sent && delivery.sentVersion !== undefined && delivery.sentVersion < version;
  const locked = sent && !outdated;

  async function send() {
    setTried(true);
    if (missingCategory || missingExcerpt) return;
    if (!saved) actions.saveDelivery(productionId, delivery);
    await actions.sendToCms(productionId, version);
  }

  if (cms.status === 'disconnected') {
    return (
      <Panel label="Portal">
        <Section title="Portal" action={<DemoBadge />}>
          <Alert tone="info" title="CMS não conectado" action={<ButtonLink href="/admin/integrations" size="sm">Conectar</ButtonLink>} />
        </Section>
      </Panel>
    );
  }

  return (
    <Panel label="Portal" padding="lg">
      <Section
        title="Portal"
        meta={<MetaList size="sm" items={[cms.platform, new URL(cms.siteUrl).host, CMS_MODE_LABELS[cms.mode]]} />}
        action={<DemoBadge />}
      >
        {sent ? (
          <Alert
            tone={outdated ? 'warning' : 'success'}
            title={outdated ? `O CMS tem a v${delivery.sentVersion}; a aprovada agora é a v${version}` : `${CMS_MODE_LABELS[cms.mode]} criado no CMS`}
            action={delivery.url ? <TextLink href={delivery.url} target="_blank" rel="noreferrer">Abrir no CMS</TextLink> : undefined}
          >
            <MetaList size="sm" items={[`Post ${delivery.remoteId}`, `v${delivery.sentVersion}`, delivery.sentAt ? formatRelative(new Date(delivery.sentAt)) : null]} />
          </Alert>
        ) : null}
        {delivery.state === 'failed' ? (
          <Alert tone="danger" title="O CMS não recebeu o artigo" action={canDeliver ? <LinkButton onClick={() => void send()}>Tentar de novo</LinkButton> : undefined}>
            {delivery.error}
          </Alert>
        ) : null}
        {locked ? (
          <DescriptionList
            label="Enviado ao CMS"
            items={[
              { label: 'Editoria', value: cms.categories.find((option) => option.id === delivery.categoryId)?.label ?? '—' },
              { label: 'Autor', value: cms.authors.find((option) => option.id === delivery.authorId)?.label ?? 'Redação' },
              { label: 'Endereço', value: `${new URL(cms.siteUrl).host}/${delivery.slug}` },
              { label: 'Linha fina', value: delivery.excerpt },
              { label: 'Tags', value: delivery.tags.length ? delivery.tags.join(', ') : '—' },
            ]}
          />
        ) : (
          <>
          <Grid columns="1:1">
            <Field label="Editoria" required error={tried && missingCategory ? 'Escolha a editoria.' : undefined}>
              {({ id, describedBy, invalid }) => (
                <Select id={id} describedBy={describedBy} invalid={invalid} disabled={locked || sending || !canDeliver} placeholder="Escolha" value={delivery.categoryId ?? ''} options={cms.categories.map((option) => ({ value: option.id, label: option.label }))} onChange={(categoryId) => patch({ categoryId })} />
              )}
            </Field>
            <Field label="Autor no portal">
              {({ id, describedBy }) => (
                <Select id={id} describedBy={describedBy} disabled={locked || sending || !canDeliver} value={delivery.authorId ?? 'wp-redacao'} options={cms.authors.map((option) => ({ value: option.id, label: option.label }))} onChange={(authorId) => patch({ authorId })} />
              )}
            </Field>
          </Grid>
          <Field label="Endereço" hint={`${new URL(cms.siteUrl).host}/${delivery.slug || 'endereco-do-artigo'}`}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} value={delivery.slug} disabled={locked || sending || !canDeliver} onChange={(event) => patch({ slug: slugify(event.target.value) || event.target.value.toLowerCase() })} />
            )}
          </Field>
          <Field label="Linha fina" required meta={<Counter value={delivery.excerpt.length} max={EXCERPT_MAX} />} error={tried && missingExcerpt ? 'Escreva a linha fina.' : undefined}>
            {({ id, describedBy, invalid }) => (
              <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={2} autoSize value={delivery.excerpt} disabled={locked || sending || !canDeliver} onChange={(event) => patch({ excerpt: event.target.value })} />
            )}
          </Field>
          <Field label="Tags" optional>
            {({ id, describedBy }) => (
              <TagInput id={id} describedBy={describedBy} values={delivery.tags} disabled={locked || sending || !canDeliver} suggestions={keywords} onChange={(tags) => patch({ tags })} />
            )}
          </Field>
          </>
        )}
        {canDeliver && !locked ? (
          <ActionBar position="static" detail={cms.status === 'failing' ? 'A conexão com o CMS falhou no último teste.' : undefined}>
            <Button variant="primary" icon={outdated ? ArrowUpRight : Send} loading={sending} onClick={() => void send()}>
              {outdated ? `Atualizar no CMS com a v${version}` : `Enviar ao CMS como ${CMS_MODE_LABELS[cms.mode].toLowerCase()}`}
            </Button>
          </ActionBar>
        ) : null}
      </Section>
    </Panel>
  );
}

/**
 * The "Portal" block of Entrega for a covered news story (nothing for any other production): reads
 * the approved version's title and lead and hands them to `CmsPublication`.
 */
export function DeskPublication({ productionId, versionId, versionNumber, owner }: {
  productionId: string;
  versionId: string;
  versionNumber: number;
  owner: string;
}) {
  const dossier = useDossier(productionId);
  const version = useVersion(versionId);
  const body = version.data?.body.type === 'article' ? version.data.body : undefined;
  if (!dossier || !body) return null;
  const lead = body.blocks.find((block) => block.type === 'paragraph');
  const leadText = lead && 'inlines' in lead ? lead.inlines.map((inline) => inline.text).join('') : '';
  return <CmsPublication productionId={productionId} title={body.title} lead={leadText} version={versionNumber} owner={owner} />;
}
