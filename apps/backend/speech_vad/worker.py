"""语音活动检测(Silero VAD)worker — 成片「台词可懂」门的实际侧语音口径。

为什么不用 ffmpeg silencedetect:带 BGM 的章节成片里 -35dB 阈值恒不触发。
1031 本机实测(/tmp/finalfix_output.mp4,197.12s,I=-14.1 LUFS):
  silencedetect -35dB/0.8s → 死寂段 1 个 0.95s ⇒ 反推「语音」196.17s(等于全程在说话)
  Silero VAD threshold=0.5 → 语音段 48 个 146.08s(占比 74.1%;
                             speech_pad_ms=30 / min_speech_duration_ms=120 / min_silence_duration_ms=200)
两者差 50.09s 全是被 BGM 掩盖掉的语音窗——语音挤压/音画同步都吃这个补集,
所以补集错 = 这两条子项静默退化成不报(docs/comfyui-kb/分镜H3视频产线.md §九.六 反过度声称③)。

运行(silero-vad 走 apps/backend/requirements.txt,由设置页「Python 运行环境」装进 managed Python):
  "<storageBase>/python/bin/python3" -m speech_vad.worker \
      --video <mp4> [--threshold 0.5] [--json]

失败语义:依赖缺/抽轨失败一律回 `status=needs-runtime` 的 JSON 且退出码 0——
调用方(QC 层)按「无 VAD 证据」处理,不许把它当成「没有语音问题」。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import wave
from io import BytesIO

SAMPLE_RATE = 16_000
MODEL_TAG = "silero-vad"


def extract_mono16k(video_path: str) -> bytes:
    """ffmpeg 抽 16kHz 单声道 wav 字节(VAD 只吃这个口径)。"""
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", video_path,
            "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", "-",
        ],
        capture_output=True,
        check=True,
    )
    return proc.stdout


def pcm_to_tensor(wav_bytes: bytes):
    import torch

    with wave.open(BytesIO(wav_bytes), "rb") as handle:
        frames = handle.readframes(handle.getnframes())
    samples = torch.frombuffer(bytearray(frames), dtype=torch.int16).float() / 32768.0
    return samples


def segments_to_seconds(stamps, sampling_rate: int = SAMPLE_RATE):
    """帧号段 → 秒段(与 TS 侧 ChapterQcVadSegment 同形状,保留 3 位小数)。"""
    return [
        {
            "startS": round(int(seg["start"]) / sampling_rate, 3),
            "endS": round(int(seg["end"]) / sampling_rate, 3),
        }
        for seg in stamps
    ]


def speech_seconds(segments) -> float:
    return round(sum(max(0.0, seg["endS"] - seg["startS"]) for seg in segments), 3)


def media_duration(path: str) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", path,
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return float(out)


def run_vad(video_path: str, threshold: float):
    """返回 (segments, model_version);依赖缺则抛 ImportError,由 main() 兜成 needs-runtime。"""
    from silero_vad import get_speech_timestamps, load_silero_vad

    model = load_silero_vad()
    audio = pcm_to_tensor(extract_mono16k(video_path))
    stamps = get_speech_timestamps(
        audio,
        model,
        sampling_rate=SAMPLE_RATE,
        threshold=threshold,
        speech_pad_ms=30,
        min_speech_duration_ms=120,
        min_silence_duration_ms=200,
    )
    version = ""
    try:  # silero-vad 包版本号留审计(6.2.3 起参数名是 threshold,不是 conf_threshold)
        import silero_vad

        version = getattr(silero_vad, "__version__", "")
    except Exception:  # pragma: no cover - 版本号取不到不影响判定
        version = ""
    return segments_to_seconds(stamps), version


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Silero VAD speech segments for chapter QC")
    parser.add_argument("--video", required=True)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)

    payload: dict[str, object] = {
        "schemaVersion": 1,
        "video": args.video,
        "threshold": args.threshold,
        "sampleRate": SAMPLE_RATE,
    }
    try:
        total = media_duration(args.video)
        segments, version = run_vad(args.video, args.threshold)
        payload.update(
            {
                "status": "ok",
                "durationS": round(total, 3),
                "model": f"{MODEL_TAG}@{version}" if version else MODEL_TAG,
                "segments": segments,
                "speechSeconds": speech_seconds(segments),
            }
        )
    except ImportError as error:
        payload.update({"status": "needs-runtime", "code": "module-missing", "message": str(error),
                        "segments": [], "speechSeconds": 0.0})
    except subprocess.CalledProcessError as error:
        payload.update({"status": "needs-runtime", "code": "av-tool-failed",
                        "message": (error.stderr or b"").decode()[-400:] if isinstance(error.stderr, bytes)
                        else str(error)[-400:],
                        "segments": [], "speechSeconds": 0.0})
    except Exception as error:  # 兜底:任何异常都不许让 QC 侧误判为「查过没问题」
        payload.update({"status": "failed", "code": "vad-error", "message": f"{type(error).__name__}: {error}",
                        "segments": [], "speechSeconds": 0.0})

    print(json.dumps(payload, ensure_ascii=False))
    if not args.as_json and payload.get("status") == "ok":
        print(
            f"语音段 {len(payload['segments'])} 个 / {payload['speechSeconds']:.2f}s "
            f"(占比 {payload['speechSeconds'] / payload['durationS'] * 100:.1f}%)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
