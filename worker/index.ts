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
import {
  detectItemType,
  parseCardImages,
  type ItemType,
  type Mutation,
  type Snapshot,
  type SnapshotResponse,
  type UnfurlResponse,
  type UnfurlResult,
  type UploadImageRequest,
  type UploadImageResponse,
} from '../shared/schema';

const FRESH_MS = 2 * 60 * 1000;
const SNAPSHOT_KEY = 'snapshot_v2';

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
    ctx.waitUntil(refreshSnapshot(env).catch((e) => console.error('refresh after mutate failed', e)));
    return json(res);
  }

  if (path === '/api/upload' && req.method === 'POST') {
    const body = (await req.json()) as Partial<UploadImageRequest>;
    const base64 = String(body.base64 || '');
    const mimeType = String(body.mimeType || 'image/webp');
    const filename = String(body.filename || `img-${Date.now()}.webp`);
    if (!base64) return json({ error: 'empty image' }, { status: 400 });
    if (base64.length > 3 * 1024 * 1024) return json({ error: '图片过大（压缩后上限 2MB）' }, { status: 413 });
    const { file_id } = await getBackend(env).uploadImage({ base64, mimeType, filename });
    return json({ file_id, url: `/api/image/${encodeURIComponent(file_id)}` } satisfies UploadImageResponse);
  }

  if (path.startsWith('/api/image/') && req.method === 'GET') {
    const fileId = decodeURIComponent(path.slice('/api/image/'.length)).trim();
    if (!fileId || fileId.includes('/')) return json({ error: 'invalid file id' }, { status: 400 });
    return handleGetImage(url, fileId, env, ctx, session);
  }

  if (path === '/api/unfurl' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { urls?: unknown };
    const rawList = Array.isArray(body.urls) ? body.urls : [];
    const urls = rawList
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean)
      .slice(0, 20);
    const results = await Promise.all(urls.map((u) => unfurlOne(u)));
    return json({ results } satisfies UnfurlResponse);
  }

  return json({ error: 'not found' }, { status: 404 });
}

