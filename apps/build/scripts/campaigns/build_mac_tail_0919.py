#!/usr/bin/env python3
"""跑 build-mac.sh 的尾部回显包装(09-19)。

用途:动态工作流 world.run 的 stdout 上限 256KB,electron-builder 全量输出会撞顶
导致整个调用被拒;本包装把全量日志落盘,只回显末尾 6KB + 透传退出码。
镜像变量放 setdefault——环境里已有值时不覆盖。
"""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
LOG = REPO / "apps/build/scripts/build_mac_tail_0919.log"

env = dict(os.environ)
env.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
env.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR",
               "https://npmmirror.com/mirrors/electron-builder-binaries/")

p = subprocess.run(["sh", "apps/build/packaging/build-mac.sh"],
                   capture_output=True, text=True, env=env, cwd=REPO)
LOG.write_text((p.stdout or "")[-200000:] + "\n--STDERR--\n" + (p.stderr or "")[-50000:],
               encoding="utf-8")
print(((p.stdout or "") + "\n--STDERR--\n" + (p.stderr or ""))[-6000:])
sys.exit(p.returncode)
