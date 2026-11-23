import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export interface CardDraft {
  board_id: string;
  tag: string;
  title: string;
  finish: CardFinish;
  content_md: string;
}

function linkDotColor(kind: LinkKind): string {
  if (kind === 'gsheet') return '#16a34a';
  if (kind === 'gdoc') return '#2563eb';
  if (kind === 'gdrive') return '#d97706';
  return '#71717a';
}

function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function CardModal({
  card,
  draft,
  boards,
  onCreate,
  onSaveExisting,
  onRequestDelete,
  onOpenLightbox,
  onClose,
}: {
  card?: Row;
  draft?: CardDraft;
  boards: Row[];
  onCreate?: (patch: Record<string, string>) => Promise<void>;
  onSaveExisting?: (card: Row, patch: Record<string, string>) => Promise<void>;
  onRequestDelete?: (card: Row) => void;
  onOpenLightbox?: (src: string) => void;
  onClose: () => void;
}) {
  const { uploadImage, showToast } = useStore();
  const isNew = !card;

  const init = useMemo(
    () => ({
      tag: card?.tag ?? draft?.tag ?? '模块',
      title: card?.title ?? draft?.title ?? '',
      finish: (((card?.finish ?? draft?.finish) as CardFinish) || 'default') as CardFinish,
      boardId: card?.board_id ?? draft?.board_id ?? 'main',
      content: card?.content_md ?? draft?.content_md ?? '',
      images: card ? parseCardImages(card.images_json) : [],
      links: card ? parseCardLinks(card.links_json) : [],
      sensitive: card?.sensitive === 'TRUE',
    }),
    // Only capture initial values when switching which card/draft is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card?.id, draft],
  );

  const [tag, setTag] = useState(init.tag);
  const [title, setTitle] = useState(init.title);
  const [finish, setFinish] = useState<CardFinish>(init.finish);
  const [boardId, setBoardId] = useState(init.boardId);
  const [content, setContent] = useState(init.content);
  const [images, setImages] = useState<CardImage[]>(init.images);
  const [links, setLinks] = useState<CardLink[]>(init.links);
  const [sensitive, setSensitive] = useState(init.sensitive);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const isDirty = useMemo(() => {
    if (isNew) {
      return Boolean(
        title.trim() ||
          content.replace(/^-\s*\[\s*\]\s*$/, '').trim() ||
          images.length ||
          links.length,
      );
    }
    return (
      tag !== init.tag ||
      title !== init.title ||
      finish !== init.finish ||
      boardId !== init.boardId ||
      content !== init.content ||
      sensitive !== init.sensitive ||
      JSON.stringify(images) !== JSON.stringify(init.images) ||
      JSON.stringify(links) !== JSON.stringify(init.links)
    );
  }, [isNew, tag, title, finish, boardId, content, sensitive, images, links, init]);

  const handleFiles = useCallback(
    async (files: File[]) => {
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
    },
    [uploadImage, showToast],
  );

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    const hasPayload = Boolean(trimmedTitle || trimmedContent || images.length || links.length);

    if (isNew && !hasPayload) {
      showToast('请先输入标题、内容、图片或链接再创建');
      return;
    }

    const patch: Record<string, string> = {
      board_id: boardId,
      tag: tag.trim(),
      title: trimmedTitle || '未命名模块',
      finish,
      content_md: content,
      images_json: JSON.stringify(images),
      links_json: JSON.stringify(links),
      sensitive: sensitive ? 'TRUE' : 'FALSE',
    };

    if (isNew && onCreate) {
      await onCreate(patch);
    } else if (card && onSaveExisting) {
      await onSaveExisting(card, patch);
    }
    onClose();
  }, [isNew, title, content, images, links, boardId, tag, finish, sensitive, onCreate, card, onSaveExisting, onClose, showToast]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Register paste & keyboard shortcuts properly with dependency array
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgFiles = items
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (imgFiles.length) void handleFiles(imgFiles);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSaveRef.current();
      } else if (e.key === 'Escape') {
        if (isDirtyRef.current) {
          showToast('有未保存的改动，请点「保存」或「取消」');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [handleFiles, onClose, showToast]);

  function handleBackdropClick() {
    if (isDirty) {
      showToast('有未保存的改动，请点「保存」或「取消」');
      return;
    }
    onClose();
  }

  /** Smart Enter inside checklist textarea: continues `- [ ] ` automatically; empty item exits list. */
  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const pos = el.selectionStart;
    if (pos !== el.selectionEnd) return;

    const lineStart = content.lastIndexOf('\n', pos - 1) + 1;
    const currentLine = content.slice(lineStart, pos);
    const match = currentLine.match(/^(\s*-\s*)\[[ xX]\]\s*(.*)$/);
    if (!match) return;

    e.preventDefault();
    const prefix = match[1];
    const body = match[2];

    if (!body.trim()) {
      // Pressing Enter on an empty `- [ ] ` line exits checklist mode
      const next = content.slice(0, lineStart) + content.slice(pos);
      setContent(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = lineStart;
      });
    } else {
      const insert = `\n${prefix}[ ] `;
      const next = content.slice(0, pos) + insert + content.slice(pos);
      setContent(next);
      const nextPos = pos + insert.length;
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = nextPos;
      });
    }
  }

  function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    const url = normalizeUrl(linkUrl);
    if (!url) return;
    const kind = detectLinkKind(url);
    const defaultLabel =
      kind === 'gsheet' ? 'Google Sheet' : kind === 'gdoc' ? 'Google Doc' : kind === 'gdrive' ? 'Google Drive' : '关联链接';
    setLinks((prev) => [...prev, { id: ulid(), title: linkTitle.trim() || defaultLabel, kind, url }]);
    setLinkTitle('');
    setLinkUrl('');
  }

  return (
    <div
      onClick={handleBackdropClick}
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
              placeholder={isNew ? '输入模块标题（例如：超市购物清单）…' : '模块标题'}
              className="w-full bg-transparent text-base font-semibold tracking-tight focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-full border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => void handleSave()}
              title="保存 (Ctrl+Enter)"
              className="px-4 py-1.5 rounded-full bg-[var(--foreground)] text-[var(--background)] text-xs font-medium cursor-pointer disabled:opacity-50"
            >
              {isNew ? '创建模块' : '保存'}
            </button>
          </div>
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
              <span className="font-medium">文字与清单（清单行按回车自动续接，Ctrl+Enter 保存）</span>
              <div className="flex items-center gap-2 shrink-0">
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
              onKeyDown={handleTextareaKeyDown}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {images.map((im, i) => {
                  const fullUrl = `/api/image/${encodeURIComponent(im.file_id)}`;
                  return (
                    <div
                      key={im.id}
                      className="rounded-2xl overflow-hidden border border-[var(--border)] group bg-zinc-100 flex flex-col"
                    >
                      <div
                        style={
                          im.thumb
                            ? { backgroundImage: `url(${im.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                            : undefined
                        }
                        onClick={() => onOpenLightbox?.(fullUrl)}
                        className="relative h-24 cursor-zoom-in"
                      >
                        <img src={fullUrl} alt={im.caption || ''} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setImages((prev) => prev.filter((_, idx) => idx !== i));
                          }}
                          className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] opacity-0 group-hover:opacity-100 transition cursor-pointer"
                        >
                          删除
                        </button>
                      </div>
                      <input
                        type="text"
                        value={im.caption || ''}
                        onChange={(e) =>
                          setImages((prev) =>
                            prev.map((item, idx) => (idx === i ? { ...item, caption: e.target.value } : item)),
                          )
                        }
                        placeholder="图片备注…"
                        className="w-full px-2 py-1 text-[11px] bg-[var(--card)] border-t border-[var(--border)] focus:outline-none"
                      />
                    </div>
                  );
                })}
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
                type="text"
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
            {!isNew && card && (
              <button type="button" onClick={() => onRequestDelete?.(card)} className="text-rose-500 hover:underline cursor-pointer">
                删除模块
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
