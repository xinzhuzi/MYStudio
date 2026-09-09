"""model_cache_core — 后端 model_cache 共享核。

08-31 arch-coupling-governance 子任务 backend-model-cache-core 交付物。
九包 model_cache.py 曾各自复制粘贴;本模块收敛两族缓存形态的公共骨架,
各包保留薄封装与对外签名,行为(env 表/候选目录顺序/完备性谓词)逐包不变。

族一:HF blob/snapshot 缓存(tts/depth_estimation/audio_gen/music3_gen/sfx_gen)
  主目录 env 链 → HF_HOME/hub → huggingface_hub 常量 → ~/.cache/huggingface/hub;
  repo 目录名 models--<org>--<name>;快照完备性=无 .incomplete+有权重扩展名。

族二:平铺单文件+sha256 pin(upscale/video_qc)
  候选目录列表内找 <file>,pin 非空则强校验指纹,空 pin 只验存在与大小。

各包 env 表是 Electron spawn 侧注入的行为契约(增删须过对拍):
  tts      = MANYING_TTS_MODELS_DIR, VOICEBOX_MODELS_DIR, HF_HUB_CACHE
  depth    = MYSTUDIO_DEPTH_MODEL_DIR(主)/ 多候选再加 tts 两 env+HF_HUB_CACHE
  upscale  = MYSTUDIO_UPSCALE_MODEL_DIR
  video_qc = MYSTUDIO_VIDEO_QC_MODEL_DIR

注意:image_gen 走 engines/ thin dispatcher(08-31 引擎分离),不接本核。
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

DEFAULT_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx")


# ── 族一:HF blob/snapshot 缓存 ────────────────────────────────────────────

def unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []
    for path in paths:
        key = str(path.expanduser())
        if key in seen:
            continue
        seen.add(key)
        unique.append(path.expanduser())
    return unique


def with_hub_subdir(paths: list[Path]) -> list[Path]:
    expanded: list[Path] = []
    for path in paths:
        expanded.append(path)
        if path.name != "hub":
            expanded.append(path / "hub")
    return expanded


def primary_hf_cache_dir(env_names: Sequence[str]) -> Path:
    for env_name in env_names:
        env_cache = os.environ.get(env_name)
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


def download_hf_cache_dir(env_names: Sequence[str]) -> Path:
    cache_dir = primary_hf_cache_dir(env_names)
    if cache_dir.name == "huggingface":
        return cache_dir / "hub"
    if cache_dir.name != "hub" and (cache_dir / "hub").exists():
        return cache_dir / "hub"
    return cache_dir


def hf_cache_dirs(
    env_names: Sequence[str],
    *,
    probe_hf_constants: bool = True,
    expand_hub_subdir: bool = True,
) -> list[Path]:
    """多候选缓存目录。

    probe_hf_constants/expand_hub_subdir 保留两包既有差异:
    tts 原实现两者皆开;depth_estimation 原实现两者皆关(纯静态候选+去重)。
    """
    candidates: list[Path] = []
    for env_name in env_names:
        value = os.environ.get(env_name)
        if value:
            candidates.append(Path(value))

    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        candidates.append(Path(hf_home))
        candidates.append(Path(hf_home) / "hub")

    if probe_hf_constants:
        try:
            from huggingface_hub import constants as hf_constants

            hf_hub_cache = Path(hf_constants.HF_HUB_CACHE)
            candidates.append(hf_hub_cache)
            candidates.append(hf_hub_cache.parent)
        except Exception:
            pass

    candidates.extend(
        [
            Path.home() / ".cache" / "huggingface",
            Path.home() / ".cache" / "huggingface" / "hub",
            Path.home() / "Library" / "Caches" / "huggingface",
            Path.home() / "Library" / "Caches" / "huggingface" / "hub",
        ]
    )
    if expand_hub_subdir:
        return unique_paths(with_hub_subdir(candidates))
    return unique_paths(candidates)


def repo_cache_name(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def repo_cache_dir(repo_id: str, cache_dir: Path) -> Path:
    return cache_dir / repo_cache_name(repo_id)


def cache_size_mb(cache: Path) -> float:
    size = sum(
        file.stat().st_size
        for file in cache.rglob("*")
        if file.is_file() and not file.name.endswith(".incomplete")
    )
    return round(size / 1024 / 1024, 2)


def has_weight_files(cache: Path, extensions: Sequence[str] = DEFAULT_WEIGHT_EXTENSIONS) -> bool:
    if not cache.exists():
        return False
    blobs_dir = cache / "blobs"
    if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
        return False
    snapshots_dir = cache / "snapshots"
    if not snapshots_dir.exists():
        return False
    return any(
        file.is_file()
        for extension in extensions
        for file in snapshots_dir.rglob(f"*{extension}")
    )


def has_required_files(cache: Path, required_files: Sequence[str]) -> bool:
    """无权重文件仓库(如 tokenizer)的完备性:快照内必需文件齐全且无 .incomplete。"""
    if not required_files:
        return False
    snapshots_dir = cache / "snapshots"
    if not snapshots_dir.exists() or any(cache.glob("blobs/*.incomplete")):
        return False
    for snapshot in snapshots_dir.iterdir():
        if snapshot.is_dir() and all((snapshot / relative).is_file() for relative in required_files):
            return True
    return False


@dataclass(frozen=True)
class WeightRepoHit:
    repo_id: str
    cache_dir: Path
    repo_cache_dir: Path
    size_mb: float


def find_weight_repo(
    repo_ids: tuple[str, ...],
    cache_dirs: list[Path],
    is_complete: Callable[[Path], bool] = has_weight_files,
) -> WeightRepoHit | None:
    for cache_dir in cache_dirs:
        for repo_id in repo_ids:
            cache = repo_cache_dir(repo_id, cache_dir)
            if is_complete(cache):
                return WeightRepoHit(repo_id, cache_dir, cache, cache_size_mb(cache))
    return None


def has_repo_files(
    repo_id: str,
    required_files: tuple[str, ...],
    cache_dirs: list[Path],
) -> bool:
    return any(
        has_required_files(repo_cache_dir(repo_id, cache_dir), required_files)
        for cache_dir in cache_dirs
    )


# ── 族二:平铺单文件 + sha256 pin ─────────────────────────────────────────

@dataclass(frozen=True)
class PinnedFileHit:
    file_path: Path
    size_mb: float
    sha256: str


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_pinned_file(
    candidate_dirs: list[Path],
    filename: str,
    sha256: str,
    *,
    allow_empty_pin: bool = False,
) -> PinnedFileHit | None:
    """在候选目录中找 <filename>;pin 非空须指纹一致,空 pin(allow_empty_pin)只验存在与大小。"""
    for model_dir in candidate_dirs:
        path = model_dir / filename
        if not path.is_file() or path.stat().st_size <= 0:
            continue
        if sha256:
            try:
                if file_sha256(path) != sha256:
                    continue
            except OSError:
                continue
        elif not allow_empty_pin:
            # 空 pin 且未显式放行:不允许命中(upscale 原实现语义——
            # 空 pin 时 actual != "" 恒真,逐候选 continue,永不返回)。
            continue
        return PinnedFileHit(
            file_path=path,
            size_mb=round(path.stat().st_size / 1024 / 1024, 2),
            sha256=sha256,
        )
    return None


def delete_pinned_file(candidate_dirs: list[Path], filename: str) -> bool:
    removed = False
    for model_dir in candidate_dirs:
        path = model_dir / filename
        if path.is_file():
            try:
                path.unlink()
                removed = True
            except OSError:
                pass
    return removed
