'use client';

import { Alert, AuthShowcase, AuthSplit, Button, ButtonGroup, PageHeader, PageStack } from '@content-ventures/design-system/v3';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { ReporterBrand } from '@/ui/reporter-brand';

export default function AccessPendingPage() {
  const router = useRouter();
  function signOut() {
    void authClient.signOut().finally(() => router.replace('/auth/sign-in'));
  }

  return <AuthSplit
    brand={<ReporterBrand signature />}
    aside={<AuthShowcase eyebrow="Acesso privado" title="Cada pessoa entra apenas no workspace" highlight="e no papel que recebeu." />}
  >
    <PageStack>
      <PageHeader title="Seu acesso está quase pronto" description="A conta foi criada, mas ainda precisa ser vinculada ao workspace do Reporter AI." />
      <Alert tone="info" title="Aguardando liberação">Se você recebeu um pedido de confirmação por e-mail, conclua essa etapa. Depois, peça ao administrador para liberar seu endereço no projeto.</Alert>
      <ButtonGroup label="Ações de acesso">
        <Button variant="primary" onClick={() => router.replace('/')}>Verificar novamente</Button>
        <Button onClick={signOut}>Sair desta conta</Button>
      </ButtonGroup>
    </PageStack>
  </AuthSplit>;
}
