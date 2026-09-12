"""Model inventory — thin dispatcher(08-31 重构:每引擎独立模块)。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from engines.image_engine.model_cache import (
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
from engines.image_engine import comfyui_bridge


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
        if krea2_pointed:
            # 无衣物·指令编辑三层 LoRA(09-06 稳定版工作流;文件存在性探测,
            # 无公网源不自动下载,缺失=展示放置路径)
            # 09-12 修:LoRA 探测多根寻址——引擎家(comfy_home(),与桥/引擎链
            # 同源四级回落:env→托管 python 自识别→image-model-dir→dev 兜底)
            # 优先,回落 comfyui_models_dir()(env 覆写/退役默认)。装机 sidecar
            # 两个 env 都不带,旧单根探测打到退役目录 ~/Project/ComfyUI,四件
            # 全假报缺(09-12 用户实弹截图踩中)。
            from engines.comfyui.manifest import comfy_home as _comfy_home
            from pathlib import Path as _Path
            from engines.image_engine import krea2 as _krea2
            from engines.image_engine.model_cache import comfyui_models_dir as _cmd

            def _lora_roots() -> list[_Path]:
                roots = [_comfy_home() / "models"]
                fallback = _cmd()
                if fallback not in roots:
                    roots.append(fallback)
                return roots

            def _lora_probe(rel: str) -> dict:
                roots = _lora_roots()
                hit = next((root for root in roots if (root / rel).is_file()), None)
                return {
                    "path": str((hit or roots[0]) / rel),
                    "ready": hit is not None,
                }

            row = rows[-1]
            row["loraFiles"] = [
                {
                    "name": _rel.split("/")[-1],
                    "label": _label,
                    "required": _required,
                    **_lora_probe(_rel),
                }
                for _rel, _strength, _required in _krea2.EDIT_LORA_STACK
                for _label in (
                    "无衣物编辑 LoRA·identity(主件)" if _required else
                    ("破限 LoRA·Mystic XXX v3" if "Mystic" in _rel else "破限 LoRA·pussy(轻)"),
                )
            ]
            # 09-12 漫影生图加速档(manying_t2i_fast):有公网源的下载配置登记——
            # 缺失时按 repo/远端路径/大小三件套指路,就位后 ready 点亮
            row["loraFiles"].append({
                "name": _krea2.DISTILL_LORA_REL.split("/")[-1],
                "label": "Krea2 加速·4 步蒸馏 LoRA(漫影生图加速档)",
                "required": False,
                **_lora_probe(_krea2.DISTILL_LORA_REL),
                "repoId": _krea2.DISTILL_LORA_REPO,
                "remoteFile": _krea2.DISTILL_LORA_REMOTE_FILE,
                "sizeMb": _krea2.DISTILL_LORA_SIZE_MB,
            })
    # 分割模型(09-04 无衣物节点):目录存在性探测(不做大件/小件区分)
    import os
    from engines.image_engine.model_cache import comfyui_models_dir

    for seg_name, seg_desc in [
        ("segformer_b3_clothes", "衣物部位分割(无衣物节点分割①)"),
        ("fashn-human-parser", "人体解析(无衣物节点分割②)"),
    ]:
        found = False
        for root in [Path(os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR", "")) if os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR") else None,
                     comfyui_models_dir(), comfyui_models_dir().parent]:
            if root is None:
                continue
            if (root / seg_name / "config.json").exists():
                found = True
                break
        rows.append({
            "modelName": seg_name,
            "downloaded": found,
            "layout": "segmentation",
            "pointed": False,
            "smallPiecesReady": found,
            "description": seg_desc,
        })

    return rows


def scan_model_inventory() -> dict:
    return {"models": build_model_status()}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
