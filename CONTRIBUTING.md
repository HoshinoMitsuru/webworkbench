# Git 协作规范（AI Coding 版）

本文件面向所有参与本仓库的组员及其 AI 编程助手。目标：多人并行开发时不互相踩脚、不把敏感信息推到 GitHub、不让 AI 生成的临时产物污染仓库。

开工前请先读 [README.md](README.md) 和对应子项目的 README。

## 1. 分支纪律

- `main` 始终保持可运行，**只通过 Pull Request 合入**，不直接提交。
- 一个分支只做一件事，分支名用英文短横线：

| 类型 | 分支名示例 |
|---|---|
| 新功能 | `feat/activity-upload` |
| 修 bug | `fix/login-redirect` |
| 文档 | `docs/git-workflow` |
| 重构 / 杂务 | `refactor/studio-split`、`chore/deps-upgrade` |

```bash
git switch main
git pull --rebase
git switch -c feat/activity-upload
```

- 长期分支不要超过几天；做完就提 PR，避免一次合并几十个文件。
- 合并后删除远端分支，不要重复使用同一分支做无关改动。

## 2. 提交纪律

提交信息格式：`类型: 简短说明`（中文说明，不加句号）。

| 类型 | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复问题 |
| `refactor` | 不改变行为的重构 |
| `docs` | 文档 |
| `chore` | 依赖、配置、构建、脚本 |
| `test` | 测试 |

示例：

```
feat: 活动库支持素材上传与复用
fix: 修复登录过期后跳转丢失参数
docs: 补充 Git 协作规范
```

- 一次提交只做一件事；不要把无关的格式化混进功能提交。
- **不要 `git add -A` / `git add .`**，逐个确认文件后再加，避免把 `.env`、数据库、截图带进去。
- 提交前必须自查：

```bash
git status
git diff --stat
git diff --check        # 检查行尾空白冲突标记
```

## 3. PR 纪律

- 每个 PR 聚焦一个目标，改动尽量控制在可 review 的范围内（建议单次 < 400 行）。
- PR 描述至少写清四点：
  1. 做了什么、为什么；
  2. 怎么验证（命令、页面路径、截图）；
  3. 影响范围（是否改动数据库结构、环境变量、接口）；
  4. 遗留问题 / 下一步。
- 至少 1 名组员 review 后再合并；作者不能自己直接合自己的 PR（紧急情况需在群里说明）。
- 合并方式统一用 **Squash and merge**，保持 `main` 历史整洁；合并后删除分支。
- 不要对 `main` 执行 `push --force`，不要私自改写已推送的历史。

## 4. 敏感信息红线（最高优先级）

以下内容**任何情况下都不得提交**，也不得贴进 AI 对话：

- `.env`、`.env.local`、`AUTH_SECRET`、`ARK_API_KEY`、证书私钥；
- 飞书导出的原始表格 `data/raw/`、`*.ndjson`、`*.manifest.json`；
- SQLite 数据库与上传素材 `workbench/data/`、`*.db*`、用户上传的附件；
- 真实活动照片、报名表、学生/志愿者姓名、手机号、身份证号、住址；
- 机构未公开的内部资料、未脱敏的聊天记录。

截图、录屏、演示文稿对外分享前先脱敏。

**如果不小心提交了密钥或个人信息：**

1. 立即在群里说明，并立刻更换对应密钥（作废旧的）；
2. 不要以为「再提交一次删掉」就安全——历史里仍然存在；
3. 由组长用 `git filter-repo`（或 GitHub 官方清理流程）处理历史，再通知所有人重新克隆。

## 5. 构建产物与临时文件

已由 `.gitignore` 排除，不要为了「图方便」强行 `git add -f`：

- 依赖与构建：`node_modules/`、`workbench/.next/`、`*.tsbuildinfo`、`__pycache__/`、`.pytest_cache/`
- 运行数据：`workbench/data/`、`*.db`、`*.db-wal`、`*.db-shm`
- 临时产物：`output/`、`.screenshots/`、`.box-agent*/`、`.workbuddy/`
- 本地脚本：`tools/`

