#!/usr/bin/env python3
"""
Legacy bypass: 将项目侧 voice WAV 混入 Remotion 章节 MP4。

背景：临时跳过 TTS 后分镜 MP4 音频为静音，需要通过 ffmpeg 把
项目配音 WAV 混入最终章节视频。

音频源约定（2026-08-29 对齐台账 v2，Trellis 08-28-workflow-model-path-integrity B4）：
- 物理文件：<项目根>/remotion/audio/<chapterId>/shots/<shotId>/voice/<sha256>.wav（内容寻址）
- 映射真源：<项目根>/remotion/audio-ledger/<chapterId>.json（shots[].audio.relativePath）
- 旧 exports/chapter-001/voice-audio/shot-XX.wav 不属于当前输入，不再读取

关键教训（2026-08-07）：
- 43 段独白不重叠（sequential），使用 amix:normalize=0 即可
- 切勿使用 volume=43 补偿！amix 对不重叠流不加 normalize 时已保持原音量
- volume=43 会导致削波失真（max_volume 达 0.0 dB 但波形已损坏）

用法：
  cd apps && python3 build/scripts/mix-voice-audio.py

前置：项目 remotion/jobs/chapter/<chapterId>/current-render-plan.json、
       remotion/audio-ledger/<chapterId>.json 和输入 MP4 存在；台账中的
       shots[].audio.relativePath 必须指向项目 remotion/audio/ 内容寻址文件
输出：项目 remotion/outputs/chapters/<chapterId>/current-with-voice.mp4
"""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any

# 项目实体在外部 IP/MA（注册表 location 权威；旧 _p 内部位已迁址,勿作主源）
DEFAULT_CHAPTER_ID = "chapter-001"
APPS_DIR = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class VoiceSource:
    """台账校验通过的项目内 voice 文件。"""

    shot_id: str
    manifest_index: int
    path: Path
    shot_start_us: int
    shot_duration_us: int


def resolve_project_root() -> Path:
    """按 ChapterVideo 同源规则解析当前项目，禁止硬编码旧项目目录。"""
    explicit = os.environ.get("MYSTUDIO_PROJECT_DIR", "").strip()
    if explicit:
        root = Path(explicit).expanduser().resolve()
    else:
        build_root = str(APPS_DIR)
        if build_root not in sys.path:
            sys.path.insert(0, build_root)
        from chapter_video.path_resolver import resolve_project_dir

        root = resolve_project_dir(required=True).resolve()
    if not root.is_dir():
        raise RuntimeError(f"项目目录不存在: {root}")
    if not (root / "remotion").is_dir():
        raise RuntimeError(f"项目缺少 remotion 工作区: {root}")
    return root


def resolve_inside(project_root: Path, relative_path: str, label: str) -> Path:
    """解析项目相对路径并拒绝绝对路径、路径穿越和符号链接逃逸。"""
    if not relative_path or os.path.isabs(relative_path):
        raise RuntimeError(f"{label} 必须是项目内相对路径: {relative_path!r}")
    root = project_root.resolve()
    resolved = (project_root / relative_path).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise RuntimeError(f"{label} 路径越界: {relative_path}") from error
    return resolved


def resolve_project_file(project_root: Path, value: str | Path, label: str) -> Path:
    """Resolve a configured file while keeping it under the project root."""
    raw = Path(value).expanduser()
    resolved = raw.resolve() if raw.is_absolute() else resolve_inside(project_root, str(raw), label)
    try:
        resolved.relative_to(project_root.resolve())
    except ValueError as error:
        raise RuntimeError(f"{label} 路径越界: {value}") from error
    return resolved


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_runtime_paths(project_root: Path, chapter_id: str) -> tuple[Path, Path, Path, Path]:
    """解析 ledger、render plan、输入和输出；环境变量只覆盖明确文件。"""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", chapter_id):
        raise RuntimeError(f"章节 ID 无效: {chapter_id!r}")
    defaults = {
        "ledger": project_root / "remotion" / "audio-ledger" / f"{chapter_id}.json",
        "plan": project_root / "remotion" / "jobs" / "chapter" / chapter_id / "current-render-plan.json",
        "input MP4": project_root / "remotion" / "outputs" / "chapters" / chapter_id / "current.mp4",
        "output MP4": project_root / "remotion" / "outputs" / "chapters" / chapter_id / "current-with-voice.mp4",
    }
    env_names = {
        "ledger": "MYSTUDIO_MIX_LEDGER_PATH",
        "plan": "MYSTUDIO_MIX_PLAN_PATH",
        "input MP4": "MYSTUDIO_MIX_INPUT_MP4",
        "output MP4": "MYSTUDIO_MIX_OUTPUT_MP4",
    }
    paths = {
        label: resolve_project_file(project_root, os.environ.get(env_name, "").strip() or default, label)
        for label, env_name in env_names.items()
        for default in [defaults[label]]
    }
    ledger = paths["ledger"]
    plan = paths["plan"]
    input_mp4 = paths["input MP4"]
    output_mp4 = paths["output MP4"]
    return ledger, plan, input_mp4, output_mp4


