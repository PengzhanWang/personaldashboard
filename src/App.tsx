import { useEffect, useMemo, useState } from 'react';
import { detectLinkKind, parseCardLayout, type CardFinish, type Row } from '../shared/schema';
import { BentoCanvas } from './components/BentoCanvas';
import { BoardModal } from './components/BoardModal';
import { BottomDock } from './components/BottomDock';
import { CardModal, type CardDraft } from './components/CardModal';
import { LoginView } from './components/LoginView';
import { SearchModal } from './components/SearchModal';
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
    mutateBatch,
    saveLayoutsDebounced,
    uploadImage,
  } = useStore();

  const [activeBoardId, setActiveBoardId] = useState<string>('main');
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<CardDraft | null>(null);
  const [boardModal, setBoardModal] = useState<'new' | Row | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState<Row | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [blurred, setBlurred] = useState(false);
  const [dockUploading, setDockUploading] = useState(false);
  const [, setClockTick] = useState(0);

  // Refresh relative sync label ("2m 前") every 30s
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  const sortedBoards = useMemo(() => {
    if (boards.length === 0) {
      return [{ id: 'main', title: '主画布', version: '0', updated_at: '', sort: '0', sensitive: 'FALSE' } as Row];
    }
    return [...boards].sort((a, b) => Number(a.sort || '0') - Number(b.sort || '0'));
  }, [boards]);

  useEffect(() => {
    if (!sortedBoards.some((b) => b.id === activeBoardId)) {
      setActiveBoardId(sortedBoards[0].id);
    }
  }, [sortedBoards, activeBoardId]);

  // Global keyboard shortcuts: Alt+B privacy blur, Ctrl/Cmd+K quick search, Esc close overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setBlurred((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && authState === 'authed') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === 'Escape') {
        if (confirmDeleteCard) setConfirmDeleteCard(null);
        else if (lightboxSrc) setLightboxSrc(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authState, lightboxSrc, confirmDeleteCard]);

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

  function nextFreeY(targetBoardId = activeBoardId, excludeCardId?: string): number {
    return cards
      .filter((c) => (c.board_id || 'main') === targetBoardId && c.id !== excludeCardId)
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

  async function handleSaveBoard(data: { title: string; sensitive: boolean }) {
    if (boardModal === 'new') {
      await ensureBoardExists();
      const id = await upsertRow('Boards', {
        title: data.title,
        sort: String(sortedBoards.length),
        sensitive: data.sensitive ? 'TRUE' : 'FALSE',
      });
      setActiveBoardId(id);
      showToast(`已创建画布「${data.title}」`);
    } else if (boardModal) {
      await upsertRow(
        'Boards',
        {
          title: data.title,
          sensitive: data.sensitive ? 'TRUE' : 'FALSE',
        },
        boardModal,
      );
      showToast('画布设置已保存');
    }
  }

  async function handleDeleteBoard(board: Row, moveCardsToBoardId: string | null) {
    const affected = cards.filter((c) => (c.board_id || 'main') === board.id);
    const ops: { table: 'Boards' | 'Cards'; op: 'upsert' | 'delete'; row: Row; patch?: Record<string, string> }[] = [];

    if (moveCardsToBoardId) {
      let yCursor = nextFreeY(moveCardsToBoardId);
      for (const c of affected) {
        const l = parseCardLayout(c.layout_json);
        ops.push({
          table: 'Cards',
          op: 'upsert',
          row: c,
          patch: {
            board_id: moveCardsToBoardId,
            layout_json: JSON.stringify({ ...l, x: 0, y: yCursor }),
          },
        });
        yCursor += l.h;
      }
    } else {
      for (const c of affected) {
        ops.push({ table: 'Cards', op: 'delete', row: c });
      }
    }

    ops.push({ table: 'Boards', op: 'delete', row: board });
    await mutateBatch(ops);

    const fallback = sortedBoards.find((b) => b.id !== board.id);
    if (fallback) setActiveBoardId(moveCardsToBoardId || fallback.id);
    showToast(
      moveCardsToBoardId && affected.length
        ? `已删除画布，并转移 ${affected.length} 个模块`
        : `已删除画布「${board.title}」`,
    );
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

  async function handleSaveExistingCard(card: Row, patch: Record<string, string>) {
    const nextPatch = { ...patch };
    const prevBoard = card.board_id || 'main';
    const nextBoard = patch.board_id || prevBoard;
    // If moved to a different board, place at a clean free y-slot so it never overlaps
    if (nextBoard !== prevBoard) {
      const curLayout = parseCardLayout(card.layout_json);
      nextPatch.layout_json = JSON.stringify({ ...curLayout, x: 0, y: nextFreeY(nextBoard, card.id) });
    }
    await upsertRow('Cards', nextPatch, card);
  }

  async function handleMoveCardToBoard(card: Row, targetBoardId: string) {
    const curLayout = parseCardLayout(card.layout_json);
    await upsertRow(
      'Cards',
      {
        board_id: targetBoardId,
        layout_json: JSON.stringify({ ...curLayout, x: 0, y: nextFreeY(targetBoardId, card.id) }),
      },
      card,
    );
    const targetTitle = sortedBoards.find((b) => b.id === targetBoardId)?.title || '目标画布';
    showToast(`已移动到「${targetTitle}」`);
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

  const modalBoardCardCount =
    boardModal && boardModal !== 'new'
      ? cards.filter((c) => (c.board_id || 'main') === boardModal.id).length
      : 0;

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

            {/* Board Tabs (click to switch, right-click or gear icon on active tab to rename/delete) */}
            <nav className="flex items-center gap-1 overflow-x-auto">
              {sortedBoards.map((b) => {
                const isActive = activeBoardId === b.id;
                return (
                  <div
                    key={b.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setBoardModal(b);
                    }}
                    className={`inline-flex items-center rounded-full text-xs font-medium transition shrink-0 ${
                      isActive
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveBoardId(b.id)}
                      title="右键或点击右侧图标管理画布"
                      className={`py-1 cursor-pointer ${isActive ? 'pl-3 pr-1.5' : 'px-3'}`}
                    >
                      {b.title}
                    </button>
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => setBoardModal(b)}
                        title="画布设置（重命名 / 敏感 / 删除）"
                        className="pr-2.5 pl-0.5 py-1 opacity-65 hover:opacity-100 cursor-pointer"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setBoardModal('new')}
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

            {/* Global Search */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="搜索所有模块 (Ctrl+K)"
              className="p-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>

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
      <main className={`max-w-6xl mx-auto px-4 sm:px-5 pt-6 pb-32 transition ${blurred ? 'blur-lg select-none pointer-events-none' : ''}`}>
        <BentoCanvas
          cards={boardCards}
          boards={sortedBoards}
          viewMode={viewMode}
          onEditCard={(c) => {
            setCreatingDraft(null);
            setEditingCardId(c.id);
          }}
          onUpdateCard={(c, patch) => void upsertRow('Cards', patch, c)}
          onMoveCardToBoard={(c, targetId) => void handleMoveCardToBoard(c, targetId)}
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
          onSaveExisting={handleSaveExistingCard}
          onRequestDelete={(c) => setConfirmDeleteCard(c)}
          onOpenLightbox={setLightboxSrc}
          onClose={() => setEditingCardId(null)}
        />
      )}

      {creatingDraft && (
        <CardModal
          draft={creatingDraft}
          boards={sortedBoards}
          onCreate={handleCreateFromModal}
          onOpenLightbox={setLightboxSrc}
          onClose={() => setCreatingDraft(null)}
        />
      )}

      {boardModal && (
        <BoardModal
          board={boardModal === 'new' ? undefined : boardModal}
          allBoards={sortedBoards}
          cardCount={modalBoardCardCount}
          onSave={handleSaveBoard}
          onDelete={
            boardModal === 'new'
              ? undefined
              : (moveTo) => handleDeleteBoard(boardModal, moveTo)
          }
          onClose={() => setBoardModal(null)}
        />
      )}

      {searchOpen && (
        <SearchModal
          boards={sortedBoards}
          cards={cards}
          onSelect={(c) => {
            setActiveBoardId(c.board_id || 'main');
            setEditingCardId(c.id);
          }}
          onClose={() => setSearchOpen(false)}
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
          className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-xs flex items-center justify-center p-6 cursor-zoom-out"
        >
          <img src={lightboxSrc} alt="" className="max-w-full max-h-[88vh] rounded-2xl shadow-2xl" />
        </div>
      )}

      {toast && (
        <div
          onClick={clearToast}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[75] px-3.5 py-1.5 rounded-full bg-[var(--foreground)] text-[var(--background)] text-xs font-medium shadow-lg cursor-pointer max-w-[90vw] text-center"
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
