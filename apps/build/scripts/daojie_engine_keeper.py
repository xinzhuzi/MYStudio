#!/usr/bin/env python3
# 出处:2026-09-19 战役产物(引擎守护拉起,记忆配方在用);2026-09-22 带日期文件名清整提升为常驻件,幂等可重跑。
"""道劫门禁配套·ComfyUI 引擎常驻拉起器(09-19,一次性运维件,非产品代码)。

背景:动态工作流门禁要求引擎监听 17000(逐节点 object_info 验证),但本机
漫影 App/侧车未运行(引擎按设计闲置不监听,machine.md:15);machine.md:36-38
禁止复用退役 Desktop 命令行,且无已验证无头配方。本脚本走**仓库自己的**
EngineManager.start_sync 路径(manifest 参数/extra_model_paths/看门狗/崩溃
守卫/收编语义全保留),daemon 化驻留以满足看门狗「父进程须存活」约束。

1010 增死亡守护:引擎死了两次都靠人工拉——EngineManager 崩溃守卫(3s 节拍,
3 次/15 分钟熔断)没能兜住,keeper 本体只拉起+驻留不监死。现驻留期加最小
死亡监视:周期探 127.0.0.1:17001 健康口,连续 2 次失败即按 1010 人工拉起
实证过的原命令行原参数 nohup 重拉(见 _death_watch)。

清理语义:SIGTERM/SIGINT → em.stop()(优雅停引擎)+ 释放 engine.lock;
被 SIGKILL → 看门狗孙进程自动回收引擎进程组。真 App 之后启动:image_gen
侧车经「收编孤儿」设计路径接管运行中引擎(本进程命令行无 image_gen.main,
engine.lock 对真侧车=可接管,不阻塞)。死亡守护 nohup 拉起的引擎对 em 为
孤儿态(可被真 App 收编),keeper 退出时 em.stop() 不误杀。
"""
from __future__ import annotations

import pathlib
import signal
import subprocess
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

# ── 1010 死亡守护参数 ─────────────────────────────────────────────
DEATH_PROBE_PORT = 17001        # 健康口(1010 实证运行口;/system_stats 同 is_healthy)
DEATH_PROBE_INTERVAL_S = 15.0   # 探测节拍
DEATH_PROBE_TIMEOUT_S = 5.0     # 单探超时(宽于守卫 2s:重载下防假死误判)
DEATH_FAIL_THRESHOLD = 2        # 连续失败次数→判死拉起
# 拉起命令=1010 人工拉起实证的原命令行原参数,**逐字全带**——--input-directory
# 曾被漏带致 input 目录漂移(测试员实弹踩过);> 截断重定向日志为原命令既有行为。
RESPAWN_CMD = (
    "cd /Users/zhengbingjin/Project/IP/漫影工作室/comfyui && "
    "nohup ./venv/bin/python ./ComfyUI/main.py "
    "--listen 127.0.0.1 --port 17001 --enable-manager --gpu-only "
    "--reserve-vram 16 --use-pytorch-cross-attention "
    "--input-directory ./input --output-directory ./output "
    "> ./comfyui_17001.log 2>&1 &"
)


def _death_watch(em: EngineManager) -> None:
    """死亡守护:周期探健康口,连续 DEATH_FAIL_THRESHOLD 次失败即按原命令行拉起。

    与 EngineManager 自带崩溃守卫互补:守卫 3s 节拍先行(3 次/15 分钟熔断),
    熔断或拉不起时本监视兜底(15s×连 2 败判死→nohup 原命令行重拉)。拉起后
    预热窗口(PATIENCE_S)内只探不判——模型慢加载期防重复拉起叠实例抢口。
    """
    fails = 0
    while True:
        time.sleep(DEATH_PROBE_INTERVAL_S)
        if em.is_healthy(DEATH_PROBE_PORT, timeout=DEATH_PROBE_TIMEOUT_S):
            fails = 0
            continue
        fails += 1
        print(f"[keeper] 死亡守护:口 {DEATH_PROBE_PORT} 探测失败 {fails}/{DEATH_FAIL_THRESHOLD}", flush=True)
        if fails < DEATH_FAIL_THRESHOLD:
            continue
        # 触发前再探一次:EngineManager 守卫可能恰在两拍间救活了引擎,免叠实例
        if em.is_healthy(DEATH_PROBE_PORT, timeout=DEATH_PROBE_TIMEOUT_S):
            print("[keeper] 死亡守护:触发前复探已健康(守卫可能已救活),不拉", flush=True)
            fails = 0
            continue
        print(f"[keeper] 死亡守护:连续 {DEATH_FAIL_THRESHOLD} 次失败,按 1010 实证原命令行拉起:", flush=True)
        print(f"[keeper]   {RESPAWN_CMD}", flush=True)
        subprocess.run(RESPAWN_CMD, shell=True, check=False)
        fails = 0
        deadline = time.monotonic() + PATIENCE_S  # 预热耐心(冷启动加载模型慢)
        while time.monotonic() < deadline:
            if em.is_healthy(DEATH_PROBE_PORT, timeout=DEATH_PROBE_TIMEOUT_S):
                print("[keeper] 死亡守护:拉起后恢复健康", flush=True)
                break
            time.sleep(5.0)
        else:
            print(f"[keeper] 死亡守护:拉起后 {PATIENCE_S}s 仍未健康,回监视节拍(下轮连败再拉)", flush=True)


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
    print(
        f"[keeper] 引擎健康,驻留(口 {em._running_port})+死亡守护"
        f"(口 {DEATH_PROBE_PORT} 每 {DEATH_PROBE_INTERVAL_S:.0f}s 探,连 {DEATH_FAIL_THRESHOLD} 败即拉);SIGTERM=优雅停",
        flush=True,
    )
    try:
        _death_watch(em)
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
