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
import type {
  ActivityEditMeta,
  ActivityRecord,
  DraftSnapshot,
  GenerateStatus,
  RewriteTarget,
  SaveState,
  StudioTab
} from '@/lib/api-types';
import * as studioApi from '@/lib/studio-api';
import { SessionExpiredError } from '@/lib/studio-api';
import { applyBlockRewrite } from '@/lib/studio-blocks';
import { warningTokensOf } from '@/lib/studio-format';
import { PROGRESS_STEPS, STORAGE_KEY } from '@/lib/studio-config';
import { useActivityLibrary } from '@/hooks/useActivityLibrary';
import TopBar from './studio/TopBar';
import WorkspaceRail from './studio/WorkspaceRail';
import ActivityPanelHead from './studio/ActivityPanelHead';
import ActivityForm from './studio/ActivityForm';
import ActivityActions from './studio/ActivityActions';
import ConflictBox from './studio/ConflictBox';
import CopyResults from './studio/CopyResults';
import ScriptPlaceholder from './studio/ScriptPlaceholder';
import LibraryDrawer from './studio/LibraryDrawer';
import PosterPanel from './PosterPanel';

const EMPTY_SNAPSHOT = JSON.stringify({ activity: EMPTY_ACTIVITY, results: null, audience: null });

interface StudioProps {
  liveModel: boolean;
  paused: boolean;
  user: { id: string; name: string };
  exampleAvailable: boolean;
}

