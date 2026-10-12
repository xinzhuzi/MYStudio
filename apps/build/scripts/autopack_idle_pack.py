#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""空闲自动打包检查——每 2 小时跑一次:过去 1 小时内仓库零文件活动(修改/创建/删除)即自动打包覆盖安装。

用户 2026-10-13 令(当晚两裁):①空闲=本项目内任何文件不曾被修改/创建/删除(含未跟踪
与忽略文件);②触发挂钟点,每 2 小时检查 1 次,不做常驻进程;1 天最多成功打包 1 次;
打包唯一入口 apps/build/packaging/build-mac.sh。

检查时回看 1 小时窗口:全树扫文件+目录的 mtime/ctime(增删都会刷新直接父目录时间戳,
删除不留文件本体,靠目录时间戳捕获)。放行闸(全过才发车):今日未成功打包 /
当日失败未满 2 次(满 2 停机待人工)/ 无打包链在跑 / 1 小时零活动 / 漫影 App 未运行
(smoke 会强关 App)/ ComfyUI 引擎队列空 / 有实际变更(HEAD 一致且工作区干净则跳过)。

状态/日志住 ~/.my-studio-autopack/(仓库外:不污染 git、不怕打包清场、也不算仓库活动)。
扫描只排除 .git(git 内部记账,真实改动已在工作树镜像)。

用法:
  python3 autopack_idle_pack.py check   # 定时入口:判定;条件满足即后台发车(AUTOPACK_DRYRUN=1 只报不发)
  python3 autopack_idle_pack.py run     # 内部子命令:实际执行打包(由 check 拉起的后台进程)
  python3 autopack_idle_pack.py status  # 人看:状态 + 闸门实况 + 日志尾
  python3 autopack_idle_pack.py --reset-failures

