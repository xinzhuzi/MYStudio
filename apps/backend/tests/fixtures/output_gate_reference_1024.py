"""空片门禁 v3 参考实现 + fixture 构造器(blank-gate-1024 §0.1 证据纪律)。

锚数字唯一真源:随机种子钉死 20241024,直接运行本脚本打印锚表,复跑即得;
施工测试断言只允许挂本脚本输出值。生产实现
engines/image_engine/output_gate.py 须与本参考实现在全部 fixture 上逐值
一致(test_image_output_gate.py 双钉:锚常量 + 与本实现活对拍)。

用法:cd apps && PYTHONPATH=backend python3 backend/tests/fixtures/output_gate_reference_1024.py
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

# ── 算法常量(与生产 output_gate.py 同值;种子不做 env——可变种子会让锚漂移) ──
SEED = 20241024
SAMPLE_CAP = 512 * 512          # 内域随机子采样上限(≤512²)
MIN_SIDE = 256                  # 小图豁免线
DIFF = 20.0                     # 与背景锚的逐通道差异判废线
TRANS_ALPHA = 0.30              # 透明/不透明域分流线
TRANS_BLANK = 0.995             # 透明域全透空片线
LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)


class Rejected(Exception):
    """判废(reason: "low-foreground" | "low-luma-span" | "transparent-blank")。"""

    def __init__(self, reason: str, metrics: dict):
        super().__init__(reason)
        self.reason = reason
        self.metrics = metrics


def _png(im: Image.Image) -> bytes:
    out = io.BytesIO()
    im.save(out, format="PNG")
    return out.getvalue()


# ── fixture 构造器(全部确定性;噪声件用 default_rng(SEED)) ─────────────
def fixture_pure(color: tuple[int, int, int]) -> bytes:
    return _png(Image.new("RGB", (1024, 1024), color))


def fixture_fully_transparent() -> bytes:
    return _png(Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)))


def fixture_sticker_rgba(subject: tuple[int, int, int]) -> bytes:
    """透明底+居中 401² 主体贴纸(azr = 1 - 401²/1024² ≈ 0.847)。"""
    arr = np.zeros((1024, 1024, 4), dtype=np.uint8)
    top = (1024 - 401) // 2
    arr[top:top + 401, top:top + 401, :3] = subject
    arr[top:top + 401, top:top + 401, 3] = 255
    return _png(Image.fromarray(arr, "RGBA"))


def fixture_gradient_0_30() -> bytes:
    """横向 0→30 灰度渐变(平滑弱结构黑图形态;信号一漏网,信号二专责)。"""
    col = np.linspace(0.0, 30.0, 1024, dtype=np.float32)
    gray = np.round(np.tile(col, (1024, 1))).astype(np.uint8)
    return _png(Image.fromarray(np.stack([gray] * 3, axis=2), "RGB"))


def fixture_two_color_halves() -> bytes:
    """左半 100 / 右半 140(40 差对半):中位锚把全图 diff 减半为 20=不过线。"""
    arr = np.full((1024, 1024, 3), 100, dtype=np.uint8)
    arr[:, 512:, :] = 140
    return _png(Image.fromarray(arr, "RGB"))


def fixture_col0_three_bands() -> bytes:
    """底 128 + 三条 2px 竖带 220:环内两锚同落 128 → 两锚 fg 必然一致(锚确定性)。"""
    arr = np.full((1024, 1024, 3), 128, dtype=np.uint8)
    for col in (100, 101, 500, 501, 800, 801):
        arr[:, col, :] = 220
    return _png(Image.fromarray(arr, "RGB"))


def fixture_period2_stripes() -> bytes:
    """周期 2 竖条带(偶列 215/奇列 255):纯步长子采样会相位混叠全灭的回归载体。"""
    arr = np.zeros((1024, 1024, 3), dtype=np.uint8)
    arr[:, 0::2, :] = 215
    arr[:, 1::2, :] = 255
    return _png(Image.fromarray(arr, "RGB"))


def fixture_dark_noise() -> bytes:
    """暗调噪声(灰 5-40 整数均匀):单中位锚下 fg=0 会被信号一误杀的形态。"""
    rng = np.random.default_rng(SEED)
    gray = rng.integers(5, 41, (1024, 1024), dtype=np.uint8)
    return _png(Image.fromarray(np.stack([gray] * 3, axis=2), "RGB"))


def fixture_full_noise() -> bytes:
    """全幅 RGB 噪声(0-255):脏黑图反例,双信号均放行(>1% 内容)。"""
    rng = np.random.default_rng(SEED)
    return _png(Image.fromarray(rng.integers(0, 256, (1024, 1024, 3), dtype=np.uint8), "RGB"))


def fixture_white_highkey_small_subject() -> bytes:
    """白底高 key 小主体:浅衣 242(|242-255|=13<20 不计)+深发 30 小面积
    (90×100=9000px,墨量 0.86%)——信号一误杀面的真实形态载体。"""
    arr = np.full((1024, 1024, 3), 255, dtype=np.uint8)
    top = (1024 - 420) // 2
    arr[top:top + 420, top:top + 420, :] = 242  # 主体浅衣
    hair_top = top + 40
    arr[hair_top:hair_top + 100, top + 160:top + 250, :] = 30  # 深发 9000px
    return _png(Image.fromarray(arr, "RGB"))


TRUNCATED_PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32  # 签名在、IHDR 截断


# ── v3 参考实现(与生产 output_gate.evaluate_output 同算法) ─────────────
def evaluate(content: bytes, *, min_fg: float = 0.01, max_luma_span: float = 40.0,
             span2: bool = False) -> dict | None:
    """返回 metrics(放行/fail-open)或 raise Rejected;None=fail-open 放行。"""
    try:
        im = Image.open(io.BytesIO(content))
        im.load()
    except (OSError, ValueError):
        return None  # fail-open(解码失败不是空片证据)
    arr = np.asarray(im.convert("RGBA"), dtype=np.uint8)
    height, width = arr.shape[0], arr.shape[1]
    metrics: dict = {"bytes_len": len(content), "width": width, "height": height}
    if width < MIN_SIDE or height < MIN_SIDE:
        metrics.update(domain="small", alpha_zero_ratio=float((arr[..., 3] == 0).mean()),
                       fg_ratio=0.0, luma_span=0.0, fg_ratio_med=0.0, fg_ratio_p95=0.0)
        return metrics  # 小图豁免(只记不判)
    alpha = arr[..., 3]
    azr = float((alpha == 0).mean())
    metrics["alpha_zero_ratio"] = round(azr, 6)
    if azr > TRANS_ALPHA:
        metrics.update(domain="transparent", fg_ratio=round(1.0 - azr, 6),
                       luma_span=0.0, fg_ratio_med=0.0, fg_ratio_p95=0.0)
        if azr > TRANS_BLANK:
            raise Rejected("transparent-blank", metrics)
        return metrics
    # 不透明域:边界环(四边全量,不抽样)双锚 + 内域随机子采样(default_rng(SEED))
    ring = np.concatenate([arr[0, :, :3], arr[-1, :, :3], arr[1:-1, 0, :3], arr[1:-1, -1, :3]]).astype(np.float32)
    anchors = (np.median(ring, axis=0), np.percentile(ring, 95, axis=0))
    inner = arr[1:-1, 1:-1, :].reshape(-1, 4).astype(np.float32)
    if len(inner) > SAMPLE_CAP:
        inner = inner[np.random.default_rng(SEED).choice(len(inner), SAMPLE_CAP, replace=False)]
    comp = inner[:, :3] * (inner[:, 3:4] / 255.0) + 255.0 * (1.0 - inner[:, 3:4] / 255.0)
    fg_pair = [float((np.abs(comp - anchor).max(axis=1) > DIFF).mean()) for anchor in anchors]
    fg = max(fg_pair)
    luma = comp @ LUMA
    span = float(np.percentile(luma, 99) - np.percentile(luma, 1))
    metrics.update(domain="opaque", fg_ratio=round(fg, 6), luma_span=round(span, 4),
                   fg_ratio_med=round(fg_pair[0], 6), fg_ratio_p95=round(fg_pair[1], 6))
    if fg < min_fg:
        raise Rejected("low-foreground", metrics)
    if span2 and span < max_luma_span and fg < 0.5:
        raise Rejected("low-luma-span", metrics)
    return metrics


# ── 锚表:运行本脚本打印(正文一切 [ref] 锚数字的唯一来源) ────────────────
CASES: list[tuple[str, bytes, dict]] = [
    ("pure_black_1024", fixture_pure((0, 0, 0)), {}),
    ("pure_white_1024", fixture_pure((255, 255, 255)), {}),
    ("pure_red_1024", fixture_pure((255, 0, 0)), {}),
    ("fully_transparent_rgba", fixture_fully_transparent(), {}),
    ("mid_color_sticker_rgba", fixture_sticker_rgba((160, 60, 40)), {}),
    ("light_sticker_rgba_230_248", fixture_sticker_rgba((230, 238, 248)), {}),
    ("gradient_0_30_default", fixture_gradient_0_30(), {}),
    ("gradient_0_30_span2", fixture_gradient_0_30(), {"span2": True}),
    ("two_color_halves_40", fixture_two_color_halves(), {}),
    ("col0_three_bands", fixture_col0_three_bands(), {}),
    ("period2_stripes_215_255", fixture_period2_stripes(), {}),
    ("dark_noise_5_40", fixture_dark_noise(), {}),
    ("full_noise_rgb", fixture_full_noise(), {}),
    ("white_highkey_small_subject", fixture_white_highkey_small_subject(), {}),
    ("white_highkey_minfg_0005", fixture_white_highkey_small_subject(), {"min_fg": 0.005}),
    ("white_highkey_minfg_002", fixture_white_highkey_small_subject(), {"min_fg": 0.02}),
    ("decode_fail_fake", b"fake-png", {}),
    ("decode_fail_empty", b"", {}),
    ("decode_fail_truncated", TRUNCATED_PNG_HEADER, {}),
    ("small_63_black", _png(Image.new("RGB", (63, 63), (0, 0, 0))), {}),
]


def run_anchors() -> list[str]:
    lines: list[str] = []
    for name, blob, kwargs in CASES:
        try:
            m = evaluate(blob, **kwargs)
            lines.append(f"{name}: PASS {m}")
        except Rejected as exc:
            lines.append(f"{name}: REJECT-{exc.reason} {exc.metrics}")
    for span_band in (40.0, 60.0, 80.0):
        try:
            evaluate(fixture_gradient_0_30(), span2=True, max_luma_span=span_band)
            lines.append(f"gradient_span2_band_{int(span_band)}: PASS")
        except Rejected as exc:
            lines.append(f"gradient_span2_band_{int(span_band)}: REJECT-{exc.reason} {exc.metrics}")
    return lines


if __name__ == "__main__":
    for line in run_anchors():
        print(line)
