"""内部测试 · 真链路竖切（2026-11-13 · 陆沉窗）

🔴 测什么 / 不测什么，先钉死：
  ✅ 测：装配层是否把「真实 HTTP 模型客户端 + 真实 subprocess 平台命令行」接起来了，
         tool_calls 解析、stdout JSON 解析、业务指标、evidence 与真实数值对应、
         终态收敛、以及三类故障下的降级是否仍生效。
  ❌ 不测：模型能力、真平台可用性、赛题得分、P95/成本（那是蒋平注入真凭据后的 T1-5）。
  ❌ 不证明：作品可提交。本测试用本机桩，0 联网 / 0 真凭据 / 0 云 / 0 积分。

运行：python tests/test_internal_live_slice.py
退出码：0 = 全过；2 = 有 FAIL 或主对象未挂上（禁止静默成功）
"""
from __future__ import annotations

import os
import sys
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

PASS = 0
FAIL = 0
FAILURES = []


def check(cond, label, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"[PASS] {label}" + (f"  {detail}" if detail else ""))
    else:
        FAIL += 1
        FAILURES.append(label)
        print(f"[FAIL] {label}" + (f"  {detail}" if detail else ""))


# ---- 硬闸门：主对象必须真的挂上，挂不上直接退出 2，不许打印假 ALL_PASS ----
try:
    from src.agent.factory import build_controller, build_controller_from_config
    from src.agent.llm_client import OpenAILLM, MockLLM
    from src.platforms.platforms import CLIPlatformAdapter, MockPlatformAdapter
    from tests.fixtures.fake_llm_server import start_stub_server
except Exception as e:
    print(f"[FATAL] 主对象导入失败：{e!r}")
    print("评测结果：PASS=0 FAIL=1（主对象未挂上，禁止降级为成功）")
    sys.exit(2)

check(callable(build_controller_from_config), "装配函数可调用（非导入占位）")
check(hasattr(OpenAILLM, "call") and hasattr(OpenAILLM, "_parse"),
      "真模型客户端具备 call/_parse 主方法")

# ---- 凭据：只注入「本机假值」，不是真 key，不打印、不落盘 ----
os.environ.setdefault("CALIBRATION_LLM_API_KEY", "LOCAL_STUB_VALUE_NOT_A_REAL_KEY")
os.environ.setdefault("PYTHON_EXE", sys.executable)

srv, th, base_url = start_stub_server(["devto"], host="127.0.0.1", port=0)
print(f"[INFO] 本机桩模型服务已启动：{base_url}（仅 127.0.0.1 回环）")


def make_config(stats_fail=False):
    """动态生成临时配置，指向本机桩端口；不改动仓库里的 config.yaml。"""
    fail_flag = " --fail" if stats_fail else ""
    text = f"""agent:
  max_steps: 12
  max_wall_clock_s: 60
  token_budget: 8000
  max_no_progress: 3
  max_repeat: 3
llm:
  provider: openai
  model: local-stub-llm
  base_url: {base_url}
  api_key_env: CALIBRATION_LLM_API_KEY
  timeout_s: 5
  retries: 1
  backoff_s: 0.05
platform:
  mode: cli
tool:
  timeout_s: 10
  retries: 1
platforms:
  devto:
    stats_cmd: '"%PYTHON_EXE%" tests/fixtures/fake_platform_cli.py --mode stats --user {{account}} --period {{period}}{fail_flag}'
    posts_cmd: '"%PYTHON_EXE%" tests/fixtures/fake_platform_cli.py --mode posts --user {{account}} --limit {{limit}}'
"""
    p = Path(tempfile.gettempdir()) / f"calib_internal_{os.getpid()}_{int(stats_fail)}.yaml"
    p.write_text(text, encoding="utf-8")
    return str(p)


def run_task(cfg_path):
    ctrl = build_controller_from_config(cfg_path, platforms=["devto"], period="30d", creator="alice")
    task = {"creator": "alice", "platforms": ["devto"], "period": "30d", "focus": "互动率"}
    res = ctrl.run(task)
    return ctrl, res


# ===================== 用例 1：正常竖切 =====================
print("\n--- 用例 1 · 真链路端到端竖切 ---")
cfg = make_config()
ctrl, res = run_task(cfg)

check(type(ctrl.llm) is OpenAILLM, "LLM 装配为真模型客户端",
      f"实际={type(ctrl.llm).__name__}（非 MockLLM）")
check(type(ctrl.platform) is CLIPlatformAdapter, "平台装配为真命令行适配器",
      f"实际={type(ctrl.platform).__name__}（非 MockPlatformAdapter）")
check(len(srv.requests) >= 2, "真实 HTTP 请求确实发生",
      f"服务端收到 {len(srv.requests)} 次 /chat/completions")
check(res.metrics["llm_calls"] >= 2, "llm_calls > 0（非 mock 单步脚本）",
      f"llm_calls={res.metrics['llm_calls']}")
check(res.metrics["tool_calls_total"] >= 1, "外部工具调用确实执行",
      f"tool_calls_total={res.metrics['tool_calls_total']}")
check(res.reason_stopped == "final_tool", "终态收敛 final_tool",
      f"reason={res.reason_stopped}")
check(res.report.data_availability.get("devto") == "ok", "数据可用性 ok",
      f"data_availability={json.dumps(res.report.data_availability, ensure_ascii=False)}")
