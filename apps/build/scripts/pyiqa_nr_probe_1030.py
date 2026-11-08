"""单镜 NR 指标探针(隔离 pyiqa venv,不进托管 Python 基环境)。

运行:
  "<storageBase>/python/profiles/pyiqa/venv/bin/python3" \
      apps/build/scripts/pyiqa_nr_probe_1030.py <mp4> [每帧间隔秒] [指标名逗号分隔]
"""

import subprocess
import sys
import tempfile
import os

import pyiqa
import torch

path = sys.argv[1]
step_s = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5

out = tempfile.mkdtemp(prefix="pyiqa-frames-")
subprocess.run(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", path,
     "-vf", f"fps=1/{step_s},scale='min(512,iw)':-2", os.path.join(out, "f%04d.png")],
    check=True,
)
frames = sorted(os.path.join(out, f) for f in os.listdir(out) if f.endswith(".png"))
if not frames:
    raise SystemExit("抽帧为空")

# MPS 上 pyiqa 部分指标要 float64,MPS 不支持(实跑 niqe 即炸);CPU 是本机可用档。
device = "cpu"
names = (sys.argv[3].split(",") if len(sys.argv) > 3
         else ["niqe", "brisque", "musiq", "clipiqa", "nima", "topiq_nr"])
print(f"device={device} frames={len(frames)} step={step_s}s")

for name in names:
    try:
        metric = pyiqa.create_metric(name, device=device)
    except Exception as error:  # 权重下载失败/缺依赖都属于不可用,不阻断其余指标
        print(f"{name:9s} UNAVAILABLE {type(error).__name__}: {str(error)[:120]}")
        continue
    # dover 在 pyiqa 0.1.16 报 "not implemented yet",此处只走抽帧指标
    targets = frames
    values = []
    for frame in targets:
        try:
            values.append(float(metric(frame)))
        except Exception as error:
            print(f"{name:9s} sample FAIL {type(error).__name__}: {str(error)[:200]}")
            break
    if not values:
        print(f"{name:9s} no-value")
        continue
    mean = sum(values) / len(values)
    print(f"{name:9s} lower_better={metric.lower_better} mean={mean:.4f} "
          f"min={min(values):.4f} max={max(values):.4f}")
