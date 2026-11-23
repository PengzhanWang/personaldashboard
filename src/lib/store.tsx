import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  TABLE_COLUMNS,
  type CardImage,
  type CardLayout,
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
  apiUploadImage,
} from './api';
import { compressImageFile } from './image';
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
  boards: Row[];
  cards: Row[];
  syncState: SyncState;
  lastSyncedAt: number | null;
  pendingCount: number;
  toast: string | null;
  showToast: (msg: string) => void;
  clearToast: () => void;
  login: (password: string, device: DeviceMode) => Promise<void>;
  logout: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  upsertRow: (table: TableName, patch: Record<string, string>, existing?: Row) => Promise<string>;
  deleteRow: (table: TableName, row: Row) => Promise<void>;
  mutateBatch: (
    items: { table: TableName; op: 'upsert' | 'delete'; row?: Row; rowId?: string; patch?: Record<string, string> }[],
  ) => Promise<void>;
  saveLayoutsDebounced: (updates: { row: Row; layout: CardLayout }[]) => void;
  uploadImage: (file: File) => Promise<{ image: CardImage; sizeKb: number }>;
}

const StoreContext = createContext<StoreValue | null>(null);

const EMPTY_SNAPSHOT: Snapshot = { generated_at: 0, tables: { Boards: [], Cards: [] } };

