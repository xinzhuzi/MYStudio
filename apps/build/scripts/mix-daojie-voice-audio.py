#!/usr/bin/env python3
"""
DaOJie bypass: 将旧流水线 voice-audio/WAV 文件混入 Remotion 章节 MP4。

背景：临时跳过 TTS 后分镜 MP4 音频为静音，需要通过 ffmpeg 把
旧 toonflow_audio 的 WAV 混入最终章节视频。

关键教训（2026-08-07）：
- 43 段独白不重叠（sequential），使用 amix:normalize=0 即可
- 切勿使用 volume=43 补偿！amix 对不重叠流不加 normalize 时已保持原音量
- volume=43 会导致削波失真（max_volume 达 0.0 dB 但波形已损坏）

用法：
  cd apps && python3 build/scripts/mix-daojie-voice-audio.py

前置：timeline-render-plan.json 与 voice-audio/*.wav 存在
输出：apps/output/automation/daojie-chapter001-timeline/remotion/output-with-audio.mp4
"""

import json
import subprocess
import os
import sys

PROJECT_DIR = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0"
APPS_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLAN_PATH = os.path.join(APPS_DIR, "output", "automation", "daojie-chapter001-timeline", "timeline-render-plan.json")
VOICE_DIR = os.path.join(PROJECT_DIR, "exports", "chapter-001", "voice-audio")
INPUT_MP4 = os.path.join(APPS_DIR, "output", "automation", "daojie-chapter001-timeline", "remotion", "output.mp4")
OUTPUT_MP4 = os.path.join(APPS_DIR, "output", "automation", "daojie-chapter001-timeline", "remotion", "output-with-audio.mp4")


def main() -> None:
    for path, name in [(PLAN_PATH, "plan"), (INPUT_MP4, "input MP4")]:
        if not os.path.exists(path):
            print(f"ERROR: {name} not found: {path}", file=sys.stderr)
            sys.exit(1)

    with open(PLAN_PATH) as f:
        plan = json.load(f)

    voice_clips = [c for c in plan["clips"] if c.get("trackKind") == "voice"]
    if not voice_clips:
        print("No voice clips found in plan.")
        sys.exit(0)

    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []

    for i, vc in enumerate(voice_clips):
        shot_num = vc["id"].rsplit("-", 1)[-1]
        wav_path = os.path.join(VOICE_DIR, f"shot-{shot_num}.wav")
        if not os.path.exists(wav_path):
            print(f"SKIP missing: {wav_path}", file=sys.stderr)
            continue

        start_sec = vc["startUs"] / 1_000_000
        duration_sec = vc["durationUs"] / 1_000_000
        delay_ms = int(start_sec * 1000)

        inputs.extend(["-i", wav_path])
        # Sequential clips, no overlap — atrim to exact duration, adelay to position
        filters.append(
            f"[{i + 1}:a]atrim=0:{duration_sec},adelay={delay_ms}|{delay_ms}[v{i}]"
        )
        labels.append(f"[v{i}]")

    count = len(labels)
    # normalize=0: no peak normalization; each stream keeps original level
    # No volume boost needed — amix sums non-overlapping silent+signal cleanly
    filter_parts = ";".join(filters)
    filter_parts += f";{''.join(labels)}amix=inputs={count}:duration=longest:normalize=0[audio]"

    cmd = [
        "ffmpeg", "-y",
        "-i", INPUT_MP4,
        *inputs,
        "-filter_complex", filter_parts,
        "-map", "0:v",
        "-map", "[audio]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "320k",
        "-shortest",
        OUTPUT_MP4,
    ]

    print(f"Mixing {count} voice tracks (normalize=0, no boost)...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        err_lines = result.stderr.strip().split("\n")
        print("ERROR:", "\n".join(err_lines[-8:]), file=sys.stderr)
        sys.exit(1)

    size_mb = os.path.getsize(OUTPUT_MP4) / 1024 / 1024
    print(f"OK: {OUTPUT_MP4} ({size_mb:.1f} MB)")

    # Quick volume check
    vol = subprocess.run(
        ["ffmpeg", "-i", OUTPUT_MP4, "-af", "volumedetect", "-f", "null", "/dev/null"],
        capture_output=True, text=True,
    )
    for line in vol.stderr.split("\n"):
        if "volume" in line:
            print(line.strip())


if __name__ == "__main__":
    main()
