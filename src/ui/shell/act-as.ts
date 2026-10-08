'use client';

import { useCallback, useMemo } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import type { Role } from '@/domain';
import type { SessionMember } from '@/ports';
import { useCommands, useSession } from '@/state';

/**
 * "Entrar como" (B06, simulated mode only): switch the acting member of the local session
 * (`SessionPort.actAs`) to see the product with another person's roles — the approver's "Aprovar",
 * an editor's disabled one, a production restricted to its team. The real sign-in (AuthSplit)
 * comes with R1 · Conexão; the audit trail records each switch as a sign-out and a sign-in.
 */

/** pt-BR names of the workspace roles (REQ-T.1). */
export const ROLE_LABELS: Record<Role, string> = {
  editor: 'Editor',
  approver: 'Aprovador',
  creative_reviewer: 'Revisor criativo',
  admin: 'Admin',
};

/**
 * "Aprovador", "Editor · Admin": the person's title, else their roles. Admin is always said, since
 * it changes what the person sees (Logs).
 */
export function memberDetail(member: Pick<SessionMember, 'title' | 'roles'>): string {
  const base = member.title ?? member.roles.filter((role) => role !== 'admin').map((role) => ROLE_LABELS[role]).join(' · ');
  const admin = member.roles.includes('admin') && !/\badmin/i.test(base) ? ROLE_LABELS.admin : null;
  return [base, admin].filter(Boolean).join(' · ');
}

export type ActAs = {
  /** Who acts now, and who else the simulation can switch to (empty outside the simulation). */
  current: SessionMember | undefined;
  members: readonly SessionMember[];
  actAs: (member: SessionMember) => Promise<void>;
};

const NONE: readonly SessionMember[] = [];

export function useActAs(): ActAs {
  const commands = useCommands();
  const session = useSession();
  const current = session.data?.current;
  const members = session.data?.mode === 'simulated' ? session.data.members : NONE;
  const actAs = useCallback(
    async (member: SessionMember) => {
      const result = await commands.session.actAs(member.id);
      if (result.ok) toast(`Você entrou como ${result.value.name}`, { description: memberDetail(result.value) });
      else toast(result.refusal.message, { tone: 'error' });
    },
    [commands],
  );
  return useMemo(() => ({ current, members, actAs }), [actAs, current, members]);
}
