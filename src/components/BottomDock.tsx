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
    const raw = linkUrl.trim();
    if (!raw) return;
    const u = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
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
          className="pointer-events-auto dunkirk-dock p-2 pl-4 flex items-center gap-2.5 w-full max-w-lg"
        >
          <input
            type="text"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="名称"
            className="w-24 sm:w-32 bg-transparent text-xs font-medium focus:outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <span className="w-px h-4 bg-[var(--hairline-strong)]" />
          <input
            type="text"
            required
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="粘贴 Google Sheet / Doc 或任意链接…"
            className="flex-1 bg-transparent text-xs font-mono focus:outline-none placeholder:text-[var(--muted-foreground)] min-w-0"
          />
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-[#0F1E30] text-white hover:bg-[#D94E28] transition nolan-label text-[10px] font-semibold rounded-[2px] cursor-pointer shrink-0"
          >
            ADD
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="p-1.5 text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </form>
      )}

      <div className="pointer-events-auto dunkirk-dock px-2.5 py-1.5 flex items-center gap-1 text-[11px]">
        <span className="hidden sm:inline-flex items-center px-2 nolan-display text-[10px] font-semibold text-[var(--muted-foreground)] select-none">
          NEW +
        </span>

        <button
          type="button"
          onClick={onAddChecklist}
          className="nolan-label px-3.5 py-2 rounded-[2px] text-[10px] font-semibold text-[#0F1E30] hover:bg-[#D94E28] hover:text-white transition flex items-center gap-1.5 cursor-pointer"
        >
          <span className="w-1.5 h-1.5 bg-[#D94E28] group-hover:bg-white inline-block" />
          <span>清单 LIST</span>
        </button>

        <span className="w-px h-4 bg-[var(--hairline)]" />

        <button
          type="button"
          onClick={onAddNote}
          className="nolan-label px-3.5 py-2 rounded-[2px] text-[10px] font-semibold text-[#0F1E30] hover:bg-[#0F1E30] hover:text-white transition flex items-center gap-1.5 cursor-pointer"
        >
          <span>笔记 NOTE</span>
        </button>

        <span className="w-px h-4 bg-[var(--hairline)]" />

        <label className="nolan-label px-3.5 py-2 rounded-[2px] text-[10px] font-semibold text-[#0F1E30] hover:bg-[#25548A] hover:text-white transition flex items-center gap-1.5 cursor-pointer">
          <span>{uploading ? '上传中…' : '图片 IMG'}</span>
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

        <span className="w-px h-4 bg-[var(--hairline)]" />

        <button
          type="button"
          onClick={() => setLinkOpen((v) => !v)}
          className={`nolan-label px-3.5 py-2 rounded-[2px] text-[10px] font-semibold transition flex items-center gap-1.5 cursor-pointer ${
            linkOpen
              ? 'bg-[#25548A] text-white'
              : 'text-[#0F1E30] hover:bg-[#25548A] hover:text-white'
          }`}
        >
          <span>关联文档 DOC</span>
        </button>
      </div>
    </div>
  );
}
