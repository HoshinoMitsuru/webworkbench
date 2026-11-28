/**
 * canvas-model 行为测试，移植自 demo/ui-canvas-prototype/model.test.cjs（23 个 node:test 用例）。
 *
 * 运行方式：在 workbench 目录执行 `node --test lib/canvas-model.test.ts`
 * Node 24 会把本文件按 CommonJS 执行（无顶层 ESM 语法），因此运行时用 require 加载同目录 .ts 实现；
 * 类型信息通过 type-only 的 `typeof import` 获取，不产生任何运行时代码。
 */
// 注意：本文件不含顶层 import/export，会被 TS 视为脚本（全局作用域），
// 因此本地类型别名不能与 lib.dom 的全局名冲突（如 CanvasState），统一加 Model 前缀。
type ModelModule = typeof import('./canvas-model');
type ModelState = import('./canvas-model').CanvasState;

const M: ModelModule = require('./canvas-model.ts');
const { test }: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const ready = () => M.seed();

test('five editable defaults with unique identifiers', () => {
  const s = ready();
  assert.equal(s.nodes.length, 5);
  assert.equal(new Set(s.nodes.map((n) => n.id)).size, 5);
  for (const n of s.nodes) M.update(s, n.id, 'name', n.name + '编辑');
  assert(M.get(s, 'plan')!.content!.goal);
  assert(M.get(s, 'xhs')!.image!.title);
});

test('free post can be created without completing any previous stage', () => {
  const s = ready();
  const n = M.createNode(s, 'xhs', { x: 200, y: 400 });
  M.update(s, n.id, 'name', '小红书·招募预告');
  assert.equal(n.refs.length, 0);
  assert(n.body);
});

test('one source generates multiple independent same-platform drafts', () => {
  const s = ready();
  const a = M.generatePosts(s, ['xhs'], 'plan')[0];
  const b = M.generatePosts(s, ['xhs'], 'plan')[0];
  assert.notEqual(a.id, b.id);
  M.update(s, a.id, 'title', 'first');
  assert.notEqual(b.title, 'first');
  assert.equal(a.refs[0].id, b.refs[0].id);
});

test('two plans and three xhs nodes coexist', () => {
  const s = ready();
  M.createNode(s, 'plan');
  M.createNode(s, 'xhs');
  M.createNode(s, 'xhs');
  assert.equal(s.nodes.filter((n) => n.kind === 'plan').length, 2);
  assert.equal(s.nodes.filter((n) => n.platform === 'xhs').length, 3);
});

test('same raw image reusable with independently editable cover layout and text', () => {
  let s = ready();
  const image = M.createNode(s, 'image');
  const a = M.createNode(s, 'xhs');
  const b = M.createNode(s, 'xhs');
  s = M.withPhoto(s, image.id, 'data:image/png;base64,raw', '自有原图');
  M.update(s, image.id, 'image.usable', true);
  M.setRefs(s, a.id, ['plan', image.id]);
  M.setRefs(s, b.id, ['plan', image.id]);
  const before = M.clone(M.get(s, a.id)!);
  const raw = M.clone(M.get(s, image.id)!);
  M.update(s, b.id, 'title', '第二篇手改');
  M.update(s, b.id, 'image.layout', 'center');
  assert.deepEqual(M.get(s, a.id), before);
  assert.deepEqual(M.get(s, image.id), raw);
  assert.equal(M.get(s, a.id)!.image!.photo, M.get(s, b.id)!.image!.photo);
});

test('image regeneration preserves title, body, raw image reference', () => {
  const s = ready();
  const n = M.get(s, 'xhs')!;
  M.update(s, n.id, 'title', '手改标题');
  M.update(s, n.id, 'body', '手改正文');
  n.image!.photo = M.storeAsset(s, 'data:image/png;base64,raw');
  const original = n.image!.photo;
  M.regenerate(s, n.id, 'image');
  assert.equal(n.title, '手改标题');
  assert.equal(n.body, '手改正文');
  assert.equal(n.image!.photo, original);
});

test('upstream updates mark only directly referencing nodes without overwrite', () => {
  const s = ready();
  const a = M.createNode(s, 'xhs', {}, ['plan']);
  const b = M.createNode(s, 'xhs');
  M.update(s, a.id, 'title', '保留');
  M.update(s, 'plan', 'content.focus', '更新重点');
  assert(M.stale(s, a));
  assert(!M.stale(s, b));
  assert.equal(a.title, '保留');
});

test('source replacement keeps manual draft and independently styled cover', () => {
  const s = ready();
  const n = M.get(s, 'xhs')!;
  const p = M.createNode(s, 'plan');
  M.update(s, n.id, 'title', '手改');
  M.update(s, n.id, 'image.layout', 'center');
  M.setRefs(s, n.id, [p.id]);
  assert.equal(n.title, '手改');
  assert.equal(n.image!.layout, 'center');
  assert.equal(n.input!.sourceId, p.id);
});

