import type { IsoDateTime, PersonId, WorkspaceId } from './ids.ts';
import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';
import { ROLES, type Role } from './workspace.ts';
import type { WorkspaceMembership } from './workspace-management.ts';

/**
 * Console da plataforma (`/platform`): the platform operator's view above every workspace. Only
 * a person who holds the platform role (granted from the terminal, never from a screen) opens it.
 * They create access by link (name, e-mail and role; the person opens the link and defines the
 * password, no e-mail is sent), change roles, suspend and restore people, approve the accounts
 * that signed up on their own, and read usage. Every write lands in the platform log.
 */

/**
 * `active`: can sign in and work. `invited`: a link is open and nobody defined a password yet.
 * `pending`: signed up on the sign-in page and waits for the operator. `suspended`: no access.
 */
export type AccessStatus = 'active' | 'invited' | 'pending' | 'suspended';

export const ACCESS_STATUSES: readonly AccessStatus[] = ['active', 'invited', 'pending', 'suspended'];

export const ACCESS_STATUS_LABELS: Readonly<Record<AccessStatus, string>> = {
  active: 'Ativo',
  invited: 'Convidado',
  pending: 'Aguardando liberação',
  suspended: 'Suspenso',
};

export type PlatformWorkspace = {
  id: WorkspaceId;
  name: string;
  slug: string;
};

/** One person as the console sees them: identity, access and where they work. */
export type PlatformPerson = {
  /** `core.users` id; a self-signed-up account still pending is `auth:<subject>`. */
  id: PersonId;
  name: string;
  email: string;
  /** Cargo, as the person wrote it on "Meu perfil". */
  title?: string;
  avatarUrl?: string;
  status: AccessStatus;
  /** Account suspension is distinct from a workspace membership's status. */
  accountStatus?: AccessStatus;
  memberships?: WorkspaceMembership[];
  workspace?: PlatformWorkspace;
  /** Workspace roles; empty while pending. */
  roles: Role[];
  /** Holds the platform role (the console's own operators). */
  operator: boolean;
  createdAt: IsoDateTime;
  /** Last sign-in or request seen for this person. */
  lastSeenAt?: IsoDateTime;
  /** Status `invited`: when the open link stops working. */
  inviteExpiresAt?: IsoDateTime;
};

/** Access created by the operator: the link is shown once and works until `expiresAt`. */
export type InviteInput = {
  name: string;
  email: string;
  role: Role;
  workspaceId: WorkspaceId;
};

export type IssuedInvite = {
  person: PlatformPerson;
  /** Raw token: only this answer carries it; the database keeps its hash. */
  token: string;
  expiresAt: IsoDateTime;
};

export const INVITE_TTL_DAYS = 7;

/** 32 random bytes in base64url. */
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function invitePath(token: string): string {
  return `/auth/invite/${token}`;
}

export const INVITE_LIMITS = { name: 80, email: 254 } as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteRefusal = 'invalid_name' | 'invalid_email' | 'invalid_role' | 'invalid_workspace';

/** Trimmed, lower-cased e-mail, one known role; refusals carry the pt-BR message. */
export function validateInvite(input: InviteInput): Result<InviteInput, InviteRefusal> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > INVITE_LIMITS.name) return refuse('invalid_name', PLATFORM_MESSAGES.invalid_name);
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > INVITE_LIMITS.email) return refuse('invalid_email', PLATFORM_MESSAGES.invalid_email);
  if (!ROLES.includes(input.role)) return refuse('invalid_role', PLATFORM_MESSAGES.invalid_role);
  if (!input.workspaceId.trim()) return refuse('invalid_workspace', PLATFORM_MESSAGES.invalid_workspace);
  return ok({ name, email, role: input.role, workspaceId: input.workspaceId.trim() });
}

/** What the invite page shows before the person defines the password. */
export type InvitePreview = {
  name: string;
  email: string;
  workspaceName: string;
  roles: Role[];
  expiresAt: IsoDateTime;
  /** `open` is the only state that accepts a password. */
  state: 'open' | 'expired' | 'used' | 'revoked';
  /** An account with this e-mail already exists: the person signs in with the password they have. */
  hasAccount: boolean;
};

export type InviteLinkRefusal = 'invalid_link' | 'expired' | 'used' | 'wrong_password' | 'unavailable';

