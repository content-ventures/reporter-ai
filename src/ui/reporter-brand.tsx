'use client';

import Image from 'next/image';
import { TextLink, useShell } from '@content-ventures/design-system/v3';
import { PRODUCT_NAME } from '@/lib/brand';

/**
 * Approved brand artwork, always the vector SVG (sharp at any density); the public DS owns
 * navigation and shell behavior. `signature`: the sign-in lockup. `endorsed`: the same lockup sized
 * for the menu, within its 52 px row; the collapsed menu shows the R mark.
 */
export function ReporterBrand({ signature = false, endorsed = false }: { signature?: boolean; endorsed?: boolean }) {
  const { collapsed } = useShell();
  const compact = collapsed && !signature;
  const artwork = compact
    ? { src: '/icon.svg', width: 32, height: 32 }
    : signature
      ? { src: '/brand/reporter-ai-powered.svg', width: 264, height: 78 }
      : endorsed
        ? { src: '/brand/reporter-ai-powered.svg', width: 144, height: 43 }
        : { src: '/brand/reporter-ai.svg', width: 180, height: 49 };
  const powered = signature || (endorsed && !compact);

  return (
    <TextLink href="/" tone="inherit" aria-label={`${PRODUCT_NAME} — Início`}>
      <Image {...artwork} alt={powered ? `${PRODUCT_NAME} — Powered by Content Ventures` : PRODUCT_NAME} loading="eager" unoptimized />
    </TextLink>
  );
}
