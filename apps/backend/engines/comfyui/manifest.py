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


def user_data_root() -> Path:
    """应用存储根 <userData>(09-09 用户裁定:comfyui 家放这里,与 python 运行时平级)。

    storage_root 在托管 python 布局下指 <userData>/python(运行时目录本身),
    其余分支(model-dir 注入/开发兜底)本就是 <userData>——统一上提到平级根。
    """
    root = storage_root()
    if root.name == "python":
        return root.parent
    return root


def comfy_home() -> Path:
    override = os.environ.get("MYSTUDIO_COMFYUI_HOME", "")
    if override:
        return Path(override).expanduser()
    return user_data_root() / COMFY_DIR_NAME


_home_migrated = False


def ensure_home_migrated() -> None:
    """旧家 <userData>/python/comfyui 一次性收编到 <userData>/comfyui(幂等)。

    只在 sidecar 冷启动序列显式调用(此刻引擎进程必未起,move 安全);
    同卷 rename 秒级;venv 无需重建(pip 一律 -m 方式,不依赖 script shebang)。
    """
    global _home_migrated
    if _home_migrated:
        return
    _home_migrated = True
    home = comfy_home()
    if os.environ.get("MYSTUDIO_COMFYUI_HOME"):
        return  # 显式覆写=测试/定制布局,不碰
    legacy = storage_root() / COMFY_DIR_NAME
    if home == legacy or not (legacy / "manifest.json").exists() or (home / "manifest.json").exists():
        return
    home.parent.mkdir(parents=True, exist_ok=True)
    if home.exists():
        # 目标家已有残件(如空目录):逐项并入,manifest 已守卫不会覆盖
        import shutil as _shutil
        for item in legacy.iterdir():
            _shutil.move(str(item), str(home / item.name))
        legacy.rmdir()
    else:
        import shutil as _shutil
        _shutil.move(str(legacy), str(home))


# ── 目录辅助(绝对路径,spawn 防漂移) ──────────────────────────────
def manifest_path() -> Path:
    return comfy_home() / "manifest.json"


# 09-09 comfyui-frontend-swap 0a:引擎/Python运行时(venv)/工作流目录逐项可
# 配置(与 modelsDir 同款 manifest 落账)——Python 与引擎拆分、大盘迁移的
# 用户配置位。配置锚定 <comfyui-home>/manifest.json,不随目标目录搬走。
def configured_engine_dir(manifest: dict | None = None) -> Path:
    manifest = manifest if manifest is not None else load_manifest()
    d = manifest.get("engineDir")
    if isinstance(d, str) and d.strip():
        return Path(d).expanduser()
    return comfy_home() / "ComfyUI"


def configured_venv_dir(manifest: dict | None = None) -> Path:
    manifest = manifest if manifest is not None else load_manifest()
    d = manifest.get("venvDir")
    if isinstance(d, str) and d.strip():
        return Path(d).expanduser()
    return comfy_home() / "venv"


def configured_workflows_dir(manifest: dict | None = None) -> Path:
    manifest = manifest if manifest is not None else load_manifest()
    d = manifest.get("workflowsDir")
    if isinstance(d, str) and d.strip():
        return Path(d).expanduser()
    # 工作流库=ComfyUI 原生用户工作流目录:引擎 webview 的工作流菜单直接可见,
    # 导入即达(09-09 存量迁移链打通);旧默认 <home>/workflows 由
    # plugin_manager.merge_legacy_workflows_dir 非破坏并入。
    return engine_source_dir() / "user" / "default" / "workflows"


def legacy_workflows_dir() -> Path:
    """旧默认工作流库(存量装机兼容);首次库操作时非破坏并入新库。"""
    return comfy_home() / "workflows"


def engine_source_dir() -> Path:
    return configured_engine_dir()


def venv_dir() -> Path:
    return configured_venv_dir()


def venv_python() -> Path:
    return venv_dir() / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def venv_pip() -> list[str]:
    # pip 一律经 venv python -m pip(不裸调 pip,防 PATH 漂移)
    return [str(venv_python()), "-m", "pip"]


def custom_nodes_dir() -> Path:
    # 09-08 实弹补修:ComfyUI 只加载「源码目录内」的 custom_nodes(隔离布局里
    # <home>/custom_nodes 是兄弟目录,引擎根本不读——插件装进去差分恒 0)。
    return engine_source_dir() / "custom_nodes"


def workflows_dir() -> Path:
    return configured_workflows_dir()


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
    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "engine": None,
        "plugins": {},
        "modelsDir": None,
        "engineDir": None,
        "venvDir": None,
        "workflowsDir": None,
    }


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


# 09-10 用户裁定「全盘照 ComfyUI Desktop」:launchArgs 改为命令行整串(唯一真源),
# 结构化下拉只是往串里写的快填器;推翻旧「不暴露命令行原文」口径。
# 缺省串=09-08 对齐用户 Desktop 实跑的三参数。
DEFAULT_LAUNCH_ARGS_STRING = "--gpu-only --reserve-vram 16 --use-pytorch-cross-attention"


def legacy_launch_flags(args: dict) -> str:
    """旧三档对象 → 等效命令行串(读侧自动迁移;翻译规则=旧 build_launch_args 逐条)。"""
    flags: list[str] = []
    vram = args.get("vramPolicy") if args.get("vramPolicy") in VRAM_POLICIES else "gpu-only"
    # 旧读侧语义:缺失/非法的 reserveVramGb 一律默认 16 → 旧有效行为恒含 --reserve-vram N
    reserve = args.get("reserveVramGb")
    if not isinstance(reserve, (int, float)) or reserve <= 0:
        reserve = 16
    if vram == "gpu-only":
        flags.append("--gpu-only")
    gb_text = str(int(reserve)) if isinstance(reserve, float) and reserve.is_integer() else str(reserve)
    flags += ["--reserve-vram", gb_text]
    attention = args.get("attentionMode") if args.get("attentionMode") in ATTENTION_MODES else "pytorch-cross-attention"
    if attention == "pytorch-cross-attention":
        flags.append("--use-pytorch-cross-attention")
    return " ".join(flags)


def engine_launch_args(manifest: dict | None = None) -> str:
    """启动参数串(Desktop 式唯一真源);旧 dict 读侧翻译,空串=纯默认端口/监听。"""
    manifest = manifest if manifest is not None else load_manifest()
    engine = manifest.get("engine") if isinstance(manifest.get("engine"), dict) else {}
    raw = engine.get("launchArgs")
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, dict):
        return legacy_launch_flags(raw)
    return DEFAULT_LAUNCH_ARGS_STRING


def engine_env_vars(manifest: dict | None = None) -> dict:
    """环境变量表(spawn 时注入引擎进程;值本机明文,UI 侧遮蔽展示)。"""
    manifest = manifest if manifest is not None else load_manifest()
    engine = manifest.get("engine") if isinstance(manifest.get("engine"), dict) else {}
    env = engine.get("envVars") if isinstance(engine.get("envVars"), dict) else {}
    return {str(key): str(value) for key, value in env.items()}


def engine_port_conflict_policy(manifest: dict | None = None) -> str:
    """端口冲突策略:用户串写死的端口被占时,auto-shift=顺延冷门空口(默认,现状);fail=报错。"""
    manifest = manifest if manifest is not None else load_manifest()
    engine = manifest.get("engine") if isinstance(manifest.get("engine"), dict) else {}
    policy = engine.get("portConflictPolicy")
    return policy if policy in ("auto-shift", "fail") else "auto-shift"


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
