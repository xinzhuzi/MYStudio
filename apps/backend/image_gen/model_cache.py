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

# 自足回退大件仓(08-30 实拍,字节与本机 ComfyUI 文件一致,单文件分发——
# 装配代码单文件+键名映射可原样复用;详见 .trellis/tasks/08-30-imagegen-selfcontained-fallback/prd.md)
QWEN_GGUF_REPO = "unsloth/Qwen-Image-Edit-2511-GGUF"
QWEN_GGUF_FILE = "qwen-image-edit-2511-Q8_0.gguf"  # 连字符命名(本机 ComfyUI 副本为下划线,同字节)
QWEN_TE_REPO = "Comfy-Org/Qwen-Image_ComfyUI"
QWEN_TE_FILE = "split_files/text_encoders/qwen_2.5_vl_7b.safetensors"
# 每仓只拉清单内文件——Comfy-Org 仓整仓含 38G×数个扩散模型,严禁整仓拉
QWEN_BIG_FILE_REPOS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (QWEN_GGUF_REPO, (QWEN_GGUF_FILE,)),
    (QWEN_TE_REPO, (QWEN_TE_FILE,)),
)

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

# ── Z-Image-Turbo(08-30 多引擎接入,B 站 BV1vG8m6vETh 修复工作流同款底子)──
Z_IMAGE_MODEL = "z-image-turbo"
Z_COMFY_MAIN_FILE = "diffusion_models/z_image_turbo_bf16.safetensors"
Z_COMFY_TEXT_ENCODER_FILE = "text_encoders/qwen_3_4b.safetensors"
# 08-30 用户补下:ComfyUI vae/ae.safetensors(335MB)——VAE 权重优先指向,
# 小件仓的 vae 权重降级为回退(不存在时才需要)
Z_COMFY_VAE_FILE = "vae/ae.safetensors"
# 小件:VAE/调度器/分词器/双端 config(~400MB);大件 ComfyUI 指向零重下
Z_IMAGE_SMALL_REPO = os.environ.get("MYSTUDIO_ZIMAGE_SMALL_REPO", "Tongyi-MAI/Z-Image-Turbo")
Z_IMAGE_SMALL_PIECE_REPOS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        Z_IMAGE_SMALL_REPO,
        (
            "vae/*",
            "scheduler/*",
            "transformer/config.json",
            "text_encoder/config.json",
            "tokenizer/*",
        ),
    ),
)
Z_IMAGE_SMALL_EXACT_FILES: tuple[str, ...] = (
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
    "scheduler/scheduler_config.json",
    "transformer/config.json",
    "text_encoder/config.json",
    "tokenizer/tokenizer.json",
    "tokenizer/tokenizer_config.json",
    "tokenizer/vocab.json",
    "tokenizer/merges.txt",
    "tokenizer/special_tokens_map.json",
)
Z_IMAGE_REQUIRED_FILES = (
    "transformer/config.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "tokenizer/tokenizer_config.json",
)


