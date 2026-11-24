import { useEffect, useMemo, useState } from 'react';
import { parseCardLinks, type Row } from '../../shared/schema';

export function SearchModal({
  boards,
  cards,
  onSelect,
  onClose,
}: {
  boards: Row[];
  cards: Row[];
  onSelect: (card: Row) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const boardMap = useMemo(() => new Map(boards.map((b) => [b.id, b.title || '主画布'])), [boards]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards.slice(0, 12);
    return cards
      .filter((c) => {
        const linksText = parseCardLinks(c.links_json)
          .map((l) => `${l.title} ${l.url}`)
          .join(' ');
        const hay = `${c.title || ''} ${c.tag || ''} ${c.content_md || ''} ${linksText}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 20);
  }, [cards, query]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[#0F1E30]/45 backdrop-blur-xs flex items-start justify-center pt-[12vh] p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white border border-[var(--hairline-strong)] rounded-[3px] shadow-[0_24px_56px_-18px_rgba(15,30,48,0.3)] overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[var(--hairline)] flex items-center gap-2.5">
          <svg className="w-4 h-4 shrink-0 text-[var(--muted-foreground)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索所有画布的标题、清单内容或关联文档…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 border border-[var(--hairline-strong)] rounded-[2px] text-[var(--muted-foreground)]">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto divide-y divide-[var(--hairline)]">
          {results.length === 0 ? (
            <div className="py-10 text-center nolan-label text-[11px] text-[var(--muted-foreground)]">NO MATCHING MODULES</div>
          ) : (
            results.map((c) => {
              const snippet = (c.content_md || '').replace(/\s+/g, ' ').trim().slice(0, 80);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSelect(c);
                    onClose();
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-[#ECF0F4]/70 transition flex items-start justify-between gap-3 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="nolan-title text-sm font-semibold truncate text-[#0F1E30]">{c.title || '未命名模块'}</span>
                      {c.tag && (
                        <span className="nolan-label text-[10px] text-[var(--muted-foreground)] shrink-0">{c.tag}</span>
                      )}
                    </div>
                    {snippet && <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">{snippet}</p>}
                  </div>
                  <span className="nolan-label text-[10px] px-2 py-0.5 border border-[var(--hairline-strong)] rounded-[2px] bg-[#ECF0F4]/60 text-[#0F1E30] shrink-0">
                    {boardMap.get(c.board_id || 'main') || '主画布'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
