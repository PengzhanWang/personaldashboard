import React, { useMemo, useState } from 'react';
import { CONTEXTS, LABELS, PRIORITIES, TASK_STATUS, type Row } from '../../shared/schema';
import { useStore } from '../lib/store';
import { PriorityBadge } from './OverviewView';

export function TasksView({
  initialProjectId,
  editingTask,
  onEditTask,
  onCloseEdit,
}: {
  initialProjectId: string;
  editingTask: Row | null;
  onEditTask: (task: Row) => void;
  onCloseEdit: () => void;
}) {
  const { tasks, projects, upsertRow, deleteRow } = useStore();
  const [statusFilter, setStatusFilter] = useState<'open' | 'inbox' | 'done' | 'all'>('open');
  const [projectFilter, setProjectFilter] = useState<string>(initialProjectId);
  const [contextFilter, setContextFilter] = useState<string>('');
  const [query, setQuery] = useState('');

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (statusFilter === 'open' && (t.status === 'done' || t.status === 'cancelled')) return false;
        if (statusFilter === 'inbox' && t.status !== 'inbox') return false;
        if (statusFilter === 'done' && t.status !== 'done') return false;
        if (projectFilter && t.project_id !== projectFilter) return false;
        if (contextFilter && t.context !== contextFilter) return false;
        if (q && !`${t.title} ${t.notes}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const dueA = a.due_date || '9999-99-99';
        const dueB = b.due_date || '9999-99-99';
        if (dueA !== dueB) return dueA.localeCompare(dueB);
        return (a.priority || 'P2').localeCompare(b.priority || 'P2');
      });
  }, [tasks, statusFilter, projectFilter, contextFilter, query]);

  async function toggleDone(task: Row) {
    const nextDone = task.status !== 'done';
    await upsertRow(
      'Tasks',
      { status: nextDone ? 'done' : 'todo', completed_at: nextDone ? new Date().toISOString() : '' },
      task,
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs">
          {(
            [
              ['open', '未完成'],
              ['inbox', '收集箱'],
              ['done', '已完成'],
              ['all', '全部'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setStatusFilter(val)}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                statusFilter === val ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="text-xs rounded-xl border border-slate-200 px-2.5 py-1.5 bg-white"
        >
          <option value="">所有项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        <select
          value={contextFilter}
          onChange={(e) => setContextFilter(e.target.value)}
          className="text-xs rounded-xl border border-slate-200 px-2.5 py-1.5 bg-white"
        >
          <option value="">所有场景</option>
          {CONTEXTS.filter(Boolean).map((c) => (
            <option key={c} value={c}>
              @{LABELS[c] || c}
            </option>
          ))}
        </select>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索待办…"
          className="flex-1 min-w-[140px] text-xs rounded-xl border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      {/* Task list */}
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">没有符合条件的待办</div>
        ) : (
          filtered.map((t) => {
            const proj = t.project_id ? projectMap.get(t.project_id) : undefined;
            const isDone = t.status === 'done';
            return (
              <div key={t.id} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50/70">
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => void toggleDone(t)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 cursor-pointer"
                />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEditTask(t)}>
                  <div className={`text-sm font-medium ${isDone ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                    {t.title}
                  </div>
                  {t.notes && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{t.notes}</p>}
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
                    {t.priority && <PriorityBadge p={t.priority} />}
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {LABELS[t.status] || t.status}
                    </span>
                    {t.due_date && <span>截止 {t.due_date}</span>}
                    {proj && <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{proj.title}</span>}
                    {t.context && <span>@{LABELS[t.context] || t.context}</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {editingTask && (
        <TaskEditModal
          task={editingTask}
          projects={projects}
          onClose={onCloseEdit}
          onSave={async (patch) => {
            await upsertRow('Tasks', patch, editingTask);
            onCloseEdit();
          }}
          onDelete={async () => {
            await deleteRow('Tasks', editingTask);
            onCloseEdit();
          }}
        />
      )}
    </div>
  );
}

function TaskEditModal({
  task,
  projects,
  onClose,
  onSave,
  onDelete,
}: {
  task: Row;
  projects: Row[];
  onClose: () => void;
  onSave: (patch: Record<string, string>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: task.title || '',
    notes: task.notes || '',
    project_id: task.project_id || '',
    status: task.status || 'todo',
    priority: task.priority || 'P2',
    due_date: task.due_date || '',
    context: task.context || '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const patch: Record<string, string> = { ...form, title: form.title.trim() };
    if (form.status === 'done' && task.status !== 'done') patch.completed_at = new Date().toISOString();
    await onSave(patch);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">编辑待办</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm cursor-pointer">
            关闭
          </button>
        </div>

        <input
          type="text"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="待办标题"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="简短备注（长内容放 Google Docs）"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-xs text-slate-500">状态</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
            >
              {TASK_STATUS.map((s) => (
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
          <label className="space-y-1">
            <span className="text-xs text-slate-500">截止日期</span>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-2.5 py-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">场景</span>
            <select
              value={form.context}
              onChange={(e) => setForm({ ...form, context: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
            >
              {CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {LABELS[c] || c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-xs text-slate-500">所属项目</span>
          <select
            value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            className="w-full rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="">无（独立日常待办）</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => void onDelete()}
            className="text-sm text-rose-600 hover:text-rose-700 cursor-pointer"
          >
            删除
          </button>
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
