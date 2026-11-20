import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken, type SessionUser } from '@/lib/auth';

/** 在 Server Component / Route Handler 中读取当前登录用户；中间件已做一层拦截，这里再兜底。 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}
