const encoder = new TextEncoder();

export const SESSION_COOKIE = 'cgy_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionUser {
  uid: string;
  name: string;
  exp: number;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 16) return value;
  return 'cgy-dev-only-secret-please-set-auth-secret';
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  return atob(value.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return toBase64Url(signature);
}

export async function createSessionToken(user: { id: string; name: string }): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({ uid: user.id, name: user.name, exp: Date.now() + SESSION_TTL_SECONDS * 1000 })
    )
  );
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEqual(signature, await hmac(payload))) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as Partial<SessionUser>;
    if (typeof parsed.uid !== 'string' || typeof parsed.name !== 'string') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return { uid: parsed.uid, name: parsed.name, exp: parsed.exp };
  } catch {
    return null;
  }
}

export async function sessionFingerprint(token: string | undefined): Promise<string> {
  if (!token) return 'anonymous';
  return (await hmac(`fp:${token}`)).slice(0, 12);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
