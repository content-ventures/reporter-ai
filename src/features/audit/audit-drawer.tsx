'use client';

import {
  AccessState,
  DescriptionList,
  DiffView,
  Drawer,
  MetaList,
  Section,
  TextLink,
  type DescriptionItem,
  type DiffBlock,
} from '@content-ventures/design-system/v3';
import { AUDIT_TYPE_LABELS, diffWords } from '@/domain';
import type { AuditChange } from '@/domain';
import type { AuditEntry } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { RelativeTime } from '@/ui/time';
import { itemHref, ResultBadge } from './audit-cells';
import { auditInstant, itemContext, itemLabel, originLabel } from './audit-format';

/**
 * One event of the trail (F1.7): result, who, when to the second, what it touched (with a link
 * while the production exists), why it was refused or failed, where it came from (device and a
 * masked IP), each changed field before → after, and the ids to cross-check with the server.
 */

function changeBlocks(change: AuditChange): DiffBlock[] {
  return [{ id: change.field, change: 'modified', hunks: diffWords(change.before, change.after) }];
}

function facts(entry: AuditEntry): DescriptionItem[] {
  const href = itemHref(entry);
  const label = itemLabel(entry);
  const items: DescriptionItem[] = [
    { label: 'Resultado', value: <ResultBadge result={entry.result} /> },
    { label: 'Quando', value: auditInstant(entry.at), numeric: true },
    { label: 'Tipo', value: AUDIT_TYPE_LABELS[entry.type] },
  ];
  if (entry.target) {
    items.push({
      label: 'Item',
      value: href ? (
        <TextLink href={href} tone="inherit">
          {label}
        </TextLink>
      ) : (
        label
      ),
      hint: entry.target.kind === 'production' ? undefined : itemContext(entry),
    });
  }
  if (entry.reason) items.push({ label: entry.result === 'failure' ? 'Erro' : 'Motivo', value: entry.reason });
  items.push({ label: 'Origem', value: originLabel(entry) });
  if (entry.origin.ip) items.push({ label: 'Endereço IP', value: entry.origin.ip, numeric: true });
  return items;
}

function ids(entry: AuditEntry): DescriptionItem[] {
  const items: DescriptionItem[] = [
    { label: 'Evento', value: entry.id, copy: entry.id, numeric: true },
    { label: 'Requisição', value: entry.requestId, copy: entry.requestId, numeric: true },
  ];
  if (entry.target && entry.target.kind !== 'page') items.push({ label: 'Registro', value: entry.target.id, copy: entry.target.id, numeric: true });
  if (entry.activityId) items.push({ label: 'Atividade', value: entry.activityId, copy: entry.activityId, numeric: true });
  return items;
}

export type AuditDrawerProps = {
  open: boolean;
  onClose: () => void;
  entry: AuditEntry | undefined;
  /** The entry is on its way (a shared `?event=` link outside the current page). */
  loading: boolean;
  /** The id does not resolve (removed, another workspace). */
  missing: boolean;
};

export function AuditDrawer({ open, onClose, entry, loading, missing }: AuditDrawerProps) {
  const who = entry ? (entry.actor?.name ?? 'Sistema') : undefined;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      title={entry?.title ?? (missing ? 'Evento não encontrado' : 'Evento')}
      description={entry ? <MetaList size="sm" items={[who, <RelativeTime key="at" at={entry.at} />]} /> : undefined}
      leading={entry ? <PersonAvatar person={entry.actor} name="Sistema" size="md" decorative /> : undefined}
      closeLabel="Fechar evento"
    >
      {entry ? (
        <>
          <Section>
            <DescriptionList label="Detalhes do evento" items={facts(entry)} labelWidth={120} />
          </Section>
          {entry.changes?.map((change) => (
            <Section key={change.field} title={change.field} titleAs="h3">
              <DiffView
                blocks={changeBlocks(change)}
                before={{ label: 'Antes' }}
                after={{ label: 'Depois' }}
                size="compact"
                summary={false}
                label={`${change.field}: antes e depois`}
              />
            </Section>
          ))}
          <Section title="Identificadores" titleAs="h3">
            <DescriptionList label="Identificadores do evento" items={ids(entry)} labelWidth={120} />
          </Section>
        </>
      ) : missing ? (
        <AccessState kind="not-found" size="panel" title="Este evento não está no registro" />
      ) : (
        <DescriptionList label="Detalhes do evento" items={[]} loading={loading} loadingRows={6} labelWidth={120} />
      )}
    </Drawer>
  );
}
