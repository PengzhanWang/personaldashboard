import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ITEM_TYPES,
  detectItemType,
  type ItemType,
  type WorkspaceColumn,
} from '../../shared/schema';
import { apiUnfurl } from '../lib/api';
import { ulid } from '../lib/ulid';

export type AddModalTab = 'links' | 'files' | 'single';

export interface NewItemDraft {
  column_id: string;
  type: ItemType;
  title: string;
  url: string;
  tags: string;
  note: string;
  due: string;
}

interface BatchAddModalProps {
  cardId: string;
  columns: WorkspaceColumn[];
  defaultColumnId: string;
  initialTab?: AddModalTab;
  initialFiles?: File[];
  onAddItems: (items: NewItemDraft[]) => Promise<void>;
  onClose: () => void;
}

interface PreviewLinkRow {
  id: string;
  url: string;
  title: string;
  type: ItemType;
  ok: boolean;
}

interface QueuedFileRow {
  id: string;
  filename: string;
  title: string;
  type: ItemType;
  customPath: string;
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'()]+/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;!?。，；！？）】》」』]+$/, '');
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out.slice(0, 20);
}

function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
    return path && path !== '/' ? `${host}${path.slice(0, 36)}` : host;
  } catch {
    return url.slice(0, 56);
  }
}

function fileToQueuedRow(file: File): QueuedFileRow {
  const name = file.name || '未命名文件';
  const dotIdx = name.lastIndexOf('.');
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const detected = detectItemType(name);
  const type: ItemType = detected === 'link' || detected === 'task' ? 'file' : detected;
  return {
    id: ulid(),
    filename: name,
    title: stem,
    type,
    customPath: '',
  };
}

function joinLocalPath(prefix: string, filename: string): string {
  const p = prefix.trim();
  if (!p) return filename;
  if (p.endsWith('/') || p.endsWith('\\')) return p + filename;
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  return `${p}${sep}${filename}`;
}

