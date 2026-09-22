#!/usr/bin/env python3
"""model/imagegen 老生图缓存域退役(09-10 用户裁定:生图收敛 ComfyUI)。

判定依据(逐件核验,台账可审计):
- Krea2 三件大件 ComfyUI 目录已齐备(装机实弹自足已证)→ 本地 krea2 snapshot
  (diffusers 版 VAE+官方 TE 兜底+configs/tokenizer)全为老管线遗产 → 删;
- Z-Image/FLUX.2/Qwen 小件:对应 ComfyUI 期望文件名全部缺席且格式无法确证
  等价(硬迁=假就绪)→ 删;引擎需要时经 ComfyUI 生态自取;
- fashn-human-parser/segformer_b3_clothes:无衣物遮罩流(老模式专属)→ 删
  (ComfyUI 自己的 segformer 目录不受影响)。

用法:python3 apps/build/scripts/imagegen_cache_retire.py [--apply]
默认干跑只出台账;--apply 才真删。台账落 apps/output/automation/imagegen-retire-ledger.json。
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

IMAGEGEN_DIR = Path.home() / "Library/Application Support/漫影工作室/model/imagegen"
COMFY_MODELS = Path.home() / "Library/Application Support/漫影工作室/comfyui/models"
LEDGER = Path(__file__).resolve().parents[2] / "output/automation/imagegen-retire-ledger.json"

# ComfyUI 侧已齐备的 Krea2 三件(等价性锚点:存在即代表 ComfyUI 自足)
# 09-23 更新:TE/VAE 锚点随 09-22 换装改 Engineer-V1 + HDR VAE(旧 4B heretic 已删、
# 老 qwen_image_vae 不再被现役工作流引用);锚点名与 34 件现役工作流加载名一致。
COMFY_KREA2_FILES = (
    "diffusion_models/krea2_turbo_bf16.safetensors",
    "text_encoders/Krea2-Engineer-V1-bf16.safetensors",
    "vae/qwen_image_HDR_vae_fp32_comfy.safetensors",
)


def head_fingerprint(path: Path, limit: int = 32 << 20) -> str:
    h = hashlib.sha256()
    remaining = limit
    with path.open("rb") as fh:
        while remaining > 0:
            block = fh.read(min(1 << 20, remaining))
            if not block:
                break
            h.update(block)
            remaining -= len(block)
    return h.hexdigest()[:16]


def main() -> int:
    apply = "--apply" in sys.argv
    if not IMAGEGEN_DIR.is_dir():
        print(f"目录不存在(可能已退役): {IMAGEGEN_DIR}")
        return 0

    # 前置门:ComfyUI 侧 Krea2 三件必须齐备才允许删(否则先补齐再退役)
    missing = [f for f in COMFY_KREA2_FILES if not (COMFY_MODELS / f).is_file()]
    if missing:
        print("拒绝执行:ComfyUI 侧 Krea2 大件缺失,删本地会打断生图:", missing)
        return 2

    entries = []
    total = 0
    for path in sorted(IMAGEGEN_DIR.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(IMAGEGEN_DIR)
        size = path.stat().st_size
        total += size
        entries.append({
            "file": str(rel),
            "size_mb": round(size / 1024 / 1024, 1),
            "fingerprint_head32m": head_fingerprint(path) if size > 0 else "",
        })

    ledger = {
        "dir": str(IMAGEGEN_DIR),
        "comfy_krea2_ready": [f for f in COMFY_KREA2_FILES],
        "verdict": "全删(老模式遗产;Krea2 大件 ComfyUI 已备,其余件无 ComfyUI 等价迁移价值)",
        "file_count": len(entries),
        "total_mb": round(total / 1024 / 1024, 1),
        "files": entries,
    }
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"台账: {LEDGER} ({len(entries)} 件 / {ledger['total_mb']} MB)")

    if apply:
        import shutil
        shutil.rmtree(IMAGEGEN_DIR)
        print(f"已删除: {IMAGEGEN_DIR} (释放约 {round(total/1024/1024/1024, 1)} GB)")
    else:
        print("干跑完成;加 --apply 执行删除")
    return 0


if __name__ == "__main__":
    sys.exit(main())
