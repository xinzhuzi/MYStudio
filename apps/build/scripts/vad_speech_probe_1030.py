"""语音段探针:Silero VAD vs silencedetect 同片对照(1030 吸收件②)。

立口径背景:docs/comfyui-kb/分镜H3视频产线.md §九.六 反过度声称③——
带 BGM 的成片里 silencedetect(-35dB) 恒不触发,「无死寂段」被当成「台词可懂」,
而 L2 的语音挤压/音画同步实际侧正是吃 silencedetect 的补集,等于静默退化。

运行(silero-vad 装在同一支 managed Python,即设置页「开始配置」那条路径):
  "<storageBase>/python/bin/python3" \
      apps/build/scripts/vad_speech_probe_1030.py <mp4> [--json]

输出口径:
  - 语音段起止(秒)/总语音时长/段数;
  - 同时跑一遍 ffmpeg silencedetect(-35dB:d=0.8) 作对照,直接给出「补集差多少秒」;
  - --json 落机器可读结果,供后续接线(阈值与判据本批仍先记不判)。
"""

import json
import re
import subprocess
import sys
import wave

import torch
from silero_vad import load_silero_vad, get_speech_timestamps

path = sys.argv[1]
as_json = "--json" in sys.argv[2:]

SR = 16_000


def extract_wav(src: str) -> bytes:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", src,
         "-ac", "1", "-ar", str(SR), "-f", "wav", "-"],
        capture_output=True, check=True,
    )
    return proc.stdout


def wav_pcm(wav_bytes: bytes):
    with wave.open(__import__("io").BytesIO(wav_bytes), "rb") as handle:
        frames = handle.readframes(handle.getnframes())
    return torch.frombuffer(bytearray(frames), dtype=torch.int16).float() / 32768.0


def silencedetect(src: str, noise_db: str, min_s: float):
    stderr = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", src,
         "-af", f"silencedetect=noise={noise_db}:d={min_s}", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    starts = [float(v) for v in re.findall(r"silence_start:\s*(-?[0-9.]+)", stderr)]
    ends = [float(v) for v in re.findall(r"silence_end:\s*(-?[0-9.]+)", stderr)]
    return [{"startS": s, "endS": e} for s, e in zip(starts, ends)]


def duration(src: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", src],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


total_s = duration(path)
model = load_silero_vad()
audio = wav_pcm(extract_wav(path))

thresholds = {"0.5": 0.5, "0.35": 0.35}
per_threshold = {}
for label, threshold in thresholds.items():
    stamps = get_speech_timestamps(
        audio, model, sampling_rate=SR,
        threshold=threshold, speech_pad_ms=30, min_speech_duration_ms=120,
    )
    segments = [{"startS": round(s["start"] / SR, 3), "endS": round(s["end"] / SR, 3)} for s in stamps]
    per_threshold[label] = {
        "segments": segments,
        "speechSeconds": round(sum(s["endS"] - s["startS"] for s in segments), 3),
    }

silences = silencedetect(path, "-35dB", 0.8)
silence_seconds = round(sum(s["endS"] - s["startS"] for s in silences), 3)

result = {
    "video": path,
    "durationS": total_s,
    "sampleRate": SR,
    "vad": per_threshold,
    "silencedetect": {"noise": "-35dB", "minS": 0.8, "segments": silences, "silenceSeconds": silence_seconds},
    "speechSecondsBySilencedetect": round(total_s - silence_seconds, 3),
}

if as_json:
    print(json.dumps(result, ensure_ascii=False))
else:
    for label, data in per_threshold.items():
        print(f"silero conf={label:<4} 语音段 {len(data['segments']):>3} 个 / "
              f"{data['speechSeconds']:>7.2f}s ({data['speechSeconds'] / total_s * 100:.1f}% 占比)")
    print(f"silencedetect -35dB/0.8s 死寂段 {len(silences):>3} 个 / {silence_seconds:>7.2f}s → "
          f"反推语音 {result['speechSecondsBySilencedetect']:.2f}s")
    gap = result["vad"]["0.5"]["speechSeconds"] - result["speechSecondsBySilencedetect"]
    print(f"口径差(VAD0.5 - silencedetect 补集)= {gap:+.2f}s —— 差值即 silencedetect 被 BGM 掩盖掉的语音窗")
