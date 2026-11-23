import type { Env } from './env';
import {
  clearSessionCookie,
  createSessionCookie,
  isRateLimited,
  passwordMatches,
  readSession,
  recordLoginFailure,
  type Device,
  type Session,
} from './auth';
import { getBackend } from './backend';
import type { Mutation, Snapshot, SnapshotResponse } from '../shared/schema';

/** Edge snapshot older than this triggers a background refresh from Apps Script. */
const FRESH_MS = 2 * 60 * 1000;
const SNAPSHOT_KEY = 'snapshot';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...init.headers },
  });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, url, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message || 'internal error' }, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleApi(req: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const secure = url.protocol === 'https:';
  const path = url.pathname;

  // CSRF guard: every state-changing call must carry our custom header (cannot be sent cross-site without CORS).
  if (req.method !== 'GET' && req.headers.get('X-LifeOS') !== '1') {
    return json({ error: 'missing X-LifeOS header' }, { status: 403 });
  }

  if (path === '/api/login' && req.method === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (await isRateLimited(env, ip)) return json({ error: '尝试次数过多，请 15 分钟后再试' }, { status: 429 });
    const body = (await req.json().catch(() => ({}))) as { password?: string; device?: Device };
    if (!(await passwordMatches(body.password || '', env.APP_PASSWORD))) {
      await recordLoginFailure(env, ip);
      return json({ error: '密码错误' }, { status: 401 });
    }
    const device: Device = body.device === 'work' ? 'work' : 'personal';
    return json({ ok: true, device }, { headers: { 'Set-Cookie': await createSessionCookie(env, device, secure) } });
  }

  if (path === '/api/logout' && req.method === 'POST') {
    return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(secure) } });
  }

  const session = await readSession(req, env);
  if (!session) return json({ error: 'unauthorized' }, { status: 401 });

  if (path === '/api/me' && req.method === 'GET') {
    return json({ device: session.dev, exp: session.exp, backend: getBackend(env).kind });
  }

  if (path === '/api/snapshot' && req.method === 'GET') {
    return getSnapshot(req, env, ctx, session);
  }

  if (path === '/api/refresh' && req.method === 'POST') {
    const snap = await refreshSnapshot(env);
    return json({ snapshot: filterForDevice(snap, session.dev), stale: false } satisfies SnapshotResponse);
  }

  if (path === '/api/mutate' && req.method === 'POST') {
    const body = (await req.json()) as { mutations?: Mutation[] };
    const mutations = (body.mutations || []).slice(0, 100);
    if (!mutations.length) return json({ results: [], server_time: Date.now() });
    const res = await getBackend(env).mutate(mutations);
    // Rebuild the edge snapshot after the response is sent.
    ctx.waitUntil(refreshSnapshot(env).catch((e) => console.error('refresh after mutate failed', e)));
    return json(res);
  }

  return json({ error: 'not found' }, { status: 404 });
}

async function getSnapshot(req: Request, env: Env, ctx: ExecutionContext, session: Session): Promise<Response> {
  const cached = await env.KV.getWithMetadata<{ generated_at: number }>(SNAPSHOT_KEY, 'text');
  let snap: Snapshot | null = cached.value ? (JSON.parse(cached.value) as Snapshot) : null;
  let stale = !snap || Date.now() - snap.generated_at > FRESH_MS;

  if (!snap) {
    // First ever load: nothing at the edge yet, so we have to wait for the source.
    snap = await refreshSnapshot(env);
    stale = false;
  } else if (stale) {
    ctx.waitUntil(refreshWithLock(env));
  }

  const etag = `"${snap.generated_at}-${session.dev}"`;
  if (req.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Stale': String(stale) } });
  }
  return json({ snapshot: filterForDevice(snap, session.dev), stale } satisfies SnapshotResponse, {
    headers: { ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Stale': String(stale) },
  });
}

/** Avoid stampeding Apps Script when several devices open the app at once. */
async function refreshWithLock(env: Env): Promise<void> {
  if (await env.KV.get('refresh_lock')) return;
  await env.KV.put('refresh_lock', '1', { expirationTtl: 60 });
  try {
    await refreshSnapshot(env);
  } catch (e) {
    console.error('background refresh failed', e);
  }
}

async function refreshSnapshot(env: Env): Promise<Snapshot> {
  const snap = await getBackend(env).snapshot();
  const current = await env.KV.getWithMetadata<{ generated_at: number }>(SNAPSHOT_KEY, 'text');
  if (!current.metadata || current.metadata.generated_at < snap.generated_at) {
    await env.KV.put(SNAPSHOT_KEY, JSON.stringify(snap), { metadata: { generated_at: snap.generated_at } });
  }
  return snap;
}

/** Work computers never receive sensitive projects (or their tasks). */
function filterForDevice(snap: Snapshot, dev: Device): Snapshot {
  if (dev !== 'work') return snap;
  const hidden = new Set(snap.tables.Projects.filter((p) => p.sensitive === 'TRUE').map((p) => p.id));
  return {
    ...snap,
    tables: {
      Projects: snap.tables.Projects.filter((p) => !hidden.has(p.id)),
      Tasks: snap.tables.Tasks.filter((t) => !hidden.has(t.project_id)),
    },
  };
}
