"""C公益 定向评测（新增，不改原 tests/test_eval.py 的 45 条基线）。

覆盖：场景矩阵 / 规则触发与不触发 / 三条不变量 / 合规拦截 / 护栏等价用例。
通过线：全部 PASS；任一失败 exit(1)。
运行：python tests/test_cgy_eval.py
"""
from __future__ import annotations

import os
import sys
import time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.factory_cgy import build_cgy_controller, DEFAULT_ACCOUNTS
from src.agent.domain_cgy import (
    suggest_cgy_cards, analyze_ledger, check_compliance, CGY_ACCOUNTS, FILING_NAME,
)
from src.agent.domain import analyze_stats
from src.platforms.platforms_cgy import CgyDemoAdapter, JSONCgyAdapter
from src.platforms.platforms import PlatformError

PASS = 0
FAIL = 0
FAILURES = []


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"[PASS] {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{name}: {detail}")
        print(f"[FAIL] {name}: {detail}")


def run(name, scenario, accounts, expected_reason, month="2026-10",
        cfg_overrides=None, human_takeover=None, expect_cards=True):
    try:
        ctrl = build_cgy_controller(scenario=scenario, accounts=accounts, month=month,
                                    cfg_overrides=cfg_overrides, human_takeover=human_takeover)
        res = ctrl.run({"creator": "C公益", "platforms": accounts, "period": "30d",
                        "month": month, "focus": "x"})
        ok = res.reason_stopped == expected_reason
        if expect_cards:
            ok = ok and len(res.report.cards) > 0
        check(name, ok, f"got {res.reason_stopped} cards={len(res.report.cards)} want {expected_reason}")
        return res
    except Exception as e:
        check(name, False, f"异常 {e!r}")
        return None


# ---- 1. 场景矩阵（4 场景 × 3 账号组合 = 12 条）----
POOLS = [["wechat_zanjin"],
         ["wechat_zanjin", "xhs_zanjin"],
         list(DEFAULT_ACCOUNTS)]
for scen, exp in [("cgy_normal", "final_tool"), ("cgy_tooldown", "final_tool"),
                  ("cgy_loop", "loop_detected"), ("cgy_llmdown", "llm_degraded")]:
    for pool in POOLS:
        run(f"{scen}|{','.join(pool)}", scen, pool, exp)

# ---- 2. 合规场景：红线词必须被拦截，且备案口径出现在改写建议里 ----
res = run("cgy_compliance", "cgy_compliance", list(DEFAULT_ACCOUNTS), "final_tool")
if res:
    txt = " ".join(c.issue + c.action + c.evidence for c in res.report.cards)
    check("compliance_blocked", "命中合规红线" in txt, "未出现拦截卡")
    check("compliance_filing", FILING_NAME in txt, "未给出备案口径")
    check("compliance_no_raw_bad", all("捐款返利" not in c.action for c in res.report.cards),
          "红线词出现在 action 建议里")

# ---- 3. 规则触发断言（正常场景的卡必须覆盖 G1/G2/G3/G4/G6 与缺数据卡）----
res = run("cgy_normal_rules", "cgy_normal", list(DEFAULT_ACCOUNTS), "final_tool")
if res:
    issues = " ".join(c.issue for c in res.report.cards)
    for tag, kw in [("G2产能", "产能"), ("G3素材", "素材只用一次"),
                    ("G4等待期", "等待期"), ("G1旧号", "旧号仍在发"),
                    ("G6品牌", "旧品牌模板"), ("缺数据", "未获取"),
                    ("未知账号", "状态未知")]:
        check(f"rule_{tag}", kw in issues, f"缺少 {kw}")
    # 证据可回溯：G2 卡证据里的台账场次数 = analyze_ledger 独立复算
    adapter = CgyDemoAdapter()
    led = analyze_ledger(adapter.ledger_rows, "2026-10")
    g2 = [c for c in res.report.cards if "产能" in c.issue]
    check("G2_evidence_traceable", bool(g2) and f"台账 {led['sessions']} 场" in g2[0].evidence,
          f"ledger={led['sessions']} evidence={g2[0].evidence if g2 else '无'}")

