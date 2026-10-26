/** Stable adopted identities, never inferred from a user-editable name or slug. */
export function isPreservedPilot(workspaceId:string):boolean {
  return workspaceId==='10000000-0000-0000-0000-000000000101'||workspaceId==='00000000-0000-0000-0000-000000000101';
}
