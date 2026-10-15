'use client';

import {
  CardHeader, DescriptionList, EmptyState, ErrorState, Grid, PageHeader, PageStack,
  Panel, Section, Select, SwitchRow,
} from '@content-ventures/design-system/v3';
import { UserRound } from '@content-ventures/design-system/v3/icons';
import { useSession } from '@/state';
import { PersonAvatar } from '@/ui/person-avatar';
import { ROLE_LABELS, useActAs } from '@/ui/shell/act-as';
import { useBreadcrumb } from '@/ui/shell/breadcrumb';
import { SIDEBAR_COLLAPSED_KEY, usePersistentFlag } from '@/ui/shell/preference';

export function AccountScreen() {
  const session = useSession();
  const account = useActAs();
  const [collapsed, setCollapsed] = usePersistentFlag(SIDEBAR_COLLAPSED_KEY);
  useBreadcrumb([{ label: 'Meu perfil' }]);
  const current = session.data?.current;

  return (
    <PageStack>
      <PageHeader title="Meu perfil" />
      {session.status === 'error' ? (
        <ErrorState size="panel" title="Não foi possível carregar seu perfil" description={session.error.message} onRetry={session.retry} />
      ) : !current ? (
        session.status === 'loading'
          ? <Panel><Section title="Conta"><DescriptionList items={[]} loading label="Carregando perfil" /></Section></Panel>
          : <EmptyState icon={UserRound} title="Nenhuma conta conectada" size="panel" />
      ) : (
        <Grid columns="3:2" collapseBelow={960} align="start">
          <Panel>
            <Section title="Conta">
              <PageStack>
                <CardHeader title={current.name} leading={<PersonAvatar person={current} size="lg" decorative />} />
                <DescriptionList label="Dados da conta" items={[
                  { label: 'Nome', value: current.name },
                  { label: 'Workspace', value: session.data?.workspace.name },
                  ...(current.title ? [{ label: 'Cargo', value: current.title }] : []),
                  ...(current.organization ? [{ label: 'Organização', value: current.organization }] : []),
                  { label: 'Permissões', value: current.roles.map(role => ROLE_LABELS[role]).join(' · ') },
                  { label: 'Sessão', value: account.localProfiles.length ? 'Operador local' : session.data?.mode === 'simulated' ? 'Simulação local' : 'Conta autenticada' },
                ]} />
              </PageStack>
            </Section>
          </Panel>
          <PageStack>
            <Panel>
              <Section title="Preferências neste navegador">
                <SwitchRow label="Menu lateral recolhido" checked={collapsed} onCheckedChange={setCollapsed} />
              </Section>
            </Panel>
            {account.localProfiles.length > 0 && (
              <Panel>
                <Section title="Perfil de teste · local">
                  <Select label="Perfil de teste" value={account.selectedProfile ?? ''}
                    options={account.localProfiles.map(profile => ({ value: profile.id, label: profile.label }))}
                    disabled={account.switchingRole}
                    onChange={value => {
                      const profile = account.localProfiles.find(option => option.id === value);
                      if (profile && profile.id !== account.selectedProfile) void account.selectRole(profile);
                    }} />
                </Section>
              </Panel>
            )}
          </PageStack>
        </Grid>
      )}
    </PageStack>
  );
}
