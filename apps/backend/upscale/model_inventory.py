#!/usr/bin/env python3
"""Offline upscale model inventory scanner.

Usage:
  python -m upscale.model_inventory
"""

from __future__ import annotations

import json
import sys

from .model_cache import UPSCALE_MODELS, find_cached_upscale_model, primary_model_dir


def build_model_status() -> list[dict]:
    rows: list[dict] = []
    for name, spec in UPSCALE_MODELS.items():
        cached = find_cached_upscale_model(name)
        rows.append(
            {
                "modelName": name,
                "label": spec["label"],
                "downloaded": cached is not None,
                "sizeMb": spec["size_mb"],
                "file": spec["file"],
                "scale": spec["scale"],
                "cacheDir": cached["file_path"] if cached else None,
            }
        )
    return rows


def scan_model_inventory() -> dict:
    return {"models": build_model_status(), "cacheDir": str(primary_model_dir())}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
