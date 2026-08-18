#!/usr/bin/env python3
"""Offline model inventory scan — mirrors depth_estimation/model_inventory.py."""

from __future__ import annotations

import json
import sys

from .model_cache import find_cached_video_qc_model, primary_model_dir, VIDEO_QC_MODELS


def scan() -> dict:
    models = []
    for name, spec in VIDEO_QC_MODELS.items():
        cached = find_cached_video_qc_model(name)
        models.append({
            "name": name,
            "label": spec["label"],
            "downloaded": cached is not None,
            "sizeMb": cached["size_mb"] if cached else 0,
            "pinned": bool(spec["sha256"]),
        })
    return {"cacheDir": str(primary_model_dir()), "models": models}


if __name__ == "__main__":
    print(json.dumps(scan(), ensure_ascii=False))
    sys.exit(0)
