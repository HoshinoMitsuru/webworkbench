# C公益 AI 内容工作台

面向 C公益（宁夏青年发展公益慈善中心）的机构内部 AI 内容生产与协作项目：成员在浏览器里输入一份活动资料，生成公众号推文、小红书笔记、社群话术与 3:4 海报；资料与成稿保存在机构自己服务器上的共享活动库中，同事可以接着改。

本仓库用于团队协作，包含调研文档、PRD、HTML 打样与可运行的工作台源码。

> 仓库建议设为 **Private**：内容涉及公益机构内部资料与未成年人相关素材，禁止在公开仓库中出现真实账号、密钥、成员联系方式或原始活动数据。

## 目录结构

| 目录 | 说明 |
|---|---|
| `workbench/` | 主交付物。Next.js 内容工作台：账号登录、共享活动库、内容生成、海报导出、Docker 部署 |
| `cgy-calibration-agent/` | 内容校准 Agent（Python）：账号矩阵数据 + 活动台账 → 校准动作卡，当前为 Mock LLM 演示 |
| `demo/` | D1–D3 静态 HTML 打样及响应式截图 |
| `docs/` | 机构调研、需求、PRD、竞品分析等文档 |
| `examples/` | 工作台示例活动资料（虚构数据，仅演示用） |
| `from_group_member/` | 组员提供的素材准备与确认清单 |
| `data/` | 本地导出的原始数据目录，**内容不入库** |

## 快速开始（内容工作台）

环境要求：Node.js 20+（开发环境为 Node 22）。

```bash
cd workbench
npm install
copy .env.example .env.local    # macOS / Linux: cp .env.example .env.local
npm run dev
```

打开 <http://localhost:3000>。开发环境首次启动会自动创建演示账号：

- 用户名：`demo`
- 密码：`cgy-demo-2026`

未配置模型时页面以「演示模式」运行，用本地模板产出成稿，可完整走通流程；配置模型后自动切换为「已接入模型」。

接入火山引擎方舟，在 `.env.local` 中配置：

```ini
ARK_API_KEY=你的方舟 API Key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=你的接入点 ID 或模型 ID
DEMO_MODE=0
```

创建正式账号：

```bash
npm run create-user -- zhangsan Passw0rd2026 张三
```

更多实现细节、已知缺口与验收清单见 [workbench/README.md](workbench/README.md)。

## 部署到机构 ECS

已提供 `Dockerfile`、`docker-compose.yml`、`nginx.conf`，详细步骤（服务器准备、环境变量、HTTPS、备份恢复）见 [workbench/DEPLOY.md](workbench/DEPLOY.md)。

```bash
cd workbench
cp .env.example .env    # 填 AUTH_SECRET、ARK_API_KEY、ARK_MODEL
mkdir -p data
docker compose up -d --build
docker compose exec app node scripts/create-user.mjs zhangsan 'Passw0rd2026' 张三
```

## 配置与密钥

- 所有密钥只放本地 `.env` / `.env.local`，仓库只提交 `.env.example`。
- 必填项：`AUTH_SECRET`（32 位以上随机串）、`ARK_API_KEY`、`ARK_MODEL`。
- 真实账号密码通过 `create-user` 创建，不要写进代码、文档或提交记录。
- 已通过 `.gitignore` 排除：`.env*`、证书私钥、`data/raw/`、SQLite 数据库与上传素材、构建产物、日志与编辑器配置。

## 校准 Agent（可选）

```bash
cd cgy-calibration-agent
python -m venv .venv
.venv\Scripts\activate            # macOS / Linux: source .venv/bin/activate
pip install -r requirements.txt
python main.py --profile cgy
```

说明见 `cgy-calibration-agent/README_CGY.md`。当前使用虚构演示数据 + Mock LLM，仅验证规则与护栏逻辑，不代表真实运营数据或真模型效果。

## 协作约定

- 主分支 `main`；功能分支 `feat/xxx`，修复分支 `fix/xxx`，通过 Pull Request 合并。
- 提交信息格式：`类型: 说明`，例如 `feat: 活动库支持素材上传`、`fix: 修复登录过期跳转`。
- 提交前自查 `git status`，确认没有 `.env`、数据库、上传素材或原始导出数据。
- 不提交 `node_modules/`、`workbench/.next/`、`__pycache__/`、`*.tsbuildinfo` 等依赖与构建产物。

完整的分支、提交、PR、敏感信息与 AI Coding 协作纪律见 [CONTRIBUTING.md](CONTRIBUTING.md)，所有组员及 AI 助手开工前请先阅读。

## 文档索引

| 文档 | 内容 |
|---|---|
| [需求与实现参考](docs/C公益内容工作台-需求与实现参考.md) | 功能范围、实现方式与验收标准 |
| [单页内容工作台-开发清单](docs/单页内容工作台-开发清单.md) | 开发任务拆解 |
| [PRD 评审修订版](docs/C公益_AI内容工作台_PRD_评审修订版_20261123.md) | 最新 PRD（2026-11-23） |
| [PRD 评审待明确清单](docs/PRD评审_待审待明确清单_20261123.md) | 待机构确认的问题 |
| [机构画像与需求预研](docs/C公益-机构画像与需求预研.md) | 机构背景与内容生产痛点 |
| [内容生产需求调研结果](docs/C公益-内容生产需求调研结果.md) | 对谈调研结论 |
| [攒劲青年内容现状与小红书增长点](docs/C公益-攒劲青年内容现状与小红书增长点.md) | 账号矩阵与增长分析 |
| [官网调研-样式与状态](docs/C公益官网调研-样式与状态.md) | 品牌视觉现状 |
| [竞品与工具调研-内容生产](docs/竞品与工具调研-内容生产.md) | 同类工具对比 |
| [Demo 打样汇总报告](docs/C公益-Demo打样汇总报告.md) | D1–D3 打样说明 |
| [对谈会提问稿](docs/对谈会提问稿-C公益.md) | 与机构沟通的话术 |

## 隐私与合规

- 仓库内不存放真实活动照片、参与者名单、联系方式等个人信息。
- 示例数据为虚构内容，位于 `examples/`，生产部署默认不带示例。
- 对外分享截图或文档前先脱敏；涉及儿童/未成年人的素材需取得机构授权。
