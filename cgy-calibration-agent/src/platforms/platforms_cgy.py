"""C公益 账号矩阵适配器（新增，不改原 platforms.py）。

接口与原 PlatformAdapter 完全一致（fetch_stats / fetch_posts），
控制器与护栏对底层无感 —— 这是原引擎「配置驱动适配」设计的直接复用。

🔴 数据口径（诚实标注）：
- 本适配器是 **演示数据适配器**：数值为虚构示例，仅用于对谈演示与评测，
  不代表 C公益 任何账号的真实运营数据。
- 账号名称与矩阵关系来自公开调研（docs/，确证）；运营数值全部虚构。
- 真实接入路径：机构提供创作者中心导出 → 写成 JSON → 换 JSONCgyAdapter
  （本文件下方），或按原引擎 CLIPlatformAdapter 配命令模板。护栏零改动。
- 「来自西北的小C同学」故意返回缺字段数据：演示不变量2（缺数据不补0不造卡）。
"""
from __future__ import annotations

import json
from typing import Dict, List, Any

from .platforms import PlatformAdapter, PlatformError
from ..agent.domain_cgy import CGY_ACCOUNTS

# ---- 演示统计（虚构；account_key -> stats）----
# 设计意图：
# - 主号互动率达标但产能不足（G2 触发）；
# - 旧号互动率低（继承 R1 触发）+ 仍在发新内容（G1 触发）；
# - 小红书主号三类内容占比低（G3 触发）+ 旧版式（G6 触发）；
# - 小C同学缺字段（不变量2：不补 0、出「未获取」卡）。
_DEMO_STATS: Dict[str, Dict[str, Any]] = {
    "wechat_zanjin": {"followers": 860, "views": 5200, "likes": 140, "comments": 26},
    "wechat_zhongcao": {"followers": 1200, "views": 3000, "likes": 30, "comments": 6},
    "xhs_zanjin": {"followers": 95, "views": 1800, "likes": 15, "comments": 2},
    "xhs_xiaoc": {"followers": 12, "views": None, "likes": None, "comments": None},
}

# ---- 演示内容列表（虚构；content_type/brand 为 C公益 扩展字段，走原样透传）----
_DEMO_POSTS: Dict[str, List[Dict[str, Any]]] = {
    "wechat_zanjin": [
        {"id": "wz-1", "title": "攒劲青年主理人十月刊｜让幸福定格此刻",
         "published_at": "2026-10-31", "content_type": "monthly", "brand": "v3",
         "views": 2100, "likes": 68, "comments": 12},
        {"id": "wz-2", "title": "2026 年 10 月核心团队志愿者招募",
         "published_at": "2026-10-15", "content_type": "recruit", "brand": "legacy",
         "views": 1500, "likes": 41, "comments": 8},
    ],
    "wechat_zhongcao": [
        {"id": "wzc-1", "title": "活动回顾｜人生故事会第 16 期",
         "published_at": "2026-10-20", "content_type": "review", "brand": "legacy",
         "views": 900, "likes": 12, "comments": 2},
    ],
    "xhs_zanjin": [
        {"id": "xz-1", "title": "攒劲青年主理人招募啦！！！",
         "published_at": "2026-10-08", "content_type": "recruit", "brand": "legacy",
         "views": 600, "likes": 3, "comments": 0},
        {"id": "xz-2", "title": "项目助理招聘｜WE NEED U",
         "published_at": "2026-10-12", "content_type": "recruit", "brand": "legacy",
         "views": 700, "likes": 12, "comments": 1},
        {"id": "xz-3", "title": "一日职业体验回归啦！",
         "published_at": "2026-10-18", "content_type": "recruit", "brand": "v3",
         "views": 300, "likes": 0, "comments": 0},
        {"id": "xz-4", "title": "贺兰山净山行｜现场反馈",
         "published_at": "2026-10-26", "content_type": "feedback", "brand": "v3",
         "views": 200, "likes": 0, "comments": 1},
    ],
    "xhs_xiaoc": [],
}

