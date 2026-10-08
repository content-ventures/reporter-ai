import type { ActivityId, ActorId, IsoDateTime, ProductionId, WorkspaceId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import type { Role } from './workspace.ts';

/**
 * Audit trail (F1.7, REQ-T.1): who did what, to which record, with which result. R1 reads it
 * only: the local adapter mirrors the semantic activity feed (CRUD, approvals, exports), adds
 * sign-ins, access denials and field updates, and the Conexão persists the same shape in a
 * server-side table. Values that identify a person or a device are stored already masked.
 */

export type AuditEventId = string;

/** `denied`: the rule refused the action (role, ownership). `failure`: it was allowed but failed. */
export type AuditResult = 'success' | 'denied' | 'failure';

export const AUDIT_RESULTS: readonly AuditResult[] = ['success', 'denied', 'failure'];

export const AUDIT_RESULT_LABELS: Record<AuditResult, string> = {
  success: 'Sucesso',
  denied: 'Negado',
  failure: 'Falha',
};

export type AuditAction =
  | 'auth.signed_in'
  | 'auth.signed_out'
  | 'access.denied'
  | 'production.created'
  | 'production.updated'
  | 'production.archived'
  | 'source.created'
  | 'source.updated'
  | 'source.authorized'
  | 'article.generated'
  | 'article.updated'
  | 'article.restored'
  | 'carousel.generated'
  | 'carousel.updated'
  | 'carousel.restored'
  | 'review.requested'
  | 'review.approved'
  | 'review.returned'
  | 'package.exported'
  | 'member.updated';

/** "Tipo" filter of the Logs screen: the area an action belongs to. */
export type AuditType = 'session' | 'access' | 'production' | 'source' | 'article' | 'carousel' | 'review' | 'delivery' | 'team';

export const AUDIT_TYPES: readonly AuditType[] = ['session', 'access', 'production', 'source', 'article', 'carousel', 'review', 'delivery', 'team'];

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  session: 'Login e sessão',
  access: 'Acesso',
  production: 'Produção',
  source: 'Transcrição',
  article: 'Artigo',
  carousel: 'Carrossel',
  review: 'Aprovação',
  delivery: 'Entrega',
  team: 'Equipe',
};

type ActionEntry = { type: AuditType; titles: { success: string } & Partial<Record<Exclude<AuditResult, 'success'>, string>> };

/** pt-BR line of each action per result ("Artigo atualizado", "Edição do artigo negada"). */
export const AUDIT_ACTIONS: Record<AuditAction, ActionEntry> = {
  'auth.signed_in': { type: 'session', titles: { success: 'Login realizado', denied: 'Login bloqueado', failure: 'Login recusado' } },
  'auth.signed_out': { type: 'session', titles: { success: 'Sessão encerrada' } },
  'access.denied': { type: 'access', titles: { success: 'Acesso liberado', denied: 'Acesso negado' } },
  'production.created': { type: 'production', titles: { success: 'Produção criada', failure: 'Falha ao criar a produção' } },
  'production.updated': { type: 'production', titles: { success: 'Produção atualizada', denied: 'Edição da produção negada', failure: 'Falha ao atualizar a produção' } },
  'production.archived': { type: 'production', titles: { success: 'Produção arquivada', denied: 'Arquivamento negado' } },
  'source.created': { type: 'source', titles: { success: 'Transcrição criada', failure: 'Falha ao enviar a transcrição' } },
  'source.updated': { type: 'source', titles: { success: 'Transcrição atualizada', denied: 'Edição da transcrição negada', failure: 'Falha ao atualizar a transcrição' } },
  'source.authorized': { type: 'source', titles: { success: 'Uso da transcrição autorizado' } },
  'article.generated': { type: 'article', titles: { success: 'Artigo gerado', failure: 'Geração do artigo falhou' } },
  'article.updated': { type: 'article', titles: { success: 'Artigo atualizado', denied: 'Edição do artigo negada', failure: 'Falha ao salvar o artigo' } },
  'article.restored': { type: 'article', titles: { success: 'Versão do artigo restaurada' } },
  'carousel.generated': { type: 'carousel', titles: { success: 'Carrossel gerado', failure: 'Geração do carrossel falhou' } },
  'carousel.updated': { type: 'carousel', titles: { success: 'Carrossel atualizado', denied: 'Edição do carrossel negada', failure: 'Falha ao salvar o carrossel' } },
  'carousel.restored': { type: 'carousel', titles: { success: 'Versão do carrossel restaurada' } },
  'review.requested': { type: 'review', titles: { success: 'Aprovação solicitada' } },
  'review.approved': { type: 'review', titles: { success: 'Aprovação registrada', denied: 'Aprovação negada' } },
  'review.returned': { type: 'review', titles: { success: 'Ajustes solicitados', denied: 'Devolução negada' } },
  'package.exported': { type: 'delivery', titles: { success: 'Pacote exportado', failure: 'Exportação falhou' } },
  'member.updated': { type: 'team', titles: { success: 'Papéis atualizados', denied: 'Mudança de papel negada' } },
};

