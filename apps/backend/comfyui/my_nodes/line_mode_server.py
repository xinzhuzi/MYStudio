# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""产线显存档位自动切换(2026-11-01 立,D1-D4 用户拍板;1101 自动化改版)。

出图↔出视频互斥由引擎侧自动切档:提交入队即按终输出节点分类
(SaveImage→image / SaveVideo|VHS_VideoCombine→video / SaveAudioAdvanced→audio),
首次出图→image 档(看门狗恒开+保/补 9B+引擎 /free 清缓存),首次出视频
→video 档(卸全部 LM 模型+引擎 /free 清缓存)。看门狗两向恒 ENABLE(D4a:
video 档仅停补装 9B 一救,由看门狗 ps1 读 MODE 档位感知承担);/free 是
引擎全局清缓存,发前等队列完全空(不落在途渲染中辙)。声音线(audio)不
触发切档。LM 忙时立即降级零等待(D1:切档即刻到手,LM 治理推迟+留告警,
不强等不轮询);队列守卫超时(15min,在途渲染红线)仍降级;降级态由
5min 限频的轻探测/补跑自愈→active。

LM 治理通路=actor 模式(D3):引擎只发指令——原子写 action 文件→
schtasks /Run MY-LineMode-actor(计划任务以 ZBJ+S4U 跑,解无人登入触发)
→轮询 result 文件,attempt_id 握手防串话。执行件
apps/build/scripts/win/line-mode-actor.ps1(部署位 C:\\Users\\ZBJ\\.lmstudio\\)。

状态真源:C:\\Users\\ZBJ\\.win-line-mode.json(原子写 tmp+os.replace);
查询 GET /my-nodes/line-mode(限引擎本机/ssh 隧道环回)。急停开关=创建
C:\\Users\\ZBJ\\.win-line-mode.disabled 标记文件(每序列前复查,切换器即
no-op;观察模式仍在)。诊断路由 /my-nodes/line-mode/diagnosis 默认关
(常量 LINE_MODE_DIAGNOSIS_ENABLED),开时只跑固定 argv 只读命令+SHA256
内存基线对拍。

工程纪律(prompt_log_server.install 同款):全程 try/except,任何失败
静默绝不挡装载与出图;只包一层 PromptQueue.put(幂等守卫);平台守卫
win32 only,非 Windows 打印 no-op 不起线程不触文件(观察模式也免)。

端口三源决议(G0e,2026-11-01 实查定谳):引擎进程内直读
PromptServer.instance.port → cli_args.args.port → 账本兜底 17000
(manifest.json engine.port=17000;运行口实测会漂移,如 17595——写死
兜底+运行时优先,漂移不失联)。
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import threading
import time
import uuid

_installed = False
_logs_dir = None

TAG = "[MY档位]"

# ── Windows 侧路径(引擎跑在 Win 产线机;非 win32 全程 no-op) ──────────────
MODE_PATH = r"C:\Users\ZBJ\.win-line-mode.json"
DISABLED_FLAG = r"C:\Users\ZBJ\.win-line-mode.disabled"
ACTION_PATH = r"C:\Users\ZBJ\.lmstudio\line-mode-action.json"
RESULT_PATH = r"C:\Users\ZBJ\.lmstudio\line-mode-result.json"
LMS_EXE = r"C:\Users\ZBJ\.lmstudio\bin\lms.exe"
# 引擎若以 SYSTEM 等非 ZBJ 身份直接探测 lms 时的环境注入表(诊断路由兜底;
# actor 通路自身跑在 ZBJ+S4U 会话,天然带用户态环境)。
LMS_ENV = {
    "USERPROFILE": r"C:\Users\ZBJ",
    "APPDATA": r"C:\Users\ZBJ\AppData\Roaming",
    "LOCALAPPDATA": r"C:\Users\ZBJ\AppData\Local",
}

# 9B 调优装载目标(与 lmstudio-watchdog.ps1 同一 id)。
NINE_B_ID = "qwen3.5-9b-uncensored-hauhaucs-aggressive"

# G0e 三源定谳的兜底账本口(manifest.json engine.port=17000;运行时优先直读)。
_FREE_BASE = "http://127.0.0.1:17000"
_LM_STUDIO_BASE = "http://127.0.0.1:1234"

# 超时/节奏表(秒)。
ACTOR_PS_TIMEOUT = 30        # 单次 schtasks /Run /Query 等子进程硬超时
LM_UNLOAD_TIMEOUT = 120      # 单模型卸载 actor 预算
LM_LOAD_9B_TIMEOUT = 300     # 9B 首装 actor 预算(实弹回调基线)
GRACE_WATCHDOG = 30          # 看门狗步事后验证宽限
GRACE_LM_LOAD = 300          # load 后宽限轮询上限
GRACE_LM_UNLOAD = 120        # unload 后宽限轮询上限
QUEUE_GUARD_TIMEOUT = 15 * 60  # 队列守卫红线(在途渲染),超时降级
HEARTBEAT_INTERVAL = 60      # daemon 心跳(原子重写 MODE 保 mtime 新鲜)
PROBE_THROTTLE = 5 * 60      # 同档轻探测限频(自愈与吻合复核)
RESULT_POLL_INTERVAL = 2     # actor result 轮询间隔
MAX_AUTO_RETRIES = 3         # 连续失败 3 次后停自动重试(留告警,等新指令)
MIN_MODE_DWELL = 5 * 60      # D5b:反向切换最小驻留(防乒乓)
WORKER_SWITCH_WAIT = 120     # D6:worker 首任务等待切换完成上限(超时放行+告警)

