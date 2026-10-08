import { formatLaudasOf } from '../../domain/sizing.ts';
import { firstName, formatAgo, formatSince, quoteNote } from '../../ui/approval-copy.ts';
import type { DeskGroup, DeskGroupId, DeskItem, DeskView, InProgressItem, TeamStage } from '../../ports/production-queries.ts';
import { durationText, type OverviewRangeKey } from './overview-format.ts';

/**
 * Every sentence of Início (COPY §1): the summary under the title, the row lines of "Precisa de
 * você", "Em andamento" and "Equipe", the empty-queue card and the week line. Pure, with an
 * explicit `now` (and hour), so `node --test` covers them and screens never hand-format.
 */

type Instant = Date | string;

/** "Precisa de você" groups (COPY §1.2), in the desk's order. */
export const DESK_GROUP_LABELS: Readonly<Record<DeskGroupId, string>> = {
  to_approve: 'Para aprovar',
  returned: 'Devolvidos para ajuste',
  failed: 'Com erro',
  unauthorized: 'Material sem autorização',
  waiting_other: 'Aguardando outra pessoa',
};

/** "Equipe" groups (COPY §1.4). */
export const TEAM_STAGE_LABELS: Readonly<Record<TeamStage, string>> = {
  material: 'Material',
  writing: 'Escrevendo',
  approval: 'Aprovação',
  carousel: 'Carrossel',
  delivery: 'Entrega',
};

/** "Bom dia" 05–11h · "Boa tarde" 12–17h · "Boa noite" 18–04h (the viewer's local hour). */
export function greetingWord(hour: number): string {
  if (hour >= 5 && hour <= 11) return 'Bom dia';
  if (hour >= 12 && hour <= 17) return 'Boa tarde';
  return 'Boa noite';
}

/** "Bom dia, Pedro." (no name: "Bom dia."). */
export function greeting(hour: number, name?: string | null): string {
  const who = firstName(name);
  return who ? `${greetingWord(hour)}, ${who}.` : `${greetingWord(hour)}.`;
}

/** One fact per group that needs the viewer, singular and plural (COPY §1.1). */
const FACTS: Partial<Record<DeskGroupId, (count: number) => string>> = {
  to_approve: (n) => (n === 1 ? '1 peça espera sua aprovação' : `${n} peças esperam sua aprovação`),
  returned: (n) => (n === 1 ? '1 peça voltou com ajustes' : `${n} peças voltaram com ajustes`),
  failed: (n) => (n === 1 ? '1 artigo parou com erro' : `${n} artigos pararam com erro`),
  unauthorized: (n) => (n === 1 ? '1 material espera autorização' : `${n} materiais esperam autorização`),
};

/** "a, b e c". */
function joinFacts(facts: readonly string[]): string {
  if (facts.length <= 1) return facts[0] ?? '';
  return `${facts.slice(0, -1).join(', ')} e ${facts[facts.length - 1]}`;
}

/**
 * The summary sentence under "Início": greeting + what needs the viewer, in the desk's order
 * ("Boa tarde, João. 1 peça voltou com ajustes, 1 artigo parou com erro e 1 material espera
 * autorização."); nothing needs them: "Bom dia, Juliana. Nada esperando você." "Aguardando outra
 * pessoa" is never a fact (nothing to do), so the sentence agrees with the section count.
 */
export function deskSummary(input: { hour: number; name?: string | null; groups: readonly Pick<DeskGroup, 'id' | 'items'>[] }): string {
  const facts = input.groups.flatMap((group) => {
    const fact = FACTS[group.id];
    return fact && group.items.length > 0 ? [fact(group.items.length)] : [];
  });
  const head = greeting(input.hour, input.name);
  return facts.length === 0 ? `${head} Nada esperando você.` : `${head} ${joinFacts(facts)}.`;
}

const joined = (parts: readonly (string | undefined | null | false)[]) => parts.filter(Boolean).join(' · ');

/**
 * The line under a "Precisa de você" row (COPY §1.3):
 * - Para aprovar / Devolvidos: "Juliana Prates · há 2 h · “recado”" (the note cut at 80 characters);
 * - Com erro: "A IA parou na parte 2 de 4 · há 40 min" ("A IA parou · há 40 min" without parts);
 * - Material sem autorização: "Falta a autorização dos falantes";
 * - Aguardando outra pessoa: "Artigo · com Pedro desde 14:10".
 * Times need `now` (they stay out before the clock exists, as in the rest of the app).
 */
export function deskItemLine(group: DeskGroupId, item: DeskItem, now: Instant | undefined): string {
  const ago = item.at && now ? formatAgo(item.at, now) : '';
  switch (group) {
    case 'to_approve':
    case 'returned':
      return joined([item.from?.name, ago, item.note?.trim() ? quoteNote(item.note) : undefined]);
    case 'failed':
      return joined([item.progress ? `A IA parou na parte ${item.progress.current} de ${item.progress.total}` : 'A IA parou', ago]);
    case 'unauthorized':
      return 'Falta a autorização dos falantes';
    case 'waiting_other': {
      const since = item.at && now ? formatSince(item.at, now) : '';
      const who = firstName(item.withPerson?.name);
      const where = who ? `com ${who}` : 'aguardando aprovação';
      return joined([item.pieceLabel, [where, since].filter(Boolean).join(' ')]);
    }
  }
}

/** "1,6 de 2 laudas" while the production is on its article text; nothing otherwise. */
export function inProgressSize(item: Pick<InProgressItem, 'characters' | 'size'>): string | undefined {
  return item.characters !== undefined && item.characters > 0 && item.size ? formatLaudasOf(item.characters, item.size) : undefined;
}

/** "Em andamento" row: "Artigo · Rascunho · 1,6 de 2 laudas · há 20 min" (COPY §1.3). */
export function inProgressLine(item: InProgressItem, now: Instant | undefined): string {
  return joined([item.situation.line, inProgressSize(item), now ? formatAgo(item.updatedAt, now) : undefined]);
}

/** "Equipe" row: "Artigo · Aguardando aprovação de Pedro · Juliana Prates" (COPY §1.4). */
export function teamLine(item: InProgressItem): string {
  return joined([item.situation.line, item.owner.name]);
}

/** The empty-queue card: "Continuar: Estúdio Norte: impressão 3D" (COPY §1.5); the size goes under it. */
export function continueTitle(item: Pick<InProgressItem, 'productionTitle'>): string {
  return `Continuar: ${item.productionTitle}`;
}

/** Under the card title: "Artigo · Rascunho · 1,6 de 2 laudas". */
export function continueLine(item: InProgressItem): string {
  return joined([item.situation.line, inProgressSize(item)]);
}

/**
 * The quiet line at the bottom (COPY §1.2): "Esta semana: 8 em produção", "14 aprovadas", "4,5 h
 * até aprovar" (30 days: "Últimos 30 dias: …"), as `MetaList` items. A missing value leaves its
 * part out.
 */
export function weekItems(week: DeskView['week'], range: OverviewRangeKey): string[] {
  const prefix = range === '30d' ? 'Últimos 30 dias' : 'Esta semana';
  const parts = [
    `${week.inProduction} em produção`,
    week.approved === null ? undefined : week.approved === 1 ? '1 aprovada' : `${week.approved} aprovadas`,
    week.timeToApprovalMs === null ? undefined : `${durationText(week.timeToApprovalMs)} até aprovar`,
  ].filter((part): part is string => Boolean(part));
  const [first, ...rest] = parts;
  return [`${prefix}: ${first}`, ...rest];
}