# ---- 4. 不变量1：原始值判定（0.019975 < 0.02 必须出 R1 卡；展示值 0.02 不得冒充）----
stats_edge = {"followers": 500, "views": 40000, "likes": 798, "comments": 1}
m = analyze_stats(stats_edge)
check("inv1_raw_value", m["engagement_rate_raw"] < 0.02 and m["engagement_rate"] == 0.02,
      f"raw={m['engagement_rate_raw']} disp={m['engagement_rate']}")
cards = suggest_cgy_cards({"wechat_zanjin": {"stats": stats_edge}}, ledger_rows=[], month="2026-10")
check("inv1_card_fired", any("互动率低于 2%" in c.issue for c in cards), "边界值未触发 R1")

# ---- 5. 不变量2：缺字段不补 0、不造 R1/R3 卡 ----
stats_missing = {"followers": 100, "views": None, "likes": None, "comments": None}
cards = suggest_cgy_cards({"xhs_xiaoc": {"stats": stats_missing}}, ledger_rows=[], month="2026-10")
check("inv2_no_fake_cards", not any("互动率" in c.issue or "有曝光" in c.issue for c in cards),
      "缺字段造出了指标卡")
check("inv2_missing_card", any("未获取" in c.issue for c in cards), "缺字段未出「未获取」卡")

# ---- 6. 不变量3：扩展字段原样透传 ----
stats_extra = {"followers": 100, "views": 1000, "likes": 30, "comments": 5,
               "extra": {"publish_count": 344, "collects": 21}}
m = analyze_stats(stats_extra)
check("inv3_passthrough", m.get("publish_count") == 344 and m.get("collects") == 21,
      f"透传丢失: {m}")

# ---- 7. 台账统计：缺人数行不补 0，显式 skipped ----
rows = [{"date": "2026-10-01", "count": 10, "line": "zhiye"},
        {"date": "2026-10-02", "count": None, "line": "zhiye"},
        {"date": "2026-11-01", "count": 99, "line": "zhiye"}]
led = analyze_ledger(rows, "2026-10")
check("ledger_no_fill", led["sessions"] == 1 and led["people"] == 10 and led["skipped_rows"] == [1],
      f"got {led}")

# ---- 8. G4 等待期：>14 天未通知才出卡；已通知/≤14 天不出 ----
q_hot = [{"line": "qingqiao", "stage": "queued", "wait_days": 16, "progress_notified": False, "name": "甲"}]
q_cold = [{"line": "qingqiao", "stage": "queued", "wait_days": 14, "progress_notified": False, "name": "乙"},
          {"line": "qingqiao", "stage": "queued", "wait_days": 30, "progress_notified": True, "name": "丙"}]
g = {"wechat_zanjin": {"stats": {"followers": 500, "views": 1000, "likes": 30, "comments": 5}}}
hot = suggest_cgy_cards(g, ledger_rows=q_hot, month="2026-10")
cold = suggest_cgy_cards(g, ledger_rows=q_cold, month="2026-10")
check("G4_fires", any("等待期" in c.issue for c in hot), "超期未触发")
check("G4_boundary", not any("等待期" in c.issue for c in cold), "边界/已通知误触发")

# ---- 9. G5 词面拦截函数本身 ----
check("G5_hit", len(check_compliance("捐款返利，百分百透明")) == 2, "红线词漏检")
check("G5_clean", check_compliance("欢迎报名一日职业体验") == [], "正常文案误报")

# ---- 10. 空账号清单：no_data，不硬造强结论 ----
run("empty_accounts", "cgy_normal", [], "no_data")

