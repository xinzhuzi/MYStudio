"""退化仿真(blank-gate-1024 §8.1 计数口径钉死:1-based)。

用生产 DegradeTracker(锚定式基线)跑三条退化序列,另以滚动窗检测器作
历史缺陷对照(渐进爬升永不触发)。锚数字=本脚本输出(复跑即得),测试 C-3
断言唯一来源。序列口径:每序列前 10 发健康 3.0s/步(锚窗=前 5 发,锚=3.0,
阈值=3.0×3.0=9.0),退化段线性爬升 3→22:
- 爬升 100 发:第 11..100 发线性 3→22 → 首超标第 39 发、连续 2 发第 40 发确认;
- 陡坡 30 发:第 11..30 发线性 3→22 → 首超标第 17 发、第 18 发确认;
- 阶跃:第 11 发起恒 22 → 第 11/12 发超标、第 12 发确认。

用法:cd apps && PYTHONPATH=backend python3 backend/tests/fixtures/degrade_sim_1024.py
"""
from __future__ import annotations

from collections import deque

from engines.image_engine.engine_health import DegradeTracker

GENERATION = 1000.0  # 恒定世代(仿真不换引擎)
BUCKET = "sim|default"
HEALTHY = 3.0
DEGRADED = 22.0
LEAD_IN = 10  # 前置健康发数(含 5 发建锚窗)


def sequence_ramp_100() -> list[float]:
    """前 10 发健康,第 11..100 发线性 3→22(用户实锤 3s→22s 渐进形态)。"""
    return [HEALTHY] * LEAD_IN + [3.0 + 19.0 * (i - 10) / 90.0 for i in range(11, 101)]


def sequence_steep_30() -> list[float]:
    """前 10 发健康,第 11..30 发线性 3→22(陡坡)。"""
    return [HEALTHY] * LEAD_IN + [3.0 + 19.0 * (i - 10) / 20.0 for i in range(11, 31)]


def sequence_step() -> list[float]:
    """前 10 发健康,第 11 发起恒 22(阶跃)。"""
    return [HEALTHY] * LEAD_IN + [DEGRADED] * 20


def anchored_confirm_shot(sequence: list[float]) -> int | None:
    """锚定式(生产逻辑):返回确认退化的 1-based 发数;永不确认=None。"""
    tracker = DegradeTracker(ratio=3.0, anchor_n=5, strikes_needed=2, recover_n=3, exceed_persist=10)
    for index, step_time in enumerate(sequence, start=1):
        tracker.record_shot(bucket=BUCKET, steps=1, history_entry=None, wall_s=step_time,
                            engine_started_at=GENERATION)
        if tracker.is_degraded(BUCKET):
            return index
    return None


def rolling_confirm_shot(sequence: list[float], window: int = 10, ratio: float = 3.0,
                         strikes_needed: int = 2) -> int | None:
    """滚动窗对照(第 1 轮缺陷检测器):当发>前 window 发中位×ratio 连续 strikes 发确认。"""
    history: deque[float] = deque(maxlen=window)
    strikes = 0
    ordered: list[float] = []
    for index, step_time in enumerate(sequence, start=1):
        median = ordered[len(ordered) // 2] if ordered else None
        if median is not None and step_time > median * ratio:
            strikes += 1
            if strikes >= strikes_needed:
                return index
        else:
            strikes = 0
        history.append(step_time)
        ordered = sorted(history)
    return None


def run_anchors() -> dict[str, int | None]:
    return {
        "anchored_ramp_100": anchored_confirm_shot(sequence_ramp_100()),
        "anchored_steep_30": anchored_confirm_shot(sequence_steep_30()),
        "anchored_step": anchored_confirm_shot(sequence_step()),
        "rolling_ramp_100": rolling_confirm_shot(sequence_ramp_100()),
        "rolling_steep_30": rolling_confirm_shot(sequence_steep_30()),
        "rolling_step": rolling_confirm_shot(sequence_step()),
    }


if __name__ == "__main__":
    for name, value in run_anchors().items():
        print(f"{name}: {value}")
