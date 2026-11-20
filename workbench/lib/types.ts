export type PostType = 'recruit' | 'review';

export interface ActivityInput {
  name: string;
  project: string;
  postType: PostType;
  date: string;
  location: string;
  audience: string;
  signup: string;
  highlights: string;
  organizer: string;
  notes: string;
  /** 用户填写的需脱敏词，逗号分隔；仅用于进模型前替换，不落库 */
  sensitive: string;
  tone: string;
}

export interface TextBlock {
  title: string;
  body: string;
  tags: string[];
}

export interface SocialBlock {
  moments: string;
  group: string;
}

export interface AudienceBlock {
  student: string;
  public: string;
  press: string;
}

export interface FactWarning {
  token: string;
  reason: string;
}

export interface GenerateResponse {
  mode: 'live' | 'demo';
  article: TextBlock;
  note: TextBlock;
  social: SocialBlock;
  warnings: FactWarning[];
  notice?: string;
}

export interface RewriteResponse {
  mode: 'live' | 'demo';
  text: string;
  notice?: string;
}

export type BlockKey = 'article' | 'note' | 'social.moments' | 'social.group' | 'audience.student' | 'audience.public' | 'audience.press';

export const EMPTY_ACTIVITY: ActivityInput = {
  name: '',
  project: '游拾计划',
  postType: 'recruit',
  date: '',
  location: '',
  audience: '',
  signup: '',
  highlights: '',
  organizer: 'C公益',
  notes: '',
  sensitive: '',
  tone: '温暖克制'
};

export const EXAMPLE_ACTIVITY: ActivityInput = {
  name: '游拾计划·秋日城市漫游',
  project: '游拾计划',
  postType: 'recruit',
  date: '2026年11月28日（周六）14:00–17:30',
  location: '银川市金凤区阅海公园东门集合',
  audience: '在银川的高校学生与青年志愿者，共 30 人',
  signup: '扫描海报二维码填写报名表，11月25日 18:00 截止',
  highlights: '沿阅海湖步行 5 公里，沿途完成 3 个在地观察任务；和同伴一起记录城市里被忽略的角落；活动结束后共同整理一份城市漫游手册。',
  organizer: 'C公益',
  notes: '本次活动由 C公益 青年志愿者带队，全程免费，需自备饮用水和舒适的鞋。',
  sensitive: '',
  tone: '温暖克制'
};
