"""本机假模型服务（内部测试桩）——只监听 127.0.0.1，不联网、不调真模型、不烧额度。

实现 OpenAI 兼容的 POST /v1/chat/completions，按对话阶段返回不同的 tool_calls：
  阶段 1（还没有 tool 回执）-> 要求调用 fetch_platform_stats 采集数据
  阶段 2（已收到 tool 回执）-> 从回执里读出**真实 stats 数值**，写进校准卡 evidence

这样一条竖切就能验到：
  真 HTTP 请求 -> 真 tool_calls 解析 -> 真 subprocess 命令行调用 -> 真 JSON 解析
  -> 业务指标计算 -> evidence 与真实数值对应 -> 终态收敛
而不是「45/45 全绿但全是脚本化 mock」。

故障注入（由测试脚本切换 server.mode）：
  normal      -> 正常两阶段
  http_error  -> 恒返 500，验证重试耗尽 -> llm_degraded 降级
  malformed   -> 返回结构异常，验证 _parse 不崩溃
"""
from __future__ import annotations

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _platforms_from_messages(messages, fallback):
    """从 user 消息里的「平台清单」行取平台名；解析不到就用 fallback。"""
    for m in messages:
        if m.get("role") == "user":
            text = m.get("content") or ""
            hit = re.search(r"平台清单[：:]\s*([^\n]+)", text)
            if hit:
                parts = [p.strip() for p in hit.group(1).split(",") if p.strip()]
                if parts:
                    return parts
    return list(fallback)


def _stats_from_messages(messages):
    """把 tool 回执里的 stats 抽出来（控制器写入的是 analyze_stats 后的指标）。"""
    found = {}
    for m in messages:
        if m.get("role") != "tool":
            continue
        try:
            payload = json.loads(m.get("content") or "{}")
        except (ValueError, TypeError):
            continue
        if payload.get("ok") and isinstance(payload.get("stats"), dict):
            found[payload.get("platform", "?")] = payload["stats"]
    return found


def _build_response(messages, fallback_platforms):
    tool_msgs = [m for m in messages if m.get("role") == "tool"]

    if not tool_msgs:
        # 阶段 1：先采数
        plats = _platforms_from_messages(messages, fallback_platforms)
        calls = [
            {
                "id": f"call_stats_{i}",
                "type": "function",
                "function": {
                    "name": "fetch_platform_stats",
                    "arguments": json.dumps({"platform": p, "account": "alice", "period": "30d"}),
                },
            }
            for i, p in enumerate(plats)
        ]
        return {"choices": [{"message": {
            "role": "assistant", "content": "先采集各平台运营统计，再下结论。", "tool_calls": calls,
        }}]}

    # 阶段 2：用真实 stats 写 evidence，禁止凭空编数值
    stats = _stats_from_messages(messages)
    cards = []
    for i, (platform, m) in enumerate(stats.items()):
        views = m.get("views", 0)
        likes = m.get("likes", 0)
        comments = m.get("comments", 0)
        engagement = m.get("engagement_rate", 0.0)
        cards.append({
            "platform": platform,
            "issue": "互动率偏低（低于 2% 阈值）" if engagement < 0.02 else "互动表现正常",
            "evidence": f"views={views}, likes={likes}, comments={comments}, "
                        f"likes+comments={likes + comments}, engagement_rate={engagement}",
            "action": "优化标题钩子与开头 3 秒，结尾增加明确互动引导",
            "priority": 1 if engagement < 0.02 else 3,
        })
    if not cards:
        # 没有采到真实数据就不硬造：给一张「数据不足」卡
        cards.append({
            "platform": "global",
            "issue": "工具未返回可用统计",
            "evidence": "本次工具回执中无 stats 字段",
            "action": "检查平台命令行输出后复跑",
            "priority": 3,
        })
    return {"choices": [{"message": {
        "role": "assistant", "content": "已基于工具返回的真实数值给出校准卡。",
        "tool_calls": [{
            "id": "call_emit_1", "type": "function",
            "function": {
                "name": "emit_calibration_cards",
                "arguments": json.dumps({"cards": cards, "summary": "基于真实采集数据的校准"}, ensure_ascii=False),
            },
        }],
    }}]}


class StubServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, addr, handler, platforms):
        super().__init__(addr, handler)
        self.platforms = list(platforms)
        self.mode = "normal"
        self.requests = []          # 记录每次收到的 messages，供验收取证
        self.lock = threading.Lock()


class StubHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 静默，避免污染验收输出

    def do_POST(self):
        srv = self.server
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            messages = body.get("messages", [])
            with srv.lock:
                srv.requests.append({"model": body.get("model"), "messages": messages})
                mode = srv.mode
        except Exception:
            self.send_error(400)
            return

        if mode == "http_error":
            self.send_error(500, "stub injected failure")
            return
        if mode == "malformed":
            payload = {"choices": [{"unexpected": "no message field"}]}
        else:
            payload = _build_response(messages, srv.platforms)

        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def start_stub_server(platforms, host="127.0.0.1", port=0):
    """启动并返回 (server, thread, base_url)。port=0 由系统分配空闲端口。"""
    srv = StubServer((host, port), StubHandler, platforms)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    return srv, th, f"http://{host}:{srv.server_address[1]}/v1"
