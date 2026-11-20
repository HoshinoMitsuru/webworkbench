"""控制器：有界自主循环 + 停止条件 + 超时/重试/降级编排。

这是"死循环/乱调工具"问题的总闸：
- 停止条件：max_steps / 墙钟 / token 预算 / 终态工具 / 人类接管 / 无进展 / 循环检测。
- 乱调工具：白名单拦截 + 参数校验（见 tools.ToolRegistry）。
- 每个工具调用都被循环守卫判重，重复超阈值即拦截。
- 工具失败不抛异常，返回结构化错误并继续；LLM 失败走降级。
"""
from __future__ import annotations

import time
import json
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Callable, Tuple

from .observability import Observability
from .domain import CalibrationCard, CalibrationReport, analyze_stats, analyze_post
from .llm_client import LLMResponse, ToolCall, BaseLLM
from .tools import ToolRegistry
from .loop_guard import LoopGuard
from .degradation import Degradation
from ..platforms.platforms import PlatformAdapter, PlatformError


@dataclass
class AgentConfig:
    max_steps: int = 12
    max_wall_clock_s: float = 120.0
    token_budget: int = 8000
    max_no_progress: int = 3
    max_repeat: int = 3
    human_takeover: Optional[Callable[[], bool]] = None  # 返回 True 即停止
    confirm_callback: Optional[Callable[[Any], bool]] = None  # 危险工具的人工确认回调


@dataclass
class AgentState:
    task: dict
    trace: Any = None
    step: int = 0
    messages: List[Dict[str, Any]] = field(default_factory=list)
    gathered: Dict[str, Any] = field(default_factory=dict)       # platform -> {stats, posts}
    data_availability: Dict[str, str] = field(default_factory=dict)
    final_cards: List[CalibrationCard] = field(default_factory=list)
    final_text: str = ""
    degraded: List[str] = field(default_factory=list)
    no_progress_streak: int = 0
    est_tokens: int = 0
    llm_calls: int = 0
    tool_calls_total: int = 0
    tool_failures: int = 0
    blocked_calls: int = 0   # 被守卫拦截的调用数（越权/非法参数/重复），量化"乱调工具"
    finalized: bool = False


@dataclass
class AgentResult:
    report: CalibrationReport
    reason_stopped: str
    metrics: Dict[str, Any]
    trace_id: str


