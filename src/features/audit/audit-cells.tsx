'use client';

import { Avatar, Badge, Button, MetaList, TextLink, Tooltip } from '@content-ventures/design-system/v3';
import { AUDIT_RESULT_LABELS, type AuditResult } from '@/domain';
import type { AuditEntry } from '@/ports';
import { deliveryHref, materialHref, pieceHref, productionHref } from '@/ui/routes';
import { actionDetail, itemContext, itemLabel, RESULT_TONES } from './audit-format';

/**
 * Cells of the Logs table. Each reads only its entry; a record links to where it lives while its
 * production still exists here (sessions, pages and members have no page of their own in R1).
 */

/** Where the record of an entry opens, if anywhere. */
export function itemHref(entry: Pick<AuditEntry, 'target' | 'productionAvailable'>): string | undefined {
  const target = entry.target;
  if (!target?.productionId || entry.productionAvailable === false) return undefined;
  switch (target.kind) {
    case 'production':
      return productionHref(target.productionId);
    case 'source':
      return materialHref(target.productionId);
    case 'package':
      return deliveryHref(target.productionId);
    case 'piece':
    case 'version':
      return target.pieceKind ? pieceHref(target.productionId, target.pieceKind) : productionHref(target.productionId);
    default:
      return undefined;
  }
}

export function ResultBadge({ result, wrap = false }: { result: AuditResult; wrap?: boolean }) {
  return (
    <Badge tone={RESULT_TONES[result]} variant="text" size="sm" wrap={wrap}>
      {AUDIT_RESULT_LABELS[result]}
    </Badge>
  );
}

/** "Acesso negado" and, below, why (or which fields changed). */
export function ActionCell({ entry }: { entry: AuditEntry }) {
  const detail = actionDetail(entry);
  return (
    <>
      {entry.title}
      {detail && <MetaList size="sm" wrap={false} items={[detail]} />}
    </>
  );
}

/** "Artigo v4" (a link while the production exists) and its production below; a sign-in shows its device and IP. */
export function ItemCell({ entry }: { entry: AuditEntry }) {
  const href = itemHref(entry);
  const label = itemLabel(entry);
  return (
    <>
      {href ? (
        <TextLink href={href} tone="inherit">
          {label}
        </TextLink>
      ) : (
        label
      )}
      <MetaList size="sm" wrap={false} items={[itemContext(entry)]} />
    </>
  );
}

/**
 * Person orb + name; a click shows only that person's events (again: everyone). Same pattern as
 * "Responsável" in Produções.
 */
export function PersonCell({ entry, active, onToggle }: { entry: AuditEntry; active: boolean; onToggle: () => void }) {
  const name = entry.actor?.name ?? 'Sistema';
  return (
    <Tooltip content={active ? 'Mostrar todas as pessoas' : `Ver só ${name}`}>
      <Button variant="ghost" size="sm" onClick={onToggle}>
        <Avatar name={name} src={entry.actor?.avatarUrl} size="xs" decorative />
        {name}
      </Button>
    </Tooltip>
  );
}
