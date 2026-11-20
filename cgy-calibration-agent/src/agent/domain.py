"""领域层：校准动作卡数据模型 + 内容创作业务规则（泛自媒体运营）。

为什么放这里：业务规则是"行业理解 + 业务判断"的载体，必须与编排/工具解耦，
方便评测与降级时复用（LLM 挂掉也能用规则产出兜底卡）。
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any


# 比赛要求"选择一个具体行业、一个具体岗位" -> 这里落地为泛内容创作/自媒体运营
SUPPORTED_PLATFORMS = [
    "devto", "hashnode", "medium", "wechat",
    "xiaohongshu", "zhihu", "bilibili",
]


@dataclass
class CalibrationCard:
    """一张校准动作卡 = 给创作者的可执行建议。"""
    platform: str          # 针对哪个平台
    issue: str             # 观察到的业务问题
    evidence: str          # 证据（来自工具返回的数据）
    action: str            # 建议动作
    priority: int = 2      # 1=最高 2=中 3=低

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "CalibrationCard":
        return CalibrationCard(
            platform=str(d.get("platform", "")),
            issue=str(d.get("issue", "")),
            evidence=str(d.get("evidence", "")),
            action=str(d.get("action", "")),
            priority=int(d.get("priority", 2)),
        )

    def validate(self) -> List[str]:
        errs: List[str] = []
        if not self.platform:
            errs.append("platform 为空")
        if not (1 <= self.priority <= 3):
            errs.append("priority 须在 1..3")
        if not self.action:
            errs.append("action 为空")
        if not self.issue:
            errs.append("issue 为空")
        return errs


@dataclass
class CalibrationReport:
    cards: List[CalibrationCard] = field(default_factory=list)
    summary: str = ""
    data_availability: Dict[str, str] = field(default_factory=dict)  # platform -> ok|failed|skipped
    degraded: List[str] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cards": [c.to_dict() for c in self.cards],
            "summary": self.summary,
            "data_availability": self.data_availability,
            "degraded": self.degraded,
            "meta": self.meta,
        }


def parse_period(period: str) -> int:
    """'30d' -> 30；无法解析回退 30。"""
    try:
        if isinstance(period, str) and period.endswith("d"):
            return int(period[:-1])
        return int(period)
    except Exception:
        return 30


def analyze_stats(stats: Dict[str, Any]) -> Dict[str, Any]:
    """从平台统计算出业务指标，供规则与 LLM 共用。

    🔴 三条不变量：
    1.（2026-11-14 补丁，PA-5 缺口2）判定用原始值：本函数只把 `engagement_rate`
       四舍五入到 4 位**供展示/证据**，另返回未舍入的 `engagement_rate_raw`
       供规则判定使用。禁止用舍入值比阈值。
    2.（2026-11-14 补丁，PA-5 缺口1）缺字段不补 0：任一必填字段缺失/为 None 时，
       返回 `missing_fields` 非空、`engagement_rate` 为 None，调用方据此跳过该平台、
       标「未获取数据」，不许补 0 推断。
       （补 0 会把「缺评论」算成「评论=0」，凭空造出 R1/R3 卡。）
    3.（2026-11-15 D3 修复，蒋平授权）扩展指标原样透传：原实现只回传四个必填字段，
       静默裁掉 `stats["extra"]` 里的发布数/收藏/分享/活跃粉丝占比，导致模型误判
       「数据缺失」并写出「发布数 None」（接口实际返回 344）。
       原则：原样透传，不推断、不补 0、不改键名；不覆盖核心字段；幂等。
    """
    REQUIRED = ("views", "likes", "comments", "followers")
    missing = [k for k in REQUIRED if stats.get(k) is None]

    if missing:
        # 不补 0、不推断：只回显已拿到的字段，其余保持 None
        result: Dict[str, Any] = {
            "followers": _opt_int(stats.get("followers")),
            "views": _opt_int(stats.get("views")),
            "likes": _opt_int(stats.get("likes")),
            "comments": _opt_int(stats.get("comments")),
            "engagement_rate": None,
            "engagement_rate_raw": None,
            "missing_fields": missing,
        }
        return _passthrough_extra(stats, result)

    followers = float(stats["followers"])
    views = float(stats["views"])
    likes = float(stats["likes"])
    comments = float(stats["comments"])
    engagement_raw = (likes + comments) / views if views > 0 else 0.0
    result = {
        "followers": int(followers),
        "views": int(views),
        "likes": int(likes),
        "comments": int(comments),
        # 展示用（4 位）；判定请用 engagement_rate_raw，勿反哺
        "engagement_rate": round(engagement_raw, 4),
        "engagement_rate_raw": engagement_raw,
        "missing_fields": [],
    }
    return _passthrough_extra(stats, result)


# 核心字段集：D3 透传时不得覆盖（含本模块自有键，避免外部同名键冲掉计算结果）
_CORE_KEYS = {
    "followers", "views", "likes", "comments",
    "engagement_rate", "engagement_rate_raw", "missing_fields", "extra",
}


def _passthrough_extra(stats: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
    """D3（2026-11-15）：把平台扩展指标原样透传给调用方/LLM。

    形态 A：扩展指标集中在 `stats["extra"]`（实测的裁剪点）；
    形态 B：扩展指标平铺在 `stats` 顶层（兼容不同适配器字段命名）。
    幂等：已在 result 中的键不重复写；不覆盖核心字段；不补 0、不推断、不改键名。
    """
    extra = stats.get("extra")
    if isinstance(extra, dict):
        for k, v in extra.items():
            if isinstance(k, str) and k not in result:
                result[k] = v
    for k, v in stats.items():
        if isinstance(k, str) and k not in _CORE_KEYS and k not in result:
            result[k] = v
    return result


def _opt_int(v: Any) -> Any:
    """缺失字段保持 None（不补 0），有值则转 int。"""
    return None if v is None else int(v)


def _is_measurable(m: Dict[str, Any]) -> bool:
    """该平台指标是否可用于判定（字段齐全且率已算出）。"""
    return not m.get("missing_fields") and m.get("engagement_rate_raw") is not None



def analyze_post(text: str) -> Dict[str, Any]:
    """本地启发式（不调 LLM）：标题钩子、CTA、长度分档。"""
    if not isinstance(text, str):
        text = str(text)
    hook_kw = ["？", "?", "如何", "为什么", "怎样", "揭秘", "干货", "免费", "盘点"]
    cta_kw = ["关注", "点赞", "转发", "收藏", "评论", "订阅"]
    has_hook = any(k in text for k in hook_kw)
    has_cta = any(k in text for k in cta_kw)
    n = len(text)
    if n < 30:
        length_bin = "过短"
    elif n <= 300:
        length_bin = "适中"
    else:
        length_bin = "过长"
    score = 0.4 + (0.3 if has_hook else 0) + (0.3 if has_cta else 0)
    return {
        "length": n,
        "length_bin": length_bin,
        "has_hook": has_hook,
        "has_cta": has_cta,
        "score": round(min(score, 1.0), 2),
    }


def suggest_actions_from_data(gathered: Dict[str, Any]) -> List[CalibrationCard]:
    """规则兜底：LLM 不可用 / 死循环被迫停止时，用已采集数据产出基础校准卡。

    判定口径（2026-11-14 补丁）：
    - R1 用 `engagement_rate_raw`（未舍入）严格小于 0.02，不用展示值；
    - 字段缺失的平台不出卡（标「未获取数据」由调用方处理），严禁补 0 推断；
    - R4 是全局兜底：全部平台累计 0 张卡时才补 1 张，非逐平台兜底。
    """
    cards: List[CalibrationCard] = []
    for platform, data in gathered.items():
        stats = data.get("stats")
        if not stats:
            continue
        m = analyze_stats(stats)
        if not _is_measurable(m):
            # 缺字段 / 未算出率：不判定、不出卡，避免补 0 造卡
            continue
        if m["engagement_rate_raw"] < 0.02:
            cards.append(CalibrationCard(
                platform=platform,
                issue="互动率低于 2%",
                evidence=f"views={m['views']}, likes+comments={m['likes']+m['comments']}",
                action="优化标题钩子与开头 3 秒，增加提问式/利益点式开头",
                priority=1,
            ))
        if m["followers"] < 100:
            cards.append(CalibrationCard(
                platform=platform,
                issue="粉丝基数过小",
                evidence=f"followers={m['followers']}",
                action="提升发布频次（每周 ≥3 篇）并以合集/系列沉淀关注",
                priority=2,
            ))
        if m["views"] > 0 and m["likes"] == 0:
            cards.append(CalibrationCard(
                platform=platform,
                issue="有曝光无点赞",
                evidence=f"views={m['views']}, likes=0",
                action="检查内容价值密度，结尾增加明确 CTA（点赞/收藏）",
                priority=2,
            ))
    if not cards:
        cards.append(CalibrationCard(
            platform="global",
            issue="数据不足以给出强结论",
            evidence="采集到的平台指标有限",
            action="补充多平台数据后复跑校准",
            priority=3,
        ))
    return cards
