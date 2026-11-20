# C公益内容工作台（团队协作版）

机构内部使用的团队内容工作台：成员用账号登录，输入一份活动资料，产出公众号推文、小红书笔记、社群话术、3:4 海报，并把资料与成稿保存到**机构自己服务器上的共享活动库**，同事可以接着改。

对应文档：

- `docs/C公益内容工作台-需求与实现参考.md`
- `docs/单页内容工作台-开发清单.md`
- `DEPLOY.md`（ECS / Docker 部署、备份与 HTTPS）

## 1. 当前实现范围

| 需求 | 状态 | 说明 |
|---|---|---|
| F1 活动资料输入 | 已实现 | 表单 + 粘贴文本 + 本地导入 .txt/.md（文件不上传） |
| F2 公众号招募/回顾推文 | 已实现 | 招募、回顾两种结构，事实字段锚定 |
| F3 小红书笔记 | 已实现 | 标题 + 正文 + 5–8 个标签 |
| F4 3:4 海报 / 封面 | 已实现 | Canvas 模板渲染，1080×1440 PNG，3 套版式 |
| F5 社群与朋友圈话术 | 已实现 | 两版短文案，各自 ≤120 字 |
| F6 学生 / 公众 / 新闻稿改写 | 已实现 | 按需生成三版，可单块重写 |
| F7 分块修改 | 已实现 | 重写 / 更口语 / 更正式 / 缩短，只替换该块 |
| F8 导出 | 部分实现 | 文本复制、PNG 下载；飞书写回需租户应用权限，暂未接入 |
| 账号体系 | 已实现 | 用户名 + 密码（scrypt 加盐哈希），签名 httpOnly Cookie，12 小时会话 |
| 共享活动库 | 已实现 | SQLite 持久化；列表 / 新建 / 打开 / 保存 / 删除，全部登录成员可见 |
| 多人协作 | 已实现 | 显示最后编辑人与时间；版本号乐观锁，冲突时提示载入或覆盖 |
| 自动保存 | 已实现 | 生成、受众改写、分块重写后自动保存；手动保存按钮兜底 |
| 视频脚本 | 未实现 | 左侧「脚本」标注为二期 |
| 事实校验 | 已实现 | 成稿中的日期/数量回查输入，未命中则高亮提示 |
| 脱敏 | 已实现 | 手机号、证件号、邮箱自动占位；自定义姓名/学校替换 |
| 异常用量 | 已实现 | 提醒 + 轻度降速，不阻断；支持 `PAUSED=1` 手动暂停 |
| 安全响应头 / noindex | 已实现 | CSP、X-Frame-Options、X-Robots-Tag、robots.txt |
| 日志与审计 | 已实现 | 只记录登录、创建、修改、删除动作，不记录正文 |

权限说明：按机构要求，**本项目内不做权限分级**。所有登录成员对活动库中的全部活动拥有相同权限（查看、编辑、删除）。

## 2. 本地运行

```bash
cd workbench
npm install
copy .env.example .env.local   # Windows；macOS/Linux 用 cp
npm run dev
```

打开 http://localhost:3000 。开发环境首次启动会自动创建演示账号：

- 用户名：`demo`
- 密码：`cgy-demo-2026`

数据默认写在 `workbench/data/workbench.db`（可用 `DATA_DIR` 改）。

「载入示例资料」读取的是仓库根目录 `examples/activity.sample.json`，**不在工程代码里写死**，也不打进构建产物。该文件不存在时按钮自动隐藏，生产部署默认不带示例。示例用法见 `examples/README.md`。

未配置模型时页面显示「演示模式」，用本地模板产出成稿，可完整走通流程；配置模型后自动切换为「已接入模型」。

创建正式账号：

```bash
npm run create-user -- zhangsan Passw0rd2026 张三
```

## 3. 接入火山引擎方舟

`.env.local`：

```ini
ARK_API_KEY=你的方舟 API Key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=你的接入点 ID 或模型 ID
DEMO_MODE=0
```

模型调用只发生在服务端，前端构建产物中不包含 Key。接口使用 OpenAI 兼容的 `/chat/completions`，
返回内容按 JSON 解析；解析失败会返回可读错误，由用户点「生成内容」重试。

## 4. 部署到机构 ECS

已提供 `Dockerfile`、`docker-compose.yml`、`nginx.conf`，Next.js 使用 standalone 产物，数据库文件挂在宿主机 `./data`。

最短路径（详见 `DEPLOY.md`）：

```bash
# ECS 上，项目目录内
cp .env.example .env       # 填 AUTH_SECRET、ARK_API_KEY、ARK_MODEL
mkdir -p data
docker compose up -d --build
# 创建账号
docker compose exec app node scripts/create-user.mjs zhangsan Passw0rd2026 张三
```

