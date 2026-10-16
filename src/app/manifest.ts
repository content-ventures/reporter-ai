import type { MetadataRoute } from 'next';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: PRODUCT_NAME, short_name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION, lang: 'pt-BR',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#FFFFFF', theme_color: '#0875DB',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
