import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CARD_FINISHES,
  parseCardImages,
  parseCardLayout,
  parseCardLinks,
  type BauhausShape,
  type CardFinish,
  type CardLayout,
  type LinkKind,
  type Row,
} from '../../shared/schema';

const GAP = 14;
const ROW_H = 92;
const COLS_DESKTOP = 12;

export interface LayoutEntry {
  row: Row;
  layout: CardLayout;
}

function overlaps(a: CardLayout, b: CardLayout): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function resolveLayout(entries: LayoutEntry[], anchorId: string): Map<string, CardLayout> {
  const map = new Map<string, CardLayout>();
  for (const e of entries) map.set(e.row.id, { ...e.layout });
  const anchor = map.get(anchorId);
  if (!anchor) return map;

  const others = entries
    .filter((e) => e.row.id !== anchorId)
    .map((e) => ({ id: e.row.id, box: map.get(e.row.id)! }))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  const placed: CardLayout[] = [anchor];
  for (const item of others) {
    let moved = true;
    let guard = 0;
    while (moved && guard < 40) {
      moved = false;
      guard++;
      for (const p of placed) {
        if (overlaps(item.box, p)) {
          item.box.y = p.y + p.h;
          moved = true;
        }
      }
    }
    placed.push(item.box);
  }

  const all = entries
    .map((e) => ({ id: e.row.id, box: map.get(e.row.id)! }))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  for (const item of all) {
    if (item.id === anchorId) continue;
    while (item.box.y > 0) {
      const candidate = { ...item.box, y: item.box.y - 1 };
      if (!all.some((o) => o.id !== item.id && overlaps(candidate, o.box))) {
        item.box.y--;
      } else {
        break;
      }
    }
  }
  return map;
}

function computeMobileRects(entries: LayoutEntry[]): Map<string, CardLayout> {
  const ordered = [...entries].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const placed: CardLayout[] = [];
  const rects = new Map<string, CardLayout>();
  for (const e of ordered) {
    const w = e.layout.w >= 4 ? 2 : 1;
    const h = Math.max(2, Math.min(3, e.layout.h));
    let x = 0;
    let y = 0;
    outer: for (let row = 0; row < 200; row++) {
      for (let col = 0; col <= 2 - w; col++) {
        const box = { x: col, y: row, w, h };
        if (!placed.some((p) => overlaps(box, p))) {
          x = col;
          y = row;
          placed.push(box);
          break outer;
        }
      }
    }
    rects.set(e.row.id, { x, y, w, h });
  }
  return rects;
}

function linkDotColor(kind: LinkKind): string {
  if (kind === 'gsheet') return '#2A7A68';
  if (kind === 'gdoc') return '#25548A';
  if (kind === 'gdrive') return '#D94E28';
  return '#60768C';
}

const SIZE_PRESETS: [string, number, number][] = [
  ['S', 3, 2],
  ['M', 4, 3],
  ['W', 6, 2],
  ['L', 6, 3],
];

interface ContextMenuState {
  card: Row;
  x: number;
  y: number;
}

