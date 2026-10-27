/** Environment ceiling; the database starts at admin and controls gradual activation. */
export function workspaceRollout(): 'off' | 'admin' | 'all' {
  const value=process.env.REPORTER_WORKSPACES_MODE;
  if(value===undefined||value==='all')return 'all';
  return value==='admin'?'admin':'off';
}