class AgentController:
    def __init__(self, cfg: AgentConfig, llm: BaseLLM, tools: ToolRegistry,
                 platform: PlatformAdapter, obs: Observability, loop_guard: LoopGuard,
                 degradation: Degradation, prompts):
        self.cfg = cfg
        self.llm = llm
        self.tools = tools
        self.platform = platform
        self.obs = obs
        self.loop_guard = loop_guard
        self.degr = degradation
        self.prompts = prompts

    def run(self, task: dict) -> AgentResult:
        trace = self.obs.start_trace(task)
        state = AgentState(task=task, trace=trace)
        state.messages = [
            {"role": "system", "content": self.prompts.SYSTEM_PROMPT},
            {"role": "user", "content": self.prompts.format_task(task)},
        ]
        start = time.monotonic()
        reason = "unknown"

        # 显式有界循环：for 而非 while，max_steps 是硬上限（满足 C5）
        for _ in range(self.cfg.max_steps):
            state.step += 1
            # ---- 停止条件（多重闸门）----
            if time.monotonic() - start > self.cfg.max_wall_clock_s:
                reason = "wall_clock"; break
            if state.est_tokens > self.cfg.token_budget:
                reason = "token_budget"; break
            if self.cfg.human_takeover and self.cfg.human_takeover():
                reason = "human_takeover"; break

            # ---- LLM 决策（超时/重试/降级在客户端内完成）----
            try:
                resp = self.llm.call(state.messages, self.tools.schemas(), trace.trace_id)
            except Exception as e:  # 客户端应已吞噬，这里兜底防崩
                self.obs.span(trace, "llm_exception", error=str(e)[:200])
                resp = LLMResponse(is_degraded=True)
            state.llm_calls += 1
            state.est_tokens += resp.est_tokens

            if resp.is_degraded:
                state.degraded.append("llm_unavailable")
                state.final_cards = self.degr.llm_unavailable(state)
                reason = "llm_degraded"; break

            if not resp.tool_calls:
                state.final_text = resp.content
                # 区分"模型主动收尾"与"压根没采到数据"：后者是故障态，必须单独命名，
                # 否则报告里会出现一个看似正常、实则无依据的 llm_no_tool。
                if not state.gathered and not (resp.content or "").strip():
                    state.degraded.append("no_data")
                    reason = "no_data"; break
                reason = "llm_no_tool"; break

            # 记录 assistant 轮（含 tool_calls）供下一轮上下文
            state.messages.append({
                "role": "assistant",
                "content": resp.content or None,
                "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.name, "arguments": json.dumps(tc.arguments, ensure_ascii=False)}}
                    for tc in resp.tool_calls
                ],
            })

            progressed = False
            hit_loop = False
            for tc in resp.tool_calls:
                sig = self.tools.normalize(tc)
                # 循环检测：重复调用拦截
                if self.loop_guard.is_repeat(sig):
                    state.blocked_calls += 1
                    state.degraded.append(f"loop:{tc.name}")
                    hit_loop = True
                    state.messages.append(self._tool_msg(tc.id, {
                        "error": "loop_guard_blocked", "detail": "重复调用超过阈值，已拦截"}))
                    continue
                # 乱调工具：白名单拦截
                if not self.tools.is_allowed(tc.name):
                    # 越权调用不计入"已执行"，单独计 blocked_calls
                    state.blocked_calls += 1
                    state.messages.append(self._tool_msg(tc.id, {
                        "error": "tool_not_allowed", "allowed": self.tools.allowed_names()}))
                    continue
                # 参数校验
                ok, errs = self.tools.validate(tc.name, tc.arguments)
                if not ok:
                    state.blocked_calls += 1
                    state.messages.append(self._tool_msg(tc.id, {"error": "invalid_args", "detail": errs}))
                    continue

                spec = self.tools.specs[tc.name]
                # 危险操作闸：未注入确认回调或未获批准，一律拒绝执行（C6）。
                # 只写文档不加可执行校验 = 约束等于没有约束。
                if spec.requires_confirmation:
                    approved = bool(self.cfg.confirm_callback(tc)) if self.cfg.confirm_callback else False
                    if not approved:
                        state.blocked_calls += 1
                        state.degraded.append(f"confirm_denied:{tc.name}")
                        state.messages.append(self._tool_msg(tc.id, {
                            "error": "confirmation_required",
                            "detail": "危险工具须 human-in-the-loop 二次确认"}))
                        continue
                # 终态工具：输出校准卡 -> 成功结束
                if spec.is_terminal:
                    cards, cerr = self._parse_cards(tc.arguments)
                    if cerr:
                        state.blocked_calls += 1
                        state.messages.append(self._tool_msg(tc.id, {"error": "invalid_cards", "detail": cerr}))
                        continue
                    state.final_cards = cards
                    state.finalized = True
                    reason = "final_tool"
                    return self._finalize(state, reason, start, trace, cards, success=True)

                # 普通工具：执行（带超时/失败降级）
                state.tool_calls_total += 1
                result = self._exec_tool(tc, state)
                state.messages.append(self._tool_msg(tc.id, result))
                progressed = True

            if hit_loop:
                state.final_cards = self.degr.on_loop(state)
                reason = "loop_detected"; break
            if not progressed:
                state.no_progress_streak += 1
                if state.no_progress_streak >= self.cfg.max_no_progress:
                    reason = "no_progress"; break
            else:
                state.no_progress_streak = 0
        else:
            # for 自然耗尽（既没 break 也没 return）= 触达步数上限。
            # 必须显式命名停止原因，否则停在 "unknown" 会让事故无法定位。
            reason = "max_steps"

        # 非终态退出：用已采集数据做部分结果
        cards = state.final_cards or self.degr.finalize_partial(state, reason).cards
        return self._finalize(state, reason, start, trace, cards, success=False)

    # ---------------- 内部 ----------------
    def _exec_tool(self, tc: ToolCall, state: AgentState) -> Dict[str, Any]:
        platform = tc.arguments.get("platform", "")
        account = tc.arguments.get("account", "")
        try:
            if tc.name == "fetch_platform_stats":
                data = self.platform.fetch_stats(platform, account, tc.arguments.get("period", "30d"), state.trace.trace_id)
                m = analyze_stats(data)
                state.gathered.setdefault(platform, {})["stats"] = m
                state.data_availability[platform] = "ok"
                return {"ok": True, "platform": platform, "stats": m}
            if tc.name == "fetch_platform_posts":
                limit = int(tc.arguments.get("limit", 10))
                posts = self.platform.fetch_posts(platform, account, limit, state.trace.trace_id)
                state.gathered.setdefault(platform, {})["posts"] = posts
                state.data_availability[platform] = state.data_availability.get(platform, "ok")
                return {"ok": True, "platform": platform, "posts": posts}
            if tc.name == "analyze_post":
                return {"ok": True, "analysis": analyze_post(tc.arguments.get("text", ""))}
        except PlatformError as e:
            state.tool_failures += 1
            state.data_availability[platform] = "failed"
            state.degraded.append(f"tool_failed:{platform}")
            return self.degr.tool_failed(platform, e)
        except Exception as e:
            state.tool_failures += 1
            return {"ok": False, "error": "unexpected", "detail": str(e)[:200]}
        return {"ok": False, "error": "unhandled_tool", "name": tc.name}

    def _tool_msg(self, tc_id: str, content: Dict[str, Any]) -> Dict[str, Any]:
        return {"role": "tool", "tool_call_id": tc_id,
                "content": json.dumps(content, ensure_ascii=False)}

    def _parse_cards(self, args: Dict[str, Any]) -> Tuple[List[CalibrationCard], List[str]]:
        raw = args.get("cards", [])
        if not isinstance(raw, list):
            return [], ["cards 必须是数组"]
        cards: List[CalibrationCard] = []
        errs: List[str] = []
        for i, item in enumerate(raw):
            c = CalibrationCard.from_dict(item)
            ve = c.validate()
            if ve:
                errs.append(f"card[{i}]:{ve}")
            else:
                cards.append(c)
        if not cards:
            errs.append("没有任何合法校准卡")
        return cards, errs

    def _finalize(self, state: AgentState, reason: str, start: float, trace, cards: List[CalibrationCard], success: bool) -> AgentResult:
        duration_ms = int((time.monotonic() - start) * 1000)
        summary = state.final_text or (
            "已完成一轮内容运营校准，输出 %d 张校准动作卡。" % len(cards))
        report = CalibrationReport(
            cards=cards,
            summary=summary,
            data_availability=state.data_availability,
            degraded=state.degraded,
            meta={
                "reason": reason,
                "success": success,
                "steps": state.step,
                "platforms": list(state.gathered.keys()),
            },
        )
        metrics = {
            "steps": state.step,
            "llm_calls": state.llm_calls,
            "tool_calls_total": state.tool_calls_total,
            "tool_failures": state.tool_failures,
            "blocked_calls": state.blocked_calls,
            "duration_ms": duration_ms,
            "est_tokens": state.est_tokens,
            "reason_stopped": reason,
            "degraded": state.degraded,
        }
        self.obs.end_trace(trace, {"reason": reason, "success": success, "steps": state.step})
        return AgentResult(report=report, reason_stopped=reason, metrics=metrics, trace_id=trace.trace_id)
