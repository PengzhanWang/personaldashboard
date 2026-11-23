import React, { useState } from 'react';
import { useStore } from '../lib/store';
import type { DeviceMode } from '../lib/storage';

export function LoginView() {
  const { login } = useStore();
  const [password, setPassword] = useState('');
  const [device, setDevice] = useState<DeviceMode>('personal');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(password, device);
    } catch (err) {
      setError((err as Error).message || '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen canvas-dots flex items-center justify-center p-5">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-[var(--card)] rounded-[24px] border border-[var(--border)] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.08)] p-7 space-y-6"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center text-xs font-semibold">
              L
            </div>
            <span className="font-semibold text-base tracking-tight">LifeOS</span>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">输入密码进入你的个人拼图画布</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-xs font-medium text-[var(--muted-foreground)]">
            访问密码
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-2xl bg-[var(--background)] border border-[var(--border)] px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--foreground)] transition"
          />
        </div>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-[var(--muted-foreground)]">当前设备</span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['personal', '个人设备', '30 天免登录'],
                ['work', '公司电脑', '12 小时 · 隐藏敏感'],
              ] as const
            ).map(([val, title, sub]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDevice(val)}
                className={`text-left rounded-2xl border p-3 transition cursor-pointer ${
                  device === val
                    ? 'border-[var(--foreground)] bg-[var(--background)]'
                    : 'border-[var(--border)] opacity-70 hover:opacity-100'
                }`}
              >
                <div className="text-xs font-semibold">{title}</div>
                <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{sub}</div>
              </button>
            ))}
          </div>
        </div>

        {error && <div className="text-xs text-rose-600 bg-rose-50 rounded-xl px-3.5 py-2.5">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !password.trim()}
          className="w-full rounded-full bg-[var(--foreground)] text-[var(--background)] py-2.5 text-xs font-medium hover:opacity-90 disabled:opacity-40 transition cursor-pointer"
        >
          {submitting ? '验证中…' : '进入画布'}
        </button>
      </form>
    </div>
  );
}
