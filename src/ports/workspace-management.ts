import type { PersonId, WorkspaceId } from '../domain/ids.ts';
import type { InviteInput, IssuedInvite } from '../domain/platform.ts';
import type { Result } from '../domain/result.ts';
import type { Role } from '../domain/workspace.ts';
import type { ManagedWorkspace, MembershipStatus, WorkspaceAccess, WorkspaceChange, WorkspaceInput, WorkspaceMembership, WorkspaceRefusal } from '../domain/workspace-management.ts';
import type { IntegrationChange, IssuedIntegration, WorkspaceIntegration } from '../domain/workspace-management.ts';

export type WorkspaceResult<T> = Result<T, WorkspaceRefusal>;
export type WorkspacePage = { items: ManagedWorkspace[]; total: number; offset: number };
export type WorkspaceAccessPage = { items: WorkspaceAccess[]; total: number; offset: number; administrative: boolean };
export type WorkspaceSearch = { search?: string; offset?: number; limit?: number };
export type MembershipChange = { workspaceId: WorkspaceId; personId: PersonId; revision: number };

/** Server-authorized administration. No method grants a platform role or changes a password. */
export interface WorkspaceAdministration {
  list(options: { search?: string; offset?: number; limit?: number }): Promise<WorkspaceResult<WorkspacePage>>;
  create(input: WorkspaceInput): Promise<WorkspaceResult<ManagedWorkspace>>;
  update(input: WorkspaceChange): Promise<WorkspaceResult<ManagedWorkspace>>;
  members(workspaceId: WorkspaceId): Promise<WorkspaceResult<WorkspaceMembership[]>>;
  invite(input: InviteInput): Promise<WorkspaceResult<IssuedInvite>>;
  renewInvite(input: MembershipChange): Promise<WorkspaceResult<IssuedInvite>>;
  setRoles(input: MembershipChange & { roles: Role[] }): Promise<WorkspaceResult<WorkspaceMembership>>;
  setStatus(input: MembershipChange & { status: Extract<MembershipStatus, 'active' | 'suspended'> }): Promise<WorkspaceResult<WorkspaceMembership>>;
  integrations(workspaceId:WorkspaceId):Promise<WorkspaceResult<WorkspaceIntegration[]>>;
  saveIntegration(input:IntegrationChange):Promise<WorkspaceResult<IssuedIntegration>>;
}

/** A tab chooses its addressable context; navigation preference is never authorization. */
export interface WorkspaceDirectory {
  accessible(options?: WorkspaceSearch): Promise<WorkspaceResult<WorkspaceAccessPage>>;
}
