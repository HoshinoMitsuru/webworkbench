"""降级策略：当 LLM 不可用 / 死循环 / 工具失败时的安全兜底。

原则：宁可产出"部分、明确标注降级"的结果，也不要崩溃、空转或假绿。
所有降级路径都显式写入 report.degraded，便于复盘与评测判定。
"""
from __future__ import annotations

from typing import List, Dict, Any
from .domain import CalibrationCard, suggest_actions_from_data, CalibrationReport


class Degradation:
    def __init__(self, obs=None):
        self.obs = obs

    def llm_unavailable(self, state) -> List[CalibrationCard]:
        """LLM 重试耗尽 -> 用规则从已采集数据兜底产出校准卡。"""
        if self.obs:
            self.obs.span(state.trace, "degrade.llm_unavailable",
                          gathered_platforms=list(state.gathered.keys()))
        return suggest_actions_from_data(state.gathered)

    def on_loop(self, state) -> List[CalibrationCard]:
        """检测到死循环被迫停止 -> 用已有数据尽力产出。"""
        if self.obs:
            self.obs.span(state.trace, "degrade.loop_detected")
        return suggest_actions_from_data(state.gathered)

    def tool_failed(self, platform: str, err: str) -> Dict[str, Any]:
        """单个工具失败 -> 返回结构化错误结果（不抛异常），循环继续。"""
        return {"ok": False, "error": "tool_failed", "platform": platform, "detail": str(err)}

    def finalize_partial(self, state, reason: str) -> CalibrationReport:
        cards = suggest_actions_from_data(state.gathered)
        return CalibrationReport(
            cards=cards,
            summary=f"因 {reason} 提前结束，以下为基于已采集数据的部分校准（已降级）。",
            data_availability=state.data_availability,
            degraded=state.degraded + [reason],
            meta={"reason": reason},
        )
