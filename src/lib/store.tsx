import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  TABLE_COLUMNS,
  type Mutation,
  type Row,
  type Snapshot,
  type TableName,
} from '../../shared/schema';
import {
  AuthError,
  apiForceRefresh,
  apiGetSnapshot,
  apiLogin,
  apiLogout,
  apiMe,
  apiMutate,
} from './api';
import {
  clearLocalData,
  loadCachedSnapshot,
  loadDeviceMode,
  loadOutbox,
  saveCachedSnapshot,
  saveDeviceMode,
  saveOutbox,
  type DeviceMode,
} from './storage';
import { ulid } from './ulid';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface StoreValue {
  authState: 'checking' | 'authed' | 'unauthed';
  device: DeviceMode;
  backendKind: 'gas' | 'mock' | null;
  projects: Row[];
  tasks: Row[];
  syncState: SyncState;
  lastSyncedAt: number | null;
  pendingCount: number;
  toast: string | null;
  login: (password: string, device: DeviceMode) => Promise<void>;
  logout: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  upsertRow: (table: TableName, patch: Record<string, string>, existing?: Row) => Promise<string>;
  deleteRow: (table: TableName, row: Row) => Promise<void>;
  clearToast: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const EMPTY_SNAPSHOT: Snapshot = { generated_at: 0, tables: { Projects: [], Tasks: [] } };

/** Overlay queued outbox mutations onto the base snapshot so UI updates are instant and consistent. */
function applyOutboxToSnapshot(base: Snapshot, outbox: Mutation[]): Snapshot {
  if (!outbox.length) return base;
  const tables: Record<TableName, Row[]> = {
    Projects: base.tables.Projects.map((r) => ({ ...r })),
    Tasks: base.tables.Tasks.map((r) => ({ ...r })),
  };
  for (const m of outbox) {
    const list = tables[m.table];
    if (!list) continue;
    const idx = list.findIndex((r) => r.id === m.row_id);
    if (m.op === 'delete') {
      if (idx !== -1) list.splice(idx, 1);
      continue;
    }
    const iso = new Date(m.client_ts).toISOString();
    if (idx === -1) {
      const row = Object.fromEntries(TABLE_COLUMNS[m.table].map((c) => [c, ''])) as Row;
      row.id = m.row_id;
      row.created_at = iso;
      row.updated_at = iso;
      row.updated_by = m.device;
      row.version = '0';
      row.deleted = 'FALSE';
      Object.assign(row, m.patch);
      list.push(row);
    } else {
      Object.assign(list[idx], m.patch, { updated_at: iso, updated_by: m.device });
    }
  }
  return { generated_at: base.generated_at, tables };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<'checking' | 'authed' | 'unauthed'>('checking');
  const [device, setDevice] = useState<DeviceMode>('personal');
  const [backendKind, setBackendKind] = useState<'gas' | 'mock' | null>(null);
  const [baseSnapshot, setBaseSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [outbox, setOutbox] = useState<Mutation[]>([]);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const etagRef = useRef<string | null>(null);
  const baseRef = useRef<Snapshot>(EMPTY_SNAPSHOT);
  const outboxRef = useRef<Mutation[]>([]);
  const flushingRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  baseRef.current = baseSnapshot;
  outboxRef.current = outbox;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  const mergeServerRow = useCallback((table: TableName, row: Row | undefined, deletedId?: string) => {
    setBaseSnapshot((prev) => {
      const nextList = prev.tables[table].slice();
      if (deletedId) {
        const i = nextList.findIndex((r) => r.id === deletedId);
        if (i !== -1) nextList.splice(i, 1);
      } else if (row) {
        const i = nextList.findIndex((r) => r.id === row.id);
        if (row.deleted === 'TRUE') {
          if (i !== -1) nextList.splice(i, 1);
        } else if (i !== -1) {
          nextList[i] = row;
        } else {
          nextList.push(row);
        }
      }
      const next: Snapshot = {
        generated_at: Math.max(prev.generated_at, Date.now()),
        tables: { ...prev.tables, [table]: nextList },
      };
      void saveCachedSnapshot(next);
      return next;
    });
  }, []);

  const flushOutbox = useCallback(async () => {
    if (flushingRef.current || !outboxRef.current.length) return;
    if (!navigator.onLine) {
      setSyncState('offline');
      return;
    }
    flushingRef.current = true;
    setSyncState('syncing');
    try {
      const batch = outboxRef.current.slice(0, 50);
      const res = await apiMutate(batch);
      const doneIds = new Set<string>();
      let hadOverwrite = false;

      for (const r of res.results) {
        const orig = batch.find((m) => m.mutation_id === r.mutation_id);
        if (r.status === 'ok' && orig) {
          doneIds.add(r.mutation_id);
          if (orig.op === 'delete') mergeServerRow(orig.table, undefined, orig.row_id);
          else if (r.row) mergeServerRow(orig.table, r.row);
          if (r.overwritten && Object.keys(r.overwritten).length > 0) hadOverwrite = true;
        }
      }

      const remaining = outboxRef.current.filter((m) => !doneIds.has(m.mutation_id));
      outboxRef.current = remaining;
      setOutbox(remaining);
      await saveOutbox(remaining);

      setLastSyncedAt(Date.now());
      setSyncState(remaining.length ? 'error' : 'synced');
      if (hadOverwrite) showToast('已覆盖另一设备的修改（旧值已记入 _Log）');
    } catch (e) {
      if (e instanceof AuthError) {
        setAuthState('unauthed');
        showToast(e.message);
      } else {
        setSyncState(navigator.onLine ? 'error' : 'offline');
      }
    } finally {
      flushingRef.current = false;
    }
  }, [mergeServerRow, showToast]);

  const refresh = useCallback(
    async (force = false) => {
      if (!navigator.onLine) {
        setSyncState('offline');
        return;
      }
      setSyncState('syncing');
      try {
        if (outboxRef.current.length) await flushOutbox();

        if (force) {
          const data = await apiForceRefresh();
          if (data.snapshot && data.snapshot.generated_at >= baseRef.current.generated_at) {
            baseRef.current = data.snapshot;
            setBaseSnapshot(data.snapshot);
            etagRef.current = null;
            await saveCachedSnapshot(data.snapshot, null);
          }
          setLastSyncedAt(Date.now());
          setSyncState('synced');
          showToast('已从数据源刷新');
          return;
        }

        const res = await apiGetSnapshot(etagRef.current);
        if (!res.notModified && res.data.snapshot) {
          const incoming = res.data.snapshot;
          if (incoming.generated_at >= baseRef.current.generated_at) {
            baseRef.current = incoming;
            setBaseSnapshot(incoming);
            etagRef.current = res.etag;
            await saveCachedSnapshot(incoming, res.etag);
          }
        }
        setLastSyncedAt(Date.now());
        setSyncState('synced');
      } catch (e) {
        if (e instanceof AuthError) {
          setAuthState('unauthed');
        } else {
          setSyncState(navigator.onLine ? 'error' : 'offline');
          showToast((e as Error).message || '同步失败');
        }
      }
    },
    [flushOutbox, showToast],
  );

  // Initial hydration: read IndexedDB immediately, then verify session & refresh in background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ snapshot, etag }, pending, savedDev] = await Promise.all([
        loadCachedSnapshot(),
        loadOutbox(),
        loadDeviceMode(),
      ]);
      if (cancelled) return;
      if (savedDev) setDevice(savedDev);
      if (pending.length) {
        outboxRef.current = pending;
        setOutbox(pending);
      }
      if (snapshot) {
        baseRef.current = snapshot;
        etagRef.current = etag;
        setBaseSnapshot(snapshot);
        setLastSyncedAt(snapshot.generated_at);
        // Show cached data right away while verifying session in background
        setAuthState('authed');
      }

      if (!navigator.onLine) {
        setSyncState('offline');
        if (!snapshot) setAuthState('unauthed');
        return;
      }

      try {
        const me = await apiMe();
        if (cancelled) return;
        setDevice(me.device);
        setBackendKind(me.backend);
        setAuthState('authed');
        await saveDeviceMode(me.device);
        if (me.device === 'personal') {
          navigator.storage?.persist?.().catch(() => undefined);
        }
        await refresh(false);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof AuthError) {
          setAuthState('unauthed');
        } else if (!snapshot) {
          setAuthState('unauthed');
        } else {
          setSyncState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Replay outbox when browser regains connectivity
  useEffect(() => {
    const onOnline = () => {
      if (authState === 'authed') void flushOutbox();
    };
    const onOffline = () => setSyncState('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [authState, flushOutbox]);

  const login = useCallback(
    async (password: string, dev: DeviceMode) => {
      const res = await apiLogin(password, dev);
      setDevice(res.device);
      await saveDeviceMode(res.device);
      const me = await apiMe().catch(() => null);
      if (me) setBackendKind(me.backend);
      setAuthState('authed');
      await refresh(false);
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    await clearLocalData();
    etagRef.current = null;
    baseRef.current = EMPTY_SNAPSHOT;
    outboxRef.current = [];
    setBaseSnapshot(EMPTY_SNAPSHOT);
    setOutbox([]);
    setLastSyncedAt(null);
    setAuthState('unauthed');
  }, []);

  const enqueue = useCallback(
    async (m: Mutation) => {
      const next = [...outboxRef.current, m];
      outboxRef.current = next;
      setOutbox(next);
      await saveOutbox(next);
      void flushOutbox();
    },
    [flushOutbox],
  );

  const upsertRow = useCallback(
    async (table: TableName, patch: Record<string, string>, existing?: Row): Promise<string> => {
      const rowId = existing?.id || ulid();
      await enqueue({
        mutation_id: ulid(),
        table,
        row_id: rowId,
        op: 'upsert',
        base_version: existing?.version || '0',
        patch,
        device,
        client_ts: Date.now(),
      });
      return rowId;
    },
    [device, enqueue],
  );

  const deleteRow = useCallback(
    async (table: TableName, row: Row) => {
      await enqueue({
        mutation_id: ulid(),
        table,
        row_id: row.id,
        op: 'delete',
        base_version: row.version || '0',
        patch: { deleted: 'TRUE' },
        device,
        client_ts: Date.now(),
      });
    },
    [device, enqueue],
  );

  const effective = useMemo(() => applyOutboxToSnapshot(baseSnapshot, outbox), [baseSnapshot, outbox]);

  const value = useMemo<StoreValue>(
    () => ({
      authState,
      device,
      backendKind,
      projects: effective.tables.Projects,
      tasks: effective.tables.Tasks,
      syncState,
      lastSyncedAt,
      pendingCount: outbox.length,
      toast,
      login,
      logout,
      refresh,
      upsertRow,
      deleteRow,
      clearToast,
    }),
    [
      authState,
      device,
      backendKind,
      effective,
      syncState,
      lastSyncedAt,
      outbox.length,
      toast,
      login,
      logout,
      refresh,
      upsertRow,
      deleteRow,
      clearToast,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
