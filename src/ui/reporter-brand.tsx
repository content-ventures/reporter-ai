'use client';

import Image from 'next/image';
import { TextLink, useShell } from '@content-ventures/design-system/v3';
import { PRODUCT_NAME } from '@/lib/brand';

/** Approved brand artwork; the public DS owns navigation and shell behavior. */
export function ReporterBrand({ signature = false }: { signature?: boolean }) {
  const { collapsed } = useShell();
  const compact = collapsed && !signature;
  const artwork = compact
    ? { src: '/icon.svg', width: 32, height: 32 }
    : signature
      ? { src: '/brand/reporter-ai-powered.svg', width: 264, height: 78 }
      : { src: '/brand/reporter-ai.svg', width: 180, height: 49 };

  return (
    <TextLink href="/" tone="inherit" aria-label={`${PRODUCT_NAME} — Início`}>
      <Image {...artwork} alt={signature ? `${PRODUCT_NAME} — Powered by Content Ventures` : PRODUCT_NAME} loading="eager" unoptimized />
    </TextLink>
  );
}
