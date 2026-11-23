/**
 * Shared data contract between web (frontend), worker (BFF) and gas (Apps Script).
 * gas/Code.gs mirrors TABLE_COLUMNS by hand — keep them in sync.
 *
 * All values are transported as strings (Sheets stores them as plain text).
 */

export type TableName = 'Boards' | 'Cards';

export const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at', 'updated_by', 'version', 'deleted'] as const;

export const TABLE_COLUMNS: Record<TableName, readonly string[]> = {
  Boards: [...SYSTEM_COLUMNS, 'title', 'sort', 'sensitive'],
  Cards: [
    ...SYSTEM_COLUMNS,
    'board_id',
    'tag',
    'title',
    'finish',
    'layout_json',
    'content_md',
    'images_json',
    'links_json',
    'sensitive',
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
  stale: boolean;
}

export interface UploadImageRequest {
  base64: string;
  mimeType: string;
  filename: string;
}

export interface UploadImageResponse {
  file_id: string;
  url: string;
}

// ---- Card JSON payload types ----

export type CardFinish = 'default' | 'warm' | 'sage' | 'mist' | 'ink';

export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardImage {
  id: string;
  file_id: string;
  /** Optional tiny base64 preview (~1KB) for 0ms placeholder before /api/image loads. */
  thumb?: string;
  caption?: string;
}

export type LinkKind = 'gsheet' | 'gdoc' | 'gdrive' | 'url';

export interface CardLink {
  id: string;
  title: string;
  kind: LinkKind;
  url: string;
}

export const CARD_FINISHES: { id: CardFinish; label: string; dot: string; border: string }[] = [
  { id: 'default', label: '纯白', dot: '#ffffff', border: '#d4d4d8' },
  { id: 'warm', label: '暖纸', dot: '#f5ead6', border: '#e5cfab' },
  { id: 'sage', label: '鼠尾草', dot: '#e1f0e8', border: '#badbcc' },
  { id: 'mist', label: '雾蓝', dot: '#e1eff8', border: '#bad9ec' },
  { id: 'ink', label: '炭黑', dot: '#18181b', border: '#18181b' },
];

export function parseCardLayout(raw?: string): CardLayout {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<CardLayout>;
    return {
      x: Number.isFinite(parsed.x) ? Math.max(0, Math.min(10, Number(parsed.x))) : 0,
      y: Number.isFinite(parsed.y) ? Math.max(0, Number(parsed.y)) : 0,
      w: Number.isFinite(parsed.w) ? Math.max(2, Math.min(12, Number(parsed.w))) : 4,
      h: Number.isFinite(parsed.h) ? Math.max(1, Math.min(8, Number(parsed.h))) : 2,
    };
  } catch {
    return { x: 0, y: 0, w: 4, h: 2 };
  }
}

export function parseCardImages(raw?: string): CardImage[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseCardLinks(raw?: string): CardLink[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function detectLinkKind(url: string): LinkKind {
  if (url.includes('docs.google.com/spreadsheets')) return 'gsheet';
  if (url.includes('docs.google.com/document')) return 'gdoc';
  if (url.includes('drive.google.com')) return 'gdrive';
  return 'url';
}
