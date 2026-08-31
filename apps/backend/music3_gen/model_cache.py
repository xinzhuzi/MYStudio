"""Music3 model cache helpers for Pocket HF and mlx-serve layouts.

The legacy Pocket route is a self-contained HF snapshot.  The current MYStudio
route is a converted mlx-serve pack with five root safetensors and tokenizer
directories.  Both layouts are detected explicitly and incomplete downloads
fail closed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TypedDict

MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".npz", ".mlx")

MUSIC3_FLAT_WEIGHTS = (
    "language_model.safetensors",
    "rvq_depth_decoder.safetensors",
    "transformer.safetensors",
    "condition_encoder.safetensors",
    "vocoder.safetensors",
)
MUSIC3_FLAT_DIRS = ("tokenizer", "music_tokenizer")

MIN_MUSIC3_DURATION_S = 10.0
MAX_MUSIC3_DURATION_S = 300.0


class Music3HardwareReqs(TypedDict):
    """目录条目的硬件要求——不同平台按硬件选择不同模型(08-19 用户裁定)。"""

    engine: str
    platforms: tuple[str, ...]
    arch: tuple[str, ...]


class Music3ModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str
    description: str
    engine: str
    enabled: bool
    requires: Music3HardwareReqs


# 自含仓库:权重+生成脚本一体(int8 量化 MLX)。mlx-community/mxfp8 裸权重
# 为二期换装候选(同架构,需核 manifest)——见任务 PRD 选型记录。
MUSIC3_MODELS: dict[str, Music3ModelSpec] = {
    "minimax-music3-mlx": {
        "label": "MiniMax-Music3(MLX 整曲引擎)",
        "repo_id": "PocketAiHub/MiniMax-Music3-MLX",
        "repo_ids": ("PocketAiHub/MiniMax-Music3-MLX",),
        "size_mb": 28500,
        "license": "MiniMax-Music3 Community License",
        "description": "本地整曲 BGM 生成(10-300 秒/立体声 WAV,44.1kHz,bf16 mlx-serve 权重,[Instrumental] 纯音乐,原生种子确定性;下载约 28.5 GB)",
        "engine": "mlx-serve",
        "enabled": True,
        "requires": {"engine": "mlx", "platforms": ("darwin",), "arch": ("arm64",)},
    },
}

# 平台×模型矩阵(展示口径):官方路线(SGLang-Omni,需 2× NVIDIA CUDA GPU)由
# 官方仓自行部署,本应用不代管;Intel Mac/无 GPU 无可用整曲模型。
MUSIC3_PLATFORM_MATRIX: list[dict[str, str]] = [
    {"platform": "Apple Silicon(macOS arm64)", "model": "MiniMax-Music3-MLX 自含仓(本应用)", "runnable": "可运行"},
    {"platform": "NVIDIA Linux/Windows(2× CUDA)", "model": "官方仓 SGLang-Omni 路线", "runnable": "本应用不提供,官方仓自行部署"},
    {"platform": "Intel Mac / 无 GPU", "model": "无可用整曲模型", "runnable": "不可用"},
]


class Music3HardwareProfile(TypedDict):
    platform: str
    machine: str
    mlxImportable: bool


class Music3Availability(TypedDict):
    available: bool
    reason: str


def detect_hardware_profile() -> Music3HardwareProfile:
    import platform as platform_module
    import importlib.util

    machine = platform_module.machine().lower()
    if machine == "aarch64":
        machine = "arm64"
    try:
        importlib.util.find_spec("mlx.core")
        mlx_importable = True
    except (ImportError, ModuleNotFoundError, ValueError):
        mlx_importable = False
    return {
        "platform": sys.platform,
        "machine": machine,
        "mlxImportable": mlx_importable,
    }


def evaluate_availability(
    spec: Music3ModelSpec, profile: Music3HardwareProfile | None = None
) -> Music3Availability:
    host = profile or detect_hardware_profile()
    requires = spec["requires"]
    if host["platform"] not in requires["platforms"] or host["machine"] not in requires["arch"]:
        return {
            "available": False,
            "reason": (
                f"本条目为 Apple Silicon(MLX)移植版,需要 macOS + arm64;"
                f"当前宿主 {host['platform']}/{host['machine']}。"
                "NVIDIA 双卡宿主请走官方仓 SGLang-Omni 路线(本应用不代管)。"
            ),
        }
    if requires["engine"] == "mlx" and not host["mlxImportable"]:
        return {
            "available": False,
            "reason": "MLX 依赖不可用(需随 Python 运行环境安装 mlx)",
        }
    return {"available": True, "reason": ""}



class CachedMusic3Model(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float
    layout: str


def primary_hf_cache_dir() -> Path:
    env_cache = (
        os.environ.get("MYSTUDIO_MUSIC3_MODEL_DIR")
        or os.environ.get("HF_HUB_CACHE")
    )
    if env_cache:
        return Path(env_cache).expanduser()
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home).expanduser() / "hub"
    try:
        from huggingface_hub import constants as hf_constants

        return Path(hf_constants.HF_HUB_CACHE).expanduser()
    except Exception:
        return Path.home() / ".cache" / "huggingface" / "hub"


def hf_cache_dirs() -> list[Path]:
    candidates: list[Path] = []
    for env_name in ("MYSTUDIO_MUSIC3_MODEL_DIR", "HF_HUB_CACHE"):
        value = os.environ.get(env_name)
        if value:
            candidates.append(Path(value))
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        candidates.append(Path(hf_home))
        candidates.append(Path(hf_home) / "hub")
    candidates.extend(
        [
            Path.home() / ".cache" / "huggingface",
            Path.home() / ".cache" / "huggingface" / "hub",
            Path.home() / "Library" / "Caches" / "huggingface",
            Path.home() / "Library" / "Caches" / "huggingface" / "hub",
        ]
    )
    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        expanded = path.expanduser()
        if str(expanded) in seen:
            continue
        seen.add(str(expanded))
        unique.append(expanded)
    return unique


def repo_cache_name(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def repo_cache_dir(repo_id: str, cache_dir: Path | None = None) -> Path:
    return (cache_dir or primary_hf_cache_dir()) / repo_cache_name(repo_id)


def _snapshot_dir(repo: Path) -> Path | None:
    """HF snapshot 布局:<repo>/snapshots/<rev>/;取最新修改的那个。"""
    snapshots = repo / "snapshots"
    if not snapshots.is_dir():
        return None
    revisions = [p for p in snapshots.iterdir() if p.is_dir()]
    if not revisions:
        return None
    return max(revisions, key=lambda p: p.stat().st_mtime)


def _has_complete_music3(repo: Path) -> bool:
    snapshot = _snapshot_dir(repo)
    if snapshot is None:
        return False
    blobs_dir = repo / "blobs"
    if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
        return False
    if any(path.is_file() and path.name.endswith(".incomplete") for path in snapshot.rglob("*")):
        return False
    # 自含运行时文件在场
    for required in ("generate.py", "minimax_mlx_model.py", "model_manifest.json"):
        if not (snapshot / required).is_file():
            return False
    # 权重目录非空(diffusion_models/text_encoders/vae)
    has_weights = any(
        any(file.is_file() for file in (snapshot / weight_dir).rglob("*"))
        for weight_dir in ("diffusion_models", "text_encoders", "vae")
    )
    return has_weights


def _has_complete_music3_flat(root: Path) -> bool:
    """mlx-serve converted layout: five root safetensors + config/tokenizers."""
    if not root.is_dir() or (root / ".incomplete").exists():
        return False
    if any(path.is_file() and path.name.endswith(".incomplete") for path in root.rglob("*")):
        return False
    if not (root / "config.json").is_file() or (root / "config.json").stat().st_size == 0:
        return False
    for name in MUSIC3_FLAT_WEIGHTS:
        path = root / name
        if not path.is_file() or path.stat().st_size == 0:
            return False
    return all((root / name).is_dir() for name in MUSIC3_FLAT_DIRS)


def _flat_music3_dirs(cache_dir: Path) -> list[Path]:
    """Known MYStudio model roots; keep HF cache probing separate."""
    return [
        cache_dir,
        cache_dir / "music3-mlxserv-bf16",
        cache_dir / "minimax" / "music3-mlxserv-bf16",
        cache_dir / "model" / "minimax" / "music3-mlxserv-bf16",
    ]


def _cache_size_mb(repo: Path) -> float:
    size = sum(
        file.stat().st_size
        for file in repo.rglob("*")
        if file.is_file() and not file.name.endswith(".incomplete")
    )
    return round(size / 1024 / 1024, 2)


def find_cached_music3_model(repo_ids: tuple[str, ...]) -> CachedMusic3Model | None:
    for cache_dir in hf_cache_dirs():
        for flat_dir in _flat_music3_dirs(cache_dir):
            if _has_complete_music3_flat(flat_dir):
                return {
                    "repo_id": repo_ids[0] if repo_ids else "",
                    "cache_dir": str(cache_dir),
                    "repo_cache_dir": str(flat_dir),
                    "size_mb": _cache_size_mb(flat_dir),
                    "layout": "mlxserv",
                }
        for repo_id in repo_ids:
            repo = repo_cache_dir(repo_id, cache_dir)
            if _has_complete_music3(repo):
                return {
                    "repo_id": repo_id,
                    "cache_dir": str(cache_dir),
                    "repo_cache_dir": str(_snapshot_dir(repo)),
                    "size_mb": _cache_size_mb(repo),
                    "layout": "pocket",
                }
    return None
