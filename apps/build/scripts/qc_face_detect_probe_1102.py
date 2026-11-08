#!/usr/bin/env python3
"""YuNet 人脸检出口径标定(1102 吸收件①的前置测量)。

为什么先量再建门:1031 卡帧门哑火的教训是「fixture 手搓 → 门永远绿」。
这条门在 2D 国风湿墨片上到底咬不咬得住,只有拿真帧跑过才知道,
所以本件只出数、不改产线:正对照(OpenCV 官方 messi5.jpg,含真人脸)+ 负对照
(品牌 logo,无脸)+ 真实产出(H3 章节成片/单镜)。

运行:
  "<storageBase>/python/bin/python3" apps/build/scripts/qc_face_detect_probe_1102.py \
      --model <yunet.onnx> [--score-threshold 0.6] <mp4|jpg|目录>...

检出 0 帧 ≠ 片子里没脸:真人脸检测器对二维/三渲二风格的召回率本件正在量,
读数是「检出率」,不是「有脸率」——写进文档时不许混。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SAMPLES_PER_CLIP = 12
INPUT_SIZES = ((320, 320), (512, 512))


def frame_times(total: float, count: int) -> list[float]:
    if total <= 0:
        return []
    return [round((i + 0.5) * total / count, 3) for i in range(count)]


def detect(cv2, model_path: str, image, score_threshold: float, size: tuple[int, int]):
    """YuNet 要求送进去的图恰好等于 preset 输入尺寸(实测 5.0.0 直接 throw),
    所以按 x/y 双轴各自拉伸到正方形再检,框坐标按同比例除回原图。"""
    height, width = image.shape[:2]
    faces_at = cv2.FaceDetectorYN.create(model_path, "", size, score_threshold, 0.3, 5000)
    resized = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
    _, faces = faces_at.detect(resized)
    if faces is None:
        return []
    scale_x = width / size[0]
    scale_y = height / size[1]
    return [
        {
            "x": round(float(f[0]) * scale_x, 1),
            "y": round(float(f[1]) * scale_y, 1),
            "w": round(float(f[2]) * scale_x, 1),
            "h": round(float(f[3]) * scale_y, 1),
            "score": round(float(f[14]), 3),
        }
        for f in faces
    ]


def measure_image(cv2, model_path: str, path: Path, args, results: list[dict]) -> None:
    image = cv2.imread(str(path))
    if image is None:
        results.append({"target": str(path), "status": "unreadable"})
        return
    row = {"target": path.name, "kind": "image", "status": "ok",
           "size": [image.shape[1], image.shape[0]]}
    for size in INPUT_SIZES:
        faces = detect(cv2, model_path, image, args.score_threshold, size)
        row[f"faces_{size[0]}"] = len(faces)
        if faces:
            row[f"best_{size[0]}"] = max(f["score"] for f in faces)
            row[f"areaRatio_{size[0]}"] = round(
                max(f["w"] * f["h"] for f in faces) / (image.shape[1] * image.shape[0]), 4
            )
    results.append(row)


def measure_video(cv2, model_path: str, path: Path, args, results: list[dict]) -> None:
    import subprocess

    try:
        duration = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, check=True).stdout.strip() or 0)
    except (subprocess.CalledProcessError, ValueError):
        results.append({"target": str(path), "kind": "video", "status": "probe-failed"})
        return
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        results.append({"target": str(path), "kind": "video", "status": "unreadable"})
        return
    size = INPUT_SIZES[args.input_size_index]
    hit_frames = 0
    all_faces: list[dict] = []
    read_frames = 0
    for t in frame_times(duration, args.samples):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        read_frames += 1
        faces = detect(cv2, model_path, frame, args.score_threshold, size)
        if faces:
            hit_frames += 1
            all_faces.extend(faces)
    cap.release()
    areas = [f["w"] * f["h"] for f in all_faces]
    results.append({
        "target": path.name,
        "kind": "video",
        "status": "ok",
        "durationS": round(duration, 2),
        "inputSize": size[0],
        "readFrames": read_frames,
        "framesWithFace": hit_frames,
        "faceRecall": round(hit_frames / read_frames, 3) if read_frames else None,
        "faceCountTotal": len(all_faces),
        "maxFaceScore": round(max((f["score"] for f in all_faces), default=0.0), 3),
        "medianFaceAreaPx": int(sorted(areas)[len(areas) // 2]) if areas else 0,
    })


def expand_targets(raw: list[str]) -> list[Path]:
    out: list[Path] = []
    for token in raw:
        p = Path(token).expanduser()
        if p.is_dir():
            # 隐藏件(.final_tmp.mp4 之类渲染中间态)不进样本——它不是产出
            out.extend(sorted(
                item for item in [*p.glob("*.mp4"), *p.glob("*.jpg"), *p.glob("*.png")]
                if not item.name.startswith(".")
            ))
        elif p.is_file():
            out.append(p)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="YuNet face detection calibration")
    parser.add_argument("--model", required=True, help="face_detection_yunet_2023mar.onnx 绝对路径")
    parser.add_argument("--score-threshold", type=float, default=0.6)
    parser.add_argument("--samples", type=int, default=SAMPLES_PER_CLIP, help="每片均匀采样帧数")
    parser.add_argument("--input-size", type=int, default=512, choices=[320, 512], help="YuNet 输入边长")
    parser.add_argument("targets", nargs="+")
    args = parser.parse_args(argv)
    args.input_size_index = 1 if args.input_size == 512 else 0

    try:
        import cv2
    except ImportError as error:
        print(json.dumps({"status": "needs-runtime", "message": str(error)}, ensure_ascii=False))
        return 0

    results: list[dict] = []
    for path in expand_targets(args.targets):
        if path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}:
            measure_video(cv2, args.model, path, args, results)
        else:
            measure_image(cv2, args.model, path, args, results)
        print(json.dumps(results[-1], ensure_ascii=False), file=sys.stderr, flush=True)

    print(json.dumps({"status": "ok", "model": args.model, "rows": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
