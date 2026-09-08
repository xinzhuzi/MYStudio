"""ComfyUI 自管实例账本(manifest)——引擎与插件的唯一记账真源。

对应 design.md 六节数据模型 + 二节隔离目录:
  <userData>/comfyui/
    ├─ manifest.json    ← 本模块读写(引擎核心层 + 插件层分层记账)
    ├─ ComfyUI/         ← git clone 的源码(release tag)
    ├─ venv/            ← 引擎专用 venv(torch MPS + 插件依赖)
    ├─ custom_nodes/    ← 一插件一目录
    ├─ workflows/       ← 自管工作流库(纯文件操作,/comfy/workflows* 组)
    ├─ models/          ← 默认模型目录(modelsDir 可指向现有模型库)
    ├─ snapshots/       ← 快照(装插件/更新引擎前自动打,一键回滚)
    └─ logs/            ← 引擎进程 stdout/stderr(更新链错误收集用)

纪律:本模块被 comfyui_bridge(生成热路径)import,必须保持零三方依赖、
零网络、零子进程;全部交互面 = json 文件读写。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

MANIFEST_SCHEMA_VERSION = 1
COMFY_DIR_NAME = "comfyui"

# 性能档合法值(prd:翻译成大白话下拉,不暴露命令行原文)
VRAM_POLICIES = ("auto", "gpu-only", "reserve-vram")
ATTENTION_MODES = ("auto", "pytorch-cross-attention")

_lock = threading.Lock()
# bridge_url 高频调用,读走 (mtime_ns, size) 指纹缓存;save 后指纹变化自动失效
_read_cache: dict[str, tuple[tuple[int, int], dict]] = {}


def _looks_like_managed_python(executable: Path) -> bool:
    # 托管布局 = <storageBase>/python/bin/python3(indygreg,Electron main 的
    # resolveVideoWorkflowRuntimePaths 与 image-gen-runtime-controller 共用)。
    # venv 布局(.venv/venv)不匹配,不会误判。
    return executable.name.startswith("python") and executable.parent.name == "bin" and executable.parent.parent.name == "python"


def storage_root() -> Path:
    """解析应用存储根(<userData>)——与 sidecar 托管 python 同一套解析。

    优先级:① MYSTUDIO_COMFYUI_HOME(显式覆写,直接当 comfyui 家,测试用)
    之外的根解析:② 托管 python 布局(运行中的解释器即 <userData>/python/bin/python3)
    ③ MYSTUDIO_IMAGE_MODEL_DIR 主进程注入的 <userData>/model/imagegen 布局
    ④ 纯开发兜底 ~/.manying-dev(comfy_home 再拼 comfyui/)。
    """
    executable = Path(sys.executable).resolve()
    if _looks_like_managed_python(executable):
        return executable.parent.parent
    model_dir = os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR", "")
    if model_dir:
        model_path = Path(model_dir).expanduser()
        # getModelCacheDir 默认布局 = <storageBase>/model/imagegen(两级上推)
        if model_path.parent.name == "model":
            return model_path.parent.parent
    return Path.home() / ".manying-dev"


def comfy_home() -> Path:
    override = os.environ.get("MYSTUDIO_COMFYUI_HOME", "")
    if override:
        return Path(override).expanduser()
    return storage_root() / COMFY_DIR_NAME


# ── 目录辅助(绝对路径,spawn 防漂移) ──────────────────────────────
def manifest_path() -> Path:
    return comfy_home() / "manifest.json"


def engine_source_dir() -> Path:
    return comfy_home() / "ComfyUI"


def venv_dir() -> Path:
    return comfy_home() / "venv"


def venv_python() -> Path:
    return venv_dir() / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def venv_pip() -> list[str]:
    # pip 一律经 venv python -m pip(不裸调 pip,防 PATH 漂移)
    return [str(venv_python()), "-m", "pip"]


def custom_nodes_dir() -> Path:
    return comfy_home() / "custom_nodes"


def workflows_dir() -> Path:
    return comfy_home() / "workflows"


def default_models_dir() -> Path:
    return comfy_home() / "models"


def snapshots_dir() -> Path:
    return comfy_home() / "snapshots"


def engine_log_path() -> Path:
    return comfy_home() / "logs" / "engine.log"


def configured_models_dir(manifest: dict | None = None) -> Path:
    """模型目录:manifest.modelsDir 指向现有库(免重下),否则默认 <comfyui>/models。"""
    manifest = manifest if manifest is not None else load_manifest()
    models_dir = manifest.get("modelsDir")
    if isinstance(models_dir, str) and models_dir.strip():
        return Path(models_dir).expanduser()
    return default_models_dir()


# ── 账本读写(原子写,写后缓存失效) ────────────────────────────────
def default_manifest() -> dict:
    return {"schemaVersion": MANIFEST_SCHEMA_VERSION, "engine": None, "plugins": {}, "modelsDir": None}


def load_manifest() -> dict:
    path = manifest_path()
    try:
        stat = path.stat()
    except OSError:
        return default_manifest()
    fingerprint = (stat.st_mtime_ns, stat.st_size)
    cached = _read_cache.get(str(path))
    if cached and cached[0] == fingerprint:
        return cached[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        # 账本损坏=按空账本处理,绝不因账本坏阻断引擎探测(体检会报告漂移)
        return default_manifest()
    if not isinstance(data, dict):
        return default_manifest()
    data.setdefault("schemaVersion", MANIFEST_SCHEMA_VERSION)
    data.setdefault("engine", None)
    data.setdefault("plugins", {})
    data.setdefault("modelsDir", None)
    _read_cache[str(path)] = (fingerprint, data)
    return data


def save_manifest(manifest: dict) -> None:
    path = manifest_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    _read_cache.pop(str(path), None)


def mutate_manifest(mutator) -> dict:
    """锁内 读→改→写(mutator(manifest) 就地修改,返回值弃用)。"""
    with _lock:
        manifest = load_manifest()
        mutator(manifest)
        save_manifest(manifest)
        return manifest


def engine_installed(manifest: dict | None = None) -> bool:
    manifest = manifest if manifest is not None else load_manifest()
    return isinstance(manifest.get("engine"), dict) and bool(manifest["engine"].get("version"))


def recorded_port(manifest: dict | None = None) -> int | None:
    """自管实例实际端口(写 manifest 的那个)。

    grill Q9:一期即切自管实例——引擎已装即返回账本端口(跑没跑由调用方判断);
    未装引擎返回 None,桥回落 17598(存量 Krea2 链过渡)。
    """
    manifest = manifest if manifest is not None else load_manifest()
    engine = manifest.get("engine")
    if not isinstance(engine, dict) or not engine.get("version"):
        return None
    port = engine.get("port")
    if isinstance(port, int) and 0 < port < 65536:
        return port
    return None


def engine_launch_args(manifest: dict | None = None) -> dict:
    """性能档(manifest 存档位,启动时翻译成 flag;不暴露命令行原文)。"""
    manifest = manifest if manifest is not None else load_manifest()
    engine = manifest.get("engine") if isinstance(manifest.get("engine"), dict) else {}
    args = engine.get("launchArgs") if isinstance(engine.get("launchArgs"), dict) else {}
    vram = args.get("vramPolicy") if args.get("vramPolicy") in VRAM_POLICIES else "auto"
    attention = args.get("attentionMode") if args.get("attentionMode") in ATTENTION_MODES else "auto"
    reserve = args.get("reserveVramGb")
    if not isinstance(reserve, (int, float)) or reserve <= 0:
        reserve = None
    return {"vramPolicy": vram, "attentionMode": attention, "reserveVramGb": reserve}


def core_dep_names(manifest: dict | None = None) -> set[str]:
    """核心层依赖包名(引擎装完时记账)——插件卸载的引用计数不得清理核心层。"""
    manifest = manifest if manifest is not None else load_manifest()
    engine = manifest.get("engine") if isinstance(manifest.get("engine"), dict) else {}
    core = engine.get("coreDeps") if isinstance(engine.get("coreDeps"), dict) else {}
    return {str(name).lower() for name in core}


def plugin_ledger(manifest: dict | None = None) -> dict[str, dict]:
    manifest = manifest if manifest is not None else load_manifest()
    plugins = manifest.get("plugins")
    return plugins if isinstance(plugins, dict) else {}


def timestamp_ms() -> int:
    return int(time.time() * 1000)
