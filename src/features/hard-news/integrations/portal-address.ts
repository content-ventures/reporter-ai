import type { CmsStatus } from '@/domain/hard-news';

export const CMS_STATUS: Record<CmsStatus, { label: string; tone: 'green' | 'gray' | 'red' }> = {
  connected: { label: 'Conectado', tone: 'green' },
  disconnected: { label: 'Desconectado', tone: 'gray' },
  failing: { label: 'Com falha', tone: 'red' },
};

/** What is wrong with the portal address, in the desk's words; `undefined` when it can be used. */
export function portalAddressProblem(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use um endereço que comece com https://.';
    return undefined;
  } catch {
    return 'Cole o endereço completo do portal, com https://.';
  }
}

/** "https://portal.exemplo/wp-admin/" → "https://portal.exemplo": the site the CMS answers for. */
export function portalOrigin(value: string): string {
  return new URL(value.trim()).origin;
}

export function portalHost(value: string): string {
  try {
    return new URL(value).host.replace(/^www\./, '');
  } catch {
    return value;
  }
}