test('unlink retains adopted contents and eliminates live edge', () => {
  const s = ready();
  const n = M.get(s, 'xhs')!;
  const body = n.body;
  M.setRefs(s, n.id, []);
  assert.equal(n.refs.length, 0);
  assert.equal(n.body, body);
});

test('cycle references are refused without altering references', () => {
  const s = ready();
  const before = M.clone(M.get(s, 'theme')!.refs);
  assert.throws(() => M.setRefs(s, 'theme', ['xhs']), /循环/);
  assert.deepEqual(M.get(s, 'theme')!.refs, before);
});

test('copy finalized post becomes independent draft with no shared mutable data', () => {
  const s = ready();
  M.finalize(s, 'xhs');
  const a = M.get(s, 'xhs')!;
  const b = M.duplicate(s, a.id);
  assert(!b.finalized);
  assert.equal(b.history.length, 0);
  M.update(s, b.id, 'image.title', '副本封面');
  assert.notEqual(a.image!.title, b.image!.title);
});

test('delete referenced material warns through impact and undo restores edges', () => {
  const s = ready();
  const pic = M.createNode(s, 'image');
  const n = M.get(s, 'xhs')!;
  pic.image!.photo = M.storeAsset(s, 'data:image/png;base64,raw');
  M.setRefs(s, n.id, ['plan', pic.id]);
  M.remember(s, 'delete');
  const body = n.body;
  assert.equal(M.impact(s, pic.id).length, 1);
  M.deleteNode(s, pic.id);
  assert.equal(n.body, body);
  assert(n.refs.find((r) => r.id === pic.id)!.missing);
  M.collectAssets(s);
  assert(s.assets[n.image!.photo]);
  M.undo(s);
  assert(M.get(s, pic.id));
  assert(!M.get(s, n.id)!.refs.find((r) => r.id === pic.id)!.missing);
});

test('group collapse and movement do not change references', () => {
  const s = ready();
  const refs = M.clone(M.get(s, 'xhs')!.refs);
  const g = M.createGroup(s, ['plan', 'xhs'], '招募传播');
  const x = M.get(s, 'xhs')!.x;
  g.collapsed = true;
  M.moveGroup(s, g.id, 40, 50);
  assert.equal(M.get(s, 'xhs')!.x, x + 40);
  assert.deepEqual(M.get(s, 'xhs')!.refs, refs);
  M.ensureVisible(s, 'xhs');
  assert.equal(g.collapsed, false);
});

test('serialized groups positions drafts and versions survive refresh', () => {
  const s = ready();
  const g = M.createGroup(s, ['wechat', 'xhs'], '传播');
  g.collapsed = true;
  M.update(s, 'xhs', 'title', '刷新还在');
  const n: ModelState = JSON.parse(JSON.stringify(s));
  M.prepareCanvas(n);
  assert.equal(n.groups[0].name, '传播');
  assert.equal(M.get(n, 'xhs')!.title, '刷新还在');
});

// 原测试夹具 qa/legacy-v2.json 未随交付包提供（全仓库不存在），
// 此处用内联合成的 schema=2 样本验证迁移核心不变量：
// schema 变为 3、节点数量正确、手改标题保留、finalized 快照保留、评论数组不被改写。
test('legacy migration preserves manual title comments positions and finalized snapshot', () => {
  const schedule = M.facts();
  const planContent = {
    goal: '旧版本地稿的目标',
    audience: '对产品设计感兴趣的青年',
    agenda: '14:00—14:15 签到与破冰',
    focus: '旧版传播重点',
  };
  const postInput = () => ({
    sourceId: 'plan',
    version: 1,
    content: planContent,
    topic: '职业探索日 · 产品设计师体验',
    facts: schedule,
  });
  const legacyFinalized = {
    actor: '小王',
    at: '2026-11-20 10:00:00',
    version: 4,
    snapshot: {
      id: 'xhs',
      kind: 'post',
      name: '小红书推文',
      title: '手改：一个小红书标题',
      revision: 4,
    },
  };
  const legacy = {
    schema: 2,
    revision: 9,
    actor: '我',
    project: '职业探索日 · 产品设计师体验',
    schedule,
    selected: 'xhs',
    nodes: [
      {
        id: 'schedule',
        kind: 'schedule',
        name: '排期',
        x: 40,
        y: 40,
        revision: 1,
        history: [],
        refs: [],
        ignoredRefs: {},
        finalized: null,
        data: { ...schedule },
      },
      {
        id: 'theme',
        kind: 'theme',
        name: '活动主题',
        x: 350,
        y: 40,
        revision: 2,
        history: [],
        refs: [],
        ignoredRefs: {},
        finalized: null,
        title: '职业探索日 · 产品设计师体验',
        direction: '从身边的问题开始，练习观察、构思与表达。',
      },
      {
        id: 'plan',
        kind: 'plan',
        name: '活动方案',
        x: 730,
        y: 40,
        revision: 2,
        history: [],
        refs: [],
        ignoredRefs: {},
        finalized: null,
        content: { ...planContent },
        topic: '职业探索日 · 产品设计师体验',
      },
      {
        id: 'wechat',
        kind: 'post',
        platform: 'wechat',
        name: '公众号推文',
        x: 1170,
        y: 40,
        revision: 2,
        history: [],
        refs: [],
        ignoredRefs: {},
        finalized: null,
        title: '旧版公众号标题',
        body: '旧版公众号正文',
        input: postInput(),
      },
      {
        id: 'xhs',
        kind: 'post',
        platform: 'xhs',
        name: '小红书推文',
        x: 1750,
        y: 40,
        revision: 4,
        history: [],
        refs: [],
        ignoredRefs: {},
        finalized: legacyFinalized,
        title: '手改：一个小红书标题',
        body: '旧版小红书正文',
        input: postInput(),
      },
    ],
    comments: [
      {
        id: 'comment-legacy-1',
        nodeId: 'xhs',
        field: '标题',
        text: '@小王 请核对活动时间',
        actor: '我',
        at: '2026-11-20 09:00:00',
        version: 4,
        mentions: ['小王'],
      },
      {
        id: 'comment-legacy-2',
        nodeId: 'plan',
        field: '正文',
        text: '方案已确认',
        actor: '小王',
        at: '2026-11-20 09:10:00',
        version: 2,
        mentions: [],
      },
    ],
    groups: [],
    selection: ['xhs'],
  };
  const s = legacy as unknown as ModelState;
  const old = M.clone(M.get(s, 'xhs')!);
  const comments = M.clone(s.comments);
  M.prepareCanvas(s);
  M.prepareCanvas(s);
  assert.equal(s.schema, 3);
  assert.equal(s.nodes.length, 5);
  assert.equal(M.get(s, 'xhs')!.title, old.title);
  assert.equal(M.get(s, 'xhs')!.x, 1750);
  assert.deepEqual(M.get(s, 'xhs')!.finalized, old.finalized);
  assert.deepEqual(s.comments, comments);
});

