#!/usr/bin/env python3
"""Offline image model inventory scanner.

Usage:
  python -m image_gen.model_inventory
"""

from __future__ import annotations

import json
import sys

from .model_cache import (
    IMAGE_MODELS,
    find_cached_image_model_for_spec,
    qwen_small_pieces_status,
    resolve_qwen_big_files,
    resolve_z_image_big_files,
    z_image_small_pieces_status,
    resolve_flux2_big_files,
    flux2_small_pieces_status,
)


def build_model_status() -> list[dict]:
    rows: list[dict] = []
    for name, spec in IMAGE_MODELS.items():
        cached = find_cached_image_model_for_spec(spec)
        layout = spec.get("layout")
        pointed = layout == "qwen-pointed"
        z_pointed = layout == "z-image-pointed"
        # 大件实际生效来源与路径(按引擎分派解析;缺大件为 None)
        flux2_pointed = spec.get("layout") == "flux2-pointed"
        if pointed:
            resolved = resolve_qwen_big_files()
            small_ready = qwen_small_pieces_status()["ready"]
        elif z_pointed:
            resolved = resolve_z_image_big_files()
            small_ready = z_image_small_pieces_status()["ready"]
        elif flux2_pointed:
            resolved = resolve_flux2_big_files()
            small_ready = flux2_small_pieces_status()["ready"]
        else:
            resolved = None
            small_ready = None
        rows.append(
            {
                "modelName": name,
                "label": spec["label"],
                "downloaded": cached is not None,
                "sizeMb": cached["size_mb"] if cached else None,
                "repoId": "ComfyUI 指向 / 完整下载 + 官方仓小件" if (pointed or z_pointed or flux2_pointed) else spec["repo_id"],
                "cacheDir": cached["cache_dir"] if cached else None,
                "pointed": pointed or z_pointed or flux2_pointed,
                "bigFilesSource": resolved["source"] if resolved else None,
                "smallPiecesReady": small_ready if (pointed or z_pointed or flux2_pointed) else None,
                # 大件实际文件路径(绝对,两源通用),设置页展示用;缺大件时空表
                "pointedFiles": (
                    (
                        [str(resolved["main"]), str(resolved["text_encoder"])]
                        + ([str(resolved["vae"])] if resolved.get("vae") else [])
                        if resolved
                        else ([] if (pointed or z_pointed or flux2_pointed) else None)
                    )
                ),
            }
        )
    return rows


def scan_model_inventory() -> dict:
    return {"models": build_model_status()}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