测试口:MYSTUDIO_AUTOPACK_IDLE_SEC(回看窗口秒数)/ MYSTUDIO_AUTOPACK_DRYRUN /
MYSTUDIO_AUTOPACK_STATE_DIR(隔离状态目录)。
"""

import datetime
import json
import os
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BUILD_MAC = os.path.join(REPO, "apps", "build", "packaging", "build-mac.sh")

STATE_DIR = os.environ.get("MYSTUDIO_AUTOPACK_STATE_DIR") or os.path.expanduser("~/.my-studio-autopack")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
LOCK_FILE = os.path.join(STATE_DIR, "lock")
LOG_FILE = os.path.join(STATE_DIR, "last-build.log")

IDLE_SEC = int(os.environ.get("MYSTUDIO_AUTOPACK_IDLE_SEC", "3600"))
DRYRUN = os.environ.get("MYSTUDIO_AUTOPACK_DRYRUN") == "1"
MAX_FAILURES_PER_DAY = 2

APP_PROCESS_PATTERNS = ("漫影工作室.app", "manying-studio.app", "MYStudio.app")
ENGINE_PORTS = (17001, 17000)
# 行首进程名在此集合 = 只是在查看/编辑脚本文件,不算构建在跑
NOT_A_BUILD_FIRST_TOKENS = {
    "vim", "nvim", "vi", "less", "more", "cat", "head", "tail", "rg", "grep",
    "code", "zcode", "python", "python3", "node", "npm", "pnpm",
}


def today_s():
    return datetime.date.today().isoformat()


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(st):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_FILE)


def git_text(*args):
    p = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else ""


def ps_lines():
    p = subprocess.run(["ps", "-axo", "command="], capture_output=True, text=True)
    return (p.stdout or "").splitlines()


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def build_running():
    """已有打包链在跑(本调度器发的 lock,或任何 bash 在跑 build-mac.sh)?"""
    if os.path.exists(LOCK_FILE):
        try:
            pid = int(open(LOCK_FILE, encoding="utf-8").read().strip() or 0)
        except (OSError, ValueError):
            pid = 0
        if pid > 0 and pid_alive(pid):
            return f"lock pid={pid}"
        try:
            os.remove(LOCK_FILE)  # pid 已死 = 陈旧锁,清掉
        except OSError:
            pass
    for line in ps_lines():
        if "build-mac.sh" not in line:
            continue
        first = line.strip().split(" ", 1)[0]
        if first.rsplit("/", 1)[-1] in NOT_A_BUILD_FIRST_TOKENS:
            continue
        return line.strip()[:160]
    return None


def app_running():
    for line in ps_lines():
        for pat in APP_PROCESS_PATTERNS:
            if pat in line:
                return pat
    return None


def engine_busy():
    for port in ENGINE_PORTS:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/queue", timeout=2
            ) as r:
                q = json.loads(r.read().decode("utf-8", "replace") or "{}")
            n = len(q.get("queue_running") or []) + len(q.get("queue_pending") or [])
            if n > 0:
                return port, n
        except Exception:
            continue
    return None


def worktree_clean():
    return git_text("status", "--porcelain").strip() == ""


def current_head():
    return git_text("rev-parse", "HEAD").strip()


# ---------------------------------------------------------------- 活动回看

def find_recent_activity(idle_sec=None):
    """过去 idle_sec 秒内的文件/目录活动(修改/创建/删除)。

    文件本体看 mtime/ctime;删除不留本体,靠直接父目录的时间戳捕获
    (增删条目都会刷新父目录 mtime,元数据变动走 ctime)。
    """
    if idle_sec is None:
        idle_sec = IDLE_SEC
    cutoff = time.time() - idle_sec
    hits = []
    for root, dirs, files in os.walk(REPO, topdown=True, followlinks=False):
        dirs[:] = [d for d in dirs if d != ".git"]
        rel_root = os.path.relpath(root, REPO)
        prefix = "" if rel_root == "." else rel_root + "/"
        for d in list(dirs):
            rel = prefix + d
            try:
                st = os.lstat(os.path.join(root, d))
            except OSError:
                continue
            t = max(st.st_mtime, st.st_ctime)
            if t > cutoff:
                hits.append((t, rel + "/"))
        for name in files:
            rel = prefix + name
            try:
                st = os.lstat(os.path.join(root, name))
            except OSError:
                continue
            t = max(st.st_mtime, st.st_ctime)
            if t > cutoff:
                hits.append((t, rel))
    hits.sort(reverse=True)
    return hits


# ---------------------------------------------------------------- 检查与发车

def start_detached_run():
    os.makedirs(STATE_DIR, exist_ok=True)
    log = open(LOG_FILE, "a", buffering=1)
    log.write(f"\n==== autopack run {datetime.datetime.now().isoformat(timespec='seconds')} ====\n")
    log.flush()
    proc = subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "run"],
        cwd=REPO,
        stdout=log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    log.close()
    with open(LOCK_FILE, "w", encoding="utf-8") as f:
        f.write(str(proc.pid))
    return proc.pid


def emit(verdict, reason):
    print(f"[VERDICT] {verdict}")
    print(f"原因: {reason}")


def cmd_check():
    st = load_state()
    if st.get("last_success_date") == today_s():
        return emit(
            "ALREADY_PACKED_TODAY",
            f"今天已成功打包过(head={(st.get('last_pack_head') or '?')[:12]})",
        )
    if (
        st.get("failure_date") == today_s()
        and int(st.get("failure_count", 0)) >= MAX_FAILURES_PER_DAY
    ):
        return emit(
            "SKIP_FAILED_TODAY",
            f"今天已失败 {st['failure_count']} 次,停机待人工"
            f"(python3 {os.path.abspath(__file__)} --reset-failures 复位);日志 {LOG_FILE}",
        )
    b = build_running()
    if b:
        return emit("BUILD_RUNNING", f"已有打包链在跑: {b}")
    hits = find_recent_activity()
    if hits:
        age_min = max(1, int((time.time() - hits[0][0]) / 60))
        sample = ", ".join(rel for _, rel in hits[:5])
        more = f" 等 {len(hits)} 处" if len(hits) > 5 else ""
        return emit(
            "BUSY",
            f"最近{IDLE_SEC // 60}分钟内有 {len(hits)} 处文件/目录活动"
            f"(最新 {age_min} 分钟前): {sample}{more}",
        )
    pat = app_running()
    if pat:
        return emit("BUSY", f"漫影 App 正在运行(匹配 {pat});打包 smoke 会强关 App,避让")
    eng = engine_busy()
    if eng:
        return emit("BUSY", f"ComfyUI 引擎(端口 {eng[0]})队列有 {eng[1]} 个任务在跑/在排,避让")
    head = current_head()
    if head and st.get("last_pack_head") == head and worktree_clean():
        return emit(
            "SKIP_NO_CHANGES",
            f"HEAD {head[:12]} 与上次成功打包完全一致且工作区干净,无需重复打包",
        )
    if DRYRUN:
        return emit("STARTED", "DRYRUN: 条件满足,本应后台发车打包(本次干跑未发)")
    pid = start_detached_run()
    return emit(
        "STARTED",
        f"1小时零活动且闸门全过,打包已后台发车(pid={pid});日志 {LOG_FILE};完成后自动记账",
    )


# ---------------------------------------------------------------- 打包执行

def cmd_run():
    # 用户 2026-10-13 亲口令定时打包 = 授权解锁 smoke 关/启 App(build-mac.sh 头注约定的透传口)
    os.environ["MANYYING_ALLOW_APP_LAUNCH"] = "1"
    os.makedirs(STATE_DIR, exist_ok=True)
    if not os.path.exists(LOCK_FILE):
        with open(LOCK_FILE, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    head = current_head()
    t0 = time.time()
    print(f"[autopack] 开始打包 head={head[:12]}", flush=True)
    rc = subprocess.call(["bash", BUILD_MAC], cwd=REPO, stdin=subprocess.DEVNULL)
    mins = (time.time() - t0) / 60
    st = load_state()
    if rc == 0:
        st["last_success_date"] = today_s()
        st["last_pack_head"] = head
        st["failure_date"] = ""
        st["failure_count"] = 0
        print(f"[autopack] 打包成功 用时{mins:.0f}分钟", flush=True)
    else:
        if st.get("failure_date") == today_s():
            st["failure_count"] = int(st.get("failure_count", 0)) + 1
        else:
            st["failure_date"] = today_s()
            st["failure_count"] = 1
        print(
            f"[autopack] 打包失败 exit={rc} 用时{mins:.0f}分钟"
            f"(今日第 {st['failure_count']} 次失败,满 {MAX_FAILURES_PER_DAY} 次停机待人工)",
            flush=True,
        )
    st["last_run_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    save_state(st)
    try:
        os.remove(LOCK_FILE)
    except OSError:
        pass


# ---------------------------------------------------------------- 人看

def cmd_status():
    print("== state ==")
    print(json.dumps(load_state(), ensure_ascii=False, indent=2))
    print("== app ==", app_running() or "(未运行)")
    print("== engine ==", engine_busy() or "(空闲/未启动)")
    print("== 打包链 ==", build_running() or "(无)")
    hits = find_recent_activity()
    print(f"== 最近{IDLE_SEC // 60}分钟活动 {len(hits)} 处 ==")
    for t, rel in hits[:5]:
        print(f"  {int((time.time() - t) / 60)}分钟前  {rel}")
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        print("== last-build.log 尾10行 ==")
        sys.stdout.writelines(lines[-10:])


def cmd_reset_failures():
    st = load_state()
    st["failure_date"] = ""
    st["failure_count"] = 0
    save_state(st)
    print("已复位当日失败计数。")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "check":
        cmd_check()
    elif cmd == "run":
        cmd_run()
    elif cmd == "status":
        cmd_status()
    elif cmd == "--reset-failures":
        cmd_reset_failures()
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
