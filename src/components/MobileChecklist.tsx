import React, { useMemo, useState } from 'react';
import {
  ITEM_TYPES,
  type ItemType,
  type Row,
  type WorkspaceColumn,
} from '../../shared/schema';

interface MobileChecklistProps {
  columns: WorkspaceColumn[];
  doneColumnId: string | null;
  items: Row[];
  accentColor: string;
  onToggleDone: (item: Row, currentlyDone: boolean) => Promise<void>;
  onQuickAdd: (text: string) => Promise<void>;
  onSelectItem: (item: Row) => void;
  onCopyPath: (path: string) => void;
}

function getTypeMeta(type?: string) {
  return ITEM_TYPES.find((t) => t.id === type) || ITEM_TYPES[0];
}

function isHttpUrl(url?: string): boolean {
  if (!url) return false;
  const s = url.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

export function MobileChecklist({
  columns,
  doneColumnId,
  items,
  accentColor,
  onToggleDone,
  onQuickAdd,
  onSelectItem,
  onCopyPath,
}: MobileChecklistProps) {
  const [quickText, setQuickText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneExpanded, setDoneExpanded] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const c of columns) map.set(c.id, []);
    const fallbackId = columns[0]?.id;
    for (const it of items) {
      const target = map.has(it.column_id) ? it.column_id : fallbackId;
      if (target) map.get(target)!.push(it);
    }
    return map;
  }, [columns, items]);

  const activeColumns = useMemo(
    () => (doneColumnId ? columns.filter((c) => c.id !== doneColumnId) : columns),
    [columns, doneColumnId],
  );
  const doneColumn = useMemo(
    () => (doneColumnId ? columns.find((c) => c.id === doneColumnId) || null : null),
    [columns, doneColumnId],
  );
  const doneItems = doneColumn ? grouped.get(doneColumn.id) || [] : [];

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const val = quickText.trim();
    if (!val || submitting) return;
    setSubmitting(true);
    setQuickText('');
    try {
      await onQuickAdd(val);
    } finally {
      setSubmitting(false);
    }
  }

  function renderItemRow(it: Row, isDone: boolean) {
    const meta = getTypeMeta(it.type);
    const hasHttp = isHttpUrl(it.url);
    const hasPath = !hasHttp && Boolean(it.url?.trim());

    return (
      <div
        key={it.id}
        className={`px-3.5 py-3 bg-white border border-[var(--hairline)] rounded-[3px] flex items-start gap-3 transition ${
          isDone ? 'opacity-60' : ''
        }`}
      >
        {/* Left Checkbox */}
        {doneColumnId && (
          <button
            type="button"
            onClick={() => void onToggleDone(it, isDone)}
            aria-label={isDone ? '取消完成' : '标记完成'}
            className="pt-0.5 shrink-0 cursor-pointer"
          >
            <span className={`check-box ${isDone ? 'checked' : ''}`} style={{ width: 18, height: 18 }}>
              {isDone && (
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
          </button>
        )}

        {/* Main Content: Tap title to open link / copy path / open detail */}
        <div className="flex-1 min-w-0">
          {hasHttp ? (
            <a
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className={`block text-[13.5px] font-semibold leading-snug break-words hover:text-[#25548A] ${
                isDone ? 'line-through text-[var(--muted-foreground)]' : 'text-[#0F1E30]'
              }`}
            >
              {it.title || '未命名条目'}
              <span className="inline-block ml-1 text-[11px] text-[#25548A] opacity-75">↗</span>
            </a>
          ) : hasPath ? (
            <button
              type="button"
              onClick={() => onCopyPath(it.url)}
              className={`block text-left w-full text-[13.5px] font-semibold leading-snug break-words cursor-pointer ${
                isDone ? 'line-through text-[var(--muted-foreground)]' : 'text-[#0F1E30]'
              }`}
            >
              {it.title || '未命名条目'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelectItem(it)}
              className={`block text-left w-full text-[13.5px] font-semibold leading-snug break-words cursor-pointer ${
                isDone ? 'line-through text-[var(--muted-foreground)]' : 'text-[#0F1E30]'
              }`}
            >
              {it.title || '未命名条目'}
            </button>
          )}

          {/* Meta row */}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
            <span className="inline-flex items-center gap-1 text-[10px] nolan-label font-semibold text-[var(--muted-foreground)]">
              <span className="w-1.5 h-1.5" style={{ background: meta.color }} />
              {meta.label}
            </span>
            {it.due && <span className="font-mono text-[10px] text-[#D94E28]">{it.due}</span>}
            {hasPath && (
              <span className="text-[10px] text-[#D94E28] font-medium">点标题复制路径</span>
            )}
            {it.note && (
              <span className="text-[11px] text-[var(--muted-foreground)] truncate max-w-full">
                · {it.note}
              </span>
            )}
          </div>
        </div>

        {/* Right Detail Trigger */}
        <button
          type="button"
          onClick={() => onSelectItem(it)}
          className="px-2 py-1 rounded-[2px] border border-[var(--hairline)] hover:border-[#0F1E30] nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] hover:text-[#0F1E30] shrink-0 cursor-pointer"
        >
          详情
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto card-scroll px-4 py-4 space-y-5 max-w-xl mx-auto w-full">
      {/* Top Quick-Add Form */}
      <form onSubmit={(e) => void handleAdd(e)} className="flex items-center gap-2">
        <input
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          placeholder="粘贴链接或输入条目，快速添加到第一列…"
          className="flex-1 min-w-0 px-3 py-2 text-xs bg-white border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
        />
        <button
          type="submit"
          disabled={submitting || !quickText.trim()}
          className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-3.5 py-2 rounded-[2px] nolan-label text-[10.5px] font-semibold shrink-0 cursor-pointer transition disabled:opacity-40"
        >
          添加
        </button>
      </form>

      {/* Active Column Groups */}
      {activeColumns.map((col) => {
        const list = grouped.get(col.id) || [];
        return (
          <section key={col.id} className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5" style={{ background: accentColor }} />
                <h2 className="nolan-title text-xs font-bold text-[#0F1E30]">{col.name}</h2>
                <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{list.length}</span>
              </div>
            </div>

            {list.length > 0 ? (
              <div className="space-y-2">{list.map((it) => renderItemRow(it, false))}</div>
            ) : (
              <div className="px-3.5 py-3 bg-white/50 border border-dashed border-[var(--hairline)] rounded-[3px] text-[11px] text-[var(--muted-foreground)] text-center">
                暂无条目
              </div>
            )}
          </section>
        );
      })}

      {/* Collapsed Done Group */}
      {doneColumn && (
        <section className="space-y-2 pt-2 border-t border-[var(--hairline)]">
          <button
            type="button"
            onClick={() => setDoneExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-white/75 border border-[var(--hairline)] hover:border-[var(--hairline-strong)] rounded-[3px] cursor-pointer transition"
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-[#2A7A68]" />
              <span className="nolan-title text-xs font-bold text-[#0F1E30]">{doneColumn.name}</span>
              <span className="font-mono text-[11px] text-[#2A7A68] font-semibold">{doneItems.length}</span>
            </div>
            <span className="nolan-label text-[10px] text-[var(--muted-foreground)]">
              {doneExpanded ? '收起 ▾' : '展开 ▸'}
            </span>
          </button>

          {doneExpanded && (
            <div className="space-y-2">
              {doneItems.length > 0 ? (
                doneItems.map((it) => renderItemRow(it, true))
              ) : (
                <div className="px-3.5 py-3 text-[11px] text-[var(--muted-foreground)] text-center">
                  勾选上方条目即可移入「{doneColumn.name}」
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export type { ItemType };
