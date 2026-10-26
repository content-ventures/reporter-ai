'use client';

import { useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  AuthShowcase,
  AuthSplit,
  Button,
  Field,
  Input,
  MetaList,
  PageHeader,
  PageStack,
  Tabs,
} from '@content-ventures/design-system/v3';
import {announceAccountChange} from '@/lib/account-events';
import { authClient } from '@/lib/auth-client';
import { ReporterBrand } from '@/ui/reporter-brand';
import { PRODUCT_NAME } from '@/lib/brand';

type Mode = 'sign-in' | 'sign-up';

const MODES: { value: Mode; label: string }[] = [
  { value: 'sign-in', label: 'Entrar' },
  { value: 'sign-up', label: 'Criar conta' },
];

export default function SignInPage() {
  const router = useRouter();
  const [mode,setMode] = useState<Mode>('sign-in');
  const [name,setName] = useState('');
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<string>();

  async function submit() {
    if (busy || !email.trim() || password.length < 8 || mode === 'sign-up' && name.trim().length < 2) return;
    setBusy(true);setMessage(undefined);
    try {
      const result = mode === 'sign-in'
        ? await authClient.signIn.email({ email: email.trim(),password })
        : await authClient.signUp.email({ email: email.trim(),password,name: name.trim() });
      if (result.error) { setMessage(result.error.message || 'Não foi possível entrar.');return; }
      announceAccountChange();
      router.replace(mode === 'sign-up' ? '/auth/pending' : '/');router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'O serviço de acesso não respondeu.');
    } finally { setBusy(false); }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();void submit();
  }

  return <AuthSplit
    brand={<ReporterBrand signature />}
    aside={<AuthShowcase eyebrow={PRODUCT_NAME} title="Do material bruto ao artigo e ao carrossel" highlight="em um único fluxo editorial." />}
  >
    <PageStack>
      <PageHeader
        title={mode === 'sign-in' ? 'Entrar no workspace' : 'Criar sua conta'}
        description={mode === 'sign-in' ? 'Continue o trabalho editorial de onde parou.' : 'Depois do cadastro, um administrador libera seu acesso ao workspace.'}
      />
      <Tabs items={MODES} value={mode} label="Tipo de acesso" onChange={value => { setMode(value);setMessage(undefined); }} />
      {mode === 'sign-up' ? <Field label="Nome">{props => <Input {...props} value={name} autoComplete="name" required minLength={2} maxLength={120} onKeyDown={submitOnEnter} onChange={event => setName(event.target.value)} />}</Field> : null}
      <Field label="E-mail">{props => <Input {...props} value={email} type="email" autoComplete="email" required onKeyDown={submitOnEnter} onChange={event => setEmail(event.target.value)} />}</Field>
      <Field label="Senha" hint={mode === 'sign-up' ? 'Use pelo menos 8 caracteres.' : undefined}>{props => <Input {...props} value={password} type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required minLength={8} onKeyDown={submitOnEnter} onChange={event => setPassword(event.target.value)} />}</Field>
      {message ? <Alert tone="danger" title="Não foi possível concluir">{message}</Alert> : null}
      <Button type="button" variant="primary" loading={busy} disabled={!email.trim() || password.length < 8 || mode === 'sign-up' && name.trim().length < 2} onClick={() => void submit()}>
        {mode === 'sign-in' ? 'Entrar' : 'Criar conta'}
      </Button>
      <MetaList size="sm" items={['Acesso privado e vinculado ao seu usuário.']} />
    </PageStack>
  </AuthSplit>;
}
