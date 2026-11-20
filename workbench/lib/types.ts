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