# ── FLUX.2 Klein 9B(08-30 三引擎,BFL 快速档;原生参考图编辑)──
FLUX2_KLEIN_MODEL = "flux2-klein-9b"
FLUX2_COMFY_MAIN_FILE = "diffusion_models/flux2_klein_9b.safetensors"
# TE 双候选(08-30 用户换代):官方 bf16 或社区 uncensored Q8 GGUF,
# 存在哪个用哪个;GGUF 经 transformers gguf_file 装载
FLUX2_COMFY_TEXT_ENCODER_FILES: tuple[str, ...] = (
    "text_encoders/qwen_3_8b.safetensors",
    "text_encoders/flux2-klein-9b-uncensored-q8_0.gguf",
)
FLUX2_COMFY_VAE_FILE = "vae/flux2-vae.safetensors"
# 小件:调度器/双端 config/分词器(KB-MB 级);大件 ComfyUI 指向零重下。
# ModelScope 有 BFL 官方镜像(HF 仓 auto-gated 且当前网络不通)
FLUX2_SMALL_REPO = os.environ.get("MYSTUDIO_FLUX2_SMALL_REPO", "black-forest-labs/FLUX.2-klein-9B")
FLUX2_SMALL_EXACT_FILES: tuple[str, ...] = (
    "scheduler/scheduler_config.json",
    "transformer/config.json",
    "vae/config.json",
    "text_encoder/config.json",
    "text_encoder/generation_config.json",
    "tokenizer/added_tokens.json",
    "tokenizer/chat_template.jinja",
    "tokenizer/merges.txt",
    "tokenizer/special_tokens_map.json",
    "tokenizer/tokenizer.json",
    "tokenizer/tokenizer_config.json",
    "tokenizer/vocab.json",
    "vae/diffusion_pytorch_model.safetensors",
)
FLUX2_SMALL_PIECE_REPOS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        FLUX2_SMALL_REPO,
        (
            "scheduler/*",
            "transformer/config.json",
            "vae/config.json",
            "text_encoder/config.json",
            "text_encoder/generation_config.json",
            "tokenizer/*",
        ),
    ),
)
FLUX2_REQUIRED_FILES = (
    "transformer/config.json",
    "scheduler/scheduler_config.json",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
    "text_encoder/config.json",
    "text_encoder/model.safetensors",
    "tokenizer/tokenizer_config.json",
)


# ── Krea2 Turbo(08-31 四引擎主力,破限工作流底座)──
KREA2_MODEL = "krea2-turbo"
KREA2_COMFY_MAIN_FILE = "diffusion_models/krea2_turbo_bf16.safetensors"
KREA2_COMFY_TEXT_ENCODER_FILE = "text_encoders/qwen3-vl-4b-heretic.safetensors"
KREA2_COMFY_VAE_FILE = "vae/qwen_image_vae.safetensors"
# 小件:config/tokenizer/调度器(KB-MB 级);ModelScope 有 krea 官方镜像
KREA2_SMALL_REPO = os.environ.get("MYSTUDIO_KREA2_SMALL_REPO", "krea/Krea-2-Turbo")
KREA2_SMALL_EXACT_FILES: tuple[str, ...] = (
    "model_index.json",
    "scheduler/scheduler_config.json",
    "transformer/config.json",
    "vae/config.json",
    "text_encoder/config.json",
    "tokenizer/chat_template.jinja",
    "tokenizer/tokenizer.json",
    "tokenizer/tokenizer_config.json",
    "vae/diffusion_pytorch_model.safetensors",
    "text_encoder/model.safetensors",
)
KREA2_SMALL_PIECE_REPOS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        KREA2_SMALL_REPO,
        (
            "scheduler/*",
            "transformer/config.json",
            "vae/config.json",
            "text_encoder/config.json",
            "tokenizer/*",
        ),
    ),
)
KREA2_REQUIRED_FILES = (
    "transformer/config.json",
    "scheduler/scheduler_config.json",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
    "text_encoder/config.json",
    "tokenizer/tokenizer_config.json",
)


# ── Krea2 LoRA 工作流(08-31 用户裁定:优先 NSFW 专业流)──
# ComfyUI loras 目录下按子文件夹组织的 LoRA 适配器(512 键=448 blocks+64
# txtfusion,r=64/32,alpha=rank)。文件名前缀 diffusion_model. + 原生键名。
KREA2_COMFY_LORA_DIR = "loras/Krea2-NSFW"
KREA2_DEFAULT_LORA_FILE = "Krea 2 NSFW V4.safetensors"


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
    KREA2_MODEL: {
        "label": "Krea2 Turbo",
        "repo_id": KREA2_SMALL_REPO,
        "repo_ids": (KREA2_SMALL_REPO,),
        "size_mb": 35600,
        "license": "Krea Community License",
        "steps": 8,
        "description": "本地主力生图（Turbo 蒸馏 8 步；Qwen3-VL 破限版文本编码器；LoRA 工作流可挂 NSFW/identity 编辑；大件指向 ComfyUI 现成文件零重下）",
        "layout": "krea2-pointed",
    },
    FLUX2_KLEIN_MODEL: {
        "label": "FLUX.2 Klein 9B",
        "repo_id": FLUX2_SMALL_REPO,
        "repo_ids": (FLUX2_SMALL_REPO,),
        "size_mb": 35000,
        "license": "FLUX.2 Community License",
        "steps": 8,
        "description": "本地快速生图+参考图编辑（9B 蒸馏档，原生支持参考图生成；大件指向 ComfyUI 现成文件零重下；首次补齐配置/分词器小件）",
        "layout": "flux2-pointed",
    },
    Z_IMAGE_MODEL: {
        "label": "Z-Image-Turbo",
        "repo_id": Z_IMAGE_SMALL_REPO,
        "repo_ids": (Z_IMAGE_SMALL_REPO,),
        "size_mb": 13700,
        "license": "Apache-2.0",
        "steps": 8,
        "description": "本地快速生图（6B turbo 蒸馏，8 步出图；大件指向 ComfyUI 现成文件零重下；首次补齐 VAE/分词器小件约 400MB）",
        "layout": "z-image-pointed",
    },
}


