'use client';

import { LiveRegion, Section, Select, SidebarAccount, useShell, type MenuSection } from '@content-ventures/design-system/v3';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { PersonAvatar } from '../person-avatar';
import { localRoleMenu, memberDetail, useActAs } from './act-as';

/**
 * The acting member from the SessionPort, at the foot of the menu. In the simulation its menu
 * switches the person ("Entrar como", B06). In the cloud, the verified account can end its
 * Neon Auth session here; the local profiles stay isolated from that flow.
 */
export function ShellAccount() {
  const router = useRouter();
  const session = useActAs();
  const { collapsed } = useShell();
  const { current, members, actAs } = session;
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
  const cloudSections: MenuSection[] = session.localProfiles.length ? [] : [{ label: 'Conta',items: [{
    label: 'Sair',
    onSelect: () => { void authClient.signOut().finally(() => router.replace('/auth/sign-in')); },
  }] }];
  const profile = session.localProfiles.find(profile => profile.id === session.selectedProfile);
  return <>
    <SidebarAccount name={current.name} src={current.avatarUrl}
      detail={profile ? `Perfil de teste: ${profile.label}` : memberDetail(current)}
      sections={[...sections, ...localRoleMenu(session), ...cloudSections]} />
    {session.localProfiles.length && !collapsed ? <Section meta="Perfil de teste · local">
      <Select label="Perfil de teste" size="sm" value={session.selectedProfile ?? ''}
        options={session.localProfiles.map(profile => ({ value: profile.id, label: profile.label }))}
        loading={session.switchingRole} placeholder="Selecionar perfil"
        onChange={id => {
          const next = session.localProfiles.find(profile => profile.id === id);
          if (next && next.id !== session.selectedProfile) void session.selectRole(next);
        }} />
      <LiveRegion message={profile ? `Perfil de teste ativo: ${profile.label}` : ''} />
    </Section> : null}
  </>;
}