async function handleGetImage(
  url: URL,
  fileId: string,
  env: Env,
  ctx: ExecutionContext,
  session: Session,
): Promise<Response> {
  // Defense in depth: in work mode, block images belonging to sensitive cards
  if (session.dev === 'work') {
    const cachedSnap = await env.KV.get<Snapshot>(SNAPSHOT_KEY, 'json');
    if (cachedSnap) {
      const hiddenBoards = new Set(cachedSnap.tables.Boards.filter((b) => b.sensitive === 'TRUE').map((b) => b.id));
      for (const c of cachedSnap.tables.Cards) {
        if (c.sensitive === 'TRUE' || hiddenBoards.has(c.board_id)) {
          if (parseCardImages(c.images_json).some((im) => im.file_id === fileId)) {
            return new Response('Forbidden in work mode', { status: 403 });
          }
        }
      }
    }
  }

  // Serve from Cloudflare Edge Cache after authentication succeeds
  const cache = (caches as unknown as { default?: Cache }).default;
  const cacheKey = new Request(`${url.origin}/__img_cache/${encodeURIComponent(fileId)}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('Cache-Control', 'private, max-age=31536000, immutable');
      return new Response(hit.body, { status: hit.status, headers });
    }
  }

  const img = await getBackend(env).getImage(fileId);
  if (!img) return new Response('Image not found', { status: 404 });

  const binStr = atob(img.base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

  const cacheable = new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': img.mimeType || 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
  if (cache) ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': img.mimeType || 'image/webp',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}

async function getSnapshot(req: Request, env: Env, ctx: ExecutionContext, session: Session): Promise<Response> {
  const cached = await env.KV.getWithMetadata<{ generated_at: number }>(SNAPSHOT_KEY, 'text');
  let snap: Snapshot | null = cached.value ? (JSON.parse(cached.value) as Snapshot) : null;
  let stale = !snap || Date.now() - snap.generated_at > FRESH_MS;

  if (!snap) {
    snap = await refreshSnapshot(env);
    stale = false;
  } else if (stale) {
    ctx.waitUntil(refreshWithLock(env));
  }

  const etag = `"${snap.generated_at}-${session.dev}"`;
  if (req.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Stale': String(stale) },
    });
  }
  return json({ snapshot: filterForDevice(snap, session.dev), stale } satisfies SnapshotResponse, {
    headers: { ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Stale': String(stale) },
  });
}

async function refreshWithLock(env: Env): Promise<void> {
  if (await env.KV.get('refresh_lock_v2')) return;
  await env.KV.put('refresh_lock_v2', '1', { expirationTtl: 60 });
  try {
    await refreshSnapshot(env);
  } catch (e) {
    console.error('background refresh failed', e);
  }
}

async function refreshSnapshot(env: Env): Promise<Snapshot> {
  const snap = await getBackend(env).snapshot();
  // Ensure schema shapes even before the user re-runs setupSheets
  snap.tables ||= { Boards: [], Cards: [], Items: [] };
  snap.tables.Boards ||= [];
  snap.tables.Cards ||= [];
  snap.tables.Items ||= [];
  const current = await env.KV.getWithMetadata<{ generated_at: number }>(SNAPSHOT_KEY, 'text');
  if (!current.metadata || current.metadata.generated_at < snap.generated_at) {
    await env.KV.put(SNAPSHOT_KEY, JSON.stringify(snap), { metadata: { generated_at: snap.generated_at } });
  }
  return snap;
}

/** Work computers never receive sensitive boards or cards. */
function filterForDevice(snap: Snapshot, dev: Device): Snapshot {
  const items = snap.tables.Items || [];
  if (dev !== 'work') {
    return { ...snap, tables: { ...snap.tables, Items: items } };
  }
  const hiddenBoards = new Set(snap.tables.Boards.filter((b) => b.sensitive === 'TRUE').map((b) => b.id));
  const visibleCards = snap.tables.Cards.filter((c) => c.sensitive !== 'TRUE' && !hiddenBoards.has(c.board_id));
  const visibleCardIds = new Set(visibleCards.map((c) => c.id));
  return {
    ...snap,
    tables: {
      Boards: snap.tables.Boards.filter((b) => !hiddenBoards.has(b.id)),
      Cards: visibleCards,
      Items: items.filter((it) => visibleCardIds.has(it.card_id)),
    },
  };
}

// ---------------------------------------------------------------------------
// Link Unfurling (/api/unfurl) — bounded size & timeout, SSRF guarded
// ---------------------------------------------------------------------------
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  return false;
}

function fallbackTitleFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
    return path && path !== '/' ? `${host}${path.slice(0, 42)}` : host;
  } catch {
    return rawUrl.slice(0, 64);
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHtmlTitle(html: string): string | null {
  const headEnd = html.search(/<\/head>/i);
  const snippet = headEnd !== -1 ? html.slice(0, headEnd + 7) : html.slice(0, 32_000);

  const metaPatterns = [
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["'][^>]+content\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["'][^>]*>/i,
  ];
  for (const re of metaPatterns) {
    const m = snippet.match(re);
    if (m && m[1]) {
      const cleaned = decodeHtmlEntities(m[1]).slice(0, 140);
      if (cleaned) return cleaned;
    }
  }

  const titleMatch = snippet.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    const cleaned = decodeHtmlEntities(titleMatch[1]).slice(0, 140);
    if (cleaned) return cleaned;
  }
  return null;
}

async function readBoundedText(res: Response, maxBytes = 96 * 1024): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

async function unfurlOne(rawUrl: string): Promise<UnfurlResult> {
  const fallbackType = detectItemType(rawUrl);
  const fallbackTitle = fallbackTitleFromUrl(rawUrl);

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: rawUrl, title: fallbackTitle, type: fallbackType, ok: false };
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || isBlockedHost(parsed.hostname)) {
    return { url: rawUrl, title: fallbackTitle, type: fallbackType, ok: false };
  }

  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(4500),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LifeOSDashboard/1.0)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (!res.ok) {
      return { url: rawUrl, title: fallbackTitle, type: fallbackType, ok: false };
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    let refinedType: ItemType = fallbackType;
    if (ct.includes('application/pdf')) refinedType = 'doc';
    else if (ct.startsWith('video/')) refinedType = 'video';
    else if (ct.startsWith('audio/')) refinedType = 'audio';
    else if (ct.startsWith('image/')) refinedType = 'image';

    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      res.body?.cancel().catch(() => undefined);
      return { url: rawUrl, title: fallbackTitle, type: refinedType, ok: true };
    }

    const html = await readBoundedText(res);
    const title = extractHtmlTitle(html) || fallbackTitle;
    return { url: rawUrl, title, type: refinedType, ok: true };
  } catch {
    return { url: rawUrl, title: fallbackTitle, type: fallbackType, ok: false };
  }
}
