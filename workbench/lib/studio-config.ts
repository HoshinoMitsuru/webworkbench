/** 浏览器本地缓存的键名，只存活动资料，不存成稿 */
export const STORAGE_KEY = 'cgy.workbench.activity.v1';

/** 单块改写指令，文案与后端 /api/rewrite 的约定一致 */
export const REWRITE_INSTRUCTIONS = {
  rewrite: '重写这段内容，保持事实不变',
  casual: '改得更口语、更像日常说话',
  formal: '改得更正式、适合对外发布',
  shorten: '缩短到原文的一半左右'
} as const;

export const PROGRESS_STEPS = ['整理活动资料、锁定事实字段', '撰写公众号推文与小红书笔记', '生成社群话术并做事实回查'];
