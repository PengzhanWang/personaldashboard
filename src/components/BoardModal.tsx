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
  /** Undefined when creating a new board. */
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
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--card)] border border-[var(--border)] rounded-[24px] shadow-2xl p-6 space-y-5"
      >
        {!confirmingDelete ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">{isNew ? '新建画布' : '画布设置'}</h3>
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              >
                关闭
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="board-title" className="block text-xs text-[var(--muted-foreground)]">
                画布名称
              </label>
              <input
                id="board-title"
                type="text"
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：婚礼筹备、工作台、生活灵感"
                className="w-full rounded-2xl bg-[var(--background)] border border-[var(--border)] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[var(--foreground)] transition"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] cursor-pointer">
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
                className="rounded"
              />
              <span>整张画布设为敏感（公司电脑登录时隐藏且不下发）</span>
            </label>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
              {!isNew ? (
                canDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="text-xs text-rose-500 hover:underline cursor-pointer"
                  >
                    删除画布
                  </button>
                ) : (
                  <span className="text-[11px] text-[var(--muted-foreground)]">至少保留 1 张画布</span>
                )
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-full border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="px-4 py-1.5 rounded-full bg-[var(--foreground)] text-[var(--background)] text-xs font-medium hover:opacity-90 disabled:opacity-40 cursor-pointer"
                >
                  {isNew ? '创建' : '保存'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold tracking-tight">确认删除画布「{board?.title}」？</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                {cardCount > 0
                  ? `该画布内当前有 ${cardCount} 个模块，请选择这些模块的处理方式：`
                  : '该画布当前为空，删除后会自动切换到其他画布。'}
              </p>
            </div>

            {cardCount > 0 && (
              <div className="space-y-2 text-xs">
                <select
                  value={moveTargetId}
                  onChange={(e) => setMoveTargetId(e.target.value)}
                  className="w-full rounded-xl bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-[var(--foreground)]"
                >
                  {otherBoards.map((b) => (
                    <option key={b.id} value={b.id}>
                      将 {cardCount} 个模块转移到「{b.title}」
                    </option>
                  ))}
                  <option value="__delete__">同时删除这 {cardCount} 个模块</option>
                </select>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="px-3.5 py-1.5 rounded-full border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
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
                className="px-4 py-1.5 rounded-full bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 cursor-pointer"
              >
                确认删除
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