export function BatchAddModal({
  cardId,
  columns,
  defaultColumnId,
  initialTab = 'links',
  initialFiles,
  onAddItems,
  onClose,
}: BatchAddModalProps) {
  const [tab, setTab] = useState<AddModalTab>(initialTab);
  const [columnId, setColumnId] = useState(defaultColumnId || columns[0]?.id || '');
  const [commonTags, setCommonTags] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ---- Tab 1: Batch Links ----
  const [rawLinksText, setRawLinksText] = useState('');
  const [unfurling, setUnfurling] = useState(false);
  const [unfurlError, setUnfurlError] = useState<string | null>(null);
  const [previewLinks, setPreviewLinks] = useState<PreviewLinkRow[]>([]);

  const detectedUrls = useMemo(() => extractUrls(rawLinksText), [rawLinksText]);

  // ---- Tab 2: Local Files ----
  const prefixStorageKey = `lifeos:localPrefix:${cardId}`;
  const [folderPrefix, setFolderPrefix] = useState(() => {
    try {
      return localStorage.getItem(prefixStorageKey) || '';
    } catch {
      return '';
    }
  });
  const [fileRows, setFileRows] = useState<QueuedFileRow[]>(() =>
    initialFiles && initialFiles.length ? initialFiles.map(fileToQueuedRow) : [],
  );
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Tab 3: Single Item ----
  const [singleTitle, setSingleTitle] = useState('');
  const [singleUrl, setSingleUrl] = useState('');
  const [singleType, setSingleType] = useState<ItemType>('task');
  const [singleTypeTouched, setSingleTypeTouched] = useState(false);
  const [singleTags, setSingleTags] = useState('');
  const [singleDue, setSingleDue] = useState('');
  const [singleNote, setSingleNote] = useState('');

  useEffect(() => {
    try {
      if (folderPrefix.trim()) localStorage.setItem(prefixStorageKey, folderPrefix.trim());
      else localStorage.removeItem(prefixStorageKey);
    } catch {
      // ignore storage errors
    }
  }, [folderPrefix, prefixStorageKey]);

  async function handleUnfurl() {
    if (!detectedUrls.length) return;
    setUnfurling(true);
    setUnfurlError(null);
    try {
      const res = await apiUnfurl(detectedUrls);
      setPreviewLinks(
        res.results.map((r) => ({
          id: ulid(),
          url: r.url,
          title: r.title,
          type: r.type,
          ok: r.ok,
        })),
      );
    } catch (e) {
      setUnfurlError((e as Error).message || '抓取标题失败，已回退为域名标题');
      setPreviewLinks(
        detectedUrls.map((u) => ({
          id: ulid(),
          url: u,
          title: fallbackTitle(u),
          type: detectItemType(u),
          ok: false,
        })),
      );
    } finally {
      setUnfurling(false);
    }
  }

  function handleSkipUnfurl() {
    if (!detectedUrls.length) return;
    setUnfurlError(null);
    setPreviewLinks(
      detectedUrls.map((u) => ({
        id: ulid(),
        url: u,
        title: fallbackTitle(u),
        type: detectItemType(u),
        ok: false,
      })),
    );
  }

  async function handleCommitLinks() {
    if (!previewLinks.length) return;
    setSubmitting(true);
    try {
      await onAddItems(
        previewLinks.map((r) => ({
          column_id: columnId,
          type: r.type,
          title: r.title.trim() || fallbackTitle(r.url),
          url: r.url,
          tags: commonTags.trim(),
          note: '',
          due: '',
        })),
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function appendFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setFileRows((prev) => [...prev, ...arr.map(fileToQueuedRow)]);
  }

  async function handleCommitFiles() {
    if (!fileRows.length) return;
    setSubmitting(true);
    try {
      await onAddItems(
        fileRows.map((r) => ({
          column_id: columnId,
          type: r.type,
          title: r.title.trim() || r.filename,
          url: (r.customPath.trim() || joinLocalPath(folderPrefix, r.filename)).trim(),
          tags: commonTags.trim(),
          note: '',
          due: '',
        })),
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommitSingle(e: React.FormEvent) {
    e.preventDefault();
    const finalTitle = singleTitle.trim() || singleUrl.trim();
    if (!finalTitle) return;
    setSubmitting(true);
    try {
      await onAddItems([
        {
          column_id: columnId,
          type: singleType,
          title: finalTitle,
          url: singleUrl.trim(),
          tags: singleTags.trim(),
          note: singleNote.trim(),
          due: singleDue.trim(),
        },
      ]);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] bg-[#0F1E30]/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[88vh] bg-white border border-[var(--hairline-strong)] rounded-[3px] shadow-[0_24px_56px_-18px_rgba(15,30,48,0.3)] flex flex-col overflow-hidden"
      >
        {/* Header + Tabs */}
        <div className="px-5 pt-4 pb-0 border-b border-[var(--hairline)] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="nolan-title text-sm font-bold text-[#0F1E30]">添加内容到看板</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-base leading-none text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer px-1"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-1 -mb-px">
            {(
              [
                ['links', '批量粘贴链接'],
                ['files', '拖入本地文件'],
                ['single', '单条添加'],
              ] as [AddModalTab, string][]
            ).map(([id, label]) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition cursor-pointer ${
                    active
                      ? 'border-[#D94E28] text-[#0F1E30]'
                      : 'border-transparent text-[var(--muted-foreground)] hover:text-[#0F1E30]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto card-scroll p-5 space-y-4">
          {/* Shared column & tags bar for batch tabs */}
          {(tab === 'links' || tab === 'files') && (
            <div className="grid grid-cols-2 gap-3">
              {columns.length > 0 && (
                <div>
                  <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                    放入列
                  </label>
                  <select
                    value={columnId}
                    onChange={(e) => setColumnId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-[var(--hairline-strong)] rounded-[2px] outline-none"
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                  统一标签（可选，逗号分隔）
                </label>
                <input
                  value={commonTags}
                  onChange={(e) => setCommonTags(e.target.value)}
                  placeholder="如：第一周, 参考资料"
                  className="w-full px-2.5 py-1.5 text-xs border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
                />
              </div>
            </div>
          )}

          {/* TAB 1: Batch Links */}
          {tab === 'links' && (
            <>
              {previewLinks.length === 0 ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)]">
                        粘贴多个链接（每行一个，最多 20 条）
                      </label>
                      {detectedUrls.length > 0 && (
                        <span className="font-mono text-[10.5px] text-[#2A7A68] font-semibold">
                          已识别 {detectedUrls.length} 个链接
                        </span>
                      )}
                    </div>
                    <textarea
                      autoFocus
                      value={rawLinksText}
                      onChange={(e) => setRawLinksText(e.target.value)}
                      rows={7}
                      placeholder={
                        'https://www.bilibili.com/video/BV...\nhttps://www.xiaoyuzhoufm.com/episode/...\nhttps://docs.google.com/document/d/...\n\n也支持直接粘贴包含多个网址的整段文字，会自动提取链接。'
                      }
                      className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-[#ECF0F4]/40 border border-[var(--hairline-strong)] focus:border-[#0F1E30] focus:bg-white rounded-[2px] outline-none resize-y"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!detectedUrls.length || unfurling}
                      onClick={handleSkipUnfurl}
                      className="text-xs text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer disabled:opacity-40"
                    >
                      跳过抓取，直接预览
                    </button>
                    <button
                      type="button"
                      disabled={!detectedUrls.length || unfurling}
                      onClick={() => void handleUnfurl()}
                      className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-4 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer transition disabled:opacity-40"
                    >
                      {unfurling ? `正在抓取 ${detectedUrls.length} 个标题…` : '抓取标题并预览'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setPreviewLinks([])}
                      className="nolan-label text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer"
                    >
                      ← 返回修改链接
                    </button>
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      共 {previewLinks.length} 条 · 可直接修改标题与类型
                    </span>
                  </div>

                  {unfurlError && (
                    <div className="px-3 py-2 text-xs bg-[#D94E28]/10 border border-[#D94E28]/30 text-[#D94E28] rounded-[2px]">
                      {unfurlError}
                    </div>
                  )}

                  <div className="space-y-2 max-h-[320px] overflow-y-auto card-scroll pr-1">
                    {previewLinks.map((row) => (
                      <div
                        key={row.id}
                        className="p-2.5 bg-[#ECF0F4]/40 border border-[var(--hairline)] rounded-[2px] space-y-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <select
                            value={row.type}
                            onChange={(e) => {
                              const nextType = e.target.value as ItemType;
                              setPreviewLinks((prev) =>
                                prev.map((x) => (x.id === row.id ? { ...x, type: nextType } : x)),
                              );
                            }}
                            className="px-1.5 py-1 text-[11px] font-semibold bg-white border border-[var(--hairline-strong)] rounded-[2px] outline-none shrink-0"
                          >
                            {ITEM_TYPES.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <input
                            value={row.title}
                            onChange={(e) => {
                              const nextTitle = e.target.value;
                              setPreviewLinks((prev) =>
                                prev.map((x) => (x.id === row.id ? { ...x, title: nextTitle } : x)),
                              );
                            }}
                            className="flex-1 min-w-0 px-2 py-1 text-xs font-semibold bg-white border border-[var(--hairline)] focus:border-[#0F1E30] rounded-[2px] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setPreviewLinks((prev) => prev.filter((x) => x.id !== row.id))}
                            title="移除"
                            className="text-sm text-[var(--muted-foreground)] hover:text-[#D94E28] px-1 cursor-pointer"
                          >
                            ×
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--muted-foreground)] font-mono truncate">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.ok ? 'bg-[#2A7A68]' : 'bg-amber-500'}`}
                            title={row.ok ? '已抓取网页标题' : '未能抓取标题，已使用默认标题'}
                          />
                          <span className="truncate">{row.url}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: Local Files */}
          {tab === 'files' && (
            <div className="space-y-3">
              <div>
                <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                  本地文件夹前缀（可选，会自动记住此项目的目录）
                </label>
                <input
                  value={folderPrefix}
                  onChange={(e) => setFolderPrefix(e.target.value)}
                  placeholder="例如：/Users/me/Courses/ML/ 或 D:\学习资料\课程\"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
                />
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
                  网页版仅记录文件路径引用，不上传文件本身；填一次目录前缀后，拖入的文件会自动拼出完整可复制路径。
                </p>
              </div>

              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropActive(true);
                }}
                onDragLeave={() => setDropActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropActive(false);
                  if (e.dataTransfer.files?.length) appendFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`p-5 border border-dashed rounded-[3px] text-center cursor-pointer transition select-none ${
                  dropActive
                    ? 'border-[#D94E28] bg-[#D94E28]/10'
                    : 'border-[var(--hairline-strong)] bg-[#ECF0F4]/40 hover:border-[#0F1E30] hover:bg-[#ECF0F4]/70'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) appendFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <p className="nolan-label text-[10.5px] font-bold text-[#0F1E30]">
                  将电脑上的文件拖到这里，或点击选择（支持多选）
                </p>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
                  自动识别视频 / 音频 / PDF / 文档 / 图片类型，不消耗云端空间
                </p>
              </div>

              {/* Queued Files List */}
              {fileRows.length > 0 && (
                <div className="space-y-2 max-h-[240px] overflow-y-auto card-scroll pr-1">
                  {fileRows.map((row) => {
                    const effectivePath = row.customPath || joinLocalPath(folderPrefix, row.filename);
                    return (
                      <div
                        key={row.id}
                        className="p-2.5 bg-[#ECF0F4]/40 border border-[var(--hairline)] rounded-[2px] space-y-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <select
                            value={row.type}
                            onChange={(e) => {
                              const nextType = e.target.value as ItemType;
                              setFileRows((prev) =>
                                prev.map((x) => (x.id === row.id ? { ...x, type: nextType } : x)),
                              );
                            }}
                            className="px-1.5 py-1 text-[11px] font-semibold bg-white border border-[var(--hairline-strong)] rounded-[2px] outline-none shrink-0"
                          >
                            {ITEM_TYPES.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <input
                            value={row.title}
                            onChange={(e) => {
                              const nextTitle = e.target.value;
                              setFileRows((prev) =>
                                prev.map((x) => (x.id === row.id ? { ...x, title: nextTitle } : x)),
                              );
                            }}
                            className="flex-1 min-w-0 px-2 py-1 text-xs font-semibold bg-white border border-[var(--hairline)] focus:border-[#0F1E30] rounded-[2px] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setFileRows((prev) => prev.filter((x) => x.id !== row.id))}
                            title="移除"
                            className="text-sm text-[var(--muted-foreground)] hover:text-[#D94E28] px-1 cursor-pointer"
                          >
                            ×
                          </button>
                        </div>
                        <input
                          value={effectivePath}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFileRows((prev) =>
                              prev.map((x) => (x.id === row.id ? { ...x, customPath: val } : x)),
                            );
                          }}
                          placeholder="本地完整路径"
                          className="w-full px-2 py-1 text-[11px] font-mono text-[var(--muted-foreground)] bg-white/80 border border-[var(--hairline)] focus:border-[#0F1E30] focus:text-[#0F1E30] rounded-[2px] outline-none"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Single Item */}
          {tab === 'single' && (
            <form id="single-item-form" onSubmit={(e) => void handleCommitSingle(e)} className="space-y-3">
              <div>
                <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                  标题 *
                </label>
                <input
                  autoFocus
                  value={singleTitle}
                  onChange={(e) => setSingleTitle(e.target.value)}
                  placeholder="任务名、课程名、文章或文件名"
                  className="w-full px-2.5 py-1.5 text-sm border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
                />
              </div>

              <div>
                <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                  链接或本地路径（可选，自动识别类型）
                </label>
                <input
                  value={singleUrl}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSingleUrl(v);
                    if (!singleTypeTouched) setSingleType(detectItemType(v));
                  }}
                  placeholder="https://... 或 /Users/... / D:\..."
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
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
                      onClick={() => {
                        setSingleType(t.id);
                        setSingleTypeTouched(true);
                      }}
                      className={`px-2 py-1 rounded-[2px] border text-[10.5px] font-semibold cursor-pointer transition inline-flex items-center gap-1 ${
                        singleType === t.id
                          ? 'bg-[#0F1E30] border-[#0F1E30] text-white'
                          : 'bg-white border-[var(--hairline)] text-[#0F1E30] hover:border-[var(--hairline-strong)]'
                      }`}
                    >
                      <span className="w-1.5 h-1.5" style={{ background: singleType === t.id ? '#fff' : t.color }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {columns.length > 0 && (
                  <div>
                    <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                      放入列
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
                )}
                <div>
                  <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                    截止日期（可选）
                  </label>
                  <input
                    type="date"
                    value={singleDue}
                    onChange={(e) => setSingleDue(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-[var(--hairline-strong)] rounded-[2px] outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                    标签（逗号分隔）
                  </label>
                  <input
                    value={singleTags}
                    onChange={(e) => setSingleTags(e.target.value)}
                    placeholder="如：基础, 必看"
                    className="w-full px-2.5 py-1.5 text-xs border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
                  />
                </div>
                <div>
                  <label className="nolan-label text-[9.5px] font-semibold text-[var(--muted-foreground)] block mb-1">
                    简短备注
                  </label>
                  <input
                    value={singleNote}
                    onChange={(e) => setSingleNote(e.target.value)}
                    placeholder="一句话说明"
                    className="w-full px-2.5 py-1.5 text-xs border border-[var(--hairline-strong)] focus:border-[#0F1E30] rounded-[2px] outline-none"
                  />
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--hairline)] bg-[#ECF0F4]/30 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="dunkirk-btn bg-white px-3.5 py-1.5 nolan-label text-[10px] font-semibold cursor-pointer"
          >
            取消
          </button>

          {tab === 'links' && previewLinks.length > 0 && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleCommitLinks()}
              className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-4 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer transition disabled:opacity-40"
            >
              {submitting ? '正在加入…' : `全部加入看板 (${previewLinks.length})`}
            </button>
          )}

          {tab === 'files' && (
            <button
              type="button"
              disabled={submitting || fileRows.length === 0}
              onClick={() => void handleCommitFiles()}
              className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-4 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer transition disabled:opacity-40"
            >
              {submitting ? '正在加入…' : `加入看板 (${fileRows.length})`}
            </button>
          )}

          {tab === 'single' && (
            <button
              type="submit"
              form="single-item-form"
              disabled={submitting || (!singleTitle.trim() && !singleUrl.trim())}
              className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-4 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer transition disabled:opacity-40"
            >
              {submitting ? '添加中…' : '添加'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
