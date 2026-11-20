"""本机假平台命令行（内部测试桩）——不联网、不读真平台、不需要任何凭据。

用途：让 CLIPlatformAdapter 真的走 subprocess 调用、真的解析 stdout JSON，
从而验证「外部工具调用」这条链路本身是否接通，而不是又跑一遍 mock 对象。

输出固定数值（非随机），便于验收时把校准卡 evidence 与真实 stats 逐项对上。
  --mode stats  -> 输出一个 JSON 对象
  --mode posts  -> 输出一个 JSON 数组
  --fail        -> 故意输出非法 JSON，用于验证「工具失败 -> 降级跳过」链路
"""
from __future__ import annotations

import argparse
import json
import sys

# 固定数值：views=6000, likes=15, comments=3 -> 互动率 18/6000 = 0.003（< 2% 阈值）
STATS = {
    "followers": 120,
    "views": 6000,
    "likes": 15,
    "comments": 3,
}

POSTS = [
    {"id": "devto-1", "title": "如何提升自媒体内容互动率？", "published_at": "2026-11-01",
     "views": 3200, "likes": 9, "comments": 2},
    {"id": "devto-2", "title": "内容运营的三次复盘", "published_at": "2026-11-05",
     "views": 2800, "likes": 6, "comments": 1},
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["stats", "posts"], required=True)
    ap.add_argument("--user", default="alice")
    ap.add_argument("--period", default="30d")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--fail", action="store_true")
    a = ap.parse_args()

    if a.fail:
        # 故意破坏：让 CLIPlatformAdapter 的 json.loads 抛错 -> PlatformError
        print("THIS_IS_NOT_JSON_ON_PURPOSE")
        return 0

    if a.mode == "stats":
        out = dict(STATS)
        out["account"] = a.user
        out["period"] = a.period
    else:
        out = POSTS[: max(0, min(a.limit, len(POSTS)))]

    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
