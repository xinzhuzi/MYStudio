"""ComfyUI 引擎性能退化防线——锚定式基线(世代冻结)+步时漂移检测(blank-gate-1024 §8)。

信号真源=/history status.messages 的 execution_start/execution_success 毫秒
时间戳差(引擎 execution.py add_message 打点;桥轮询的同一响应,零新增传输面);
缺时间戳回落客户端墙钟(置信降级标注)。基线=锚定式:桶键(bridge=模板+checkpoint、
qwen21=模板+型档)×世代(引擎 startedAt 为界)内前 N 发成功步时中位数冻结;
步时>锚×ratio 连续 strikes 发确认退化;回带连续 recover_n 发复位(锚不动);
锚过时自愈(确认退化且 /free 后仍连续 exceed_persist 发超标→最近 5 发中位
重锚+复位,每世代至多一次)。处置阶梯:L0 恒记日志→L1 确认警告→L2 POST /free
(§4.3 规格:5s 超时/失败吞错/限频)→L3 经 engine_manager 重启(默认关)。
与空片门禁单向联动(§8.2):空片不记 strike;步时独立确认退化时,pipeline
重掷仍废的报错优先 engine-degraded。
接线:comfyui_bridge.generate / qwen21.generate(提交前 pre_submit,成功/失败
后 record_shot);画布 /comfy/execute 与前端 SeedVR2 直连不进任何桶(§9 边界)。
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from urllib import parse, request

# 随机子采样种子不做 env 的同款纪律:阈值/开关全部走 MYSTUDIO_COMFYUI_* 惯例
# (robust 解析照 MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S 先例,非法值回落默认)。


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    return default


def _env_float(name: str, default: float, minimum: float | None = None) -> float:
    try:
        value = float(os.environ.get(name, ""))
    except (TypeError, ValueError, OverflowError):
        return default
    if not math.isfinite(value) or (minimum is not None and value < minimum):
        return default
    return value


def degrade_guard_enabled() -> bool:
    return _env_flag("MYSTUDIO_COMFYUI_DEGRADE_GUARD", True)


def duration_from_history(entry: dict | None) -> float | None:
    """从 /history 条目 status.messages 抽 execution_success−execution_start 秒差。

    消息形如 [事件名, {..., "timestamp": 毫秒}];任一事件缺失/时间戳非法/负差
    → None(调用方回落客户端墙钟,置信降级)。
    """
    if not isinstance(entry, dict):
        return None
    messages = entry.get("status", {}).get("messages") if isinstance(entry.get("status"), dict) else None
    if not isinstance(messages, list):
        return None
    stamps: dict[str, float] = {}
    for message in messages:
        if not isinstance(message, (list, tuple)) or len(message) < 2:
            continue
        event, data = message[0], message[1]
        if event in ("execution_start", "execution_success") and isinstance(data, dict):
            timestamp = data.get("timestamp")
            if isinstance(timestamp, (int, float)):
                stamps[event] = float(timestamp)
    if "execution_start" not in stamps or "execution_success" not in stamps:
        return None
    seconds = (stamps["execution_success"] - stamps["execution_start"]) / 1000.0
    return seconds if math.isfinite(seconds) and seconds >= 0 else None


def free_memory(base_url: str, timeout_s: float = 5.0) -> bool:
    """POST /free(unload_models+free_memory)。短超时,失败吞错+日志,恒不抛、恒不重试。"""
    body = json.dumps({"unload_models": True, "free_memory": True}).encode("utf-8")
    req = request.Request(f"{base_url}/free", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=timeout_s) as response:
            response.read()
        return True
    except Exception as exc:  # noqa: BLE001 — /free 是处置动作,失败不得阻塞主链
        print(f"[image-sidecar] engine-health: POST /free 失败({exc}),跳过内存回收", flush=True)
        return False


def _queue_empty(base_url: str, timeout_s: float = 2.0) -> bool:
    """GET /queue,running+pending 均空=True(多提交方护栏:别家在跑就不许重启)。"""
    try:
        with request.urlopen(f"{base_url}/queue", timeout=timeout_s) as response:
            info = json.loads(response.read().decode("utf-8"))
        return not info.get("queue_running") and not info.get("queue_pending")
    except Exception:  # noqa: BLE001 — 探不到=证不了空闲,按不空处置
        return False


def _resolve_started_at() -> float | None:
    """引擎世代锚:engine_manager 的 startedAt(spawn/收编落值,重启清零)。"""
    try:
        from comfyui import engine_manager as _em

        return _em.engine_manager().engine_started_at
    except Exception:  # noqa: BLE001 — 外部回落引擎/测试环境无管理器=世代未知
        return None


class _BucketState:
    """单桶(模板+参数)锚定基线态;世代重置由 DegradeTracker 驱动。"""

    __slots__ = ("anchor", "pending", "recent", "strikes", "recover_streak", "degraded",
                 "persist_streak", "free_executed", "reanchored")

    def __init__(self) -> None:
        self.anchor: float | None = None
        self.pending: list[float] = []
        self.recent: list[float] = []  # 滚动 5 发(自愈重锚素材)
        self.strikes = 0
        self.recover_streak = 0
        self.degraded = False
        self.persist_streak = 0
        self.free_executed = False
        self.reanchored = False

    def reset_for_generation(self) -> None:
        self.__init__()  # noqa: SLF001 — 同对象重置(世代重锚+复位)


class DegradeTracker:
    """锚定式退化追踪器(纯状态机;HTTP 处置在 pre_submit/maybe_restart_engine)。

    参数 None → env 默认;显式传参供仿真(tests/fixtures/degrade_sim_1024.py)
    与单测钉行为,env 表见方案 §2。
    """

    def __init__(self, *, ratio: float | None = None, anchor_n: int | None = None,
                 strikes_needed: int | None = None, recover_n: int | None = None,
                 exceed_persist: int | None = None, free_min_interval_s: float | None = None) -> None:
        self.ratio = _env_float("MYSTUDIO_COMFYUI_DEGRADE_RATIO", 3.0, minimum=0.0) if ratio is None else ratio
        self.anchor_n = int(_env_float("MYSTUDIO_COMFYUI_DEGRADE_ANCHOR_N", 5.0, minimum=1.0) if anchor_n is None else anchor_n)
        self.strikes_needed = int(_env_float("MYSTUDIO_COMFYUI_DEGRADE_STRIKES", 2.0, minimum=1.0) if strikes_needed is None else strikes_needed)
        self.recover_n = int(_env_float("MYSTUDIO_COMFYUI_DEGRADE_RECOVER_N", 3.0, minimum=1.0) if recover_n is None else recover_n)
        self.exceed_persist = int(_env_float("MYSTUDIO_COMFYUI_DEGRADE_EXCEED_PERSIST", 10.0, minimum=1.0) if exceed_persist is None else exceed_persist)
        self.free_min_interval_s = (_env_float("MYSTUDIO_COMFYUI_DEGRADE_FREE_MIN_INTERVAL_S", 1800.0, minimum=0.0)
                                    if free_min_interval_s is None else free_min_interval_s)
        self._buckets: dict[tuple, _BucketState] = {}
        self._generation: tuple | None = (None,)  # 哨兵:startedAt 未观测过
        self._lock = threading.Lock()
        self._last_free = 0.0

    # -- 世代 ------------------------------------------------------------
    def observe_generation(self, started_at: float | None) -> None:
        """startedAt 变更(引擎重启)→ 新世代:全部桶重锚+复位+限频钟重置(§8.4)。"""
        generation = (started_at,) if started_at is not None else (None,)
        with self._lock:
            if generation == self._generation:
                return
            self._generation = generation
            self._buckets.clear()
            self._last_free = 0.0
        print(f"[image-sidecar] engine-health: 引擎世代变更(startedAt={started_at}),退化基线重锚", flush=True)

    def _bucket(self, bucket: str, generation_key: tuple) -> _BucketState:
        state = self._buckets.get((generation_key, bucket))
        if state is None:
            state = _BucketState()
            self._buckets[(generation_key, bucket)] = state
        return state

    # -- 记录(桥两驱动喂入;空片不进此函数,单向联动 §8.2) ----------------
    def record_shot(self, *, bucket: str, steps: int, history_entry: dict | None,
                    wall_s: float, ok: bool = True, engine_started_at: float | None = None) -> None:
        if not degrade_guard_enabled():
            return  # 总逃生门:tracker 全直通(§8.4)
        started_at = _resolve_started_at() if engine_started_at is None else engine_started_at
        self.observe_generation(started_at)
        duration = duration_from_history(history_entry)
        source = "ts" if duration is not None else "wall"
        if duration is None:
            duration = wall_s
            if wall_s < 0.05:
                # 墙钟回落样本 <50ms=传输层/mock 噪声(真实生成≥秒级):只记不喂基线,
                # 防止既有契约测试的 mock 步时污染锚(引擎时间戳路径不受此闸)
                print(f"[image-sidecar] engine-health: {bucket} 墙钟样本过短({wall_s * 1000:.1f}ms),不喂基线", flush=True)
                return
        step_time = duration / max(1, steps)
        with self._lock:
            state = self._bucket(bucket, self._generation)
            if not ok:
                # 失败路径只记不判(§6-③):执行失败/超时的耗时不含健康信号
                print(f"[image-sidecar] engine-health: {bucket} 失败发({source} {duration:.1f}s/{steps}步,不判)", flush=True)
                return
            state.recent = (state.recent + [step_time])[-5:]
            if state.anchor is None:
                state.pending.append(step_time)
                if len(state.pending) >= self.anchor_n:
                    state.anchor = float(sorted(state.pending)[len(state.pending) // 2])
                    print(f"[image-sidecar] engine-health: {bucket} 基线锚冻结({state.anchor:.2f}s/步)", flush=True)
                else:
                    print(f"[image-sidecar] engine-health: {bucket} 建锚样本 {len(state.pending)}/{self.anchor_n}"
                          f"({step_time:.2f}s/步,{source})", flush=True)
                return
            threshold = state.anchor * self.ratio
            if step_time > threshold:
                state.strikes += 1
                state.recover_streak = 0
                if state.strikes >= self.strikes_needed and not state.degraded:
                    state.degraded = True
                    print(f"[image-sidecar] engine-health: 确认引擎性能退化(桶 {bucket}:当次 {step_time:.2f}s/步"
                          f">锚 {state.anchor:.2f}×{self.ratio:g},连续 {state.strikes} 发)——长时间运行内存碎片堆积,"
                          "建议重启引擎(设置→本地配置→ComfyUI 图像引擎)", flush=True)
                if state.degraded and state.free_executed:
                    state.persist_streak += 1
                    if state.persist_streak >= self.exceed_persist and not state.reanchored:
                        # 锚过时自愈(§8.1b):/free 都救不回的持续超标更像新常态;每世代至多一次
                        state.anchor = float(sorted(state.recent)[len(state.recent) // 2])
                        state.degraded = False
                        state.strikes = 0
                        state.persist_streak = 0
                        state.free_executed = False
                        state.reanchored = True
                        print(f"[image-sidecar] engine-health: 锚过时自愈(桶 {bucket}:/free 后仍持续超标"
                              f"{self.exceed_persist} 发,以最近 {len(state.recent)} 发中位 {state.anchor:.2f}s/步 重锚)", flush=True)
            else:
                state.strikes = 0
                state.recover_streak += 1
                if state.recover_streak >= self.recover_n and state.degraded:
                    state.degraded = False
                    state.persist_streak = 0
                    state.free_executed = False
                    print(f"[image-sidecar] engine-health: 步时回带复位(桶 {bucket},锚 {state.anchor:.2f} 不动)", flush=True)
            print(f"[image-sidecar] engine-health: {bucket} {step_time:.2f}s/步({source},锚 {state.anchor:.2f}"
                  f"/阈值 {threshold:.2f},strikes {state.strikes},degraded {state.degraded})", flush=True)

    # -- 查询 ------------------------------------------------------------
    def degraded_buckets(self) -> list[str]:
        with self._lock:
            return [bucket for (_generation, bucket), state in self._buckets.items() if state.degraded]

    def is_degraded(self, bucket: str) -> bool:
        with self._lock:
            state = self._buckets.get((self._generation, bucket))
            return bool(state and state.degraded)

    def anchor_of(self, bucket: str) -> float | None:
        with self._lock:
            state = self._buckets.get((self._generation, bucket))
            return state.anchor if state else None

    # -- 处置(提交前 L2/L3;L0/L1 在 record_shot 内恒有) ------------------
    def pre_submit(self, base_url: str, *, started_at: float | None = None) -> None:
        """确认退化后的下一发提交前:POST /free(限频+uptime 门槛)→可选 L3 重启。"""
        if not degrade_guard_enabled():
            return
        if started_at is None:
            started_at = _resolve_started_at()
        self.observe_generation(started_at)
        if not self.degraded_buckets():
            return
        if not _env_flag("MYSTUDIO_COMFYUI_DEGRADE_FREE", True):
            return
        uptime_s = None if started_at is None else time.time() - started_at
        min_uptime_h = _env_float("MYSTUDIO_COMFYUI_DEGRADE_MIN_UPTIME_H", 6.0, minimum=0.0)
        if uptime_s is not None and uptime_s < min_uptime_h * 3600:
            print(f"[image-sidecar] engine-health: 退化确认但运行仅 {uptime_s / 3600:.1f}h(<{min_uptime_h:g}h 门槛),"
                  "只记日志不处置", flush=True)
            return
        if uptime_s is None:
            print("[image-sidecar] engine-health: 引擎 startedAt 未知,按满足 uptime 门槛处置", flush=True)
        with self._lock:
            elapsed = time.monotonic() - self._last_free
            if elapsed < self.free_min_interval_s and self._last_free > 0:
                return  # 限频窗内已 /free 过,不再发(§4.2)
        free_memory(base_url)
        with self._lock:
            self._last_free = time.monotonic()
            for key, state in self._buckets.items():
                if state.degraded:
                    state.free_executed = True
                    state.persist_streak = 0
        if _env_flag("MYSTUDIO_COMFYUI_DEGRADE_RESTART", False):
            maybe_restart_engine(base_url)


def maybe_restart_engine(base_url: str) -> bool:
    """L3 自动重启(默认关):/queue 双连探空+自有进程活+端口吻合+execute 空闲才动。"""
    if not _env_flag("MYSTUDIO_COMFYUI_DEGRADE_RESTART", False):
        return False
    if not _tracker.degraded_buckets():
        return False
    if not _queue_empty(base_url):
        return False  # 双连探任一不空(或探不到)=有别家在跑,不动作
    time.sleep(2.0)  # 间隔 2s 双连探(§8.3-①):两次都证空闲才继续
    if not _queue_empty(base_url):
        return False
    from comfyui import engine_manager as _em

    manager = _em.engine_manager()
    proc = getattr(manager, "_proc", None)
    running_port = getattr(manager, "_running_port", None)
    expected_port = parse.urlparse(base_url).port
    if proc is None or proc.poll() is not None or running_port != expected_port:
        return False  # 非自有引擎/端口不吻合(防误杀 17598 外部回落)
    if _em.jobs.active_of("comfy-execute") is not None:
        return False  # 画布 /comfy/execute 同进程 job 在跑(§8.3-③b)
    print("[image-sidecar] engine-health: 队列空闲+自有引擎,执行退化自动重启(§8.3 L3)", flush=True)
    try:
        manager.restart()
    except Exception as exc:  # noqa: BLE001 — 重启失败不阻塞生图主链,文案兜底
        print(f"[image-sidecar] engine-health: 自动重启失败({exc}),留给用户手动重启", flush=True)
        return False
    return True


_tracker = DegradeTracker()


def pre_submit(base_url: str) -> None:
    """桥两驱动提交前接线口(module 单例)。"""
    _tracker.pre_submit(base_url)


def record_shot(**kwargs) -> None:
    """桥两驱动成功/失败后接线口(module 单例)。"""
    _tracker.record_shot(**kwargs)


def degradation_confirmed() -> bool:
    """pipeline 报错分级用:步时信号是否已独立确认退化(§8.2 单向联动)。"""
    return bool(_tracker.degraded_buckets())
