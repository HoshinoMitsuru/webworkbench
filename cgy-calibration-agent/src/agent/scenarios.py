"""场景构造：把 demo / 评测需要的 (MockLLM, PlatformAdapter) 组合抽出来，
main 与 test_eval 共用，避免重复脚本。

每个场景对应一种"业务 / 故障"形态：
- normal：正常收敛（先采数，再 emit 校准卡）
- loop：LLM 反复调同一工具 -> 触发循环守卫拦截
- llmdown：LLM 直接不可用 -> 走降级（规则兜底）
- tooldown：某平台工具失败 -> 跳过继续，仍产出其余平台校准卡
"""
from __future__ import annotations

from ..platforms.platforms import MockPlatformAdapter
from .llm_client import MockLLM, LLMResponse, ToolCall


def _sample_cards(platforms):
    return [{
        "platform": p,
        "issue": "示例问题（demo）",
        "evidence": "demo evidence",
        "action": "demo action",
        "priority": 2,
    } for p in platforms]


def build_scenario(name: str, platforms: list, period: str, creator: str):
    if name == "loop":
        single = ToolCall("L1", "fetch_platform_stats",
                          {"platform": (platforms[0] if platforms else "devto"), "account": creator})
        # 重复同一调用，超过 max_repeat 触发循环守卫
        return MockLLM([LLMResponse(tool_calls=[single])] * 5), MockPlatformAdapter()

    if name == "llmdown":
        return MockLLM([LLMResponse(is_degraded=True)]), MockPlatformAdapter()

    if name == "tooldown":
        fail = {platforms[0]} if platforms else {"devto"}
        adapter = MockPlatformAdapter(fail_platforms=fail)
        calls = [ToolCall(f"s{i}", "fetch_platform_stats",
                          {"platform": p, "account": creator, "period": period})
                 for i, p in enumerate(platforms)]
        emit = ToolCall("E1", "emit_calibration_cards",
                        {"cards": _sample_cards(platforms), "summary": "tooldown demo"})
        return MockLLM([LLMResponse(tool_calls=calls), LLMResponse(tool_calls=[emit])]), adapter

    # normal（默认）
    calls = [ToolCall(f"s{i}", "fetch_platform_stats",
                      {"platform": p, "account": creator, "period": period})
             for i, p in enumerate(platforms)]
    emit = ToolCall("E1", "emit_calibration_cards",
                    {"cards": _sample_cards(platforms), "summary": "normal demo"})
    return MockLLM([LLMResponse(tool_calls=calls), LLMResponse(tool_calls=[emit])]), MockPlatformAdapter()
