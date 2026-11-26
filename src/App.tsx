import { useEffect, useMemo, useState } from 'react';
import { detectLinkKind, parseCardLayout, type CardFinish, type Row } from '../shared/schema';
import { BentoCanvas } from './components/BentoCanvas';
import { BoardModal } from './components/BoardModal';
import { BottomDock } from './components/BottomDock';
import { CardModal, type CardDraft } from './components/CardModal';
import { LoginView } from './components/LoginView';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { SearchModal } from './components/SearchModal';
import { StoreProvider, useStore } from './lib/store';
import { ulid } from './lib/ulid';

function formatDateLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function formatSyncLabel(syncState: string, pendingCount: number, lastSyncedAt: number | null): string {
  if (syncState === 'error' && pendingCount > 0) return `${pendingCount} ERR`;
  if (pendingCount > 0) return `${pendingCount} PENDING`;
  if (syncState === 'syncing') return 'SYNCING';
  if (syncState === 'offline') return 'OFFLINE';
  if (syncState === 'error') return 'ERROR';
  if (!lastSyncedAt) return 'READY';
  const sec = Math.max(0, Math.floor((Date.now() - lastSyncedAt) / 1000));
  if (sec < 15) return 'SYNCED';
  if (sec < 60) return `${sec}S`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}M`;
  return new Date(lastSyncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function CanvasShell() {
  const {
    authState,
    device,
    backendKind,
    boards,
    cards,
    items,
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
  const [workspaceCardId, setWorkspaceCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<CardDraft | null>(null);
  const [boardModal, setBoardModal] = useState<'new' | Row | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState<Row | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [blurred, setBlurred] = useState(false);
  const [dockUploading, setDockUploading] = useState(false);
  const [, setClockTick] = useState(0);

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

  const workspaceCard = useMemo(
    () => (workspaceCardId ? cards.find((c) => c.id === workspaceCardId) || null : null),
    [cards, workspaceCardId],
  );

  if (authState === 'checking') {
    return (
      <div className="min-h-screen canvas-dunkirk flex items-center justify-center nolan-display text-[11px] text-[var(--muted-foreground)]">
        LOADING LIFEOS…
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
    const ops: { table: 'Boards' | 'Cards' | 'Items'; op: 'upsert' | 'delete'; row: Row; patch?: Record<string, string> }[] = [];

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
      const affectedCardIds = new Set(affected.map((c) => c.id));
      for (const c of affected) {
        ops.push({ table: 'Cards', op: 'delete', row: c });
      }
      for (const it of items) {
        if (affectedCardIds.has(it.card_id)) {
          ops.push({ table: 'Items', op: 'delete', row: it });
        }
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
    const draftLayout = patch.layout_json ? parseCardLayout(patch.layout_json) : null;
    await upsertRow('Cards', {
      ...patch,
      layout_json: JSON.stringify({
        x: 0,
        y: nextFreeY(targetBoard),
        w: 4,
        h: 2,
        ...(draftLayout?.masked ? { masked: true } : {}),
      }),
      board_id: targetBoard,
    });
    showToast('模块已创建');
  }

  async function handleSaveExistingCard(card: Row, patch: Record<string, string>) {
    const nextPatch = { ...patch };
    const prevBoard = card.board_id || 'main';
    const nextBoard = patch.board_id || prevBoard;
    if (nextBoard !== prevBoard) {
      const curLayout = parseCardLayout(patch.layout_json || card.layout_json);
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
      layout_json: JSON.stringify({ ...layout, y: nextFreeY(targetBoard) }),
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
        tag: 'IMAGE',
        title,
        finish: 'mist',
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
      kind === 'gsheet' ? 'GSHEET' : kind === 'gdoc' ? 'GDOC' : kind === 'gdrive' ? 'GDRIVE' : 'LINK';
    const label = title || (kind === 'gsheet' ? '表格' : kind === 'gdoc' ? '文档' : '快捷链接');
    await upsertRow('Cards', {
      board_id: bId,
      tag,
      title: label,
      finish: 'sage',
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
      ? 'bg-[#D94E28]'
      : pendingCount > 0 || syncState === 'offline'
        ? 'bg-amber-500'
        : syncState === 'syncing'
          ? 'bg-[#25548A] animate-pulse'
          : 'bg-[#2A7A68]';

  const modalBoardCardCount =
    boardModal && boardModal !== 'new'
      ? cards.filter((c) => (c.board_id || 'main') === boardModal.id).length
      : 0;

  return (
    <div className="min-h-screen canvas-dunkirk">
      {/* Dunkirk Editorial Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--hairline)] bg-[#ECF0F4]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="w-2.5 h-2.5 bg-[#D94E28] inline-block shrink-0" />
              <span className="nolan-display text-xs font-bold text-[#0F1E30]">LIFEOS</span>
              <span className="hidden lg:inline font-mono text-[11px] text-[var(--muted-foreground)]">· {formatDateLabel()}</span>
            </div>

            {/* Editorial Board Tabs */}
            <nav className="flex items-center gap-1.5 overflow-x-auto">
              {sortedBoards.map((b) => {
                const isActive = activeBoardId === b.id;
                return (
                  <div
                    key={b.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setBoardModal(b);
                    }}
                    className={`inline-flex items-center rounded-[2px] border text-[11px] font-semibold transition shrink-0 ${
                      isActive
                        ? 'bg-[#0F1E30] border-[#0F1E30] text-white'
                        : 'bg-white/80 border-[var(--hairline)] text-[#0F1E30] hover:border-[var(--hairline-strong)] hover:bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveBoardId(b.id)}
                      title="右键或点击右侧齿轮管理画布"
                      className={`py-1 nolan-title cursor-pointer ${isActive ? 'pl-2.5 pr-1.5' : 'px-2.5'}`}
                    >
                      {b.title}
                    </button>
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => setBoardModal(b)}
                        title="画布设置（重命名 / 敏感 / 删除）"
                        className="pr-2 pl-0.5 py-1 opacity-70 hover:opacity-100 cursor-pointer"
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
                className="w-7 h-7 rounded-[2px] border border-dashed border-[var(--hairline-strong)] bg-white/60 hover:bg-[#0F1E30] hover:border-[#0F1E30] hover:text-white font-mono text-xs font-semibold flex items-center justify-center cursor-pointer shrink-0 transition"
              >
                +
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {device === 'work' && (
              <span className="px-2 py-1 rounded-[2px] border border-[#D94E28]/40 bg-[#D94E28]/10 text-[#D94E28] nolan-label text-[10px] font-bold">
                WORK
              </span>
            )}
            {backendKind === 'mock' && (
              <span className="hidden sm:inline px-2 py-1 rounded-[2px] border border-[var(--hairline)] nolan-label text-[10px] text-[var(--muted-foreground)]">
                MOCK
              </span>
            )}

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="搜索所有模块 (Ctrl+K)"
              className="dunkirk-btn bg-white/80 hover:bg-white p-1.5 text-[#0F1E30] cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>

            <div className="hidden md:inline-flex items-center rounded-[2px] border border-[var(--hairline-strong)] bg-white/80 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('desktop')}
                title="12 列桌面拼图"
                className={`p-1.5 cursor-pointer transition ${
                  viewMode === 'desktop' ? 'bg-[#0F1E30] text-white' : 'text-[var(--muted-foreground)] hover:text-[#0F1E30]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="2" y="3" width="20" height="14" rx="1" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('mobile')}
                title="2 列手机预览"
                className={`p-1.5 cursor-pointer border-l border-[var(--hairline)] transition ${
                  viewMode === 'mobile' ? 'bg-[#0F1E30] text-white' : 'text-[var(--muted-foreground)] hover:text-[#0F1E30]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="5" y="2" width="14" height="20" rx="1" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void refresh(true)}
              title="双向同步：推送本地改动到 Google Sheets，并拉取表格最新数据"
              className="dunkirk-btn bg-white/85 hover:bg-white hover:border-[#D94E28] px-2.5 py-1 nolan-label text-[10px] font-semibold text-[#0F1E30] flex items-center gap-1.5 cursor-pointer"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${syncDot}`} />
              <span className="hidden sm:inline">{formatSyncLabel(syncState, pendingCount, lastSyncedAt)}</span>
            </button>

            <button
              type="button"
              onClick={() => setBlurred((v) => !v)}
              title="一键遮挡 (Alt+B)"
              className="dunkirk-btn bg-white/85 hover:bg-white px-2.5 py-1 nolan-label text-[10px] font-semibold text-[#0F1E30] cursor-pointer"
            >
              {blurred ? '恢复' : '遮挡'}
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[#D94E28] transition cursor-pointer"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* Main Canvas */}
      <main className={`max-w-6xl mx-auto px-4 sm:px-5 pt-6 pb-32 transition ${blurred ? 'blur-lg select-none pointer-events-none' : ''}`}>
        <BentoCanvas
          cards={boardCards}
          boards={sortedBoards}
          items={items}
          viewMode={viewMode}
          onOpenWorkspace={(c) => {
            setCreatingDraft(null);
            setEditingCardId(null);
            setWorkspaceCardId(c.id);
          }}
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
          onNotify={showToast}
        />
      </main>

      <BottomDock
        uploading={dockUploading}
        onAddChecklist={() => openNewDraft('LIST', 'default', '- [ ] ')}
        onAddNote={() => openNewDraft('NOTE', 'warm', '')}
        onUploadImageCard={(f) => void handleUploadImageCard(f)}
        onAddLinkCard={(t, u) => void handleAddLinkCard(t, u)}
      />

      {workspaceCard && (
        <ProjectWorkspace
          card={workspaceCard}
          viewMode={viewMode}
          onClose={() => setWorkspaceCardId(null)}
          onOpenCardSettings={(c) => {
            setCreatingDraft(null);
            setEditingCardId(c.id);
          }}
          onOpenLightbox={setLightboxSrc}
        />
      )}

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
            setWorkspaceCardId(c.id);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {confirmDeleteCard && (
        <div
          onClick={() => setConfirmDeleteCard(null)}
          className="fixed inset-0 z-[60] bg-[#0F1E30]/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-white border border-[var(--hairline-strong)] rounded-[3px] shadow-[0_24px_56px_-18px_rgba(15,30,48,0.3)] p-6 space-y-4"
          >
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-[#0F1E30]">确认删除这个模块？</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                将删除「<span className="text-[#0F1E30] font-semibold">{confirmDeleteCard.title || '未命名模块'}</span>」，删除后可在 Google 表格的 <code className="font-mono">Cards</code> 表中将 <code className="font-mono">deleted</code> 改回 <code className="font-mono">FALSE</code> 找回。
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteCard(null)}
                className="dunkirk-btn bg-white px-3.5 py-1.5 nolan-label text-[10px] font-semibold cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = confirmDeleteCard;
                  setConfirmDeleteCard(null);
                  if (editingCardId === target.id) setEditingCardId(null);
                  if (workspaceCardId === target.id) setWorkspaceCardId(null);
                  const childItems = items.filter((it) => it.card_id === target.id);
                  if (childItems.length > 0) {
                    void mutateBatch([
                      { table: 'Cards', op: 'delete', row: target },
                      ...childItems.map((it) => ({ table: 'Items' as const, op: 'delete' as const, row: it })),
                    ]);
                  } else {
                    void deleteRow('Cards', target);
                  }
                  showToast('模块已删除');
                }}
                className="bg-[#D94E28] text-white px-4 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer"
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
          className="fixed inset-0 z-[70] bg-[#0F1E30]/85 backdrop-blur-xs flex items-center justify-center p-6 cursor-zoom-out"
        >
          <img src={lightboxSrc} alt="" className="max-w-full max-h-[88vh] rounded-[3px] border border-white/25 shadow-2xl" />
        </div>
      )}

      {toast && (
        <div
          onClick={clearToast}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[75] px-4 py-1.5 bg-[#0F1E30] text-white border border-[#D94E28]/60 rounded-[2px] shadow-lg nolan-label text-[10px] font-semibold cursor-pointer max-w-[90vw] text-center"
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
