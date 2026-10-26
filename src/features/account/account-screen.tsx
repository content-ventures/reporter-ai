'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import {
  ActionBar, Button, ButtonGroup, CardHeader, ConfirmDialog, DescriptionList, EmptyState, ErrorState, Field, Grid, Input,
  PageHeader, PageStack, Panel, Section, Select, SwitchRow, toast,
} from '@content-ventures/design-system/v3';
import { UserRound } from '@content-ventures/design-system/v3/icons';
import { PROFILE_LIMITS } from '@/domain';
import type { SessionMember } from '@/ports';
import { useCommands, useSession } from '@/state';
import { PersonAvatar } from '@/ui/person-avatar';
import { ROLE_LABELS, useActAs } from '@/ui/shell/act-as';
import { useBreadcrumb } from '@/ui/shell/breadcrumb';
import { useLeaveGuard } from '@/ui/shell/leave-guard';
import { SIDEBAR_COLLAPSED_KEY, usePersistentFlag } from '@/ui/shell/preference';
import { ProfilePhotoDialog } from './profile-photo';

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
          <ProfileForm member={current} />
          <PageStack>
            <Panel>
              <Section title="Acesso">
                <DescriptionList label="Dados de acesso" items={[
                  ...(current.email ? [{ label: 'E-mail', value: current.email }] : []),
                  { label: 'Workspace', value: session.data?.workspace.name },
                  { label: 'Permissões', value: current.roles.map(role => ROLE_LABELS[role]).join(' · ') },
                  { label: 'Sessão', value: account.localProfiles.length ? 'Operador local' : session.data?.mode === 'simulated' ? 'Simulação local' : 'Conta autenticada' },
                ]} />
              </Section>
            </Panel>
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

type Draft = { name: string; title: string };

/** Name, cargo and photo of the acting member. Unsaved edits hold navigation (leave guard). */
function ProfileForm({ member }: { member: SessionMember }) {
  const commands = useCommands();
  const router = useRouter();
  const saved: Draft = { name: member.name, title: member.title ?? '' };
  // `null` while nothing is typed: the form follows the saved profile (another tab, a refresh).
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [exitTo, setExitTo] = useState<string>();
  const departing = useRef(false);
  const values = draft ?? saved;
  const dirty = values.name.trim() !== saved.name || values.title.trim() !== saved.title;
  const nameError = values.name.trim() ? undefined : 'Informe seu nome.';

  useLeaveGuard(dirty || saving, href => setExitTo(href));
  useEffect(() => {
    if (!dirty && !saving) return;
    const guard = (event: BeforeUnloadEvent) => { if (!departing.current) event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, saving]);

  const edit = (patch: Partial<Draft>) => { setFailed(false); setDraft({ ...values, ...patch }); };
  async function save() {
    if (!dirty || nameError || saving) return;
    setSaving(true);
    try {
      const result = await commands.session.updateProfile({ name: values.name, title: values.title || null });
      if (!result.ok) {
        setFailed(true);
        toast('Perfil não salvo', { tone: 'error', description: result.refusal.message });
        return;
      }
      setDraft(null);
      toast('Perfil atualizado');
    } finally { setSaving(false); }
  }
  async function removePhoto() {
    setRemoving(true);
    try {
      const result = await commands.session.setAvatar(null);
      toast(result.ok ? 'Foto removida' : 'Foto não removida', result.ok ? {} : { tone: 'error', description: result.refusal.message });
    } finally { setRemoving(false); }
  }

  return (
    <Panel>
      <Section title="Conta">
        <PageStack>
          <CardHeader title={member.name} leading={<PersonAvatar person={member} size="xl" decorative />}
            actions={<ButtonGroup label="Foto de perfil">
              <Button size="sm" onClick={() => setPhotoOpen(true)}>{member.avatarUrl ? 'Trocar foto' : 'Adicionar foto'}</Button>
              {member.avatarUrl && <Button size="sm" variant="ghost" loading={removing} onClick={() => void removePhoto()}>Remover foto</Button>}
            </ButtonGroup>} />
          <Grid columns="1:1" collapseBelow={640}>
            <Field label="Nome" required error={draft ? nameError : undefined}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={values.name} autoComplete="name" maxLength={PROFILE_LIMITS.name}
                onChange={event => edit({ name: event.target.value })} />}
            </Field>
            <Field label="Cargo" optional>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={values.title} autoComplete="organization-title" maxLength={PROFILE_LIMITS.title}
                onChange={event => edit({ title: event.target.value })} />}
            </Field>
          </Grid>
          <ActionBar position="static" status={saving ? 'saving' : failed ? 'error' : dirty ? 'unsaved' : undefined}
            statusLabel={saving ? 'Salvando' : failed ? 'Não foi salvo' : dirty ? 'Alterações não salvas' : undefined}>
            {dirty && <Button variant="ghost" disabled={saving} onClick={() => { setDraft(null); setFailed(false); }}>Descartar</Button>}
            <Button variant="primary" loading={saving} disabled={!dirty || Boolean(nameError)} onClick={() => void save()}>Salvar alterações</Button>
          </ActionBar>
        </PageStack>
        <ProfilePhotoDialog member={member} open={photoOpen} onClose={() => setPhotoOpen(false)} />
        <ConfirmDialog open={Boolean(exitTo)} onClose={() => setExitTo(undefined)} title="Sair sem salvar o perfil?"
          description="Seu nome e cargo voltam ao que estava salvo." confirmLabel="Descartar e sair" cancelLabel="Continuar editando" tone="danger"
          onConfirm={() => { departing.current = true; const href = exitTo; setExitTo(undefined); if (href) router.push(href); }} />
      </Section>
    </Panel>
  );
}
