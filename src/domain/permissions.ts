import { refuse } from './result.ts';
import type { Member, Role } from './workspace.ts';

/**
 * What each role may do: one table read by the UI (to hide what a person cannot do), the shared
 * store commands (simulated and server engine) and the server routes outside the engine. Gate
 * decisions (`decide`) and the sender rule ("Retirar envio") keep their own rules.
 */

export type Capability =
  /** "Nova produção", "Escrever do zero", upload, link and material analysis. */
  | 'production.create'
  /** Title, brief, speakers, people and material authorisation. */
  | 'production.edit'
  | 'production.archive'
  /** Draft, cover and images, versions, restore, carousel, suggestions, generation and assistant. */
  | 'piece.edit'
  /** "Enviar para aprovação". */
  | 'piece.send'
  /** Download of the delivery package. */
  | 'delivery.record'
  /** 👍/👎 on AI output and "Retorno do piloto". */
  | 'feedback.record'
  /** Prompts (pipeline configuration). */
  | 'pipeline.edit'
  /** Logs. */
  | 'audit.read'
  /** Visual library, banners and citations. */
  | 'library.edit'
  /** Own name, role and organisation. */
  | 'profile.edit_self';

const WRITERS: readonly Role[] = ['editor', 'admin'];
const ADMINS: readonly Role[] = ['admin'];

export const CAPABILITY_ROLES: Readonly<Record<Capability, readonly Role[]>> = {
  'production.create': WRITERS,
  'production.edit': WRITERS,
  'production.archive': WRITERS,
  'piece.edit': WRITERS,
  'piece.send': WRITERS,
  'delivery.record': WRITERS,
  'feedback.record': WRITERS,
  'pipeline.edit': ADMINS,
  'audit.read': ADMINS,
  'library.edit': WRITERS,
  'profile.edit_self': ['editor', 'approver', 'creative_reviewer', 'admin'],
};

/** The pt-BR name of each role, lower case for sentences ("Só editor ou admin…"). */
export const ROLE_NAMES: Readonly<Record<Role, string>> = { editor: 'editor', approver: 'aprovador', creative_reviewer: 'revisor criativo', admin: 'admin' };

/** "Revisor criativo": the role as a label (account, profile switch, audit trail). */
export function roleLabel(role: Role): string {
  const name = ROLE_NAMES[role] ?? role;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What each capability lets a person do, as the end of "Só editor ou admin …". */
const ACTIONS: Readonly<Record<Capability, string>> = {
  'production.create': 'cria produções',
  'production.edit': 'edita a produção',
  'production.archive': 'arquiva produções',
  'piece.edit': 'edita o conteúdo',
  'piece.send': 'envia para aprovação',
  'delivery.record': 'baixa a entrega',
  'feedback.record': 'avalia a IA',
  'pipeline.edit': 'edita os prompts',
  'audit.read': 'consulta os logs',
  'library.edit': 'edita a biblioteca',
  'profile.edit_self': 'edita o perfil',
};

/** "editor ou admin", "aprovador, revisor criativo ou admin". */
export function roleList(roles: readonly Role[]): string {
  const names = roles.map((role) => ROLE_NAMES[role]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}` : (names[0] ?? 'quem tem o papel');
}

type Holder = Pick<Member, 'roles'> | readonly Role[] | undefined;

function rolesOf(holder: Holder): readonly Role[] {
  if (!holder) return [];
  return Array.isArray(holder) ? (holder as readonly Role[]) : (holder as Pick<Member, 'roles'>).roles;
}

/** Fails closed: no member, no capability. */
export function can(holder: Holder, capability: Capability): boolean {
  const roles = rolesOf(holder);
  return roles.some((role) => CAPABILITY_ROLES[capability].includes(role));
}

/** "Só editor ou admin cria produções." — the one sentence the permission dialog shows. */
export function whoCan(capability: Capability): string {
  return `Só ${roleList(CAPABILITY_ROLES[capability])} ${ACTIONS[capability]}.`;
}

export const FORBIDDEN_TITLE = 'Você não tem permissão para isso';

/** The refusal every command returns to a member without the capability; nothing changes. */
export function forbidden(capability: Capability): { ok: false; refusal: { code: 'forbidden'; message: string; details?: Record<string, unknown> } } {
  return refuse('forbidden', whoCan(capability), { capability });
}

/** Refusal codes the permission dialog reports, wherever they come from. */
export const PERMISSION_REFUSALS: ReadonlySet<string> = new Set(['forbidden', 'forbidden_role', 'self_decision']);
