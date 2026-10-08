'use client';

import { Accordion, LinkButton, MetaList, type AccordionItem, type AccordionStatus } from '@content-ventures/design-system/v3';
import type { CheckResult, CheckStatus } from '@/domain';
import { plural } from './format';

/**
 * Checks of a piece (Título · Tamanho · Citações conferidas · Trechos da IA revisados · Links…) as
 * an Accordion: check mark when it passes, amber "!" for warnings, red "!" for failures, no mark
 * for a neutral fact ("Sem capa": the DS keeps its place, so titles align). Only what applies is
 * listed (no "Não se aplica" rows), and the AI having finished the text is said only when it did
 * not. Row values read as COPY §2.6 ("9 de 12", "1 sem crédito", "1 inválido", "1,6/2 laudas").
 * An open row adds only what its line does not already say (the detail, the way to fix it).
 * The same list appears in the studio's Checagem tab and in the guided review.
 */

const STATUS: Record<CheckStatus, AccordionStatus | undefined> = {
  pass: 'done',
  warn: 'warning',
  fail: 'error',
  na: undefined,
  info: undefined,
};

/** Newsroom names for the rows whose domain label is still a technical one. */
const LABELS: Partial<Record<string, string>> = {
  'article.ai-reviewed': 'Texto revisado',
  'article.length': 'Tamanho',
  'article.generation': 'Texto da IA',
};

/** Rows whose problem is a count of what is wrong ("1 sem crédito"), not of what is right. */
const PROBLEM_FIRST = new Set(['article.image-slots', 'article.image-credits', 'article.image-alt']);

/** "3 de 4", the progress of a check, when it has one. */
export function checkProgress(check: CheckResult): string | undefined {
  return check.progress ? `${check.progress.current} de ${check.progress.total}` : undefined;
}

/** The short value at the end of the row. */
function rowMeta(check: CheckResult): string | undefined {
  if (check.meta) return check.meta;
  if (check.status === 'pass' && check.id === 'article.title') return undefined;
  if (check.id === 'article.title' && check.status !== 'pass') return 'Falta';
  if (check.id === 'article.links' && check.progress && check.status !== 'pass') {
    return plural(check.progress.total - check.progress.current, 'inválido', 'inválidos');
  }
  if (PROBLEM_FIRST.has(check.id) && check.status !== 'pass') return check.detail ?? checkProgress(check);
  return checkProgress(check) ?? check.detail;
}

/** What the list shows: the checks that apply, without a passing "the AI finished" row. */
export function visibleChecks(checks: readonly CheckResult[]): CheckResult[] {
  return checks.filter((check) => check.status !== 'na' && !(check.id === 'article.generation' && check.status === 'pass'));
}

export type ChecksListProps = {
  checks: readonly CheckResult[];
  /** "Ir ao trecho": jump to the next pending target (studio). Absent: no jump action. */
  onJump?: (check: CheckResult) => void;
  jumpLabel?: string;
  /** Rows open at first (ids); default: the failing ones. */
  defaultOpen?: string[];
  headingLevel?: 'h2' | 'h3' | 'h4';
};

export function ChecksList({ checks, onJump, jumpLabel = 'Ir ao trecho', defaultOpen, headingLevel = 'h3' }: ChecksListProps) {
  const shown = visibleChecks(checks);
  const items: AccordionItem[] = shown.map((check) => {
    const status = STATUS[check.status];
    const meta = rowMeta(check);
    const facts = [
      check.status === 'fail' && check.blocking ? 'Falta para enviar' : null,
      // The row's meta already reads the detail unless it shows a short value ("1,4/2 laudas", "3 de 4").
      meta !== check.detail ? (check.detail ?? null) : null,
      onJump && check.targets && check.targets.length > 0 && check.status !== 'pass' ? (
        <LinkButton key="jump" onClick={() => onJump(check)}>
          {jumpLabel}
        </LinkButton>
      ) : null,
    ];
    const item: AccordionItem = {
      id: check.id,
      title: LABELS[check.id] ?? check.label,
      meta,
      content: <MetaList items={facts} size="sm" />,
    };
    if (status) item.status = status;
    return item;
  });
  const open = defaultOpen ?? shown.filter((check) => check.status === 'fail').map((check) => check.id);
  return <Accordion items={items} type="multiple" defaultValue={open} headingLevel={headingLevel} />;
}