export function BentoCanvas({
  cards,
  boards,
  viewMode,
  onEditCard,
  onUpdateCard,
  onMoveCardToBoard,
  onDuplicateCard,
  onDeleteCard,
  onCommitLayouts,
  onOpenLightbox,
}: {
  cards: Row[];
  boards: Row[];
  viewMode: 'desktop' | 'mobile';
  onEditCard: (card: Row) => void;
  onUpdateCard: (card: Row, patch: Record<string, string>) => void;
  onMoveCardToBoard: (card: Row, targetBoardId: string) => void;
  onDuplicateCard: (card: Row) => void;
  onDeleteCard: (card: Row) => void;
  onCommitLayouts: (updates: { row: Row; layout: CardLayout }[]) => void;
  onOpenLightbox: (src: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [stageWidth, setStageWidth] = useState(1040);
  const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const justDraggedRef = useRef<string | null>(null);

  const [narrowScreen, setNarrowScreen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );

  useEffect(() => {
    const onResize = () => setNarrowScreen(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const isMobile = viewMode === 'mobile' || narrowScreen;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    setStageWidth(el.clientWidth || 1040);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setStageWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile, cards.length]);

  const entries = useMemo<LayoutEntry[]>(
    () => cards.map((row) => ({ row, layout: parseCardLayout(row.layout_json) })),
    [cards],
  );

  const cols = isMobile ? 2 : COLS_DESKTOP;
  const colW = (stageWidth - GAP * (cols - 1)) / cols;

  const gridToPx = (b: CardLayout) => ({
    left: b.x * (colW + GAP),
    top: b.y * (ROW_H + GAP),
    width: b.w * colW + (b.w - 1) * GAP,
    height: b.h * ROW_H + (b.h - 1) * GAP,
  });

  const mobileRects = useMemo(() => (isMobile ? computeMobileRects(entries) : null), [entries, isMobile]);

  const stageHeight = useMemo(() => {
    let maxBottom = 0;
    for (const e of entries) {
      const box = isMobile ? mobileRects?.get(e.row.id) || e.layout : e.layout;
      const bottom = box.y * (ROW_H + GAP) + (box.h * ROW_H + (box.h - 1) * GAP);
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return Math.max(420, maxBottom + 48);
  }, [entries, isMobile, mobileRects]);

  function applyDomPositions(layoutMap: Map<string, CardLayout>, skipId?: string) {
    let maxBottom = 0;
    for (const [id, box] of layoutMap.entries()) {
      const r = gridToPx(box);
      if (r.top + r.height > maxBottom) maxBottom = r.top + r.height;
      if (id === skipId) continue;
      const node = itemRefs.current.get(id);
      if (node) {
        node.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
        node.style.width = `${r.width}px`;
        node.style.height = `${r.height}px`;
      }
    }
    if (stageRef.current) {
      stageRef.current.style.height = `${Math.max(420, maxBottom + 48)}px`;
    }
  }

  function applyPresetSize(card: Row, pw: number, ph: number) {
    const cur = parseCardLayout(card.layout_json);
    const updatedEntries = entries.map((item) =>
      item.row.id === card.id
        ? { ...item, layout: { ...cur, w: pw, h: ph, x: Math.min(cur.x, COLS_DESKTOP - pw) } }
        : item,
    );
    const resolved = resolveLayout(updatedEntries, card.id);
    commitDiff(resolved);
  }

  function commitDiff(resolved: Map<string, CardLayout>) {
    const changed: { row: Row; layout: CardLayout }[] = [];
    for (const e of entries) {
      const next = resolved.get(e.row.id);
      if (!next) continue;
      if (next.x !== e.layout.x || next.y !== e.layout.y || next.w !== e.layout.w || next.h !== e.layout.h) {
        changed.push({ row: e.row, layout: next });
      }
    }
    if (changed.length) onCommitLayouts(changed);
  }

  function startPointerInteraction(e: React.PointerEvent, entry: LayoutEntry) {
    if (e.button !== 0 || isMobile) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-no-drag]') ||
      target.closest('[data-check]') ||
      target.closest('[data-lightbox]') ||
      target.closest('a') ||
      target.closest('input')
    ) {
      return;
    }

    const el = itemRefs.current.get(entry.row.id);
    const placeholder = placeholderRef.current;
    if (!el || !placeholder) return;

    const isResize = Boolean(target.closest('[data-resize]'));
    const startX = e.clientX;
    const startY = e.clientY;
    const startBox: CardLayout = { ...entry.layout };
    const startRect = gridToPx(startBox);

    let liveMap = new Map<string, CardLayout>(entries.map((item) => [item.row.id, { ...item.layout }]));
    let started = false;
    let rafId: number | null = null;
    let lastEvent: PointerEvent | null = null;

    const updatePlaceholder = (box: CardLayout) => {
      const r = gridToPx(box);
      placeholder.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
      placeholder.style.width = `${r.width}px`;
      placeholder.style.height = `${r.height}px`;
      placeholder.classList.add('visible');
    };

    const onMove = (ev: PointerEvent) => {
      lastEvent = ev;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!started) {
        if (Math.hypot(dx, dy) < 5) return;
        started = true;
        setContextMenu(null);
        el.classList.add(isResize ? 'is-resizing' : 'is-dragging');
        document.body.classList.add('no-select');
        updatePlaceholder(startBox);
      }

      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!lastEvent) return;
        const curDx = lastEvent.clientX - startX;
        const curDy = lastEvent.clientY - startY;
        const curAnchor = liveMap.get(entry.row.id)!;

        if (!isResize) {
          const liveLeft = Math.max(-16, Math.min(stageWidth - startRect.width + 16, startRect.left + curDx));
          const liveTop = Math.max(-12, startRect.top + curDy);
          el.style.transform = `translate3d(${liveLeft}px, ${liveTop}px, 0)`;

          const targetX = Math.max(0, Math.min(COLS_DESKTOP - curAnchor.w, Math.round(liveLeft / (colW + GAP))));
          const targetY = Math.max(0, Math.round(liveTop / (ROW_H + GAP)));

          if (targetX !== curAnchor.x || targetY !== curAnchor.y) {
            curAnchor.x = targetX;
            curAnchor.y = targetY;
            const nextEntries = entries.map((item) => ({ row: item.row, layout: liveMap.get(item.row.id)! }));
            liveMap = resolveLayout(nextEntries, entry.row.id);
            updatePlaceholder(liveMap.get(entry.row.id)!);
            applyDomPositions(liveMap, entry.row.id);
          }
        } else {
          const minW = colW * 2 + GAP;
          const maxW = stageWidth - startRect.left;
          const liveW = Math.max(minW, Math.min(maxW, startRect.width + curDx));
          const liveH = Math.max(ROW_H, Math.min(ROW_H * 7 + GAP * 6, startRect.height + curDy));
          el.style.width = `${liveW}px`;
          el.style.height = `${liveH}px`;

          const targetW = Math.max(2, Math.min(COLS_DESKTOP - curAnchor.x, Math.round((liveW + GAP) / (colW + GAP))));
          const targetH = Math.max(1, Math.min(7, Math.round((liveH + GAP) / (ROW_H + GAP))));

          if (targetW !== curAnchor.w || targetH !== curAnchor.h) {
            curAnchor.w = targetW;
            curAnchor.h = targetH;
            const nextEntries = entries.map((item) => ({ row: item.row, layout: liveMap.get(item.row.id)! }));
            liveMap = resolveLayout(nextEntries, entry.row.id);
            updatePlaceholder(liveMap.get(entry.row.id)!);
            applyDomPositions(liveMap, entry.row.id);
          }
        }
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (rafId !== null) cancelAnimationFrame(rafId);

      if (started) {
        el.classList.remove('is-dragging', 'is-resizing');
        document.body.classList.remove('no-select');
        placeholder.classList.remove('visible');
        applyDomPositions(liveMap);
        commitDiff(liveMap);
        justDraggedRef.current = entry.row.id;
        window.setTimeout(() => {
          if (justDraggedRef.current === entry.row.id) justDraggedRef.current = null;
        }, 120);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function toggleChecklistLine(e: React.MouseEvent, card: Row, lineIdx: number) {
    e.stopPropagation();
    const lines = (card.content_md || '').split('\n');
    const line = lines[lineIdx] || '';
    if (/^\s*-\s*\[ \]/.test(line)) lines[lineIdx] = line.replace(/^(\s*-\s*)\[ \]/, '$1[x]');
    else if (/^\s*-\s*\[[xX]\]/.test(line)) lines[lineIdx] = line.replace(/^(\s*-\s*)\[[xX]\]/, '$1[ ]');
    else return;
    onUpdateCard(card, { content_md: lines.join('\n') });
  }

  function commitQuickInput(card: Row) {
    const val = (quickInputs[card.id] || '').trim();
    if (!val) return;
    const next = (card.content_md ? card.content_md.trimEnd() + '\n' : '') + `- [ ] ${val}`;
    onUpdateCard(card, { content_md: next });
    setQuickInputs((prev) => ({ ...prev, [card.id]: '' }));
  }

  function openContextMenu(e: React.MouseEvent, card: Row) {
    e.preventDefault();
    e.stopPropagation();
    const menuW = 224;
    const menuH = 320;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
    setContextMenu({ card, x: Math.max(12, x), y: Math.max(12, y) });
  }

  if (entries.length === 0) {
    return (
      <div className="min-h-[420px] flex flex-col items-center justify-center text-center px-6 select-none">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 bg-[#0F1E30]" />
          <span className="w-2.5 h-2.5 bg-[#25548A]" />
          <span className="w-2.5 h-2.5 bg-[#D94E28]" />
        </div>
        <p className="nolan-display text-xs font-bold text-[#0F1E30]">EMPTY CANVAS</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-2">从下方工具栏选择清单、笔记、图片或关联文档开始记录</p>
      </div>
    );
  }

  const activeMenuCard = contextMenu ? cards.find((c) => c.id === contextMenu.card.id) || contextMenu.card : null;
  const activeMenuLayout = activeMenuCard ? parseCardLayout(activeMenuCard.layout_json) : null;

  return (
    <>
      <div style={{ maxWidth: viewMode === 'mobile' ? '400px' : '100%' }} className="mx-auto transition-all duration-300">
        <div ref={stageRef} className="bento-stage" style={{ height: `${stageHeight}px` }}>
          <div ref={placeholderRef} className="bento-placeholder" />

          {entries.map((entry) => {
            const { row: card, layout } = entry;
            const box = isMobile ? mobileRects?.get(card.id) || layout : layout;
            const rect = gridToPx(box);
            const images = parseCardImages(card.images_json);
            const links = parseCardLinks(card.links_json);
            const lines = (card.content_md || '').split('\n');
            const quickVal = quickInputs[card.id] || '';
            const motif = CARD_FINISHES.find((f) => f.id === (card.finish || 'default')) || CARD_FINISHES[0];
            const isInk = motif.id === 'ink';

            let checkTotal = 0;
            let checkDone = 0;
            for (const l of lines) {
              if (/^\s*-\s*\[[ xX]\]/.test(l)) {
                checkTotal++;
                if (/^\s*-\s*\[[xX]\]/.test(l)) checkDone++;
              }
            }

            return (
              <div
                key={card.id}
                ref={(node) => {
                  if (node) itemRefs.current.set(card.id, node);
                  else itemRefs.current.delete(card.id);
                }}
                style={{
                  transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                }}
                onPointerDown={(e) => startPointerInteraction(e, entry)}
                onContextMenu={(e) => openContextMenu(e, card)}
                onClick={(e) => {
                  if (justDraggedRef.current === card.id) return;
                  const t = e.target as HTMLElement;
                  if (
                    t.closest('[data-check]') ||
                    t.closest('[data-lightbox]') ||
                    t.closest('a') ||
                    t.closest('input') ||
                    t.closest('[data-no-drag]')
                  ) {
                    return;
                  }
                  if (document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.quickInput) {
                    document.activeElement.blur();
                    return;
                  }
                  onEditCard(card);
                }}
                className="bento-item"
              >
                <div className={`bento-card-inner ${isInk ? 'finish-ink' : ''}`}>
                  {/* Subtle 2px Editorial Accent Top Hairline */}
                  <div className="h-[2.5px] w-full shrink-0" style={{ background: isInk ? '#D94E28' : motif.dot }} />

                  {/* Card Header */}
                  <div className="px-4 pt-3 pb-2.5 flex items-start justify-between gap-2 border-b border-[var(--hairline)] card-divider no-select">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-1.5 h-1.5 inline-block shrink-0"
                          style={{ background: isInk ? '#D94E28' : motif.dot }}
                        />
                        {card.tag && (
                          <span className="nolan-label text-[9.5px] font-semibold muted-text text-[var(--muted-foreground)]">
                            {card.tag}
                          </span>
                        )}
                        {checkTotal > 0 && (
                          <span className="font-mono text-[10px] muted-text text-[var(--muted-foreground)]">
                            {checkDone}/{checkTotal}
                          </span>
                        )}
                        {card.sensitive === 'TRUE' && (
                          <span className="nolan-label text-[9px] px-1 border border-current/35 opacity-75">
                            敏感
                          </span>
                        )}
                      </div>
                      <h3 className="nolan-title font-bold text-[13.5px] truncate mt-1">{card.title || '未命名模块'}</h3>
                    </div>

                    <div data-no-drag="1" className={`flex items-center gap-1 shrink-0 ${isMobile ? '' : 'hover-controls'}`}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditCard(card);
                        }}
                        title="编辑模块"
                        className="px-1.5 py-0.5 nolan-label text-[9.5px] font-semibold opacity-70 hover:opacity-100 cursor-pointer"
                      >
                        EDIT
                      </button>
                      <button
                        type="button"
                        onClick={(e) => openContextMenu(e, card)}
                        title="更多操作（也可右键卡片）"
                        className="p-1 rounded-[2px] border border-current/20 hover:border-current/60 cursor-pointer"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="19" cy="12" r="2" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Card Content Surface */}
                  <div className="px-4 py-3 flex-1 flex flex-col gap-1 overflow-y-auto card-scroll">
                    <div className="space-y-1">
                      {lines.map((line, idx) => {
                        const unchecked = line.match(/^\s*-\s*\[ \]\s*(.*)$/);
                        if (unchecked) {
                          return (
                            <div
                              key={idx}
                              data-check="1"
                              onClick={(e) => toggleChecklistLine(e, card, idx)}
                              className="flex items-start gap-2.5 py-0.5 cursor-pointer"
                            >
                              <span className="check-box" />
                              <span className="text-[12.5px] leading-snug break-words">{unchecked[1]}</span>
                            </div>
                          );
                        }
                        const checked = line.match(/^\s*-\s*\[[xX]\]\s*(.*)$/);
                        if (checked) {
                          return (
                            <div
                              key={idx}
                              data-check="1"
                              onClick={(e) => toggleChecklistLine(e, card, idx)}
                              className="flex items-start gap-2.5 py-0.5 cursor-pointer opacity-45"
                            >
                              <span className="check-box checked">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </span>
                              <span className="text-[12.5px] leading-snug line-through break-words">{checked[1]}</span>
                            </div>
                          );
                        }
                        if (!line.trim()) return null;
                        return (
                          <p key={idx} className="text-[12.5px] muted-text text-[var(--muted-foreground)] leading-relaxed break-words">
                            {line}
                          </p>
                        );
                      })}
                    </div>

                    {/* Images Grid */}
                    {images.length > 0 && (
                      <div className={`grid ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2 mt-2`}>
                        {images.slice(0, 4).map((im) => {
                          const fullUrl = `/api/image/${encodeURIComponent(im.file_id)}`;
                          return (
                            <div
                              key={im.id}
                              data-lightbox="1"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenLightbox(fullUrl);
                              }}
                              style={
                                im.thumb
                                  ? { backgroundImage: `url(${im.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                                  : undefined
                              }
                              className="relative overflow-hidden rounded-[2px] border border-[var(--hairline)] h-24 cursor-zoom-in group/img bg-[#ECF0F4]"
                            >
                              <img
                                src={fullUrl}
                                alt={im.caption || ''}
                                loading="lazy"
                                draggable={false}
                                className="w-full h-full object-cover group-hover/img:scale-105 transition duration-300"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Quick inline checklist add */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        commitQuickInput(card);
                      }}
                      data-no-drag="1"
                      className="mt-1 flex items-center gap-1"
                    >
                      <input
                        type="text"
                        data-quick-input="1"
                        value={quickVal}
                        onChange={(e) => setQuickInputs((prev) => ({ ...prev, [card.id]: e.target.value }))}
                        onBlur={() => commitQuickInput(card)}
                        placeholder="+ 快速加一条清单（回车确认）…"
                        className="flex-1 bg-transparent text-[11px] py-1 focus:outline-none placeholder:opacity-45 border-b border-transparent focus:border-current/40 min-w-0"
                      />
                      {quickVal.trim() && (
                        <button
                          type="submit"
                          onMouseDown={(e) => e.preventDefault()}
                          className="px-1.5 py-0.5 rounded-[2px] bg-[#0F1E30] text-white font-mono text-[10px] cursor-pointer shrink-0"
                        >
                          ↵
                        </button>
                      )}
                    </form>

                    {/* Linked Docs / Sheets Chips */}
                    {links.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-2.5 mt-auto border-t border-[var(--hairline)] card-divider">
                        {links.map((l) => (
                          <a
                            key={l.id}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            data-no-drag="1"
                            className="subtle-pill inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] text-[11px] border border-[var(--hairline-strong)] bg-[#ECF0F4]/50 hover:bg-[#0F1E30] hover:text-white hover:border-[#0F1E30] transition max-w-full"
                          >
                            <span className="w-1.5 h-1.5 shrink-0" style={{ background: linkDotColor(l.kind) }} />
                            <span className="truncate font-medium">{l.title}</span>
                            <span className="opacity-55 shrink-0">↗</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Desktop Hover Size Bar + Corner Resize Grip */}
                  {!isMobile && (
                    <>
                      <div
                        data-no-drag="1"
                        className="hover-controls absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center rounded-[2px] border border-[var(--hairline-strong)] bg-white/95 backdrop-blur-md shadow-md overflow-hidden"
                      >
                        {SIZE_PRESETS.map(([label, pw, ph]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              applyPresetSize(card, pw, ph);
                            }}
                            className={`px-2 py-0.5 nolan-label text-[9.5px] font-semibold cursor-pointer transition ${
                              layout.w === pw && layout.h === ph
                                ? 'bg-[#0F1E30] text-white'
                                : 'text-[#0F1E30] hover:bg-[#ECF0F4]'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div
                        data-resize="1"
                        title="拖拽缩放尺寸"
                        className="no-select absolute right-0.5 bottom-0.5 w-4 h-4 text-current opacity-35 hover:opacity-85 font-mono text-[9px] flex items-center justify-center cursor-nwse-resize transition"
                      >
                        ◢
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Editorial Right-Click Context Menu */}
      {contextMenu && activeMenuCard && activeMenuLayout && (
        <div
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 bg-white/95 backdrop-blur-xl border border-[var(--hairline-strong)] rounded-[3px] shadow-[0_18px_40px_-14px_rgba(15,30,48,0.28)] p-1.5 text-xs space-y-1"
        >
          <button
            type="button"
            onClick={() => {
              onEditCard(activeMenuCard);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 rounded-[2px] hover:bg-[#0F1E30] hover:text-white font-medium flex items-center justify-between cursor-pointer transition"
          >
            <span>编辑模块</span>
            <span className="nolan-label text-[9.5px] opacity-60">EDIT</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onDuplicateCard(activeMenuCard);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 rounded-[2px] hover:bg-[#0F1E30] hover:text-white font-medium cursor-pointer transition"
          >
            复制副本
          </button>

          {/* Tone Swatches */}
          <div className="px-3 py-2 border-t border-[var(--hairline)] flex items-center justify-between">
            <span className="nolan-label text-[10px] text-[var(--muted-foreground)]">TONE</span>
            <div className="flex items-center gap-1.5">
              {CARD_FINISHES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={f.label}
                  onClick={() => {
                    onUpdateCard(activeMenuCard, { finish: f.id as CardFinish });
                    setContextMenu(null);
                  }}
                  style={{ background: f.dot }}
                  className={`w-4 h-4 rounded-[2px] border border-[#0F1E30]/25 cursor-pointer ${
                    (activeMenuCard.finish || 'default') === f.id ? 'ring-2 ring-offset-1 ring-[#D94E28]' : ''
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Quick Sizes */}
          {!isMobile && (
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="nolan-label text-[10px] text-[var(--muted-foreground)]">SIZE</span>
              <div className="flex items-center gap-1">
                {SIZE_PRESETS.map(([label, pw, ph]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      applyPresetSize(activeMenuCard, pw, ph);
                      setContextMenu(null);
                    }}
                    className={`px-2 py-0.5 rounded-[2px] border border-[var(--hairline-strong)] nolan-label text-[9.5px] font-semibold cursor-pointer transition ${
                      activeMenuLayout.w === pw && activeMenuLayout.h === ph
                        ? 'bg-[#0F1E30] border-[#0F1E30] text-white'
                        : 'bg-white hover:bg-[#ECF0F4]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Move to another board */}
          {boards.length > 1 && (
            <div className="px-3 py-1.5 border-t border-[var(--hairline)] space-y-1">
              <span className="nolan-label text-[9.5px] text-[var(--muted-foreground)] block">MOVE TO BOARD</span>
              <div className="flex flex-wrap gap-1">
                {boards
                  .filter((b) => b.id !== (activeMenuCard.board_id || 'main'))
                  .map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        onMoveCardToBoard(activeMenuCard, b.id);
                        setContextMenu(null);
                      }}
                      className="px-2 py-0.5 rounded-[2px] bg-[#ECF0F4]/70 border border-[var(--hairline)] hover:bg-[#0F1E30] hover:text-white cursor-pointer transition"
                    >
                      {b.title}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              onUpdateCard(activeMenuCard, {
                sensitive: activeMenuCard.sensitive === 'TRUE' ? 'FALSE' : 'TRUE',
              });
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 rounded-[2px] hover:bg-[#0F1E30] hover:text-white border-t border-[var(--hairline)] cursor-pointer transition"
          >
            {activeMenuCard.sensitive === 'TRUE' ? '取消敏感标记' : '设为敏感（公司隐藏）'}
          </button>

          <button
            type="button"
            onClick={() => {
              onDeleteCard(activeMenuCard);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 rounded-[2px] hover:bg-[#D94E28] hover:text-white text-[#D94E28] font-semibold cursor-pointer transition"
          >
            删除模块
          </button>
        </div>
      )}
    </>
  );
}
