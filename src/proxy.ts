import { NextResponse, NextRequest } from 'next/server';
import { reporterAuth } from '@/server/auth';
import { reporterDeploymentMode } from '@/server/deployment';
import { workspaceAddress,WORKSPACE_PAGE_HEADER } from '@/domain/workspace-address';
import { workspaceRollout } from '@/server/workspace-rollout';

export default function proxy(request: NextRequest) {
  const forwarded=new Headers(request.headers);forwarded.delete(WORKSPACE_PAGE_HEADER);
  if (request.nextUrl.pathname.startsWith('/w/')) {
    const address = workspaceAddress(request.nextUrl.pathname);
    forwarded.set(WORKSPACE_PAGE_HEADER,address?.slug??'!invalid');
    if (!address || workspaceRollout() === 'off' || ['api','auth','platform','prototypes'].includes(address.path.split('/')[1])) {
      forwarded.set(WORKSPACE_PAGE_HEADER,'!invalid');
      return NextResponse.rewrite(new URL('/workspace-unavailable',request.url),{request:{headers:forwarded}});
    }
  }
  if (reporterDeploymentMode() === 'local') return NextResponse.next({request:{headers:forwarded}});
  return reporterAuth().middleware({ loginUrl: '/auth/sign-in' })(new NextRequest(request,{headers:forwarded}));
}

export const config = {
  matcher: ['/', '/w/:path*', '/productions/:path*', '/approvals/:path*', '/banners/:path*', '/config/:path*', '/images/:path*', '/quotes/:path*', '/library/:path*', '/admin/:path*', '/whats-new/:path*', '/news/:path*', '/archive/:path*', '/settings/:path*', '/platform/:path*'],
};
