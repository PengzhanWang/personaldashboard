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
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#F4F1EA] border-2 border-[#161616] shadow-[8px_8px_0_#161616] p-6 space-y-5"
      >
        {!confirmingDelete ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between border-b-[1.5px] border-[#161616] pb-2.5">
              <h3 className="text-sm font-bold tracking-wider uppercase">{isNew ? '新建画布 / NEW BOARD' : '画布设置 / BOARD'}</h3>
              <button
                type="button"
                onClick={onClose}
                className="font-mono text-xs text-[var(--muted-foreground)] hover:text-[#161616] cursor-pointer"
              >
                [ESC]
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="board-title" className="block text-xs font-mono text-[var(--muted-foreground)]">
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
                className="w-full bg-white border-[1.5px] border-[#161616] px-3.5 py-2 text-sm focus:outline-none"
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

            <div className="flex items-center justify-between pt-3 border-t border-[#161616]/20">
              {!isNew ? (
                canDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="font-mono text-xs text-rose-600 underline cursor-pointer"
                  >
                    DELETE
                  </button>
                ) : (
                  <span className="text-[11px] font-mono text-[var(--muted-foreground)]">至少保留 1 张</span>
                )
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="bauhaus-btn bg-white px-3.5 py-1.5 text-xs font-mono cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="bauhaus-btn bg-[#161616] text-white px-4 py-1.5 text-xs font-mono font-bold disabled:opacity-40 cursor-pointer"
                >
                  {isNew ? '创建' : '保存'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold">确认删除画布「{board?.title}」？</h3>
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
                className="w-full bg-white border-[1.5px] border-[#161616] px-3 py-2 text-xs"
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
                className="bauhaus-btn bg-white px-3.5 py-1.5 text-xs font-mono cursor-pointer"
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
                className="bauhaus-btn bg-rose-600 text-white px-4 py-1.5 text-xs font-mono font-bold cursor-pointer"
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
