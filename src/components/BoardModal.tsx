import React, { useEffect, useState } from 'react';
import type { Row } from '../../shared/schema';

export function BoardModal({
  board,
  allBoards,
  cardCount,
  onSave,
  onDelete,
  onClose,
}: {
  board?: Row;
  allBoards: Row[];
  cardCount: number;
  onSave: (data: { title: string; sensitive: boolean }) => Promise<void>;
  onDelete?: (moveCardsToBoardId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !board;
  const [title, setTitle] = useState(board?.title || '');
  const [sensitive, setSensitive] = useState(board?.sensitive === 'TRUE');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const otherBoards = allBoards.filter((b) => b.id !== board?.id);
  const canDelete = !isNew && otherBoards.length > 0;
  const [moveTargetId, setMoveTargetId] = useState<string>(otherBoards[0]?.id || '__delete__');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await onSave({ title: trimmed, sensitive });
    onClose();
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[#0F1E30]/45 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white border border-[var(--hairline-strong)] rounded-[3px] shadow-[0_24px_56px_-18px_rgba(15,30,48,0.3)] overflow-hidden"
      >
        <div className="h-[2px] w-full bg-[#25548A]" />
        <div className="p-6 space-y-5">
          {!confirmingDelete ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2.5">
                <h3 className="nolan-label text-xs font-bold text-[#0F1E30]">
                  {isNew ? 'NEW BOARD · 新建画布' : 'BOARD · 画布设置'}
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="font-mono text-[11px] text-[var(--muted-foreground)] hover:text-[#0F1E30] cursor-pointer"
                >
                  ESC
                </button>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="board-title" className="block nolan-label text-[10px] font-semibold text-[var(--muted-foreground)]">
                  TITLE · 画布名称
                </label>
                <input
                  id="board-title"
                  type="text"
                  autoFocus
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：婚礼筹备、工作台、生活灵感"
                  className="w-full bg-[#ECF0F4]/50 border border-[var(--hairline-strong)] rounded-[2px] px-3.5 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#0F1E30]"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={sensitive}
                  onChange={(e) => setSensitive(e.target.checked)}
                />
                <span>整张画布设为敏感（公司电脑登录时隐藏且不下发）</span>
              </label>

              <div className="flex items-center justify-between pt-3 border-t border-[var(--hairline)]">
                {!isNew ? (
                  canDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="nolan-label text-[10px] font-semibold text-[#D94E28] hover:underline cursor-pointer"
                    >
                      DELETE
                    </button>
                  ) : (
                    <span className="text-[11px] text-[var(--muted-foreground)]">至少保留 1 张</span>
                  )
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="dunkirk-btn bg-white px-3.5 py-1.5 nolan-label text-[10px] font-semibold cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!title.trim()}
                    className="bg-[#0F1E30] hover:bg-[#D94E28] text-white px-4 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold transition disabled:opacity-40 cursor-pointer"
                  >
                    {isNew ? '创建' : '保存'}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-[#0F1E30]">确认删除画布「{board?.title}」？</h3>
                <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                  {cardCount > 0
                    ? `该画布内当前有 ${cardCount} 个模块，请选择这些模块的处理方式：`
                    : '该画布当前为空，删除后会自动切换到其他画布。'}
                </p>
              </div>

              {cardCount > 0 && (
                <select
                  value={moveTargetId}
                  onChange={(e) => setMoveTargetId(e.target.value)}
                  className="w-full bg-[#ECF0F4]/50 border border-[var(--hairline-strong)] rounded-[2px] px-3 py-2 text-xs"
                >
                  {otherBoards.map((b) => (
                    <option key={b.id} value={b.id}>
                      将 {cardCount} 个模块转移到「{b.title}」
                    </option>
                  ))}
                  <option value="__delete__">同时删除这 {cardCount} 个模块</option>
                </select>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="dunkirk-btn bg-white px-3.5 py-1.5 nolan-label text-[10px] font-semibold cursor-pointer"
                >
                  返回
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = cardCount > 0 && moveTargetId !== '__delete__' ? moveTargetId : null;
                    await onDelete?.(target);
                    onClose();
                  }}
                  className="bg-[#D94E28] text-white px-4 py-1.5 rounded-[2px] nolan-label text-[10px] font-semibold cursor-pointer"
                >
                  确认删除
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
