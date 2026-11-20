"""评测：≥20 条用例，覆盖正常 / 边界 / 对抗（死循环、越权工具、超长输入、工具失败）。

通过线：全部用例达到各自预期停止原因且无异常崩溃。
运行：python tests/test_eval.py
"""
from __future__ import annotations

import os
import sys
# 与 cwd 解耦：tests/ 的上一级即包根
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.factory import build_controller
from src.agent.tools import build_default_registry, ToolSpec
from src.agent.llm_client import MockLLM, LLMResponse, ToolCall

PLATFORMS_POOL = [["devto"], ["devto", "hashnode"], ["devto", "hashnode", "zhihu"]]
PERIODS = ["7d", "30d", "90d"]

PASS = 0
FAIL = 0
FAILURES = []


def run_case(name, scenario, platforms, period, creator, expected_reason,
             expect_cards=True, cfg_overrides=None, human_takeover=None):
    global PASS, FAIL
    try:
        ctrl = build_controller(scenario=scenario, platforms=platforms, period=period,
                                creator=creator, cfg_overrides=cfg_overrides,
                                human_takeover=human_takeover)
        task = {"creator": creator, "platforms": platforms, "period": period, "focus": "x"}
        res = ctrl.run(task)
        ok = (res.reason_stopped == expected_reason)
        if expect_cards:
            ok = ok and len(res.report.cards) > 0
        if ok:
            PASS += 1
            print(f"[PASS] {name}: reason={res.reason_stopped} cards={len(res.report.cards)}")
        else:
            FAIL += 1
            FAILURES.append(f"{name}: got reason={res.reason_stopped} cards={len(res.report.cards)} expected={expected_reason}")
            print(f"[FAIL] {name}: got reason={res.reason_stopped} cards={len(res.report.cards)} expected={expected_reason}")
    except Exception as e:
        FAIL += 1
        FAILURES.append(f"{name}: 异常 {e!r}")
        print(f"[FAIL] {name}: 异常 {e!r}")


# ---- 正常 / 故障场景矩阵（4 x 3 x 3 = 36 条）----
for scen, exp in [("normal", "final_tool"), ("tooldown", "final_tool"),
                  ("loop", "loop_detected"), ("llmdown", "llm_degraded")]:
    for pl in PLATFORMS_POOL:
        for pd in PERIODS:
            run_case(f"{scen}|{','.join(pl)}|{pd}", scen, pl, pd, "alice", exp)

# ---- 对抗：越权工具调用（乱调工具）应被拒绝且不崩溃 ----
def disallowed_case():
    global PASS, FAIL
    reg = build_default_registry()
    # 脚本：先调一个白名单外的工具，再正常 emit
    bad = ToolCall("x1", "delete_account", {"account": "alice"})
    emit = ToolCall("e1", "emit_calibration_cards",
                    {"cards": [{"platform": "devto", "issue": "i", "evidence": "e", "action": "a", "priority": 2}]})
    llm = MockLLM([LLMResponse(tool_calls=[bad]), LLMResponse(tool_calls=[emit])])
    from src.agent.controller import AgentController, AgentConfig
    from src.agent.loop_guard import LoopGuard
    from src.agent.degradation import Degradation
    from src.agent.observability import Observability
    from src.agent import prompts
    from src.platforms.platforms import MockPlatformAdapter
    ctrl = AgentController(AgentConfig(), llm, reg, MockPlatformAdapter(),
                           Observability(), LoopGuard(3), Degradation(), prompts)
    res = ctrl.run({"creator": "alice", "platforms": ["devto"], "period": "30d", "focus": "x"})
    ok = res.reason_stopped == "final_tool"
    if ok:
        PASS += 1; print("[PASS] disallowed_tool: 被拒绝且仍收敛")
    else:
        FAIL += 1; FAILURES.append(f"disallowed_tool: {res.reason_stopped}")
        print(f"[FAIL] disallowed_tool: {res.reason_stopped}")

disallowed_case()

