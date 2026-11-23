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
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5"
      >
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-slate-900 font-semibold text-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
            LifeOS Dashboard
          </div>
          <p className="text-sm text-slate-500">输入访问密码进入个人看板</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            密码
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
        </div>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-slate-700">设备类型</span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['personal', '个人设备', '保持登录 30 天'],
                ['work', '公司电脑', '12 小时 · 隐藏敏感'],
              ] as const
            ).map(([val, title, sub]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDevice(val)}
                className={`text-left rounded-xl border p-2.5 transition ${
                  device === val
                    ? 'border-sky-500 bg-sky-50 text-sky-900'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
              </button>
            ))}
          </div>
        </div>

        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !password.trim()}
          className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer"
        >
          {submitting ? '正在验证…' : '登录'}
        </button>
      </form>
    </div>
  );
}
