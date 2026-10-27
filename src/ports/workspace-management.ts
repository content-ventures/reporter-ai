import type { PersonId, WorkspaceId } from '../domain/ids.ts';
import type { InviteInput, IssuedInvite } from '../domain/platform.ts';
import type { Result } from '../domain/result.ts';
import type { Role } from '../domain/workspace.ts';
import type { ManagedWorkspace, MembershipStatus, WorkspaceAccess, WorkspaceChange, WorkspaceInput, WorkspaceMembership, WorkspaceRefusal,WorkspaceTeamMember } from '../domain/workspace-management.ts';
import type {WorkspaceBrandAsset,WorkspaceTemplateConfiguration,WorkspaceTemplateInput} from '../domain/workspace-templates.ts';
import type {ConfigurationCopyField,ConfigurationCopyPreview} from '../domain/configuration-copy.ts';
import type {Unsubscribe} from './common.ts';
import type { IntegrationChange, IssuedIntegration, WorkspaceIntegration } from '../domain/workspace-management.ts';
import type { WorkspaceProcessing } from '../domain/workspace-management.ts';

export type WorkspaceResult<T> = Result<T, WorkspaceRefusal>;
export type WorkspacePage = { items: ManagedWorkspace[]; total: number; offset: number };
export type WorkspaceAccessPage = { items: WorkspaceAccess[]; total: number; offset: number; administrative: boolean;account?:{id:PersonId;name:string;email:string;avatarUrl?:string}|null };
export type WorkspaceSearch = { search?: string; offset?: number; limit?: number };
export type MembershipChange = { workspaceId: WorkspaceId; personId: PersonId; revision: number };
export type WorkspaceTeamPage={items:WorkspaceTeamMember[];total:number;offset:number};

/** Server-authorized administration. No method grants a platform role or changes a password. */
export interface WorkspaceAdministration {
  readonly global:boolean;
  readonly readOnly?:boolean;
  get(workspaceId:WorkspaceId):Promise<WorkspaceResult<ManagedWorkspace>>;
  list(options: { search?: string; offset?: number; limit?: number }): Promise<WorkspaceResult<WorkspacePage>>;
  create(input: WorkspaceInput): Promise<WorkspaceResult<ManagedWorkspace>>;
  update(input: WorkspaceChange): Promise<WorkspaceResult<ManagedWorkspace>>;
  members(workspaceId: WorkspaceId,options?:WorkspaceSearch): Promise<WorkspaceResult<WorkspaceTeamPage>>;
  invite(input: InviteInput): Promise<WorkspaceResult<IssuedInvite>>;
  renewInvite(input: MembershipChange): Promise<WorkspaceResult<IssuedInvite>>;
  setRoles(input: MembershipChange & { roles: Role[] }): Promise<WorkspaceResult<WorkspaceMembership>>;
  setStatus(input: MembershipChange & { status: Extract<MembershipStatus, 'active' | 'suspended'> }): Promise<WorkspaceResult<WorkspaceMembership>>;
  integrations(workspaceId:WorkspaceId):Promise<WorkspaceResult<WorkspaceIntegration[]>>;
  saveIntegration(input:IntegrationChange):Promise<WorkspaceResult<IssuedIntegration>>;
  processing(workspaceId:WorkspaceId):Promise<WorkspaceResult<WorkspaceProcessing>>;
  setProcessing(input:{workspaceId:WorkspaceId;revision:number;dailyLimit:number|null}):Promise<WorkspaceResult<WorkspaceProcessing>>;
  templates(workspaceId:WorkspaceId):Promise<WorkspaceResult<WorkspaceTemplateConfiguration>>;
  saveTemplates(input:{workspaceId:WorkspaceId;revision:number;config:WorkspaceTemplateInput}):Promise<WorkspaceResult<WorkspaceTemplateConfiguration>>;
  uploadLogo(workspaceId:WorkspaceId,file:Blob):Promise<WorkspaceResult<WorkspaceBrandAsset>>;
  previewCopy(input:{sourceId:WorkspaceId;targetId:WorkspaceId;fields:ConfigurationCopyField[]}):Promise<WorkspaceResult<ConfigurationCopyPreview>>;
  applyCopy(token:string):Promise<WorkspaceResult<{workspace:ManagedWorkspace}>>;
  approveSignup(input:{workspaceId:WorkspaceId;personId:PersonId;roles:Role[]}):Promise<WorkspaceResult<unknown>>;
  subscribe(listener:()=>void):Unsubscribe;
}

/** A tab chooses its addressable context; navigation preference is never authorization. */
export interface WorkspaceDirectory {
  accessible(options?: WorkspaceSearch): Promise<WorkspaceResult<WorkspaceAccessPage>>;
}
