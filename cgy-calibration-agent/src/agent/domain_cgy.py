"""C公益 定向领域层：公益机构内容运营的业务规则集（新增，不改原 domain.py）。

背景（依据本仓 docs/ 调研，2026-11）：
- C公益 = 宁夏青年发展公益慈善中心，全职 7–13 人 + 70+ 无薪志愿者；
- 出口矩阵：公众号「攒劲青年」（主号）+「C公益活动种草中心」（旧号，仍并行）
  + 小红书「来自西北的攒劲青年」+「来自西北的小C同学」（后者状态未知）；
- 产能：1 文案 + 1 排版（轮换志愿者，每周 8–15h），2026-10 单月 27 场活动；
- 痛点 P1–P9 与官网预判 W1–W7 见 docs/C公益-机构画像与需求预研.md。

设计原则（继承原引擎三条不变量，一字不改语义）：
1. 判定用原始值，展示值只供证据回显；
2. 缺字段不补 0、不推断 —— 缺数据标「未获取」，不出卡；
3. 扩展字段原样透传，不覆盖核心键。

🔴 阈值诚实标注：本文件所有阈值均为【预研假设】，依据写在注释里，
   需 2026-11-13 对谈后校准。禁止把假设当机构确认口径对外表述。
"""
from __future__ import annotations

from dataclasses import asdict
from typing import List, Dict, Any

from .domain import CalibrationCard, analyze_stats, _is_measurable

# C公益 账号矩阵（账号名 = 调研确证的对外名称；platform 字段沿用引擎口径）
# status: active=在运营 / legacy=旧号并行 / unknown=公开渠道无法核实
CGY_ACCOUNTS: Dict[str, Dict[str, Any]] = {
    "wechat_zanjin": {
        "platform": "wechat", "name": "攒劲青年", "role": "主号：完整叙事/招募细则/主理人月刊",
        "status": "active",
    },
    "wechat_zhongcao": {
        "platform": "wechat", "name": "C公益活动种草中心", "role": "旧号：历史内容，2026-01 仍在更新",
        "status": "legacy",
    },
    "xhs_zanjin": {
        "platform": "xiaohongshu", "name": "来自西北的攒劲青年", "role": "小红书主号：现为招募/招聘海报",
        "status": "active",
    },
    "xhs_xiaoc": {
        "platform": "xiaohongshu", "name": "来自西北的小C同学", "role": "定位未知，需向机构确认",
        "status": "unknown",
    },
}

# 活动台账口径与 demo/d2-monthly-report.html 同源：
# 每行 = {name, line, host, date, count, place, detail, recorder}
# line ∈ zhiye(一日职业体验) / zhuliren(主理人) / youshi(游拾) / qingqiao(青桥)

# ---- 合规红线词表（慈善组织信息披露 + 募捐合规）----
# 依据：docs 官网调研 §5 硬约束3「金额/人数/备案号必须锁定事实」；
# 画像文档 §8「生成内容涉及金额、人数、备案号时必须锁定事实，不能让模型编」。
# 命中 = 建议卡文案里出现「未经锁定来源」的敏感表述模式，须人工复核后才能发布。
COMPLIANCE_PATTERNS = [
    ("保证收益", "捐赠/资助不得承诺回报收益"),
    ("稳赚", "捐赠/资助不得承诺回报收益"),
    ("百分百", "绝对化承诺，慈善信息披露禁用"),
    ("100%透明", "绝对化表述；透明度应以审计报告/公示链接为证"),
    ("官方认证公募", "公募资格表述须用备案原文：2025 年获公开募捐资格"),
    ("捐款返利", "捐赠返利涉嫌违规劝募"),
]

# 备案口径（确证，来源：10 月月报）——生成内容引用募捐信息时的唯一合法表述
FILING_NAME = "打破资源鸿沟 点亮西北未来"


def check_compliance(text: str) -> List[str]:
    """返回命中的红线说明列表；空列表 = 未命中。只做词面拦截，不做语义判断。"""
    if not isinstance(text, str):
        text = str(text)
    hits = []
    for kw, why in COMPLIANCE_PATTERNS:
        if kw in text:
            hits.append(f"「{kw}」：{why}")
    return hits


