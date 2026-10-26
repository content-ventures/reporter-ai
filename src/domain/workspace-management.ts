import type { IsoDateTime, PersonId, WorkspaceId } from './ids.ts';
import { ok, refuse, type Result } from './result.ts';
import type { Role, Workspace } from './workspace.ts';

export const WORKSPACE_STATUSES = ['draft', 'active', 'archiving', 'archived'] as const;
export type WorkspaceStatus = typeof WORKSPACE_STATUSES[number];
export type MembershipStatus = 'active' | 'invited' | 'suspended';
export type WorkspaceRequirement = 'editorial_map' | 'writing_guide' | 'templates' | 'editor' | 'approver';
export type WorkspaceReadiness = { ready: boolean; missing: WorkspaceRequirement[] };

/** Client metadata extends the existing portal identity; coverage is production context. */
export type ManagedWorkspace = Workspace & {
  status: WorkspaceStatus;
  revision: number;
  updatedAt: IsoDateTime;
  pilot: boolean;
  readiness: WorkspaceReadiness;
};

/** A role belongs to this relationship, never to the global account. */
export type WorkspaceMembership = {
  id: string;
  personId: PersonId;
  workspace: Pick<ManagedWorkspace, 'id' | 'name' | 'slug' | 'status'>;
  roles: Role[];
  status: MembershipStatus;
  revision: number;
  inviteExpiresAt?: IsoDateTime;
};

export type WorkspaceAccess = {
  workspace: ManagedWorkspace;
  roles: Role[];
  /** The real platform operator enters explicitly; this never impersonates a member. */
  administrative: boolean;
};

export type WorkspaceInput = { name: string; slug: string };
export type WorkspaceChange = { workspaceId: WorkspaceId; name: string; status: Exclude<WorkspaceStatus, 'archiving'>; revision: number };
export type WorkspaceRefusal = 'restricted' | 'not_found' | 'invalid_name' | 'invalid_slug' | 'slug_taken'
  | 'invalid_state' | 'conflict' | 'self' | 'no_roles' | 'email_taken' | 'invalid_email' | 'unavailable';

export const WORKSPACE_MESSAGES: Readonly<Record<WorkspaceRefusal, string>> = {
  restricted: 'Você não tem permissão para administrar este workspace.',
  not_found: 'Este workspace ou vínculo não está disponível.',
  invalid_name: 'Informe um nome com 2 a 80 caracteres.',
  invalid_slug: 'Use de 3 a 63 letras minúsculas, números e hífens no endereço.',
  slug_taken: 'Este endereço já pertence a outro workspace.',
  invalid_state: 'Esta alteração não está disponível na situação atual.',
  conflict: 'O cadastro mudou em outra sessão. Atualize antes de salvar.',
  self: 'Você não pode retirar o próprio acesso por aqui.',
  no_roles: 'Escolha pelo menos uma função.',
  email_taken: 'Esta pessoa já tem um vínculo neste workspace.',
  invalid_email: 'Informe um e-mail válido.',
  unavailable: 'A administração não respondeu. Tente de novo.',
};

const RESERVED = new Set(['api', 'auth', 'platform', 'settings', 'workspaces', 'productions', 'login', 'logout']);
export function validateWorkspace(input: WorkspaceInput): Result<WorkspaceInput, 'invalid_name' | 'invalid_slug'> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return refuse('invalid_name', WORKSPACE_MESSAGES.invalid_name);
  const slug = input.slug.trim();
  if (slug.length < 3 || slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || RESERVED.has(slug)) {
    return refuse('invalid_slug', WORKSPACE_MESSAGES.invalid_slug);
  }
  return ok({ name, slug });
}

/** Access and generation readiness are separate: an empty client can configure its own rules. */
export function workspaceReadiness(configured: Record<WorkspaceRequirement, boolean>): WorkspaceReadiness {
  const missing = (['editorial_map', 'writing_guide', 'templates', 'editor', 'approver'] as const)
    .filter(requirement => !configured[requirement]);
  return { ready: missing.length === 0, missing };
}