# 终输出节点分类表(扩展位:AUDIO 当前只认 SaveAudioAdvanced)。
VIDEO_OUTPUT_CLASSES = {"SaveVideo", "VHS_VideoCombine"}
IMAGE_OUTPUT_CLASSES = {"SaveImage"}
AUDIO_OUTPUT_CLASSES = {"SaveAudioAdvanced"}

# 诊断路由默认关(开=常量改 True 重装载;只读+固定 argv+SHA256 对拍)。
LINE_MODE_DIAGNOSIS_ENABLED = False
_DIAG_BASELINE: dict | None = None

# 队列钩子的内存档位表:prompt_id → 'image'|'video'|'audio'|'unknown'。
_kind_map: dict = {}
_kind_map_lock = threading.Lock()

ACTOR_TASK = "MY-LineMode-actor"
WATCHDOG_TASK = "LMStudio-Watchdog"

# D7:机器动作段与 win-control-lock.sh 会话互斥(同锁文件+同 .guard 字节锁
# 临界区,格式镜像 win-control-lock.sh:168-177:JSON{owner,purpose,level,
# acquired,ttl_min,host};judge 语义=过期/TTL≤0/acquired 解析失败均视未持)。
WIN_CONTROL_LOCK = r"C:\Users\ZBJ\.win-control.json"
MACHINE_GUARD_TTL_MIN = 8          # 短临界区 TTL(覆盖单发治理动作最坏 ~6min)
MACHINE_GUARD_ACQUIRE_TIMEOUT = 60  # 持锁会话占用→切换器等待上限(超时降级)


class StepFailed(Exception):
    """单步失败(收编为 MODE failed;不炸 daemon 线程)。"""


class StepDegraded(Exception):
    """该步降级(D1:LM busy / 队列守卫超时——档位到手,治理推迟+留告警)。"""

    def __init__(self, step: str, reason: str):
        super().__init__(f"{step}: {reason}")
        self.step = step
        self.reason = reason


# ── 观察日志(双层:引擎 stdout + <comfy-home>/logs/line-mode-YYYYMMDD.log) ──
def _resolve_logs_dir():
    global _logs_dir
    if _logs_dir is not None:
        return _logs_dir
    from pathlib import Path
    try:
        import folder_paths
        _logs_dir = Path(folder_paths.base_path).resolve().parent / "logs"
    except Exception:
        _logs_dir = Path.cwd() / "logs"
    return _logs_dir


def _log(text: str) -> None:
    """观察日志(永不抛:出图/装载链路上任何失败都不挡)。"""
    try:
        print(f"{TAG} {text}", flush=True)  # 引擎 stdout(comfyui_<port>.log)
        from pathlib import Path
        d = _resolve_logs_dir()
        Path(d).mkdir(parents=True, exist_ok=True)
        path = Path(d) / f"line-mode-{time.strftime('%Y%m%d')}.log"
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {text}\n")
    except Exception:
        pass


# ── MODE 状态文件(原子写 tmp+os.replace;legacy 兼容读) ───────────────────
def _write_json_atomic(target: str, payload: dict) -> None:
    """同目录 tmp 写全量 JSON 后 os.replace 原子换入——读方永不见半文件。"""
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, target)


def _write_mode_atomic(payload: dict, path: str | None = None) -> None:
    _write_json_atomic(path or MODE_PATH, payload)


