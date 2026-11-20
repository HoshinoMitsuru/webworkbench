"""C公益 场景与装配（新增，不改原 scenarios.py / factory.py）。

复用原引擎的全部护栏（controller / loop_guard / tools / degradation 骨架），
只替换三个业务位：
1. prompts → prompts_cgy（公益校准师口径 + 合规红线）
2. platform adapter → CgyDemoAdapter / JSONCgyAdapter（账号矩阵 + 台账）
3. 规则兜底 → suggest_cgy_cards（G0–G7；通过子类覆盖 Degradation 的取卡函数，
   不改原 Degradation 类，终止态语义零改动）

场景（与原四场景一一对应，另加公益特有场景）：
- cgy_normal    正常收敛：采 4 账号 stats+posts → 规则卡 emit
- cgy_loop      死循环拦截（护栏演示，语义同原 loop）
- cgy_llmdown   LLM 不可用 → G 规则兜底卡
- cgy_tooldown  某账号数据失败 → 跳过继续
- cgy_compliance 建议文案含红线词 → G5 拦截卡（公益特有）
- cgy_waiting   青桥排队超期 → G4 等待期卡（公益特有，P8）
"""
from __future__ import annotations

from typing import Optional, Callable, Dict, Any, List

from .controller import AgentController, AgentConfig
from .tools import build_default_registry
from .loop_guard import LoopGuard
from .degradation import Degradation
from .observability import Observability
from .llm_client import MockLLM, LLMResponse, ToolCall
from . import prompts_cgy
from .domain_cgy import suggest_cgy_cards, CGY_ACCOUNTS
from ..platforms.platforms_cgy import CgyDemoAdapter, JSONCgyAdapter

DEFAULT_ACCOUNTS = ["wechat_zanjin", "wechat_zhongcao", "xhs_zanjin", "xhs_xiaoc"]


class CgyDegradation(Degradation):
    """降级取卡换成 G 规则集；降级路径/埋点/语义与原类完全一致。"""

    def __init__(self, obs=None, ledger_rows=None, queue_rows=None, month: str = "2026-10"):
        super().__init__(obs=obs)
        self.ledger_rows = ledger_rows if ledger_rows is not None else []
        self.queue_rows = queue_rows if queue_rows is not None else []
        self.month = month

    def _cards(self, state, gathered=None):
        # 台账 + 匹配队列合并进规则数据源（G4 需要 queue 行）
        rows = list(self.ledger_rows)
        if self.queue_rows:
            rows = rows + list(self.queue_rows)
        return suggest_cgy_cards(gathered if gathered is not None else state.gathered,
                                 ledger_rows=rows, month=self.month)

    def llm_unavailable(self, state):
        if self.obs:
            self.obs.span(state.trace, "degrade.llm_unavailable",
                          gathered_platforms=list(state.gathered.keys()))
        return self._cards(state)

    def on_loop(self, state):
        if self.obs:
            self.obs.span(state.trace, "degrade.loop_detected")
        return self._cards(state)

    def finalize_partial(self, state, reason):
        from .domain import CalibrationReport
        cards = self._cards(state)
        return CalibrationReport(
            cards=cards,
            summary=f"因 {reason} 提前结束，以下为基于已采集数据的 C公益 部分校准（已降级）。",
            data_availability=state.data_availability,
            degraded=state.degraded + [reason],
            meta={"reason": reason},
        )


def _rule_cards_for(accounts, adapter, month):
    """用适配器数据预演 G 规则，作为 MockLLM 的 emit 脚本（演示「规则即判断」）。"""
    gathered = {}
    for a in accounts:
        try:
            from .domain import analyze_stats
            gathered[a] = {"stats": analyze_stats(adapter.fetch_stats(a, "", "30d", "demo")),
                           "posts": adapter.fetch_posts(a, "", 20, "demo")}
        except Exception:
            continue
    rows = list(adapter.ledger_rows) + list(adapter.queue_rows)
    cards = suggest_cgy_cards(gathered, ledger_rows=rows, month=month)
    return [c.to_dict() for c in cards]


