#!/usr/bin/env python3
"""Offline image model inventory scanner.

Usage:
  python -m image_gen.model_inventory
"""

from __future__ import annotations

import json
import sys

from .model_cache import qwen_pointed_big_files, IMAGE_MODELS, find_cached_image_model_for_spec, qwen_small_pieces_status


def build_model_status() -> list[dict]:
    rows: list[dict] = []
    for name, spec in IMAGE_MODELS.items():
        cached = find_cached_image_model_for_spec(spec)
        pointed = spec.get("layout") == "qwen-pointed"
        rows.append(
            {
                "modelName": name,
                "label": spec["label"],
                "downloaded": cached is not None,
                "sizeMb": cached["size_mb"] if cached else None,
                "repoId": "ComfyUI 指向 + 官方仓小件" if pointed else spec["repo_id"],
                "cacheDir": cached["cache_dir"] if cached else None,
                "pointed": pointed,
                "smallPiecesReady": qwen_small_pieces_status()["ready"] if pointed else None,
                # 指向版大件的具体文件路径(绝对),设置页展示用;非指向版为 None
                "pointedFiles": (
                    [str(f) for f in qwen_pointed_big_files()] if pointed else None
                ),
            }
        )
    return rows


def scan_model_inventory() -> dict:
    return {"models": build_model_status()}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
