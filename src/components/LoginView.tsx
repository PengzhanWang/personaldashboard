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
    <div className="min-h-screen canvas-bauhaus flex items-center justify-center p-5">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border-[1.5px] border-[#161616] shadow-[8px_8px_0_#161616] overflow-hidden"
      >
        <div className="h-2.5 w-full grid grid-cols-4">
          <span className="bg-[#283D92]" />
          <span className="bg-[#6C4D6D]" />
          <span className="bg-[#DFB0AF]" />
          <span className="bg-[#02CA0E]" />
        </div>

        <div className="p-7 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center">
                <span className="w-4 h-4 rounded-full bg-[#283D92] inline-block" />
                <span className="w-4 h-4 bg-[#6C4D6D] inline-block -ml-1" />
                <span className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[15px] border-b-[#02CA0E] inline-block -ml-1" />
              </div>
              <span className="font-bold text-sm tracking-widest uppercase">BAUHAUS · LIFEOS</span>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] font-mono">输入访问密码进入个人拼图画布</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-xs font-mono uppercase tracking-wider text-[var(--muted-foreground)]">
              PASSWORD
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#F4F1EA] border-[1.5px] border-[#161616] px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:bg-white transition"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-mono uppercase tracking-wider text-[var(--muted-foreground)]">DEVICE</span>
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
                  className={`text-left border-[1.5px] border-[#161616] p-3 transition cursor-pointer ${
                    device === val
                      ? 'bg-[#161616] text-white shadow-[3px_3px_0_#283D92]'
                      : 'bg-white text-[#161616] hover:bg-[#F4F1EA]'
                  }`}
                >
                  <div className="text-xs font-bold">{title}</div>
                  <div className={`text-[11px] mt-0.5 ${device === val ? 'text-white/75' : 'text-[var(--muted-foreground)]'}`}>
                    {sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs font-mono text-white bg-rose-600 border border-[#161616] px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting || !password.trim()}
            className="w-full bauhaus-btn bg-[#283D92] text-white py-2.5 text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-40 cursor-pointer"
          >
            {submitting ? 'VERIFYING…' : 'ENTER CANVAS →'}
          </button>
        </div>
      </form>
    </div>
  );
}
