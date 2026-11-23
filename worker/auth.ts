import type { Env } from './env';

const COOKIE = 'lifeos_session';
const enc = new TextEncoder();

export type Device = 'personal' | 'work';
export interface Session { exp: number; dev: Device }

/** Session lifetime: work computers get a short session. */
export const SESSION_TTL_S: Record<Device, number> = {
  personal: 30 * 24 * 3600,
  work: 12 * 3600,
};

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time password check (compares SHA-256 digests). */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(input)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(a, b);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function createSessionCookie(env: Env, dev: Device, secure: boolean): Promise<string> {
  const ttl = SESSION_TTL_S[dev];
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + ttl * 1000, dev } satisfies Session)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload)));
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function readSession(req: Request, env: Env): Promise<Session | null> {
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m || !env.SESSION_SECRET) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), b64urlDecode(sig), enc.encode(payload));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as Session;
    if (typeof s.exp !== 'number' || s.exp < Date.now()) return null;
    return { exp: s.exp, dev: s.dev === 'work' ? 'work' : 'personal' };
  } catch {
    return null;
  }
}

// ---- Login rate limiting (per IP, KV counter) ----
const RL_MAX_FAILS = 8;
const RL_WINDOW_S = 15 * 60;

export async function isRateLimited(env: Env, ip: string): Promise<boolean> {
  const n = Number((await env.KV.get(`rl:${ip}`)) || '0');
  return n >= RL_MAX_FAILS;
}

export async function recordLoginFailure(env: Env, ip: string): Promise<void> {
  const n = Number((await env.KV.get(`rl:${ip}`)) || '0');
  await env.KV.put(`rl:${ip}`, String(n + 1), { expirationTtl: RL_WINDOW_S });
}
