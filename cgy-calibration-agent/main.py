"""入口：命令行跑各场景，验证 guardrails 生效。

用法：
  python main.py                      # 默认 normal 场景
  python main.py --scenario loop     # 演示死循环被拦截
  python main.py --scenario llmdown  # 演示 LLM 不可用降级
  python main.py --scenario tooldown # 演示工具失败跳过继续
  python main.py --scenario normal --platforms devto,hashnode,zhihu
  python main.py --config config.yaml --platforms devto --period 30d   # 真链路竖切

依赖：mock 场景仅 Python 标准库；真链路（--config）才需 requests/PyYAML。
🔴 凭据只从环境变量读，config.yaml 里只写环境变量名，绝不写明文 key。
"""
from __future__ import annotations

import os
import sys
import json
import argparse

# 与 cwd 解耦：从脚本自身位置定位包根，避免"在别处运行就 import 失败"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.agent.factory import build_controller, build_controller_from_config


def main():
    ap = argparse.ArgumentParser(description="校准引擎 · 比赛 Agent demo（含 C公益 定向适配）")
    ap.add_argument("--profile", choices=["generic", "cgy"], default="generic",
                    help="generic=原泛自媒体口径；cgy=C公益 公益机构定向口径")
    ap.add_argument("--scenario", default="normal",
                    help="generic: normal/loop/llmdown/tooldown；cgy: cgy_normal/cgy_loop/cgy_llmdown/cgy_tooldown/cgy_compliance")
    ap.add_argument("--creator", default="alice")
    ap.add_argument("--platforms", default=None,
                    help="generic 默认 devto,hashnode；cgy 默认机构账号矩阵四号")
    ap.add_argument("--period", default="30d")
    ap.add_argument("--month", default="2026-10", help="cgy 台账月份")
    ap.add_argument("--cgy-data", default=None,
                    help="cgy 真实数据 JSON（机构导出）；缺省用虚构演示数据")
    ap.add_argument("--config", default=None,
                    help="传入 config.yaml 走真链路（provider=openai + platform.mode=cli）")
    ap.add_argument("--stop-file", default=None,
                    help="若此文件存在则触发 human_takeover 停止（演示人工接管点）")
    args = ap.parse_args()

    if args.profile == "cgy":
        from src.agent.factory_cgy import build_cgy_controller, DEFAULT_ACCOUNTS
        accounts = ([p.strip() for p in args.platforms.split(",") if p.strip()]
                    if args.platforms else list(DEFAULT_ACCOUNTS))
        human_takeover = (lambda: os.path.exists(args.stop_file)) if args.stop_file else None
        scen = args.scenario if args.scenario.startswith("cgy_") else "cgy_" + args.scenario
        ctrl = build_cgy_controller(scenario=scen, accounts=accounts, period=args.period,
                                    month=args.month, human_takeover=human_takeover,
                                    data_path=args.cgy_data)
        task = {"creator": "C公益", "platforms": accounts, "period": args.period,
                "month": args.month, "focus": "产能缺口、素材复用、账号矩阵分工、合规风险"}
        result = ctrl.run(task)
        print("=" * 60)
        print(f"装配模式: C公益 定向（{'机构数据 JSON' if args.cgy_data else '虚构演示数据'}）  "
              f"LLM={type(ctrl.llm).__name__}  适配器={type(ctrl.platform).__name__}")
        print(f"场景: {scen}  停止原因: {result.reason_stopped}  trace: {result.trace_id}")
        print("-" * 60)
        print("校准动作卡:")
        for c in result.report.cards:
            print(f"  [{c.priority}] {c.platform}: {c.issue} -> {c.action}")
            print(f"       evidence: {c.evidence}")
        print("-" * 60)
        print("数据可用性:", json.dumps(result.report.data_availability, ensure_ascii=False))
        if result.report.degraded:
            print("降级标记:", result.report.degraded)
        print("指标:", json.dumps(result.metrics, ensure_ascii=False))
        print("=" * 60)
        return

    ap_scenario = args.scenario if args.scenario in ("normal", "loop", "llmdown", "tooldown") else "normal"
    platforms = ([p.strip() for p in args.platforms.split(",") if p.strip()]
                 if args.platforms else ["devto", "hashnode"])

    # 真链路命令模板用 %PYTHON_EXE% 占位，这里注入当前解释器（不写死绝对路径，脱敏友好）
    if args.config:
        os.environ.setdefault("PYTHON_EXE", sys.executable)

    human_takeover = None
    if args.stop_file:
        # os 已在模块顶层导入；此处不可再局部 import，否则整个 main() 的 os 变成局部变量
        human_takeover = lambda: os.path.exists(args.stop_file)

    if args.config:
        ctrl = build_controller_from_config(
            cfg_path=args.config,
            platforms=platforms,
            period=args.period,
            creator=args.creator,
            human_takeover=human_takeover,
        )
    else:
        ctrl = build_controller(
            scenario=ap_scenario,
            platforms=platforms,
            period=args.period,
            creator=args.creator,
            human_takeover=human_takeover,
        )
    task = {"creator": args.creator, "platforms": platforms, "period": args.period, "focus": "互动率与涨粉效率"}
    result = ctrl.run(task)

    # 装配模式自证行：学生贴回执时，一眼可判「真链路 or mock」，防止把 mock 当真数据
    llm_name = type(ctrl.llm).__name__
    adapter_name = type(ctrl.platform).__name__
    is_live = (llm_name != "MockLLM") and (adapter_name != "MockPlatformAdapter")
    # 只显示文件名，不把本机绝对路径带进回执（脱敏）
    cfg_label = os.path.basename(args.config) if args.config else "（无）"
    print("=" * 60)
    print(f"装配模式: {'真链路 LIVE' if is_live else 'mock 演示'}  "
          f"LLM={llm_name}  平台适配器={adapter_name}  config={cfg_label}")
    print(f"场景: {ap_scenario}  停止原因: {result.reason_stopped}  trace: {result.trace_id}")
    print("-" * 60)
    print("校准动作卡:")
    for c in result.report.cards:
        print(f"  [{c.priority}] {c.platform}: {c.issue} -> {c.action}")
        # evidence 必须可见：这是「业务判断基于真实数据」的可核查凭证，
        # 回执里看不到 evidence 就无法自证不是凭空编的
        print(f"       evidence: {c.evidence}")
    print("-" * 60)
    print("数据可用性:", json.dumps(result.report.data_availability, ensure_ascii=False))
    if result.report.degraded:
        print("降级标记:", result.report.degraded)
    print("指标:", json.dumps(result.metrics, ensure_ascii=False))
    print("=" * 60)


if __name__ == "__main__":
    main()
