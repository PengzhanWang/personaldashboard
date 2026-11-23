import { useEffect, useMemo, useState } from 'react';
import { detectLinkKind, parseCardLayout, type CardFinish, type Row } from '../shared/schema';
import { BentoCanvas } from './components/BentoCanvas';
import { BottomDock } from './components/BottomDock';
import { CardModal, type CardDraft } from './components/CardModal';
import { LoginView } from './components/LoginView';
import { StoreProvider, useStore } from './lib/store';
import { ulid } from './lib/ulid';

function formatDateLabel(): string {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatSyncLabel(syncState: string, pendingCount: number, lastSyncedAt: number | null): string {
  if (syncState === 'error' && pendingCount > 0) return `${pendingCount} 同步失败`;
  if (pendingCount > 0) return `${pendingCount} 待同步`;
  if (syncState === 'syncing') return '同步中';
  if (syncState === 'offline') return '离线';
  if (syncState === 'error') return '同步失败';
  if (!lastSyncedAt) return '就绪';
  const sec = Math.max(0, Math.floor((Date.now() - lastSyncedAt) / 1000));
  if (sec < 15) return '已同步';
  if (sec < 60) return `${sec}s 前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m 前`;
  return new Date(lastSyncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function CanvasShell() {
  const {
    authState,
    device,
    backendKind,
    boards,
    cards,
    syncState,
    lastSyncedAt,
    pendingCount,
    toast,
    showToast,
    clearToast,
    refresh,
    logout,
    upsertRow,
    deleteRow,
    saveLayoutsDebounced,
    uploadImage,
  } = useStore();

  const [activeBoardId, setActiveBoardId] = useState<string>('main');
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<CardDraft | null>(null);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState<Row | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [blurred, setBlurred] = useState(false);
  const [dockUploading, setDockUploading] = useState(false);

  const sortedBoards = useMemo(() => {
    if (boards.length === 0) {
      return [{ id: 'main', title: '主画布', version: '0', updated_at: '', sort: '0' } as Row];
    }
    return [...boards].sort((a, b) => Number(a.sort || '0') - Number(b.sort || '0'));
  }, [boards]);

  useEffect(() => {
    if (!sortedBoards.some((b) => b.id === activeBoardId)) {
      setActiveBoardId(sortedBoards[0].id);
    }
  }, [sortedBoards, activeBoardId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setBlurred((v) => !v);
      } else if (e.key === 'Escape') {
        if (confirmDeleteCard) setConfirmDeleteCard(null);
        else if (lightboxSrc) setLightboxSrc(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxSrc, confirmDeleteCard]);

  const boardCards = useMemo(
    () => cards.filter((c) => (c.board_id || 'main') === activeBoardId),
    [cards, activeBoardId],
  );

  const editingCard = useMemo(
    () => (editingCardId ? cards.find((c) => c.id === editingCardId) || null : null),
    [cards, editingCardId],
  );

  if (authState === 'checking') {
    return (
      <div className="min-h-screen canvas-dots flex items-center justify-center text-xs text-[var(--muted-foreground)]">
        正在加载 LifeOS…
      </div>
    );
  }

  if (authState === 'unauthed') {
    return <LoginView />;
  }

  function nextFreeY(targetBoardId = activeBoardId): number {
    return cards
      .filter((c) => (c.board_id || 'main') === targetBoardId)
      .reduce((m, c) => {
        const l = parseCardLayout(c.layout_json);
        return Math.max(m, l.y + l.h);
      }, 0);
  }

  async function ensureBoardExists(): Promise<string> {
    if (boards.length === 0 && activeBoardId === 'main') {
      await upsertRow(
        'Boards',
        { title: '主画布', sort: '0', sensitive: 'FALSE' },
        { id: 'main', version: '0', updated_at: '' } as Row,
      );
    }
    return activeBoardId;
  }

  async function handleNewBoard() {
    const name = window.prompt('输入新画布名称：', '新画布');
    if (!name || !name.trim()) return;
    const id = await upsertRow('Boards', {
      title: name.trim(),
      sort: String(boards.length),
      sensitive: 'FALSE',
    });
    setActiveBoardId(id);
  }

  function openNewDraft(tag: string, finish: CardFinish, content_md: string) {
    setEditingCardId(null);
    setCreatingDraft({
      board_id: activeBoardId,
      tag,
      title: '',
      finish,
      content_md,
    });
  }

  async function handleCreateFromModal(patch: Record<string, string>) {
    const targetBoard = patch.board_id || (await ensureBoardExists());
    await upsertRow('Cards', {
      layout_json: JSON.stringify({ x: 0, y: nextFreeY(targetBoard), w: 4, h: 2 }),
      ...patch,
      board_id: targetBoard,
    });
    showToast('模块已创建');
  }

  async function handleDuplicateCard(card: Row) {
    const layout = parseCardLayout(card.layout_json);
    const targetBoard = card.board_id || activeBoardId;
    await upsertRow('Cards', {
      board_id: targetBoard,
      tag: card.tag || '',
      title: `${card.title || '未命名模块'} (副本)`,
      finish: card.finish || 'default',
      layout_json: JSON.stringify({ x: layout.x, y: nextFreeY(targetBoard), w: layout.w, h: layout.h }),
      content_md: card.content_md || '',
      images_json: card.images_json || '[]',
      links_json: card.links_json || '[]',
      sensitive: card.sensitive || 'FALSE',
    });
    showToast('已复制模块副本');
  }

  async function handleUploadImageCard(file: File) {
    setDockUploading(true);
    try {
      const { image, sizeKb } = await uploadImage(file);
      const bId = await ensureBoardExists();
      const title = file.name.replace(/\.[^.]+$/, '') || '图片';
      await upsertRow('Cards', {
        board_id: bId,
        tag: '图片',
        title,
        finish: 'default',
        layout_json: JSON.stringify({ x: 0, y: nextFreeY(bId), w: 4, h: 3 }),
        content_md: '',
        images_json: JSON.stringify([image]),
        links_json: '[]',
        sensitive: 'FALSE',
      });
      showToast(`已上传图片 (${sizeKb}KB)`);
    } catch (err) {
      showToast((err as Error).message || '图片上传失败');
    } finally {
      setDockUploading(false);
    }
  }

  async function handleAddLinkCard(title: string, url: string) {
    const bId = await ensureBoardExists();
    const kind = detectLinkKind(url);
    const tag =
      kind === 'gsheet' ? 'Google Sheets' : kind === 'gdoc' ? 'Google Docs' : kind === 'gdrive' ? 'Google Drive' : '链接';
    const label = title || (kind === 'gsheet' ? '表格' : kind === 'gdoc' ? '文档' : '快捷链接');
    await upsertRow('Cards', {
      board_id: bId,
      tag,
      title: label,
      finish: 'default',
      layout_json: JSON.stringify({ x: 0, y: nextFreeY(bId), w: 3, h: 2 }),
      content_md: '',
      images_json: '[]',
      links_json: JSON.stringify([{ id: ulid(), title: label, kind, url }]),
      sensitive: 'FALSE',
    });
    showToast('已添加关联文档方块');
  }

  const syncDot =
    syncState === 'error'
      ? 'bg-rose-500'
      : pendingCount > 0 || syncState === 'offline'
        ? 'bg-amber-400'
        : syncState === 'syncing'
          ? 'bg-sky-500 animate-pulse'
          : 'bg-emerald-500';

  return (
    <div className="min-h-screen canvas-dots">
      {/* Minimal Editorial Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-6 h-6 rounded-lg bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center text-xs font-semibold">
                L
              </div>
              <span className="font-semibold text-sm tracking-tight">LifeOS</span>
              <span className="hidden md:inline text-xs text-[var(--muted-foreground)]">/ {formatDateLabel()}</span>
            </div>

            <nav className="flex items-center gap-1 overflow-x-auto">
              {sortedBoards.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBoardId(b.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer shrink-0 ${
                    activeBoardId === b.id
                      ? 'bg-[var(--foreground)] text-[var(--background)]'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {b.title}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void handleNewBoard()}
                title="新建画布"
                className="w-6 h-6 rounded-full border border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] flex items-center justify-center text-xs cursor-pointer shrink-0"
              >
                +
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 text-xs">
            {device === 'work' && (
              <span className="px-2.5 py-1 rounded-full border border-[var(--foreground)] text-[11px] font-medium">
                公司模式
              </span>
            )}
            {backendKind === 'mock' && (
              <span className="hidden sm:inline px-2 py-0.5 rounded-full border border-[var(--border)] text-[11px] text-[var(--muted-foreground)]">
                Mock
              </span>
            )}

            <div className="hidden md:inline-flex items-center p-0.5 rounded-full border border-[var(--border)] bg-[var(--card)]">
              <button
                type="button"
                onClick={() => setViewMode('desktop')}
                title="12 列桌面拼图"
                className={`p-1.5 rounded-full transition cursor-pointer ${
                  viewMode === 'desktop' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-[var(--muted-foreground)]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('mobile')}
                title="2 列手机预览"
                className={`p-1.5 rounded-full transition cursor-pointer ${
                  viewMode === 'mobile' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-[var(--muted-foreground)]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="5" y="2" width="14" height="20" rx="2" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void refresh(true)}
              title="双向同步：推送本地改动到 Google Sheets，并拉取表格最新数据"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition cursor-pointer"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${syncDot}`} />
              <span className="hidden sm:inline">{formatSyncLabel(syncState, pendingCount, lastSyncedAt)}</span>
            </button>

            <button
              type="button"
              onClick={() => setBlurred((v) => !v)}
              title="一键遮挡 (Alt+B)"
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition cursor-pointer"
            >
              {blurred ? '恢复' : '遮挡'}
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="px-2 py-1.5 text-[var(--muted-foreground)] hover:text-rose-600 transition cursor-pointer"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* Main Bento Canvas */}
      <main className={`max-w-6xl mx-auto px-4 sm:px-5 pt-6 pb-28 transition ${blurred ? 'blur-lg select-none pointer-events-none' : ''}`}>
        <BentoCanvas
          cards={boardCards}
          boards={sortedBoards}
          viewMode={viewMode}
          onEmptyCreate={() => openNewDraft('清单', 'default', '- [ ] ')}
          onEditCard={(c) => {
            setCreatingDraft(null);
            setEditingCardId(c.id);
          }}
          onUpdateCard={(c, patch) => void upsertRow('Cards', patch, c)}
          onDuplicateCard={(c) => void handleDuplicateCard(c)}
          onDeleteCard={(c) => setConfirmDeleteCard(c)}
          onCommitLayouts={saveLayoutsDebounced}
          onOpenLightbox={setLightboxSrc}
        />
      </main>

      <BottomDock
        uploading={dockUploading}
        onAddChecklist={() => openNewDraft('清单', 'default', '- [ ] ')}
        onAddNote={() => openNewDraft('笔记', 'warm', '')}
        onUploadImageCard={(f) => void handleUploadImageCard(f)}
        onAddLinkCard={(t, u) => void handleAddLinkCard(t, u)}
      />

      {editingCard && (
        <CardModal
          card={editingCard}
          boards={sortedBoards}
          onRequestDelete={(c) => setConfirmDeleteCard(c)}
          onClose={() => setEditingCardId(null)}
        />
      )}

      {creatingDraft && (
        <CardModal
          draft={creatingDraft}
          boards={sortedBoards}
          onCreate={handleCreateFromModal}
          onClose={() => setCreatingDraft(null)}
        />
      )}

      {confirmDeleteCard && (
        <div
          onClick={() => setConfirmDeleteCard(null)}
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[var(--card)] border border-[var(--border)] rounded-[24px] shadow-2xl p-6 space-y-4"
          >
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold tracking-tight">确认删除这个模块？</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                将删除「<span className="text-[var(--foreground)] font-medium">{confirmDeleteCard.title || '未命名模块'}</span>」，删除后可在 Google 表格的 <code className="font-mono">Cards</code> 表中将 <code className="font-mono">deleted</code> 改回 <code className="font-mono">FALSE</code> 找回。
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteCard(null)}
                className="px-3.5 py-1.5 rounded-full border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = confirmDeleteCard;
                  setConfirmDeleteCard(null);
                  if (editingCardId === target.id) setEditingCardId(null);
                  void deleteRow('Cards', target);
                  showToast('模块已删除');
                }}
                className="px-4 py-1.5 rounded-full bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 cursor-pointer"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-6 cursor-zoom-out"
        >
          <img src={lightboxSrc} alt="" className="max-w-full max-h-[88vh] rounded-2xl shadow-2xl" />
        </div>
      )}

      {toast && (
        <div
          onClick={clearToast}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-full bg-[var(--foreground)] text-[var(--background)] text-xs font-medium shadow-lg cursor-pointer max-w-[90vw] text-center"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <CanvasShell />
    </StoreProvider>
  );
}
