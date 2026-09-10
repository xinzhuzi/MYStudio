#!/usr/bin/env python3
"""老 model/ 域全量迁入 comfyui/models(09-10 用户裁定:模型统一家)。

动作:
- MOVE 家族(TTS/depth/upscale/videoqc/vlm/audio/sfx):同卷 mv 到 comfyui/models/<family>/
  (audio/sfx 老目录不存在则跳过——从未下载);目标已存在且非空=碰撞,跳过并报告。
- RETIRE(mdx:mlx-serve-managed):music3 时代的托管 mlx-serve 运行时,VLM 走应用托管
  Python、全仓零活引用(仅 README 提及)——按「不能适配的不留」删除,台账留证。
- 收尾:老 model/ 根目录空则移除。

前置门:应用未运行(--apply 时强制);台账逐家族记录件数/体积/动作。
用法:python3 apps/build/scripts/model_dir_unify.py [--apply]
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

USER_DATA = Path.home() / "Library/Application Support/漫影工作室"
SRC = USER_DATA / "model"
DST = USER_DATA / "comfyui" / "models"
LEDGER = Path(__file__).resolve().parents[2] / "output/automation/model-dir-unify-ledger.json"

MOVE_FAMILIES = ("TTS", "depth", "upscale", "videoqc", "vlm", "audio", "sfx")
RETIRE_FAMILIES = ("mlx-serve-managed",)


def tree_stat(path: Path) -> tuple[int, int]:
    files = size = 0
    for f in path.rglob("*"):
        if f.is_file():
            files += 1
            size += f.stat().st_size
    return files, size


def app_running() -> bool:
    try:
        subprocess.run(["pgrep", "-f", "漫影工作室.app/Contents/MacOS"], capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError:
        return False


def main() -> int:
    apply = "--apply" in sys.argv
    if not SRC.is_dir():
        print(f"老目录不存在(可能已迁): {SRC}")
        return 0
    if apply and app_running():
        print("拒绝执行:应用正在运行(搬家须在应用退出后进行,sidecar 才不占旧路径)")
        return 2

    entries = []
    for name in sorted(p.name for p in SRC.iterdir()):
        src_path = SRC / name
        if name in MOVE_FAMILIES:
            dst_path = DST / name
            if not src_path.is_dir():
                continue
            files, size = tree_stat(src_path)
            if dst_path.exists() and any(dst_path.iterdir()):
                action = "collision-skip"
            else:
                action = "move"
            entries.append({"family": name, "action": action, "files": files,
                            "size_mb": round(size / 1024 / 1024, 1),
                            "from": str(src_path), "to": str(dst_path)})
        elif name in RETIRE_FAMILIES:
            files, size = tree_stat(src_path)
            entries.append({"family": name, "action": "retire-delete", "files": files,
                            "size_mb": round(size / 1024 / 1024, 1), "from": str(src_path),
                            "why": "music3 时代托管 mlx-serve 运行时;VLM 走应用托管 Python,全仓零活引用"})
        else:
            entries.append({"family": name, "action": "unknown-report", "note": "不在迁移名单,原样保留"})

    total_mb = round(sum(e.get("size_mb", 0) for e in entries) / 1024, 1)
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps({"src": str(SRC), "dst": str(DST), "entries": entries},
                                 ensure_ascii=False, indent=2), encoding="utf-8")
    for e in entries:
        print(f"{e['action']:>15}  {e['family']:<18} {e.get('files', 0):>5} 件  {e.get('size_mb', 0):>9} MB")
    print(f"台账: {LEDGER}(合计约 {total_mb} GB)")

    if not apply:
        print("干跑完成;加 --apply 执行")
        return 0

    for e in entries:
        if e["action"] == "move":
            DST.mkdir(parents=True, exist_ok=True)
            if (DST / e["family"]).exists():
                shutil.rmtree(DST / e["family"])  # 空壳目标(碰撞检查已排除非空)
            shutil.move(str(SRC / e["family"]), str(DST / e["family"]))
            print(f"moved → {e['to']}")
        elif e["action"] == "retire-delete":
            shutil.rmtree(SRC / e["family"])
            print(f"retired × {e['family']} ({e['size_mb']} MB)")

    # 收尾:清理 .DS_Store 与空目录,老根目录清空则移除
    for junk in SRC.rglob(".DS_Store"):
        junk.unlink(missing_ok=True)
    for p in sorted((d for d in SRC.rglob("*") if d.is_dir()), reverse=True):
        if not any(p.iterdir()):
            p.rmdir()
    if SRC.exists() and not any(SRC.iterdir()):
        SRC.rmdir()
        print(f"老 model/ 根目录已清空移除: {SRC}")
    else:
        print(f"老 model/ 仍有内容,保留: {[p.name for p in remaining]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
