'use client';

import { useState, type FormEvent } from 'react';

export default function LoginForm({ hint }: { hint: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error || '登录失败，请重试');
        setPending(false);
        return;
      }
      window.location.href = '/activities';
    } catch {
      setError('网络异常，请重试');
      setPending(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="brandmark" aria-hidden="true" />
          <div>
            <div className="brand-name">C公益 · 攒劲青年</div>
            <div className="brand-sub">CONTENT WORKBENCH</div>
          </div>
        </div>

        <h1>团队内容工作台</h1>
        <p className="sub">机构内部账号登录。所有成员共享同一个活动库，不开放注册。</p>

        <label htmlFor="username">用户名</label>
        <input
          id="username"
          className="login-input"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="请输入用户名"
          autoFocus
        />

        <label htmlFor="password" style={{ marginTop: 14 }}>
          密码
        </label>
        <input
          id="password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="请输入密码"
        />

        {error ? <p className="login-error">{error}</p> : null}

        <button className="login-submit" type="submit" disabled={pending || !username.trim() || !password}>
          {pending ? '验证中…' : '进入工作台'}
        </button>

        <p className="login-hint">{hint}</p>

        <div className="login-foot">
          本工具仅向 C公益 内部工作人员开放，不对外提供生成服务。
          <br />
          登录一次可保持 30 天，公共电脑使用后请点右上角「退出」。
        </div>
      </form>
    </main>
  );
}
