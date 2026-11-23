import React, { useState } from 'react';
import { CONTEXTS, LABELS, PRIORITIES } from '../../shared/schema';
import { useStore } from '../lib/store';

export function QuickAddModal({ onClose }: { onClose: () => void }) {
  const { projects, upsertRow } = useStore();
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('P2');
  const [context, setContext] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await upsertRow('Tasks', {
      title: title.trim(),
      project_id: projectId,
      due_date: dueDate,
      priority,
      context,
      status: dueDate || projectId ? 'todo' : 'inbox',
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3.5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">快速记一笔</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm cursor-pointer">
            关闭
          </button>
        </div>

        <input
          type="text"
          autoFocus
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="要做什么？（回车直接保存）"
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-xl border border-slate-200 px-2.5 py-2 bg-white"
          >
            <option value="">无项目（进收集箱）</option>
            {projects
              .filter((p) => p.status !== 'done' && p.status !== 'archived')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-xl border border-slate-200 px-2.5 py-2"
          />

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="rounded-xl border border-slate-200 px-2.5 py-2 bg-white"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                优先级 {p}
              </option>
            ))}
          </select>

          <select
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="rounded-xl border border-slate-200 px-2.5 py-2 bg-white"
          >
            <option value="">场景：无</option>
            {CONTEXTS.filter(Boolean).map((c) => (
              <option key={c} value={c}>
                @{LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={!title.trim()}
          className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
        >
          保存待办
        </button>
      </form>
    </div>
  );
}
