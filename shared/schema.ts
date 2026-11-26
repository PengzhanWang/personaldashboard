/**
 * Shared data contract between web (frontend), worker (BFF) and gas (Apps Script).
 * gas/Code.gs mirrors TABLE_COLUMNS by hand — keep them in sync.
 *
 * All values are transported as strings (Sheets stores them as plain text).
 */

export type TableName = 'Boards' | 'Cards' | 'Items';

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
  Items: [
    ...SYSTEM_COLUMNS,
    'card_id',
    'column_id',
    'prev_column_id',
    'sort',
    'type',
    'title',
    'url',
    'tags',
    'note',
    'due',
    'body_md',
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

export interface WorkspaceColumn {
  id: string;
  name: string;
}

export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** When true, card body is hidden on canvas until explicitly revealed (for accounts/passwords). */
  masked?: boolean;
  /** Kanban columns for the full-screen project workspace. The last column counts as "done" when >= 2 columns. */
  columns?: WorkspaceColumn[];
}

export type ItemType = 'task' | 'link' | 'video' | 'audio' | 'doc' | 'file' | 'image';

export const ITEM_TYPES: {
  id: ItemType;
  label: string;
  short: string;
  color: string;
}[] = [
  { id: 'task', label: '任务', short: 'TASK', color: '#0F1E30' },
  { id: 'link', label: '链接', short: 'LINK', color: '#25548A' },
  { id: 'video', label: '视频', short: 'VIDEO', color: '#D94E28' },
  { id: 'audio', label: '音频', short: 'AUDIO', color: '#7C4D8B' },
  { id: 'doc', label: '文档', short: 'DOC', color: '#2A7A68' },
  { id: 'file', label: '本地文件', short: 'FILE', color: '#60768C' },
  { id: 'image', label: '图片', short: 'IMG', color: '#B56B2A' },
];

export type ColumnTemplateId = 'general' | 'learning' | 'collect' | 'blank';

export const COLUMN_TEMPLATES: {
  id: ColumnTemplateId;
  label: string;
  desc: string;
  columns: WorkspaceColumn[];
}[] = [
  {
    id: 'general',
    label: '通用',
    desc: '待办 / 进行中 / 完成',
    columns: [
      { id: 'todo', name: '待办' },
      { id: 'doing', name: '进行中' },
      { id: 'done', name: '完成' },
    ],
  },
  {
    id: 'learning',
    label: '学习',
    desc: '待学 / 学习中 / 已掌握',
    columns: [
      { id: 'to_learn', name: '待学' },
      { id: 'learning', name: '学习中' },
      { id: 'mastered', name: '已掌握' },
    ],
  },
  {
    id: 'collect',
    label: '素材收集',
    desc: '收集 / 筛选 / 采用',
    columns: [
      { id: 'inbox', name: '收集' },
      { id: 'review', name: '筛选' },
      { id: 'adopted', name: '采用' },
    ],
  },
  {
    id: 'blank',
    label: '空白',
    desc: '从零开始，自行建列',
    columns: [],
  },
];

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

export type BauhausShape = 'circle' | 'arch' | 'tri' | 'square' | 'diamond';

export const CARD_FINISHES: {
  id: CardFinish;
  label: string;
  dot: string;
  border: string;
  shape: BauhausShape;
}[] = [
  { id: 'default', label: '北海蓝', dot: '#25548A', border: '#0F1E30', shape: 'circle' },
  { id: 'warm', label: '救生橙', dot: '#D94E28', border: '#0F1E30', shape: 'arch' },
  { id: 'sage', label: '海松绿', dot: '#2A7A68', border: '#0F1E30', shape: 'tri' },
  { id: 'mist', label: '雾钢蓝', dot: '#60768C', border: '#0F1E30', shape: 'square' },
  { id: 'ink', label: '深海墨', dot: '#0F1E30', border: '#0F1E30', shape: 'diamond' },
];

export function parseCardLayout(raw?: string): CardLayout {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<CardLayout>;
    const columns = Array.isArray(parsed.columns)
      ? parsed.columns
          .filter((c): c is WorkspaceColumn => Boolean(c && typeof c.id === 'string' && typeof c.name === 'string'))
          .map((c) => ({ id: c.id, name: c.name }))
      : undefined;
    return {
      x: Number.isFinite(parsed.x) ? Math.max(0, Math.min(10, Number(parsed.x))) : 0,
      y: Number.isFinite(parsed.y) ? Math.max(0, Number(parsed.y)) : 0,
      w: Number.isFinite(parsed.w) ? Math.max(2, Math.min(12, Number(parsed.w))) : 4,
      h: Number.isFinite(parsed.h) ? Math.max(1, Math.min(8, Number(parsed.h))) : 2,
      ...(parsed.masked ? { masked: true } : {}),
      ...(columns !== undefined ? { columns } : {}),
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

export function isLocalPath(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  return (
    s.startsWith('/') ||
    s.startsWith('~/') ||
    s.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(s) ||
    s.startsWith('\\\\')
  );
}

export function detectItemType(urlOrPath: string): ItemType {
  const s = urlOrPath.trim();
  if (!s) return 'task';
  const lower = s.toLowerCase();
  const clean = lower.split(/[?#]/)[0];

  if (/\.(mp4|mov|mkv|webm|avi|m4v)$/.test(clean)) return 'video';
  if (/\.(mp3|m4a|wav|flac|ogg|aac)$/.test(clean)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|svg|bmp|heic)$/.test(clean)) return 'image';
  if (/\.(pdf|docx?|pptx?|xlsx?|md|txt|epub|pages|key|numbers)$/.test(clean)) return 'doc';

  if (isLocalPath(s)) return 'file';

  if (
    lower.includes('bilibili.com') ||
    lower.includes('b23.tv') ||
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('vimeo.com') ||
    lower.includes('coursera.org') ||
    lower.includes('udemy.com')
  ) {
    return 'video';
  }
  if (
    lower.includes('xiaoyuzhoufm.com') ||
    lower.includes('podcasts.apple.com') ||
    lower.includes('open.spotify.com') ||
    lower.includes('ximalaya.com') ||
    lower.includes('music.163.com')
  ) {
    return 'audio';
  }
  if (
    lower.includes('docs.google.com') ||
    lower.includes('drive.google.com') ||
    lower.includes('notion.so') ||
    lower.includes('notion.site') ||
    lower.includes('feishu.cn') ||
    lower.includes('yuque.com') ||
    lower.includes('arxiv.org')
  ) {
    return 'doc';
  }
  return 'link';
}
