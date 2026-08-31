"""Model inventory — thin dispatcher(08-31 重构:每引擎独立模块)。"""
from __future__ import annotations

import json
import sys

from .model_cache import (
    IMAGE_MODELS,
    comfyui_models_dir,
    find_cached_image_model_for_spec,
    resolve_qwen_big_files,
    resolve_z_image_big_files,
    resolve_flux2_big_files,
    resolve_krea2_big_files,
    qwen_small_pieces_status,
    z_image_small_pieces_status,
    flux2_small_pieces_status,
    krea2_small_pieces_status,
)
from .engines import comfyui_bridge


def build_model_status() -> list[dict]:
    rows = []
    for name, spec in IMAGE_MODELS.items():
        cached = find_cached_image_model_for_spec(spec)
        layout = spec.get("layout", "")
        pointed = layout == "qwen-pointed"
        z_pointed = layout == "z-image-pointed"
        flux2_pointed = layout == "flux2-pointed"
        krea2_pointed = layout == "krea2-pointed"
        bridge_service = layout == "comfyui-bridge"
        is_pointed = pointed or z_pointed or flux2_pointed or krea2_pointed

        if pointed:
            resolved = resolve_qwen_big_files()
            small_ready = qwen_small_pieces_status()["ready"]
        elif z_pointed:
            resolved = resolve_z_image_big_files()
            small_ready = z_image_small_pieces_status()["ready"]
        elif flux2_pointed:
            resolved = resolve_flux2_big_files()
            small_ready = flux2_small_pieces_status()["ready"]
        elif krea2_pointed:
            resolved = resolve_krea2_big_files()
            small_ready = krea2_small_pieces_status()["ready"]
        elif bridge_service:
            resolved = comfyui_bridge.resolve_big_files()
            small_ready = comfyui_bridge.small_pieces_status()["ready"]
        else:
            resolved = None
            small_ready = None

        rows.append({
            "modelName": name,
            "label": spec["label"],
            "downloaded": cached is not None,
            "sizeMb": cached["size_mb"] if cached else None,
            "repoId": "ComfyUI 服务(本机)" if bridge_service else ("ComfyUI 指向 / 完整下载 + 官方仓小件" if is_pointed else spec["repo_id"]),
            "cacheDir": cached["cache_dir"] if cached else None,
            "pointed": is_pointed,
            "bigFilesSource": resolved["source"] if resolved else None,
            "smallPiecesReady": small_ready,
            "pointedFiles": (
                ([str(resolved["cache_dir"])] if bridge_service else
                 [str(resolved["main"]), str(resolved["text_encoder"])]
                 + ([str(resolved["vae"])] if resolved.get("vae") else []))
                if resolved else ([] if is_pointed else None)
            ),
            **({"comfyuiVersion": resolved.get("comfyui_version")} if bridge_service and resolved else {}),
        })
    return rows


def scan_model_inventory() -> dict:
    return {"models": build_model_status()}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
