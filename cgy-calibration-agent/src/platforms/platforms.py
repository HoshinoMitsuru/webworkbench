"""平台适配器：把"外部工具调用"封装成统一接口，并强制超时/失败降级。

两种实现：
- MockPlatformAdapter：demo/评测用，返回可信假数据，可指定某些平台故意失败。
- CLIPlatformAdapter：比赛接真平台开发者 CLI，subprocess 调用 + 超时 + JSON 解析。

为什么统一接口：控制器只认 fetch_stats / fetch_posts，至于底层是 mock 还是真 CLI，
对编排与 guardrails 透明——这才能让超时/降级逻辑可复用、可测。
"""
from __future__ import annotations

import json
import time
import subprocess
import random
from typing import Dict, List, Any


class PlatformError(Exception):
    """平台工具调用失败（超时/非零退出/解析失败）的统一异常。"""


class PlatformAdapter:
    def fetch_stats(self, platform: str, account: str, period: str, trace_id: str) -> Dict[str, Any]:
        raise NotImplementedError

    def fetch_posts(self, platform: str, account: str, limit: int, trace_id: str) -> List[Dict[str, Any]]:
        raise NotImplementedError


class MockPlatformAdapter(PlatformAdapter):
    def __init__(self, fail_platforms: set = None, seed: int = 0):
        self.fail_platforms = set(fail_platforms or [])
        self._rng = random.Random(seed)

    def _fake_stats(self, platform: str) -> Dict[str, Any]:
        r = self._rng
        return {
            "followers": r.choice([40, 120, 800, 1500]),
            "views": r.choice([200, 1500, 6000, 12000]),
            "likes": r.choice([0, 15, 80, 300]),
            "comments": r.choice([0, 3, 20, 60]),
        }

    def _fake_posts(self, platform: str, limit: int) -> List[Dict[str, Any]]:
        return [
            {
                "id": f"{platform}-{i}",
                "title": f"示例标题 {i}：如何提升自媒体内容互动率？",
                "published_at": "2026-11-0" + str((i % 9) + 1),
                "views": self._rng.randint(100, 5000),
                "likes": self._rng.randint(0, 200),
                "comments": self._rng.randint(0, 30),
            }
            for i in range(max(1, min(limit, 10)))
        ]

    def fetch_stats(self, platform: str, account: str, period: str, trace_id: str) -> Dict[str, Any]:
        if platform in self.fail_platforms:
            raise PlatformError(f"mock: {platform} 工具调用失败（模拟）")
        return self._fake_stats(platform)

    def fetch_posts(self, platform: str, account: str, limit: int, trace_id: str) -> List[Dict[str, Any]]:
        if platform in self.fail_platforms:
            raise PlatformError(f"mock: {platform} 工具调用失败（模拟）")
        return self._fake_posts(platform, limit)


class CLIPlatformAdapter(PlatformAdapter):
    """按 config.platforms 的命令模板，调用真实开发者 CLI。

    命令须输出 JSON 到 stdout（stats -> 对象；posts -> 数组）。
    超时/非零退出/解析失败统一转 PlatformError，由控制器降级处理。
    """

    def __init__(self, cfg: Dict[str, Any], timeout_s: int = 20, retries: int = 2):
        self.cfg = cfg or {}
        self.timeout_s = timeout_s
        self.retries = retries

    def _run(self, cmd_template: str, **kw) -> Any:
        cmd = cmd_template.format(**kw)
        last_err = None
        for attempt in range(self.retries + 1):
            try:
                proc = subprocess.run(
                    cmd, shell=True, capture_output=True, text=True, timeout=self.timeout_s
                )
                if proc.returncode != 0:
                    raise PlatformError(f"exit={proc.returncode} stderr={proc.stderr[:200]}")
                return json.loads(proc.stdout)
            except subprocess.TimeoutExpired:
                last_err = f"timeout>{self.timeout_s}s"
            except json.JSONDecodeError as e:
                last_err = f"json_decode:{e}"
            except PlatformError as e:
                last_err = str(e)
            if attempt < self.retries:
                # 指数退避 + 抖动，避免对同一 CLI 连续冲击（C4）
                time.sleep(0.5 * (2 ** attempt) + random.uniform(0, 0.2))
        raise PlatformError(last_err or "cli_failed")

    def fetch_stats(self, platform: str, account: str, period: str, trace_id: str) -> Dict[str, Any]:
        spec = self.cfg.get(platform)
        if not spec or "stats_cmd" not in spec:
            raise PlatformError(f"未配置平台 {platform} 的 stats_cmd")
        out = self._run(spec["stats_cmd"], account=account, period=period, limit=0)
        if not isinstance(out, dict):
            raise PlatformError(f"{platform} stats 期望对象，得到 {type(out)}")
        return out

    def fetch_posts(self, platform: str, account: str, limit: int, trace_id: str) -> List[Dict[str, Any]]:
        spec = self.cfg.get(platform)
        if not spec or "posts_cmd" not in spec:
            raise PlatformError(f"未配置平台 {platform} 的 posts_cmd")
        out = self._run(spec["posts_cmd"], account=account, period="30d", limit=limit)
        if not isinstance(out, list):
            raise PlatformError(f"{platform} posts 期望数组，得到 {type(out)}")
        return out