export const INVITE_MESSAGES: Readonly<Record<InviteLinkRefusal, string>> = {
  invalid_link: 'Este link não é válido. Peça um novo ao administrador.',
  expired: 'Este link expirou. Peça um novo ao administrador.',
  used: 'Este link já foi usado. Entre com seu e-mail e senha.',
  wrong_password: 'Senha incorreta para a conta que já existe com este e-mail.',
  unavailable: 'O acesso não respondeu. Tente de novo.',
};

export const PASSWORD_LIMITS = { min: 8, max: 128 } as const;

export type PasswordRefusal = 'password_short' | 'password_long' | 'password_mismatch';

export function validateNewPassword(password: string, confirmation: string): Result<string, PasswordRefusal> {
  if (password.length < PASSWORD_LIMITS.min) return refuse('password_short', `Use pelo menos ${PASSWORD_LIMITS.min} caracteres.`);
  if (password.length > PASSWORD_LIMITS.max) return refuse('password_long', `Use até ${PASSWORD_LIMITS.max} caracteres.`);
  if (password !== confirmation) return refuse('password_mismatch', 'As senhas não conferem.');
  return ok(password);
}

/** Refusals of the console's commands. */
export type PlatformRefusal =
  | InviteRefusal
  | 'restricted'
  | 'not_found'
  | 'email_taken'
  | 'self'
  | 'no_roles'
  | 'invalid_state'
  | 'unavailable';

export const PLATFORM_MESSAGES: Readonly<Record<PlatformRefusal, string>> = {
  invalid_name: `Informe o nome com 2 a ${INVITE_LIMITS.name} caracteres.`,
  invalid_email: 'Informe um e-mail válido.',
  invalid_role: 'Escolha a função.',
  invalid_workspace: 'Escolha o workspace.',
  restricted: 'Só o operador da plataforma abre este console.',
  not_found: 'Esta pessoa não existe mais.',
  email_taken: 'Este e-mail já tem acesso.',
  self: 'Você não pode mudar o próprio acesso por aqui.',
  no_roles: 'Escolha pelo menos uma função.',
  invalid_state: 'O acesso desta pessoa mudou. Atualize a página.',
  unavailable: 'O console não respondeu. Nada foi alterado.',
};

/** Roles kept in the canonical order, without repeats; at least one. */
export function validateRoles(roles: readonly Role[]): Result<Role[], 'no_roles'> {
  const kept = ROLES.filter((role) => roles.includes(role));
  return kept.length ? ok(kept) : refuse('no_roles', PLATFORM_MESSAGES.no_roles);
}

/** What the platform log records. */
export type PlatformAction =
  | 'invite.created'
  | 'invite.renewed'
  | 'invite.accepted'
  | 'access.approved'
  | 'access.suspended'
  | 'access.restored'
  | 'roles.changed'
  | 'workspace.created'
  | 'workspace.changed'
  | 'membership.roles'
  | 'membership.suspended'
  | 'membership.restored'
  | 'account.suspended'
  | 'account.restored'
  | 'member_view.started'
  | 'member_view.ended';

export const PLATFORM_ACTION_LABELS: Readonly<Record<PlatformAction, string>> = {
  'invite.created': 'Acesso criado',
  'invite.renewed': 'Novo link gerado',
  'invite.accepted': 'Senha definida',
  'access.approved': 'Cadastro liberado',
  'access.suspended': 'Acesso suspenso',
  'access.restored': 'Acesso reativado',
  'roles.changed': 'Funções alteradas',
  'workspace.created': 'Workspace criado',
  'workspace.changed': 'Workspace alterado',
  'membership.roles': 'Funções do vínculo alteradas',
  'membership.suspended': 'Vínculo suspenso',
  'membership.restored': 'Vínculo reativado',
  'account.suspended': 'Conta suspensa',
  'account.restored': 'Conta reativada',
  'member_view.started': 'Visualização de usuário iniciada',
  'member_view.ended': 'Visualização de usuário encerrada',
};

export type PlatformLogEntry = {
  id: string;
  at: IsoDateTime;
  action: PlatformAction;
  /** `null`: the person acted on their own (defining the password). */
  actor: { id: PersonId; name: string; avatarUrl?: string } | null;
  target: { id: PersonId; name: string; email: string } | null;
  /** Roles after a change or an invite. */
  roles?: Role[];
  workspace?:PlatformWorkspace;
};
