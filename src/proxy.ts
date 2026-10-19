import { NextResponse, type NextRequest } from 'next/server';
import { reporterAuth } from '@/server/auth';
import { reporterDeploymentMode } from '@/server/deployment';

export default function proxy(request: NextRequest) {
  if (reporterDeploymentMode() === 'local') return NextResponse.next();
  return reporterAuth().middleware({ loginUrl: '/auth/sign-in' })(request);
}

export const config = {
  matcher: ['/', '/productions/:path*', '/approvals/:path*', '/banners/:path*', '/config/:path*', '/images/:path*', '/quotes/:path*', '/library/:path*', '/admin/:path*', '/whats-new/:path*', '/news/:path*', '/archive/:path*', '/settings/:path*', '/platform/:path*'],
};
