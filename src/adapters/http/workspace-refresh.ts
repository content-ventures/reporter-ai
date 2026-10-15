/** Share overlapping reads; a committed write requires a read started after that write. */
export function createWorkspaceRefresh(read: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  const refresh = (afterWrite = false): Promise<void> => {
    if (pending) return afterWrite ? pending.catch(() => {}).then(() => refresh()) : pending;
    pending = read().finally(() => { pending = undefined; });
    return pending;
  };
  return refresh;
}
