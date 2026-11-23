import { useEffect, useState } from 'react';
import type { Row } from '../shared/schema';
import { LoginView } from './components/LoginView';
import { OverviewView } from './components/OverviewView';
import { ProjectsView } from './components/ProjectsView';
import { QuickAddModal } from './components/QuickAddModal';
import { TasksView } from './components/TasksView';
import { StoreProvider, useStore } from './lib/store';

type Tab = 'overview' | 'tasks' | 'projects';

function formatSyncTime(ts: number | null): string {
  if (!ts) return '未同步';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 10) return '刚刚同步';
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function DashboardShell() {
  const { authState, device, backendKind, syncState, lastSyncedAt, pendingCount, toast, refresh, logout, clearToast } =
    useStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [taskProjectFilter, setTaskProjectFilter] = useState('');
  const [editingTask, setEditingTask] = useState<Row | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [blurred, setBlurred] = useState(false);

  // Keyboard shortcuts: Alt+B privacy blur ("boss key"), Alt+N quick add
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setBlurred((v) => !v);
      } else if (e.altKey && e.key.toLowerCase() === 'n' && authState === 'authed') {
        e.preventDefault();
        setQuickAddOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authState]);

  if (authState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">
        正在加载 LifeOS…
      </div>
    );
  }

  if (authState === 'unauthed') {
    return <LoginView />;
  }

  const syncLabel =
    pendingCount > 0
      ? `${pendingCount} 条待同步`
      : syncState === 'syncing'
        ? '同步中…'
        : syncState === 'offline'
          ? '离线模式'
          : syncState === 'error'
            ? '同步异常'
            : formatSyncTime(lastSyncedAt);

  const syncDot =
    pendingCount > 0 || syncState === 'offline'
      ? 'bg-amber-400'
      : syncState === 'syncing'
        ? 'bg-sky-400 animate-pulse'
        : syncState === 'error'
          ? 'bg-rose-500'
          : 'bg-emerald-500';

  return (
    <div className="min-h-screen pb-24 sm:pb-10">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              LifeOS
            </span>
            {device === 'work' && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-medium">
                公司模式
              </span>
            )}
            {backendKind === 'mock' && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px]">
                本地 Mock
              </span>
            )}
            <nav className="hidden sm:flex items-center gap-1 ml-2">
              {(
                [
                  ['overview', '总览'],
                  ['tasks', '待办'],
                  ['projects', '项目'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (id === 'tasks') setTaskProjectFilter('');
                    setTab(id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                    tab === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => void refresh(true)}
              title="强制从数据源刷新"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <span className={`w-2 h-2 rounded-full ${syncDot}`} />
              <span>{syncLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => setBlurred((v) => !v)}
              title="一键遮挡 (Alt+B)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              {blurred ? '恢复' : '遮挡'}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-rose-600 cursor-pointer"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`max-w-5xl mx-auto px-4 py-5 transition ${blurred ? 'blur-lg select-none pointer-events-none' : ''}`}>
        {tab === 'overview' && (
          <OverviewView
            onSelectProject={(projectId) => {
              setTaskProjectFilter(projectId);
              setTab('tasks');
            }}
            onEditTask={(task) => {
              setEditingTask(task);
              setTab('tasks');
            }}
            onOpenQuickAdd={() => setQuickAddOpen(true)}
          />
        )}
        {tab === 'tasks' && (
          <TasksView
            initialProjectId={taskProjectFilter}
            editingTask={editingTask}
            onEditTask={setEditingTask}
            onCloseEdit={() => setEditingTask(null)}
          />
        )}
        {tab === 'projects' && (
          <ProjectsView
            onOpenTasks={(projectId) => {
              setTaskProjectFilter(projectId);
              setTab('tasks');
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 grid grid-cols-3 h-14 text-xs">
        {(
          [
            ['overview', '总览'],
            ['tasks', '待办'],
            ['projects', '项目'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id === 'tasks') setTaskProjectFilter('');
              setTab(id);
            }}
            className={`font-medium ${tab === id ? 'text-sky-600' : 'text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Floating Quick-Add Button */}
      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label="快速新增待办"
        title="快速新增待办 (Alt+N)"
        className="fixed right-5 bottom-20 sm:bottom-6 z-40 h-13 w-13 rounded-full bg-slate-900 text-white text-2xl shadow-lg hover:bg-slate-800 active:scale-95 transition flex items-center justify-center cursor-pointer"
      >
        +
      </button>

      {quickAddOpen && <QuickAddModal onClose={() => setQuickAddOpen(false)} />}

      {/* Toast */}
      {toast && (
        <div
          onClick={clearToast}
          className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-full shadow-lg cursor-pointer"
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
      <DashboardShell />
    </StoreProvider>
  );
}
