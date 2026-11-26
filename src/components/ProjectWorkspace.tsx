import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CARD_FINISHES,
  COLUMN_TEMPLATES,
  ITEM_TYPES,
  detectItemType,
  isLocalPath,
  parseCardImages,
  parseCardLayout,
  parseCardLinks,
  type ColumnTemplateId,
  type ItemType,
  type Row,
  type WorkspaceColumn,
} from '../../shared/schema';
import { apiUnfurl } from '../lib/api';
import { useStore } from '../lib/store';
import { ulid } from '../lib/ulid';
import { BatchAddModal, type AddModalTab, type NewItemDraft } from './BatchAddModal';
import { MobileChecklist } from './MobileChecklist';

interface ProjectWorkspaceProps {
  card: Row;
  viewMode: 'desktop' | 'mobile';
  onClose: () => void;
  onOpenCardSettings: (card: Row) => void;
  onOpenLightbox: (src: string) => void;
}

function getItemTypeMeta(type?: string) {
  return ITEM_TYPES.find((t) => t.id === type) || ITEM_TYPES[0];
}

function isHttpUrl(url?: string): boolean {
  if (!url) return false;
  const s = url.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ProjectWorkspace({
  card,
  viewMode,
  onClose,
  onOpenCardSettings,
  onOpenLightbox,
}: ProjectWorkspaceProps) {
  const { items, upsertRow, deleteRow, mutateBatch, showToast } = useStore();

  const layout = useMemo(() => parseCardLayout(card.layout_json), [card.layout_json]);
  const motif = useMemo(
    () => CARD_FINISHES.find((f) => f.id === (card.finish || 'default')) || CARD_FINISHES[0],
    [card.finish],
  );
  const images = useMemo(() => parseCardImages(card.images_json), [card.images_json]);
  const legacyLinks = useMemo(() => parseCardLinks(card.links_json), [card.links_json]);

  const cardItems = useMemo(
    () =>
      items
        .filter((it) => it.card_id === card.id)
        .sort((a, b) => Number(a.sort || '0') - Number(b.sort || '0') || (a.created_at || '').localeCompare(b.created_at || '')),
    [items, card.id],
  );

  // Privacy mask lock state for masked cards
  const isMasked = Boolean(layout.masked);
  const [unlocked, setUnlocked] = useState(!isMasked);

  useEffect(() => {
    if (!isMasked) {
      setUnlocked(true);
      return;
    }
    const onVis = () => {
      if (document.hidden) setUnlocked(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [isMasked]);

  // Columns resolution
  const needsTemplate = layout.columns === undefined && cardItems.length === 0;
  const columns: WorkspaceColumn[] = useMemo(() => {
    if (layout.columns !== undefined) return layout.columns;
    if (cardItems.length > 0) return COLUMN_TEMPLATES[0].columns;
    return [];
  }, [layout.columns, cardItems.length]);

  const doneColumnId = columns.length >= 2 ? columns[columns.length - 1].id : null;

  const [narrowScreen, setNarrowScreen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );
  useEffect(() => {
    const onResize = () => setNarrowScreen(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isMobile = viewMode === 'mobile' || narrowScreen;

  // UI states
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all');
  const [sidebarOpen, setSidebarOpen] = useState(() => !(viewMode === 'mobile' || (typeof window !== 'undefined' && window.innerWidth < 640)));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [addModal, setAddModal] = useState<{ tab: AddModalTab; files?: File[] } | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);

  // Inline column quick-add inputs
  const [colQuickInputs, setColQuickInputs] = useState<Record<string, string>>({});
  // Inline column rename
  const [renamingColId, setRenamingColId] = useState<string | null>(null);
  const [renamingColName, setRenamingColName] = useState('');
  // New column creation
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');

  // Drag-and-drop state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ colId: string; beforeItemId: string | null } | null>(null);

  // Project notes editor state
  const [projectNotes, setProjectNotes] = useState(card.content_md || '');
  const notesDirty = projectNotes !== (card.content_md || '');
  useEffect(() => {
    setProjectNotes(card.content_md || '');
  }, [card.id, card.content_md]);

  // Selected item detail state
  const selectedItem = useMemo(
    () => (selectedItemId ? cardItems.find((it) => it.id === selectedItemId) || null : null),
    [cardItems, selectedItemId],
  );

  // Keyboard Escape handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        (document.activeElement as HTMLElement).blur();
        return;
      }
      if (addModal) {
        setAddModal(null);
      } else if (selectedItemId) {
        setSelectedItemId(null);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addModal, selectedItemId, onClose]);

  // Progress stats
  const totalCount = cardItems.length;
  const doneCount = useMemo(() => {
    if (!doneColumnId) return 0;
    return cardItems.filter((it) => it.column_id === doneColumnId).length;
  }, [cardItems, doneColumnId]);
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Type counts for filter bar
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of cardItems) {
      const t = it.type || 'task';
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [cardItems]);

  // Filtered items grouped by column
  const filteredItems = useMemo(() => {
    if (typeFilter === 'all') return cardItems;
    return cardItems.filter((it) => (it.type || 'task') === typeFilter);
  }, [cardItems, typeFilter]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const col of columns) map.set(col.id, []);
    const fallbackColId = columns[0]?.id;
    for (const it of filteredItems) {
      const targetId = map.has(it.column_id) ? it.column_id : fallbackColId;
      if (targetId) map.get(targetId)!.push(it);
    }
    return map;
  }, [columns, filteredItems]);

  // Save columns helper
  const saveColumns = useCallback(
    async (nextCols: WorkspaceColumn[]) => {
      const nextLayout = { ...layout, columns: nextCols };
      await upsertRow('Cards', { layout_json: JSON.stringify(nextLayout) }, card);
    },
    [layout, upsertRow, card],
  );

  async function applyTemplate(templateId: ColumnTemplateId) {
    const tpl = COLUMN_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    await saveColumns(tpl.columns.map((c) => ({ ...c })));
    showToast(`已启用「${tpl.label}」模板`);
  }

  async function handleAddColumn() {
    const name = newColumnName.trim();
    if (!name) {
      setAddingColumn(false);
      return;
    }
    const nextCols = [...columns, { id: `col_${ulid().slice(-8).toLowerCase()}`, name }];
    await saveColumns(nextCols);
    setNewColumnName('');
    setAddingColumn(false);
  }

  async function handleRenameColumn(colId: string) {
    const name = renamingColName.trim();
    setRenamingColId(null);
    if (!name) return;
    const nextCols = columns.map((c) => (c.id === colId ? { ...c, name } : c));
    await saveColumns(nextCols);
  }

  async function handleMoveColumn(colId: string, dir: -1 | 1) {
    const idx = columns.findIndex((c) => c.id === colId);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= columns.length) return;
    const nextCols = columns.slice();
    const [moved] = nextCols.splice(idx, 1);
    nextCols.splice(target, 0, moved);
    await saveColumns(nextCols);
  }

  async function handleDeleteColumn(col: WorkspaceColumn) {
    const affected = cardItems.filter((it) => it.column_id === col.id);
    const remaining = columns.filter((c) => c.id !== col.id);
    if (affected.length > 0 && remaining.length === 0) {
      showToast('请先新建其他列，或清空本列后再删除');
      return;
    }
    const fallbackCol = remaining[0];
    const ops: { table: 'Cards' | 'Items'; op: 'upsert'; row: Row; patch: Record<string, string> }[] = [
      {
        table: 'Cards',
        op: 'upsert',
        row: card,
        patch: { layout_json: JSON.stringify({ ...layout, columns: remaining }) },
      },
    ];
    if (affected.length > 0 && fallbackCol) {
      const existingInFallback = cardItems.filter((it) => it.column_id === fallbackCol.id).length;
      affected.forEach((it, idx) => {
        ops.push({
          table: 'Items',
          op: 'upsert',
          row: it,
          patch: { column_id: fallbackCol.id, sort: String(existingInFallback + idx) },
        });
      });
    }
    await mutateBatch(ops);
    showToast(
      affected.length > 0 && fallbackCol
        ? `已删除「${col.name}」，${affected.length} 条移至「${fallbackCol.name}」`
        : `已删除列「${col.name}」`,
    );
  }

  async function handleQuickAdd(colId: string) {
    const raw = (colQuickInputs[colId] || '').trim();
    if (!raw) return;
    setColQuickInputs((prev) => ({ ...prev, [colId]: '' }));

    const isUrlOrPath = isHttpUrl(raw) || isLocalPath(raw);
    const type: ItemType = isUrlOrPath ? detectItemType(raw) : 'task';
    let title = raw;
    if (isLocalPath(raw)) {
      const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
      title = parts[parts.length - 1] || raw;
    } else if (isHttpUrl(raw)) {
      try {
        const u = new URL(raw);
        title = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname.slice(0, 28) : '');
      } catch {
        title = raw.slice(0, 48);
      }
    }

    const colCount = cardItems.filter((it) => it.column_id === colId).length;
    const newId = await upsertRow('Items', {
      card_id: card.id,
      column_id: colId,
      prev_column_id: '',
      sort: String(colCount),
      type,
      title,
      url: isUrlOrPath ? raw : '',
      tags: '',
      note: '',
      due: '',
      body_md: '',
    });

    // Silently fetch real page title in background when a URL is pasted into quick-add
    if (isHttpUrl(raw)) {
      apiUnfurl([raw])
        .then((res) => {
          const first = res.results[0];
          if (first && first.ok && first.title && first.title !== title) {
            void upsertRow(
              'Items',
              { title: first.title, type: first.type },
              { id: newId, version: '0', updated_at: '' } as Row,
            );
          }
        })
        .catch(() => undefined);
    }
  }

  async function handleBatchAddItems(drafts: NewItemDraft[]) {
    if (!drafts.length) return;
    const colCounts = new Map<string, number>();
    for (const it of cardItems) {
      colCounts.set(it.column_id, (colCounts.get(it.column_id) || 0) + 1);
    }
    const fallbackColId = columns[0]?.id || '';
    const ops = drafts.map((d) => {
      const targetCol = d.column_id || fallbackColId;
      const sortIdx = colCounts.get(targetCol) || 0;
      colCounts.set(targetCol, sortIdx + 1);
      return {
        table: 'Items' as const,
        op: 'upsert' as const,
        rowId: ulid(),
        patch: {
          card_id: card.id,
          column_id: targetCol,
          prev_column_id: '',
          sort: String(sortIdx),
          type: d.type,
          title: d.title,
          url: d.url,
          tags: d.tags,
          note: d.note,
          due: d.due,
          body_md: '',
        },
      };
    });
    await mutateBatch(ops);
    showToast(drafts.length === 1 ? '条目已添加' : `已批量加入 ${drafts.length} 条内容`);
  }

  async function handleToggleDone(item: Row, currentlyDone: boolean) {
    if (!doneColumnId || columns.length === 0) return;
    if (!currentlyDone) {
      const doneCountNow = cardItems.filter((it) => it.column_id === doneColumnId).length;
      const originCol = columns.some((c) => c.id === item.column_id) ? item.column_id : columns[0].id;
      await upsertRow(
        'Items',
        {
          column_id: doneColumnId,
          prev_column_id: originCol !== doneColumnId ? originCol : '',
          sort: String(doneCountNow),
        },
        item,
      );
    } else {
      const prevValid =
        item.prev_column_id &&
        item.prev_column_id !== doneColumnId &&
        columns.some((c) => c.id === item.prev_column_id);
      const restoreColId = prevValid ? item.prev_column_id : columns[0].id;
      const restoreCount = cardItems.filter((it) => it.column_id === restoreColId).length;
      await upsertRow(
        'Items',
        {
          column_id: restoreColId,
          sort: String(restoreCount),
        },
        item,
      );
    }
  }

  async function handleMobileQuickAdd(raw: string) {
    const firstColId = columns[0]?.id;
    if (!firstColId) return;
    const isUrlOrPath = isHttpUrl(raw) || isLocalPath(raw);
    const type: ItemType = isUrlOrPath ? detectItemType(raw) : 'task';
    let title = raw;
    if (isLocalPath(raw)) {
      const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
      title = parts[parts.length - 1] || raw;
    } else if (isHttpUrl(raw)) {
      try {
        const u = new URL(raw);
        title = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname.slice(0, 28) : '');
      } catch {
        title = raw.slice(0, 48);
      }
    }
    const colCount = cardItems.filter((it) => it.column_id === firstColId).length;
    const newId = await upsertRow('Items', {
      card_id: card.id,
      column_id: firstColId,
      prev_column_id: '',
      sort: String(colCount),
      type,
      title,
      url: isUrlOrPath ? raw : '',
      tags: '',
      note: '',
      due: '',
      body_md: '',
    });
    if (isHttpUrl(raw)) {
      apiUnfurl([raw])
        .then((res) => {
          const first = res.results[0];
          if (first && first.ok && first.title && first.title !== title) {
            void upsertRow(
              'Items',
              { title: first.title, type: first.type },
              { id: newId, version: '0', updated_at: '' } as Row,
            );
          }
        })
        .catch(() => undefined);
    }
  }

  async function handleDropItem(itemId: string, targetColId: string, beforeItemId: string | null) {
    const item = cardItems.find((it) => it.id === itemId);
    if (!item) return;
    const sourceColId = columns.some((c) => c.id === item.column_id) ? item.column_id : columns[0]?.id;
    if (!sourceColId) return;

    const targetList = cardItems.filter((it) => it.id !== itemId && it.column_id === targetColId);
    let insertIdx = targetList.length;
    if (beforeItemId) {
      const found = targetList.findIndex((it) => it.id === beforeItemId);
      if (found !== -1) insertIdx = found;
    }
    targetList.splice(insertIdx, 0, item);

    const ops: { table: 'Items'; op: 'upsert'; row: Row; patch: Record<string, string> }[] = [];

    // Reindex target column
    targetList.forEach((row, idx) => {
      const patch: Record<string, string> = {};
      if (row.id === item.id) {
        if (row.column_id !== targetColId) {
          patch.column_id = targetColId;
          if (targetColId === doneColumnId && sourceColId !== doneColumnId) {
            patch.prev_column_id = sourceColId;
          }
        }
      }
      if (String(idx) !== (row.sort || '')) {
        patch.sort = String(idx);
      }
      if (Object.keys(patch).length > 0) {
        ops.push({ table: 'Items', op: 'upsert', row, patch });
      }
    });

    // Reindex source column if moved across columns
    if (sourceColId !== targetColId) {
      const sourceList = cardItems.filter((it) => it.id !== itemId && it.column_id === sourceColId);
      sourceList.forEach((row, idx) => {
        if (String(idx) !== (row.sort || '')) {
          ops.push({ table: 'Items', op: 'upsert', row, patch: { sort: String(idx) } });
        }
      });
    }

    if (ops.length > 0) {
      await mutateBatch(ops);
    }
  }

  async function copyPath(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(path);
      showToast('已复制本地路径');
    } catch {
      showToast('复制失败，请手动复制');
    }
  }

  async function saveProjectNotes() {
    await upsertRow('Cards', { content_md: projectNotes }, card);
    showToast('项目笔记已保存');
  }

  // ---- Privacy Curtain if masked & locked ----
  if (isMasked && !unlocked) {
    return (
      <div className="fixed inset-0 z-50 canvas-dunkirk flex flex-col">
        <header className="h-14 px-5 border-b border-[var(--hairline)] bg-[#ECF0F4]/95 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="dunkirk-btn bg-white px-3 py-1.5 nolan-label text-[10px] font-semibold text-[#0F1E30] cursor-pointer"
          >
            ← 返回画布
          </button>
          <span className="nolan-label text-[10px] text-[var(--muted-foreground)]">MASKED WORKSPACE</span>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
          <div className="w-12 h-12 rounded-[3px] border border-[var(--hairline-strong)] bg-white flex items-center justify-center text-[#0F1E30]">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <h2 className="nolan-title text-base font-bold text-[#0F1E30]">{card.title || '未命名模块'}</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              此项目已开启默认隐藏，切出标签页后会自动重新锁定
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-5 py-2 rounded-[2px] nolan-label text-[11px] font-semibold cursor-pointer transition"
          >
            点击解锁查看
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (!needsTemplate && !draggingId && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          if (!fileDragOver) setFileDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setFileDragOver(false);
      }}
      onDrop={(e) => {
        if (!needsTemplate && !draggingId && e.dataTransfer.files?.length) {
          e.preventDefault();
          setFileDragOver(false);
          setAddModal({ tab: 'files', files: Array.from(e.dataTransfer.files) });
        }
      }}
      className="fixed inset-0 z-50 canvas-dunkirk flex flex-col overflow-hidden"
    >
      {/* Top accent bar */}
      <div className="h-[3px] w-full shrink-0" style={{ background: motif.dot }} />

      {/* OS File Drop Overlay */}
      {fileDragOver && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setFileDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setFileDragOver(false);
            if (e.dataTransfer.files?.length) {
              setAddModal({ tab: 'files', files: Array.from(e.dataTransfer.files) });
            }
          }}
          className="fixed inset-0 z-[55] bg-[#0F1E30]/60 backdrop-blur-xs flex items-center justify-center p-6"
        >
          <div className="w-full max-w-md bg-white border-2 border-dashed border-[#D94E28] rounded-[3px] p-10 text-center space-y-2 shadow-2xl pointer-events-none">
            <p className="nolan-display text-xs font-bold text-[#D94E28]">DROP LOCAL FILES</p>
            <p className="nolan-title text-base font-bold text-[#0F1E30]">松开以添加本地文件引用</p>
            <p className="text-xs text-[var(--muted-foreground)]">自动识别文件名与类型，仅记录路径，不上传原文件</p>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="border-b border-[var(--hairline)] bg-[#ECF0F4]/95 backdrop-blur-xl shrink-0">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              title="返回画布 (Esc)"
              className="dunkirk-btn bg-white hover:bg-[#0F1E30] hover:text-white px-2.5 py-1.5 nolan-label text-[10px] font-semibold text-[#0F1E30] cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              <span>←</span>
              <span className="hidden sm:inline">画布</span>
            </button>

            <div className="min-w-0 flex items-center gap-2.5">
              <span className="w-2 h-2 shrink-0" style={{ background: motif.dot }} />
              {card.tag && (
                <span className="hidden md:inline nolan-label text-[10px] font-semibold text-[var(--muted-foreground)] shrink-0">
                  {card.tag}
                </span>
              )}
              <h1 className="nolan-title text-sm sm:text-base font-bold text-[#0F1E30] truncate">
                {card.title || '未命名项目'}
              </h1>
            </div>

            {/* Progress indicator */}
            {totalCount > 0 && doneColumnId && (
              <div className="hidden md:flex items-center gap-2.5 pl-3 ml-1 border-l border-[var(--hairline)] shrink-0">
                <div className="w-24 h-1.5 bg-[#0F1E30]/10 rounded-[1px] overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${progressPct}%`, background: progressPct === 100 ? '#2A7A68' : motif.dot }}
                  />
                </div>
                <span className="font-mono text-[11px] font-semibold text-[#0F1E30]">
                  {doneCount}/{totalCount}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{progressPct}%</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!needsTemplate && (
              <button
                type="button"
                onClick={() => setAddModal({ tab: 'links' })}
                className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-3 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer transition flex items-center gap-1"
              >
                <span>+</span>
                <span>添加</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenCardSettings(card)}
              title="编辑卡片标题、色系、标签、隐藏设置"
              className="dunkirk-btn bg-white/85 hover:bg-white px-2.5 py-1.5 nolan-label text-[10px] font-semibold text-[#0F1E30] cursor-pointer"
            >
              卡片设置
            </button>

            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              title="展开 / 收起右侧笔记与详情栏"
              className={`dunkirk-btn px-2.5 py-1.5 nolan-label text-[10px] font-semibold cursor-pointer ${
                sidebarOpen ? 'bg-[#0F1E30] border-[#0F1E30] text-white' : 'bg-white/85 text-[#0F1E30]'
              }`}
            >
              {selectedItem ? '条目详情' : '项目笔记'}
            </button>
          </div>
        </div>

        {/* Type Filter Bar */}
        {!needsTemplate && totalCount > 0 && (
          <div className="px-4 sm:px-6 py-2 border-t border-[var(--hairline)] bg-white/50 flex items-center gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-[2px] border text-[10.5px] font-semibold transition cursor-pointer shrink-0 ${
                typeFilter === 'all'
                  ? 'bg-[#0F1E30] border-[#0F1E30] text-white'
                  : 'bg-white border-[var(--hairline)] text-[#0F1E30] hover:border-[var(--hairline-strong)]'
              }`}
            >
              全部 <span className="font-mono opacity-75 ml-0.5">{totalCount}</span>
            </button>
            {ITEM_TYPES.map((t) => {
              const count = typeCounts[t.id] || 0;
              if (count === 0 && typeFilter !== t.id) return null;
              const active = typeFilter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTypeFilter(active ? 'all' : t.id)}
                  className={`px-2.5 py-1 rounded-[2px] border text-[10.5px] font-semibold transition cursor-pointer shrink-0 inline-flex items-center gap-1.5 ${
                    active
                      ? 'bg-[#0F1E30] border-[#0F1E30] text-white'
                      : 'bg-white border-[var(--hairline)] text-[#0F1E30] hover:border-[var(--hairline-strong)]'
                  }`}
                >
                  <span className="w-1.5 h-1.5 shrink-0" style={{ background: active ? '#FFFFFF' : t.color }} />
                  <span>{t.label}</span>
                  <span className="font-mono opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Main Split Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Center Area: Template Picker / Mobile Checklist / Desktop Kanban */}
        {needsTemplate ? (
          <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
            <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto">
              <div className="text-center mb-6">
                <p className="nolan-display text-[11px] font-bold text-[#D94E28]">INITIALIZE WORKSPACE</p>
                <h2 className="nolan-title text-lg font-bold text-[#0F1E30] mt-1.5">选择一套看板列模板</h2>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  之后可随时重命名、增删或调整列顺序；最后一列统一计为完成并计算进度
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {COLUMN_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => void applyTemplate(tpl.id)}
                    className="text-left p-4 bg-white border border-[var(--hairline)] hover:border-[#0F1E30] rounded-[3px] shadow-[var(--card-shadow)] transition cursor-pointer group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="nolan-title text-sm font-bold text-[#0F1E30] group-hover:text-[#D94E28] transition">
                        {tpl.label}
                      </span>
                      <span className="nolan-label text-[9.5px] text-[var(--muted-foreground)]">
                        {tpl.columns.length > 0 ? `${tpl.columns.length} COLS` : 'CUSTOM'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1.5">{tpl.desc}</p>
                    {tpl.columns.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-3">
                        {tpl.columns.map((c, idx) => (
                          <span
                            key={c.id}
                            className={`px-2 py-0.5 rounded-[2px] text-[10px] font-semibold border ${
                              idx === tpl.columns.length - 1
                                ? 'border-[#2A7A68]/40 bg-[#2A7A68]/10 text-[#2A7A68]'
                                : 'border-[var(--hairline)] bg-[#ECF0F4]/60 text-[#0F1E30]'
                            }`}
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : isMobile ? (
          <MobileChecklist
            columns={columns}
            doneColumnId={doneColumnId}
            items={filteredItems}
            accentColor={motif.dot}
            onToggleDone={handleToggleDone}
            onQuickAdd={handleMobileQuickAdd}
            onSelectItem={(it) => {
              setSelectedItemId(it.id);
              setSidebarOpen(true);
            }}
            onCopyPath={(p) => {
              void navigator.clipboard.writeText(p).then(
                () => showToast('已复制本地路径'),
                () => showToast('复制失败，请手动复制'),
              );
            }}
          />
        ) : (
          <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden p-4 sm:p-6">
            <div className="h-full flex items-start gap-4">
              {columns.map((col, colIdx) => {
                const colItems = itemsByColumn.get(col.id) || [];
                const isDoneCol = col.id === doneColumnId;
                const isDropHere = dropTarget?.colId === col.id && dropTarget.beforeItemId === null;

                return (
                  <section
                    key={col.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!draggingId) return;
                      if (dropTarget?.colId !== col.id || dropTarget.beforeItemId !== null) {
                        setDropTarget({ colId: col.id, beforeItemId: null });
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dragged = e.dataTransfer.getData('text/plain') || draggingId;
                      const targetBefore = dropTarget?.colId === col.id ? dropTarget.beforeItemId : null;
                      setDraggingId(null);
                      setDropTarget(null);
                      if (dragged) void handleDropItem(dragged, col.id, targetBefore);
                    }}
                    className={`w-[288px] sm:w-[304px] max-h-full shrink-0 flex flex-col bg-white/75 border rounded-[3px] transition ${
                      isDropHere ? 'border-[#D94E28] bg-[#D94E28]/[0.03]' : 'border-[var(--hairline)]'
                    }`}
                  >
                    {/* Column Header */}
                    <div className="px-3.5 py-2.5 border-b border-[var(--hairline)] flex items-center justify-between gap-2 group/col shrink-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="w-1.5 h-1.5 shrink-0"
                          style={{ background: isDoneCol ? '#2A7A68' : motif.dot }}
                        />
                        {renamingColId === col.id ? (
                          <input
                            autoFocus
                            value={renamingColName}
                            onChange={(e) => setRenamingColName(e.target.value)}
                            onBlur={() => void handleRenameColumn(col.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleRenameColumn(col.id);
                              if (e.key === 'Escape') setRenamingColId(null);
                            }}
                            className="w-full px-1.5 py-0.5 text-xs font-bold bg-white border border-[#0F1E30] rounded-[2px] outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingColId(col.id);
                              setRenamingColName(col.name);
                            }}
                            title="点击重命名列"
                            className="nolan-title text-xs font-bold text-[#0F1E30] truncate text-left hover:text-[#D94E28] cursor-pointer"
                          >
                            {col.name}
                          </button>
                        )}
                        <span className="font-mono text-[10.5px] text-[var(--muted-foreground)] shrink-0">
                          {colItems.length}
                        </span>
                        {isDoneCol && (
                          <span className="nolan-label text-[8.5px] px-1 py-0.25 border border-[#2A7A68]/40 text-[#2A7A68] bg-[#2A7A68]/10 shrink-0">
                            完成
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover/col:opacity-100 focus-within:opacity-100 transition shrink-0">
                        {colIdx > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleMoveColumn(col.id, -1)}
                            title="左移此列"
                            className="px-1 py-0.5 text-[11px] text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer"
                          >
                            ←
                          </button>
                        )}
                        {colIdx < columns.length - 1 && (
                          <button
                            type="button"
                            onClick={() => void handleMoveColumn(col.id, 1)}
                            title="右移此列"
                            className="px-1 py-0.5 text-[11px] text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer"
                          >
                            →
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDeleteColumn(col)}
                          title="删除此列"
                          className="px-1 py-0.5 text-[11px] text-[var(--muted-foreground)] hover:text-[#D94E28] cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* Column Items List */}
                    <div className="flex-1 overflow-y-auto card-scroll p-2.5 space-y-2 min-h-[72px]">
                      {colItems.map((it) => {
                        const typeMeta = getItemTypeMeta(it.type);
                        const itemTags = parseTags(it.tags);
                        const selected = selectedItemId === it.id;
                        const isBeforeDrop = dropTarget?.colId === col.id && dropTarget.beforeItemId === it.id;
                        const hasHttp = isHttpUrl(it.url);
                        const hasLocal = !hasHttp && Boolean(it.url) && (it.type === 'file' || isLocalPath(it.url));

                        return (
                          <div key={it.id}>
                            {isBeforeDrop && <div className="h-[2px] bg-[#D94E28] mb-2 rounded-full" />}
                            <div
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', it.id);
                                e.dataTransfer.effectAllowed = 'move';
                                setDraggingId(it.id);
                              }}
                              onDragEnd={() => {
                                setDraggingId(null);
                                setDropTarget(null);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggingId && draggingId !== it.id) {
                                  setDropTarget({ colId: col.id, beforeItemId: it.id });
                                }
                              }}
                              onClick={() => {
                                setSelectedItemId(it.id);
                                setSidebarOpen(true);
                              }}
                              className={`p-3 bg-white border rounded-[3px] cursor-pointer transition group/item ${
                                draggingId === it.id ? 'opacity-40' : ''
                              } ${
                                selected
                                  ? 'border-[#0F1E30] ring-1 ring-[#0F1E30] shadow-sm'
                                  : 'border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
                              }`}
                            >
                              {/* Top meta row */}
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span
                                    className="w-1.5 h-1.5 shrink-0"
                                    style={{ background: typeMeta.color }}
                                  />
                                  <span className="nolan-label text-[9px] font-semibold text-[var(--muted-foreground)]">
                                    {typeMeta.label}
                                  </span>
                                  {it.due && (
                                    <span className="font-mono text-[9.5px] text-[#D94E28]">{it.due}</span>
                                  )}
                                  {it.body_md && (
                                    <span className="nolan-label text-[8.5px] px-1 border border-[var(--hairline)] text-[var(--muted-foreground)]">
                                      笔记
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {hasHttp && (
                                    <a
                                      href={it.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title="打开链接"
                                      className="px-1.5 py-0.5 rounded-[2px] border border-[var(--hairline)] hover:border-[#25548A] hover:text-[#25548A] nolan-label text-[9px] font-semibold transition"
                                    >
                                      ↗
                                    </a>
                                  )}
                                  {hasLocal && (
                                    <button
                                      type="button"
                                      onClick={(e) => void copyPath(e, it.url)}
                                      title={`复制路径：${it.url}`}
                                      className="px-1.5 py-0.5 rounded-[2px] border border-[var(--hairline)] hover:border-[#D94E28] hover:text-[#D94E28] nolan-label text-[9px] font-semibold cursor-pointer transition"
                                    >
                                      复制路径
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Title */}
                              <div
                                className={`text-[13px] font-semibold leading-snug break-words ${
                                  isDoneCol ? 'line-through opacity-60' : 'text-[#0F1E30]'
                                }`}
                              >
                                {it.title || '未命名条目'}
                              </div>

                              {/* Note preview */}
                              {it.note && (
                                <p className="text-[11.5px] text-[var(--muted-foreground)] mt-1 line-clamp-2 leading-relaxed">
                                  {it.note}
                                </p>
                              )}

                              {/* Tags */}
                              {itemTags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {itemTags.map((tg) => (
                                    <span
                                      key={tg}
                                      className="px-1.5 py-0.25 rounded-[2px] bg-[#ECF0F4] text-[#0F1E30] text-[10px] font-medium"
                                    >
                                      #{tg}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {colItems.length === 0 && (
                        <div className="py-6 text-center text-[11px] text-[var(--muted-foreground)] opacity-60 select-none">
                          拖拽条目到此处，或在下方快速添加
                        </div>
                      )}
                    </div>

                    {/* Inline Quick Add */}
                    <div className="p-2.5 border-t border-[var(--hairline)] shrink-0">
                      <input
                        value={colQuickInputs[col.id] || ''}
                        onChange={(e) => setColQuickInputs((prev) => ({ ...prev, [col.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void handleQuickAdd(col.id);
                          }
                        }}
                        placeholder="+ 输入任务、链接或本地路径，回车添加…"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-[var(--hairline)] focus:border-[#0F1E30] rounded-[2px] outline-none placeholder:text-[var(--muted-foreground)]/60"
                      />
                    </div>
                  </section>
                );
              })}

              {/* Add Column Button / Form */}
              <div className="w-[240px] shrink-0">
                {addingColumn ? (
                  <div className="p-3 bg-white border border-[var(--hairline-strong)] rounded-[3px] space-y-2">
                    <input
                      autoFocus
                      value={newColumnName}
                      onChange={(e) => setNewColumnName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleAddColumn();
                        if (e.key === 'Escape') {
                          setAddingColumn(false);
                          setNewColumnName('');
                        }
                      }}
                      placeholder="输入新列名…"
                      className="w-full px-2.5 py-1.5 text-xs border border-[var(--hairline-strong)] rounded-[2px] outline-none focus:border-[#0F1E30]"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingColumn(false);
                          setNewColumnName('');
                        }}
                        className="px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAddColumn()}
                        className="bg-[#0F1E30] text-white px-3 py-1 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer"
                      >
                        添加列
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingColumn(true)}
                    className="w-full py-3 px-4 border border-dashed border-[var(--hairline-strong)] bg-white/40 hover:bg-white hover:border-[#0F1E30] rounded-[3px] nolan-label text-[10.5px] font-semibold text-[#0F1E30] cursor-pointer transition"
                  >
                    + 新建列
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Right Collapsible Sidebar: Project Notes <-> Item Detail */}
        {sidebarOpen && (
          <aside
            className={
              isMobile
                ? 'absolute inset-0 z-20 bg-white flex flex-col min-h-0'
                : 'w-[340px] lg:w-[380px] shrink-0 border-l border-[var(--hairline)] bg-white flex flex-col min-h-0'
            }
          >
            {selectedItem ? (
              <ItemDetailPanel
                item={selectedItem}
                columns={columns}
                doneColumnId={doneColumnId}
                onBackToNotes={() => {
                  setSelectedItemId(null);
                  if (isMobile) setSidebarOpen(false);
                }}
                onSave={async (patch) => {
                  await upsertRow('Items', patch, selectedItem);
                  showToast('条目已保存');
                }}
                onDelete={async () => {
                  await deleteRow('Items', selectedItem);
                  setSelectedItemId(null);
                  if (isMobile) setSidebarOpen(false);
                  showToast('条目已删除');
                }}
                onCopyPath={(p) => {
                  void navigator.clipboard.writeText(p).then(
                    () => showToast('已复制本地路径'),
                    () => showToast('复制失败，请手动复制'),
                  );
                }}
              />
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-[var(--hairline)] flex items-center justify-between gap-2">
                  <div>
                    <span className="nolan-label text-[10px] font-bold text-[#0F1E30]">PROJECT NOTES</span>
                    <p className="text-[11px] text-[var(--muted-foreground)]">原卡片文字与随手笔记</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {notesDirty && (
                      <button
                        type="button"
                        onClick={() => void saveProjectNotes()}
                        className="bg-[#D94E28] text-white px-3 py-1 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer"
                      >
                        保存
                      </button>
                    )}
                    {isMobile && (
                      <button
                        type="button"
                        onClick={() => setSidebarOpen(false)}
                        className="dunkirk-btn bg-white px-2.5 py-1 nolan-label text-[10px] font-semibold cursor-pointer"
                      >
                        返回
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto card-scroll p-4 space-y-4">
                  <textarea
                    value={projectNotes}
                    onChange={(e) => setProjectNotes(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                        e.preventDefault();
                        if (notesDirty) void saveProjectNotes();
                      }
                    }}
                    rows={12}
                    placeholder="记录项目背景、目标、阶段复盘或零散想法…（Ctrl+S 保存）"
                    className="w-full px-3 py-2.5 text-xs leading-relaxed bg-[#ECF0F4]/40 border border-[var(--hairline)] focus:border-[#0F1E30] focus:bg-white rounded-[2px] outline-none resize-y font-sans"
                  />

                  {/* Legacy card images */}
                  {images.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-[var(--hairline)]">
                      <span className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)]">
                        卡片图片 ({images.length})
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {images.map((im) => {
                          const src = `/api/image/${encodeURIComponent(im.file_id)}`;
                          return (
                            <img
                              key={im.id}
                              src={src}
                              alt={im.caption || ''}
                              onClick={() => onOpenLightbox(src)}
                              className="w-full h-24 object-cover rounded-[2px] border border-[var(--hairline)] cursor-zoom-in"
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Legacy card links */}
                  {legacyLinks.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-[var(--hairline)]">
                      <span className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)]">
                        关联文档 ({legacyLinks.length})
                      </span>
                      {legacyLinks.map((lk) => (
                        <a
                          key={lk.id}
                          href={lk.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[2px] border border-[var(--hairline)] hover:border-[#0F1E30] text-xs text-[#0F1E30] transition"
                        >
                          <span className="truncate">{lk.title || lk.url}</span>
                          <span className="text-[10px] opacity-60 shrink-0">↗</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Batch / File / Single Add Modal */}
      {addModal && (
        <BatchAddModal
          cardId={card.id}
          columns={columns}
          defaultColumnId={columns[0]?.id || ''}
          initialTab={addModal.tab}
          initialFiles={addModal.files}
          onAddItems={handleBatchAddItems}
          onClose={() => setAddModal(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item Detail Panel (Right Sidebar)
// ---------------------------------------------------------------------------
function ItemDetailPanel({
  item,
  columns,
  doneColumnId,
  onBackToNotes,
  onSave,
  onDelete,
  onCopyPath,
}: {
  item: Row;
  columns: WorkspaceColumn[];
  doneColumnId: string | null;
  onBackToNotes: () => void;
  onSave: (patch: Record<string, string>) => Promise<void>;
  onDelete: () => Promise<void>;
  onCopyPath: (path: string) => void;
}) {
  const [title, setTitle] = useState(item.title || '');
  const [type, setType] = useState<ItemType>((item.type as ItemType) || 'task');
  const [columnId, setColumnId] = useState(item.column_id || columns[0]?.id || '');
  const [url, setUrl] = useState(item.url || '');
  const [tags, setTags] = useState(item.tags || '');
  const [due, setDue] = useState(item.due || '');
  const [note, setNote] = useState(item.note || '');
  const [bodyMd, setBodyMd] = useState(item.body_md || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(item.title || '');
    setType((item.type as ItemType) || 'task');
    setColumnId(item.column_id || columns[0]?.id || '');
    setUrl(item.url || '');
    setTags(item.tags || '');
    setDue(item.due || '');
    setNote(item.note || '');
    setBodyMd(item.body_md || '');
  }, [item, columns]);

  const dirty =
    title !== (item.title || '') ||
    type !== ((item.type as ItemType) || 'task') ||
    columnId !== (item.column_id || columns[0]?.id || '') ||
    url !== (item.url || '') ||
    tags !== (item.tags || '') ||
    due !== (item.due || '') ||
    note !== (item.note || '') ||
    bodyMd !== (item.body_md || '');

  async function handleSave() {
    setSaving(true);
    try {
      const patch: Record<string, string> = {
        title: title.trim() || '未命名条目',
        type,
        column_id: columnId,
        url: url.trim(),
        tags: tags.trim(),
        due: due.trim(),
        note: note.trim(),
        body_md: bodyMd,
      };
      if (columnId !== item.column_id && columnId === doneColumnId && item.column_id !== doneColumnId) {
        patch.prev_column_id = item.column_id;
      }
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  }

  const hasHttp = isHttpUrl(url);
  const hasLocal = !hasHttp && Boolean(url.trim()) && (type === 'file' || isLocalPath(url));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-[var(--hairline)] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBackToNotes}
          className="nolan-label text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer"
        >
          ← 项目笔记
        </button>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="bg-[#D94E28] text-white px-3 py-1 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onDelete()}
            className="text-[11px] font-semibold text-[#D94E28] hover:underline cursor-pointer"
          >
            删除
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto card-scroll p-4 space-y-3.5">
        <div>
          <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
            标题
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm font-semibold border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
          />
        </div>

        <div>
          <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
            类型
          </label>
          <div className="flex flex-wrap gap-1">
            {ITEM_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={`px-2 py-1 rounded-[2px] border text-[10.5px] font-semibold cursor-pointer transition inline-flex items-center gap-1 ${
                  type === t.id
                    ? 'bg-[#0F1E30] border-[#0F1E30] text-white'
                    : 'bg-white border-[var(--hairline)] text-[#0F1E30] hover:border-[var(--hairline-strong)]'
                }`}
              >
                <span className="w-1.5 h-1.5" style={{ background: type === t.id ? '#fff' : t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {columns.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                所在列
              </label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-white border border-[var(--hairline-strong)] rounded-[2px] outline-none"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                截止日期
              </label>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-white border border-[var(--hairline-strong)] rounded-[2px] outline-none font-mono"
              />
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)]">
              链接 / 本地路径
            </label>
            {hasHttp && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="nolan-label text-[9.5px] font-semibold text-[#25548A] hover:underline"
              >
                打开链接 ↗
              </a>
            )}
            {hasLocal && (
              <button
                type="button"
                onClick={() => onCopyPath(url.trim())}
                className="nolan-label text-[9.5px] font-semibold text-[#D94E28] hover:underline cursor-pointer"
              >
                复制路径
              </button>
            )}
          </div>
          <input
            value={url}
            onChange={(e) => {
              const v = e.target.value;
              setUrl(v);
              if (v.trim() && type === 'task') {
                setType(detectItemType(v));
              }
            }}
            placeholder="https://... 或 /Users/... / D:\..."
            className="w-full px-2.5 py-1.5 text-xs font-mono border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
          />
        </div>

        <div>
          <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
            标签（逗号分隔）
          </label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="例如：基础, 精读, 重点"
            className="w-full px-2.5 py-1.5 text-xs border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
          />
        </div>

        <div>
          <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
            简短备注（显示在看板卡片上）
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="一句话说明或进度标记"
            className="w-full px-2.5 py-1.5 text-xs border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
          />
        </div>

        <div>
          <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
            详细笔记 (Markdown)
          </label>
          <textarea
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (dirty) void handleSave();
              }
            }}
            rows={8}
            placeholder="写详细笔记、摘录、思考…（Ctrl+S 保存）"
            className="w-full px-2.5 py-2 text-xs leading-relaxed bg-[#ECF0F4]/40 border border-[var(--hairline)] focus:border-[#0F1E30] focus:bg-white rounded-[2px] outline-none resize-y"
          />
        </div>
      </div>
    </div>
  );
}
