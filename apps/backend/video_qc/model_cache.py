"""Video QC model cache helpers — mirrors upscale/model_cache.py conventions.

⚠️ 2026-08-19 立项时的网络现实(记录在案):
GitHub / HuggingFace 直连不可达(仅 modelscope.cn 通),DOVER-Mobile 的
官方权重 release URL 与 sha256 未能核实,**严禁猜测编造**——所以 spec 留空
(url/sha256/sources 均空),download_model 对空源返回明确错误
"权重源未配置"。网络可达后补齐三行配置即激活全链:
  1. url:官方 release 直链
  2. sha256:首下载后回填固定
  3. sources:modelscope 镜像 (repo_id, file) 对(若有)

推理侧同理:架构代码需从 VQAssessment/DOVER 仓库 vendor 到本包
`dover_mobile_arch.py`(带原仓库 LICENSE),dover_scoring.score_video 对
缺失架构返回 arch-unavailable,不伪造分数。
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import TypedDict


class VideoQcModelSpec(TypedDict):
    label: str
    description: str
    file: str
    url: str
    # (repo_id, file inside repo) pairs tried via modelscope/HF snapshot before
    # the direct URL fallback. Empty tuple = no snapshot source.
    sources: tuple[tuple[str, str], ...]
    # Empty string = 未核实,不 pin(首下载后回填)
    sha256: str
    size_mb: int
    license: str


VIDEO_QC_MODELS: dict[str, VideoQcModelSpec] = {
    "dover-mobile": {
        "label": "DOVER-Mobile 观感评分",
        "description": "ICCV 2023 DOVER 的移动版(9.86M 参数,纯 CPU ~1.4s/片),"
        "UGC 校准——只做按系列基线的相对告警,不做绝对国标",
        "file": "dover_mobile.pth",
        "url": "https://github.com/VQAssessment/DOVER/releases/download/v0.5.0/DOVER-Mobile.pth",
        "sources": (
            ("VQAssessment/DOVER", "assets/DOVER-Mobile.pth"),  # modelscope snapshot 备选
        ),
        "sha256": "81b487be2aa4b3dd6920afa2e92294ed8fdd46a306911f75ecc8e6938a670884",
        "size_mb": 41,
        "license": "待核实(VQAssessment/DOVER 仓库)",
    },
}

DEFAULT_VIDEO_QC_MODEL = "dover-mobile"


class CachedVideoQcModel(TypedDict):
    file_path: str
    size_mb: float
    sha256: str


def primary_model_dir() -> Path:
    # MYSTUDIO_VIDEO_QC_MODEL_DIR is always set by the TS runtime controller to
    # the user-configured dir (default <userData>/VideoQcModel). The home
    # fallback only serves standalone CLI runs.
    env_cache = os.environ.get("MYSTUDIO_VIDEO_QC_MODEL_DIR")
    if env_cache:
        return Path(env_cache).expanduser()
    return Path.home() / ".mystudio" / "video-qc-models"


def model_candidate_dirs() -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []
    for path in (primary_model_dir(), Path.home() / ".mystudio" / "video-qc-models",
                 Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/model/videoqc")):
        expanded = path.expanduser()
        if str(expanded) in seen:
            continue
        seen.add(str(expanded))
        unique.append(expanded)
    return unique


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cached_model_path(model_dir: Path, spec: VideoQcModelSpec) -> Path:
    return model_dir / spec["file"]


def find_cached_video_qc_model(model_name: str) -> CachedVideoQcModel | None:
    spec = VIDEO_QC_MODELS.get(model_name)
    if not spec:
        return None
    for model_dir in model_candidate_dirs():
        path = cached_model_path(model_dir, spec)
        if not path.is_file() or path.stat().st_size <= 0:
            continue
        # 空 pin(未核实)只验存在与大小;回填 sha256 后自动收紧为强校验
        if spec["sha256"]:
            try:
                if file_sha256(path) != spec["sha256"]:
                    continue
            except OSError:
                continue
        return {
            "file_path": str(path),
            "size_mb": round(path.stat().st_size / 1024 / 1024, 2),
            "sha256": "" if not spec["sha256"] else spec["sha256"],
        }
    return None


def is_video_qc_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    cached = find_cached_video_qc_model(model_name)
    if not cached:
        return False, None
    return True, cached["size_mb"]


def verify_model_sha256(model_name: str) -> tuple[bool, str]:
    spec = VIDEO_QC_MODELS.get(model_name)
    if not spec:
        return False, "unknown-model"
    if not spec["sha256"]:
        # 未 pin:存在即通过(下载源核实后回填)
        for model_dir in model_candidate_dirs():
            path = cached_model_path(model_dir, spec)
            if path.is_file() and path.stat().st_size > 0:
                return True, str(path)
        return False, "model-not-downloaded"
    for model_dir in model_candidate_dirs():
        path = cached_model_path(model_dir, spec)
        if path.is_file():
            return (file_sha256(path) == spec["sha256"], str(path))
    return False, "model-not-downloaded"


def delete_cached_model(model_name: str) -> bool:
    spec = VIDEO_QC_MODELS.get(model_name)
    if not spec:
        return False
    removed = False
    for model_dir in model_candidate_dirs():
        path = cached_model_path(model_dir, spec)
        if path.is_file():
            try:
                path.unlink()
                removed = True
            except OSError:
                pass
    return removed
