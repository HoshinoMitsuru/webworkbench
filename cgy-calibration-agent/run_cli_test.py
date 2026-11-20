"""CLI 内部测试启动器（环境适配，不改动项目任何文件）。

## 为什么要这个启动器

本机受管运行时下 `codecs.lookup('idna')` 抛 `LookupError: unknown encoding: idna`，
而 `encodings.idna` 模块本身可正常导入——即 `encodings` 包的搜索钩子未注册到 codecs。
后果：`socket.getfqdn()`、`requests` 解析主机名、`http.server` 绑定端口全部失败，
CLI 测试 8 项里 4 项失败（`llm_degraded`、服务端请求次数 0）。

处理：进程内手工向 codecs 注册 idna 编解码器，并让回环地址的反向解析走字面量。
**不修改 `src/`、`tests/`、`config.yaml` 任何一行**，仅在跑测试时做环境适配。

影响范围：只在本进程内生效，与真实模型/真实平台行为无关。

用法：
    ../.venv/Scripts/python.exe run_cli_test.py
"""
from __future__ import annotations

import codecs
import os
import runpy
import socket
import sys


def install_idna() -> bool:
    """向 codecs 注册 idna。返回是否原本就可用。"""
    try:
        codecs.lookup("idna")
        return True
    except LookupError:
        pass
    import encodings.idna as m

    ci = codecs.CodecInfo(
        name="idna",
        encode=m.Codec().encode,
        decode=m.Codec().decode,
        incrementalencoder=m.IncrementalEncoder,
        incrementaldecoder=m.IncrementalDecoder,
        streamwriter=m.StreamWriter,
        streamreader=m.StreamReader,
    )
    codecs.register(lambda name: ci if name == "idna" else None)
    return False


def main() -> int:
    was_ok = install_idna()
    print(f"[env] idna codec: {'已可用' if was_ok else '缺失，已在本进程内注册'}")

    socket.gethostbyaddr = lambda ip: (str(ip), [], [str(ip)])

    # 子进程（main.py）由测试用 subprocess 启动，主进程的补丁传不过去。
    # 通过 PYTHONPATH 前置一个只含 sitecustomize.py 的临时目录来适配子进程。
    stub_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".piptmp", "stubenv")
    stub_dir = os.path.normpath(stub_dir)
    if os.path.exists(os.path.join(stub_dir, "sitecustomize.py")):
        old = os.environ.get("PYTHONPATH", "")
        os.environ["PYTHONPATH"] = stub_dir + (os.pathsep + old if old else "")
        print(f"[env] 子进程 PYTHONPATH 前置: {stub_dir}")
    else:
        print(f"[env] 警告：未找到 {stub_dir}/sitecustomize.py，子进程可能仍失败")

    here = os.path.dirname(os.path.abspath(__file__))
    test = os.path.join(here, "tests", "test_cli_entry.py")
    if not os.path.exists(test):
        print("找不到测试脚本:", test)
        return 1

    sys.argv = [test]
    runpy.run_path(test, run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
