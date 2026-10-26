/** A workspace address is explicit and tab-local. Missing context means only the legacy pilot. */
export function workspaceSlug(value: string): string | undefined {
  return value.length >= 3 && value.length <= 63 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : undefined;
}

export function workspaceApiPath(slug: string | undefined, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('INVALID_REPORTER_PATH');
  if (slug !== undefined && !workspaceSlug(slug)) throw new Error('INVALID_WORKSPACE_ADDRESS');
  return `/api/reporter${slug ? '/w/'+slug : ''}${path}`;
}

export function workspaceAddress(pathname: string): { slug: string; path: string } | undefined {
  const match = /^\/w\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match || !workspaceSlug(match[1])) return undefined;
  return { slug: match[1], path: match[2] ?? '/' };
}