export default function Studio({ liveModel, paused, user, exampleAvailable }: StudioProps) {
  const [tab, setTab] = useState<StudioTab>('copy');
  const [activity, setActivity] = useState<ActivityInput>(EMPTY_ACTIVITY);
  const [results, setResults] = useState<GenerateResponse | null>(null);
  const [audience, setAudience] = useState<AudienceBlock | null>(null);
  const [warnings, setWarnings] = useState<FactWarning[]>([]);
  const [status, setStatus] = useState<GenerateStatus>('idle');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rewriting, setRewriting] = useState<RewriteTarget | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [template, setTemplate] = useState<PosterTemplate>('sky');
  const [showAiMark, setShowAiMark] = useState(true);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [meta, setMeta] = useState<ActivityEditMeta | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(EMPTY_SNAPSHOT);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<ActivityRecord | null>(null);
  const [exampleBusy, setExampleBusy] = useState(false);

  const snapshot = JSON.stringify({ activity, results, audience });
  const dirty = snapshot !== savedSnapshot;
  const warningTokens = warningTokensOf(warnings);

  const abortRef = useRef<AbortController | null>(null);
  const copiedTimer = useRef<number | null>(null);

  const library = useActivityLibrary({
    onOpen: (record) => {
      applyRecord(record);
      setStatus(record.results ? 'done' : 'idle');
      setNotice(`已打开「${record.title}」，最后编辑：${record.updatedByName}`);
    }
  });
  const refreshLibrary = library.refresh;

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
  }, [refreshLibrary]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

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
    library.closeDrawer();
  }

  async function saveActivity(
    overrides?: DraftSnapshot,
    options?: { silent?: boolean; versionOverride?: number }
  ) {
    if (saveState === 'saving') return;

    const snapshotToSave: DraftSnapshot = {
      activity: overrides?.activity ?? activity,
      results: overrides ? overrides.results : results,
      audience: overrides ? overrides.audience : audience
    };
    if (
      !snapshotToSave.activity.name.trim() &&
      !snapshotToSave.activity.notes.trim() &&
      !snapshotToSave.activity.highlights.trim()
    ) {
      if (!options?.silent) setError('请至少填写活动名称或一段资料，再保存到活动库。');
      return;
    }

    const isNew = !currentId;
    setSaveState('saving');
    setError('');
    try {
      const outcome = await studioApi.saveActivity({
        id: isNew ? null : currentId,
        version: options?.versionOverride ?? version,
        snapshot: snapshotToSave
      });

      if (outcome.status === 'conflict') {
        setConflict(outcome.activity);
        setSaveState('error');
        return;
      }

      const record = outcome.activity;
      setCurrentId(record.id);
      setVersion(record.version);
      setMeta({
        createdByName: record.createdByName,
        updatedByName: record.updatedByName,
        updatedAt: record.updatedAt
      });
      setSavedSnapshot(JSON.stringify(snapshotToSave));
      setSaveState('saved');
      if (!options?.silent) {
        setNotice(isNew ? '已保存到共享活动库，机构内成员都能打开继续编辑。' : '已保存最新版本。');
      }
      library.upsert(record);
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return;
      setSaveState('error');
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
    }
  }

  async function removeActivity(id: string, title: string) {
    const removed = await library.removeActivity(id, title);
    if (!removed || currentId !== id) return;
    setCurrentId(null);
    setVersion(0);
    setMeta(null);
    setSaveState('idle');
    setSavedSnapshot(snapshot);
    setNotice('活动已从活动库删除，页面上的内容仍保留，可另存为新活动。');
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

  async function fillExample() {
    if (exampleBusy) return;
    setExampleBusy(true);
    try {
      const example = await studioApi.fetchExample();
      setActivity({ ...EMPTY_ACTIVITY, ...example });
      setNotice('已填入示例资料（虚构内容），可直接点「生成内容」看效果。');
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return;
      setNotice(caught instanceof Error ? caught.message : '示例资料当前不可用');
    } finally {
      setExampleBusy(false);
    }
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
      const data = await studioApi.requestGeneration(activity, controller.signal);

      setResults(data);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setStep(PROGRESS_STEPS.length);
      setStatus('done');
      if (data.notice) setNotice(data.notice);
      void saveActivity({ activity, results: data, audience }, { silent: true });
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return;
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setStatus(results ? 'done' : 'idle');
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
      const data = await studioApi.requestAudience(activity);
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
      if (caught instanceof SessionExpiredError) return;
      setError(caught instanceof Error ? caught.message : '网络异常，请重试');
    } finally {
      setRewriting(null);
    }
  }

  async function rewrite(key: BlockKey, text: string, instruction: string) {
    if (rewriting) return;
    setRewriting(key);
    setError('');
    try {
      const data = await studioApi.requestRewrite(text, instruction);
      const next = applyBlockRewrite(results, audience, key, data.text);
      setResults(next.results);
      setAudience(next.audience);
      if (data.notice) setNotice(data.notice);
      void saveActivity({ activity, results: next.results, audience: next.audience }, { silent: true });
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return;
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
    await studioApi.logout();
    window.location.href = '/login';
  }

  const contextHint =
    tab === 'poster'
      ? '海报直接使用上方资料渲染，右侧可切换样式并下载 PNG。'
      : tab === 'script'
        ? '视频脚本是二期功能，当前版本先保证推文、笔记、话术与海报出图。'
        : '生成结果会出现在右侧，每一块都可以单独重写、复制。';

  return (
    <div className="app-shell">
      <TopBar
        liveModel={liveModel}
        userName={user.name}
        libraryCount={library.items.length}
        onOpenLibrary={library.openDrawer}
        onLogout={logout}
      />

      <div className="workspace">
        <WorkspaceRail tab={tab} onTabChange={setTab} />

        <section className="panel">
          <ActivityPanelHead
            activityName={activity.name}
            currentId={currentId}
            meta={meta}
            dirty={dirty}
            saveState={saveState}
            onSave={() => saveActivity()}
          />
          <div className="panel-body">
            {conflict ? (
              <ConflictBox conflict={conflict} onLoadLatest={loadConflictVersion} onOverwrite={forceOverwrite} />
            ) : null}

            {paused ? (
              <div className="notice warn">工作台已由管理员暂停使用，暂时无法生成。已填资料不受影响。</div>
            ) : null}

            <ActivityForm activity={activity} onChange={update} />

            <ActivityActions
              status={status}
              paused={paused}
              exampleAvailable={exampleAvailable}
              exampleBusy={exampleBusy}
              onGenerate={generate}
              onAbort={abort}
              onFillExample={fillExample}
              onImportFile={importTextFile}
              onClear={clearAll}
            />

            <div className="poster-meta" style={{ marginTop: 12 }}>
              {contextHint}
            </div>
          </div>
        </section>

        <section className="results">
          {tab === 'copy' ? (
            <CopyResults
              activity={activity}
              results={results}
              audience={audience}
              status={status}
              step={step}
              notice={notice}
              error={error}
              warningTokens={warningTokens}
              exampleAvailable={exampleAvailable}
              rewriting={rewriting}
              copied={copied}
              onGenerateAudience={generateAudience}
              onRewrite={rewrite}
              onCopy={copyText}
            />
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

          {tab === 'script' ? <ScriptPlaceholder /> : null}
        </section>
      </div>

      <LibraryDrawer
        open={library.open}
        items={library.items}
        currentId={currentId}
        busy={library.busy}
        error={library.error}
        onClose={library.closeDrawer}
        onNew={newActivity}
        onRefresh={() => void library.refresh()}
        onOpenActivity={(id) => void library.openActivity(id, currentId, dirty)}
        onRemove={(id, title) => void removeActivity(id, title)}
      />
    </div>
  );
}