规则：

- `package-lock.json` 必须提交；升级依赖后由 `npm install` 自动更新，不要手改。
- 新增依赖要在 PR 里说明用途；不要为一个小功能引入大型框架。
- 示例数据只放 `examples/`，且必须是虚构内容。

## 6. 环境与配置

- 新成员复制 `workbench/.env.example` 为 `workbench/.env.local`，自己填本地值，**不要向别人索要 `.env`**。
- 每人本地数据库与账号互不影响；需要联调共享数据时，在群里说明，不要提交数据库文件。
- 敏感配置缺失时，让应用走演示模式（`DEMO_MODE=1`）或询问组长，不要硬编码 Key。

## 7. AI Coding 协作纪律

给 AI 下任务时：

- 先让 AI 阅读 `README.md`、本文件和相关模块代码，再动手；不要让它在不了解上下文时直接改。
- 一次只让 AI 改一个功能或一个目录，跨前后端、跨多个子项目的大改要拆开做。
- 明确告诉 AI：**不要执行 `git commit`、`git push`、`git reset --hard`、`git push --force`**，提交由人确认后手动执行。
- 明确告诉 AI：**不要修改 `.gitignore` 来放行被忽略的文件**，如确需调整先和组长确认。
- 不要把 `.env` 内容、真实密钥、真实用户数据粘贴给 AI；用 `example-key`、`张三` 之类的占位符。
- 涉及机构真实资料的任务，只提供脱敏后的字段结构，不提供原始数据。

AI 产出代码后，人必须：

1. 看 `git diff`，确认没有夹带无关修改、密钥、调试代码；
2. 跑通构建与启动：
   ```bash
   cd workbench
   npm run build
   npm run dev
   ```
   校准 Agent 改动跑 `python tests/test_cgy_eval.py`；
3. 检查新增依赖、接口字段、数据库迁移是否影响其他组员；
4. 确认没有新增临时脚本、截图、导出文件。

拒绝 AI 的以下建议：重写 Git 历史、全局 `git add -A`、跳过测试直接合并、删除他人未合并的分支、关闭安全响应头或登录校验「方便调试」。

## 8. 冲突处理

```bash
git fetch origin
git switch 你的分支
git rebase origin/main
# 解决冲突后
git add <冲突文件>
git rebase --continue
git push --force-with-lease    # 只允许自己的功能分支
```

- `package-lock.json` 冲突不要手改：先 `git checkout --theirs package-lock.json`，再 `npm install` 重新生成。
- 数据库文件不应出现在冲突里；若出现说明有人误提交，停止合并并找组长。
- 看不懂的冲突找原作者一起看，不要凭感觉删代码。
- 推送前先 rebase，避免制造无意义的 merge commit。

## 9. 提交前检查清单

- [ ] 只改了本任务相关的文件
- [ ] `git status` 中没有 `.env`、`*.db`、`data/raw/`、`output/`、截图
- [ ] 没有硬编码密钥、真实姓名、手机号
- [ ] `workbench` 能 `npm run build` 通过（或说明为何不涉及）
- [ ] 提交信息符合 `类型: 说明`
- [ ] 分支已同步 `origin/main`，无冲突
- [ ] PR 描述写清验证方式

## 10. 常用命令速查

```bash
# 同步主分支
git switch main && git pull --rebase

# 开新分支
git switch -c feat/xxx

# 查看将要提交的内容
git status && git diff --stat

# 暂存指定文件
git add workbench/lib/xxx.ts

# 提交
git commit -m "feat: 说明"

# 推送并建立关联
git push -u origin feat/xxx

# 撤销未提交的单个文件修改
git restore workbench/lib/xxx.ts

# 查看自己的提交
git log --oneline --graph --decorate -10
```

## 11. 沟通约定

- 动 `workbench/lib/db.ts`、鉴权、`.gitignore`、部署文件前，先在群里说一声。
- 发现别人分支上的问题时，优先在 PR 评论里指出，不要直接改对方分支。
- 遇到不确定是否敏感的素材，默认不发、不提交，先问组长。
