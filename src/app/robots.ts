import type { MetadataRoute } from 'next';
import { PUBLIC_INDEXING, SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return PUBLIC_INDEXING
    ? {
      rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/pending', '/prototypes/'] },
      sitemap: new URL('/sitemap.xml', SITE_URL).href,
    }
    : { rules: { userAgent: '*', disallow: '/' } };
}
