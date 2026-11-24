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
  if (kind === 'gsheet') return '#02CA0E';
  if (kind === 'gdoc') return '#283D92';
  if (kind === 'gdrive') return '#DFB0AF';
  return '#6C4D6D';
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
      tag: card?.tag ?? draft?.tag ?? 'FORM',
      title: card?.title ?? draft?.title ?? '',
      finish: (((card?.finish ?? draft?.finish) as CardFinish) || 'default') as CardFinish,
      boardId: card?.board_id ?? draft?.board_id ?? 'main',
      content: card?.content_md ?? draft?.content_md ?? '',
      images: card ? parseCardImages(card.images_json) : [],
      links: card ? parseCardLinks(card.links_json) : [],
      sensitive: card?.sensitive === 'TRUE',
    }),
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

  const activeMotif = CARD_FINISHES.find((f) => f.id === finish) || CARD_FINISHES[0];

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xl bg-[#F4F1EA] border-2 border-[#161616] shadow-[10px_10px_0_#161616] overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Top Bauhaus Motif Strip */}
        <div className="h-2.5 w-full shrink-0" style={{ background: activeMotif.dot }} />

        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b-[1.5px] border-[#161616] bg-white flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="标签（如：LIST / 婚礼 / WORK）"
              className="w-full bg-transparent font-mono text-[11px] uppercase tracking-widest text-[var(--muted-foreground)] focus:outline-none"
            />
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isNew ? '输入模块标题（例如：超市购物清单）…' : '模块标题'}
              className="w-full bg-transparent text-base font-bold tracking-tight focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="bauhaus-btn bg-white px-3 py-1.5 font-mono text-xs cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => void handleSave()}
              title="保存 (Ctrl+Enter)"
              className="bauhaus-btn bg-[#161616] text-white px-4 py-1.5 font-mono text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {isNew ? '创建' : 'SAVE'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-5 text-xs">
          {/* Motif + Board Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-[var(--muted-foreground)] mr-1">MOTIF:</span>
              {CARD_FINISHES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFinish(f.id)}
                  style={{
                    background: f.dot,
                    color: f.id === 'warm' || f.id === 'sage' ? '#161616' : '#FFFFFF',
                  }}
                  className={`px-2.5 py-1 border-[1.5px] border-[#161616] font-bold text-[11px] cursor-pointer transition ${
                    finish === f.id ? 'shadow-[3px_3px_0_#161616] -translate-x-0.5 -translate-y-0.5' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {boards.length > 1 && (
              <label className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                <span>画布</span>
                <select
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  className="bg-white border-[1.5px] border-[#161616] px-2 py-1 text-[#161616]"
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
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">文字与清单（清单行按回车自动续接，Ctrl+Enter 保存）</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setContent((prev) => (prev ? prev.trimEnd() + '\n' : '') + '- [ ] ')}
                  className="bauhaus-btn bg-white px-2.5 py-1 font-mono text-[11px] cursor-pointer"
                >
                  + [ ]
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
                  className="bauhaus-btn bg-white px-2.5 py-1 font-mono text-[11px] cursor-pointer"
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
              className="w-full bg-white border-[1.5px] border-[#161616] p-3 text-xs leading-relaxed font-mono focus:outline-none"
            />
          </div>

          {/* Images */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold">图片（支持 Ctrl+V 粘贴截图，自动压缩存 Drive）</span>
              <label className="bauhaus-btn bg-white px-3 py-1 font-mono text-[11px] font-bold cursor-pointer">
                {uploading ? 'UPLOADING…' : '+ 上传图片'}
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
                      className="border-[1.5px] border-[#161616] group bg-white flex flex-col"
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
                          className="absolute top-1 right-1 px-1.5 py-0.5 bg-[#161616] text-white font-mono text-[10px] opacity-0 group-hover:opacity-100 transition cursor-pointer"
                        >
                          DEL
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
                        className="w-full px-2 py-1 text-[11px] bg-white border-t border-[#161616]/25 focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border-[1.5px] border-dashed border-[#161616]/40 bg-white/60 py-4 text-center font-mono text-[11px] text-[var(--muted-foreground)]">
                上传图片或直接按 Ctrl+V 粘贴截图
              </div>
            )}
          </div>

          {/* Linked Docs / Sheets */}
          <div className="space-y-2">
            <span className="font-bold block">关联 Google Docs / Sheets / 云端硬盘 / 网页链接</span>
            {links.length > 0 && (
              <div className="space-y-1.5">
                {links.map((l, i) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-[1.5px] border-[#161616]"
                  >
                    <a href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 truncate hover:underline">
                      <span className="w-2.5 h-2.5 shrink-0 border border-[#161616]" style={{ background: linkDotColor(l.kind) }} />
                      <span className="font-bold truncate">{l.title}</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}
                      className="font-mono text-[11px] text-rose-600 underline cursor-pointer shrink-0"
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
                className="w-full sm:w-36 bg-white border-[1.5px] border-[#161616] px-3 py-2 focus:outline-none"
              />
              <input
                type="text"
                required
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="粘贴 Google Sheet / Doc 链接…"
                className="flex-1 bg-white border-[1.5px] border-[#161616] px-3 py-2 font-mono focus:outline-none min-w-0"
              />
              <button
                type="submit"
                className="bauhaus-btn bg-[#283D92] text-white px-3.5 py-2 font-mono font-bold cursor-pointer shrink-0"
              >
                + ADD
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-[#161616]/25 flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
              />
              <span>公司电脑模式下隐藏此模块</span>
            </label>
            {!isNew && card && (
              <button type="button" onClick={() => onRequestDelete?.(card)} className="font-mono text-rose-600 underline cursor-pointer">
                DELETE MODULE
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
