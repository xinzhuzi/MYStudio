#!/usr/bin/env python3
"""daojie_sheet_b_frame.py — 薄壳(1113 道劫正册化:真源单点内聚节点件)。

固定底框/角标/角名/配色/预裁/合成的唯一真源=
  apps/backend/comfyui/my_nodes/nodes/my_sheet_card_composer.py
本件仅 re-export(管线 daojie_sheet_b_pipeline.py 与金样自检走同一条代码路,
禁在此另写一份几何)。离线自检:python3 daojie_sheet_b_frame.py --selftest
"""
from __future__ import annotations

import importlib.util
import pathlib

_SRC = (pathlib.Path(__file__).resolve().parents[2]
        / "backend/comfyui/my_nodes/nodes/my_sheet_card_composer.py")
_spec = importlib.util.spec_from_file_location("my_sheet_card_frame", _SRC)
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)

for _k in ("W", "H", "M", "G", "FORMAT_VERSION", "PAPER", "INK_LINE",
           "INK_TEXT", "NAME_SIZE", "LABEL_SIZE", "CELL_KEYS", "LABELS",
           "layout", "cells_focal", "fit_crop", "extract_palette", "zoom",
           "derive_cells", "compose", "_selftest"):
    globals()[_k] = getattr(_m, _k)

if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        _selftest()
        print(f"[SELFTEST OK] /tmp/sheetB_frame_selftest.png ({W}, {H})")
    else:
        print(__doc__)
