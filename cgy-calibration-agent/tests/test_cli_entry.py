"""内部测试 · 学生可照抄的命令行入口（2026-11-13）

验证「python main.py --config config.yaml」这条命令本身可跑：
  - 读仓库里的 config.yaml（不是测试动态生成的临时配置）
  - 在本机桩服务上注入假值凭据（不是真 key，不打印）
  - 检查输出含「真链路 LIVE」自证行 + final_tool + 真实数值 evidence

退出码 0 全过 / 2 有失败。
"""
from __future__ import annotations

import os
import sys
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

import yaml
from tests.fixtures.fake_llm_server import StubServer, StubHandler

PASS = 0
FAIL = 0


def check(cond, label, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"[PASS] {label}" + (f"  {detail}" if detail else ""))
    else:
        FAIL += 1
        print(f"[FAIL] {label}" + (f"  {detail}" if detail else ""))


cfg_path = ROOT / "config.yaml"
raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
base_url = raw["llm"]["base_url"]
port = int(re.search(r":(\d+)/", base_url).group(1))
key_env = raw["llm"]["api_key_env"]

srv = StubServer(("127.0.0.1", port), StubHandler, ["devto"])
import threading
threading.Thread(target=srv.serve_forever, daemon=True).start()

env = dict(os.environ)
env.setdefault(key_env, "LOCAL_STUB_VALUE_NOT_A_REAL_KEY")
env.setdefault("PYTHON_EXE", sys.executable)

proc = subprocess.run(
    [sys.executable, "main.py", "--config", str(cfg_path), "--platforms", "devto", "--period", "30d"],
    capture_output=True, text=True, cwd=str(ROOT), env=env, timeout=90,
)
print("=== main.py --config 原始输出（不改写、不摘要）===")
print(proc.stdout.rstrip())
if proc.stderr.strip():
    print("=== stderr ===")
    print(proc.stderr.rstrip())
print("=" * 60)

check(proc.returncode == 0, "命令行入口退出码为 0", f"exit={proc.returncode}")
check("真链路 LIVE" in proc.stdout, "装配模式自证行显示真链路")
check("LLM=OpenAILLM" in proc.stdout and "CLIPlatformAdapter" in proc.stdout,
      "自证行标明真模型客户端 + 真命令行适配器")
check("停止原因: final_tool" in proc.stdout, "终态收敛 final_tool")
check('"devto": "ok"' in proc.stdout, "data_availability 为 ok")
check("views=6000" in proc.stdout, "校准卡 evidence 含真实数值")
check("demo" not in proc.stdout.lower(), "输出无 demo 占位文本")
check(len(srv.requests) >= 2, "服务端确实收到真 HTTP 请求", f"次数={len(srv.requests)}")

srv.shutdown()
srv.server_close()

print(f"\n命令行入口内部测试：PASS={PASS}  FAIL={FAIL}")
if FAIL:
    print("❌ 未通过")
    sys.exit(2)
print("✅ 通过（本机桩，仅证明入口与链路接通）")
sys.exit(0)
