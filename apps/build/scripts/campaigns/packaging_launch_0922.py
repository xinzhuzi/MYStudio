#!/usr/bin/env python3
"""打包覆盖安装启动器(09-22 战役件)。

唯一入口是 apps/build/packaging/build-mac.sh:它内部完成 build-desktop.mjs 构建
→ 覆盖安装 /Applications → installed smoke(见 AGENTS.md「macOS 打包与覆盖安装」
与 build-mac.sh:62-78 的安装+冒烟+一次全链重试)。本启动器不碰打包链本体,只做:

  1. 环境兜底:ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR 走 npmmirror
     (setdefault,环境已有值不覆盖),防 GitHub 直连断连;
  2. 参数列表调 `sh apps/build/packaging/build-mac.sh`(额外 argv 原样透传),
     全量日志落盘 apps/output/automation/packaging_launch_0922.log(git 忽略区);
  3. stdout 只回显尾部 80 行 + 退出码——动态工作流 world.run 单流输出帽 256KB,
     electron-builder + 冒烟全量输出直接回显必超帽、整调用被拒。

超时兜底:内部限时 3420s(留在外层 world.run 3600s 预算内),超时杀整个进程组
(start_new_session 建组,防 sh 死后 node/electron-builder 成孤儿),日志仍完整
落盘并以 124 退出;build-mac.sh 自带 wait_for_chain_free 并发守卫(build-mac.sh:35-52),
即便有残留,下一轮也会等待而非互相踩踏。

路径注意:本件住 campaigns/,归档件相对路径按原位失效(campaigns/README.md);
本件按新位取 parents[4] 推仓库根,勿挪动后再原样运行。
"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]  # campaigns/→scripts→build→apps→仓库根
LOG = REPO / "apps/output/automation/packaging_launch_0922.log"
ENTRY = "apps/build/packaging/build-mac.sh"  # 仓库相对的唯一入口
TAIL_LINES = 80
TIMEOUT_S = 3420

env = dict(os.environ)
env.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
env.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR",
               "https://npmmirror.com/mirrors/electron-builder-binaries/")

cmd = ["sh", ENTRY, *sys.argv[1:]]
started = time.time()
proc = subprocess.Popen(cmd, cwd=REPO, env=env, text=True,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        start_new_session=True)
timed_out = False
try:
    out, err = proc.communicate(timeout=TIMEOUT_S)
except subprocess.TimeoutExpired:
    timed_out = True
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    out, err = proc.communicate()

LOG.parent.mkdir(parents=True, exist_ok=True)
full = (out or "") + "\n--STDERR--\n" + (err or "")
LOG.write_text(
    full + f"\n--META-- exit={proc.returncode} timeout={timed_out} "
    f"seconds={time.time() - started:.0f} cmd={' '.join(cmd)}\n",
    encoding="utf-8")

print(f"[packaging_launch_0922] full log: {LOG}")
print("\n".join(full.splitlines()[-TAIL_LINES:]))
if timed_out:
    print(f"[packaging_launch_0922] TIMEOUT after {TIMEOUT_S}s; process group killed; exit code: 124")
    sys.exit(124)
print(f"[packaging_launch_0922] exit code: {proc.returncode}")
sys.exit(proc.returncode)
