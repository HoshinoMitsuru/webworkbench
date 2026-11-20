"""LLM 客户端：统一接口 + 超时 + 重试退避 + 降级。

- 任何 LLM 调用都必须有显式超时（timeout_s），禁止无限等待。
- 失败重试次数固定（retries）+ 指数退避 + 抖动，避免重试风暴。
- 重试耗尽返回 is_degraded=True，由控制器走降级分支（不抛异常、不卡死）。

注意：OpenAILLM 的 API 字段（模型名/参数/返回结构）随版本变化极快，
凡涉及具体签名均标 [待核实]，接入比赛真实模型时以官方文档为准。
"""
from __future__ import annotations

import time
import json
import random
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional


def est_tokens(text: str) -> int:
    """粗估 token 数（英文 ~4 字符/token，中文 ~1.5 字符/token）。"""
    if not text:
        return 0
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    other = len(text) - cjk
    return max(1, int(cjk / 1.5 + other / 4))


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass
class LLMResponse:
    content: str = ""
    tool_calls: List[ToolCall] = field(default_factory=list)
    est_tokens: int = 0
    is_degraded: bool = False  # True = 模型不可用，应走降级


class BaseLLM:
    def call(self, messages: List[Dict[str, Any]], tool_schemas: List[Dict[str, Any]], trace_id: str) -> LLMResponse:
        raise NotImplementedError


class MockLLM(BaseLLM):
    """脚本化 LLM，用于 demo/评测：按 script 顺序返回，耗尽后重复最后一条。

    - normal 场景：最后一步调用 emit_calibration_cards 正常收敛。
    - loop 场景：反复调用同一 fetch，用于演示循环守卫拦截。
    """

    def __init__(self, script: List[LLMResponse]):
        self.script = script
        self.idx = 0

    def call(self, messages, tool_schemas, trace_id) -> LLMResponse:
        if self.idx < len(self.script):
            r = self.script[self.idx]
            self.idx += 1
            return r
        # 耗尽：重复最后一条（可能触发循环守卫）
        return self.script[-1]


class OpenAILLM(BaseLLM):
    """真实 OpenAI 兼容接口（[待核实] 具体字段以官方文档为准）。

    接入比赛模型时：改 provider=openai，配置 base_url/model，并把 api_key 放环境变量。
    """

    def __init__(self, base_url: str, api_key: str, model: str,
                 timeout_s: int = 30, retries: int = 2, backoff_s: float = 2.0):
        self.base_url = base_url
        self.api_key = api_key  # 已来自环境变量，禁止硬编码
        self.model = model
        self.timeout_s = timeout_s
        self.retries = retries
        self.backoff_s = backoff_s

    def call(self, messages, tool_schemas, trace_id) -> LLMResponse:
        import requests  # 延迟导入，mock 场景无需安装

        payload = {
            # [待核实] OpenAI chat.completions 字段，比赛模型如不同请改这里
            "model": self.model,
            "messages": messages,
            "tools": tool_schemas,
            "tool_choice": "auto",
            "temperature": 0.2,
        }
        last_err = None
        for attempt in range(self.retries + 1):
            try:
                resp = requests.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}",
                             "Content-Type": "application/json"},
                    json=payload,
                    timeout=self.timeout_s,
                )
                resp.raise_for_status()
                return self._parse(resp.json())
            except Exception as e:  # 超时/网络/HTTP 错误统一处理
                last_err = str(e)
                if attempt < self.retries:
                    # 指数退避 + 抖动，避免重试风暴
                    sleep_for = self.backoff_s * (2 ** attempt) + random.uniform(0, 0.5)
                    time.sleep(sleep_for)
        # 重试耗尽 -> 降级，不抛异常
        return LLMResponse(is_degraded=True, content=f"[LLM 不可用] {last_err}")

    def _parse(self, data: Dict[str, Any]) -> LLMResponse:
        # [待核实] 返回结构解析
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError):
            return LLMResponse(is_degraded=True, content="[LLM 返回结构异常]")
        content = msg.get("content") or ""
        raw_calls = msg.get("tool_calls") or []
        calls: List[ToolCall] = []
        for c in raw_calls:
            try:
                args = json.loads(c["function"]["arguments"] or "{}")
            except Exception:
                args = {}
            calls.append(ToolCall(id=c.get("id", f"call_{len(calls)}"),
                                  name=c["function"]["name"], arguments=args))
        return LLMResponse(content=content, tool_calls=calls, est_tokens=est_tokens(content))
