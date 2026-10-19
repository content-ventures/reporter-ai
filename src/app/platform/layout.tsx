import { notFound } from 'next/navigation';
import { PlatformGate } from '@/features/platform/platform-gate';
import { platformAccess } from '@/server/platform';
import { PlatformProvider } from '@/state';

/** Console da plataforma: its own runtime and frame, never the editorial workspace. 404 to anyone without the platform role. */
export default async function PlatformLayout({ children }: LayoutProps<'/platform'>) {
  if (!(await platformAccess())) notFound();
  return (
    <PlatformProvider>
      <PlatformGate>{children}</PlatformGate>
    </PlatformProvider>
  );
}