def load_ledger_voice_paths(project_root: Path, ledger_path: Path) -> dict[str, VoiceSource]:
    """Load only SHA-verified voice files from the current ``remotion/audio`` tree."""
    if not ledger_path.is_file():
        raise RuntimeError(f"audio ledger 不存在: {ledger_path}")
    try:
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"audio ledger 无法解析: {ledger_path}") from error
    shots = ledger.get("shots") if isinstance(ledger, dict) else None
    if not isinstance(shots, list):
        raise RuntimeError(f"audio ledger 缺少 shots 数组: {ledger_path}")
    mapping: dict[str, VoiceSource] = {}
    seen_indices: set[int] = set()
    for shot in shots:
        if not isinstance(shot, dict):
            raise RuntimeError("audio ledger shots 项必须是对象")
        audio = shot.get("audio")
        relative = audio.get("relativePath") if isinstance(audio, dict) else None
        shot_id = shot.get("shotId")
        manifest_index = shot.get("manifestIndex")
        declared_sha = audio.get("sha256") if isinstance(audio, dict) else None
        shot_start_us = shot.get("shotStartUs")
        shot_duration_us = shot.get("durationUs")
        if not isinstance(shot_id, str) or not shot_id.strip() or not isinstance(manifest_index, int) or manifest_index < 1:
            raise RuntimeError("audio ledger voice 条目缺少有效 shotId/manifestIndex")
        if shot_id in mapping or manifest_index in seen_indices:
            raise RuntimeError(f"audio ledger 存在重复 shotId/manifestIndex: {shot_id}")
        seen_indices.add(manifest_index)
        if not isinstance(shot_start_us, int) or shot_start_us < 0 or not isinstance(shot_duration_us, int) or shot_duration_us <= 0:
            raise RuntimeError(f"audio ledger 缺少有效时间轴: {shot_id}")
        normalized_relative = relative.replace("\\", "/") if isinstance(relative, str) else ""
        if not normalized_relative.startswith("remotion/audio/"):
            raise RuntimeError(f"voice 音频不在 remotion/audio 下: {relative!r}")
        if not isinstance(declared_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", declared_sha):
            raise RuntimeError(f"voice 音频缺少有效 sha256: {shot_id}")
        absolute = resolve_inside(project_root, normalized_relative, f"voice {shot_id}")
        audio_root = (project_root / "remotion" / "audio").resolve()
        try:
            absolute.relative_to(audio_root)
        except ValueError as error:
            raise RuntimeError(f"voice {shot_id} 路径越界: {relative}") from error
        if not absolute.is_file() or absolute.stat().st_size <= 0:
            raise RuntimeError(f"voice 音频不存在或为空: {absolute}")
        actual_sha = sha256_file(absolute)
        if actual_sha != declared_sha or absolute.stem != declared_sha:
            raise RuntimeError(f"voice 音频 SHA-256 不匹配: {absolute}")
        source = VoiceSource(
            shot_id=shot_id,
            manifest_index=manifest_index,
            path=absolute,
            shot_start_us=shot_start_us,
            shot_duration_us=shot_duration_us,
        )
        mapping[shot_id] = source
        mapping[f"index:{manifest_index}"] = source
    return mapping


def _clip_storyboard_id(clip: dict[str, Any]) -> str:
    source = clip.get("source")
    evidence = source.get("evidence") if isinstance(source, dict) else None
    shot_id = evidence.get("storyboardId") if isinstance(evidence, dict) else None
    if isinstance(shot_id, str) and shot_id.strip():
        return shot_id
    clip_id = clip.get("id")
    if isinstance(clip_id, str) and clip_id.startswith("voice-") and clip_id[6:]:
        return clip_id[6:]
    raise RuntimeError(f"voice clip 缺少 source.evidence.storyboardId: {clip.get('id')!r}")


def _source_for_clip(clip: dict[str, Any], ledger_paths: dict[str, VoiceSource]) -> VoiceSource | None:
    shot_id = _clip_storyboard_id(clip)
    source = ledger_paths.get(shot_id)
    if source is not None:
        return source
    clip_id = clip.get("id")
    if isinstance(clip_id, str):
        match = re.search(r"(\d+)$", clip_id)
        if match:
            return ledger_paths.get(f"index:{int(match.group(1))}")
    return None


def build_voice_clips(
    plan: dict[str, Any],
    ledger_paths: dict[str, VoiceSource],
) -> list[tuple[VoiceSource, int, int]]:
    """Build timed voice clips from an explicit audio plan or the ledger timeline."""
    raw_clips = plan.get("clips")
    if not isinstance(raw_clips, list):
        raise RuntimeError("render plan 缺少 clips 数组")
    explicit = [clip for clip in raw_clips if isinstance(clip, dict) and clip.get("trackKind") == "voice"]
    sources = sorted(
        {source.shot_id: source for key, source in ledger_paths.items() if not key.startswith("index:")}.values(),
        key=lambda source: source.manifest_index,
    )
    if not explicit:
        visual_by_shot: dict[str, dict[str, Any]] = {}
        for clip in raw_clips:
            if not isinstance(clip, dict) or clip.get("trackKind") not in {"video", "image"}:
                continue
            try:
                visual_by_shot[_clip_storyboard_id(clip)] = clip
            except RuntimeError:
                continue
        return [
            (
                source,
                int(visual_by_shot.get(source.shot_id, {}).get("startUs", source.shot_start_us)),
                int(visual_by_shot.get(source.shot_id, {}).get("durationUs", source.shot_duration_us)),
            )
            for source in sources
        ]

    result: list[tuple[VoiceSource, int, int]] = []
    for clip in explicit:
        shot_id = _clip_storyboard_id(clip)
        source = _source_for_clip(clip, ledger_paths)
        if source is None:
            raise RuntimeError(f"voice clip 在 audio ledger 中无对应 shot: {shot_id}")
        start_us = clip.get("startUs")
        duration_us = clip.get("durationUs")
        if not isinstance(start_us, int) or start_us < 0 or not isinstance(duration_us, int) or duration_us <= 0:
            raise RuntimeError(f"voice clip 时间轴无效: {clip.get('id')!r}")
        result.append((source, start_us, duration_us))
    return result


def main() -> None:
    project_root = resolve_project_root()
    chapter_id = (
        os.environ.get("MYSTUDIO_MIX_CHAPTER_ID", "").strip()
        or os.environ.get("MYSTUDIO_CHAPTER_ID", "").strip()
        or DEFAULT_CHAPTER_ID
    )
    ledger_path, plan_path, input_mp4, output_mp4 = resolve_runtime_paths(project_root, chapter_id)
    for path, name in [(plan_path, "plan"), (input_mp4, "input MP4")]:
        if not path.is_file():
            print(f"ERROR: {name} not found: {path}", file=sys.stderr)
            sys.exit(1)
    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"render plan 无法解析: {plan_path}") from error
    if not isinstance(plan, dict):
        raise RuntimeError("render plan 根节点必须是对象")

    ledger_paths = load_ledger_voice_paths(project_root, ledger_path)
    voice_clips = build_voice_clips(plan, ledger_paths)
    if not voice_clips:
        print("No voice clips found in plan or audio ledger.")
        return

    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []

    for i, (source, start_us, duration_us) in enumerate(voice_clips):
        start_sec = start_us / 1_000_000
        duration_sec = duration_us / 1_000_000
        delay_ms = int(start_sec * 1000)

        inputs.extend(["-i", str(source.path)])
        # Sequential clips, no overlap — atrim to exact duration, adelay to position
        filters.append(
            f"[{i + 1}:a]atrim=0:{duration_sec},adelay={delay_ms}|{delay_ms}[v{i}]"
        )
        labels.append(f"[v{i}]")

    count = len(labels)
    # normalize=0: no peak normalization; each stream keeps original level
    # No volume boost needed — amix sums non-overlapping silent+signal cleanly
    filter_parts = ";".join([
        *filters,
        f"{''.join(labels)}amix=inputs={count}:duration=longest:normalize=0[audio]",
    ])

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_mp4),
        *inputs,
        "-filter_complex", filter_parts,
        "-map", "0:v",
        "-map", "[audio]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "320k",
        "-shortest",
        str(output_mp4),
    ]

    if output_mp4.resolve() == input_mp4.resolve():
        raise RuntimeError("输出 MP4 不得覆盖输入 MP4")
    output_mp4.parent.mkdir(parents=True, exist_ok=True)
    print(f"Mixing {count} voice tracks (normalize=0, no boost)...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        err_lines = result.stderr.strip().split("\n")
        print("ERROR:", "\n".join(err_lines[-8:]), file=sys.stderr)
        sys.exit(1)

    size_mb = output_mp4.stat().st_size / 1024 / 1024
    print(f"OK: {output_mp4} ({size_mb:.1f} MB)")

    # Quick volume check
    vol = subprocess.run(
        ["ffmpeg", "-i", str(output_mp4), "-af", "volumedetect", "-f", "null", "/dev/null"],
        capture_output=True, text=True,
    )
    for line in vol.stderr.split("\n"):
        if "volume" in line:
            print(line.strip())


if __name__ == "__main__":
    main()