test('schema3 refresh does not resurrect deleted defaults', () => {
  const s = ready();
  M.deleteNode(s, 'plan');
  M.prepareCanvas(s);
  assert(!M.get(s, 'plan'));
});

test('legacy raw image migration deduplicates historic bitmap', () => {
  const s = ready();
  const n = M.get(s, 'xhs')!;
  n.image!.photo = 'data:image/png;base64,old';
  M.checkpoint(s, n, 'before');
  M.migrateAssets(s);
  assert.equal(Object.keys(s.assets).length, 1);
  assert.equal(n.image!.photo, n.history[0].snapshot.image!.photo);
});

test('asset garbage collection retains undo references for deleted uploaded images', () => {
  let s = ready();
  const n = M.createNode(s, 'image');
  s = M.withPhoto(s, n.id, 'data:image/png;base64,raw', 'original');
  const id = M.get(s, n.id)!.image!.photo;
  M.remember(s, 'delete');
  M.deleteNode(s, n.id);
  M.collectAssets(s);
  assert(s.assets[id]);
  M.undo(s);
  assert.equal(M.get(s, n.id)!.image!.photo, id);
});

test('bitmap stored once across current draft history confirmation and undo', () => {
  let s = ready();
  s = M.withPhoto(s, 'xhs', 'data:image/png;base64,' + 'a'.repeat(1000000), 'original');
  M.update(s, 'xhs', 'image.usable', true);
  M.remember(s, 'final');
  M.finalize(s, 'xhs');
  const json = JSON.stringify(s);
  assert.equal(json.split('a'.repeat(1000000)).length - 1, 1);
});

test('saving a post image as material preserves independently editable original settings', () => {
  const s = ready();
  const p = M.get(s, 'xhs')!;
  const m = M.materialFromPost(s, p.id);
  const old = p.image!.title;
  M.update(s, m.id, 'image.title', '素材修改');
  assert.equal(p.image!.title, old);
  assert(m.poster);
});

test('comment belongs to independent node and identifies mentioned member', () => {
  const s = ready();
  const n = M.createNode(s, 'xhs');
  const c = M.comment(s, n.id, '标题', '@小王 请核对');
  assert.equal(c.nodeId, n.id);
  assert.deepEqual(c.mentions, ['小王']);
});

test('explicit sync keeps history of hand edited draft', () => {
  const s = ready();
  const n = M.get(s, 'xhs')!;
  M.update(s, n.id, 'title', '保留旧稿');
  M.update(s, 'plan', 'content.focus', 'new');
  M.syncRef(s, n.id, 'plan');
  assert.equal(n.history[0].snapshot.title, '保留旧稿');
  assert(!M.stale(s, n));
});

test('new derived drafts avoid existing node bounds', () => {
  const s = M.seed();
  const n = M.generatePosts(s, ['xhs'], 'plan')[0];
  for (const v of s.nodes.filter((v) => v.id !== n.id))
    assert(
      !(
        n.x < v.x + (v.kind === 'post' ? 420 : 370) + 30 &&
        n.x + 420 > v.x - 30 &&
        n.y < v.y + 650 &&
        n.y + 650 > v.y
      ),
    );
});
