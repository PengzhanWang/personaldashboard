import type { Env } from './env';
import { hmacHex } from './auth';
import {
  TABLE_COLUMNS,
  type MutateResponse,
  type Mutation,
  type MutationResult,
  type Row,
  type Snapshot,
  type TableName,
  type UploadImageRequest,
} from '../shared/schema';

export interface Backend {
  readonly kind: 'gas' | 'mock';
  snapshot(): Promise<Snapshot>;
  mutate(mutations: Mutation[]): Promise<MutateResponse>;
  uploadImage(req: UploadImageRequest): Promise<{ file_id: string }>;
  getImage(fileId: string): Promise<{ base64: string; mimeType: string } | null>;
}

export function getBackend(env: Env): Backend {
  if (env.GAS_URL) return new GasBackend(env.GAS_URL, env.GAS_HMAC_SECRET || '');
  return new MockBackend(env.KV);
}

// ---------------------------------------------------------------------------
// Apps Script backend
// ---------------------------------------------------------------------------
class GasBackend implements Backend {
  readonly kind = 'gas' as const;
  constructor(private url: string, private secret: string) {}

  private async call<T>(action: string, payload: unknown): Promise<T> {
    if (!this.secret) throw new Error('GAS_HMAC_SECRET is not configured');
    const body = JSON.stringify({ action, ts: Date.now(), payload });
    const sig = await hmacHex(this.secret, body);
    const sep = this.url.includes('?') ? '&' : '?';
    const res = await fetch(`${this.url}${sep}sig=${sig}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
    });
    const text = await res.text();
    let json: { ok: boolean; data?: T; error?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!json.ok) throw new Error(`Apps Script error: ${json.error}`);
    return json.data as T;
  }

  snapshot() {
    return this.call<Snapshot>('snapshot', null);
  }
  mutate(mutations: Mutation[]) {
    return this.call<MutateResponse>('mutate', { mutations });
  }
  uploadImage(req: UploadImageRequest) {
    return this.call<{ file_id: string }>('uploadImage', req);
  }
  async getImage(fileId: string) {
    try {
      return await this.call<{ base64: string; mimeType: string }>('getImage', { file_id: fileId });
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Mock backend (KV-stored tables & images for local `wrangler dev`)
// ---------------------------------------------------------------------------
type Db = Record<TableName, Row[]> & { _done: Record<string, MutationResult> };

class MockBackend implements Backend {
  readonly kind = 'mock' as const;
  constructor(private kv: KVNamespace) {}

  private async load(): Promise<Db> {
    const existing = await this.kv.get<Db>('mock:db', 'json');
    if (existing && Array.isArray(existing.Boards) && Array.isArray(existing.Cards)) {
      existing.Items ||= [];
      existing._done ||= {};
      return existing;
    }
    const iso = new Date().toISOString();
    const seeded: Db = {
      Boards: [
        {
          id: 'main',
          created_at: iso,
          updated_at: iso,
          updated_by: 'mock',
          version: '1',
          deleted: 'FALSE',
          title: '主画布',
          sort: '0',
          sensitive: 'FALSE',
        },
      ],
      Cards: [
        {
          id: 'starter_list',
          created_at: iso,
          updated_at: iso,
          updated_by: 'mock',
          version: '1',
          deleted: 'FALSE',
          board_id: 'main',
          tag: '清单',
          title: '随手清单',
          finish: 'default',
          layout_json: JSON.stringify({ x: 0, y: 0, w: 4, h: 2 }),
          content_md: '- [ ] 点复选框可直接打勾\n- [ ] 拖动空白处换位，拉右下角缩放',
          images_json: '[]',
          links_json: '[]',
          sensitive: 'FALSE',
        },
      ],
      Items: [],
      _done: {},
    };
    await this.kv.put('mock:db', JSON.stringify(seeded));
    return seeded;
  }

  async snapshot(): Promise<Snapshot> {
    const db = await this.load();
    return {
      generated_at: Date.now(),
      tables: {
        Boards: db.Boards.filter((r) => r.deleted !== 'TRUE'),
        Cards: db.Cards.filter((r) => r.deleted !== 'TRUE'),
        Items: db.Items.filter((r) => r.deleted !== 'TRUE'),
      },
    };
  }

  async mutate(mutations: Mutation[]): Promise<MutateResponse> {
    const db = await this.load();
    const results = mutations.map((m) => {
      if (db._done[m.mutation_id]) return db._done[m.mutation_id];
      const r = applyMutation(db[m.table], m, Date.now());
      db._done[m.mutation_id] = r;
      return r;
    });
    const keys = Object.keys(db._done);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete db._done[k];
    await this.kv.put('mock:db', JSON.stringify(db));
    return { results, server_time: Date.now() };
  }

  async uploadImage(req: UploadImageRequest): Promise<{ file_id: string }> {
    const id = 'mock_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await this.kv.put(`mock:img:${id}`, JSON.stringify({ base64: req.base64, mimeType: req.mimeType }));
    return { file_id: id };
  }

  async getImage(fileId: string): Promise<{ base64: string; mimeType: string } | null> {
    return await this.kv.get<{ base64: string; mimeType: string }>(`mock:img:${fileId}`, 'json');
  }
}

function applyMutation(rows: Row[], m: Mutation, now: number): MutationResult {
  const cols = TABLE_COLUMNS[m.table];
  if (!cols) return { mutation_id: m.mutation_id, status: 'error', error: `unknown table ${m.table}` };
  const iso = new Date(now).toISOString();
  let row = rows.find((r) => r.id === m.row_id);
  const overwritten: Record<string, string> = {};
  const patch = m.op === 'delete' ? { deleted: 'TRUE' } : m.patch;

  if (!row) {
    if (m.op === 'delete') return { mutation_id: m.mutation_id, status: 'ok' };
    row = Object.fromEntries(cols.map((c) => [c, ''])) as Row;
    row.id = m.row_id;
    row.created_at = iso;
    row.version = '0';
    row.deleted = 'FALSE';
    rows.push(row);
  }
  const stale = Number(m.base_version || '0') < Number(row.version || '0');
  for (const [k, v] of Object.entries(patch)) {
    if (!cols.includes(k) || ['id', 'created_at', 'version', 'updated_at', 'updated_by'].includes(k)) continue;
    if (stale && row[k] !== v) overwritten[k] = row[k];
    row[k] = String(v ?? '');
  }
  row.version = String(Number(row.version || '0') + 1);
  row.updated_at = iso;
  row.updated_by = m.device;
  return {
    mutation_id: m.mutation_id,
    status: 'ok',
    row: { ...row },
    ...(Object.keys(overwritten).length ? { overwritten } : {}),
  };
}
