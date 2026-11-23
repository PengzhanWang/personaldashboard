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
} from '../shared/schema';

/** The data plane behind the Worker: real Apps Script, or a KV mock for local dev. */
export interface Backend {
  readonly kind: 'gas' | 'mock';
  snapshot(): Promise<Snapshot>;
  mutate(mutations: Mutation[]): Promise<MutateResponse>;
}

export function getBackend(env: Env): Backend {
  if (env.GAS_URL) return new GasBackend(env.GAS_URL, env.GAS_HMAC_SECRET || '');
  return new MockBackend(env.KV);
}

// ---------------------------------------------------------------------------
// Apps Script backend
// Apps Script doPost cannot read request headers, so the HMAC signature goes in
// the query string (?sig=) and is computed over the raw body, which carries ts.
// ---------------------------------------------------------------------------
class GasBackend implements Backend {
  readonly kind = 'gas' as const;
  constructor(private url: string, private secret: string) {}

  private async call<T>(action: string, payload: unknown): Promise<T> {
    if (!this.secret) throw new Error('GAS_HMAC_SECRET is not configured');
    const body = JSON.stringify({ action, ts: Date.now(), payload });
    const sig = await hmacHex(this.secret, body);
    const sep = this.url.includes('?') ? '&' : '?';
    // POST /exec answers 302 -> googleusercontent; fetch follows it with GET, which is expected.
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
}

// ---------------------------------------------------------------------------
// Mock backend (KV-stored tables). Mirrors the Apps Script semantics so the whole
// app can be exercised locally with `wrangler dev` before Google is set up.
// ---------------------------------------------------------------------------
type Db = Record<TableName, Row[]> & { _done: Record<string, MutationResult> };

class MockBackend implements Backend {
  readonly kind = 'mock' as const;
  constructor(private kv: KVNamespace) {}

  private async load(): Promise<Db> {
    const db = (await this.kv.get<Db>('mock:db', 'json')) || ({ Projects: [], Tasks: [], _done: {} } as Db);
    db._done ||= {};
    return db;
  }

  async snapshot(): Promise<Snapshot> {
    const db = await this.load();
    return {
      generated_at: Date.now(),
      tables: {
        Projects: db.Projects.filter((r) => r.deleted !== 'TRUE'),
        Tasks: db.Tasks.filter((r) => r.deleted !== 'TRUE'),
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
    // keep the idempotency map bounded
    const keys = Object.keys(db._done);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete db._done[k];
    await this.kv.put('mock:db', JSON.stringify(db));
    return { results, server_time: Date.now() };
  }
}

/** Same algorithm as gas/Code.gs `applyMutation_`: field-level last-write-wins. */
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
