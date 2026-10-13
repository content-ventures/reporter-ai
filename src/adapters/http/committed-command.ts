/** A completed write is not undone by a failed read projection. Never resubmit it after that. */
export async function committedCommand<T>(send: () => Promise<T>,refresh: () => Promise<void>): Promise<T> {
  const result = await send();
  try { await refresh(); } catch { /* The normal polling loop will adopt the committed state. */ }
  return result;
}
