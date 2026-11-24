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
    <div className="min-h-screen canvas-dunkirk flex items-center justify-center p-5">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-[var(--hairline-strong)] rounded-[3px] shadow-[0_20px_50px_-20px_rgba(15,30,48,0.22)] overflow-hidden"
      >
        <div className="h-[3px] w-full flex">
          <span className="flex-1 bg-[#0F1E30]" />
          <span className="w-16 bg-[#25548A]" />
          <span className="w-10 bg-[#D94E28]" />
        </div>

        <div className="p-7 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 bg-[#D94E28] inline-block shrink-0" />
              <span className="nolan-display text-xs font-bold text-[#0F1E30]">L I F E O S</span>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">输入访问密码进入个人拼图画布</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block nolan-label text-[10px] font-semibold text-[var(--muted-foreground)]">
              ACCESS KEY
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#ECF0F4]/60 border border-[var(--hairline-strong)] rounded-[2px] px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:bg-white focus:border-[#0F1E30] transition"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block nolan-label text-[10px] font-semibold text-[var(--muted-foreground)]">DEVICE MODE</span>
            <div className="grid grid-cols-2 gap-2.5">
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
                  className={`text-left border rounded-[2px] p-3 transition cursor-pointer ${
                    device === val
                      ? 'bg-[#0F1E30] border-[#0F1E30] text-white'
                      : 'bg-white border-[var(--hairline-strong)] text-[#0F1E30] hover:border-[#0F1E30]'
                  }`}
                >
                  <div className="text-xs font-semibold">{title}</div>
                  <div className={`text-[11px] mt-0.5 ${device === val ? 'text-white/70' : 'text-[var(--muted-foreground)]'}`}>
                    {sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs text-white bg-[#D94E28] rounded-[2px] px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting || !password.trim()}
            className="w-full bg-[#0F1E30] hover:bg-[#D94E28] text-white py-2.5 rounded-[2px] nolan-display text-[11px] font-semibold transition disabled:opacity-40 cursor-pointer"
          >
            {submitting ? 'VERIFYING…' : 'ENTER CANVAS →'}
          </button>
        </div>
      </form>
    </div>
  );
}
