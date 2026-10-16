'use client';

import { can } from '../domain/permissions.ts';
import type { Capability } from '../domain/permissions.ts';
import { useSession } from './use-queries.ts';

/**
 * Whether the acting member may do it, from the session roles. Fails closed: false until the
 * session is known, so nothing a role cannot use flashes on screen.
 */
export function useCan(capability: Capability): boolean {
  return can(useSession().data?.current, capability);
}
