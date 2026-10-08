'use client';

import { SidebarAccount, type MenuSection } from '@content-ventures/design-system/v3';
import { PersonAvatar } from '../person-avatar';
import { memberDetail, useActAs } from './act-as';

/**
 * The acting member from the SessionPort, at the foot of the menu. In the simulation its menu
 * switches the person ("Entrar como", B06); "Preferências" and "Sair" arrive with the real
 * sign-in (R1 · Conexão), so nothing disabled stands in for them now.
 */
export function ShellAccount() {
  const { current, members, actAs } = useActAs();
  if (!current) return null;
  const sections: MenuSection[] =
    members.length > 1
      ? [
          {
            label: 'Entrar como',
            items: members.map((member) => ({
              label: member.name,
              description: memberDetail(member),
              leading: <PersonAvatar person={member} size="xs" decorative />,
              checked: member.id === current.id,
              onSelect: () => {
                if (member.id !== current.id) void actAs(member);
              },
            })),
          },
        ]
      : [];
  return <SidebarAccount name={current.name} src={current.avatarUrl} detail={memberDetail(current)} sections={sections} />;
}