def _read_mode(path: str | None = None) -> dict | None:
    """读 MODE;不存在/损坏→None(不抛)。"""
    try:
        with open(path or MODE_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _parse_mode_legacy_compatible(raw: dict | None) -> dict:
    """旧 {mode,switched_at,by}(已退役手动切换器的手写形)缺 state→legacy,
    信任 mode(视作已到位的既成档位,交轻探测复核);新 schema 原样。"""
    if not isinstance(raw, dict) or not raw.get("mode"):
        return {"mode": "none", "state": "none", "steps_done": []}
    out = dict(raw)
    out.setdefault("state", "legacy")
    out.setdefault("steps_done", [])
    out.setdefault("degraded_steps", [])
    if out["mode"] not in ("image", "video"):
        out["mode"] = "none"
    return out


def _pid_alive(pid) -> bool:
    """Windows 进程探活(PROCESS_SYNCHRONIZE OpenProcess);非 Windows/失败=死。"""
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        # PROCESS_SYNCHRONIZE(0x00100000);返回 0=进程不存在
        return bool(kernel32.OpenProcess(0x00100000, False, pid))
    except Exception:
        return False


def _recover_stale_switching() -> None:
    """崩溃恢复:MODE 停在 switching 且 pid 已死→回退 none(遗留半程不悬空)。

    pid 活着(其他引擎实例在切)→不动,留给持有者;pid 字段缺失按死处理
    (无人会再写它)。
    """
    raw = _read_mode()
    if not raw or raw.get("state") != "switching":
        return
    if _pid_alive(raw.get("pid")):
        _log(f"崩溃恢复跳过:state=switching 但 pid={raw.get('pid')} 仍活(他实例持有)")
        return
    _write_mode_atomic({
        "mode": "none",
        "state": "none",
        "switched_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "by": "recover_stale_switching",
        "steps_done": [],
        "degraded_steps": [],
        "recovered_from": raw,
    })
    _log("崩溃恢复:switching 悬空(pid 死/缺)→回退 none")


def _disabled() -> bool:
    """急停标记文件在=切换器 no-op(观察模式仍在)。"""
    try:
        return os.path.exists(DISABLED_FLAG)
    except Exception:
        return False


def _mode_age_seconds(raw: dict) -> float | None:
    """MODE.switched_at 距今秒数(本地时形 %Y-%m-%dT%H:%M:%S;解析失败→None
    =不拦,D5b 驻留保护宽松面)。"""
    try:
        stamp = raw.get("switched_at")
        if not isinstance(stamp, str):
            return None
        then = time.mktime(time.strptime(stamp, "%Y-%m-%dT%H:%M:%S"))
        return max(0.0, time.time() - then)
    except Exception:
        return None


# ── 引擎端口三源决议(G0e:运行实例 → cli_args → 账本兜底 17000) ────────────
_engine_base_cache: str | None = None


def _engine_base() -> str:
    global _engine_base_cache
    if _engine_base_cache:
        return _engine_base_cache
    port = None
    try:
        from server import PromptServer  # 引擎进程内直读运行实例
        port = getattr(PromptServer.instance, "port", None)
    except Exception:
        port = None
    if not port:
        try:
            from comfy.cli_args import args as _cli_args
            port = getattr(_cli_args, "port", None)
        except Exception:
            port = None
    _engine_base_cache = f"http://127.0.0.1:{int(port) if port else _FREE_BASE.rsplit(':', 1)[1]}"
    return _engine_base_cache


def _http_json(url: str, timeout: float = 10.0, method: str = "GET", body=None):
    """环回 HTTP 小工具(只打本机;失败抛异常由调用方定夺)。"""
    import urllib.request
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _engine_queue_ids() -> set:
    """GET {engine}/queue → running+pending 的 prompt_id 并集。"""
    q = _http_json(f"{_engine_base()}/queue", timeout=10.0)
    ids: set = set()
    for key in ("queue_running", "queue_pending"):
        for item in q.get(key) or []:
            # 队列元素形 [number, prompt_id, prompt, extra_data, outputs, sensitive]
            try:
                ids.add(item[1])
            except Exception:
                continue
    return ids


def _probe_models() -> dict | None:
    """LM Studio GET :1234/api/v0/models → {model_id: state}。

    返回 None=服务不可达(与"空装载"语义分开——空表是合法的 video 态,
    不可达不能当吻合证据);失败永不抛。
    """
    try:
        j = _http_json(f"{_LM_STUDIO_BASE}/api/v0/models", timeout=10.0)
        return {m.get("id"): m.get("state") for m in (j.get("data") or []) if isinstance(m, dict)}
    except Exception:
        return None


# ── 分类器(item[4] outputs_to_execute 限定查 item[2] prompt) ────────────────
def _classify_item(item) -> str:
    """按通过校验的终输出节点分类:'image'|'video'|'audio'|'unknown'。

    契约(G0c 实读 server.py:1224/1230 + execution.py:1148-1302):
    item=6 元组 (number,prompt_id,prompt,extra_data,outputs_to_execute,
    sensitive);outputs_to_execute=validate_prompt 收敛后的 OUTPUT_NODE id
    列表(未执行分支/partial_execution_targets 不含者不在其中)。优先级
    video>image>audio;空/不可判→unknown。维护内存 map 供队列守卫用。
    """
    kind = "unknown"
    pid = None
    try:
        if isinstance(item, (tuple, list)) and len(item) >= 5:
            pid = item[1]
            prompt = item[2]
            outputs = item[4]
            if isinstance(prompt, dict) and isinstance(outputs, (list, tuple, set)):
                kinds = set()
                for node_id in outputs:
                    node = prompt.get(str(node_id))
                    if not isinstance(node, dict):
                        continue
                    cls = node.get("class_type")
                    if cls in VIDEO_OUTPUT_CLASSES:
                        kinds.add("video")
                    elif cls in IMAGE_OUTPUT_CLASSES:
                        kinds.add("image")
                    elif cls in AUDIO_OUTPUT_CLASSES:
                        kinds.add("audio")
                for winner in ("video", "image", "audio"):
                    if winner in kinds:
                        kind = winner
                        break
                else:
                    kind = "unknown" if not kinds else "unknown"
    except Exception:
        kind = "unknown"
    if pid is not None:
        try:
            with _kind_map_lock:
                _kind_map[str(pid)] = kind
        except Exception:
            pass
    return kind


# ── actor 通路(D3:引擎发指令,ZBJ+S4U 执行件跑 lms/schtasks) ───────────────
def _lock_held(raw) -> bool:
    """win-control 锁判定(镜像 win-control-lock.sh judge:139-161):
    过期(acquired+ttl_min≤now)/TTL≤0/acquired 解析失败=未持。"""
    if not isinstance(raw, dict):
        return False
    try:
        ttl = int(raw.get("ttl_min", 30))
    except Exception:
        ttl = 0
    if ttl <= 0:
        return False
    try:
        import datetime
        acquired = datetime.datetime.fromisoformat(str(raw.get("acquired", "")))
        if acquired.tzinfo is None:
            acquired = acquired.replace(tzinfo=datetime.timezone.utc)
        expire = acquired + datetime.timedelta(minutes=ttl)
        return datetime.datetime.now(datetime.timezone.utc) < expire
    except Exception:
        return False


@contextlib.contextmanager
def _guard_byte_lock():
    """win-control 锁文件的 .guard 字节锁临界区(msvcrt/fcntl,与 win-control-
    lock.sh critical():177-182 同原语同 1 字节;两原素皆无的环境直通降级)。"""
    fd = os.open(WIN_CONTROL_LOCK + ".guard", os.O_CREAT | os.O_RDWR)
    try:
        try:
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            acquired = True
        except ImportError:
            try:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except (ImportError, OSError):
                acquired = False
        except OSError:
            acquired = False  # 被他人持 NBLCK → 上层按锁文件内容判定
        yield
    finally:
        try:
            try:
                import msvcrt
                if acquired:
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            except ImportError:
                import fcntl
                if acquired:
                    fcntl.flock(fd, fcntl.LOCK_UN)
        except Exception:
            pass
        os.close(fd)


def _read_json_lenient(path: str):
    try:
        with open(path, "r", encoding="utf-8-sig") as fh:
            return json.load(fh)
    except Exception:
        return None


@contextlib.contextmanager
def _machine_guard(action: str):
    """D7:机器动作段与持锁会话(win-control-lock.sh)短临界区互斥。

    拿锁=在 .guard 字节锁临界区内 read→judge→write(空闲/过期/损坏才写入
    自己的短锁 L1/TTL 8min);冲突→2s 重试,60s 等不到→StepDegraded("guard")
    (治理推迟+告警,不与人对撞机器)。释放=owner 匹配才删(同临界区)。
    """
    token = f"line-mode-server-pid{os.getpid()}-{uuid.uuid4().hex[:8]}"
    holder = None
    deadline = time.monotonic() + MACHINE_GUARD_ACQUIRE_TIMEOUT
    while True:
        with _guard_byte_lock():
            existing = _read_json_lenient(WIN_CONTROL_LOCK)
            if _lock_held(existing):
                holder = existing
            else:
                import datetime
                _write_json_atomic(WIN_CONTROL_LOCK, {
                    "owner": token,
                    "purpose": f"line_mode 机器动作:{action}",
                    "level": "L1",
                    "acquired": datetime.datetime.now(datetime.timezone.utc)
                                .isoformat(timespec="seconds"),
                    "ttl_min": MACHINE_GUARD_TTL_MIN,
                    "host": "engine-line-mode-server",
                })
                holder = None
                break
        if time.monotonic() >= deadline:
            owner = (holder or {}).get("owner", "?")
            raise StepDegraded(
                "guard", f"win-control 锁被持(owner={owner}),机器动作 {action} 推迟")
        time.sleep(2.0)
    try:
        yield token
    finally:
        try:
            with _guard_byte_lock():
                existing = _read_json_lenient(WIN_CONTROL_LOCK)
                if isinstance(existing, dict) and existing.get("owner") == token:
                    with contextlib.suppress(Exception):
                        os.remove(WIN_CONTROL_LOCK)
        except Exception:
            pass  # 释放失败=TTL 8min 自过期,留告警


# 治理动作(动显存/计划任务)——与持锁会话互斥;只读动作不加锁。
_MACHINE_ACTIONS = {"watchdog", "load9b", "unload"}


def _actor_exec(action: str, params: dict | None = None, budget: float = 30.0,
                action_path: str | None = None, result_path: str | None = None) -> dict:
    """attempt_id 三段式(外层分发):治理动作(watchdog/load9b/unload)在
    D7 机器锁短临界区内执行——与 win-control-lock.sh 持锁会话互斥(等锁
    60s 超时→StepDegraded("guard") 治理推迟);只读(lms_ps 等)直通。"""
    if action in _MACHINE_ACTIONS:
        with _machine_guard(action):
            return _actor_exec_inner(action, params, budget, action_path, result_path)
    return _actor_exec_inner(action, params, budget, action_path, result_path)


def _actor_exec_inner(action: str, params: dict | None = None, budget: float = 30.0,
                      action_path: str | None = None, result_path: str | None = None) -> dict:
    """attempt_id 三段式本体:①action 原子写 ②schtasks /Run ③2s 轮询 result。

    只认当前 attempt_id 的 result(旧 id 丢弃);超时 budget→StepFailed。
    返回 result dict(status=done 的载荷;actor 端 error 也走 done 回流,
    由调用方按 exit_code 判败)。
    """
    attempt_id = uuid.uuid4().hex
    a_path = action_path or ACTION_PATH
    r_path = result_path or RESULT_PATH
    payload = {"attempt_id": attempt_id, "action": action,
               "params": params or {}, "ts": int(time.time())}
    _write_json_atomic(a_path, payload)
    proc = subprocess.run(
        ["schtasks", "/Run", "/TN", ACTOR_TASK],
        capture_output=True, text=True, timeout=ACTOR_PS_TIMEOUT,
    )
    if proc.returncode != 0:
        raise StepFailed(f"actor run 失败(rc={proc.returncode}): {(proc.stderr or '').strip()[:200]}")
    deadline = time.monotonic() + budget
    while time.monotonic() < deadline:
        time.sleep(RESULT_POLL_INTERVAL)
        try:
            # F5(1101 实弹):actor 端 PS5.1 Out-File -Encoding utf8 写出的 result
            # 带 UTF-8 BOM(EF BB BF 实测),裸 utf-8 的 json.load 必抛→轮询全程
            # 空转假超时——utf-8-sig 兼容有无 BOM 两种形态。
            with open(r_path, "r", encoding="utf-8-sig") as fh:
                result = json.load(fh)
        except Exception:
            continue
        if not isinstance(result, dict) or result.get("attempt_id") != attempt_id:
            continue  # 旧 id 丢弃
        status = result.get("status")
        if status == "done":
            if int(result.get("exit_code") or 0) != 0:
                raise StepFailed(f"actor {action} exit={result.get('exit_code')}: "
                                 f"{str(result.get('stdout'))[:200]}")
            return result
        if status == "error":
            raise StepFailed(f"actor {action} error: {str(result.get('stdout'))[:200]}")
        # status=running → 继续轮询
    raise StepFailed(f"actor {action} 超时(>{budget}s)")


# ── 切换器 daemon ────────────────────────────────────────────────────────────
class _Switcher(threading.Thread):
    """单线程切换器:request(Event)非阻塞入队,run 循环永活+60s 心跳。"""

    def __init__(self):
        super().__init__(daemon=True, name="my-line-mode-switcher")
        self._event = threading.Event()
        self._target: str | None = None
        self._lock = threading.Lock()
        self._consecutive_failures = 0
        # 上次同档自愈尝试(探测/补跑/失败重试共用)的 monotonic 时戳:
        # 限频判定在 _run_sequence 前置,探测函数保持纯探测零副作用(评审#1)。
        self._last_probe_ts: float = 0.0

    # -- 对外:钩子侧调用,永不阻塞入队线程 --
    def request(self, target: str) -> None:
        with self._lock:
            self._target = target
        self._event.set()

    # -- 主循环 --
    def run(self) -> None:
        while True:
            try:
                if not self._event.wait(HEARTBEAT_INTERVAL):
                    self._heartbeat()
                    continue
                self._event.clear()
                target = self._target
                if target in ("image", "video"):
                    self._run_sequence(target)
            except Exception as error:  # noqa: BLE001 - daemon 永活,任何异常收编
                _log(f"切换器循环异常(收编继续): {error!r}")

    def _heartbeat(self) -> None:
        """60s 心跳:原子重写 MODE 保 mtime 新鲜(内容不变,mode 恒不漂)。"""
        try:
            if _disabled():
                return
            raw = _parse_mode_legacy_compatible(_read_mode())
            if raw.get("mode") == "none":
                return
            raw["heartbeat_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            _write_mode_atomic(raw)
        except Exception as error:  # noqa: BLE001
            _log(f"心跳失败(忽略): {error!r}")

    # -- 序列编排 --
    def _run_sequence(self, target: str) -> None:
        if _disabled():
            _log("急停标记文件在,切换器 no-op(观察模式仍在)")
            return
        current = _parse_mode_legacy_compatible(_read_mode())
        mode, state = current.get("mode"), current.get("state")
        # D5b:反向切换最小驻留 5 分钟防乒乓——到位态刚切过就反向→拒切分毫
        # 不动(failed 态不拦:它没成功驻留过;解析不出时长也放行,宽松面)。
        if mode not in ("none", target) and state in ("active", "degraded", "legacy"):
            age = _mode_age_seconds(current)
            if age is not None and age < MIN_MODE_DWELL:
                _log(f"D5 防乒乓拒切:{mode}→{target} 驻留仅 {age:.0f}s"
                     f"(<{MIN_MODE_DWELL}s),分毫不动")
                return
        if mode == target and state == "active":
            return  # 同档已到位:全 no-op(轻探测也不必,零打扰)
        if mode == target and state in ("degraded", "legacy", "failed"):
            # 同档未到位:5min 限频(评审#1 修正:限频判定前置,防 finally 写
            # 时间戳把补跑 fall-through 堵死)——窗内不打扰,窗外探测/补跑。
            if time.monotonic() - self._last_probe_ts < PROBE_THROTTLE:
                return  # 限频窗口内不重复扰动
            self._last_probe_ts = time.monotonic()
            if state in ("degraded", "legacy"):
                # 轻探测:世界已被外部修好(如看门狗补了 9B)→零动作覆写 active;
                # 不吻合→fall through 补跑治理序列(自愈主路:LM 卸载/装载补全)。
                if self._light_probe_matches(target):
                    _write_mode_atomic({
                        "mode": target, "state": "active",
                        "switched_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "by": "light-probe", "steps_done": ["watchdog", "lm", "free"],
                        "degraded_steps": [], "pid": os.getpid(),
                    })
                    _log(f"轻探测吻合:{target} 档覆写 active")
                    return
            if state == "failed" and self._consecutive_failures >= MAX_AUTO_RETRIES:
                _log(f"连续失败 {self._consecutive_failures} 次已停自动重试({target} 保持 failed,等新指令)")
                return
        steps_done = list(current.get("steps_done") or []) if mode == target else []
        payload = {
            "mode": target, "state": "switching",
            "switched_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "by": "line_mode_server", "steps_done": steps_done,
            "degraded_steps": [], "pid": os.getpid(),
            "attempt": int(current.get("attempt") or 0) + 1,
        }
        degraded_steps: list = []
        try:
            _write_mode_atomic(payload)  # ① MODE 原子先落盘(switching)
            done = list(payload["steps_done"])
            if "watchdog" not in done:
                self._step_watchdog()
                done.append("watchdog")
                payload["steps_done"] = done
                _write_mode_atomic(payload)
            if "lm" not in done:
                try:
                    self._step_lm(target)
                    done.append("lm")
                    payload["steps_done"] = done
                    _write_mode_atomic(payload)
                except StepDegraded as dg:
                    degraded_steps.append(dg.step)
                    payload["degraded_steps"] = degraded_steps
                    _write_mode_atomic(payload)
                    _log(f"D1 降级:{dg.step} 步推迟({dg.reason})——档位即刻到手,留告警待轻探测自愈")
            if "free" not in done:
                self._step_free()
                done.append("free")
                payload["steps_done"] = done
                _write_mode_atomic(payload)
            payload["state"] = "degraded" if degraded_steps else "active"
            payload["degraded_steps"] = degraded_steps
            _write_mode_atomic(payload)
            self._consecutive_failures = 0
            _log(f"切 {target} 档完成 state={payload['state']} "
                 f"steps_done={payload['steps_done']} degraded={degraded_steps}")
        except Exception as error:  # noqa: BLE001 - 每步异常收编为 failed
            payload["state"] = "failed"
            payload["last_error"] = repr(error)[:300]
            payload["degraded_steps"] = degraded_steps
            _write_mode_atomic(payload)
            self._consecutive_failures += 1
            self._last_probe_ts = time.monotonic()  # 失败重试同限频(5min 内不重撞)
            _log(f"切 {target} 档失败(state=failed,第 {self._consecutive_failures} 次): {error!r}")
        finally:
            # try/finally 双保险:异常路径上方已写 failed;再核一次不留 switching
            raw = _read_mode()
            if isinstance(raw, dict) and raw.get("state") == "switching":
                raw["state"] = "failed"
                raw["last_error"] = raw.get("last_error") or "sequence left switching (finally)"
                _write_mode_atomic(raw)

    def _light_probe_matches(self, target: str) -> bool:
        """同档轻探测(纯探测,零副作用——限频由 _run_sequence 前置管理,
        评审#1 修正:本函数不再写 _last_probe_ts)。

        探测不可达(None)≠吻合——降级自愈必须拿到正面证据。
        """
        try:
            models = _probe_models()
            if models is None:
                return False
            if target == "video":
                return not [mid for mid, st in models.items() if st == "loaded"]
            return NINE_B_ID in models
        except Exception:
            return False

    # -- 三步骤法 --
    def _step_watchdog(self) -> None:
        """看门狗步(D4a 拍板:看门狗**恒开**——两向都确保 ENABLE,Disabled
        才是故障;video 档"停补装 9B 一救"由看门狗 ps1 档位感知读 MODE 承担,
        本步不再 DISABLE 计划任务——评审#2 修正,与协议文本/部署脚本核账对齐)。

        actor 通路不通→StepDegraded(D4c:接受降级档位+留告警,不挡任务)。
        """
        if _disabled():
            raise StepFailed("急停标记出现,中止序列")
        try:
            _actor_exec("watchdog", {"enable": True}, budget=ACTOR_PS_TIMEOUT)
        except StepFailed as error:
            raise StepDegraded("watchdog", f"actor 通路不通(D4c):{error}") from error
        try:
            self._verify_grace(
                lambda: self._watchdog_state() == "Ready",
                interval=5.0, deadline=GRACE_WATCHDOG,
                what="看门狗 ENABLE",
            )
        except StepFailed as error:
            raise StepDegraded("watchdog", str(error)) from error

    def _watchdog_state(self) -> str | None:
        """看门狗任务态(评审#5 修正:Get-ScheduledTask .State 是 .NET 枚举,
        ToString 恒英文 Ready/Disabled/Running——schtasks /Query CSV 的 State
        列随系统区域本地化(中文机=就绪/已禁用),不可与英文常量比较)。"""
        try:
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"(Get-ScheduledTask -TaskName '{WATCHDOG_TASK}' "
                 f"-ErrorAction SilentlyContinue).State"],
                capture_output=True, text=True, timeout=ACTOR_PS_TIMEOUT,
            )
            return (proc.stdout or "").strip() or None
        except Exception:
            return None

    def _step_lm(self, target: str) -> None:
        """LM 步:任务边界守卫(D5)→LM busy 探测(D1 立即降级)→分档处置→宽限验证。

        D5 拍板:lms unload/load 动作对齐任务边界——仅引擎队列**完全空**时
        执行(方向性"无对向"被完全空包含;触发提交自身渲染跑完才动 LM)。
        actor 通路故障→StepDegraded(D4c:接受降级档位+留告警);引擎环回
        /queue 探查失败→StepFailed(引擎自身异常,序列 failed)。
        """
        if _disabled():
            raise StepFailed("急停标记出现,中止序列")
        self._wait_queue_empty("lm")
        # D1:LM busy(任一模型 status≠idle)→立即降级,零等待零轮询
        try:
            models = self._actor_lm_ps()
        except StepFailed as error:
            raise StepDegraded("lm", f"actor 通路不通(D4c):{error}") from error
        busy = [mid for mid, st in models.items() if st and st != "idle"]
        if busy:
            raise StepDegraded("lm", f"LM 忙({','.join(busy[:3])} status≠idle)")
        try:
            if target == "video":
                for mid in models:
                    _actor_exec("unload", {"identifier": mid}, budget=LM_UNLOAD_TIMEOUT)
            else:
                # D4b:image 档 9B 由切换器直接 lms load,不等 5 分钟 tick;
                # 幂等:lms ps 只列已装载模型——9B 在列表即已在位,跳过。
                if NINE_B_ID not in models:
                    _actor_exec("load9b", {}, budget=LM_LOAD_9B_TIMEOUT)
                for mid, st in models.items():
                    if mid != NINE_B_ID and st == "idle":
                        _actor_exec("unload", {"identifier": mid}, budget=LM_UNLOAD_TIMEOUT)
        except StepFailed as error:
            raise StepDegraded("lm", f"actor 通路不通(D4c):{error}") from error
        # 宽限轮询事后验证(active 只在过验后写)
        if target == "video":
            self._verify_grace(
                lambda: not [m for m, s in (_probe_models() or {}).items() if s == "loaded"],
                interval=10.0, deadline=GRACE_LM_UNLOAD, what="LM 卸空",
            )
        else:
            self._verify_grace(
                lambda: NINE_B_ID in (_probe_models() or {}),
                interval=10.0, deadline=GRACE_LM_LOAD, what="9B 装载",
            )

    def _actor_lm_ps(self) -> dict:
        """经 actor 只读 lms ps --json → {identifier: status}。

        actor 通路故障原样上抛(StepFailed,由 _step_lm 转 D4c 降级);
        stdout 损坏→空表(video 方向=无物可卸,image 方向触发 load9b,幂等
        面安全)。
        """
        result = _actor_exec("lms_ps", {}, budget=ACTOR_PS_TIMEOUT)
        try:
            rows = json.loads(str(result.get("stdout") or "[]"))
            return {r.get("identifier"): r.get("status") for r in rows if isinstance(r, dict)}
        except Exception:
            return {}

    def _wait_queue_empty(self, step: str) -> None:
        """D5 任务边界守卫:lms unload/load 与 /free 等机器动作仅引擎队列
        **完全空**时执行(替代原方向性守卫——完全空蕴含"无对向";触发切换
        的那发同向任务也须跑完才动机器,防在途渲染任何形态被打断)。等待期
        间每 5s 复查(新到条目→继续等);15min 不空→StepDegraded(治理推迟,
        D1 语义,留告警等自愈补跑);/queue 探查失败→StepFailed(引擎异常)。"""
        deadline = time.monotonic() + QUEUE_GUARD_TIMEOUT
        while True:
            try:
                pending = _engine_queue_ids()
            except Exception as error:
                raise StepFailed(f"引擎 /queue 探查失败: {error!r}") from error
            if not pending:
                return
            if time.monotonic() >= deadline:
                raise StepDegraded(
                    step, f"队列未空守卫超时({QUEUE_GUARD_TIMEOUT}s),"
                          f"{len(pending)} 条在途,机器动作推迟")
            time.sleep(5.0)

    def _step_free(self) -> None:
        """引擎 /free(评审#9+D5:全局清缓存语义——unload_models+free_memory
        是引擎全局卸载,发前等队列完全空(任务边界),永不落在途渲染中辙;
        15min 不空→StepDegraded(free 推迟,D1 语义)。只验 200。"""
        if _disabled():
            raise StepFailed("急停标记出现,中止序列")
        self._wait_queue_empty("free")
        import urllib.request
        req = urllib.request.Request(
            f"{_engine_base()}/free",
            data=json.dumps({"unload_models": True, "free_memory": True}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=60.0) as resp:
            if resp.status != 200:
                raise StepFailed(f"/free 非 200:{resp.status}")

    def _verify_grace(self, check_fn, interval: float, deadline: float, what: str) -> None:
        """宽限轮询事后验证:active 只在过验后写;宽限耗尽→该步 failed。"""
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            try:
                if check_fn():
                    return
            except Exception:
                pass
            time.sleep(interval)
        raise StepFailed(f"{what} 宽限验证超时({deadline}s)")


# ── GET 路由(限源环回;诊断默认关) ─────────────────────────────────────────
def _handle_line_mode_get(request):
    """GET /my-nodes/line-mode:状态真源只读回显(限引擎本机/ssh 隧道环回)。"""
    from aiohttp import web

    if getattr(request, "remote", None) not in ("127.0.0.1", "::1"):
        return web.json_response({"error": "forbidden"}, status=403)
    raw = _parse_mode_legacy_compatible(_read_mode())
    raw["server_time"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    raw["disabled"] = _disabled()
    return web.json_response(raw)


_DIAG_COMMANDS = (
    ["lms", "ps", "--json"],
    ["schtasks", "/Query", "/TN", ACTOR_TASK, "/FO", "CSV", "/NH"],
)


def _handle_diagnosis_get(request):
    """GET /my-nodes/line-mode/diagnosis:默认关(404);开时固定 argv 只读+
    SHA256 内存基线对拍(首跑铸基线;输出漂移=拒绝,防被塞私货)。"""
    from aiohttp import web

    if not LINE_MODE_DIAGNOSIS_ENABLED:
        return web.json_response({"error": "not found"}, status=404)
    if getattr(request, "remote", None) not in ("127.0.0.1", "::1"):
        return web.json_response({"error": "forbidden"}, status=403)
    import hashlib
    global _DIAG_BASELINE
    outputs = []
    digest_text = ""
    try:
        for argv in _DIAG_COMMANDS:
            proc = subprocess.run(
                argv, capture_output=True, text=True,
                timeout=ACTOR_PS_TIMEOUT, env={**os.environ, **LMS_ENV},
            )
            outputs.append({"argv": argv, "rc": proc.returncode,
                            "stdout": (proc.stdout or "")[:4000]})
            digest_text += (proc.stdout or "")
        digest = hashlib.sha256(digest_text.encode("utf-8", "replace")).hexdigest()
    except Exception as error:  # noqa: BLE001
        return web.json_response({"error": f"diagnosis failed: {error!r}"}, status=500)
    if _DIAG_BASELINE is None:
        _DIAG_BASELINE = {"sha256": digest}
        return web.json_response({"baseline_established": True, "sha256": digest, "outputs": outputs})
    if _DIAG_BASELINE.get("sha256") != digest:
        return web.json_response(
            {"error": "sha256 mismatch", "expected": _DIAG_BASELINE.get("sha256"),
             "actual": digest}, status=409)
    return web.json_response({"sha256": digest, "outputs": outputs})


def _register_routes() -> None:
    from server import PromptServer

    PromptServer.instance.routes.get("/my-nodes/line-mode")(_handle_line_mode_get)
    PromptServer.instance.routes.get("/my-nodes/line-mode/diagnosis")(_handle_diagnosis_get)


# ── install(PromptQueue.put 第二包装;prompt_log_server 同点位同纪律) ────────
_switcher: _Switcher | None = None


def _put_wrapper_factory(orig_put):
    def _put(self, *args, **kwargs):
        try:
            if args:
                kind = _classify_item(args[0])
                pid = args[0][1] if isinstance(args[0], (tuple, list)) and len(args[0]) >= 2 else "?"
                _log(f"[入队] prompt_id={pid} 分类={kind}")
                if kind in ("image", "video") and _switcher is not None:
                    _switcher.request(kind)  # 非阻塞:Event.set 即返
        except Exception:
            pass  # 分类/状态损坏绝不挡入队
        return orig_put(self, *args, **kwargs)

    return _put


def _get_wrapper_factory(orig_get):
    """D6:worker(PromptQueue 消费线程)取任务时,目标档切换中→等待完成
    上限 120s(每个切换窗口只等**首任务**一次,后续直接放行;窗口结束复位
    一次性闸);超时放行+告警。put 永不阻塞的纪律不变(本包装跑在 worker
    线程,入队路径零改动)。任何失败绝不挡取任务。"""
    gate = {"waited": False}

    def _get(self, *args, **kwargs):
        try:
            raw = _read_mode()
            switching = isinstance(raw, dict) and raw.get("state") == "switching"
            if switching and not gate["waited"]:
                gate["waited"] = True
                deadline = time.monotonic() + WORKER_SWITCH_WAIT
                while time.monotonic() < deadline:
                    time.sleep(2.0)
                    raw = _read_mode()
                    if not (isinstance(raw, dict) and raw.get("state") == "switching"):
                        break
                else:
                    _log(f"[D6] 首任务等待切换完成超时({WORKER_SWITCH_WAIT}s),放行+告警")
            elif not switching:
                gate["waited"] = False  # 切换窗口结束,一次性闸复位
        except Exception:
            pass  # 任何失败绝不挡取任务
        return orig_get(self, *args, **kwargs)

    return _get


def install() -> None:
    """挂观察钩子+启动切换器+注册 GET 路由(幂等;失败静默不挡装载)。

    平台守卫:非 win32 打印 no-op 不起线程不触文件(G7:Mac 引擎观察模式
    也免)。急停标记文件存在→照装观察模式,切换器序列级 no-op。
    """
    global _installed, _switcher
    if _installed:
        return
    try:
        if sys.platform != "win32":
            print(f"{TAG} 非 Windows 不装载(sys.platform={sys.platform})", flush=True)
            return
        if _disabled():
            print(f"{TAG} 急停标记文件在({DISABLED_FLAG}):观察模式照装,切换器 no-op", flush=True)
        _recover_stale_switching()
        try:
            import execution as _ex
        except ImportError:
            try:
                from comfy import execution as _ex
            except ImportError:
                from comfy_execution import execution as _ex
        _ex.PromptQueue.put = _put_wrapper_factory(_ex.PromptQueue.put)
        _ex.PromptQueue.get = _get_wrapper_factory(_ex.PromptQueue.get)  # D6(worker 侧)
        _switcher = _Switcher()
        _switcher.start()
        try:
            _register_routes()
        except Exception as route_error:  # noqa: BLE001
            print(f"{TAG} GET 路由挂载失败(切换器不受影响): {route_error}", flush=True)
        _installed = True
        print(f"{TAG} 档位自动切换已挂载(PromptQueue.put/get;MODE={MODE_PATH})", flush=True)
    except Exception as error:  # noqa: BLE001 - 同款纪律:失败静默不挡装载
        print(f"{TAG} 档位切换挂载失败(不影响出图): {error}", flush=True)
