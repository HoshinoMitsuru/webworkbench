import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken } from '@/lib/auth';
import { audit } from '@/lib/db';
import { ensureSeedUsers, verifyCredentials } from '@/lib/users';
import { trackLoginAttempt } from '@/lib/usage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local';

  if (!trackLoginAttempt(ip)) {
    return NextResponse.json({ error: '尝试次数过多，请一分钟后再试' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username.trim() || !password) {
    return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
  }

  ensureSeedUsers();

  let user: { id: string; name: string } | null = null;
  try {
    user = verifyCredentials(username, password);
  } catch (error) {
    console.warn('[auth] 登录校验失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '账号服务暂时不可用，请联系管理员' }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: '用户名或密码不正确' }, { status: 401 });
  }

  audit(user, 'auth.login', '', ip);

  const response = NextResponse.json({ ok: true, user: { name: user.name } });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0',
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  });
  return response;
}