# ---- 对抗：参数非法（缺必填）应被拒且不崩溃 ----
def invalid_args_case():
    global PASS, FAIL
    reg = build_default_registry()
    bad = ToolCall("x1", "fetch_platform_stats", {"account": "alice"})  # 缺 platform
    emit = ToolCall("e1", "emit_calibration_cards",
                    {"cards": [{"platform": "devto", "issue": "i", "evidence": "e", "action": "a", "priority": 2}]})
    llm = MockLLM([LLMResponse(tool_calls=[bad]), LLMResponse(tool_calls=[emit])])
    from src.agent.controller import AgentController, AgentConfig
    from src.agent.loop_guard import LoopGuard
    from src.agent.degradation import Degradation
    from src.agent.observability import Observability
    from src.agent import prompts
    from src.platforms.platforms import MockPlatformAdapter
    ctrl = AgentController(AgentConfig(), llm, reg, MockPlatformAdapter(),
                           Observability(), LoopGuard(3), Degradation(), prompts)
    res = ctrl.run({"creator": "alice", "platforms": ["devto"], "period": "30d", "focus": "x"})
    ok = res.reason_stopped == "final_tool"
    if ok:
        PASS += 1; print("[PASS] invalid_args: 被拒且仍收敛")
    else:
        FAIL += 1; FAILURES.append(f"invalid_args: {res.reason_stopped}")
        print(f"[FAIL] invalid_args: {res.reason_stopped}")

invalid_args_case()

# ---- 安全：危险工具（如自动发帖）未获人工确认必须被拒绝 ----
def dangerous_tool_case():
    global PASS, FAIL
    from src.agent.controller import AgentController, AgentConfig
    from src.agent.loop_guard import LoopGuard
    from src.agent.degradation import Degradation
    from src.agent.observability import Observability
    from src.agent import prompts
    from src.platforms.platforms import MockPlatformAdapter

    reg = build_default_registry()
    reg.register(ToolSpec(
        name="publish_post",
        description="对外发帖（危险操作）",
        parameters={"type": "object", "properties": {"text": {"type": "string"}},
                    "required": ["text"]},
        requires_confirmation=True,
    ))
    bad = ToolCall("p1", "publish_post", {"text": "hello"})
    emit = ToolCall("e1", "emit_calibration_cards",
                    {"cards": [{"platform": "devto", "issue": "i", "evidence": "e",
                                "action": "a", "priority": 2}]})
    llm = MockLLM([LLMResponse(tool_calls=[bad]), LLMResponse(tool_calls=[emit])])
    # 故意不注入 confirm_callback -> 应拒绝执行
    ctrl = AgentController(AgentConfig(), llm, reg, MockPlatformAdapter(),
                           Observability(), LoopGuard(3), Degradation(), prompts)
    res = ctrl.run({"creator": "alice", "platforms": ["devto"], "period": "30d", "focus": "x"})
    blocked = res.metrics["blocked_calls"]
    ok = res.reason_stopped == "final_tool" and blocked >= 1
    if ok:
        PASS += 1
        print(f"[PASS] dangerous_tool_unconfirmed: 被拒绝(blocked={blocked})且仍收敛")
    else:
        FAIL += 1
        FAILURES.append(f"dangerous_tool_unconfirmed: reason={res.reason_stopped} blocked={blocked}")
        print(f"[FAIL] dangerous_tool_unconfirmed: reason={res.reason_stopped} blocked={blocked}")


dangerous_tool_case()

# ---- 边界：超长创作者名（防超长输入打爆上下文）----
run_case("oversize_input", "normal", ["devto", "hashnode"], "30d",
         "x" * 5000, "final_tool")

# ---- 边界：空平台清单 ----
# 契约：无平台即无数据，Agent 不得硬造校准卡。停止原因必须是显式的 no_data
# （而非含糊的 llm_no_tool），并走降级产出「数据不足」说明卡。
run_case("empty_platforms", "normal", [], "30d", "alice", "no_data", expect_cards=True)

# ---- 停止条件本身：四道闸门都必须可观测、可复现 ----
# 强制触发各上限，断言停止原因被正确命名（而不是停在 unknown）
run_case("stop_max_steps", "loop", ["devto"], "30d", "alice", "max_steps",
         cfg_overrides={"max_steps": 1})
run_case("stop_wall_clock", "normal", ["devto"], "30d", "alice", "wall_clock",
         cfg_overrides={"max_wall_clock_s": 0.0})
run_case("stop_token_budget", "normal", ["devto"], "30d", "alice", "token_budget",
         cfg_overrides={"token_budget": -1})
run_case("stop_human_takeover", "normal", ["devto"], "30d", "alice", "human_takeover",
         human_takeover=lambda: True)


print("\n" + "=" * 60)
print(f"评测结果：PASS={PASS}  FAIL={FAIL}  通过率={PASS/(PASS+FAIL):.0%}")
if FAILURES:
    print("失败明细:")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("全部通过 ✅")
