'use client';

import { useCallback, useState } from 'react';
import type { ActivityMeta, ActivityRecord } from '@/lib/api-types';
import * as studioApi from '@/lib/studio-api';
import { SessionExpiredError } from '@/lib/studio-api';

interface Options {
  /** 打开某条活动成功后，由页面接管表单与成稿状态 */
  onOpen: (record: ActivityRecord) => void;
}

/**
 * 共享活动库的读取、打开、删除与列表同步。
 * 打开 / 删除需要当前页面上下文（是否有未保存改动、正在编辑哪条），由调用方传入，避免闭包读到旧值。
 */
export function useActivityLibrary({ onOpen }: Options) {
  const [items, setItems] = useState<ActivityMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setItems(await studioApi.fetchActivities());
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return;
      setError(caught instanceof Error ? caught.message : '读取活动库失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const openDrawer = useCallback(() => {
    setOpen(true);
    void refresh();
  }, [refresh]);

  const closeDrawer = useCallback(() => setOpen(false), []);

  async function openActivity(id: string, currentId: string | null, dirty: boolean) {
    if (dirty && id !== currentId && !window.confirm('当前页面有未保存的改动，打开其他活动会覆盖，确定继续？')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const record = await studioApi.fetchActivity(id);
      onOpen(record);
      setOpen(false);
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return;
      setError(caught instanceof Error ? caught.message : '打开失败');
    } finally {
      setBusy(false);
    }
  }

  /** 返回是否真的删除成功，便于页面处理「删除的正是当前活动」 */
  async function removeActivity(id: string, title: string): Promise<boolean> {
    if (!window.confirm(`删除活动「${title}」？机构内所有人都将看不到它，且无法恢复。`)) return false;
    try {
      await studioApi.deleteActivity(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      return true;
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return false;
      setError(caught instanceof Error ? caught.message : '删除失败');
      return false;
    }
  }

  /** 保存成功后把最新记录移到列表首位 */
  function upsert(record: ActivityRecord) {
    setItems((prev) => [
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
      ...prev.filter((item) => item.id !== record.id)
    ]);
  }

  return {
    items,
    open,
    busy,
    error,
    refresh,
    openDrawer,
    closeDrawer,
    openActivity,
    removeActivity,
    upsert
  };
}
