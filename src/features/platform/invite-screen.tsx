'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccessState,
  Alert,
  AuthShowcase,
  AuthSplit,
  Button,
  ButtonLink,
  DescriptionList,
  Field,
  Input,
  PageHeader,
  PageStack,
  PasswordField,
  SkeletonText,
} from '@content-ventures/design-system/v3';
import { PASSWORD_LIMITS, type InvitePreview } from '@/domain';
import { authClient } from '@/lib/auth-client';
import { useInviteDesk } from '@/state';
import { formatDateTime } from '@/ui/format';
import { ReporterBrand } from '@/ui/reporter-brand';
import { inputProps } from './field-props';
import { rolesLabel } from './format';

type Loaded = { status: 'loading' } | { status: 'ready'; preview: InvitePreview } | { status: 'invalid'; message: string };

const CLOSED: Readonly<Record<Exclude<InvitePreview['state'], 'open'>, { title: string; description: string }>> = {
  expired: { title: 'Este link expirou', description: 'Peça um novo link a quem criou seu acesso.' },
  used: { title: 'Este link já foi usado', description: 'Entre com seu e-mail e a senha que você definiu.' },
  revoked: { title: 'Este link não vale mais', description: 'Um link mais novo foi gerado, ou o acesso foi suspenso.' },
};

/**
 * The page an access link opens: who it is for, then the password. A new account defines it
 * (twice); an e-mail that already has an account confirms its own password. Right after, the
 * browser signs in with the same e-mail and password and lands on the workspace.
 */
export function InviteScreen({ token }: { token: string }) {
  const router = useRouter();
  const desk = useInviteDesk();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: 'password' | 'confirmation'; message: string }>();

  useEffect(() => {
    let live = true;
    void desk.preview(token).then((result) => {
      if (!live) return;
      setLoaded(result.ok ? { status: 'ready', preview: result.value } : { status: 'invalid', message: result.refusal.message });
    });
    return () => { live = false; };
  }, [desk, token]);

  const preview = loaded.status === 'ready' ? loaded.preview : undefined;
  const existing = preview?.hasAccount ?? false;
  const repeat = existing ? password : confirmation;
  const ready = password.length >= PASSWORD_LIMITS.min && repeat.length > 0;

  async function submit() {
    if (!preview || busy || !ready) return;
    setBusy(true);
    setError(undefined);
    const result = await desk.accept(token, password, repeat);
    if (!result.ok) {
      setBusy(false);
      const { code, message } = result.refusal;
      if (code === 'used' || code === 'expired' || code === 'invalid_link') { setLoaded({ status: 'invalid', message }); return; }
      setError({ field: code === 'password_mismatch' ? 'confirmation' : code.startsWith('password') || code === 'wrong_password' ? 'password' : undefined, message });
      return;
    }
    if (result.value.signIn) {
      const signed = await authClient.signIn.email({ email: result.value.email, password }).catch(() => ({ error: { message: '' } }));
      if (signed.error) { router.replace('/auth/sign-in'); return; }
    }
    router.replace('/');
    router.refresh();
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  }

  const closed = preview && preview.state !== 'open' ? CLOSED[preview.state] : undefined;

  return (
    <AuthSplit brand={<ReporterBrand signature />} aside={<AuthShowcase eyebrow="Acesso privado" title="Cada pessoa entra apenas no workspace" highlight="e no papel que recebeu." />}>
      {loaded.status === 'loading' ? (
        <PageStack>
          <SkeletonText lines={4} />
        </PageStack>
      ) : loaded.status === 'invalid' || closed ? (
        <AccessState
          kind="restricted"
          heading="h1"
          title={closed?.title ?? 'Este link não é válido'}
          description={closed?.description ?? (loaded.status === 'invalid' ? loaded.message : undefined)}
          actions={<ButtonLink href="/auth/sign-in" variant="primary">Ir para o login</ButtonLink>}
        />
      ) : preview ? (
        <PageStack>
          <PageHeader title={existing ? 'Confirme sua senha' : 'Defina sua senha'} description={`Olá, ${preview.name.split(' ')[0]}.`} />
          <DescriptionList
            items={[
              { label: 'Workspace', value: preview.workspaceName },
              { label: 'Função', value: rolesLabel(preview.roles) },
              { label: 'Link vale até', value: formatDateTime(preview.expiresAt), numeric: true },
            ]}
          />
          <Field label="E-mail">{(props) => <Input {...inputProps(props)} type="email" value={preview.email} autoComplete="username" readOnly />}</Field>
          <Field label={existing ? 'Senha da sua conta' : 'Senha'} hint={existing ? undefined : `Use pelo menos ${PASSWORD_LIMITS.min} caracteres.`} error={error?.field === 'password' ? error.message : undefined}>
            {(props) => (
              <PasswordField
                id={props.id}
                aria-describedby={props.describedBy}
                invalid={props.invalid}
                value={password}
                autoComplete={existing ? 'current-password' : 'new-password'}
                disabled={busy}
                onValueChange={setPassword}
                onKeyDown={submitOnEnter}
              />
            )}
          </Field>
          {existing ? null : (
            <Field label="Confirme a senha" error={error?.field === 'confirmation' ? error.message : undefined}>
              {(props) => <Input {...inputProps(props)} type="password" value={confirmation} autoComplete="new-password" disabled={busy} onKeyDown={submitOnEnter} onChange={(event) => setConfirmation(event.target.value)} />}
            </Field>
          )}
          {error && !error.field ? <Alert tone="danger" title="Não foi possível concluir">{error.message}</Alert> : null}
          <Button type="button" variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>
            {existing ? 'Confirmar e entrar' : 'Criar senha e entrar'}
          </Button>
        </PageStack>
      ) : null}
    </AuthSplit>
  );
}
