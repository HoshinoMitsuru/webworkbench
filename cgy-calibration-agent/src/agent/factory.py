"""装配工厂：把配置 + 场景拼成可运行的 AgentController。

main 与 test_eval 都从这里取控制器，保证"跑通的竖切片"唯一。
"""
from __future__ import annotations

from typing import Optional, Callable, Dict, Any

from .controller import AgentController, AgentConfig
from .tools import build_default_registry
from .loop_guard import LoopGuard
from .degradation import Degradation
from .observability import Observability
from . import prompts
from .scenarios import build_scenario


def build_controller(scenario: str = "normal",
                    platforms: Optional[list] = None,
                    period: str = "30d",
                    creator: str = "alice",
                    cfg_overrides: Optional[Dict[str, Any]] = None,
                    human_takeover: Optional[Callable[[], bool]] = None) -> AgentController:
    # 用 is None 而非 or：显式传入空清单是合法边界用例，不能被默认值吞掉
    platforms = platforms if platforms is not None else ["devto", "hashnode"]
    llm, adapter = build_scenario(scenario, platforms, period, creator)
    cfg = AgentConfig(human_takeover=human_takeover)
    if cfg_overrides:
        for k, v in cfg_overrides.items():
            setattr(cfg, k, v)
    obs = Observability()
    return AgentController(
        cfg=cfg,
        llm=llm,
        tools=build_default_registry(),
        platform=adapter,
        obs=obs,
        loop_guard=LoopGuard(max_repeat=cfg.max_repeat),
        degradation=Degradation(obs=obs),  # 降级分支也要有 trace 埋点
        prompts=prompts,
    )


def build_controller_from_config(cfg_path: str,
                                 platforms: Optional[list] = None,
                                 period: str = "30d",
                                 creator: str = "alice",
                                 human_takeover: Optional[Callable[[], bool]] = None) -> AgentController:
    """按 config.yaml 装配真链路（provider=openai + platform.mode=cli）。

    为什么单独建函数而不是改 build_controller：评测 45 条基线走 mock 路径，
    必须保持零改动、零依赖（mock 场景仍只需标准库）。真链路的 yaml / requests
    一律延迟导入，且凭据只从环境变量读，绝不落盘、绝不硬编码。

    🔴 凭据注入主体 = 蒋平（2026-11-13 裁决）。本函数只认环境变量名，
    不接收也不打印明文 key；环境变量缺失时显式报错，不静默回退到 mock。
    """
    import os
    import yaml  # 延迟导入：mock 场景不需要 PyYAML

    with open(cfg_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    platforms = platforms if platforms is not None else ["devto", "hashnode"]

    # ---- Agent 侧参数（全部有缺省值，缺字段不报错）----
    a = raw.get("agent", {}) or {}
    cfg = AgentConfig(
        max_steps=int(a.get("max_steps", 12)),
        max_wall_clock_s=float(a.get("max_wall_clock_s", 120)),
        token_budget=int(a.get("token_budget", 8000)),
        max_no_progress=int(a.get("max_no_progress", 3)),
        max_repeat=int(a.get("max_repeat", 3)),
        human_takeover=human_takeover,
    )

    # ---- LLM 侧：provider=openai 才接真模型 ----
    l = raw.get("llm", {}) or {}
    provider = str(l.get("provider", "mock")).lower()
    if provider == "openai":
        key_env = str(l.get("api_key_env", "OPENAI_API_KEY"))
        api_key = os.environ.get(key_env)
        if not api_key:
            # 🔴 不静默降级：挂不上就明说，禁止"看起来跑通了其实是 mock"
            raise RuntimeError(
                f"环境变量 {key_env} 未注入 —— 真 LLM 无法启动。"
                f"凭据注入主体为蒋平；本函数不接收明文 key、不落盘、不回退 mock。"
            )
        from .llm_client import OpenAILLM  # 延迟导入：requests 只在真链路需要
        llm = OpenAILLM(
            base_url=str(l.get("base_url", "https://api.openai.com/v1")).rstrip("/"),
            api_key=api_key,
            model=str(l.get("model", "gpt-4o-mini")),
            timeout_s=int(l.get("timeout_s", 30)),
            retries=int(l.get("retries", 2)),
            backoff_s=float(l.get("backoff_s", 2.0)),
        )
    else:
        # mock 分支：复用既有场景脚本，保持与评测一致
        llm, _ = build_scenario("normal", platforms, period, creator)

    # ---- 平台侧：mode=cli 才接真命令行适配器 ----
    p = raw.get("platform", {}) or {}
    mode = str(p.get("mode", "mock")).lower()
    t = raw.get("tool", {}) or {}
    if mode == "cli":
        from ..platforms.platforms import CLIPlatformAdapter  # 延迟导入
        adapter = CLIPlatformAdapter(
            raw.get("platforms", {}) or {},
            timeout_s=int(t.get("timeout_s", 20)),
            retries=int(t.get("retries", 2)),
        )
    else:
        from ..platforms.platforms import MockPlatformAdapter
        adapter = MockPlatformAdapter()

    obs = Observability()
    return AgentController(
        cfg=cfg,
        llm=llm,
        tools=build_default_registry(),
        platform=adapter,
        obs=obs,
        loop_guard=LoopGuard(max_repeat=cfg.max_repeat),
        degradation=Degradation(obs=obs),
        prompts=prompts,
    )
