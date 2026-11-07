"""人脸检出与可判读度 worker(1102 吸收件①)。

真机标定结论(2026-11-02,`apps/build/scripts/qc_face_detect_probe_1102.py`):
  正对照 OpenCV 官方 messi5.jpg → 检出 1 脸 score 0.894;负对照品牌 logo → 0 脸;
  真实产出 ch1_h3_matrix_1029(二维国风湿墨,50 支)@512 输入 →
    faceRecall p10=0.1 / p50=0.9 / p90=1.0,零检出仅 3 支;
    逐支亲检那 3 支:靴子特写(画面无脸)、背面行走、侧脸——**都是合理内容,不是崩坏**。
  同批 43 张真脸的五官几何比值:noseOverEye 0.28–1.02、mouthOverNose 0.18–0.95、
  roll −8.1°~+4.2°(全部来自正常帧)。
  同一章两种出片分辨率对照(24 帧均匀采样):
    h3_chapter_draft.mp4 1920×1080 → 50 脸全可辨,readableRatio 1.0,中位短边 71.1px;
    h3_edition_final.mp4  608×352 → 51 脸仅 18 可辨,readableRatio 0.353,中位短边 22.1px。
  差别只来自分辨率,不来自内容——这就是「脸的绝对尺寸」能站住、而「有没有检出脸」站不住的原因。

所以本件**不做**「零检出=崩坏」或几何越限判定——那会把背面镜头和二维画风判成故障。
它只回答两个能站得住的问题:
  1. 这一章里有没有「自动可判读的人脸证据」(检出率 + 脸的绝对尺寸);
  2. 相邻采样帧之间最大脸的表观距离分布(漂移记账,阈值未标定,先记不判)。
五官错位/手指异常由 L5 多模态预审检查；口型同步另需音画时序证据。

运行:
  "<storageBase>/python/bin/python3" -m face_qc.worker --video <mp4> [--json]
  # 模型缺省时走 video_qc 的模型家(<storageBase>/comfyui/models/videoqc/face_detection_yunet.onnx)
  # 裁片模式(1107 吸收件②):--at 0.63,3.16,... --crop-out <dir>
  #   只按给定时间点出「本帧最大脸的原始分辨率裁片」+ JSON 台账,不跑全章证据扫描。

失败语义照 speech_vad:cv2 缺 / 模型缺 / 抽帧失败一律回 status=needs-runtime 的 JSON 且退出码 0,
调用方按「无人脸证据」处理,不许当成「人脸没问题」。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

INPUT_SIZE = 512
SCORE_THRESHOLD = 0.6
NMS_THRESHOLD = 0.3
SAMPLES_PER_CHAPTER = 24
# 脸框短边低于这个像素数,五官就不可辨——检出到也判不了(经验值,与 608×352 实测 p10 短边 ~24px 同档)。
FACE_MIN_READABLE_PX = 24
MODEL_NAME = "yunet-face"
DESCRIPTOR_SIZE = 64
# 1107 吸收件②:人脸裁片(喂 L5 多模态预审,见 crop_faces)
CROP_BOX_MARGIN = 1.5
CROP_MIN_SIDE = 256
CROP_JPEG_QUALITY = 95


def media_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def resolve_model_path(explicit: str | None) -> str:
    if explicit:
        # 显式路径也验存在:否则 cv2 会抛图形引擎内部的 -215,读起来像"检测器坏了"而不是"文件没了"
        if not Path(explicit).is_file():
            raise FileNotFoundError(f"模型文件不存在: {explicit}")
        return explicit
    from engines.video_qc_engine.model_cache import find_cached_video_qc_model

    cached = find_cached_video_qc_model(MODEL_NAME)
    if cached is None:
        raise FileNotFoundError(f"模型未下载: {MODEL_NAME}")
    return cached["file_path"]


def face_descriptor(cv2, image, box):
    """最大脸的表观描述子:框内灰度缩到 64×64 → 8×8 分块均值,拼 64 维并归一化。

    只用来量「这一帧的脸和上一帧的脸像不像」,不用来认人:二维画风下同角色换光照
    就会显著挪动它,所以距离只记账、不判越限。
    """
    x, y, w, h = (int(round(v)) for v in box)
    height, width = image.shape[:2]
    left, top = max(0, x), max(0, y)
    right, bottom = min(width, x + w), min(height, y + h)
    if right <= left or bottom <= top:
        return None
    gray = cv2.cvtColor(image[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (DESCRIPTOR_SIZE, DESCRIPTOR_SIZE), interpolation=cv2.INTER_AREA)
    blocks = [float(small[r * 8:(r + 1) * 8, c * 8:(c + 1) * 8].mean()) for r in range(8) for c in range(8)]
    norm = sum(v * v for v in blocks) ** 0.5
    if norm == 0:
        return None
    return [v / norm for v in blocks]


def cosine_distance(left, right) -> float:
    return max(0.0, min(2.0, 1.0 - sum(a * b for a, b in zip(left, right))))


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(p * len(ordered)))], 4)


def scan_video(cv2, model_path: str, video_path: str, samples: int, score_threshold: float) -> dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("cv2 打不开视频")
    detector = cv2.FaceDetectorYN.create(model_path, "", (INPUT_SIZE, INPUT_SIZE), score_threshold, NMS_THRESHOLD, 5000)
    total = media_duration(video_path)
    faces: list[dict] = []
    drift_distances: list[float] = []
    frames_read = 0
    frames_with_face = 0
    previous_descriptor = None
    try:
        for index in range(samples):
            timestamp = round((index + 0.5) * total / samples, 3) if total > 0 else 0.0
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            frames_read += 1
            height, width = frame.shape[:2]
            _, rows = detector.detect(cv2.resize(frame, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_AREA))
            if rows is None or len(rows) == 0:
                previous_descriptor = None
                continue
            frames_with_face += 1
            scale_x = width / INPUT_SIZE
            scale_y = height / INPUT_SIZE
            boxes = [(float(row[0]) * scale_x, float(row[1]) * scale_y,
                      float(row[2]) * scale_x, float(row[3]) * scale_y, float(row[14])) for row in rows]
            for (x, y, w, h, score) in boxes:
                visible_w = max(0.0, min(width, x + w) - max(0.0, x))
                visible_h = max(0.0, min(height, y + h) - max(0.0, y))
                faces.append({
                    "tS": timestamp,
                    "shortSidePx": round(min(visible_w, visible_h), 1),
                    "areaRatio": round(visible_w * visible_h / max(1, width * height), 5),
                    "score": round(score, 3),
                })
            largest = max(boxes, key=lambda box: box[2] * box[3])
            descriptor = face_descriptor(cv2, frame, (largest[0], largest[1], largest[2], largest[3]))
            if descriptor is not None:
                if previous_descriptor is not None:
                    drift_distances.append(cosine_distance(previous_descriptor, descriptor))
                previous_descriptor = descriptor
    finally:
        cap.release()

    readable = [face for face in faces if face["shortSidePx"] >= FACE_MIN_READABLE_PX]
    return {
        "durationS": round(total, 3),
        "inputSize": INPUT_SIZE,
        "scoreThreshold": score_threshold,
        "minReadableFacePx": FACE_MIN_READABLE_PX,
        "samplesRequested": samples,
        "framesRead": frames_read,
        "framesWithFace": frames_with_face,
        "coverage": round(frames_with_face / frames_read, 3) if frames_read else None,
        "faceCount": len(faces),
        "readableFaceCount": len(readable),
        "readableRatio": round(len(readable) / len(faces), 3) if faces else None,
        "medianFaceShortSidePx": percentile([face["shortSidePx"] for face in faces], 0.5),
        "maxFaceScore": percentile([face["score"] for face in faces], 1.0),
        "driftDistanceP50": percentile(drift_distances, 0.5),
        "driftDistanceP95": percentile(drift_distances, 0.95),
        "driftPairs": len(drift_distances),
    }


def crop_faces(cv2, model_path: str, video_path: str, timestamps: list[float], out_dir: str) -> dict:
    """按调用方给的时间戳出「本帧最大脸的原始分辨率裁片」,交 L5 多模态预审当证据(1107 吸收件②)。

    为什么要裁片:1102 标定过同一章两种出片分辨率的脸中位短边(1080P=71px / 608×352=22px),
    而 L5 探针帧整帧限宽 1280 后 1080P 的脸只剩 ~47px——五官细节在整帧缩放与模型切片里被吃掉。
    裁片不新增细节,只是把这一镜里脸实际占的那几十像素整份交给模型,让它占满输入视野。
    检测输入仍用 INPUT_SIZE=512:1107 在 720×1296 真人件对照 512/768/960 三档,检出数恒 16,
    放大输入并不补召回,没必要为这条路换一套口径。
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("cv2 打不开视频")
    detector = cv2.FaceDetectorYN.create(model_path, "", (INPUT_SIZE, INPUT_SIZE), SCORE_THRESHOLD, NMS_THRESHOLD, 5000)
    crops: list[dict] = []
    frames_read = 0
    frames_without_face = 0
    crop_errors = 0
    try:
        for index, timestamp in enumerate(timestamps):
            stamp = round(timestamp, 3)
            cap.set(cv2.CAP_PROP_POS_MSEC, stamp * 1000)
            ok, frame = cap.read()
            if not ok or frame is None:
                # 逐条记账:调用方要能指出「第几镜的裁片没出成」,只报总数等于把缺证藏进统计里
                crop_errors += 1
                crops.append({"index": index, "tS": stamp, "status": "read-failed"})
                continue
            frames_read += 1
            height, width = frame.shape[:2]
            _, rows = detector.detect(cv2.resize(frame, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_AREA))
            if rows is None or len(rows) == 0:
                # 无脸镜头(背面/靴子特写已亲检为合理内容)不出裁片:这是空证据,不是失败
                frames_without_face += 1
                crops.append({"index": index, "tS": stamp, "status": "no-face"})
                continue
            boxes = [(float(row[0]) * width / INPUT_SIZE, float(row[1]) * height / INPUT_SIZE,
                      float(row[2]) * width / INPUT_SIZE, float(row[3]) * height / INPUT_SIZE) for row in rows]
            x, y, w, h = max(boxes, key=lambda box: box[2] * box[3])
            center_x, center_y = x + w / 2, y + h / 2
            side = max(w, h) * CROP_BOX_MARGIN
            left, top = max(0, int(center_x - side / 2)), max(0, int(center_y - side / 2))
            right, bottom = min(width, int(center_x + side / 2)), min(height, int(center_y + side / 2))
            file_name = f"face-crop-{index:03d}-t{stamp:.3f}.jpg"
            if right <= left or bottom <= top:
                crop_errors += 1
                crops.append({"index": index, "tS": stamp, "status": "write-failed", "file": file_name})
                continue
            crop = frame[top:bottom, left:right]
            short_side = min(crop.shape[:2])
            upscaled = short_side < CROP_MIN_SIDE
            if upscaled:
                factor = CROP_MIN_SIDE / short_side
                crop = cv2.resize(
                    crop,
                    (int(round(crop.shape[1] * factor)), int(round(crop.shape[0] * factor))),
                    interpolation=cv2.INTER_LANCZOS4,
                )
            if not cv2.imwrite(str(Path(out_dir) / file_name), crop, [cv2.IMWRITE_JPEG_QUALITY, CROP_JPEG_QUALITY]):
                crop_errors += 1
                crops.append({"index": index, "tS": stamp, "status": "write-failed", "file": file_name})
                continue
            crops.append({
                "index": index,
                "tS": stamp,
                "status": "crop",
                "file": file_name,
                "box": [round(v, 1) for v in (x, y, w, h)],
                "faceShortSidePx": round(min(w, h), 1),
                "facesInFrame": len(boxes),
                "cropPx": [int(crop.shape[1]), int(crop.shape[0])],
                "upscaled": upscaled,
            })
    finally:
        cap.release()

    return {
        "mode": "crops",
        "timestampsRequested": len(timestamps),
        "framesRead": frames_read,
        "framesWithoutFace": frames_without_face,
        "cropCount": sum(1 for crop in crops if crop["status"] == "crop"),
        "cropErrors": crop_errors,
        "cropBoxMargin": CROP_BOX_MARGIN,
        "cropMinSidePx": CROP_MIN_SIDE,
        "crops": crops,
    }


