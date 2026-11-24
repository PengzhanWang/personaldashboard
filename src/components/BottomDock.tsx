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
          className="pointer-events-auto bauhaus-dock p-2 pl-4 flex items-center gap-2.5 w-full max-w-lg"
        >
          <input
            type="text"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="名称"
            className="w-24 sm:w-32 bg-transparent text-xs font-bold focus:outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <span className="w-[1.5px] h-5 bg-[#161616]" />
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
            className="bauhaus-btn px-3.5 py-1.5 bg-[#161616] text-white text-xs font-mono font-bold cursor-pointer shrink-0"
          >
            ADD
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="p-1.5 text-[var(--muted-foreground)] hover:text-[#161616] cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </form>
      )}

      <div className="pointer-events-auto bauhaus-dock p-2 flex items-center gap-2 text-xs font-bold">
        <span className="hidden sm:inline-flex items-center px-2 font-mono text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] select-none">
          NEW +
        </span>

        <button
          type="button"
          onClick={onAddChecklist}
          className="bauhaus-btn px-4 py-2 bg-[#283D92] text-white flex items-center gap-2 cursor-pointer"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-white inline-block" />
          <span>清单</span>
        </button>

        <button
          type="button"
          onClick={onAddNote}
          className="bauhaus-btn px-4 py-2 bg-[#DFB0AF] text-[#161616] flex items-center gap-2 cursor-pointer"
        >
          <span className="w-2.5 h-2.5 rounded-t-full bg-[#161616] inline-block" />
          <span>笔记</span>
        </button>

        <label className="bauhaus-btn px-4 py-2 bg-[#6C4D6D] text-white flex items-center gap-2 cursor-pointer">
          <span className="w-2.5 h-2.5 bg-white inline-block" />
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
          className={`bauhaus-btn px-4 py-2 flex items-center gap-2 cursor-pointer ${
            linkOpen ? 'bg-[#02CA0E] text-[#161616]' : 'bg-white text-[#161616] hover:bg-[#02CA0E] hover:text-[#161616]'
          }`}
        >
          <span className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[9px] border-b-[#161616] inline-block" />
          <span>关联文档</span>
        </button>
      </div>
    </div>
  );
}
