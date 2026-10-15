'use client';
import type { ReactNode } from 'react';
import { Drawer, ResponsiveDialog } from '@content-ventures/design-system/v3';
import { useMediaQuery } from '@/ui/use-media-query';
/** Same detail content, in the DS drawer on desktop and full-height sheet on phones. */
export function PrototypeDetail({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const narrow = useMediaQuery('(max-width: 640px)');
  return narrow
    ? <ResponsiveDialog open title={title} onClose={onClose} footer={footer} snap="full">{children}</ResponsiveDialog>
    : <Drawer open title={title} onClose={onClose} footer={footer} size="lg">{children}</Drawer>;
}
