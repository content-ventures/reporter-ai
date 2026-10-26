/** Server-owned rollout. Client input never changes the activation mode. */
export function workspaceRollout(): 'off' | 'admin' | 'all' {
  const value = process.env.REPORTER_WORKSPACES_MODE;
  return value === 'admin' || value === 'all' ? value : 'off';
}