# ---- 演示活动台账（虚构；字段与 demo/d2-monthly-report.html 完全同源）----
_DEMO_LEDGER: List[Dict[str, Any]] = [
    {"name": "一日职业体验 · 慢焙咖啡", "line": "zhiye", "host": "周予安", "date": "2026-10-12", "count": 8, "place": "银川 · 慢焙咖啡工作室", "detail": "每人亲手烘了一锅豆子", "recorder": "项目组·小林"},
    {"name": "一日职业体验 · 独立书店", "line": "zhiye", "host": "许知远", "date": "2026-10-18", "count": 6, "place": "银川 · 岛上书店", "detail": "跟完了进书上架盘点全流程", "recorder": "项目组·小林"},
    {"name": "一日职业体验 · 宠物医院", "line": "zhiye", "host": "杨医生", "date": "2026-10-26", "count": 9, "place": "银川 · 安心宠物医院", "detail": "旁观术前准备", "recorder": "项目组·小林"},
    {"name": "音乐客厅 · 黑胶夜谈", "line": "zhuliren", "host": "马欣宇", "date": "2026-10-20", "count": 12, "place": "银川 · 蘭山文化空间", "detail": "关灯听完整张 B 面", "recorder": "主理人自报"},
    {"name": "发疯现场 · 期末前夜", "line": "zhuliren", "host": "丁一禾", "date": "2026-10-24", "count": 15, "place": "银川 · 大学城共享空间", "detail": "每人喊出一件憋了很久的事", "recorder": "主理人自报"},
    {"name": "库库花钱大富翁", "line": "zhuliren", "host": "陈暮", "date": "2026-10-11", "count": 20, "place": "银川 · 建发大阅城", "detail": "模拟一个月开销决策", "recorder": "主理人自报"},
    {"name": "人生拍卖会 · 第二季", "line": "zhuliren", "host": "何声", "date": "2026-10-31", "count": 10, "place": "银川 · 青年之家", "detail": "「健康」拍得全场最高价", "recorder": "主理人自报"},
    {"name": "游拾计划 · 苏峪口净山", "line": "youshi", "host": "贺兰山小队", "date": "2026-10-17", "count": 22, "place": "贺兰山 · 苏峪口步道", "detail": "清出 14 袋垃圾分类称重", "recorder": "执行组·阿澈"},
    {"name": "游拾计划 · 亲子净山场", "line": "youshi", "host": "贺兰山小队", "date": "2026-10-25", "count": 18, "place": "贺兰山 · 滚钟口", "detail": "最小志愿者 6 岁", "recorder": "执行组·阿澈"},
    {"name": "青桥计划 · 第 27 期见面会", "line": "qingqiao", "host": "项目组", "date": "2026-10-09", "count": 28, "place": "线上 · 腾讯会议", "detail": "28 位学员首次 1v1", "recorder": "青桥项目组"},
]

# ---- 演示匹配队列（虚构；P8 等待期规则的数据源，与 demo/d3 同源字段）----
_DEMO_QUEUE: List[Dict[str, Any]] = [
    {"name": "王同学", "line": "qingqiao", "stage": "queued", "wait_days": 16, "progress_notified": False},
    {"name": "李同学", "line": "qingqiao", "stage": "queued", "wait_days": 9, "progress_notified": False},
    {"name": "张同学", "line": "qingqiao", "stage": "matched", "wait_days": 16, "progress_notified": True},
]


class CgyDemoAdapter(PlatformAdapter):
    """C公益 演示适配器：account_key 即引擎口径里的 platform 参数。

    fail_accounts 用于 tooldown 场景（模拟某账号数据拿不到）。
    所有返回均为确定性数据（无随机），评测可复现。
    """

    def __init__(self, fail_accounts: set = None,
                 ledger_rows: List[Dict[str, Any]] = None,
                 queue_rows: List[Dict[str, Any]] = None):
        self.fail_accounts = set(fail_accounts or [])
        self.ledger_rows = ledger_rows if ledger_rows is not None else _DEMO_LEDGER
        self.queue_rows = queue_rows if queue_rows is not None else _DEMO_QUEUE

    def fetch_stats(self, platform: str, account: str, period: str, trace_id: str) -> Dict[str, Any]:
        if platform in self.fail_accounts:
            raise PlatformError(f"cgy-demo: {platform} 数据获取失败（模拟）")
        if platform not in CGY_ACCOUNTS:
            raise PlatformError(f"cgy-demo: 未知账号 {platform}（不在机构账号矩阵内）")
        base = dict(_DEMO_STATS[platform])
        # 扩展字段原样透传（不变量3）：台账摘要挂 extra，供规则/LLM 引用
        base["extra"] = {"account_name": CGY_ACCOUNTS[platform]["name"],
                         "account_status": CGY_ACCOUNTS[platform]["status"],
                         "data_source": "虚构演示数据（对谈用，非真实运营数）"}
        return base

    def fetch_posts(self, platform: str, account: str, limit: int, trace_id: str) -> List[Dict[str, Any]]:
        if platform in self.fail_accounts:
            raise PlatformError(f"cgy-demo: {platform} 内容列表获取失败（模拟）")
        if platform not in CGY_ACCOUNTS:
            raise PlatformError(f"cgy-demo: 未知账号 {platform}")
        posts = _DEMO_POSTS.get(platform, [])
        return [dict(p) for p in posts[:max(1, min(limit, 20))]]


class JSONCgyAdapter(PlatformAdapter):
    """真实数据接入位：机构导出创作者中心数据 → JSON 文件 → 本适配器。

    JSON 结构：{"stats": {account_key: {...}}, "posts": {account_key: [...]},
               "ledger": [...], "queue": [...]}
    缺字段保持 null（不补 0）；文件不存在/解析失败抛 PlatformError 走原降级。
    🔴 只读机构自己导出的文件，不抓取、不联网、不碰平台凭据。
    """

    def __init__(self, path: str):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            raise PlatformError(f"cgy-json: 数据文件不可用 {e}")
        self._stats = data.get("stats", {})
        self._posts = data.get("posts", {})
        self.ledger_rows = data.get("ledger", [])
        self.queue_rows = data.get("queue", [])

    def fetch_stats(self, platform: str, account: str, period: str, trace_id: str) -> Dict[str, Any]:
        if platform not in self._stats:
            raise PlatformError(f"cgy-json: 无 {platform} 的统计数据（未获取，不推断）")
        return dict(self._stats[platform])

    def fetch_posts(self, platform: str, account: str, limit: int, trace_id: str) -> List[Dict[str, Any]]:
        if platform not in self._posts:
            raise PlatformError(f"cgy-json: 无 {platform} 的内容列表（未获取，不推断）")
        return [dict(p) for p in self._posts[platform][:max(1, min(limit, 50))]]