def parse_timestamps(value: str) -> list[float]:
    """`--at` 的口径:逗号分隔秒数。任何一条读不成有限数就整串拒收——
    静默丢掉一个时间点会让那一镜没有脸裁片证据,而报告上看不出来。"""
    stamps: list[float] = []
    for part in value.split(","):
        text = part.strip()
        if not text:
            continue
        stamp = float(text)
        if not (stamp == stamp) or stamp < 0:  # NaN / 负数
            raise ValueError(f"时间戳非法: {text}")
        stamps.append(stamp)
    return stamps


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="YuNet face evidence for chapter QC")
    parser.add_argument("--video", required=True)
    parser.add_argument("--model", help="YuNet onnx 绝对路径;缺省走 video_qc 模型家")
    parser.add_argument("--samples", type=int, default=SAMPLES_PER_CHAPTER)
    parser.add_argument("--score-threshold", type=float, default=SCORE_THRESHOLD)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--at", help="逗号分隔秒数;给了它就只跑裁片模式(按这些时间点出人脸裁片),不再跑全章证据扫描")
    parser.add_argument("--crop-out", dest="crop_out", help="裁片落盘目录(绝对路径);裁片模式必填")
    args = parser.parse_args(argv)

    payload: dict[str, object] = {"schemaVersion": 1, "video": args.video, "model": MODEL_NAME}
    if args.at is not None and not args.crop_out:
        # 调用方接线错了,直说:静默退回证据扫描会让 L5 以为这章没有脸裁片证据
        payload.update({"status": "failed", "code": "crop-out-required", "message": "--at 必须配 --crop-out(裁片落盘目录)"})
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    try:
        import cv2
    except ImportError as error:
        payload.update({"status": "needs-runtime", "code": "cv2-missing", "message": str(error)})
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    try:
        version = getattr(cv2, "__version__", "")
        if args.at is None:
            body = scan_video(cv2, resolve_model_path(args.model), args.video, args.samples, args.score_threshold)
        else:
            stamps = parse_timestamps(args.at)
            Path(args.crop_out).mkdir(parents=True, exist_ok=True)
            body = crop_faces(cv2, resolve_model_path(args.model), args.video, stamps, args.crop_out)
        payload.update({"status": "ok", "model": f"yunet-face@cv2-{version}", **body})
    except FileNotFoundError as error:
        payload.update({"status": "needs-runtime", "code": "model-not-downloaded", "message": str(error)})
    except (subprocess.CalledProcessError, RuntimeError, ValueError, IndexError, cv2.error) as error:
        payload.update({"status": "needs-runtime", "code": "scan-failed", "message": str(error)[:400]})
    except Exception as error:  # 兜底:任何异常都不许让 QC 侧误读成「人脸查过没问题」
        payload.update({"status": "failed", "code": "face-error", "message": f"{type(error).__name__}: {error}"[:400]})

    print(json.dumps(payload, ensure_ascii=False))
    if not args.as_json and payload.get("status") == "ok" and "faceCount" in payload:
        print(
            f"人脸证据:检出帧 {payload['framesWithFace']}/{payload['framesRead']} "
            f"(覆盖率 {payload['coverage']}) / 脸 {payload['faceCount']} 张 "
            f"其中可辨 {payload['readableFaceCount']} / 漂移距离 p50={payload['driftDistanceP50']}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
