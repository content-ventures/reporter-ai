'use client';

import {
  Badge,
  DescriptionList,
  Panel,
  Section,
  Seal,
  Timeline,
  type DescriptionItem,
  type TimelineEntry,
} from '@content-ventures/design-system/v3';
import { contentHash, EXPORT_CHANNEL, shortHash, type Delivery, type DeliveryMode } from '@/domain';
import type { DeliveryView, RunView } from '@/ports';
import { channelById } from '@/registries';
import { formatDateTime, formatListDateTime, plural } from '@/ui/format';
import { Provenance } from '@/ui/provenance';
import { DELIVERY_STATUS, imageSummary, imageWarningLine, imageWarnings } from './delivery-model';

const MODE_LABELS: Record<DeliveryMode, string> = {
  download: 'Download',
  draft: 'Rascunho',
  scheduled: 'Agendada',
  published: 'Publicada',
};

/** Distinct files that left in a successful attempt (the manifest included). */
function deliveredFiles(delivery: Delivery): number {
  return new Set(delivery.attempts.filter((attempt) => attempt.status === 'succeeded').flatMap((attempt) => attempt.items ?? [])).size;
}

function attemptEntries(delivery: Delivery): TimelineEntry[] {
  return [...delivery.attempts].reverse().map((attempt, index) => {
    const count = attempt.items?.length ?? 0;
    const ok = attempt.status === 'succeeded';
    return {
      id: `${attempt.at}-${attempt.status}-${index}`,
      title: ok ? plural(count, 'arquivo exportado', 'arquivos exportados') : plural(count, 'arquivo falhou', 'arquivos falharam'),
      description: ok ? undefined : attempt.error?.message,
      date: formatListDateTime(attempt.at),
      dateTime: attempt.at,
      state: index === 0 ? 'current' : 'done',
    };
  });
}

/**
 * "Entrega": the delivery record (REQ-T.2) in one list — status ("Concluída" in gray, like every
 * finished state), channel and mode on one line, files and the last export. The Seal springs in
 * only at the moment the package fully leaves in this session; the idempotency key lives in
 * Rastreabilidade and the attempts in their own timeline.
 */
export function DeliveryRecordList({ delivery, celebrate }: { delivery: Delivery | undefined; celebrate: boolean }) {
  const status = DELIVERY_STATUS[delivery?.status ?? 'none'];
  const completed = delivery?.status === 'completed';
  const lastAttempt = delivery?.attempts.at(-1);
  const channel = channelById(delivery?.channel ?? EXPORT_CHANNEL)?.label ?? 'Exportação';
  const items: DescriptionItem[] = [
    {
      label: 'Status',
      leading: completed && celebrate ? <Seal size="md" label="" /> : undefined,
      value: (
        <Badge tone={status.tone} variant="text" dot={status.hollow ? 'hollow' : true}>
          {status.label}
        </Badge>
      ),
    },
    { label: 'Canal', value: `${channel} · ${MODE_LABELS[delivery?.mode ?? 'download']}` },
  ];
  if (delivery) {
    items.push(
      { label: 'Arquivos', value: String(deliveredFiles(delivery)), numeric: true },
      { label: 'Última', value: lastAttempt ? formatDateTime(lastAttempt.at) : undefined, numeric: true },
    );
  }
  return <DescriptionList items={items} labelWidth={96} label="Registro da entrega" />;
}

/** Each export attempt, newest first: what left, what failed and why. */
export function AttemptsTimeline({ delivery }: { delivery: Delivery }) {
  return <Timeline items={attemptEntries(delivery)} variant="dots" label="Tentativas de exportação" />;
}

/**
 * "Rastreabilidade": the chain that left with the package — material version and hash, the
 * approved article and carousel (with template), how many images left (each one's credit, origin
 * and rights are in its package row and in `manifesto.json`), and each AI run (prompt · Simulação
 * local · duration · inputs). Every hash copies in full.
 */
export function TraceabilityList({ view, runs, templateName }: { view: DeliveryView; runs: readonly RunView[]; templateName: (id: string) => string | undefined }) {
  const items: DescriptionItem[] = [];
  for (const source of view.provenance.sources) {
    items.push({ label: 'Material', value: `${source.title} · v${source.version}`, hint: `#${source.shortHash}`, copy: source.hash });
  }
  for (const item of view.items) {
    const template = item.templateId ? templateName(item.templateId) : undefined;
    const approval = [item.approvedBy?.name, item.approvedAt ? formatListDateTime(item.approvedAt) : null].filter(Boolean).join(' · ');
    items.push({
      label: `${item.label} aprovado`,
      value: [`v${item.version.number} · #${shortHash(item.version.hash)}`, template ? `modelo ${template}` : null].filter(Boolean).join(' · '),
      hint: approval || undefined,
      copy: item.version.hash,
      numeric: true,
    });
  }
  const images = imageSummary(view.files);
  // Each image's credit, origin and rights are in its package row and in manifesto.json; what is
  // missing is in the warning above the package.
  if (images) items.push({ label: 'Imagens', value: images, ...(imageWarningLine(imageWarnings(view.files)) ? {} : { hint: 'Crédito e uso autorizado em todas' }) });
  for (const run of runs) {
    items.push({ label: run.label, value: <Provenance run={run} size="xs" />, hint: run.output ? `gerou a v${run.output.number}` : undefined });
  }
  const delivery = view.latestDelivery;
  if (delivery) {
    // Keeps a retried export from counting twice.
    items.push({ label: 'Chave', value: `#${shortHash(contentHash(delivery.idempotencyKey))}`, copy: delivery.idempotencyKey, numeric: true });
  }
  return <DescriptionList items={items} labelWidth={96} label="Rastreabilidade do pacote" />;
}

export function DeliveryAside({
  view,
  runs,
  celebrate,
  templateName,
}: {
  view: DeliveryView;
  /** AI runs behind the exported versions (see `traceRuns`). */
  runs: readonly RunView[];
  celebrate: boolean;
  templateName: (id: string) => string | undefined;
}) {
  return (
    <Panel>
      <Section title="Entrega">
        <DeliveryRecordList delivery={view.latestDelivery} celebrate={celebrate} />
      </Section>
      {view.latestDelivery && view.latestDelivery.attempts.length > 1 ? (
        <Section title="Tentativas" meta={String(view.latestDelivery.attempts.length)}>
          <AttemptsTimeline delivery={view.latestDelivery} />
        </Section>
      ) : null}
      <Section title="Rastreabilidade">
        <TraceabilityList view={view} runs={runs} templateName={templateName} />
      </Section>
    </Panel>
  );
}
