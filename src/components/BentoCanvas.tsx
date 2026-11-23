import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseCardImages,
  parseCardLayout,
  parseCardLinks,
  type CardLayout,
  type LinkKind,
  type Row,
} from '../../shared/schema';

const GAP = 16;
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

  // Compact upwards while keeping the anchor fixed
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
  if (kind === 'gsheet') return '#16a34a';
  if (kind === 'gdoc') return '#2563eb';
  if (kind === 'gdrive') return '#d97706';
  return '#71717a';
}

const SIZE_PRESETS: [string, number, number][] = [
  ['S', 3, 2],
  ['M', 4, 3],
  ['W', 6, 2],
  ['L', 6, 3],
];

export function BentoCanvas({
  cards,
  viewMode,
  onEditCard,
  onUpdateCard,
  onCommitLayouts,
  onOpenLightbox,
}: {
  cards: Row[];
  viewMode: 'desktop' | 'mobile';
  onEditCard: (card: Row) => void;
  onUpdateCard: (card: Row, patch: Record<string, string>) => void;
  onCommitLayouts: (updates: { row: Row; layout: CardLayout }[]) => void;
  onOpenLightbox: (src: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [stageWidth, setStageWidth] = useState(1040);
  const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});
  const justDraggedRef = useRef<string | null>(null);

  // Detect narrow mobile viewport automatically too
  const [narrowScreen, setNarrowScreen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );

  useEffect(() => {
    const onResize = () => setNarrowScreen(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
  }, [isMobile]);

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

  function handlePresetSize(e: React.MouseEvent, card: Row, pw: number, ph: number) {
    e.stopPropagation();
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

  function handleQuickAdd(e: React.FormEvent, card: Row) {
    e.preventDefault();
    e.stopPropagation();
    const val = (quickInputs[card.id] || '').trim();
    if (!val) return;
    const next = (card.content_md ? card.content_md.trimEnd() + '\n' : '') + `- [ ] ${val}`;
    onUpdateCard(card, { content_md: next });
    setQuickInputs((prev) => ({ ...prev, [card.id]: '' }));
  }

  if (entries.length === 0) {
    return (
      <div className="min-h-[360px] flex flex-col items-center justify-center text-center px-6">
        <div className="w-11 h-11 rounded-2xl border border-dashed border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] mb-3">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <p className="text-sm font-medium">这块画布还是空的</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">点击底部悬浮栏新增清单、笔记、图片或关联文档</p>
      </div>
    );
  }

  return (
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
              onClick={(e) => {
                if (justDraggedRef.current === card.id) return;
                const t = e.target as HTMLElement;
                if (t.closest('[data-check]') || t.closest('[data-lightbox]') || t.closest('a') || t.closest('input') || t.closest('[data-no-drag]')) {
                  return;
                }
                onEditCard(card);
              }}
              className="bento-item"
            >
              <div className={`bento-card-inner finish-${card.finish || 'default'}`}>
                {/* Card Header */}
                <div className="px-5 pt-4 pb-2 flex items-start justify-between gap-2 no-select">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {card.tag && (
                        <span className="text-[11px] uppercase tracking-wider muted-text text-[var(--muted-foreground)] font-medium">
                          {card.tag}
                        </span>
                      )}
                      {checkTotal > 0 && (
                        <span className="text-[11px] font-mono muted-text text-[var(--muted-foreground)]">
                          {checkDone}/{checkTotal}
                        </span>
                      )}
                      {card.sensitive === 'TRUE' && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full border border-[var(--border)] muted-text text-[var(--muted-foreground)]">
                          敏感
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-[15px] tracking-tight truncate mt-0.5">{card.title || '未命名模块'}</h3>
                  </div>

                  <button
                    type="button"
                    data-no-drag="1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCard(card);
                    }}
                    title="编辑模块"
                    className="hover-controls p-1.5 rounded-full subtle-pill bg-[var(--background)] border border-[var(--border)] hover:opacity-80 cursor-pointer shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                </div>

                {/* Card Content Surface */}
                <div className="px-5 pb-4 flex-1 flex flex-col gap-1 overflow-y-auto card-scroll">
                  <div className="space-y-0.5">
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
                            <span className="text-xs leading-relaxed break-words">{unchecked[1]}</span>
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
                            className="flex items-start gap-2.5 py-0.5 cursor-pointer opacity-50"
                          >
                            <span className="check-box checked">
                              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                            <span className="text-xs leading-relaxed line-through break-words">{checked[1]}</span>
                          </div>
                        );
                      }
                      if (!line.trim()) return null;
                      return (
                        <p key={idx} className="text-xs muted-text text-[var(--muted-foreground)] leading-relaxed break-words">
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
                            style={im.thumb ? { backgroundImage: `url(${im.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                            className="relative rounded-2xl overflow-hidden border border-[var(--border)] h-24 cursor-zoom-in group/img bg-zinc-100"
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
                  <form onSubmit={(e) => handleQuickAdd(e, card)} data-no-drag="1" className="mt-1">
                    <input
                      type="text"
                      value={quickInputs[card.id] || ''}
                      onChange={(e) => setQuickInputs((prev) => ({ ...prev, [card.id]: e.target.value }))}
                      placeholder="+ 添加一条…"
                      className="w-full bg-transparent text-xs py-1 focus:outline-none placeholder:opacity-45 border-b border-transparent focus:border-[var(--border)]"
                    />
                  </form>

                  {/* Linked Docs / Sheets Chips */}
                  {links.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2.5 mt-auto">
                      {links.map((l) => (
                        <a
                          key={l.id}
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          data-no-drag="1"
                          className="subtle-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-[var(--background)] border border-[var(--border)] hover:opacity-75 transition max-w-full"
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: linkDotColor(l.kind) }} />
                          <span className="truncate font-medium">{l.title}</span>
                          <svg className="w-3 h-3 opacity-45 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="7" y1="17" x2="17" y2="7" />
                            <polyline points="7 7 17 7 17 17" />
                          </svg>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {/* Desktop Hover Size Pill + Corner Resize Grip */}
                {!isMobile && (
                  <>
                    <div
                      data-no-drag="1"
                      className="hover-controls absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 rounded-full bg-[var(--foreground)] text-[var(--background)] shadow-lg"
                    >
                      {SIZE_PRESETS.map(([label, pw, ph]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={(e) => handlePresetSize(e, card, pw, ph)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition ${
                            layout.w === pw && layout.h === ph
                              ? 'bg-[var(--background)] text-[var(--foreground)]'
                              : 'opacity-70 hover:opacity-100'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div
                      data-resize="1"
                      title="拖拽缩放尺寸"
                      className="hover-controls no-select absolute right-1.5 bottom-1.5 w-6 h-6 flex items-center justify-center cursor-nwse-resize opacity-60 hover:opacity-100"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M13 6L6 13M13 10.5L10.5 13" />
                      </svg>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
