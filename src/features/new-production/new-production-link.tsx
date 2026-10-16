'use client';

import { ButtonLink } from '@content-ventures/design-system/v3';
import { Plus } from '@content-ventures/design-system/v3/icons';
import { useCan } from '@/state';
import { NEW_PRODUCTION_HREF } from '@/ui/routes';

/** "Nova produção" for who creates productions; nothing for a role that only reviews. */
export function NewProductionLink({ label = 'Nova produção', size }: { label?: string; size?: 'sm' }) {
  if (!useCan('production.create')) return null;
  return (
    <ButtonLink href={NEW_PRODUCTION_HREF} variant="primary" icon={Plus} {...(size ? { size } : {})}>
      {label}
    </ButtonLink>
  );
}
