"""video_use 共享底座——错误类型/参数微工具/ffmpeg 执行原语(测试 patch 目标所在)。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


class VideoUseAdapterError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
def _require_absolute_file(value: Any, field: str) -> Path:
    path = Path(str(value or "")).expanduser()
    if not path.is_absolute():
        raise VideoUseAdapterError("path-not-absolute", f"{field} 必须是绝对路径")
    if not path.is_file():
        raise VideoUseAdapterError("media-missing", f"{field} 文件不存在: {path}")
    return path
def _require_sha(value: Any, field: str) -> str:
    sha = str(value or "")
    if len(sha) != 64 or any(char not in "0123456789abcdef" for char in sha):
        raise VideoUseAdapterError("sha-invalid", f"{field} 必须是 64 位小写 SHA-256")
    return sha
def _seconds(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise VideoUseAdapterError("duration-invalid", f"{field} 必须是数字") from error
    if number <= 0 or number != number or number == float("inf"):
        raise VideoUseAdapterError("duration-invalid", f"{field} 必须大于 0")
    return number
def _tool_env(ffmpeg_path: str, ffprobe_path: str) -> dict[str, str]:
    ffmpeg = Path(ffmpeg_path).expanduser()
    ffprobe = Path(ffprobe_path).expanduser()
    if not ffmpeg.is_absolute() or not ffprobe.is_absolute():
        raise VideoUseAdapterError("shared-tool-path-invalid", "FFmpeg/ffprobe 必须传入同一组绝对路径")
    if not ffmpeg.is_file() or not ffprobe.is_file():
        raise VideoUseAdapterError("shared-tool-missing", "共享 FFmpeg/ffprobe 文件不存在")
    env = os.environ.copy()
    tool_directories = [str(ffmpeg.parent), str(ffprobe.parent)]
    env["MYSTUDIO_FFMPEG_PATH"] = str(ffmpeg)
    env["MYSTUDIO_FFPROBE_PATH"] = str(ffprobe)
    env["PATH"] = os.pathsep.join([*tool_directories, env.get("PATH", "")])
    # Remotion's macOS compositor may load dylibs beside its bundled FFmpeg.
    # The Electron parent injects this path too, but the Python worker creates
    # another subprocess for the pinned helper and must preserve the same
    # shared-toolchain contract when invoked directly or through a retry.
    if sys.platform == "darwin":
        env["DYLD_LIBRARY_PATH"] = os.pathsep.join([
            *tool_directories,
            env.get("DYLD_LIBRARY_PATH", ""),
        ])
    return env
def _run_helper(helper: Path, args: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    if not helper.is_file():
        raise VideoUseAdapterError("upstream-helper-missing", f"缺少 helper: {helper}")
    try:
        subprocess.run(
            [sys.executable, str(helper), *args],
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=45 * 60,
        )
    except subprocess.TimeoutExpired as error:
        raise VideoUseAdapterError("upstream-helper-timeout", f"helper 超时: {helper.name}") from error
    except subprocess.CalledProcessError as error:
        raise VideoUseAdapterError("upstream-helper-failed", f"helper 执行失败: {helper.name} (exit={error.returncode})") from error
def _probe_output(
    path: Path,
    ffprobe_path: str,
    *,
    env: dict[str, str] | None = None,
) -> tuple[float, list[str]]:
    try:
        result = subprocess.run(
            [ffprobe_path, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=60,
            env=env if env is not None else _tool_env(ffprobe_path, ffprobe_path),
        )
        payload = json.loads(result.stdout)
        duration = float((payload.get("format") or {}).get("duration") or 0.0)
        streams = [str(stream.get("codec_type")) for stream in payload.get("streams", []) if isinstance(stream, dict) and stream.get("codec_type")]
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError) as error:
        raise VideoUseAdapterError("output-probe-failed", f"输出 ffprobe 失败: {path.name}") from error
    if duration <= 0 or not streams:
        raise VideoUseAdapterError("output-invalid", f"输出媒体缺少有效时长或 streams: {path.name}")
    return duration, streams
def _probe_media_duration(
    path: Path,
    ffprobe_path: str,
    *,
    env: dict[str, str] | None = None,
) -> float:
    """Read one media duration through the shared ffprobe executable."""
    try:
        result = subprocess.run(
            [ffprobe_path, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=60,
            env=env if env is not None else _tool_env(ffprobe_path, ffprobe_path),
        )
        duration = float(result.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise VideoUseAdapterError("input-duration-probe-failed", f"输入媒体时长探针失败: {path.name}") from error
    if duration <= 0 or duration != duration or duration == float("inf"):
        raise VideoUseAdapterError("input-duration-invalid", f"输入媒体时长无效: {path.name}")
    return duration
