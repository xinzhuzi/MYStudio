"""生图产物空片门禁——纯内容判定,零 HTTP/零重试/零进程状态。v3。

移植自战役 yanliao_kv_viewsheet_1023.py gates_and_save 的内容统计思路,
按 App 产物形态五处改造(①②⑤沿第 1 轮,③④为第 2 轮重设计):
① 不设文件大小下限(分辨率跨 512px-2K,固定 400KB 误杀小图);
② 不设画幅门禁(战役 1.78±0.05 是海报产品专属);
③ 透明/不透明双域分流:alpha_zero_ratio>0.30 → 透明产物域,只判
   「全透空片」(azr>0.995);白底合成双信号只在 ≤0.30 的不透明域生效;
④ 降采样=种子钉死的随机子采样(default_rng(20241024), 内域无放回
   抽 ≤512² 像素);背景锚=边界环(四边全量)双锚{中位数, p95},fg 取两锚
   最大值——纯步长子采样对周期=步长结构相位混叠全灭,单中位锚在双色对半
   图上把全图 diff 减半恰不过线(锚数字见 tests/fixtures/output_gate_
   reference_1024.py,复跑即得);
⑤ fail-open catch 面=硬规格 (OSError, ValueError)——既有测试 mock 全为
   非 PNG 小字节,门禁不得因解码失败拦截它们。

接线位:image_gen/pipeline.generate_image(全 6 驱动唯一出口);重掷/文案
分支在那边,本模块只做单帧判定。
"""
from __future__ import annotations

import io
import math
import os
from dataclasses import dataclass

# 种子钉死:可变种子会让锚数字与断言漂移(方案 §2)。
SUBSAMPLE_SEED = 20241024
SUBSAMPLE_CAP = 512 * 512
MIN_SIDE = 256
_DIFF = 20.0


@dataclass(frozen=True)
class GateMetrics:
    bytes_len: int
    width: int
    height: int
    domain: str             # "transparent" | "opaque" | "small"(小图豁免)
    alpha_zero_ratio: float # 透明占比(域分流判据;透明域的判废指标)
    fg_ratio: float         # 不透明域:与双锚差异>20 的最大占比;透明域=1-azr(实内容占比)
    luma_span: float        # 不透明域:合成亮度 p99-p1(信号二);透明域恒 0
    fg_ratio_med: float     # 诊断面:中位锚单独的 fg(锚确定性/回归钉用)
    fg_ratio_p95: float     # 诊断面:p95 锚单独的 fg


class GateRejected(Exception):
    """判废(空片证据成立);reason ∈ {"low-foreground","low-luma-span","transparent-blank"}。"""

    def __init__(self, reason: str, metrics: GateMetrics):
        super().__init__(reason)
        self.reason = reason
        self.metrics = metrics


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    return default  # 非法值回落默认(照 MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S robust 先例)


def _env_float(name: str, default: float, minimum: float | None = None) -> float:
    try:
        value = float(os.environ.get(name, ""))
    except (TypeError, ValueError, OverflowError):
        return default
    if not math.isfinite(value) or (minimum is not None and value < minimum):
        return default
    return value


def gate_enabled() -> bool:
    """总开关×内容门禁双闸(IMAGE_GUARD=0 一键关本役全部新行为的总逃生门)。"""
    return _env_flag("MYSTUDIO_COMFYUI_IMAGE_GUARD", True) and _env_flag("MYSTUDIO_COMFYUI_BLANK_GATE", True)


