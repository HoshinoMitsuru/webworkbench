"""可观测性：trace_id 贯穿、span 埋点、PII 脱敏、指标汇总。

为什么单独成模块：生产级与 demo 的分界线之一是"出问题能定位"。
所有外部入参/出参在落日志前必须经 redact，避免把 cookie / secret / token 写进上下文。
"""
from __future__ import annotations

import time
import uuid
import json
import hashlib
from dataclasses import dataclass, field


def new_trace_id() -> str:
    return "tr_" + uuid.uuid4().hex[:16]


@dataclass
class Span:
    name: str
    ts: float
    data: dict = field(default_factory=dict)


@dataclass
class Trace:
    trace_id: str
    task_hash: str
    start_ts: float = 0.0
    spans: list = field(default_factory=list)


# 这些 key 的值一旦进入日志/上下文必须被脱敏
PII_KEYS = {"cookie", "secret", "token", "password", "authorization", "api_key", "apikey"}


def redact(v):
    """递归脱敏：PII key 抹星、超长字符串截断。"""
    if isinstance(v, dict):
        return {k: ("***" if str(k).lower() in PII_KEYS else redact(v2)) for k, v2 in v.items()}
    if isinstance(v, str) and len(v) > 200:
        return v[:200] + "...[truncated]"
    return v


class Observability:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled

    def start_trace(self, task: dict) -> Trace:
        raw = json.dumps(task, sort_keys=True, default=str, ensure_ascii=False)
        th = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
        return Trace(trace_id=new_trace_id(), task_hash=th, start_ts=time.time())

    def span(self, trace: Trace, name: str, **kw):
        if not self.enabled:
            return
        clean = {k: redact(v) for k, v in kw.items()}
        trace.spans.append(Span(name=name, ts=time.time(), data=clean))

    def end_trace(self, trace: Trace, meta: dict):
        self.span(trace, "end", **meta)

    def summary(self, trace: Trace) -> dict:
        return {
            "trace_id": trace.trace_id,
            "task_hash": trace.task_hash,
            "span_count": len(trace.spans),
            "spans": [{"name": s.name, "data": s.data} for s in trace.spans],
        }