class CachedImageModel(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float


def comfyui_models_dir(env_name: str = "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR") -> Path:
    override = os.environ.get(env_name)
    if override:
        return Path(override).expanduser()
    return Path.home() / "Project" / "ComfyUI" / "models"


def resolve_image_model_name(name: str) -> str:
    return LEGACY_IMAGE_MODEL_ALIASES.get(name, name)


def qwen_pointed_big_files() -> tuple[Path, Path]:
    base = comfyui_models_dir()
    return base / QWEN_COMFY_MAIN_FILE, base / QWEN_COMFY_TEXT_ENCODER_FILE


def qwen_appcache_big_files(cache_dir: Path | None = None) -> tuple[Path, Path] | None:
    """自足回退布局探测:应用 HF 缓存内两仓 snapshot 的大件单文件。

    ModelScope 助手平铺写 snapshots/main/<path>,HF snapshot 写 snapshots/<rev>/<path>,
    两种布局都落在 hf_snapshot_dir() 的扫描范围内。GGUF 以 *Q8_0.gguf 兜底 glob,
    兼容连字符/下划线两种文件名。
    """
    gguf_snapshot = hf_snapshot_dir(QWEN_GGUF_REPO, cache_dir)
    main = next(iter(sorted(gguf_snapshot.rglob("*Q8_0.gguf"))), None) if gguf_snapshot else None
    te_snapshot = hf_snapshot_dir(QWEN_TE_REPO, cache_dir)
    te = (te_snapshot / QWEN_TE_FILE) if te_snapshot else None
    if main is None or te is None or not (main.is_file() and te.is_file()):
        return None
    return main, te


def resolve_qwen_big_files(cache_dir: Path | None = None) -> dict | None:
    """大件统一解析(优先级):ComfyUI 指向(env 可覆写)→ 应用缓存自足布局。

    返回 {"main": Path, "text_encoder": Path, "source": "comfyui"|"app-cache",
    "cache_dir": str, "size_mb": float};两源皆缺返回 None。
    """
    main, te = qwen_pointed_big_files()
    if main.is_file() and te.is_file():
        return {
            "main": main,
            "text_encoder": te,
            "source": "comfyui",
            "cache_dir": str(comfyui_models_dir()),
            "size_mb": round((main.stat().st_size + te.stat().st_size) / 1024 / 1024, 2),
        }
    appcache = qwen_appcache_big_files(cache_dir)
    if appcache:
        main, te = appcache
        root = cache_dir or primary_hf_cache_dir()
        return {
            "main": main,
            "text_encoder": te,
            "source": "app-cache",
            "cache_dir": str(root),
            "size_mb": round((main.stat().st_size + te.stat().st_size) / 1024 / 1024, 2),
        }
    return None


def find_cached_qwen_pointed_model() -> CachedImageModel | None:
    """大件探测(两源,ComfyUI 指向优先,应用缓存自足回退);小件另查。"""
    resolved = resolve_qwen_big_files()
    if not resolved:
        return None
    main = resolved["main"]
    return {
        "repo_id": f"{resolved['source']}:{main.name}",
        "cache_dir": resolved["cache_dir"],
        "repo_cache_dir": str(main.parent),
        "size_mb": resolved["size_mb"],
    }


def z_image_pointed_big_files() -> tuple[Path, Path]:
    base = comfyui_models_dir("MYSTUDIO_ZIMAGE_COMFYUI_MODELS_DIR")
    return base / Z_COMFY_MAIN_FILE, base / Z_COMFY_TEXT_ENCODER_FILE


def z_image_comfy_vae_file() -> Path:
    return comfyui_models_dir("MYSTUDIO_ZIMAGE_COMFYUI_MODELS_DIR") / Z_COMFY_VAE_FILE


def resolve_z_image_big_files(cache_dir: Path | None = None) -> dict | None:
    """Z 大件解析:ComfyUI 指向(唯一源;无自足回退仓,大件缺失即未就绪)。

    vae 键:ComfyUI ae.safetensors 在 → 指向该文件;不在 → None(装配时
    回退小件仓 snapshot 的 vae 权重)。
    """
    main, te = z_image_pointed_big_files()
    if not (main.is_file() and te.is_file()):
        return None
    vae_file = z_image_comfy_vae_file()
    vae = vae_file if vae_file.is_file() else None
    total = main.stat().st_size + te.stat().st_size + (vae.stat().st_size if vae else 0)
    return {
        "main": main,
        "text_encoder": te,
        "vae": vae,
        "source": "comfyui",
        "cache_dir": str(comfyui_models_dir("MYSTUDIO_ZIMAGE_COMFYUI_MODELS_DIR")),
        "size_mb": round(total / 1024 / 1024, 2),
    }


def find_cached_z_image_model() -> CachedImageModel | None:
    resolved = resolve_z_image_big_files()
    if not resolved:
        return None
    return {
        "repo_id": f"comfyui:{Z_COMFY_MAIN_FILE}",
        "cache_dir": resolved["cache_dir"],
        "repo_cache_dir": str(resolved["main"].parent),
        "size_mb": resolved["size_mb"],
    }


def z_image_small_pieces_status(cache_dir: Path | None = None) -> dict:
    snapshot = hf_snapshot_dir(Z_IMAGE_SMALL_REPO, cache_dir)
    missing = (
        [f"{Z_IMAGE_SMALL_REPO}:{name}" for name in Z_IMAGE_REQUIRED_FILES]
        if snapshot is None
        else [f"{Z_IMAGE_SMALL_REPO}:{name}" for name in Z_IMAGE_REQUIRED_FILES if not (snapshot / name).is_file()]
    )
    return {
        "ready": not missing,
        "missing": missing,
        "snapshot_dirs": {Z_IMAGE_SMALL_REPO: str(snapshot) if snapshot else None},
    }


def primary_hf_cache_dir() -> Path:
    env_cache = (
        os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR")
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
    for env_name in ("MYSTUDIO_IMAGE_MODEL_DIR", "HF_HUB_CACHE"):
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


def flux2_te_file() -> Path | None:
    base = comfyui_models_dir()
    for name in FLUX2_COMFY_TEXT_ENCODER_FILES:
        candidate = base / name
        if candidate.is_file():
            return candidate
    return None


def flux2_pointed_big_files() -> tuple[Path, Path | None, Path]:
    base = comfyui_models_dir()
    return (
        base / FLUX2_COMFY_MAIN_FILE,
        flux2_te_file(),
        base / FLUX2_COMFY_VAE_FILE,
    )


def resolve_flux2_big_files(cache_dir: Path | None = None) -> dict | None:
    """FLUX.2 Klein 三大件解析:ComfyUI 指向(唯一源);任一缺失即 None。"""
    main, te, vae = flux2_pointed_big_files()
    if not (main.is_file() and te is not None):
        return None
    # VAE 权重以小件仓 diffusers 版为准;ComfyUI flux2-vae 是旧版键名
    # (encoder.down.0.block…),与 diffusers 不兼容,仅作展示参考不作就绪门槛
    comfy_vae = vae if vae.is_file() else None
    total = main.stat().st_size + te.stat().st_size
    return {
        "main": main,
        "text_encoder": te,
        "vae": comfy_vae,
        "source": "comfyui",
        "cache_dir": str(comfyui_models_dir()),
        "size_mb": round(total / 1024 / 1024, 2),
    }


def find_cached_flux2_model() -> CachedImageModel | None:
    resolved = resolve_flux2_big_files()
    if not resolved:
        return None
    return {
        "repo_id": f"comfyui:{FLUX2_COMFY_MAIN_FILE}",
        "cache_dir": resolved["cache_dir"],
        "repo_cache_dir": str(resolved["main"].parent),
        "size_mb": resolved["size_mb"],
    }


def flux2_small_pieces_status(cache_dir: Path | None = None) -> dict:
    snapshot = hf_snapshot_dir(FLUX2_SMALL_REPO, cache_dir)
    missing = (
        [f"{FLUX2_SMALL_REPO}:{name}" for name in FLUX2_REQUIRED_FILES]
        if snapshot is None
        else [f"{FLUX2_SMALL_REPO}:{name}" for name in FLUX2_REQUIRED_FILES if not (snapshot / name).is_file()]
    )
    return {
        "ready": not missing,
        "missing": missing,
        "snapshot_dirs": {FLUX2_SMALL_REPO: str(snapshot) if snapshot else None},
    }


def krea2_pointed_big_files() -> tuple[Path, Path, Path]:
    base = comfyui_models_dir()
    return (
        base / KREA2_COMFY_MAIN_FILE,
        base / KREA2_COMFY_TEXT_ENCODER_FILE,
        base / KREA2_COMFY_VAE_FILE,
    )


def resolve_krea2_big_files(cache_dir: Path | None = None) -> dict | None:
    main, te, vae = krea2_pointed_big_files()
    if not all(f.is_file() for f in (main, te, vae)):
        return None
    total = sum(f.stat().st_size for f in (main, te, vae))
    return {
        "main": main,
        "text_encoder": te,
        "vae": vae,
        "source": "comfyui",
        "cache_dir": str(comfyui_models_dir()),
        "size_mb": round(total / 1024 / 1024, 2),
    }


def find_cached_krea2_model() -> CachedImageModel | None:
    resolved = resolve_krea2_big_files()
    if not resolved:
        return None
    return {
        "repo_id": f"comfyui:{KREA2_COMFY_MAIN_FILE}",
        "cache_dir": resolved["cache_dir"],
        "repo_cache_dir": str(resolved["main"].parent),
        "size_mb": resolved["size_mb"],
    }


def krea2_small_pieces_status(cache_dir: Path | None = None) -> dict:
    snapshot = hf_snapshot_dir(KREA2_SMALL_REPO, cache_dir)
    missing = (
        [f"{KREA2_SMALL_REPO}:{name}" for name in KREA2_REQUIRED_FILES]
        if snapshot is None
        else [f"{KREA2_SMALL_REPO}:{name}" for name in KREA2_REQUIRED_FILES if not (snapshot / name).is_file()]
    )
    return {
        "ready": not missing,
        "missing": missing,
        "snapshot_dirs": {KREA2_SMALL_REPO: str(snapshot) if snapshot else None},
    }


def find_cached_image_model_for_spec(spec: ImageModelSpec) -> CachedImageModel | None:
    """统一入口:按 spec 布局分派(指向版查 ComfyUI 大件,否则 HF 扫描)。"""
    layout = spec.get("layout")
    if layout == "qwen-pointed":
        return find_cached_qwen_pointed_model()
    if layout == "z-image-pointed":
        return find_cached_z_image_model()
    if layout == "krea2-pointed":
        return find_cached_krea2_model()
    if layout == "flux2-pointed":
        return find_cached_flux2_model()
    return find_cached_image_model(spec["repo_ids"])


def is_image_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        return False, None
    cached = find_cached_image_model_for_spec(spec)
    if not cached:
        return False, None
    return True, cached["size_mb"]
