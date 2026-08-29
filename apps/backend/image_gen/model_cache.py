"""Image model cache helpers — HF snapshot layout + Qwen ComfyUI 指向版.

两种布局(08-28-qwen-image-local-gen):
- ``qwen-pointed``:大件(GGUF 主模型/文本编码器)不下载,直指 ComfyUI 现成文件;
  VAE/scheduler/tokenizer/processor 等小件(~300MB)显式下载进应用图片模型缓存。
- ``hf``(默认,当前无在册条目):整仓 HF snapshot 布局。

推理绝不自动下载;缺件 fail-closed,报可操作的错误码。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx", ".gguf")

QWEN_IMAGE_EDIT_MODEL = "qwen-image-edit-2511"

# 指向版大件:ComfyUI models 目录下现成文件(用户已有,零重下)
QWEN_COMFY_MAIN_FILE = "diffusion_models/qwen_image_edit_2511_Q8_0.gguf"
QWEN_COMFY_TEXT_ENCODER_FILE = "text_encoders/qwen_2.5_vl_7b.safetensors"

# 小件:两个官方仓的配置/分词器/VAE 权重,显式小下载(~300MB)
QWEN_IMAGE_REPO = "Qwen/Qwen-Image"
QWEN_VL_REPO = "Qwen/Qwen2.5-VL-7B-Instruct"
QWEN_SMALL_PIECE_REPOS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (QWEN_IMAGE_REPO, ("vae/*", "scheduler/*", "transformer/config.json")),
    (
        QWEN_VL_REPO,
        (
            "config.json",
            "preprocessor_config.json",
            "processor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
            "chat_template.json",
            "special_tokens_map.json",
        ),
    ),
)
# ready 判定的最小必需文件(allow_patterns 中其余文件缺了不挡)
QWEN_IMAGE_REQUIRED_FILES = (
    "transformer/config.json",
    "scheduler/scheduler_config.json",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
)
QWEN_VL_REQUIRED_FILES = (
    "config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
)
QWEN_SMALL_PIECES_SIZE_MB = 300

# 旧目录 id 归一(sdxl-turbo/flux-schnell 已退役,存量配置请求映射到 Qwen)
LEGACY_IMAGE_MODEL_ALIASES: dict[str, str] = {
    "sdxl-turbo": QWEN_IMAGE_EDIT_MODEL,
    "flux-schnell": QWEN_IMAGE_EDIT_MODEL,
}


class ImageModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str
    steps: int
    description: str


class PointedImageModelSpec(ImageModelSpec, total=False):
    """指向版扩展字段——大件直用 ComfyUI 文件,不走 HF 缓存扫描。"""

    layout: str


# Catalog — Qwen-Image-Edit 2511(08-28 用户指令:替代从未准备过的 SDXL/FLUX)。
# 尖刺实证:832²×8 步 107s(含装配),生产建议 20 步+官方分辨率档。
IMAGE_MODELS: dict[str, PointedImageModelSpec] = {
    QWEN_IMAGE_EDIT_MODEL: {
        "label": "Qwen-Image-Edit 2511",
        "repo_id": QWEN_IMAGE_REPO,
        "repo_ids": (QWEN_IMAGE_REPO, QWEN_VL_REPO),
        "size_mb": 36560,
        "license": "Apache-2.0",
        "steps": 20,
        "description": "本地编辑级生图（21.7B GGUF Q8_0，大件指向 ComfyUI 现成文件零重下；首次需补齐 VAE/文本编码器小件约 300MB）",
        "layout": "qwen-pointed",
    },
}


class CachedImageModel(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float


def comfyui_models_dir() -> Path:
    override = os.environ.get("MYSTUDIO_QWEN_COMFYUI_MODELS_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / "Project" / "ComfyUI" / "models"


def resolve_image_model_name(name: str) -> str:
    return LEGACY_IMAGE_MODEL_ALIASES.get(name, name)


def qwen_pointed_big_files() -> tuple[Path, Path]:
    base = comfyui_models_dir()
    return base / QWEN_COMFY_MAIN_FILE, base / QWEN_COMFY_TEXT_ENCODER_FILE


def find_cached_qwen_pointed_model() -> CachedImageModel | None:
    """指向版大件探测:主模型 + 文本编码器都在才算就绪(小件另查)。"""
    main, text_encoder = qwen_pointed_big_files()
    if not (main.is_file() and text_encoder.is_file()):
        return None
    size_mb = round((main.stat().st_size + text_encoder.stat().st_size) / 1024 / 1024, 2)
    return {
        "repo_id": f"comfyui:{QWEN_COMFY_MAIN_FILE}",
        "cache_dir": str(comfyui_models_dir()),
        "repo_cache_dir": str(main.parent),
        "size_mb": size_mb,
    }


def primary_hf_cache_dir() -> Path:
    env_cache = (
        os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR")
        or os.environ.get("MANYING_TTS_MODELS_DIR")
        or os.environ.get("VOICEBOX_MODELS_DIR")
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


def download_hf_cache_dir() -> Path:
    cache_dir = primary_hf_cache_dir()
    if cache_dir.name == "huggingface":
        return cache_dir / "hub"
    if cache_dir.name != "hub" and (cache_dir / "hub").exists():
        return cache_dir / "hub"
    return cache_dir


def hf_cache_dirs() -> list[Path]:
    candidates: list[Path] = []
    for env_name in ("MYSTUDIO_IMAGE_MODEL_DIR", "MANYING_TTS_MODELS_DIR", "VOICEBOX_MODELS_DIR", "HF_HUB_CACHE"):
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


def hf_snapshot_dir(repo_id: str, cache_dir: Path | None = None) -> Path | None:
    snapshots = repo_cache_dir(repo_id, cache_dir) / "snapshots"
    if not snapshots.is_dir():
        return None
    dirs = sorted(path for path in snapshots.iterdir() if path.is_dir())
    return dirs[-1] if dirs else None


def _has_complete_model_files(cache: Path) -> bool:
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
        for extension in MODEL_WEIGHT_EXTENSIONS
        for file in snapshots_dir.rglob(f"*{extension}")
    )


def _cache_size_mb(cache: Path) -> float:
    size = sum(
        file.stat().st_size
        for file in cache.rglob("*")
        if file.is_file() and not file.name.endswith(".incomplete")
    )
    return round(size / 1024 / 1024, 2)


def find_cached_image_model(repo_ids: tuple[str, ...]) -> CachedImageModel | None:
    for cache_dir in hf_cache_dirs():
        for repo_id in repo_ids:
            cache = repo_cache_dir(repo_id, cache_dir)
            if _has_complete_model_files(cache):
                return {
                    "repo_id": repo_id,
                    "cache_dir": str(cache_dir),
                    "repo_cache_dir": str(cache),
                    "size_mb": _cache_size_mb(cache),
                }
    return None


def qwen_small_pieces_status(cache_dir: Path | None = None) -> dict:
    """小件完备性:两个官方仓 snapshot 内必需文件是否齐(缺件给定位清单)。"""
    missing: list[str] = []
    snapshot_dirs: dict[str, str | None] = {}
    for repo_id, _patterns in QWEN_SMALL_PIECE_REPOS:
        snapshot = hf_snapshot_dir(repo_id, cache_dir)
        snapshot_dirs[repo_id] = str(snapshot) if snapshot else None
        required = QWEN_IMAGE_REQUIRED_FILES if repo_id == QWEN_IMAGE_REPO else QWEN_VL_REQUIRED_FILES
        if snapshot is None:
            missing.extend(f"{repo_id}:{name}" for name in required)
        else:
            missing.extend(
                f"{repo_id}:{name}" for name in required if not (snapshot / name).is_file()
            )
    return {"ready": not missing, "missing": missing, "snapshot_dirs": snapshot_dirs}


def find_cached_image_model_for_spec(spec: ImageModelSpec) -> CachedImageModel | None:
    """统一入口:按 spec 布局分派(指向版查 ComfyUI 大件,否则 HF 扫描)。"""
    if spec.get("layout") == "qwen-pointed":
        return find_cached_qwen_pointed_model()
    return find_cached_image_model(spec["repo_ids"])


def is_image_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        return False, None
    cached = find_cached_image_model_for_spec(spec)
    if not cached:
        return False, None
    return True, cached["size_mb"]
