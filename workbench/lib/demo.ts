import type { ActivityInput, AudienceBlock, GenerateResponse, SocialBlock, TextBlock } from './types';

/**
 * 演示模式：没有模型额度时用模板产出成稿，保证流程可完整演示。
 * 模板只用输入资料中的事实，不会生成新数字。
 */
function value(input: string, fallback = '待补充'): string {
  return input.trim() || fallback;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function buildArticle(activity: ActivityInput): TextBlock {
  const name = value(activity.name, '这场活动');
  const date = value(activity.date);
  const location = value(activity.location);
  const audience = value(activity.audience);
  const signup = value(activity.signup);
  const highlights = value(activity.highlights, '活动内容、集合方式和注意事项会在报名后逐一同步。');
  const notes = activity.notes.trim();
  const organizer = value(activity.organizer, 'C公益');

  if (activity.postType === 'recruit') {
    return {
      title: clip(`${name}｜招募开启`, 30),
      body: [
        `${audience}，这场活动想邀请你一起。`,
        highlights,
        '',
        `活动时间：${date}`,
        `活动地点：${location}`,
        `面向对象：${audience}`,
        `报名方式：${signup}`,
        notes ? `\n${notes}` : '',
        '',
        `名额有限，想来就早点报名。我们在现场等你。`,
        `—— ${organizer}`
      ]
        .filter((line) => line !== '')
        .join('\n'),
      tags: []
    };
  }

  return {
    title: clip(`${name}｜活动回顾`, 30),
    body: [
      `${date}，我们在${location}，和${audience}一起完成了这场活动。`,
      highlights,
      '',
      '现场留下了什么',
      notes || '从集合到收尾，大家把注意力放回了身边的人和脚下的路。没有宏大的口号，只有一次次具体的行动。',
      '',
      `感谢每一位到场的伙伴，也感谢${organizer}的志愿者。下一场活动，我们再见。`
    ].join('\n'),
    tags: []
  };
}

function buildNote(activity: ActivityInput): TextBlock {
  const name = value(activity.name, '这场活动');
  const project = value(activity.project, 'C公益');
  const date = value(activity.date);
  const location = value(activity.location);
  const audience = value(activity.audience);
  const signup = value(activity.signup);
  const highlights = value(activity.highlights, '这次活动准备了不少现场环节，来了就知道。');

  return {
    title: clip(`${name}，等你来`, 20),
    body: [
      `终于把「${name}」定下来了。`,
      '',
      highlights,
      '',
      `时间：${date}`,
      `地点：${location}`,
      `适合谁：${audience}`,
      `怎么报名：${signup}`,
      '',
      '公益不是遥远的大事，就是把周末的几个小时，交给一件具体的小事。',
      '',
      '想来就在评论区扣个 1，或者直接按上面的方式报名。'
    ].join('\n'),
    tags: ['#C公益', `#${project.replace(/[·\s]/g, '')}`, '#青年公益', '#志愿活动', '#周末去哪儿']
  };
}

function buildSocial(activity: ActivityInput): SocialBlock {
  const name = value(activity.name, '这场活动');
  const date = value(activity.date);
  const location = value(activity.location);
  const audience = value(activity.audience);
  const signup = value(activity.signup);

  return {
    moments: clip(`${name}开始招募啦。${date}，${location}，面向${audience}。${signup}。想来的伙伴私信我。`, 120),
    group: clip(`【活动招募】${name}\n时间：${date}\n地点：${location}\n报名：${signup}\n名额有限，接龙报名。`, 120)
  };
}

export function demoGenerate(activity: ActivityInput): GenerateResponse {
  return {
    mode: 'demo',
    article: buildArticle(activity),
    note: buildNote(activity),
    social: buildSocial(activity),
    warnings: []
  };
}

export function demoAudience(activity: ActivityInput): AudienceBlock {
  const name = value(activity.name, '这场活动');
  const date = value(activity.date);
  const location = value(activity.location);
  const audience = value(activity.audience, '青年伙伴');
  const signup = value(activity.signup);
  const highlights = value(activity.highlights, '现场会一起完成几个具体的任务。');
  const organizer = value(activity.organizer, 'C公益');

  return {
    student: [
      `如果你周末还没安排，来试试「${name}」。`,
      `${date}，我们在${location}见面。${highlights}`,
      `不需要提前准备什么，带上自己就行。报名方式：${signup}。`,
      `你会遇到一群同样在找事情做的同龄人，也许还会重新认识自己生活的城市。`
    ].join('\n'),
    public: [
      `${organizer}将于${date}在${location}开展「${name}」，参与对象为${audience}。`,
      highlights,
      `活动希望让更多青年在具体的行动中理解公益，也让本地的公共空间被重新看见。`,
      `公众可通过以下方式参与：${signup}。`
    ].join('\n'),
    press: [
      `「${name}」在${location}开展`,
      '',
      `${date}，${organizer}在${location}开展「${name}」，${audience}参与其中。`,
      highlights,
      `活动以青年参与为核心，强调在真实场景中的观察与协作。主办方表示，后续将继续围绕青年成长与在地行动开展系列活动。`,
      `${organizer}是一家关注青年成长与公益参与的社会组织。`
    ].join('\n')
  };
}

export function demoRewrite(text: string, instruction: string): string {
  if (instruction.includes('缩短')) {
    return clip(text.replace(/\n{2,}/g, '\n'), 160);
  }
  if (instruction.includes('口语')) {
    return text
      .replace(/本次活动/g, '这次活动')
      .replace(/欢迎报名参与/g, '想来就来')
      .replace(/面向对象/g, '适合谁')
      .replace(/活动时间/g, '时间')
      .replace(/活动地点/g, '地点')
      .replace(/报名方式/g, '怎么报名');
  }
  if (instruction.includes('正式')) {
    return text
      .replace(/这次活动/g, '本次活动')
      .replace(/想来就来/g, '欢迎报名参与')
      .replace(/怎么报名/g, '报名方式');
  }
  return text;
}
