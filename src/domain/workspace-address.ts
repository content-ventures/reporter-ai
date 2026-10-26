/** A workspace address is explicit and tab-local. Missing context means only the legacy pilot. */
export const WORKSPACE_PAGE_HEADER='x-reporter-page-workspace';
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
/** Internal page links retain the addressed client, including query strings. */
export function workspacePagePath(slug:string|undefined,path:string):string{
  if(!path.startsWith('/')||path.startsWith('//')||slug!==undefined&&!workspaceSlug(slug))throw new Error('INVALID_WORKSPACE_ADDRESS');
  return `${slug?'/w/'+slug:''}${path}`;
}
/** Scope product destinations while keeping global consoles, authentication and files global. */
export function workspaceHref(slug:string|undefined,href:string):string{
  if(!slug||!href.startsWith('/')||href.startsWith('//')||/^\/(?:w|api|auth|platform|workspaces|prototypes)(?:[/?#]|$)/.test(href))return href;
  return workspacePagePath(slug,href);
}
export function workspaceAccessHref(item:{workspace:{id:string;slug:string};enterable?:boolean;administrative:boolean}):string{
  return item.enterable===false?(item.administrative?`/platform/workspaces/${encodeURIComponent(item.workspace.id)}`:'/workspaces'):workspacePagePath(item.workspace.slug,'/');
}
