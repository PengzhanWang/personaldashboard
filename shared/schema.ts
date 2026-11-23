/**
 * Shared data contract between web (frontend), worker (BFF) and gas (Apps Script).
 * gas/Code.gs mirrors TABLE_COLUMNS by hand — keep them in sync.
 *
 * All values are transported as strings (Sheets stores them as plain text);
 * the frontend parses numbers/booleans where needed.
 */

export type TableName = 'Projects' | 'Tasks';

export const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at', 'updated_by', 'version', 'deleted'] as const;

export const TABLE_COLUMNS: Record<TableName, readonly string[]> = {
  Projects: [
    ...SYSTEM_COLUMNS,
    'title', 'area', 'kind', 'status', 'priority', 'start_date', 'target_date',
    'next_action', 'module', 'sensitive', 'doc_url', 'folder_url', 'tags', 'sort',
  ],
  Tasks: [
    ...SYSTEM_COLUMNS,
    'title', 'notes', 'project_id', 'status', 'priority', 'due_date', 'remind_at',
    'context', 'sync_calendar', 'calendar_event_id', 'completed_at',
  ],
};

/** A row as stored in Sheets: every column is a string. */
export type Row = Record<string, string> & { id: string; version: string; updated_at: string };

export interface Snapshot {
  /** Server time (ms since epoch) when the snapshot was generated. Used as monotonic rev. */
  generated_at: number;
  tables: Record<TableName, Row[]>;
}

export interface Mutation {
  mutation_id: string;
  table: TableName;
  row_id: string;
  op: 'upsert' | 'delete';
  /** Version the client based its edit on ("0" for new rows). */
  base_version: string;
  /** Only the changed fields. */
  patch: Record<string, string>;
  device: 'personal' | 'work';
  client_ts: number;
}

export interface MutationResult {
  mutation_id: string;
  status: 'ok' | 'error';
  row?: Row;
  /** Field values that were overwritten because base_version was stale (last-write-wins). */
  overwritten?: Record<string, string>;
  error?: string;
}

export interface MutateResponse {
  results: MutationResult[];
  server_time: number;
}

export interface SnapshotResponse {
  snapshot: Snapshot | null;
  /** True when the edge copy is older than the freshness window; a background refresh was started. */
  stale: boolean;
}

// ---- Enums (MVP: hardcoded; Phase 2 moves to the _Meta sheet) ----

export const PROJECT_STATUS = ['idea', 'active', 'paused', 'done', 'archived'] as const;
export const PROJECT_KIND = ['stage', 'ongoing'] as const;
export const AREAS = ['life', 'work', 'personal', 'family', 'finance', 'health'] as const;
export const TASK_STATUS = ['inbox', 'todo', 'doing', 'waiting', 'done', 'cancelled'] as const;
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export const CONTEXTS = ['', 'work', 'home', 'errand', 'phone'] as const;

export const LABELS: Record<string, string> = {
  idea: '想法', active: '进行中', paused: '暂停', done: '完成', archived: '归档',
  stage: '阶段性', ongoing: '长期',
  life: '生活', work: '工作', personal: '个人', family: '家庭', finance: '财务', health: '健康',
  inbox: '收集箱', todo: '待办', doing: '进行中', waiting: '等待', cancelled: '取消',
  home: '家里', errand: '外出', phone: '电话', '': '无',
};