def build_cgy_scenario(name: str, accounts: List[str], period: str, month: str,
                       adapter: Optional[CgyDemoAdapter] = None):
    adapter = adapter or CgyDemoAdapter()
    first = accounts[0] if accounts else "wechat_zanjin"

    if name == "cgy_loop":
        single = ToolCall("L1", "fetch_platform_stats", {"platform": first, "account": "C公益"})
        return MockLLM([LLMResponse(tool_calls=[single])] * 5), adapter

    if name == "cgy_llmdown":
        return MockLLM([LLMResponse(is_degraded=True)]), adapter

    if name == "cgy_tooldown":
        adapter = CgyDemoAdapter(fail_accounts={first},
                                 ledger_rows=adapter.ledger_rows, queue_rows=adapter.queue_rows)
        calls = [ToolCall(f"s{i}", "fetch_platform_stats",
                          {"platform": a, "account": "C公益", "period": period})
                 for i, a in enumerate(accounts)]
        cards = _rule_cards_for(accounts[1:], adapter, month) or [{
            "platform": "global", "issue": "数据不足", "evidence": "全部账号失败",
            "action": "补数据后复跑", "priority": 3}]
        emit = ToolCall("E1", "emit_calibration_cards", {"cards": cards, "summary": "cgy tooldown demo"})
        return MockLLM([LLMResponse(tool_calls=calls), LLMResponse(tool_calls=[emit])]), adapter

    if name == "cgy_compliance":
        # 模拟模型给出含红线词的建议：G5 在规则层拦截；emit 的卡先过 check_compliance
        calls = [ToolCall(f"s{i}", "fetch_platform_stats",
                          {"platform": a, "account": "C公益", "period": period})
                 for i, a in enumerate(accounts)]
        bad_cards = [{"platform": "攒劲青年", "issue": "劝募文案可写「捐款返利，百分百透明」",
                      "evidence": "demo", "action": "直接发布", "priority": 1}]
        from .domain_cgy import check_compliance
        safe_cards = []
        for c in bad_cards:
            hits = check_compliance(c["issue"] + c["action"])
            if hits:
                safe_cards.append({"platform": c["platform"],
                                   "issue": "建议文案命中合规红线，禁止直接发布",
                                   "evidence": "；".join(hits),
                                   "action": "人工改写后复核；募捐口径用备案名「打破资源鸿沟 点亮西北未来」",
                                   "priority": 1})
            else:
                safe_cards.append(c)
        emit = ToolCall("E1", "emit_calibration_cards", {"cards": safe_cards, "summary": "cgy compliance demo"})
        return MockLLM([LLMResponse(tool_calls=calls), LLMResponse(tool_calls=[emit])]), adapter

    # cgy_normal / cgy_waiting（默认）：采 stats+posts → 规则卡 emit
    calls = []
    for i, a in enumerate(accounts):
        calls.append(ToolCall(f"s{i}", "fetch_platform_stats",
                              {"platform": a, "account": "C公益", "period": period}))
        calls.append(ToolCall(f"p{i}", "fetch_platform_posts",
                              {"platform": a, "account": "C公益", "limit": 20}))
    cards = _rule_cards_for(accounts, adapter, month)
    emit = ToolCall("E1", "emit_calibration_cards",
                    {"cards": cards, "summary": f"C公益 {month} 内容运营校准（演示数据）"})
    return MockLLM([LLMResponse(tool_calls=calls), LLMResponse(tool_calls=[emit])]), adapter


def build_cgy_controller(scenario: str = "cgy_normal",
                         accounts: Optional[List[str]] = None,
                         period: str = "30d",
                         month: str = "2026-10",
                         cfg_overrides: Optional[Dict[str, Any]] = None,
                         human_takeover: Optional[Callable[[], bool]] = None,
                         data_path: Optional[str] = None) -> AgentController:
    accounts = accounts if accounts is not None else list(DEFAULT_ACCOUNTS)
    base_adapter = JSONCgyAdapter(data_path) if data_path else CgyDemoAdapter()
    llm, adapter = build_cgy_scenario(scenario, accounts, period, month, adapter=base_adapter)
    cfg = AgentConfig(human_takeover=human_takeover)
    if cfg_overrides:
        for k, v in cfg_overrides.items():
            setattr(cfg, k, v)
    obs = Observability()
    degr = CgyDegradation(obs=obs, ledger_rows=adapter.ledger_rows,
                          queue_rows=getattr(adapter, "queue_rows", []), month=month)
    ctrl = AgentController(
        cfg=cfg, llm=llm, tools=build_default_registry(), platform=adapter,
        obs=obs, loop_guard=LoopGuard(max_repeat=cfg.max_repeat),
        degradation=degr, prompts=prompts_cgy,
    )
    return ctrl