# ---- 11. 未知账号：适配器拒绝，走降级不崩 ----
res = run("unknown_account", "cgy_normal", ["not_an_account"], "final_tool")
if res:
    check("unknown_failed", res.report.data_availability.get("not_an_account") == "failed",
          f"availability={res.report.data_availability}")

# ---- 12. 护栏等价用例（原四闸门；墙钟用 >0 阈值规避 Windows 15.6ms 时钟分辨率）----
run("stop_max_steps", "cgy_loop", ["wechat_zanjin"], "max_steps", cfg_overrides={"max_steps": 1})
run("stop_token_budget", "cgy_normal", ["wechat_zanjin"], "token_budget", cfg_overrides={"token_budget": -1})
run("stop_human_takeover", "cgy_normal", ["wechat_zanjin"], "human_takeover", human_takeover=lambda: True)
# 墙钟：0.05s 阈值 + 慢速 LLM（每步 sleep 0.06s）确保第二步触发；不改控制器
from src.agent.llm_client import MockLLM, LLMResponse, ToolCall, BaseLLM
from src.agent.factory_cgy import build_cgy_controller as _bcc

class SlowLLM(BaseLLM):
    def __init__(self):
        self.n = 0
    def call(self, messages, schemas, trace_id):
        time.sleep(0.06)
        self.n += 1
        if self.n == 1:
            return LLMResponse(tool_calls=[ToolCall("s1", "fetch_platform_stats",
                                                    {"platform": "wechat_zanjin", "account": "C公益"})])
        return LLMResponse(tool_calls=[ToolCall("e1", "emit_calibration_cards",
                                                {"cards": [{"platform": "攒劲青年", "issue": "i",
                                                            "evidence": "e", "action": "a", "priority": 2}]})])

ctrl = _bcc(scenario="cgy_normal", accounts=["wechat_zanjin"], cfg_overrides={"max_wall_clock_s": 0.05})
ctrl.llm = SlowLLM()
res = ctrl.run({"creator": "C公益", "platforms": ["wechat_zanjin"], "period": "30d", "month": "2026-10", "focus": "x"})
check("stop_wall_clock_equiv", res.reason_stopped == "wall_clock", f"got {res.reason_stopped}")

# ---- 13. JSON 数据接入位：缺文件走 PlatformError，不静默 ----
try:
    JSONCgyAdapter("__no_such_file__.json")
    check("json_missing_raises", False, "未抛异常")
except PlatformError:
    check("json_missing_raises", True)

# ---- 14. 危险工具闸（继承）：cgy 控制器下未确认的发帖工具必须被拒 ----
from src.agent.tools import ToolSpec
ctrl = _bcc(scenario="cgy_normal", accounts=["wechat_zanjin"])
ctrl.tools.register(ToolSpec(name="publish_post", description="对外发帖",
                             parameters={"type": "object", "properties": {"text": {"type": "string"}},
                                         "required": ["text"]}, requires_confirmation=True))
ctrl.llm = MockLLM([
    LLMResponse(tool_calls=[ToolCall("p1", "publish_post", {"text": "hello"})]),
    LLMResponse(tool_calls=[ToolCall("e1", "emit_calibration_cards",
                                     {"cards": [{"platform": "攒劲青年", "issue": "i",
                                                 "evidence": "e", "action": "a", "priority": 2}]})]),
])
res = ctrl.run({"creator": "C公益", "platforms": ["wechat_zanjin"], "period": "30d", "month": "2026-10", "focus": "x"})
check("dangerous_blocked", res.reason_stopped == "final_tool" and res.metrics["blocked_calls"] >= 1,
      f"reason={res.reason_stopped} blocked={res.metrics['blocked_calls']}")

print("\n" + "=" * 60)
print(f"C公益 定向评测：PASS={PASS}  FAIL={FAIL}  通过率={PASS/(PASS+FAIL):.0%}")
if FAILURES:
    print("失败明细:")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("全部通过 ✅")