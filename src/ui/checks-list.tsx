'use client';

import { Accordion, LinkButton, MetaList, type AccordionItem, type AccordionStatus } from '@content-ventures/design-system/v3';
import type { CheckResult, CheckStatus } from '@/domain';

/**
 * Checks of a piece (Título · Extensão · Citações conferidas · Blocos da IA revisados · Links ·
 * Geração concluída) as an Accordion: check mark when it passes, amber "!" for warnings, red "!"
 * for failures, no mark for a neutral fact ("Sem capa"). Only blocking failures stop approval
 * (`Readiness.blockers`); the row says so.
 * The same list appears in the studio's Checagem tab, in Revisão and behind the readiness meter.
 */

const STATUS: Record<CheckStatus, AccordionStatus | undefined> = {
  pass: 'done',
  warn: 'warning',
  fail: 'error',
  na: undefined,
  info: undefined,
};

/** "3/4", "812/800" — the progress of a check, when it has one. */
export function checkProgress(check: CheckResult): string | undefined {
  return check.progress ? `${check.progress.current}/${check.progress.total}` : undefined;
}

export type ChecksListProps = {
  checks: readonly CheckResult[];
  /** "Ir para o próximo": jump to the next pending target (studio). Absent: no jump action. */
  onJump?: (check: CheckResult) => void;
  jumpLabel?: string;
  /** Rows open at first (ids); default: the failing ones. */
  defaultOpen?: string[];
  headingLevel?: 'h2' | 'h3' | 'h4';
};

export function ChecksList({ checks, onJump, jumpLabel = 'Ir para o próximo', defaultOpen, headingLevel = 'h3' }: ChecksListProps) {
  const items: AccordionItem[] = checks.map((check) => {
    const status = STATUS[check.status];
    const facts = [
      check.status === 'na' ? 'Não se aplica' : check.status === 'fail' && check.blocking ? 'Bloqueia a aprovação' : null,
      check.detail ?? null,
      onJump && check.targets && check.targets.length > 0 && check.status !== 'pass' ? (
        <LinkButton key="jump" onClick={() => onJump(check)}>
          {jumpLabel}
        </LinkButton>
      ) : null,
    ];
    const item: AccordionItem = {
      id: check.id,
      title: check.label,
      meta: check.status === 'na' ? '—' : (checkProgress(check) ?? check.detail),
      content: <MetaList items={facts} size="sm" />,
      disabled: check.status === 'na',
    };
    if (status) item.status = status;
    return item;
  });
  const open = defaultOpen ?? checks.filter((check) => check.status === 'fail').map((check) => check.id);
  return <Accordion items={items} type="multiple" defaultValue={open} headingLevel={headingLevel} />;
}
