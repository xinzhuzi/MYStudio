#!/usr/bin/env python3
# 出处:2026-09-19 战役产物(引擎守护拉起,记忆配方在用);2026-09-22 带日期文件名清整提升为常驻件,幂等可重跑。
"""道劫门禁配套·ComfyUI 引擎常驻拉起器(09-19,一次性运维件,非产品代码)。

背景:动态工作流门禁要求引擎监听 17000(逐节点 object_info 验证),但本机
漫影 App/侧车未运行(引擎按设计闲置不监听,machine.md:15);machine.md:36-38
禁止复用退役 Desktop 命令行,且无已验证无头配方。本脚本走**仓库自己的**
EngineManager.start_sync 路径(manifest 参数/extra_model_paths/看门狗/崩溃
守卫/收编语义全保留),daemon 化驻留以满足看门狗「父进程须存活」约束。

清理语义:SIGTERM/SIGINT → em.stop()(优雅停引擎)+ 释放 engine.lock;
被 SIGKILL → 看门狗孙进程自动回收引擎进程组。真 App 之后启动:image_gen
侧车经「收编孤儿」设计路径接管运行中引擎(本进程命令行无 image_gen.main,
engine.lock 对真侧车=可接管,不阻塞)。
"""
from __future__ import annotations

import pathlib
import signal
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))  # noqa: E402(须先于引擎模块导入)

from engines.comfyui.engine_manager import (  # noqa: E402
    EngineManager,
    EngineOpError,
    release_engine_lock,
)

PATIENCE_S = 600  # 冷启动外层耐心(>start_sync 内置 120s,首次加载模型慢)


def main() -> int:
    em = EngineManager()
    print(f"[keeper] pid={__import__('os').getpid()} 起,ensure 引擎…", flush=True)
    healthy = False
    try:
        res = em.start_sync(progress=lambda p, m: print(f"[keeper] start {p}% {m}", flush=True))
        print(f"[keeper] start_sync 结果: {res}", flush=True)
        healthy = True
    except EngineOpError as exc:
        print(f"[keeper] start_sync 报错(进程可能仍在预热): {exc}", flush=True)
        deadline = time.monotonic() + PATIENCE_S
        while time.monotonic() < deadline:
            proc = em._proc
            if proc is not None and proc.poll() is not None:
                print("[keeper] 引擎进程已退出,放弃", flush=True)
                break
            if em.is_healthy():
                print("[keeper] 迟到健康(预热超 120s),收编继续", flush=True)
                healthy = True
                break
            time.sleep(3.0)
    if not healthy:
        release_engine_lock()
        return 1

    def _term(signum, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _term)
    signal.signal(signal.SIGINT, _term)
    print(f"[keeper] 引擎健康,驻留(口 {em._running_port});SIGTERM=优雅停", flush=True)
    try:
        while True:
            time.sleep(30)
    except SystemExit:
        pass
    finally:
        try:
            print("[keeper] 收尾:em.stop()", flush=True)
            em.stop()
        finally:
            release_engine_lock()
            print("[keeper] 退出", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
