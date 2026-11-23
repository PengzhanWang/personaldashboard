import React, { useState } from 'react';

export function BottomDock({
  uploading,
  onAddChecklist,
  onAddNote,
  onUploadImageCard,
  onAddLinkCard,
}: {
  uploading: boolean;
  onAddChecklist: () => void;
  onAddNote: () => void;
  onUploadImageCard: (file: File) => void;
  onAddLinkCard: (title: string, url: string) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  function submitLink(e: React.FormEvent) {
    e.preventDefault();
    const u = linkUrl.trim();
    if (!u) return;
    onAddLinkCard(linkTitle.trim(), u);
    setLinkTitle('');
    setLinkUrl('');
    setLinkOpen(false);
  }

  return (
    <div className="fixed bottom-5 inset-x-0 z-40 pointer-events-none flex flex-col items-center gap-2.5 px-4">
      {linkOpen && (
        <form
          onSubmit={submitLink}
          className="pointer-events-auto floating-dock rounded-full p-1.5 pl-4 flex items-center gap-2 w-full max-w-md"
        >
          <input
            type="text"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="名称"
            className="w-24 sm:w-28 bg-transparent text-xs font-medium focus:outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <span className="w-px h-4 bg-[var(--border)]" />
          <input
            type="url"
            required
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="粘贴 Google Sheet / Doc 或任意链接…"
            className="flex-1 bg-transparent text-xs focus:outline-none placeholder:text-[var(--muted-foreground)] min-w-0"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-full bg-[var(--foreground)] text-[var(--background)] text-xs font-medium cursor-pointer shrink-0"
          >
            添加
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="p-1.5 rounded-full text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </form>
      )}

      <div className="pointer-events-auto floating-dock rounded-full px-2 py-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={onAddChecklist}
          className="px-3 py-1.5 rounded-full bg-[var(--foreground)] text-[var(--background)] text-xs font-medium flex items-center gap-1.5 hover:opacity-90 transition cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span>清单</span>
        </button>

        <button
          type="button"
          onClick={onAddNote}
          className="px-3 py-1.5 rounded-full hover:bg-[var(--background)] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>笔记</span>
        </button>

        <label className="px-3 py-1.5 rounded-full hover:bg-[var(--background)] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>{uploading ? '上传中…' : '图片'}</span>
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onUploadImageCard(f);
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => setLinkOpen((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
            linkOpen ? 'bg-[var(--background)]' : 'hover:bg-[var(--background)]'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span>关联文档</span>
        </button>
      </div>
    </div>
  );
}
