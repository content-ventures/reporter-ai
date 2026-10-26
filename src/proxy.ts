import { NextResponse, type NextRequest } from 'next/server';
import { reporterAuth } from '@/server/auth';
import { reporterDeploymentMode } from '@/server/deployment';
import { workspaceAddress } from '@/domain/workspace-address';
import { workspaceRollout } from '@/server/workspace-rollout';

export default function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/w/')) {
    const address = workspaceAddress(request.nextUrl.pathname);
    if (!address || workspaceRollout() === 'off' || ['api','auth','platform','prototypes'].includes(address.path.split('/')[1])) {
      return NextResponse.rewrite(new URL('/workspace-unavailable',request.url));
    }
  }
  if (reporterDeploymentMode() === 'local') return NextResponse.next();
  return reporterAuth().middleware({ loginUrl: '/auth/sign-in' })(request);
}

export const config = {
  matcher: ['/', '/w/:path*', '/productions/:path*', '/approvals/:path*', '/banners/:path*', '/config/:path*', '/images/:path*', '/quotes/:path*', '/library/:path*', '/admin/:path*', '/whats-new/:path*', '/news/:path*', '/archive/:path*', '/settings/:path*', '/platform/:path*'],
};