function applyOutboxToSnapshot(base: Snapshot, outbox: Mutation[]): Snapshot {
  if (!outbox.length) return base;
  const tables: Record<TableName, Row[]> = {
    Boards: base.tables.Boards.map((r) => ({ ...r })),
    Cards: base.tables.Cards.map((r) => ({ ...r })),
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
  const layoutDebounceRef = useRef<number | null>(null);

  baseRef.current = baseSnapshot;
  outboxRef.current = outbox;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
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
      let firstError: string | null = null;

      for (const r of res.results) {
        const orig = batch.find((m) => m.mutation_id === r.mutation_id);
        if (r.status === 'ok' && orig) {
          doneIds.add(r.mutation_id);
          if (orig.op === 'delete') mergeServerRow(orig.table, undefined, orig.row_id);
          else if (r.row) mergeServerRow(orig.table, r.row);
          if (r.overwritten && Object.keys(r.overwritten).length > 0) hadOverwrite = true;
        } else if (r.status === 'error' && !firstError) {
          firstError = r.error || '服务端拒绝写入';
        }
      }

      const remaining = outboxRef.current.filter((m) => !doneIds.has(m.mutation_id));
      outboxRef.current = remaining;
      setOutbox(remaining);
      await saveOutbox(remaining);

      setLastSyncedAt(Date.now());
      setSyncState(remaining.length ? 'error' : 'synced');
      if (firstError) {
        if (firstError.includes('unknown table')) {
          showToast('同步失败：Apps Script 还是旧版本，请在“管理部署”里发布新版本');
        } else {
          showToast(`同步失败：${firstError}`);
        }
      } else if (hadOverwrite) {
        showToast('已覆盖另一设备的修改（旧值已记入 _Log）');
      }
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
          showToast('已从 Google Sheets 同步');
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

  useEffect(() => {
    const onOnline = () => {
      if (authState === 'authed') void flushOutbox();
    };
    const onOffline = () => setSyncState('offline');
    const onVisChange = () => {
      if (document.visibilityState === 'hidden' && layoutDebounceRef.current) {
        window.clearTimeout(layoutDebounceRef.current);
        layoutDebounceRef.current = null;
        if (authState === 'authed') void flushOutbox();
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisChange);
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

  const enqueueMany = useCallback(
    async (mutations: Mutation[], flushNow = true) => {
      const next = outboxRef.current.slice();
      for (const m of mutations) {
        const existingIdx = next.findIndex(
          (x) =>
            x.table === m.table &&
            x.row_id === m.row_id &&
            x.op === 'upsert' &&
            m.op === 'upsert' &&
            Object.keys(x.patch).length === 1 &&
            'layout_json' in x.patch &&
            Object.keys(m.patch).length === 1 &&
            'layout_json' in m.patch,
        );
        if (existingIdx !== -1) next[existingIdx] = m;
        else next.push(m);
      }
      outboxRef.current = next;
      setOutbox(next);
      await saveOutbox(next);
      if (flushNow) void flushOutbox();
    },
    [flushOutbox],
  );

  const upsertRow = useCallback(
    async (table: TableName, patch: Record<string, string>, existing?: Row): Promise<string> => {
      const rowId = existing?.id || ulid();
      await enqueueMany([
        {
          mutation_id: ulid(),
          table,
          row_id: rowId,
          op: 'upsert',
          base_version: existing?.version || '0',
          patch,
          device,
          client_ts: Date.now(),
        },
      ]);
      return rowId;
    },
    [device, enqueueMany],
  );

  const deleteRow = useCallback(
    async (table: TableName, row: Row) => {
      await enqueueMany([
        {
          mutation_id: ulid(),
          table,
          row_id: row.id,
          op: 'delete',
          base_version: row.version || '0',
          patch: { deleted: 'TRUE' },
          device,
          client_ts: Date.now(),
        },
      ]);
    },
    [device, enqueueMany],
  );

  const mutateBatch = useCallback(
    async (
      items: { table: TableName; op: 'upsert' | 'delete'; row?: Row; rowId?: string; patch?: Record<string, string> }[],
    ) => {
      if (!items.length) return;
      const now = Date.now();
      const mutations: Mutation[] = items.map((item) => ({
        mutation_id: ulid(),
        table: item.table,
        row_id: item.row?.id || item.rowId || ulid(),
        op: item.op,
        base_version: item.row?.version || '0',
        patch: item.op === 'delete' ? { deleted: 'TRUE' } : item.patch || {},
        device,
        client_ts: now,
      }));
      await enqueueMany(mutations, true);
    },
    [device, enqueueMany],
  );

  /** Update card layouts optimistically right away, then debounce 1.2s before sending one batch to Sheets. */
  const saveLayoutsDebounced = useCallback(
    (updates: { row: Row; layout: CardLayout }[]) => {
      if (!updates.length) return;
      const now = Date.now();
      const mutations: Mutation[] = updates.map(({ row, layout }) => ({
        mutation_id: ulid(),
        table: 'Cards',
        row_id: row.id,
        op: 'upsert',
        base_version: row.version || '0',
        patch: { layout_json: JSON.stringify(layout) },
        device,
        client_ts: now,
      }));
      void enqueueMany(mutations, false);

      if (layoutDebounceRef.current) window.clearTimeout(layoutDebounceRef.current);
      layoutDebounceRef.current = window.setTimeout(() => {
        layoutDebounceRef.current = null;
        void flushOutbox();
      }, 1200);
    },
    [device, enqueueMany, flushOutbox],
  );

  const uploadImage = useCallback(async (file: File) => {
    const compressed = await compressImageFile(file);
    const { file_id } = await apiUploadImage({
      base64: compressed.base64,
      mimeType: compressed.mimeType,
      filename: compressed.filename,
    });
    const image: CardImage = {
      id: ulid(),
      file_id,
      thumb: compressed.thumb,
      caption: '',
    };
    return { image, sizeKb: compressed.sizeKb };
  }, []);

  const effective = useMemo(() => applyOutboxToSnapshot(baseSnapshot, outbox), [baseSnapshot, outbox]);

  const value = useMemo<StoreValue>(
    () => ({
      authState,
      device,
      backendKind,
      boards: effective.tables.Boards,
      cards: effective.tables.Cards,
      syncState,
      lastSyncedAt,
      pendingCount: outbox.length,
      toast,
      showToast,
      clearToast,
      login,
      logout,
      refresh,
      upsertRow,
      deleteRow,
      mutateBatch,
      saveLayoutsDebounced,
      uploadImage,
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
      showToast,
      clearToast,
      login,
      logout,
      refresh,
      upsertRow,
      deleteRow,
      mutateBatch,
      saveLayoutsDebounced,
      uploadImage,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
