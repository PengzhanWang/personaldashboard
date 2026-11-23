import React, { useEffect, useState } from 'react';
import {
  CARD_FINISHES,
  detectLinkKind,
  parseCardImages,
  parseCardLinks,
  type CardFinish,
  type CardImage,
  type CardLink,
  type LinkKind,
  type Row,
} from '../../shared/schema';
import { useStore } from '../lib/store';
import { ulid } from '../lib/ulid';

function linkDotColor(kind: LinkKind): string {
  if (kind === 'gsheet') return '#16a34a';
  if (kind === 'gdoc') return '#2563eb';
  if (kind === 'gdrive') return '#d97706';
  return '#71717a';
}

export function CardModal({
  card,
  boards,
  onClose,
}: {
  card: Row;
  boards: Row[];
  onClose: () => void;
}) {
  const { upsertRow, deleteRow, uploadImage, showToast } = useStore();
  const [tag, setTag] = useState(card.tag || '');
  const [title, setTitle] = useState(card.title || '');
  const [finish, setFinish] = useState<CardFinish>((card.finish as CardFinish) || 'default');
  const [boardId, setBoardId] = useState(card.board_id || 'main');
  const [content, setContent] = useState(card.content_md || '');
  const [images, setImages] = useState<CardImage[]>(() => parseCardImages(card.images_json));
  const [links, setLinks] = useState<CardLink[]>(() => parseCardLinks(card.links_json));
  const [sensitive, setSensitive] = useState(card.sensitive === 'TRUE');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      const added: CardImage[] = [];
      let totalKb = 0;
      for (const f of files) {
        const { image, sizeKb } = await uploadImage(f);
        added.push(image);
        totalKb += sizeKb;
      }
      setImages((prev) => [...prev, ...added]);
      showToast(`已上传 ${added.length} 张图片至 Drive (${totalKb}KB)`);
    } catch (err) {
      showToast((err as Error).message || '图片上传失败');
    } finally {
      setUploading(false);
    }
  }

  // Support Ctrl+V pasting screenshots directly into the modal
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgFiles = items
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (imgFiles.length) void handleFiles(imgFiles);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  async function handleSave() {
    await upsertRow(
      'Cards',
      {
        board_id: boardId,
        tag: tag.trim(),
        title: title.trim() || '未命名模块',
        finish,
        content_md: content,
        images_json: JSON.stringify(images),
        links_json: JSON.stringify(links),
        sensitive: sensitive ? 'TRUE' : 'FALSE',
      },
      card,
    );
    onClose();
  }

  async function handleDelete() {
    await deleteRow('Cards', card);
    showToast('模块已删除');
    onClose();
  }

  function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!url) return;
    const kind = detectLinkKind(url);
    const defaultLabel = kind === 'gsheet' ? 'Google Sheet' : kind === 'gdoc' ? 'Google Doc' : kind === 'gdrive' ? 'Google Drive' : '关联链接';
    setLinks((prev) => [...prev, { id: ulid(), title: linkTitle.trim() || defaultLabel, kind, url }]);
    setLinkTitle('');
    setLinkUrl('');
  }

  return (
    <div
      onClick={() => void handleSave()}
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xl bg-[var(--card)] border border-[var(--border)] rounded-t-[24px] sm:rounded-[24px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="标签（如：清单 / 婚礼 / 工作）"
              className="w-full bg-transparent text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] focus:outline-none"
            />
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="模块标题"
              className="w-full bg-transparent text-base font-semibold tracking-tight focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => void handleSave()}
            className="px-4 py-1.5 rounded-full bg-[var(--foreground)] text-[var(--background)] text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            完成
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto space-y-5 text-xs">
          {/* Finish + Board Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[var(--muted-foreground)]">质感</span>
              {CARD_FINISHES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={f.label}
                  onClick={() => setFinish(f.id)}
                  style={{ background: f.dot, borderColor: f.border }}
                  className={`w-6 h-6 rounded-full border cursor-pointer transition ${
                    finish === f.id ? 'ring-2 ring-offset-2 ring-[var(--foreground)] scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>

            {boards.length > 1 && (
              <label className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                <span>画布</span>
                <select
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  className="rounded-full bg-[var(--background)] border border-[var(--border)] px-2.5 py-1 text-[var(--foreground)]"
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Text & Checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">文字与复选框清单</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setContent((prev) => (prev ? prev.trimEnd() + '\n' : '') + '- [ ] ')}
                  className="px-2.5 py-1 rounded-full border border-[var(--border)] hover:opacity-75 cursor-pointer"
                >
                  + 复选框
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContent((prev) =>
                      prev
                        .split('\n')
                        .filter((l) => !/^\s*-\s*\[[xX]\]/.test(l))
                        .join('\n'),
                    );
                    showToast('已清理已完成项');
                  }}
                  className="px-2.5 py-1 rounded-full border border-[var(--border)] hover:opacity-75 cursor-pointer"
                >
                  清理已完成
                </button>
              </div>
            </div>
            <textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="自由写文字，或以 - [ ] 开头生成可勾选清单…"
              className="w-full rounded-2xl bg-[var(--background)] border border-[var(--border)] p-3.5 text-xs leading-relaxed font-mono focus:outline-none focus:border-[var(--foreground)] transition"
            />
          </div>

          {/* Images */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">图片（支持 Ctrl+V 粘贴截图，自动压缩存 Drive）</span>
              <label className="px-3 py-1 rounded-full border border-[var(--border)] hover:opacity-75 cursor-pointer font-medium">
                {uploading ? '上传中…' : '+ 上传图片'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  className="hidden"
                  onChange={(e) => {
                    const list = Array.from(e.target.files || []);
                    e.target.value = '';
                    void handleFiles(list);
                  }}
                />
              </label>
            </div>

            {images.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {images.map((im, i) => (
                  <div
                    key={im.id}
                    style={im.thumb ? { backgroundImage: `url(${im.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    className="relative rounded-2xl overflow-hidden border border-[var(--border)] h-24 group bg-zinc-100"
                  >
                    <img src={`/api/image/${encodeURIComponent(im.file_id)}`} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--border)] py-4 text-center text-[var(--muted-foreground)]">
                上传图片或直接按 Ctrl+V 粘贴截图
              </div>
            )}
          </div>

          {/* Linked Docs / Sheets */}
          <div className="space-y-2">
            <span className="font-medium block">关联 Google Docs / Sheets / 云端硬盘 / 网页链接</span>
            {links.length > 0 && (
              <div className="space-y-1.5">
                {links.map((l, i) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--background)] border border-[var(--border)]"
                  >
                    <a href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 truncate hover:underline">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: linkDotColor(l.kind) }} />
                      <span className="font-medium truncate">{l.title}</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-[var(--muted-foreground)] hover:text-rose-500 cursor-pointer shrink-0"
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddLink} className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="text"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="名称（如：排房表）"
                className="w-full sm:w-36 rounded-xl bg-[var(--background)] border border-[var(--border)] px-3 py-2 focus:outline-none"
              />
              <input
                type="url"
                required
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="粘贴 Google Sheet / Doc 链接…"
                className="flex-1 rounded-xl bg-[var(--background)] border border-[var(--border)] px-3 py-2 focus:outline-none min-w-0"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-medium cursor-pointer shrink-0"
              >
                添加
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
                className="rounded"
              />
              <span>公司电脑模式下隐藏此模块</span>
            </label>
            <button type="button" onClick={() => void handleDelete()} className="text-rose-500 hover:underline cursor-pointer">
              删除模块
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