def evaluate_output(content: bytes, *, min_fg: float | None = None,
                    max_luma_span: float | None = None,
                    span2: bool | None = None) -> GateMetrics | None:
    """判定单帧产物:放行/fail-open → GateMetrics(None=fail-open);空片证据成立 → raise GateRejected。

    判定顺序(fail-closed 于「证据」,fail-open 于「能力」):
    1. 总开关关 → return None;
    2. PIL 解码失败 → return None+警告(fail-open;观测形态 50-60KB 是有效 PNG,
       解码失败不是空片证据);
    3. 任一边 <256px → return metrics(小图豁免);
    4. 域分流:azr>trans_alpha → 透明域,只判全透空片(azr>trans_blank);
       否则不透明域:边界环双锚{中位,p95} × 内域随机子采样 → fg=max(两锚),
       span=亮度 p99-p1;信号一 fg<min_fg 判废;信号二(仅 span2 开)
       span<max_luma_span 且 fg<0.5 判废。
    """
    if not gate_enabled():
        return None
    if min_fg is None:
        min_fg = _env_float("MYSTUDIO_COMFYUI_BLANK_MIN_FG", 0.01, minimum=0.0)
    if max_luma_span is None:
        max_luma_span = _env_float("MYSTUDIO_COMFYUI_BLANK_MAX_LUMA_SPAN", 40.0, minimum=0.0)
    if span2 is None:
        span2 = _env_flag("MYSTUDIO_COMFYUI_BLANK_SPAN2", False)
    trans_alpha = _env_float("MYSTUDIO_COMFYUI_BLANK_TRANS_ALPHA", 0.30, minimum=0.0)
    trans_blank = _env_float("MYSTUDIO_COMFYUI_BLANK_TRANS_BLANK", 0.995, minimum=0.0)
    try:
        from PIL import Image

        image = Image.open(io.BytesIO(content))
        image.load()
    except (OSError, ValueError):
        # 实测:b"fake"/b""→UnidentifiedImageError(OSError 子类);截断 PNG 头→OSError;
        # 部分损坏流另可 ValueError 族。禁止在本分支做二次猜测。
        print(f"[image-sidecar] output-gate: 解码失败({len(content)}B),fail-open 放行", flush=True)
        return None
    import numpy as np

    arr = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    height, width = arr.shape[0], arr.shape[1]
    azr = float((arr[..., 3] == 0).mean())
    if width < MIN_SIDE or height < MIN_SIDE:
        return GateMetrics(len(content), width, height, "small", azr, 0.0, 0.0, 0.0, 0.0)
    if azr > trans_alpha:
        metrics = GateMetrics(len(content), width, height, "transparent", azr, 1.0 - azr, 0.0, 0.0, 0.0)
        if azr > trans_blank:
            raise GateRejected("transparent-blank", metrics)
        return metrics
    # 不透明域:边界环(四边全量,不抽样)双锚 + 内域随机子采样(白底合成后量非背景)
    ring = np.concatenate([arr[0, :, :3], arr[-1, :, :3], arr[1:-1, 0, :3], arr[1:-1, -1, :3]]).astype("float32")
    anchors = (np.median(ring, axis=0), np.percentile(ring, 95, axis=0))
    inner = arr[1:-1, 1:-1, :].reshape(-1, 4).astype("float32")
    if len(inner) > SUBSAMPLE_CAP:
        inner = inner[np.random.default_rng(SUBSAMPLE_SEED).choice(len(inner), SUBSAMPLE_CAP, replace=False)]
    weight = inner[:, 3:4] / 255.0
    comp = inner[:, :3] * weight + 255.0 * (1.0 - weight)
    fg_pair = [float((np.abs(comp - anchor).max(axis=1) > _DIFF).mean()) for anchor in anchors]
    fg = max(fg_pair)
    luma = comp @ np.array([0.299, 0.587, 0.114], dtype="float32")
    span = float(np.percentile(luma, 99) - np.percentile(luma, 1))
    metrics = GateMetrics(len(content), width, height, "opaque", azr, fg, span, fg_pair[0], fg_pair[1])
    if fg < min_fg:
        raise GateRejected("low-foreground", metrics)
    if span2 and span < max_luma_span and fg < 0.5:
        # 信号二默认关(方案 §1.3b):阈值贴合法产品边缘,P0 真样校准后启用
        raise GateRejected("low-luma-span", metrics)
    return metrics