def analyze_ledger(rows: List[Dict[str, Any]], month: str) -> Dict[str, Any]:
    """活动台账月度统计（与 D2 月报工坊同一口径：只算不编）。

    缺字段行（date/count 缺失）计入 skipped_rows，不补 0、不推断。
    """
    sessions = 0
    people = 0
    per_line: Dict[str, Dict[str, int]] = {}
    skipped: List[int] = []
    for i, r in enumerate(rows):
        d = r.get("date")
        c = r.get("count")
        if not isinstance(d, str) or not d.startswith(month) or c is None:
            if isinstance(d, str) and d.startswith(month):
                skipped.append(i)  # 属于本月但缺人数：显式记录，不补 0
            continue
        sessions += 1
        people += int(c)
        line = str(r.get("line", "unknown"))
        pl = per_line.setdefault(line, {"sessions": 0, "people": 0})
        pl["sessions"] += 1
        pl["people"] += int(c)
    return {
        "month": month, "sessions": sessions, "people": people,
        "per_line": per_line, "skipped_rows": skipped,
        "avg": round(people / sessions, 1) if sessions else None,
    }


def suggest_cgy_cards(gathered: Dict[str, Any],
                      ledger_rows: List[Dict[str, Any]] | None = None,
                      month: str = "2026-10",
                      posts_expected_per_month: int = 8) -> List[CalibrationCard]:
    """C公益 规则集（G1–G7）。gathered 与原引擎同构：account_key -> {stats, posts}。

    account_key 用 CGY_ACCOUNTS 的键；未知键按普通平台处理（只走继承的 R 规则）。
    每条规则：阈值 + 依据注释 + 证据可回溯。全部阈值【预研假设，待对谈校准】。
    """
    cards: List[CalibrationCard] = []
    ledger = analyze_ledger(ledger_rows or [], month)

    for key, data in gathered.items():
        meta = CGY_ACCOUNTS.get(key)
        label = meta["name"] if meta else key
        stats = data.get("stats")
        posts = data.get("posts")

        # ---- G0（继承原 R1/R2/R3，语义不动）：基础指标体检 ----
        if stats:
            m = stats if "engagement_rate_raw" in stats else analyze_stats(stats)
            if _is_measurable(m):
                if m["engagement_rate_raw"] < 0.02:
                    cards.append(CalibrationCard(
                        platform=label,
                        issue="互动率低于 2%（继承原 R1，原始值判定）",
                        evidence=f"views={m['views']}, likes+comments={m['likes']+m['comments']}, raw={m['engagement_rate_raw']:.6f}",
                        action="标题改提问式/现场细节式开头；结尾给明确行动指引（报名/关注），不用「求点赞」话术",
                        priority=1,
                    ))
                if m["views"] > 0 and m["likes"] == 0:
                    cards.append(CalibrationCard(
                        platform=label,
                        issue="有曝光无点赞（继承原 R3）",
                        evidence=f"views={m['views']}, likes=0",
                        action="检查首图与首段：公益内容用真实现场照片+一句话现场细节，替代纯海报",
                        priority=2,
                    ))
            else:
                cards.append(CalibrationCard(
                    platform=label,
                    issue="关键指标未获取，无法体检",
                    evidence=f"missing_fields={m.get('missing_fields')}",
                    action="请机构提供该账号创作者中心截图后复跑；本卡不含任何推断结论",
                    priority=3,
                ))

        # ---- G1 账号矩阵分工（W6/P4）----
        # 依据：官网调研 §5 W6「一次生产多平台分发」；两号并行是确证事实。
        if meta and meta["status"] == "legacy" and posts:
            recent = [p for p in posts if str(p.get("published_at", "")).startswith(month)]
            if recent:
                cards.append(CalibrationCard(
                    platform=label,
                    issue="旧号仍在发新内容，与新号搜索权重分散",
                    evidence=f"{month} 旧号发文 {len(recent)} 篇（例：{recent[0].get('title','')[:30]}）",
                    action="与机构确认双号关系：建议旧号只发存档指引，新内容统一走「攒劲青年」；用 D1 一次生成两号版本",
                    priority=2,
                ))
        if meta and meta["status"] == "unknown":
            cards.append(CalibrationCard(
                platform=label,
                issue="账号状态未知，不做任何运营判断",
                evidence="公开渠道未检索到可核实笔记（docs 增长点文档 §2.3）",
                action="对谈问题 8b：这个号还在用吗？谁维护？确认前不投入内容产能",
                priority=3,
            ))

        # ---- G2 产能缺口（P1/P2/P6，核心规则）----
        # 阈值假设：月产出 < 台账场次 × 30%（假设约 1/3 场次值得成文）→ 产能赤字。
        # 依据：10 月 27 场 vs 可见推文量级；30% 为保守假设，需问「挑重点场次的标准」。
        if meta and meta["status"] == "active" and ledger["sessions"] > 0 and posts is not None:
            n_posts = len([p for p in posts if str(p.get("published_at", "")).startswith(month)])
            threshold = ledger["sessions"] * 0.3
            if n_posts < threshold:
                cards.append(CalibrationCard(
                    platform=label,
                    issue="内容产出跟不上活动产能（P2 重复劳动）",
                    evidence=f"{month} 台账 {ledger['sessions']} 场 vs 该号发文 {n_posts} 篇（阈值=场次×30%={threshold:.1f}，预研假设）",
                    action="接入 D1 攒劲内容工坊：活动当天填一行归档，五路产物一次生成，把「每场重写」变「每场填空」",
                    priority=1,
                ))

        # ---- G3 素材复用率（P9）----
        # 阈值假设：小红书三类内容（科普/故事/反馈）占比 < 50% → 素材只用一次。
        # 依据：增长点文档 §3「一次归档三种切法」；现状确证以招募海报为主。
        if meta and meta["platform"] == "xiaohongshu" and meta["status"] == "active" and posts:
            typed = [p for p in posts if p.get("content_type") in ("science", "story", "feedback")]
            ratio = len(typed) / len(posts)
            if ratio < 0.5:
                cards.append(CalibrationCard(
                    platform=label,
                    issue="三类目标内容供给不足，素材只用一次（P9）",
                    evidence=f"近 {len(posts)} 篇中科普/故事/反馈 {len(typed)} 篇，占比 {ratio:.0%}（阈值 50%，预研假设）",
                    action="用 D1 的小红书三切法页签：同一场活动出青年故事+活动反馈+公益科普，不另起生产线",
                    priority=1,
                ))

        # ---- G4 等待期失联（P8，外部类推待验证）----
        # 阈值假设：青桥排队 > 14 天且无进度通知 → 流失风险。
        # 依据：蓝信封 30–60 天等待经验类推（画像文档 §4 P8）；14 天为 D3 演示阈值。
        if meta and meta["platform"] == "wechat" and meta["status"] == "active" and ledger_rows:
            queued = [r for r in ledger_rows
                      if r.get("line") == "qingqiao" and r.get("stage") == "queued"
                      and r.get("wait_days") is not None and r.get("wait_days") > 14
                      and not r.get("progress_notified")]
            if queued:
                cards.append(CalibrationCard(
                    platform=label,
                    issue="匹配等待期内容真空（P8，待访谈验证）",
                    evidence=f"{len(queued)} 位学员排队超 14 天未收到进度通知（例：{queued[0].get('name','')} 已等 {queued[0]['wait_days']} 天）",
                    action="接入 D3 青桥进度信：报名/排队/匹配三态模板自动发；先向机构确认真实匹配周期",
                    priority=2,
                ))

    # ---- G5 合规红线（全局，最高优先级）----
    # 对所有建议卡文案做词面拦截；命中即出 P1 卡并把原卡降级为「待人工复核」。
    flagged = []
    for c in cards:
        hits = check_compliance(c.issue + c.action)
        if hits:
            flagged.append((c, hits))
    for c, hits in flagged:
        cards.append(CalibrationCard(
            platform=c.platform,
            issue="建议文案命中合规红线，禁止直接发布",
            evidence="；".join(hits),
            action=f"人工改写后复核；募捐表述唯一合法口径：「{FILING_NAME}」（备案名，确证）",
            priority=1,
        ))

    # ---- G6 品牌落地（W2）----
    # 依据：官网调研 §2「新品牌只覆盖首屏，正文仍是旧模板」； posts 带 brand 字段时判定。
    for key, data in gathered.items():
        meta = CGY_ACCOUNTS.get(key)
        posts = data.get("posts")
        if not meta or not posts:
            continue
        off_brand = [p for p in posts if p.get("brand") == "legacy"]
        if off_brand:
            cards.append(CalibrationCard(
                platform=meta["name"],
                issue="内容仍用旧品牌模板（W2：品牌 3.0 未落地）",
                evidence=f"{len(off_brand)}/{len(posts)} 篇标记 legacy 版式",
                action="用 D1 海报页签的品牌 3.0 规范（#79D3F2/#FAF7E8/#FC9B00/#5A2D0C/#9BD500）统一新版式",
                priority=2,
            ))

    # ---- G7 全局兜底（继承原 R4 语义：全部 0 卡才补 1 张）----
    if not cards:
        cards.append(CalibrationCard(
            platform="global",
            issue="数据不足以给出强结论",
            evidence="账号指标与台账数据有限（缺字段不补 0）",
            action="请机构提供创作者中心截图 + 活动台账后复跑；先对谈验证 P1–P9 再定阈值",
            priority=3,
        ))
    return cards