'use client';

import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_ACTIVITY,
  type ActivityInput,
  type AudienceBlock,
  type BlockKey,
  type FactWarning,
  type GenerateResponse
} from '@/lib/types';
import type { PosterTemplate } from '@/lib/poster';
import PosterPanel from './PosterPanel';

const STORAGE_KEY = 'cgy.workbench.activity.v1';

type Tab = 'copy' | 'poster' | 'script';
type Status = 'idle' | 'loading' | 'done' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface ActivityMeta {
  id: string;
  title: string;
  version: number;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  hasResults: boolean;
}

interface ActivityRecord extends ActivityMeta {
  data: ActivityInput;
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
}

interface Snapshot {
  activity: ActivityInput;
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
}

const EMPTY_SNAPSHOT = JSON.stringify({ activity: EMPTY_ACTIVITY, results: null, audience: null });

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const INSTRUCTIONS = {
  rewrite: '重写这段内容，保持事实不变',
  casual: '改得更口语、更像日常说话',
  formal: '改得更正式、适合对外发布',
  shorten: '缩短到原文的一半左右'
} as const;

const PROGRESS_STEPS = ['整理活动资料、锁定事实字段', '撰写公众号推文与小红书笔记', '生成社群话术并做事实回查'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function Studio({
  liveModel,
  paused,
  user,
  exampleAvailable
}: {
  liveModel: boolean;
  paused: boolean;
  user: { id: string; name: string };
  exampleAvailable: boolean;
}) {
  const [tab, setTab] = useState<Tab>('copy');
  const [activity, setActivity] = useState<ActivityInput>(EMPTY_ACTIVITY);
  const [results, setResults] = useState<GenerateResponse | null>(null);
  const [audience, setAudience] = useState<AudienceBlock | null>(null);
  const [warnings, setWarnings] = useState<FactWarning[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rewriting, setRewriting] = useState<BlockKey | 'audience' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [template, setTemplate] = useState<PosterTemplate>('sky');
  const [showAiMark, setShowAiMark] = useState(true);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [meta, setMeta] = useState<{ createdByName: string; updatedByName: string; updatedAt: string } | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(EMPTY_SNAPSHOT);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<ActivityRecord | null>(null);
  const [library, setLibrary] = useState<ActivityMeta[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [exampleBusy, setExampleBusy] = useState(false);

  const snapshot = JSON.stringify({ activity, results, audience });
  const dirty = snapshot !== savedSnapshot;

  const abortRef = useRef<AbortController | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setActivity({ ...EMPTY_ACTIVITY, ...(JSON.parse(raw) as Partial<ActivityInput>) });
    } catch {
      /* 本地缓存不可用时忽略 */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activity));
    } catch {
      /* 忽略写入失败 */
    }
  }, [activity]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    void refreshLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function refreshLibrary() {
    setLibraryBusy(true);
    setLibraryError('');
    try {
      const response = await fetch('/api/activities', { cache: 'no-store' });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { items?: ActivityMeta[]; error?: string };
      if (!response.ok) throw new Error(data.error || '读取活动库失败');
      setLibrary(Array.isArray(data.items) ? data.items : []);
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : '读取活动库失败');
    } finally {
      setLibraryBusy(false);
    }
  }

  function applyRecord(record: ActivityRecord) {
    setActivity(record.data);
    setResults(record.results);
    setAudience(record.audience);
    setWarnings(record.results?.warnings ?? []);
    setCurrentId(record.id);
    setVersion(record.version);
    setMeta({
      createdByName: record.createdByName,
      updatedByName: record.updatedByName,
      updatedAt: record.updatedAt
    });
    setSavedSnapshot(
      JSON.stringify({ activity: record.data, results: record.results, audience: record.audience })
    );
    setConflict(null);
    setSaveState('saved');
    setError('');
  }

  async function openActivity(id: string) {
    if (dirty && id !== currentId && !window.confirm('当前页面有未保存的改动，打开其他活动会覆盖，确定继续？')) {
      return;
    }
    setLibraryBusy(true);
    setLibraryError('');
    try {
      const response = await fetch(`/api/activities/${id}`, { cache: 'no-store' });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { activity?: ActivityRecord; error?: string };
      if (!response.ok || !data.activity) throw new Error(data.error || '打开失败');
      applyRecord(data.activity);
      setStatus(data.activity.results ? 'done' : 'idle');
      setLibraryOpen(false);
      setNotice(`已打开「${data.activity.title}」，最后编辑：${data.activity.updatedByName}`);
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : '打开失败');
    } finally {
      setLibraryBusy(false);
    }
  }

  function newActivity() {
    if (dirty && !window.confirm('当前页面还有未保存的改动，确定新建空白活动？')) return;
    setActivity(EMPTY_ACTIVITY);
    setResults(null);
    setAudience(null);
    setWarnings([]);
    setStatus('idle');
    setCurrentId(null);
    setVersion(0);
    setMeta(null);
    setConflict(null);
    setSavedSnapshot(EMPTY_SNAPSHOT);
    setSaveState('idle');
    setError('');
    setNotice('已新建空白活动，填好后点「保存到活动库」。');
    setLibraryOpen(false);
  }

  async function saveActivity(
    overrides?: Snapshot,
    options?: { silent?: boolean; versionOverride?: number }
  ) {
    if (saveState === 'saving') return;

    const payload: Snapshot = {
      activity: overrides?.activity ?? activity,
      results: overrides ? overrides.results : results,
      audience: overrides ? overrides.audience : audience
    };
    if (!payload.activity.name.trim() && !payload.activity.notes.trim() && !payload.activity.highlights.trim()) {
      if (!options?.silent) setError('请至少填写活动名称或一段资料，再保存到活动库。');
      return;
    }

    const isNew = !currentId;
    setSaveState('saving');
    setError('');
    try {
      const response = await fetch(isNew ? '/api/activities' : `/api/activities/${currentId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isNew
            ? { data: payload.activity, results: payload.results, audience: payload.audience }
            : {
                version: options?.versionOverride ?? version,
                data: payload.activity,
                results: payload.results,
                audience: payload.audience
              }
        )
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = (await response.json().catch(() => ({}))) as {
        activity?: ActivityRecord;
        error?: string;
        conflict?: boolean;
      };

      if (response.status === 409) {
        setConflict(data.activity ?? null);
        setSaveState('error');
        return;
      }
      if (!response.ok || !data.activity) throw new Error(data.error || '保存失败，请重试');

      const record = data.activity;
      setCurrentId(record.id);
      setVersion(record.version);
      setMeta({
        createdByName: record.createdByName,
        updatedByName: record.updatedByName,
        updatedAt: record.updatedAt
      });
      setSavedSnapshot(JSON.stringify(payload));
      setSaveState('saved');
      if (!options?.silent) {
        setNotice(isNew ? '已保存到共享活动库，机构内成员都能打开继续编辑。' : '已保存最新版本。');
      }
      setLibrary((prev) => {
        const next = prev.filter((item) => item.id !== record.id);
        return [
          {
            id: record.id,
            title: record.title,
            version: record.version,
            createdByName: record.createdByName,
            updatedByName: record.updatedByName,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            hasResults: Boolean(record.results)
          },
          ...next
        ];
      });
    } catch (caught) {
      setSaveState('error');
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
    }
  }

  async function removeActivity(id: string, title: string) {
    if (!window.confirm(`删除活动「${title}」？机构内所有人都将看不到它，且无法恢复。`)) return;
    try {
      const response = await fetch(`/api/activities/${id}`, { method: 'DELETE' });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || '删除失败');
      setLibrary((prev) => prev.filter((item) => item.id !== id));
      if (currentId === id) {
        setCurrentId(null);
        setVersion(0);
        setMeta(null);
        setSaveState('idle');
        setSavedSnapshot(snapshot);
        setNotice('活动已从活动库删除，页面上的内容仍保留，可另存为新活动。');
      }
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : '删除失败');
    }
  }

  function loadConflictVersion() {
    if (!conflict) return;
    applyRecord(conflict);
    setStatus(conflict.results ? 'done' : 'idle');
    setNotice(`已载入「${conflict.title}」的最新版本（${conflict.updatedByName} 编辑）。`);
  }

  function forceOverwrite() {
    if (!conflict) return;
    const targetVersion = conflict.version;
    setConflict(null);
    void saveActivity(undefined, { versionOverride: targetVersion });
  }

  function update<K extends keyof ActivityInput>(key: K, value: ActivityInput[K]) {
    setActivity((prev) => ({ ...prev, [key]: value }));
  }

  function fillExample() {
    if (exampleBusy) return;
    setExampleBusy(true);
    fetch('/api/example', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data = (await response.json().catch(() => ({}))) as {
          activity?: Partial<ActivityInput>;
          error?: string;
        };
        if (!response.ok || !data.activity) throw new Error(data.error || '示例资料当前不可用');
        setActivity({ ...EMPTY_ACTIVITY, ...data.activity });
        setNotice('已填入示例资料（虚构内容），可直接点「生成内容」看效果。');
      })
      .catch((caught: unknown) => {
        setNotice(caught instanceof Error ? caught.message : '示例资料当前不可用');
      })
      .finally(() => setExampleBusy(false));
  }

  function clearAll() {
    const message = currentId
      ? '清除页面上的全部输入与生成结果？活动库中已保存的版本不会被删除，清除后可另存为新活动。'
      : '清除本次全部输入与生成结果？此操作不可撤销。';
    if (!window.confirm(message)) return;
    setActivity(EMPTY_ACTIVITY);
    setResults(null);
    setAudience(null);
    setWarnings([]);
    setStatus('idle');
    setError('');
    setCurrentId(null);
    setVersion(0);
    setMeta(null);
    setConflict(null);
    setSaveState('idle');
    setSavedSnapshot(EMPTY_SNAPSHOT);
    setNotice('已清除页面上的内容，活动库中的历史记录不受影响。');
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
  }

  async function importTextFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setNotice('文件超过 1 MB，请只导入活动方案文本。');
      return;
    }
    try {
      const text = (await file.text()).trim();
      if (!text) {
        setNotice('文件内容为空。');
        return;
      }
      const clipped = text.slice(0, 4000);
      setActivity((prev) => ({
        ...prev,
        notes: prev.notes ? `${prev.notes}\n\n${clipped}`.slice(0, 4000) : clipped
      }));
      setNotice(
        text.length > 4000
          ? `已导入「${file.name}」前 4000 字，超出部分请手动补充。文件不会上传到服务器。`
          : `已导入「${file.name}」，文件只在本页读取，不会上传到服务器。`
      );
    } catch {
      setNotice('读取文件失败，请改用粘贴文本。');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function generate() {
    if (status === 'loading') return;
    if (!activity.name.trim() && !activity.notes.trim() && !activity.highlights.trim()) {
      setError('请至少填写活动名称，或粘贴一段活动资料。');
      setStatus('error');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setStep(0);
    setError('');
    setNotice('');

    const timer = window.setInterval(() => {
      setStep((prev) => Math.min(prev + 1, PROGRESS_STEPS.length - 1));
    }, 1600);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity }),
        signal: controller.signal
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = (await response.json().catch(() => ({}))) as GenerateResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || '生成失败，请重试');

      setResults(data);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setStep(PROGRESS_STEPS.length);
      setStatus('done');
      if (data.notice) setNotice(data.notice);
      void saveActivity({ activity, results: data, audience }, { silent: true });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setStatus((prev) => (results ? 'done' : 'idle'));
        setNotice('已中止本次生成，已填资料保留。');
      } else {
        setStatus('error');
        setError(caught instanceof Error ? caught.message : '网络异常，请重试');
      }
    } finally {
      window.clearInterval(timer);
      abortRef.current = null;
    }
  }

  function abort() {
    abortRef.current?.abort();
  }

  async function generateAudience() {
    if (rewriting === 'audience') return;
    setRewriting('audience');
    setError('');
    try {
      const response = await fetch('/api/audience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity })
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        audience?: AudienceBlock;
        warnings?: FactWarning[];
        notice?: string;
        error?: string;
      };
      if (!response.ok || !data.audience) throw new Error(data.error || '生成失败，请重试');
      setAudience(data.audience);
      if (Array.isArray(data.warnings)) {
        setWarnings((prev) => {
          const seen = new Set(prev.map((item) => item.token));
          return [...prev, ...data.warnings!.filter((item) => !seen.has(item.token))];
        });
      }
      if (data.notice) setNotice(data.notice);
      void saveActivity({ activity, results, audience: data.audience }, { silent: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '网络异常，请重试');
    } finally {
      setRewriting(null);
    }
  }

  function applyRewrite(key: BlockKey, text: string): Snapshot {
    let nextResults = results;
    if (results) {
      if (key === 'article') nextResults = { ...results, article: { ...results.article, body: text } };
      else if (key === 'note') nextResults = { ...results, note: { ...results.note, body: text } };
      else if (key === 'social.moments') nextResults = { ...results, social: { ...results.social, moments: text } };
      else if (key === 'social.group') nextResults = { ...results, social: { ...results.social, group: text } };
    }

    let nextAudience = audience;
    if (audience) {
      if (key === 'audience.student') nextAudience = { ...audience, student: text };
      else if (key === 'audience.public') nextAudience = { ...audience, public: text };
      else if (key === 'audience.press') nextAudience = { ...audience, press: text };
    }

    setResults(nextResults);
    setAudience(nextAudience);
    return { activity, results: nextResults, audience: nextAudience };
  }

  async function rewrite(key: BlockKey, text: string, instruction: string) {
    if (rewriting) return;
    setRewriting(key);
    setError('');
    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, instruction })
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
        notice?: string;
      };
      if (!response.ok || !data.text) throw new Error(data.error || '修改失败，请重试');
      const next = applyRewrite(key, data.text);
      if (data.notice) setNotice(data.notice);
      void saveActivity(next, { silent: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '网络异常，请重试');
    } finally {
      setRewriting(null);
    }
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(key);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 1600);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  function renderText(text: string) {
    const tokens = Array.from(new Set(warnings.map((item) => item.token))).filter(Boolean);
    if (!tokens.length) return text;
    const pattern = new RegExp(`(${tokens.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})`, 'g');
    return text.split(pattern).map((part, index) =>
      tokens.includes(part) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
    );
  }

  function renderActions(key: BlockKey, text: string, copyPayload = text) {
    const busy = rewriting === key;
    return (
      <div className="actions">
        <button className="action-btn" disabled={!!rewriting} onClick={() => rewrite(key, text, INSTRUCTIONS.rewrite)}>
          {busy ? '修改中…' : '重写'}
        </button>
        <button className="action-btn" disabled={!!rewriting} onClick={() => rewrite(key, text, INSTRUCTIONS.casual)}>
          更口语
        </button>
        <button className="action-btn" disabled={!!rewriting} onClick={() => rewrite(key, text, INSTRUCTIONS.formal)}>
          更正式
        </button>
        <button className="action-btn" disabled={!!rewriting} onClick={() => rewrite(key, text, INSTRUCTIONS.shorten)}>
          缩短
        </button>
        <button className="action-btn" onClick={() => copyText(key, copyPayload)}>
          {copied === key ? '已复制' : '复制'}
        </button>
      </div>
    );
  }

  const warningTokens = Array.from(new Set(warnings.map((item) => item.token)));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brandmark" aria-hidden="true" />
        <div>
          <div className="brand-name">C公益 · 内容工作台</div>
          <div className="brand-sub">CONTENT WORKBENCH · 内部使用</div>
        </div>
        <div className="spacer" />
        <div className="topbar-meta">
          <span className="chip">
            <span className="chip-dot" />
            内部使用，不对外
          </span>
          <span className={`chip ${liveModel ? 'chip-live' : 'chip-demo'}`}>
            <span className="chip-dot" />
            {liveModel ? '已接入模型' : '演示模式'}
          </span>
          <span className="chip chip-always">
            <span className="chip-dot" />
            AI 生成，发布前需人工核对
          </span>
          <button
            className="link-btn"
            type="button"
            onClick={() => {
              setLibraryOpen(true);
              void refreshLibrary();
            }}
          >
            共享活动库{library.length > 0 ? `（${library.length}）` : ''}
          </button>
          <a className="link-btn" href="/help" target="_blank" rel="noreferrer">
            使用说明
          </a>
          <span className="chip chip-user" title="当前登录账号">
            {user.name}
          </span>
          <button className="link-btn" type="button" onClick={logout}>
            退出
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail">
          <div className="rail-title">工作区</div>
          <button
            type="button"
            className={`rail-btn${tab === 'copy' ? ' active' : ''}`}
            onClick={() => setTab('copy')}
          >
            <span className="rail-icon">文</span>
            <span>
              <span className="rail-label">文案</span>
              <br />
              <span className="rail-desc">推文 / 笔记 / 话术</span>
            </span>
          </button>
          <button
            type="button"
            className={`rail-btn${tab === 'poster' ? ' active' : ''}`}
            onClick={() => setTab('poster')}
          >
            <span className="rail-icon">图</span>
            <span>
              <span className="rail-label">海报</span>
              <br />
              <span className="rail-desc">3:4 封面出图</span>
            </span>
          </button>
          <button
            type="button"
            className={`rail-btn${tab === 'script' ? ' active' : ''}`}
            onClick={() => setTab('script')}
          >
            <span className="rail-icon">影</span>
            <span>
              <span className="rail-label">脚本</span>
              <br />
              <span className="rail-desc">1 分钟视频脚本</span>
            </span>
          </button>

          <div className="rail-note">
            <strong>一次输入，多平台产出</strong>
            资料只在本页使用，生成后请人工核对时间、地点、报名方式再发布。
          </div>
        </aside>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-row">
              <div>
                <h2>活动资料</h2>
                <p>缺项也能生成，缺的字段会显示为「待补充」。</p>
              </div>
              <div className="panel-head-actions">
                <span
                  className={`save-state${dirty ? ' dirty' : ''}${saveState === 'error' ? ' error' : ''}`}
                >
                  {saveState === 'saving'
                    ? '保存中…'
                    : saveState === 'error'
                      ? '保存失败'
                      : dirty
                        ? '有未保存改动'
                        : currentId
                          ? '已同步到活动库'
                          : '未保存'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => saveActivity()}
                  disabled={saveState === 'saving'}
                >
                  {currentId ? '保存' : '保存到活动库'}
                </button>
              </div>
            </div>
            <div className="meta-line">
              {currentId && meta
                ? `当前：${activity.name || '未命名活动'} · 最后编辑 ${meta.updatedByName} · ${formatTime(meta.updatedAt)}`
                : '生成后会先自动保存到共享活动库，机构内成员都能打开继续编辑。'}
            </div>
          </div>
          <div className="panel-body">
            {conflict ? (
              <div className="conflict-box">
                <strong>这条活动已被 {conflict.updatedByName} 更新</strong>
                <p>
                  服务器上是 {formatTime(conflict.updatedAt)} 的版本，你的改动还没有保存。可以载入最新版本，或用自己的版本覆盖。
                </p>
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost btn-small" onClick={loadConflictVersion}>
                    载入最新版本
                  </button>
                  <button type="button" className="btn btn-primary btn-small" onClick={forceOverwrite}>
                    用我的版本覆盖
                  </button>
                </div>
              </div>
            ) : null}

            {paused ? (
              <div className="notice warn">工作台已由管理员暂停使用，暂时无法生成。已填资料不受影响。</div>
            ) : null}

            <div className="form-section">
              <h3>基本信息</h3>
              <div className="field">
                <label htmlFor="name">
                  活动名称 <span className="required">必填</span>
                </label>
                <input
                  id="name"
                  value={activity.name}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="例：游拾计划·秋日城市漫游"
                  maxLength={200}
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="project">项目线</label>
                  <select
                    id="project"
                    value={activity.project}
                    onChange={(event) => update('project', event.target.value)}
                  >
                    <option>游拾计划</option>
                    <option>一日职业体验</option>
                    <option>青桥计划</option>
                    <option>其他</option>
                  </select>
                </div>
                <div className="field">
                  <label>内容类型</label>
                  <div className="segmented">
                    <button
                      type="button"
                      className={activity.postType === 'recruit' ? 'active' : ''}
                      onClick={() => update('postType', 'recruit')}
                    >
                      招募
                    </button>
                    <button
                      type="button"
                      className={activity.postType === 'review' ? 'active' : ''}
                      onClick={() => update('postType', 'review')}
                    >
                      回顾
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>事实字段</h3>
              <div className="field">
                <label htmlFor="date">时间</label>
                <input
                  id="date"
                  value={activity.date}
                  onChange={(event) => update('date', event.target.value)}
                  placeholder="例：2026年11月28日（周六）14:00–17:30"
                  maxLength={200}
                />
              </div>
              <div className="field">
                <label htmlFor="location">地点</label>
                <input
                  id="location"
                  value={activity.location}
                  onChange={(event) => update('location', event.target.value)}
                  placeholder="例：银川市金凤区阅海公园东门集合"
                  maxLength={300}
                />
              </div>
              <div className="field">
                <label htmlFor="audience">对象</label>
                <input
                  id="audience"
                  value={activity.audience}
                  onChange={(event) => update('audience', event.target.value)}
                  placeholder="例：在银川的高校学生与青年志愿者，共 30 人"
                  maxLength={300}
                />
              </div>
              <div className="field">
                <label htmlFor="signup">报名方式</label>
                <input
                  id="signup"
                  value={activity.signup}
                  onChange={(event) => update('signup', event.target.value)}
                  placeholder="例：扫描海报二维码填写报名表，11月25日截止"
                  maxLength={400}
                />
              </div>
            </div>

            <div className="form-section">
              <h3>内容素材</h3>
              <div className="field">
                <label htmlFor="highlights">亮点 / 现场细节</label>
                <textarea
                  id="highlights"
                  value={activity.highlights}
                  onChange={(event) => update('highlights', event.target.value)}
                  placeholder="活动做什么、现场发生了什么、有什么值得说的细节"
                  maxLength={3000}
                />
              </div>
              <div className="field">
                <label htmlFor="notes">补充说明（可选）</label>
                <textarea
                  id="notes"
                  value={activity.notes}
                  onChange={(event) => update('notes', event.target.value)}
                  placeholder="注意事项、交通提示、是否需要自备物品等"
                  maxLength={4000}
                />
              </div>
            </div>

            <div className="form-section">
              <h3>输出设置</h3>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="tone">语气</label>
                  <select id="tone" value={activity.tone} onChange={(event) => update('tone', event.target.value)}>
                    <option>温暖克制</option>
                    <option>轻松口语</option>
                    <option>正式书面</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="organizer">主办方</label>
                  <input
                    id="organizer"
                    value={activity.organizer}
                    onChange={(event) => update('organizer', event.target.value)}
                    maxLength={200}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="sensitive">需脱敏词（逗号分隔，可选）</label>
                <input
                  id="sensitive"
                  value={activity.sensitive}
                  onChange={(event) => update('sensitive', event.target.value)}
                  placeholder="例：张三、某某大学"
                  maxLength={500}
                />
                <span className="hint">
                  姓名、学校、电话会在进入模型前替换为占位符；成稿中的〔姓名〕请人工填回。
                </span>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={generate}
                disabled={status === 'loading' || paused}
              >
                {status === 'loading' ? (
                  <>
                    <span className="spinner" />
                    生成中…
                  </>
                ) : (
                  '生成内容'
                )}
              </button>
              {status === 'loading' ? (
                <button type="button" className="btn btn-ghost" onClick={abort}>
                  中止
                </button>
              ) : null}
            </div>

            <div className="form-actions" style={{ marginTop: 8 }}>
              {exampleAvailable ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={fillExample}
                  disabled={exampleBusy}
                >
                  {exampleBusy ? '载入中…' : '载入示例资料'}
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => fileInputRef.current?.click()}>
                导入方案文本
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={clearAll}>
                清除全部
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                hidden
                onChange={(event) => importTextFile(event.target.files?.[0])}
              />
            </div>

            <div className="poster-meta" style={{ marginTop: 12 }}>
              {tab === 'poster'
                ? '海报直接使用上方资料渲染，右侧可切换样式并下载 PNG。'
                : tab === 'script'
                  ? '视频脚本是二期功能，当前版本先保证推文、笔记、话术与海报出图。'
                  : '生成结果会出现在右侧，每一块都可以单独重写、复制。'}
            </div>
          </div>
        </section>

        <section className="results">
          {tab === 'copy' ? (
            <>
              {status === 'loading' ? (
                <div className="panel">
                  <div className="panel-body">
                    <div className="progress">
                      {PROGRESS_STEPS.map((label, index) => (
                        <div
                          key={label}
                          className={`progress-step${index < step ? ' done' : index === step ? ' active' : ''}`}
                        >
                          <span className="dot">{index < step ? '✓' : ''}</span>
                          {label}
                        </div>
                      ))}
                    </div>
                    <div className="poster-meta">通常需要 10–30 秒。生成过程可随时中止。</div>
                  </div>
                </div>
              ) : null}

              {notice ? <div className="notice">{notice}</div> : null}
              {error ? <div className="notice warn">{error}</div> : null}
              {warningTokens.length > 0 ? (
                <div className="warning-box">
                  <strong>事实回查：以下内容未在资料中找到，请逐项核对后再发布</strong>
                  <div className="warning-list">
                    {warningTokens.map((token) => (
                      <code key={token}>{token}</code>
                    ))}
                  </div>
                </div>
              ) : null}

              {!results && status !== 'loading' ? (
                <div className="panel">
                  <div className="empty-state">
                    <div className="empty-icon">文</div>
                    <h3>右侧会放生成结果</h3>
                    <p>
                      填好左侧资料，点「生成内容」，这里会出现公众号推文、小红书笔记和社群话术。
                      {exampleAvailable ? (
                        <>
                          <br />
                          第一次用可以点「载入示例资料」直接看效果。
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
              ) : null}

              {results ? (
                <>
                  <div className="panel">
                    <div className="result-head">
                      <h2>生成结果</h2>
                      <span className="count">{results.mode === 'demo' ? '演示模式模板稿' : '模型生成草稿'}</span>
                      <div className="spacer" />
                      <span className="chip">AI 生成，发布前需人工核对</span>
                    </div>
                    <div className="panel-body">
                      <div className="poster-meta">
                        已按「{activity.postType === 'recruit' ? '招募' : '回顾'}」生成。所有结果都是草稿，时间、地点、报名方式请对照原文逐项确认。
                      </div>
                    </div>
                  </div>

                  <article className="result-card">
                    <div className="result-card-head">
                      <h3>公众号推文</h3>
                      <span className={`tag ${activity.postType === 'recruit' ? 'tag-accent' : ''}`}>
                        {activity.postType === 'recruit' ? '招募' : '回顾'}
                      </span>
                      <div className="spacer" />
                      {renderActions(
                        'article',
                        results.article.body,
                        `${results.article.title}\n\n${results.article.body}`
                      )}
                    </div>
                    <div className="result-body">
                      <h4>{results.article.title}</h4>
                      {renderText(results.article.body)}
                    </div>
                  </article>

                  <article className="result-card">
                    <div className="result-card-head">
                      <h3>小红书笔记</h3>
                      <span className="tag">标题 + 正文 + 标签</span>
                      <div className="spacer" />
                      {renderActions(
                        'note',
                        results.note.body,
                        `${results.note.title}\n\n${results.note.body}\n\n${results.note.tags.join(' ')}`
                      )}
                    </div>
                    <div className="result-body">
                      <h4>{results.note.title}</h4>
                      {renderText(results.note.body)}
                    </div>
                    {results.note.tags.length > 0 ? (
                      <div className="result-tags">
                        {results.note.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </article>

                  <article className="result-card">
                    <div className="result-card-head">
                      <h3>社群与朋友圈话术</h3>
                      <span className="tag">短文案</span>
                    </div>
                    <div className="sub-block">
                      <div className="sub-block-head">
                        <h4>朋友圈版</h4>
                        <div className="spacer" />
                        {renderActions('social.moments', results.social.moments)}
                      </div>
                      <div className="sub-block-body">{renderText(results.social.moments)}</div>
                    </div>
                    <div className="sub-block">
                      <div className="sub-block-head">
                        <h4>社群版</h4>
                        <div className="spacer" />
                        {renderActions('social.group', results.social.group)}
                      </div>
                      <div className="sub-block-body">{renderText(results.social.group)}</div>
                    </div>
                  </article>

                  <article className="result-card">
                    <div className="result-card-head">
                      <h3>受众改写三版</h3>
                      <span className="tag">学生 / 公众 / 新闻稿</span>
                      <div className="spacer" />
                      {!audience ? (
                        <button
                          type="button"
                          className="action-btn"
                          onClick={generateAudience}
                          disabled={rewriting === 'audience'}
                        >
                          {rewriting === 'audience' ? '生成中…' : '生成三版'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="action-btn"
                          onClick={generateAudience}
                          disabled={rewriting === 'audience'}
                        >
                          重新生成
                        </button>
                      )}
                    </div>
                    {!audience ? (
                      <div className="empty-state" style={{ padding: '24px 20px' }}>
                        <p>同一份资料，分别改写成学生版、公众版和新闻稿版，避免三处重复劳动。</p>
                      </div>
                    ) : (
                      <>
                        <div className="sub-block">
                          <div className="sub-block-head">
                            <h4>学生版</h4>
                            <div className="spacer" />
                            {renderActions('audience.student', audience.student)}
                          </div>
                          <div className="sub-block-body">{renderText(audience.student)}</div>
                        </div>
                        <div className="sub-block">
                          <div className="sub-block-head">
                            <h4>公众版</h4>
                            <div className="spacer" />
                            {renderActions('audience.public', audience.public)}
                          </div>
                          <div className="sub-block-body">{renderText(audience.public)}</div>
                        </div>
                        <div className="sub-block">
                          <div className="sub-block-head">
                            <h4>新闻稿版</h4>
                            <div className="spacer" />
                            {renderActions('audience.press', audience.press)}
                          </div>
                          <div className="sub-block-body">{renderText(audience.press)}</div>
                        </div>
                      </>
                    )}
                  </article>
                </>
              ) : null}
            </>
          ) : null}

          {tab === 'poster' ? (
            <PosterPanel
              activity={activity}
              template={template}
              onTemplateChange={setTemplate}
              showAiMark={showAiMark}
              onShowAiMarkChange={setShowAiMark}
            />
          ) : null}

          {tab === 'script' ? (
            <div className="panel">
              <div className="soon">
                <span className="soon-tag">二期功能</span>
                <h3>1 分钟视频脚本</h3>
                <p>
                  用小红书或视频号发布活动回顾时，可以直接复用同一份活动资料，生成分镜、时长、画面提示与字幕。
                  当前版本先保证文案与海报跑通，脚本留到二期。
                </p>
                <ul>
                  <li>分镜表：镜号 / 时长 / 画面 / 字幕</li>
                  <li>自动匹配已有活动照片与视频素材</li>
                  <li>导出为可交给剪辑志愿者的清单</li>
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {libraryOpen ? (
        <div className="drawer-overlay" role="presentation" onClick={() => setLibraryOpen(false)}>
          <aside className="drawer" role="dialog" aria-label="共享活动库" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <h2>共享活动库</h2>
                <p>机构内所有成员都能查看、继续编辑和删除</p>
              </div>
              <button className="link-btn" type="button" onClick={() => setLibraryOpen(false)}>
                关闭
              </button>
            </div>

            <div className="drawer-actions">
              <button className="btn btn-primary btn-small" type="button" onClick={newActivity}>
                新建活动
              </button>
              <button
                className="btn btn-ghost btn-small"
                type="button"
                onClick={() => refreshLibrary()}
                disabled={libraryBusy}
              >
                {libraryBusy ? '读取中…' : '刷新'}
              </button>
            </div>

            {libraryError ? <div className="notice warn">{libraryError}</div> : null}

            <div className="drawer-list">
              {!libraryBusy && library.length === 0 ? (
                <p className="drawer-empty">活动库还是空的。填好左侧资料后点「保存到活动库」，这里就会出现。</p>
              ) : null}
              {library.map((item) => (
                <div key={item.id} className={`drawer-item${item.id === currentId ? ' active' : ''}`}>
                  <button className="drawer-item-main" type="button" onClick={() => openActivity(item.id)}>
                    <span className="drawer-item-title">{item.title}</span>
                    <span className="drawer-item-meta">
                      {item.updatedByName} 编辑 · {formatTime(item.updatedAt)}
                      {item.hasResults ? ' · 已有成稿' : ' · 仅资料'}
                    </span>
                  </button>
                  <button
                    className="drawer-item-del"
                    type="button"
                    onClick={() => removeActivity(item.id, item.title)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>

            <div className="drawer-foot">
              同一活动多人先后编辑时，后保存的人会看到版本冲突提示，可选择载入对方版本或覆盖。
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
