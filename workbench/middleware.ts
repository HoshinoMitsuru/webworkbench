import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

const PUBLIC_API = ['/api/health', '/api/auth/login', '/api/auth/logout'];

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (PUBLIC_API.includes(pathname)) return NextResponse.next();
    if (!session) {
      return NextResponse.json({ error: '未登录或会话已过期，请重新登录。' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    if (pathname && pathname !== '/studio') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/studio/:path*', '/api/generate', '/api/rewrite', '/api/audience', '/api/activities', '/api/activities/:path*']
};