check(res.metrics["est_tokens"] > 0, "est_tokens > 0（mock 恒为 0，此为真链路硬判据）",
      f"est_tokens={res.metrics['est_tokens']}")
check(len(res.report.cards) > 0, "产出校准动作卡", f"cards={len(res.report.cards)}")

cards = [c.to_dict() for c in res.report.cards]
print("[证据] 校准卡全文：" + json.dumps(cards, ensure_ascii=False))
evidence_all = " ".join(c["evidence"] for c in cards)
check("views=6000" in evidence_all and "likes=15" in evidence_all and "comments=3" in evidence_all,
      "evidence 逐项对应真实 stats 数值（假平台命令行输出的 6000/15/3）")
check("engagement_rate=0.003" in evidence_all, "evidence 含业务指标计算值 0.003",
      "18/6000=0.003")
check("示例问题（demo）" not in evidence_all and "demo" not in evidence_all.lower(),
      "无 demo 占位文本（不是把 mock 卡换个壳）")
check(bool(res.trace_id) and res.trace_id.startswith("tr_"), "trace_id 可追溯",
      f"trace={res.trace_id}")
check(not res.report.degraded, "正常路径无降级标记",
      f"degraded={res.report.degraded}")

# ===================== 用例 2：模型 HTTP 故障 -> 降级 =====================
print("\n--- 用例 2 · 模型服务恒 500（重试耗尽 -> 降级） ---")
srv.mode = "http_error"
ctrl2, res2 = run_task(cfg)
check(res2.reason_stopped == "llm_degraded", "降级为 llm_degraded",
      f"reason={res2.reason_stopped}")
check("llm_unavailable" in res2.report.degraded, "降级标记写入报告",
      f"degraded={res2.report.degraded}")
check(len(res2.report.cards) > 0, "降级仍产出兜底卡，不空手不崩溃",
      f"cards={len(res2.report.cards)}")
srv.mode = "normal"

# ===================== 用例 3：模型返回结构异常 -> 不崩 =====================
print("\n--- 用例 3 · 模型返回结构异常 ---")
srv.mode = "malformed"
ctrl3, res3 = run_task(cfg)
check(res3.reason_stopped in ("llm_degraded", "no_data"), "异常结构被吞掉并走降级，不抛异常",
      f"reason={res3.reason_stopped}")
srv.mode = "normal"

# ===================== 用例 4：平台命令行输出非法 JSON -> 工具失败降级 =====================
print("\n--- 用例 4 · 平台命令行返回非法 JSON ---")
cfg_fail = make_config(stats_fail=True)
ctrl4, res4 = run_task(cfg_fail)
check(res4.metrics["tool_failures"] >= 1, "工具失败被计数（不是静默跳过）",
      f"tool_failures={res4.metrics['tool_failures']}")
check(res4.report.data_availability.get("devto") == "failed", "该平台标记 failed",
      f"data_availability={json.dumps(res4.report.data_availability, ensure_ascii=False)}")
check(any("tool_failed" in d for d in res4.report.degraded), "降级标记含 tool_failed",
      f"degraded={res4.report.degraded}")
check(len(res4.report.cards) > 0, "单平台失败后仍收敛产出，不整体崩溃",
      f"cards={len(res4.report.cards)}")

# ===================== 用例 5：凭据缺失必须显式报错，不静默回退 mock =====================
print("\n--- 用例 5 · 凭据环境变量缺失 ---")
saved = os.environ.pop("CALIBRATION_LLM_API_KEY", None)
try:
    try:
        build_controller_from_config(cfg, platforms=["devto"])
        raised = False
    except RuntimeError as e:
        raised = True
        check("环境变量" in str(e) and "未注入" in str(e),
              "缺失凭据显式报错，且提示注入主体", f"msg={str(e)[:80]}")
    check(raised, "缺失凭据不静默回退 mock（防假绿）")
finally:
    if saved is not None:
        os.environ["CALIBRATION_LLM_API_KEY"] = saved

# ===================== 用例 6：45/45 基线回归（冻结区零改动） =====================
print("\n--- 用例 6 · mock 45 条基线回归 ---")
import subprocess
proc = subprocess.run([sys.executable, "tests/test_eval.py"], capture_output=True,
                      text=True, cwd=str(ROOT))
last = [ln for ln in proc.stdout.strip().splitlines() if "评测结果" in ln]
check(proc.returncode == 0 and last and "PASS=45" in last[0] and "FAIL=0" in last[0],
      "45/45 基线未被装配层改动破坏",
      f"exit={proc.returncode}  {last[-1] if last else 'NO_SUMMARY_LINE'}")

# ---- 收尾 ----
srv.shutdown()
srv.server_close()
try:
    Path(cfg).unlink(missing_ok=True)
    Path(cfg_fail).unlink(missing_ok=True)
except Exception:
    pass

print("\n" + "=" * 60)
print(f"内部测试结果：PASS={PASS}  FAIL={FAIL}")
if FAILURES:
    print("失败明细：")
    for f in FAILURES:
        print("  -", f)
    print("❌ 未通过（不降级为「基本通过」）")
    sys.exit(2)
print("✅ 全部通过（仅证明链路接通，不证明可提交）")
sys.exit(0)
