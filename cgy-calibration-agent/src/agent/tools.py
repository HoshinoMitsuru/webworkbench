"""工具注册表：白名单 + JSON Schema + 参数校验 + 调用签名归一化。

解决"乱调工具"的两道防线：
1) is_allowed：只允许白名单内的工具，越权工具直接拒绝执行（返回 tool_not_allowed）。
2) validate：按参数 schema 做最小必要校验（必填 + 类型），非法参数不执行。

normalize：把 (工具名 + 排序后参数) 压成字符串签名，供循环守卫判重。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Dict, List, Any, Tuple


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]   # JSON Schema（仅用 required + 基本类型）
    is_terminal: bool = False     # True = 终态工具（输出校准卡，结束循环）
    requires_confirmation: bool = False  # True = 危险操作，须 human-in-the-loop 二次确认


class ToolRegistry:
    def __init__(self):
        self.specs: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec):
        self.specs[spec.name] = spec

    def allowed_names(self) -> List[str]:
        return list(self.specs.keys())

    def is_allowed(self, name: str) -> bool:
        return name in self.specs

    def schemas(self) -> List[Dict[str, Any]]:
        """导出给 LLM 的 function-calling 描述。"""
        out = []
        for s in self.specs.values():
            out.append({
                "type": "function",
                "function": {
                    "name": s.name,
                    "description": s.description,
                    "parameters": s.parameters,
                },
            })
        return out

    def validate(self, name: str, args: Dict[str, Any]) -> Tuple[bool, List[str]]:
        spec = self.specs.get(name)
        if spec is None:
            return False, [f"未知工具 {name}"]
        schema = spec.parameters or {}
        required = schema.get("required", [])
        props = schema.get("properties", {})
        errs: List[str] = []
        for r in required:
            if r not in args or args[r] in (None, ""):
                errs.append(f"缺少必填参数 {r}")
        for k, v in args.items():
            if k in props:
                expected = props[k].get("type")
                if expected == "integer" and not isinstance(v, int):
                    try:
                        int(v)
                    except Exception:
                        errs.append(f"参数 {k} 应为整数")
                elif expected == "string" and not isinstance(v, str):
                    errs.append(f"参数 {k} 应为字符串")
        return (len(errs) == 0, errs)

    def normalize(self, tc) -> str:
        try:
            args_str = json.dumps(tc.arguments, sort_keys=True, ensure_ascii=False)
        except Exception:
            args_str = str(tc.arguments)
        return f"{tc.name}:{args_str}"


def build_default_registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(ToolSpec(
        name="fetch_platform_stats",
        description="调用平台开发者 CLI 获取某账号在指定周期的运营统计（粉丝/阅读/点赞/评论）。",
        parameters={
            "type": "object",
            "properties": {
                "platform": {"type": "string", "description": "平台标识，如 devto/hashnode/zhihu"},
                "account": {"type": "string", "description": "账号或出版物名"},
                "period": {"type": "string", "description": "统计周期，如 30d"},
            },
            "required": ["platform", "account"],
        },
    ))
    reg.register(ToolSpec(
        name="fetch_platform_posts",
        description="调用平台开发者 CLI 获取某账号近期文章列表。",
        parameters={
            "type": "object",
            "properties": {
                "platform": {"type": "string"},
                "account": {"type": "string"},
                "limit": {"type": "integer", "description": "返回条数，默认 10"},
            },
            "required": ["platform", "account"],
        },
    ))
    reg.register(ToolSpec(
        name="analyze_post",
        description="对单篇内容做本地启发式分析（标题钩子/CTA/长度），无需调 LLM。",
        parameters={
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    ))
    reg.register(ToolSpec(
        name="emit_calibration_cards",
        description="终态工具：输出最终校准动作卡，调用即结束 Agent 循环。",
        is_terminal=True,
        parameters={
            "type": "object",
            "properties": {
                "cards": {
                    "type": "array",
                    "description": "校准卡数组，每项含 platform/issue/evidence/action/priority(1-3)",
                    "items": {"type": "object"},
                },
                "summary": {"type": "string"},
            },
            "required": ["cards"],
        },
    ))
    return reg
