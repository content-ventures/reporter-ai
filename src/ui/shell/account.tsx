'use client';

import { SidebarAccount, ThemeV3, useShell, type MenuSection } from '@content-ventures/design-system/v3';
import {Building2,Settings, UserRound } from '@content-ventures/design-system/v3/icons';
import { ACCOUNT_HREF } from '../routes';
import { requestLeave } from './leave-guard';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import {useSession} from '@/state';
import { PersonAvatar } from '../person-avatar';
import { localRoleMenu, memberDetail, useActAs } from './act-as';

/**
 * The acting member from the SessionPort, at the foot of the menu. In the simulation its menu
 * switches the person ("Entrar como", B06). In the cloud, the verified account can end its
 * Neon Auth session here; the local profiles stay isolated from that flow.
 */
export function ShellAccount() {
  const router = useRouter();
  const { closeNav } = useShell();
  const session = useActAs(),navigation=useSession().data?.navigation;
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
    onSelect: () => { if(requestLeave('/auth/sign-out'))router.push('/auth/sign-out'); },
  }] }];
  const profile = session.localProfiles.find(profile => profile.id === session.selectedProfile);
  // Keep the account popover in the sidebar layer when the mobile drawer is open.
  return <ThemeV3>
    <SidebarAccount name={current.name} src={current.avatarUrl}
      detail={profile ? `Perfil de teste: ${profile.label}` : memberDetail(current)}
      sections={[{ items: [{ label: 'Meu perfil', icon: UserRound, onSelect: () => {
        if (requestLeave(ACCOUNT_HREF)) { closeNav(); router.push(ACCOUNT_HREF); }
      } },...(current.roles.includes('admin')?[{label:'Administrar workspace',icon:Settings,onSelect:()=>{if(requestLeave('/admin/workspace')){closeNav();router.push('/admin/workspace');}}}]:[]),...(navigation?.administrative?[{label:'Plataforma',icon:Building2,onSelect:()=>{if(requestLeave('/platform')){closeNav();router.push('/platform');}}}]:[])] }, ...sections, ...localRoleMenu(session), ...cloudSections]} />
  </ThemeV3>;
}
