import { del, get, set } from 'idb-keyval';
import type { Mutation, Snapshot } from '../../shared/schema';

const KEYS = {
  snapshot: 'lifeos:v2:snapshot',
  etag: 'lifeos:v2:etag',
  outbox: 'lifeos:v2:outbox',
  device: 'lifeos:v2:device',
} as const;

export type DeviceMode = 'personal' | 'work';

export async function loadCachedSnapshot(): Promise<{ snapshot: Snapshot | null; etag: string | null }> {
  const [snapshot, etag] = await Promise.all([
    get<Snapshot>(KEYS.snapshot).catch(() => undefined),
    get<string>(KEYS.etag).catch(() => undefined),
  ]);
  if (!snapshot?.tables?.Boards || !snapshot?.tables?.Cards) {
    return { snapshot: null, etag: null };
  }
  return { snapshot, etag: etag ?? null };
}

export async function saveCachedSnapshot(snapshot: Snapshot, etag?: string | null): Promise<void> {
  await set(KEYS.snapshot, snapshot);
  if (etag !== undefined) {
    if (etag) await set(KEYS.etag, etag);
    else await del(KEYS.etag);
  }
}

export async function loadOutbox(): Promise<Mutation[]> {
  return (await get<Mutation[]>(KEYS.outbox).catch(() => undefined)) ?? [];
}

export async function saveOutbox(outbox: Mutation[]): Promise<void> {
  await set(KEYS.outbox, outbox);
}

export async function loadDeviceMode(): Promise<DeviceMode | null> {
  return (await get<DeviceMode>(KEYS.device).catch(() => undefined)) ?? null;
}

export async function saveDeviceMode(device: DeviceMode): Promise<void> {
  await set(KEYS.device, device);
}

export async function clearLocalData(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((k) => del(k).catch(() => undefined)));
}