export const AUDIT_ACTION_IDS = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function auditTypeOf(action: AuditAction): AuditType {
  return AUDIT_ACTIONS[action].type;
}

/** "Artigo atualizado"; an action without a line for that result reads "<sucesso> · <resultado>". */
export function auditTitle(action: AuditAction, result: AuditResult): string {
  const titles = AUDIT_ACTIONS[action].titles;
  return titles[result] ?? `${titles.success} · ${AUDIT_RESULT_LABELS[result]}`;
}

export type AuditTargetKind = 'session' | 'page' | 'production' | 'source' | 'piece' | 'version' | 'package' | 'member';

/** The record an event touched, named as it was at the time ("Artigo v4", "Logs", "Juliana Prates"). */
export type AuditTarget = {
  kind: AuditTargetKind;
  /** Record id; the route for a page (`/admin/audit`). */
  id: string;
  label: string;
  productionId?: ProductionId;
  pieceKind?: PieceKind;
};

/** One field of an update: display text before and after (already masked when sensitive). */
export type AuditChange = { field: string; before: string; after: string };

/** Where the request came from. `device` and `ip` are stored masked. */
export type AuditOrigin = {
  channel: 'web' | 'system';
  /** "Chrome · macOS", "Este navegador". */
  device?: string;
  /** Masked: "189.6.•••.•••". */
  ip?: string;
};

export type AuditEvent = {
  id: AuditEventId;
  workspaceId: WorkspaceId;
  at: IsoDateTime;
  actorId: ActorId;
  action: AuditAction;
  result: AuditResult;
  target?: AuditTarget;
  /** `*.updated`: what changed, field by field. */
  changes?: AuditChange[];
  /** pt-BR reason of a denial or a failure, as the person saw it. */
  reason?: string;
  origin: AuditOrigin;
  /** Correlates the entry with the request or run that produced it. */
  requestId: string;
  /** The activity event this entry mirrors, when it comes from the feed. */
  activityId?: ActivityId;
};

/** Roles that may read the trail (F1.7: "página de Logs restrita e somente leitura"). */
export const AUDIT_READER_ROLES: readonly Role[] = ['admin'];

export const AUDIT_RESTRICTED_MESSAGE = 'Somente administradores consultam os logs.';

export function canReadAudit(roles: readonly Role[] | undefined): boolean {
  return Boolean(roles?.some((role) => AUDIT_READER_ROLES.includes(role)));
}

const MASK = '•••';

/** "189.6.44.120" → "189.6.•••.•••"; IPv6 keeps its first two groups. */
export function maskIp(ip: string): string {
  const v4 = ip.split('.');
  if (v4.length === 4) return `${v4[0]}.${v4[1]}.${MASK}.${MASK}`;
  const v6 = ip.split(':').filter(Boolean);
  return v6.length >= 2 ? `${v6[0]}:${v6[1]}:${MASK}` : MASK;
}

/** Newest first; same instant → higher id first (ids grow with time). */
export function compareAuditDesc(a: Pick<AuditEvent, 'at' | 'id'>, b: Pick<AuditEvent, 'at' | 'id'>): number {
  return Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
