import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
  type SessionUser
} from '@/lib/auth';

const PUBLIC_API = ['/api/health', '/api/auth/login', '/api/auth/logout'];
const RENEW_THRESHOLD_MS = (SESSION_TTL_SECONDS / 2) * 1000;

/** 会话剩余不足一半时自动续签，长期使用的成员不会被强制重新登录 */
async function withSessionRenewal(
  request: NextRequest,
  response: NextResponse,
  session: SessionUser | null
): Promise<NextResponse> {
  if (!session) return response;
  if (session.exp - Date.now() > RENEW_THRESHOLD_MS) return response;

  const secure =
    request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const token = await createSessionToken({ id: session.uid, name: session.name });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(secure));
  return response;
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (PUBLIC_API.includes(pathname)) return NextResponse.next();
    if (!session) {
      return NextResponse.json({ error: '未登录或会话已过期，请重新登录。' }, { status: 401 });
    }
    return withSessionRenewal(request, NextResponse.next(), session);
  }

  if (!session) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    if (pathname && pathname !== '/studio') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return withSessionRenewal(request, NextResponse.next(), session);
}

export const config = {
  matcher: [
    '/studio/:path*',
    '/activities/:path*',
    '/activity/:path*',
    '/resources',
    '/admin',
    '/api/generate',
    '/api/rewrite',
    '/api/audience',
    '/api/example',
    '/api/activities',
    '/api/activities/:path*',
    '/api/tasks/:path*',
    '/api/materials/:path*',
    '/api/outputs/:path*',
    '/api/publishes/:path*',
    '/api/runs/:path*',
    '/api/resources'
  ]
};
