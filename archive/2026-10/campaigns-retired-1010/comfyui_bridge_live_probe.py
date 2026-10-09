#!/usr/bin/env python3
"""
ComfyUI 桥引擎 live 实弹探针(08-31-comfyui-bridge-engine 收尾 AC)。

手动诊断脚本,不进打包链(打包链禁测生图铁律)。
前置:ComfyUI 运行于 MYSTUDIO_COMFYUI_BRIDGE_URL(默认 http://127.0.0.1:17598)。

用法:
    cd apps/backend && python3 ../build/scripts/comfyui_bridge_live_probe.py

验证链:/system_stats 探测 → 模板加载/校验/实例化 → /upload/image → /prompt
→ /history 轮询 → /view 取图。两轮:文生图(krea2_t2i)+ 双参考编辑
(krea2_edit_ref);参考图仅用本脚本第一轮产物,零用户数据。
产出:/tmp/mystudio-bridge-live/*.png + 控制台 PASS/FAIL 摘要。
"""
from __future__ import annotations

import base64
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

from image_gen.engines import comfyui_bridge as bridge  # noqa: E402
from image_gen.pipeline import PipelineError  # noqa: E402

OUT_DIR = Path("/tmp/mystudio-bridge-live")
STEPS = int(__import__("os").environ.get("BRIDGE_LIVE_STEPS", "8"))


def save(tag: str, b64: str) -> Path:
    raw = base64.b64decode(b64)
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"[FAIL] {tag}: 输出不是 PNG(前 8 字节 {raw[:8]!r})")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{tag}.png"
    path.write_bytes(raw)
    print(f"[PASS] {tag}: {len(raw) / 1024:.0f} KB -> {path}", flush=True)
    return path


def main() -> int:
    started = time.monotonic()
    stats = bridge.resolve_big_files()
    if not stats:
        print(f"[FAIL] ComfyUI 不可达({bridge.bridge_url()})")
        return 1
    print(f"[PASS] 服务探测: {stats}", flush=True)

    b64 = bridge.generate(
        prompt="水墨画风格,云雾缭绕的仙山剪影,大量留白,浅净平涂底",
        aspect_ratio="1:1",
        negative_prompt=None,
        steps=STEPS,
        seed=7,
    )
    ref_path = save("t2i", b64)

    ref_b64 = base64.b64encode(ref_path.read_bytes()).decode("ascii")
    b64 = bridge.generate(
        prompt="保持构图与笔触,把色调改为黄昏暖色",
        aspect_ratio="1:1",
        negative_prompt=None,
        steps=STEPS,
        seed=8,
        reference_images_b64=[ref_b64, ref_b64],
    )
    save("edit_dual_ref", b64)

    print(f"[PASS] 桥 live 实弹全链通过,总耗时 {time.monotonic() - started:.0f}s")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PipelineError as error:  # 五错误码统一出口
        print(f"[FAIL] PipelineError: {error}")
        raise SystemExit(1)
