import type { Metadata } from 'next';
import { InviteScreen } from '@/features/platform/invite-screen';
import { PlatformProvider } from '@/state';

export const metadata: Metadata = { title: 'Definir senha', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** The access link: public, the token is the credential. */
export default async function InvitePage({ params }: PageProps<'/auth/invite/[token]'>) {
  const { token } = await params;
  return (
    <PlatformProvider>
      <InviteScreen token={token} />
    </PlatformProvider>
  );
}
