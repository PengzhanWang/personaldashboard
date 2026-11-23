import { LABELS, type Row } from '../../shared/schema';
import { useStore } from '../lib/store';

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function OverviewView({
  onSelectProject,
  onEditTask,
  onOpenQuickAdd,
}: {
  onSelectProject: (projectId: string) => void;
  onEditTask: (task: Row) => void;
  onOpenQuickAdd: () => void;
}) {
  const { projects, tasks, upsertRow } = useStore();
  const today = todayStr();

  const activeProjects = projects
    .filter((p) => (p.status || 'active') === 'active')
    .sort((a, b) => (a.priority || 'P2').localeCompare(b.priority || 'P2'));

  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const overdueTasks = openTasks.filter((t) => t.due_date && t.due_date < today);
  const todayTasks = openTasks.filter((t) => t.due_date === today);
  const inboxTasks = openTasks.filter((t) => t.status === 'inbox');
  const focusTasks = [...overdueTasks, ...todayTasks].sort((a, b) =>
    (a.due_date || '9999').localeCompare(b.due_date || '9999'),
  );

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const openCountByProject = new Map<string, number>();
  for (const t of openTasks) {
    if (t.project_id) openCountByProject.set(t.project_id, (openCountByProject.get(t.project_id) || 0) + 1);
  }

  async function toggleDone(task: Row) {
    const nextDone = task.status !== 'done';
    await upsertRow(
      'Tasks',
      { status: nextDone ? 'done' : 'todo', completed_at: nextDone ? new Date().toISOString() : '' },
      task,
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="进行中项目" value={activeProjects.length} tone="sky" />
        <StatCard label="今日到期" value={todayTasks.length} tone="emerald" />
        <StatCard label="已逾期" value={overdueTasks.length} tone={overdueTasks.length ? 'rose' : 'slate'} />
        <StatCard label="收集箱" value={inboxTasks.length} tone="amber" />
      </div>

      {/* Today & Overdue */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">今日与逾期待办</h2>
          <button
            type="button"
            onClick={onOpenQuickAdd}
            className="text-xs font-medium text-sky-600 hover:text-sky-700 cursor-pointer"
          >
            + 快速新增
          </button>
        </div>

        {focusTasks.length === 0 ? (
          <div className="text-sm text-slate-400 py-6 text-center">
            今天没有到期或逾期的待办，保持节奏！
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {focusTasks.map((t) => {
              const proj = t.project_id ? projectMap.get(t.project_id) : undefined;
              const isOverdue = Boolean(t.due_date && t.due_date < today);
              return (
                <li key={t.id} className="py-2.5 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    onChange={() => void toggleDone(t)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEditTask(t)}>
                    <div className="text-sm font-medium text-slate-900 truncate">{t.title}</div>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-500">
                      {t.priority && <PriorityBadge p={t.priority} />}
                      {t.due_date && (
                        <span className={isOverdue ? 'text-rose-600 font-medium' : 'text-emerald-700'}>
                          {isOverdue ? `逾期 · ${t.due_date}` : `今天`}
                        </span>
                      )}
                      {proj && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{proj.title}</span>}
                      {t.context && <span>@{LABELS[t.context] || t.context}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Active Projects */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">进行中的项目</h2>
          <span className="text-xs text-slate-400">{activeProjects.length} 个</span>
        </div>

        {activeProjects.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            还没有进行中的项目，切到「项目」页新建一个吧。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeProjects.map((p) => {
              const count = openCountByProject.get(p.id) || 0;
              return (
                <div
                  key={p.id}
                  onClick={() => onSelectProject(p.id)}
                  className="bg-white rounded-2xl border border-slate-200 p-4 hover:border-sky-300 transition cursor-pointer flex flex-col justify-between gap-2"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-slate-900 truncate">{p.title}</h3>
                      {p.priority && <PriorityBadge p={p.priority} />}
                    </div>
                    {p.next_action ? (
                      <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                        <span className="text-slate-400">下一步：</span>
                        {p.next_action}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1">未填写下一步动作</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      {p.area && <span className="px-1.5 py-0.5 rounded bg-slate-100">{LABELS[p.area] || p.area}</span>}
                      <span>{count} 条未完成</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.target_date && <span>目标 {p.target_date}</span>}
                      {p.doc_url && (
                        <a
                          href={p.doc_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-sky-600 hover:underline"
                        >
                          文档
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'sky' | 'emerald' | 'rose' | 'amber' | 'slate' }) {
  const colors = {
    sky: 'text-sky-700 bg-sky-50 border-sky-100',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    rose: 'text-rose-700 bg-rose-50 border-rose-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    slate: 'text-slate-700 bg-white border-slate-200',
  }[tone];
  return (
    <div className={`rounded-2xl border p-3.5 ${colors}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

export function PriorityBadge({ p }: { p: string }) {
  const cls =
    p === 'P0'
      ? 'bg-rose-100 text-rose-700'
      : p === 'P1'
        ? 'bg-amber-100 text-amber-800'
        : p === 'P2'
          ? 'bg-sky-100 text-sky-700'
          : 'bg-slate-100 text-slate-600';
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${cls}`}>{p}</span>;
}