默认 nginx 监听 80，`app` 只在容器网络内暴露 3000。生产必须通过 HTTPS 访问；首次在纯 HTTP 上联调时，在 `.env` 中设 `COOKIE_SECURE=0`，否则浏览器不会保存登录 Cookie。

关键环境变量：

| 变量 | 说明 |
|---|---|
| `AUTH_SECRET` | 会话签名密钥，生产必填，32 位以上随机串 |
| `DATA_DIR` | SQLite 目录，Docker 中为 `/app/data` |
| `SEED_USERS` | 可选，首次启动批量建号，格式 `用户名:密码:姓名`，逗号分隔 |
| `COOKIE_SECURE` | 纯 HTTP 联调时设 `0`；HTTPS 保持默认 |
| `ARK_API_KEY` / `ARK_MODEL` | 方舟接入信息 |
| `PAUSED` | `1` 时停止生成 |

## 5. 数据、备份与恢复

- 数据库：`data/workbench.db`，WAL 模式，同目录会有 `workbench.db-wal`、`workbench.db-shm`。
- 备份：停服或低峰时执行 `sqlite3 data/workbench.db ".backup 'backup-$(date +%F).db'"`；也可直接整目录打包（需连 WAL 文件一起）。
- 恢复：停止容器，用备份文件覆盖 `data/workbench.db`，删除同名 `-wal` / `-shm` 后启动。
- 迁移：把整个 `data/` 目录拷到新服务器即可，账号与活动随之迁移。

## 6. 安全与合规落地位置

| 事项 | 代码位置 |
|---|---|
| 账号密码哈希 | `lib/users.ts`（scrypt） |
| 会话签名与 Cookie | `lib/auth.ts`、`app/api/auth/login/route.ts` |
| 路由保护 | `middleware.ts` |
| 活动库数据访问与版本锁 | `lib/activities.ts`、`app/api/activities/**` |
| 数据库与审计 | `lib/db.ts` |
| 安全响应头与 CSP | `next.config.mjs` |
| 禁止收录 | `next.config.mjs`、`app/robots.ts`、`app/layout.tsx` |
| 脱敏 | `lib/sanitize.ts` |
| 事实回查 | `lib/facts.ts` |
| 用量监测与暂停 | `lib/usage.ts` |
| PNG 元数据 AI 标识 | `lib/png.ts` |
| 提示词与品牌约束 | `lib/prompts.ts` |

## 7. 已知缺口

1. **模型尚未接入时是模板稿**：演示模式只保证流程与结构，不代表最终文案质量，正式使用前应配置方舟 Key 并用真实活动资料试跑。
2. **Logo 为文字占位**：拿到机构 Logo 源文件、标准色值、字体后，替换 `lib/poster.ts` 的品牌区；版式与安全边距已预留。
3. **二维码为预留框**：当前不生成二维码；需要在海报上放报名码时，导出后人工替换，或后续接入二维码库。
4. **飞书写回未接入**：需要机构飞书租户管理员创建应用并授予文档权限，MVP 不阻塞主流程。
5. **用量统计是单实例内存**：多实例部署时各实例独立计数。
6. **SQLite 适合单机部署**：活动库与 Web 服务在同一台 ECS 上运行；若将来要多实例负载均衡，需要换 PostgreSQL 之类的共享数据库。
7. **无文件上传（照片）**：为避免原始素材留存与儿童肖像风险，MVP 只接收文本；照片仍留在机构原有流程里。
8. **删除即彻底删除**：活动库删除会移除资料与成稿，没有回收站；重要活动请按备份流程留档。

## 8. 验收自查

用两个账号跑一遍：

- [ ] 账号 A 登录后生成内容，右上角出现「共享活动库」，能看到新保存的活动；
- [ ] 账号 B 登录后打开同一条活动，能看到 A 生成的成稿，修改并保存成功；
- [ ] A 页面在 B 保存后再点保存，出现版本冲突提示，两种处理方式都可用；
- [ ] 推文事实字段（时间、地点、对象、报名方式）与输入一致；
- [ ] 小红书笔记有标题、正文、标签，语气不像公文；
- [ ] 海报导出为 1080×1440 PNG，文字清晰、品牌色正确；
- [ ] 社群话术 ≤120 字，可直接复制；
- [ ] 学生版 / 公众版 / 新闻稿版差异明显；
- [ ] 未登录访问 `/studio` 会跳转登录，`/api/*` 返回 401；
- [ ] 生成的日期或数量若不在资料中，会在结果区高亮提示。
