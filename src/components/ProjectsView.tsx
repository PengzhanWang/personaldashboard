import React, { useMemo, useState } from 'react';
import { AREAS, LABELS, PRIORITIES, PROJECT_KIND, PROJECT_STATUS, type Row } from '../../shared/schema';
import { useStore } from '../lib/store';
import { PriorityBadge } from './OverviewView';

export function ProjectsView({ onOpenTasks }: { onOpenTasks: (projectId: string) => void }) {
  const { projects, tasks, upsertRow, deleteRow } = useStore();
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);

  const openTaskCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (t.project_id && t.status !== 'done' && t.status !== 'cancelled') {
        m.set(t.project_id, (m.get(t.project_id) || 0) + 1);
      }
    }
    return m;
  }, [tasks]);

  const filtered = useMemo(() => {
    return projects
      .filter((p) => statusFilter === 'all' || (p.status || 'active') === statusFilter)
      .sort((a, b) => (a.priority || 'P2').localeCompare(b.priority || 'P2'));
  }, [projects, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl bg-slate-200/70 p-1 text-xs">
          {(['active', 'idea', 'paused', 'done', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                statusFilter === s ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {s === 'all' ? '全部' : LABELS[s]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setEditing('new')}
          className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 cursor-pointer"
        >
          + 新建项目
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          暂无项目
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900 truncate">{p.title}</h3>
                    {p.sensitive === 'TRUE' && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">敏感</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-slate-500">
                    {p.priority && <PriorityBadge p={p.priority} />}
                    <span className="px-1.5 py-0.5 rounded bg-slate-100">{LABELS[p.status] || p.status}</span>
                    {p.area && <span>{LABELS[p.area] || p.area}</span>}
                    {p.kind && <span>· {LABELS[p.kind] || p.kind}</span>}
                    {p.target_date && <span>· 目标 {p.target_date}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="text-xs text-slate-500 hover:text-slate-900 shrink-0 cursor-pointer"
                >
                  编辑
                </button>
              </div>

              {p.next_action && (
                <p className="text-sm text-slate-600 bg-slate-50 rounded-xl px-3 py-2">
                  <span className="text-slate-400">下一步：</span>
                  {p.next_action}
                </p>
              )}

              <div className="flex items-center justify-between pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTasks(p.id)}
                  className="text-sky-600 hover:text-sky-700 font-medium cursor-pointer"
                >
                  查看待办 ({openTaskCounts.get(p.id) || 0})
                </button>
                <div className="flex items-center gap-3">
                  {p.doc_url && (
                    <a href={p.doc_url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-sky-600">
                      Google Doc ↗
                    </a>
                  )}
                  {p.folder_url && (
                    <a href={p.folder_url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-sky-600">
                      Drive ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProjectModal
          project={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await upsertRow('Projects', patch, editing === 'new' ? undefined : editing);
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await deleteRow('Projects', editing);
                  setEditing(null);
                }
          }
        />
      )}
    </div>
  );
}

function ProjectModal({
  project,
  onClose,
  onSave,
  onDelete,
}: {
  project?: Row;
  onClose: () => void;
  onSave: (patch: Record<string, string>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: project?.title || '',
    area: project?.area || 'life',
    kind: project?.kind || 'stage',
    status: project?.status || 'active',
    priority: project?.priority || 'P1',
    target_date: project?.target_date || '',
    next_action: project?.next_action || '',
    doc_url: project?.doc_url || '',
    folder_url: project?.folder_url || '',
    sensitive: project?.sensitive || 'FALSE',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await onSave({ ...form, title: form.title.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3.5 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{project ? '编辑项目' : '新建项目'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm cursor-pointer">
            关闭
          </button>
        </div>

        <input
          type="text"
          required
          autoFocus
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="项目名称（如：婚礼筹备）"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        <input
          type="text"
          value={form.next_action}
          onChange={(e) => setForm({ ...form, next_action: e.target.value })}
          placeholder="下一步动作（总览页最常看）"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-xs text-slate-500">领域</span>
            <select
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
            >
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">类型</span>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
            >
              {PROJECT_KIND.map((k) => (
                <option key={k} value={k}>
                  {LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">状态</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
            >
              {PROJECT_STATUS.map((s) => (
                <option key={s} value={s}>
                  {LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">优先级</span>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-xs text-slate-500">目标日期</span>
          <input
            type="date"
            value={form.target_date}
            onChange={(e) => setForm({ ...form, target_date: e.target.value })}
            className="w-full rounded-xl border border-slate-300 px-2.5 py-2"
          />
        </label>

        <input
          type="url"
          value={form.doc_url}
          onChange={(e) => setForm({ ...form, doc_url: e.target.value })}
          placeholder="Google Doc 链接（可选）"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />

        <input
          type="url"
          value={form.folder_url}
          onChange={(e) => setForm({ ...form, folder_url: e.target.value })}
          placeholder="Google Drive 文件夹链接（可选）"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={form.sensitive === 'TRUE'}
            onChange={(e) => setForm({ ...form, sensitive: e.target.checked ? 'TRUE' : 'FALSE' })}
            className="h-4 w-4 rounded border-slate-300 text-sky-600"
          />
          标记为敏感（在公司电脑登录时隐藏且不下发）
        </label>

        <div className="flex items-center justify-between pt-2">
          {onDelete ? (
            <button type="button" onClick={() => void onDelete()} className="text-sm text-rose-600 cursor-pointer">
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 cursor-pointer"
            >
              保存
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
