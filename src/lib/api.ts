import type {
  MutateResponse,
  Mutation,
  SnapshotResponse,
  UploadImageRequest,
  UploadImageResponse,
} from '../../shared/schema';
import type { DeviceMode } from './storage';

export class AuthError extends Error {
  constructor(message = '登录已过期，请重新登录') {
    super(message);
    this.name = 'AuthError';
  }
}

const HEADERS = { 'Content-Type': 'application/json', 'X-LifeOS': '1' };

async function parseJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get('Content-Type') || '';
  if (res.status === 401) throw new AuthError();
  if (!ct.includes('application/json')) {
    throw new Error(`服务端返回非 JSON 响应 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `请求失败 (HTTP ${res.status})`);
  return data;
}

export async function apiLogin(password: string, device: DeviceMode): Promise<{ ok: true; device: DeviceMode }> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ password, device }),
  });
  return parseJson(res);
}

export async function apiLogout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', headers: HEADERS }).catch(() => undefined);
}

export async function apiMe(): Promise<{ device: DeviceMode; exp: number; backend: 'gas' | 'mock' }> {
  const res = await fetch('/api/me', { headers: { 'X-LifeOS': '1' } });
  return parseJson(res);
}

export async function apiGetSnapshot(
  etag?: string | null,
): Promise<{ notModified: true; stale: boolean } | { notModified: false; data: SnapshotResponse; etag: string | null }> {
  const headers: Record<string, string> = { 'X-LifeOS': '1' };
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch('/api/snapshot', { headers });
  if (res.status === 401) throw new AuthError();
  if (res.status === 304) {
    return { notModified: true, stale: res.headers.get('X-Stale') === 'true' };
  }
  const data = await parseJson<SnapshotResponse>(res);
  return { notModified: false, data, etag: res.headers.get('ETag') };
}

export async function apiForceRefresh(): Promise<SnapshotResponse> {
  const res = await fetch('/api/refresh', { method: 'POST', headers: HEADERS });
  return parseJson<SnapshotResponse>(res);
}

export async function apiMutate(mutations: Mutation[]): Promise<MutateResponse> {
  const res = await fetch('/api/mutate', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ mutations }),
  });
  return parseJson<MutateResponse>(res);
}

export async function apiUploadImage(req: UploadImageRequest): Promise<UploadImageResponse> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(req),
  });
  return parseJson<UploadImageResponse>(res);
}
