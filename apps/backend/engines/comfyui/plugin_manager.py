"""ComfyUI 插件管理器(一期后端流 A)——安装五步/卸载扫描/依赖账本/体检/目录。

裁定 5:插件 = 目录 + 账本管理,依赖 = 预检 + 计数 + 可复位。
安装五步:git clone(或 Registry zip)→ 解析 requirements → 冲突预检(大白话)
→ 引擎 venv pip install → 重启 + /object_info 前后差分(「新增 N 个节点」才算成功)。
撞已有目录:账本在册=已装死锁提示(走卸载重装);账本外=收编登记(不删不重拉,
09-19 根修——实弹 Rebalance-Pack 手动克隆在册前重装无从自救)。
卸载:扫用户工作流库(class_type 精确匹配)→ 引用清单 → 删目录 → 依赖引用计数
清理(无人引用且非核心层)→ 重启验证。

数据源三层:策展清单(本目录 curated_plugins.json,license 经 GitHub API 实查)
→ ComfyUI Registry API(api.comfy.org,过滤 Flagged 版本,带超时重试)
→ 任意 git URL/本地路径(高级,带第三方代码警告)。
GPL 红线:与外部代码的全部交互 = git/pip/HTTP/zip 解压,零代码拷贝。
"""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from urllib import error, request

from engines.comfyui import manifest as cm
from engines.comfyui.engine_manager import (
    EngineOpError,
    _git,
    _pip,
    diff_node_sets,
    engine_manager,
    jobs,
    urlopen_outbound,
)

CURATED_PLUGINS_PATH = Path(__file__).resolve().parent / "curated_plugins.json"
REGISTRY_BASE = "https://api.comfy.org"
REGISTRY_TIMEOUT_S = 8.0
REGISTRY_RETRIES = 2


# ── 纯函数:requirements / freeze 解析(单测覆盖) ───────────────────
def normalize_pkg(name: str) -> str:
    """PEP 503 规范名(大小写与 -/_ 统一)。"""
    return re.sub(r"[-_.]+", "-", name.strip()).lower()


def parse_requirements(text: str) -> tuple[list[dict], list[str]]:
    """解析插件 requirements.txt → (依赖列表, 警告列表)。

    每项 {"name": 规范名, "spec": 版本区间串(未钉版=""), "raw": 原文}。
    注释/空行跳过;-r/--opt 行进警告(预检保守忽略,安装仍由 pip 处理);
    环境标记(; python_version…)记录进 spec 但预检按无标记近似评估。
    """
    reqs: list[dict] = []
    warnings: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        # VCS/URL 直接依赖(git+https://…,实弹=Impact-Pack 的 sam2 行):保留原文
        # 交给 pip 安装;预检无版本区间可析(spec 置空跳过冲突判定)。此前按
        # 普通行解析会把 URL 切成「包名 git + 区间 +https://…」,SpecifierSet
        # 直接 Invalid specifier 炸掉整条安装链(09-19 根修)。
        if re.match(r"^(git|hg|svn|bzr)\+|^https?://", line):
            tail = re.sub(r"(?:\.git)?/?$", "", line.rstrip("/").split("/")[-1])
            reqs.append({"name": normalize_pkg(tail or "vcs-dep"), "spec": "", "raw": raw_line})
            continue
        if line.startswith("-r") or line.startswith("--"):
            warnings.append(f"requirements 里的 {line.split()[0]} 行由 pip 自行处理,预检未覆盖")
            continue
        # 剥离行内注释(仅当 # 前有空白,避免误伤 URL 片段)
        line = re.split(r"\s+#", line)[0].strip()
        name, spec = _split_req(line)
        if not name:
            warnings.append(f"无法解析的依赖行: {raw_line}")
            continue
        reqs.append({"name": normalize_pkg(name), "spec": spec, "raw": raw_line})
    return reqs, warnings


def _split_req(line: str) -> tuple[str, str]:
    # 依次在 [extras] 与版本操作符处切分:name[extra]>=x,<y ; marker
    line = line.split(";", 1)[0].strip()  # 环境标记预检忽略
    match = re.match(r"^([A-Za-z0-9._\-]+)(\[[^]]*\])?\s*(.*)$", line)
    if not match:
        return "", ""
    return match.group(1), match.group(3).strip()


def parse_freeze(text: str) -> dict[str, str]:
    """pip freeze 文本 → {规范名: 版本};跳过 -e/@ file 与注释行。"""
    frozen: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("-", "@", "#")):
            continue
        if "==" not in line:
            continue
        name, _, version = line.partition("==")
        frozen[normalize_pkg(name)] = version.strip()
    return frozen


# ── 纯函数:依赖冲突预检(单测覆盖;版本区间解析用 packaging) ────────
def _candidate_versions(spec: str) -> list[str]:
    """从版本区间构造候选版本(边界值±一个 patch/minor),近似可满足性判定。"""
    from packaging.version import Version, InvalidVersion

    candidates: list[str] = []
    for op, ver in re.findall(r"(===|==|!=|~=|>=|<=|>|<)\s*([0-9][0-9A-Za-z.\-]*)", spec):
        try:
            version = Version(ver)
        except InvalidVersion:
            continue
        candidates.append(str(version))
        parts = [version.epoch, version.release[0] if version.release else 0]
        if len(version.release) >= 2:
            base = ".".join(str(p) for p in version.release[:2])
            candidates += [f"{base}.{(version.release[1] if len(version.release) < 3 else version.release[2]) + 1}"]
        try:
            bumped = list(version.release)
            if bumped:
                bumped[-1] += 1
            candidates.append(".".join(str(p) for p in bumped))
            lowered = list(version.release)
            if lowered and lowered[-1] > 0:
                lowered[-1] -= 1
                candidates.append(".".join(str(p) for p in lowered))
        except Exception:
            continue
    return list(dict.fromkeys(candidates))


def specs_compatible(spec_a: str, spec_b: str) -> bool:
    """两个版本区间是否存在公共可装版本(候选构造近似解,预检够用)。"""
    from packaging.specifiers import SpecifierSet
    from packaging.version import Version, InvalidVersion

    set_a, set_b = SpecifierSet(spec_a or ""), SpecifierSet(spec_b or "")
    candidates = set(_candidate_versions(spec_a)) | set(_candidate_versions(spec_b))
    for raw in candidates:
        try:
            version = Version(raw)
        except InvalidVersion:
            continue
        if version in set_a and version in set_b:
            return True
    # 无边界信息(如一方为空)一律视为兼容,pip 装的时候自然裁决
    return not spec_a or not spec_b


def check_dependency_conflicts(new_reqs: list[dict], installed: dict[str, str],
                               plugin_locks: dict[str, dict[str, str]]) -> list[dict]:
    """装前冲突预检:新要求 vs 已装环境 vs 账本内各插件锁定范围。

    plugin_locks: {插件目录: {包名: 版本区间}}。返回大白话冲突清单:
    「插件要 numpy>=1.26,已装的插件B锁定 <1.24,两者不能共存」。
    """
    from packaging.specifiers import SpecifierSet
    from packaging.version import Version, InvalidVersion

    merged: dict[str, str] = {}
    for req in new_reqs:
        name, spec = req["name"], req.get("spec") or ""
        if name in merged and merged[name] and spec:
            merged[name] = f"{merged[name]},{spec}"
        elif spec:
            merged[name] = merged.get(name, "") + spec if name in merged else spec
        else:
            merged.setdefault(name, "")

    conflicts: list[dict] = []
    for name, spec in merged.items():
        if not spec:
            continue
        new_set = SpecifierSet(spec)
        current = installed.get(name)
        if current:
            try:
                if Version(current) not in new_set:
                    conflicts.append({
                        "type": "installed", "package": name, "spec": spec, "installed": current,
                        "message": f"要装 {name}{spec},但当前环境已是 {current},强行安装会破坏现有环境",
                    })
                    continue
            except InvalidVersion:
                pass
        for other_dir, locks in plugin_locks.items():
            other_spec = locks.get(name) or locks.get(name.lower())
            if not other_spec:
                continue
            if not specs_compatible(spec, other_spec):
                conflicts.append({
                    "type": "plugin", "package": name, "spec": spec,
                    "otherPlugin": other_dir, "otherSpec": other_spec,
                    "message": f"要装 {name}{spec},已装的插件「{other_dir}」锁定 {other_spec},两者不能共存",
                })
    return conflicts


# ── 纯函数:工作流 JSON 解析(class_type 扫描,单测覆盖) ─────────────
def parse_workflow_json(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def workflow_node_types(obj) -> set[str]:
    """工作流用到的节点类型:API 格式(顶层 {id:{class_type}})与 UI 格式({nodes:[{type}]})都吃。"""
    types: set[str] = set()
    if not isinstance(obj, dict):
        return types
    if isinstance(obj.get("nodes"), list):  # UI 格式
        for node in obj["nodes"]:
            if isinstance(node, dict) and isinstance(node.get("type"), str):
                types.add(node["type"])
        return types
    for node in obj.values():  # API 格式
        if isinstance(node, dict) and isinstance(node.get("class_type"), str):
            types.add(node["class_type"])
    return types


# API 格式顶层的非节点键(ComfyUI 导出的 _meta 等;09-08 加固③)
_API_NON_NODE_KEYS = frozenset({"_meta"})


def workflow_node_count(obj) -> int:
    """节点数:UI 格式按 nodes 数组长度;API 格式按顶层键数扣掉 _meta 等非节点键。

    09-08 加固③:此前只数「带 class_type 的顶层值」,节点字典形状稍有出入
    就漏计(列表页 API 格式 nodeCount 恒 0 的粗算来源);键数口径与 ComfyUI
    官方 API 格式导出的编号键一一对应。
    """
    if not isinstance(obj, dict):
        return 0
    if isinstance(obj.get("nodes"), list):
        return len(obj["nodes"])
    return sum(1 for key in obj if key not in _API_NON_NODE_KEYS)


# ── 策展清单 + Registry 目录 ───────────────────────────────────────
def load_curated() -> list[dict]:
    try:
        data = json.loads(CURATED_PLUGINS_PATH.read_text(encoding="utf-8"))
        return data.get("plugins", []) if isinstance(data, dict) else []
    except (OSError, json.JSONDecodeError):
        return []


def _registry_get(path: str, params: dict | None = None, timeout: float = REGISTRY_TIMEOUT_S):
    url = f"{REGISTRY_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    last_error: Exception | None = None
    for _ in range(REGISTRY_RETRIES):
        try:
            req = request.Request(url, headers={"User-Agent": "MYStudio-comfy-host/1.0"})
            with urlopen_outbound(req, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (OSError, error.URLError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(0.5)
    raise EngineOpError(f"ComfyUI 插件市场暂时连不上(已重试): {last_error}")


def _registry_entry(node: dict) -> dict | None:
    latest = node.get("latest_version")
    if isinstance(latest, dict) and str(latest.get("status", "")).lower() == "flagged":
        return None  # design 十节:过滤 Flagged 版本
    publisher = node.get("publisher") or {}
    return {
        "id": node.get("id"), "name": node.get("name") or node.get("id"),
        "desc": (node.get("description") or "")[:200],
        "repo": node.get("repository"), "author": (publisher or {}).get("name") if isinstance(publisher, dict) else None,
        "downloads": node.get("downloads"), "stars": node.get("github_stars"),
        "version": latest.get("version") if isinstance(latest, dict) else None,
        # Registry 的 license 字段=仓库内 LICENSE 路径,非 SPDX 名(design 十节陷阱),
        # 策展清单才有实查 license;此处留 null 由前端展示「见仓库」
        "license": None, "source": "registry", "verified": False,
    }


def _installed_in_ledger(ledger: dict, plugin_id: str | None, repo: str | None,
                         dir_name: str | None = None,
                         physical_dirs: set[str] | None = None) -> bool:
    """市场行已装判定(09-19 根修):台账键=安装目录名,与清单 id/Registry id 未必同名。

    实弹:策展 id=ComfyUI-ConditioningKrea2Rebalance 而装出的目录名=Rebalance-Pack
    (dirName 派生自仓库尾段),单一 id 比对让已装插件在市场恒显「可安装」,点安装
    又撞「插件目录已存在」死锁。比对五路:id 归一化小写(09-10 Registry 大小写
    不一案)/ 显式 dir 字段 / 仓库尾段目录名(安装 dirName 的派生源)/ 台账记录
    的仓库地址(收编自旧库、目录名完全走样时兜底)/ custom_nodes 实际目录深查
    (09-19 二段根修:只查台账会漏掉 ComfyUI-Manager 网页端装的、手动克隆的、
    账本丢失的插件——磁盘上有目录就是已装,深度查本地而非只查账)。
    """
    keys_lower = {key.lower() for key in ledger}
    local_dirs = keys_lower | (physical_dirs or set())
    if (dir_name and dir_name.lower() in local_dirs) or str(plugin_id or "").lower() in local_dirs:
        return True
    repo_key = _normalize_repo(repo or "")
    if not repo_key:
        return False
    if _plugin_dir_name(repo or "").lower() in local_dirs:
        return True
    return any(_normalize_repo(str(entry.get("repo") or "")) == repo_key
               for entry in ledger.values())


def _physical_plugin_dirs() -> set[str]:
    """custom_nodes 实际目录名集合(小写;深查本地安装态用)。

    排除:隐藏目录/__pycache__/自研节点包 my-nodes(含旧名 manying-nodes,
    由同步链管理不属于插件市场)——它们在磁盘上但不是「插件」。
    """
    nodes = cm.custom_nodes_dir()
    if not nodes.is_dir():
        return set()
    return {
        entry.name.lower()
        for entry in nodes.iterdir()
        if entry.is_dir()
        and not entry.name.startswith(".")
        and entry.name not in (MY_DIR, LEGACY_MY_DIR, "__pycache__")
    }


def catalog_search(query: str, limit: int = 40) -> dict:
    """策展 + Registry 合并;离线时仅返回策展(大白话注明)。"""
    ledger = cm.plugin_ledger()
    physical_dirs = _physical_plugin_dirs()
    q = (query or "").strip().lower()
    curated = []
    for entry in load_curated():
        haystack = f"{entry.get('id','')} {entry.get('name','')} {entry.get('desc_zh','')} {entry.get('category','')}".lower()
        if q and q not in haystack:
            continue
        curated.append({**entry, "source": "curated", "verified": True,
                        "installed": _installed_in_ledger(
                            ledger, entry.get("id"), entry.get("repo"), entry.get("dir"),
                            physical_dirs=physical_dirs)})
    registry: list[dict] = []
    registry_error: str | None = None
    try:
        payload = _registry_get("/nodes/search", {"search": query or "", "limit": min(100, max(1, limit))})
        for node in payload.get("nodes", [])[:limit]:
            entry = _registry_entry(node)
            if entry:
                entry["installed"] = _installed_in_ledger(
                    ledger, entry.get("id"), entry.get("repo"), physical_dirs=physical_dirs)
                registry.append(entry)
    except EngineOpError as exc:
        registry_error = str(exc)
    return {"query": query, "curated": curated, "registry": registry, "registryError": registry_error}


# ── 插件生命周期 ───────────────────────────────────────────────────
def _plugin_dir_name(repo_or_url: str) -> str:
    tail = repo_or_url.rstrip("/").split("/")[-1]
    return re.sub(r"\.git$", "", tail) or f"plugin-{uuid.uuid4().hex[:6]}"


def _plugin_nodes_map(manifest: dict | None = None) -> dict[str, str]:
    """节点类型 → 插件目录(账本 nodes 反查,缺失插件标记/卸载扫描用)。"""
    mapping: dict[str, str] = {}
    for plugin_dir, entry in cm.plugin_ledger(manifest).items():
        for node_type in (entry.get("nodes") or []):
            mapping[node_type] = plugin_dir
    return mapping


def _safe_plugin_id(plugin_id: str) -> str:
    if not re.fullmatch(r"[0-9A-Za-z._\-]+", plugin_id or ""):
        raise EngineOpError("无效的插件目录名")
    return plugin_id


def install_plugin_job(source: str, ref: str, dry_run: bool = False) -> dict:
    """安装五步入口。dry_run=True 只做预检(同步返回冲突报告,不落盘)。"""
    if source not in ("curated", "registry", "git", "local"):
        raise EngineOpError(f"未知安装来源: {source}(支持 curated/registry/git/local)")
    if not cm.engine_installed():
        raise EngineOpError("ComfyUI 引擎尚未安装,请先在引擎卡安装引擎")
    if not ref:
        raise EngineOpError("缺少插件标识(ref)")
    plan = _resolve_plan(source, ref)
    if dry_run:
        return {"plan": plan, "conflicts": _preflight(plan)}
    # 深查本地·安装前 fail-fast(09-19):台账在册直接拒——不启 doomed job 白转
    # 一圈才在第一步报「目录已存在」;账本外磁盘目录由 _install_job 收编(不删不重拉)。
    if plan["dirName"] in cm.plugin_ledger():
        raise EngineOpError(f"插件已装过({plan['dirName']});如需重装请先在已装列表卸载")
    if jobs.active_of("plugin-install"):
        raise EngineOpError("已有插件正在安装,请等待完成")
    job_id = jobs.create("plugin-install", f"安装插件 {plan['dirName']}")
    jobs.start(job_id, lambda jid: _install_job(jid, plan))
    return {"jobId": job_id, "plan": {k: plan[k] for k in ("dirName", "source", "repo", "name") if plan.get(k)}}


def _resolve_plan(source: str, ref: str) -> dict:
    if source == "curated":
        entry = next((c for c in load_curated() if c.get("id") == ref), None)
        if not entry:
            raise EngineOpError(f"策展清单里没有这个插件: {ref}")
        return {"dirName": _plugin_dir_name(entry["repo"]), "repo": entry["repo"], "name": entry.get("name"),
                "source": "curated", "zipUrl": None, "registryId": None, "localPath": None}
    if source == "registry":
        detail = _registry_get(f"/nodes/{urllib.parse.quote(ref)}")
        if not detail.get("id"):
            raise EngineOpError(f"插件市场查无此插件: {ref}")
        install_info = _registry_get(f"/nodes/{urllib.parse.quote(ref)}/install")
        zip_url = install_info.get("downloadUrl")
        if not zip_url:
            raise EngineOpError("插件市场没有返回下载地址,请改用 git 安装")
        return {"dirName": _plugin_dir_name(detail.get("repository") or str(ref)), "repo": detail.get("repository"),
                "name": detail.get("name"), "source": "registry", "zipUrl": zip_url,
                "registryId": str(ref), "version": install_info.get("version"),
                "registryDeps": install_info.get("dependencies") or [], "localPath": None}
    if source == "git":
        if not re.match(r"^https?://", ref):
            raise EngineOpError("git 地址必须是 http(s):// 开头的完整 URL")
        return {"dirName": _plugin_dir_name(ref), "repo": ref, "name": _plugin_dir_name(ref),
                "source": "git", "zipUrl": None, "registryId": None, "localPath": None,
                "riskWarning": "第三方代码警告:任意 git 地址的插件未经审核,请确认来源可信"}
    # local:从旧环境迁插件的通用通道(显式复制,不绑定外部目录)
    local_path = Path(ref).expanduser()
    if not local_path.is_absolute() or not local_path.is_dir():
        raise EngineOpError("本地插件路径必须是绝对路径且指向目录")
    return {"dirName": local_path.name, "repo": None, "name": local_path.name, "source": "local",
            "zipUrl": None, "registryId": None, "localPath": str(local_path),
            "riskWarning": "本地插件为第三方代码,安装前请确认来源可信"}


def _plugin_requirements(plan: dict) -> tuple[list[dict], list[str]]:
    """安装素材到位后解析 requirements;registry 无 requirements 时用元数据依赖。"""
    req_file = cm.custom_nodes_dir() / plan["dirName"] / "requirements.txt"
    if req_file.is_file():
        return parse_requirements(req_file.read_text(encoding="utf-8", errors="replace"))
    if plan.get("registryDeps"):
        reqs = []
        warnings: list[str] = []
        for dep in plan["registryDeps"]:
            name, spec = _split_req(str(dep))
            if name:
                reqs.append({"name": normalize_pkg(name), "spec": spec, "raw": str(dep)})
        return reqs, warnings
    return [], []


def _preflight(plan: dict) -> list[dict]:
    reqs, _ = _plugin_requirements(plan)
    installed = parse_freeze("\n".join(engine_manager().venv_freeze()))
    locks = {
        plugin_dir: {normalize_pkg(name): spec for name, spec in (entry.get("deps") or {}).items()}
        for plugin_dir, entry in cm.plugin_ledger().items()
    }
    return check_dependency_conflicts(reqs, installed, locks)


def _install_job(job_id: str, plan: dict) -> None:
    target = cm.custom_nodes_dir() / plan["dirName"]
    engine = engine_manager()
    jobs.update(job_id, progress=3, step="preflight", message="安装前检查…")
    adopted = False
    if target.exists():
        if plan["dirName"] in cm.plugin_ledger():
            raise EngineOpError(f"插件已装过({plan['dirName']});如需重装请先在已装列表卸载")
        # 账本外已有同名目录(手动克隆/上次安装断在 clone 之后):收编登记而非
        # 报错死锁——卸载只认账本,用户无从自救;目录不删不重拉,直接走后续链
        adopted = True

    jobs.update(job_id, progress=6, step="snapshot", message="安装前快照账本(失败可回滚)…")
    snapshot_id = engine.create_snapshot(reason=f"plugin-install:{plan['dirName']}", full=False)
    freeze_before = parse_freeze("\n".join(engine.venv_freeze()))

    if adopted:
        jobs.update(job_id, progress=10, step="acquire", message="收编本机已有目录…")
    else:
        jobs.update(job_id, progress=10, step="acquire", message="获取插件文件…")
        _acquire(plan, target)

    jobs.update(job_id, progress=32, step="requirements", message="解析依赖清单…")
    reqs, req_warnings = _plugin_requirements(plan)
    if reqs:
        jobs.update(job_id, progress=36, step="preflight", message="依赖冲突预检…")
        installed = parse_freeze("\n".join(engine.venv_freeze()))
        locks = {
            plugin_dir: {normalize_pkg(name): spec for name, spec in (entry.get("deps") or {}).items()}
            for plugin_dir, entry in cm.plugin_ledger().items() if plugin_dir != plan["dirName"]
        }
        conflicts = check_dependency_conflicts(reqs, installed, locks)
        if conflicts:
            detail = ";".join(c["message"] for c in conflicts)
            raise EngineOpError(f"依赖冲突,已取消安装: {detail}")

    jobs.update(job_id, progress=40, step="pip", message="安装插件依赖到引擎虚拟环境…")
    if reqs:
        _pip(["install", *[r["raw"] for r in reqs]],
             on_line=lambda line: jobs.update(job_id, tail_line=line))

    jobs.update(job_id, progress=70, step="restart", message="重启引擎并校验新节点…")
    nodes_before = engine._safe_node_names()
    engine.restart(progress=lambda pct, msg: jobs.update(job_id, progress=70 + pct * 20 // 100, message=msg))
    nodes_after = engine.object_info_names()
    diff = diff_node_sets(nodes_before, nodes_after)

    freeze_after = parse_freeze("\n".join(engine.venv_freeze()))
    installed_deps = {
        req["name"]: freeze_after.get(req["name"], "") for req in reqs if req["name"] in freeze_after
    }
    commit = _git(["rev-parse", "HEAD"], cwd=target, timeout=30.0) if (target / ".git").is_dir() else None

    def _record(manifest: dict) -> None:
        manifest["plugins"][plan["dirName"]] = {
            "repo": plan.get("repo"), "commit": (commit or "").strip() or None,
            "source": plan["source"], "version": plan.get("version") or (commit or "")[:8] or None,
            "installedAt": cm.timestamp_ms(), "snapshot": snapshot_id,
            "deps": installed_deps, "nodes": diff["added"],
            "warnings": req_warnings, "adopted": adopted,
        }

    cm.mutate_manifest(_record)
    # 新装/收编即最新:同款缓存写入(安装时刻的 HEAD 即当时最新)
    _mark_repo_latest(plan.get("repo"), commit)
    jobs.update(job_id, result={
        "plugin": plan["dirName"], "addedNodes": diff["addedCount"], "nodeTypes": diff["added"][:200],
        "adopted": adopted,
        "message": (f"已收编本机已有目录并登记:{plan['name'] or plan['dirName']}"
                    if adopted else f"安装成功:{plan['name'] or plan['dirName']}")
                   + f" 新增 {diff['addedCount']} 个节点",
    })


def _acquire(plan: dict, target: Path) -> None:
    if plan["source"] == "registry":
        # Registry zip 通道(git 外备选)
        with tempfile.TemporaryDirectory(prefix="comfy-plugin-") as tmp:
            zip_path = Path(tmp) / "node.zip"
            req = request.Request(plan["zipUrl"], headers={"User-Agent": "MYStudio-comfy-host/1.0"})
            with urlopen_outbound(req, timeout=300.0) as response, open(zip_path, "wb") as fh:
                shutil.copyfileobj(response, fh)
            _extract_plugin_zip(zip_path, target)
        return
    if plan["source"] == "local":
        shutil.copytree(plan["localPath"], target)
        return
    _git(["clone", "--depth", "1", plan["repo"], str(target)], timeout=1800.0)


def _extract_plugin_zip(zip_path: Path, target: Path) -> None:
    """解压 Registry zip 到插件目录(防 Zip Slip 路径穿越;剥掉外层单目录)。"""
    with tempfile.TemporaryDirectory(prefix="comfy-unzip-") as tmp:
        tmp_dir = Path(tmp)
        with zipfile.ZipFile(zip_path) as zf:
            for member in zf.namelist():
                member_path = (tmp_dir / member).resolve()
                if not str(member_path).startswith(str(tmp_dir.resolve())):
                    raise EngineOpError("压缩包内有可疑路径,已拒绝安装")
            zf.extractall(tmp_dir)
        roots = [p for p in tmp_dir.iterdir()]
        root = roots[0] if len(roots) == 1 and roots[0].is_dir() else tmp_dir
        shutil.copytree(root, target)


# -- 卸载:引用扫描 → 确认 → 删目录 → 引用计数 → 重启验证 ─────────────
def plugin_references(plugin_id: str) -> dict:
    plugin_id = _safe_plugin_id(plugin_id)
    entry = cm.plugin_ledger().get(plugin_id)
    if not entry:
        raise EngineOpError(f"账本里没有这个插件: {plugin_id}")
    node_types = set(entry.get("nodes") or [])
    return {
        "plugin": plugin_id, "nodeTypes": sorted(node_types),
        "referencedBy": scan_workflow_references(node_types),
    }


def scan_workflow_references(node_types: set[str]) -> list[dict]:
    """扫自管工作流库,列出用了这些节点类型的工作流(卸载杀手锏)。"""
    if not node_types:
        return []
    references = []
    for wf in _iter_workflow_files():
        obj = parse_workflow_json(wf.read_text(encoding="utf-8", errors="replace"))
        used = sorted(workflow_node_types(obj) & node_types)
        if used:
            references.append({"workflow": wf.relative_to(cm.workflows_dir()).as_posix(), "usedTypes": used})
    return references


def merge_legacy_workflows_dir() -> list[str]:
    """旧默认库(<home>/workflows)非破坏并入当前库(同名不覆盖,旧文件不动)。

    09-09 存量迁移链打通:库目录统一为 ComfyUI 原生用户工作流目录后,
    老装机旧库里可能还有种子模板/早期导入——首次库操作时并入一次(幂等)。
    """
    old = cm.legacy_workflows_dir()
    new = cm.workflows_dir()
    if old == new or not old.is_dir():
        return []
    copied: list[str] = []
    for src in sorted(old.rglob("*.json")):
        if not src.is_file():
            continue
        rel = src.relative_to(old)
        dest = new / rel
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied.append(rel.as_posix())
    return copied


def _iter_workflow_files():
    merge_legacy_workflows_dir()  # 库读取咽喉:顺手并入旧库(幂等,stat 级开销)
    root = cm.workflows_dir()
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob("*.json") if p.is_file())


def uninstall_plugin_job(plugin_id: str) -> str:
    plugin_id = _safe_plugin_id(plugin_id)
    if plugin_id not in cm.plugin_ledger():
        raise EngineOpError(f"账本里没有这个插件: {plugin_id}")
    job_id = jobs.create("plugin-uninstall", f"卸载插件 {plugin_id}")
    jobs.start(job_id, lambda jid: _uninstall_job(jid, plugin_id))
    return job_id


def _uninstall_job(job_id: str, plugin_id: str) -> None:
    engine = engine_manager()
    entry = cm.plugin_ledger().get(plugin_id) or {}
    jobs.update(job_id, progress=10, step="snapshot", message="卸载前快照账本…")
    engine.create_snapshot(reason=f"plugin-uninstall:{plugin_id}", full=False)

    jobs.update(job_id, progress=30, step="remove", message="删除插件目录…")
    target = cm.custom_nodes_dir() / plugin_id
    shutil.rmtree(target, ignore_errors=True)

    # 依赖引用计数清理:核心层与其它插件仍引用的包不动;其余 pip 卸载
    jobs.update(job_id, progress=50, step="deps", message="清理无人引用的依赖…")
    removed_deps: list[str] = []
    if entry.get("deps"):
        manifest = cm.load_manifest()
        core = cm.core_dep_names(manifest)
        still_needed: set[str] = set(core)
        for other_dir, other in cm.plugin_ledger(manifest).items():
            if other_dir == plugin_id:
                continue
            still_needed.update(normalize_pkg(name) for name in (other.get("deps") or {}))
        for dep in entry["deps"]:
            dep_name = normalize_pkg(dep)
            if dep_name not in still_needed:
                _pip(["uninstall", "-y", dep_name])
                removed_deps.append(dep_name)

    cm.mutate_manifest(lambda m: m["plugins"].pop(plugin_id, None))
    jobs.update(job_id, progress=70, step="restart", message="重启引擎并验证节点消失…")
    nodes_before = engine._safe_node_names()
    engine.restart(progress=lambda pct, msg: jobs.update(job_id, progress=70 + pct * 20 // 100, message=msg))
    nodes_after = engine.object_info_names()
    diff = diff_node_sets(nodes_before, nodes_after)
    jobs.update(job_id, result={
        "plugin": plugin_id, "removedDeps": removed_deps,
        "nodesGone": sorted(set(entry.get("nodes") or []) - nodes_after),
        "message": f"已卸载 {plugin_id};清理依赖 {len(removed_deps)} 个,消失节点 {diff['removedCount']} 个",
    })


# ── ComfyUI-Manager 运行时组件(pip 线,09-11 适配 4.x)──────────────────
# Manager 已转 pip 分发(引擎 venv 内 comfyui-manager 包),不走插件台账/git;
# 在插件列表以合成行露面,更新钮走 venv pip 升级链(用户手动操作,09-11 裁定)。
PIP_MANAGER_ID = "comfyui-manager"
PIP_MANAGER_PACKAGE = "comfyui-manager"


def _venv_metadata_version(package: str) -> str | None:
    import subprocess

    exe = cm.comfy_home() / "venv" / "bin" / "python"
    try:
        result = subprocess.run(
            [str(exe), "-c",
             f"import importlib.metadata; print(importlib.metadata.version('{package}'))"],
            capture_output=True, text=True, timeout=15,
        )
        version = result.stdout.strip()
        return version or None
    except Exception:
        return None


def _pip_manager_row() -> dict | None:
    """Manager 合成行:已 pip 安装才露面(版本本地可查;最新版交给更新链报告)。"""
    version = _venv_metadata_version(PIP_MANAGER_PACKAGE)
    if not version:
        return None
    return {
        "id": PIP_MANAGER_ID,
        "name": "ComfyUI-Manager",
        "desc": "插件与模型管理器(引擎运行时组件,pip 分发线)——更新走 pip 升级",
        "license": None,
        "state": "installed",
        "version": version,
        "latestVersion": None,
        "deps": [],
        "author": None,
        "stars": None,
        "source": "pip",
        "repo": "https://github.com/Comfy-Org/ComfyUI-Manager",
        "nodeCount": None,
        "dirExists": True,
    }


def _update_pip_manager_job(job_id: str) -> None:
    engine = engine_manager()
    jobs.update(job_id, progress=20, step="pip", message="pip 升级 comfyui-manager…")
    _pip(["install", "--upgrade", PIP_MANAGER_PACKAGE])
    version = _venv_metadata_version(PIP_MANAGER_PACKAGE) or "?"
    jobs.update(job_id, progress=70, step="restart", message="重启引擎并校验…")
    engine.restart(progress=lambda pct, msg: jobs.update(job_id, progress=70 + pct * 20 // 100, message=msg))
    jobs.update(job_id, result={
        "plugin": PIP_MANAGER_ID, "version": version,
        "message": f"ComfyUI-Manager 已升级/确认最新:{version}",
    })


def update_plugin_job(plugin_id: str) -> str:
    plugin_id = _safe_plugin_id(plugin_id)
    # Manager 运行时组件(pip 线):不走台账/git,直接 pip 升级链
    if plugin_id == PIP_MANAGER_ID:
        if not _venv_metadata_version(PIP_MANAGER_PACKAGE):
            raise EngineOpError("comfyui-manager 未安装在引擎环境(可能已回退 git 版)")
        job_id = jobs.create("plugin-update", "更新 ComfyUI-Manager")
        jobs.start(job_id, lambda jid: _update_pip_manager_job(jid))
        return job_id
    entry = cm.plugin_ledger().get(plugin_id)
    if not entry:
        raise EngineOpError(f"账本里没有这个插件: {plugin_id}")
    # 拉取资格按「目录里有无 git 历史」判,不看台账 source 标记(09-11 用户裁定:
    # 不是最新的插件要有可点的「更新」按钮——自旧库收编的 local 源带着完整
    # .git(如 ComfyUI-Manager),一刀切拒收会让可更新行的按钮点了就报错)
    if not (cm.custom_nodes_dir() / plugin_id / ".git").exists():
        raise EngineOpError("该插件没有 git 历史可拉取(Registry zip/裸目录安装),请卸载后重装新版")
    job_id = jobs.create("plugin-update", f"更新插件 {plugin_id}")
    jobs.start(job_id, lambda jid: _update_plugin_job(jid, plugin_id))
    return job_id


def _backup_local_patches(target: Path, plugin_id: str, porcelain: str) -> Path | None:
    """插件本地改动备份到快照区(带时间戳目录);返回备份目录,无文件命中返回 None。

    实弹(09-19 第三层):Minimax H3 超分插件带用户本地补丁
    (nodes/minimax_h3_latent_upscaler_3d.py),git 保护性拒绝 merge 覆盖
    「Your local changes … would be overwritten by merge」——更新链死锁。
    处置=备份后硬更新:补丁零丢失,事后可对照回贴;上游新版可能已含等效修复。
    """
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = cm.snapshots_dir() / "plugin-patches" / plugin_id / stamp
    copied = False
    for line in porcelain.splitlines():
        # porcelain 行=「XY 路径」;rename 形如「R  旧 -> 新」取两侧都试
        for raw in line[3:].split("->"):
            path = raw.strip().strip('"')
            src = target / path
            if path and not path.startswith("..") and src.is_file():
                dest = backup_dir / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                copied = True
    return backup_dir if copied else None


def _mark_repo_latest(repo: str | None, commit: str | None) -> None:
    """装/更成功后,把刚拉到的 HEAD 记为该仓库的最新版缓存。

    09-19 实弹根修:GitHub 最新版缓存 24h TTL,更新成功后不作废——上游在
    缓存期内推过新提交时,刚更新完的插件(next list_plugins)仍拿旧
    latestSha 比对,胶囊恒显「可更新」、点了更新也「状态不变」。拉取时刻
    的 HEAD 即当时的最新真值,写入缓存零额外 API 调用;上游再动交给 TTL。
    """
    key = _normalize_repo(repo or "")
    if not key or not commit:
        return
    with _meta_file_lock:
        cache = _load_plugin_meta_cache()
        entry = (cache.setdefault("byRepo", {}).get(key)) or {}
        cache["byRepo"][key] = {
            "fetchedAt": int(time.time()),
            "latestTag": entry.get("latestTag"),
            "latestSha": commit,
            "stars": entry.get("stars"),
        }
        _save_plugin_meta_cache(cache)


def _update_plugin_job(job_id: str, plugin_id: str) -> None:
    engine = engine_manager()
    target = cm.custom_nodes_dir() / plugin_id
    if not target.is_dir():
        raise EngineOpError(f"插件目录不存在: {plugin_id}(可能已被手动删除,请跑一次依赖体检)")
    jobs.update(job_id, progress=10, step="snapshot", message="更新前快照…")
    engine.create_snapshot(reason=f"plugin-update:{plugin_id}", full=False)
    # 本地补丁处置:先备份(文件+diff)后还原,拉新版后再尝试自动回贴
    patch_backup = None
    patch_text: str | None = None
    dirty = _git(["status", "--porcelain"], cwd=target, timeout=30.0)
    if dirty.strip():
        jobs.update(job_id, progress=18, step="backup", message="插件有本地改动,先备份再更新…")
        patch_backup = _backup_local_patches(target, plugin_id, dirty)
        patch_text = _git(["diff"], cwd=target, timeout=60.0)
        if patch_backup is not None:
            (patch_backup / "local.patch").write_text(patch_text, encoding="utf-8")
        _git(["checkout", "--", "."], cwd=target, timeout=60.0)
    jobs.update(job_id, progress=25, step="pull", message="拉取插件最新代码…")
    # --force 只作用于 fetch 侧的 ref/tag 对齐:第三方作者常重打 tag,本地旧 tag
    # 与远端冲突时 git 会 "! [rejected] …(would clobber existing tag)" 退出码 1
    # 卡死更新(09-19 实弹);分支合并仍是 --ff-only,本地改动零风险。
    try:
        _git(["pull", "--ff-only", "--force"], cwd=target, timeout=600.0)
    except EngineOpError as exc:
        if "fast-forward" in str(exc) or "diverged" in str(exc):
            raise EngineOpError(
                f"插件历史与上游分叉(作者重写了历史),无法快进更新;请卸载后重装 {plugin_id}"
            ) from exc
        raise
    # 更新后自动回贴本地补丁:实弹(Minimax H3 超分的 mps 支持)本地补丁是
    # 本机功能必需,上游新版无等效实现;git apply 不合身(上游重构)则保持
    # 新版干净态,备份与 diff 都在快照区可手工对照。
    patch_reapplied = False
    if patch_backup is not None and patch_text:
        try:
            _git(["apply", "--whitespace=nowarn", str(patch_backup / "local.patch")],
                 cwd=target, timeout=30.0)
            patch_reapplied = True
        except EngineOpError:
            patch_reapplied = False
    commit = _git(["rev-parse", "HEAD"], cwd=target, timeout=30.0).strip()
    reqs, _ = _plugin_requirements({"dirName": plugin_id})
    if reqs:
        jobs.update(job_id, progress=45, step="pip", message="重装依赖…")
        _pip(["install", *[r["raw"] for r in reqs]], on_line=lambda line: jobs.update(job_id, tail_line=line))
    jobs.update(job_id, progress=70, step="restart", message="重启并校验节点…")
    nodes_before = engine._safe_node_names()
    engine.restart(progress=lambda pct, msg: jobs.update(job_id, progress=70 + pct * 20 // 100, message=msg))
    nodes_after = engine.object_info_names()
    diff = diff_node_sets(nodes_before, nodes_after)
    freeze = parse_freeze("\n".join(engine.venv_freeze()))

    def _record(manifest: dict) -> None:
        item = manifest["plugins"][plugin_id]
        item.update({"commit": commit, "version": commit[:8],
                     "deps": {r["name"]: freeze.get(r["name"], "") for r in reqs if r["name"] in freeze},
                     "nodes": sorted(set(item.get("nodes") or []) | set(diff["added"]))})

    cm.mutate_manifest(_record)
    # 成功即最新:把刚拉到的 HEAD 写进最新版缓存,杜绝「更新完仍可更新」
    _mark_repo_latest((cm.plugin_ledger().get(plugin_id) or {}).get("repo"), commit)
    if patch_backup is None:
        backup_note = ""
    elif patch_reapplied:
        backup_note = f";本地补丁已自动回贴(备份:{patch_backup})"
    else:
        backup_note = f";本地改动未能自动回贴(上游已重构),备份在 {patch_backup} 可手工对照"
    jobs.update(job_id, result={
        "plugin": plugin_id, "commit": commit[:8], "addedNodes": diff["addedCount"],
        "message": f"已更新 {plugin_id} 到 {commit[:8]},新增 {diff['addedCount']} 个节点{backup_note}",
    })


# -- 体检:缺失/漂移/孤儿 ------------------------------------------------
def _is_managed_nodes_dir(name: str) -> bool:
    """自研节点包与非插件目录:my-nodes(含旧名 manying-nodes)由同步链管理、
    __pycache__ 是字节码缓存——它们不是插件,不进孤儿判定也不可被「清理多余」
    删除(09-19 根修:clean_orphan 误删 my-nodes 会当场打掉自研节点,直到下次
    装/更链才补回;doctor 也恒报 __pycache__ 噪音)。"""
    return name in (MY_DIR, LEGACY_MY_DIR, "__pycache__")


def doctor() -> dict:
    import subprocess

    engine = engine_manager()
    manifest = cm.load_manifest()
    ledger = cm.plugin_ledger(manifest)
    missing, drifted = [], []
    try:
        frozen = parse_freeze("\n".join(engine.venv_freeze()))
    except (EngineOpError, OSError, subprocess.TimeoutExpired):
        frozen = None  # venv 缺失/不可读:漂移检查降级,缺失/孤儿照常报告
    for plugin_dir, entry in ledger.items():
        if not (cm.custom_nodes_dir() / plugin_dir).is_dir():
            missing.append({"plugin": plugin_dir, "message": f"插件目录不见了(可能被手动删除),建议卸载后重装"})
            continue
        if frozen is not None:
            for dep, recorded in (entry.get("deps") or {}).items():
                actual = frozen.get(normalize_pkg(dep))
                if actual and recorded and actual != recorded:
                    drifted.append({"plugin": plugin_dir, "package": dep, "recorded": recorded,
                                    "actual": actual, "message": f"{dep} 账本记录 {recorded},实际是 {actual}(被其它插件顶过版本)"})
    ledger_dirs = set(ledger.keys())
    orphan = [
        {"plugin": p.name, "message": "目录在 custom_nodes 里但账本没有记录(手动放入?),引擎会照常加载"}
        for p in sorted(cm.custom_nodes_dir().glob("*"))
        if p.is_dir() and p.name not in ledger_dirs and not p.name.startswith(".") and not _is_managed_nodes_dir(p.name)
    ]
    return {"missing": missing, "drifted": drifted, "orphan": orphan,
            "healthy": not missing and not drifted and not orphan}


def clean_orphan_plugins() -> dict:
    """清理「孤儿」:账本外的 custom_nodes 目录(体检报告的可执行动作,09-08 补口)。

    只删账本没有登记的目录(手动放入的/半装残留);已登记插件一律不动;
    自研节点包 my-nodes 与 __pycache__ 恒不删(同步链管理的非插件目录,09-19)。
    引擎若在跑,目录删除后需重启才彻底卸载——返回值里带提示。
    """
    import shutil
    engine = engine_manager()
    manifest = cm.load_manifest()
    ledger = cm.plugin_ledger(manifest)
    removed, kept = [], []
    for entry in sorted(cm.custom_nodes_dir().glob("*")):
        if not entry.is_dir() or entry.name.startswith(".") or _is_managed_nodes_dir(entry.name):
            continue
        if entry.name in ledger:
            kept.append(entry.name)
            continue
        shutil.rmtree(entry, ignore_errors=True)
        removed.append(entry.name)
    running = engine.is_healthy()
    return {
        "removed": removed,
        "kept": kept,
        "running": running,
        "message": ("已清理 " + "、".join(removed) + ";引擎正在运行,重启引擎后完全生效" if removed and running
                    else ("已清理 " + "、".join(removed) if removed else "没有需要清理的未登记插件")),
    }


# ── 已装插件详情富化:本地四件套 + GitHub 星标缓存 ──────────────────────
# 09-10 实弹:装机行展开全是「作者/下载量 未知、license 未标明、依赖无额外依赖」
# ——台账只记版本坐标不含元数据,策展清单仅 10 件盖不住收编生态。填法:
# 离线四件套(git 作者、pyproject 简介与 license、requirements 依赖、LICENSE
# 文件头嗅探)同步秒回;星标数走 GitHub API(api.github.com/repos,免鉴权 60 次/时)
# 按仓库地址后台线程补缓存(TTL 24h,404 负缓存),list_plugins 本体零联网等待。
# 09-10 晚裁定:下载量退役,显示 GitHub 星标;拉不到的条目前端整行不显示。

_META_CACHE_TTL_S = 24 * 3600
_META_EMPTY_RETRY_S = 6 * 3600
_META_FETCH_TIMEOUT_S = 3.0
_META_FETCH_PER_RUN = 15
_META_FETCH_BUDGET_S = 20.0

_meta_file_lock = threading.Lock()
_registry_refresh_lock = threading.Lock()

_LICENSE_SNIFF_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("AGPL-3.0", ("GNU AFFERO GENERAL PUBLIC LICENSE",)),
    ("GPL-3.0", ("GNU GENERAL PUBLIC LICENSE", "Version 3")),
    ("GPL-2.0", ("GNU GENERAL PUBLIC LICENSE", "Version 2")),
    ("Apache-2.0", ("Apache License", "Version 2.0")),
    ("MIT", ("MIT License",)),
    ("BSD-3-Clause", ("Redistribution and use in source and binary forms",)),
    ("Unlicense", ("free and unencumbered software released into the public domain",)),
]


def sniff_license_spdx(text: str) -> str | None:
    """LICENSE 文件头嗅探 SPDX(常见六种;命中多标记须全中)。"""
    head = (text or "")[:4096].lower()
    for spdx, markers in _LICENSE_SNIFF_RULES:
        if all(marker.lower() in head for marker in markers):
            return spdx
    return None


def parse_requirements_names(text: str) -> list[str]:
    """requirements.txt → 依赖名列表(剥版本规格/注释/选项行)。"""
    names: list[str] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        name = re.split(r"[=<>~;\[\s]", line, maxsplit=1)[0].strip()
        if name:
            names.append(name)
    return names


def _read_pyproject_meta(path: Path) -> tuple[str | None, str | None, str | None]:
    """pyproject [project] → (description, license_spdx, version);license 为 file
    表形态时返回 None(由 LICENSE 嗅探兜底)。老运行时无 tomllib 走正则降级。"""
    try:
        import tomllib  # Python 3.11+;sidecar venv 3.12

        with path.open("rb") as fh:
            project = tomllib.load(fh).get("project") or {}
        license_field = project.get("license")
        spdx = license_field.strip() if isinstance(license_field, str) else None
        return (project.get("description") or None), (spdx or None), (project.get("version") or None)
    except Exception:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            m = re.search(r'^description\s*=\s*"([^"\n]+)"', text, re.M)
            v = re.search(r'^version\s*=\s*"([^"\n]+)"', text, re.M)
            return (m.group(1) if m else None), None, (v.group(1) if v else None)
        except OSError:
            return None, None, None


def _plugin_local_meta(plugin_dir: Path) -> dict:
    """插件目录离线元数据:git 作者+仓库地址、pyproject、requirements、LICENSE。"""
    meta: dict = {"author": None, "repo": None, "desc": None, "license": None,
                  "version": None, "deps": []}
    try:
        author = _git(["log", "-1", "--format=%an"], cwd=plugin_dir, timeout=5.0).strip()
        meta["author"] = author or None
    except Exception:
        pass
    try:
        url = _git(["remote", "get-url", "origin"], cwd=plugin_dir, timeout=5.0).strip()
        meta["repo"] = url or None
    except Exception:
        pass
    pyproject = plugin_dir / "pyproject.toml"
    if pyproject.is_file():
        desc, spdx, version = _read_pyproject_meta(pyproject)
        meta["desc"], meta["license"], meta["version"] = desc, spdx, version
    if not meta["license"]:
        for cand in sorted(plugin_dir.glob("[Ll][Ii][Cc][Ee][Nn][Ss][Ee]*")):
            if cand.is_file():
                spdx = sniff_license_spdx(cand.read_text(encoding="utf-8", errors="ignore"))
                if spdx:
                    meta["license"] = spdx
                    break
    requirements = plugin_dir / "requirements.txt"
    if requirements.is_file():
        try:
            meta["deps"] = parse_requirements_names(
                requirements.read_text(encoding="utf-8", errors="ignore")
            )
        except OSError:
            pass
    return meta


def _normalize_repo(url: str) -> str:
    """仓库地址归一(小写、去 .git 尾与尾斜杠)——Registry 配对与大小写根修同口径。"""
    return (url or "").strip().lower().removesuffix(".git").rstrip("/")


def _plugin_meta_cache_path() -> Path:
    return cm.comfy_home() / "plugin_meta_cache.json"


def _load_plugin_meta_cache() -> dict:
    try:
        data = json.loads(_plugin_meta_cache_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_plugin_meta_cache(cache: dict) -> None:
    try:
        tmp = _plugin_meta_cache_path().with_name("plugin_meta_cache.json.tmp")
        tmp.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_plugin_meta_cache_path())
    except OSError:
        pass


def _repo_owner_name(repo_key: str) -> str | None:
    """仓库地址 → GitHub owner/name(剥 scheme/.git/尾斜杠;host/owner/name 不足
    三段视为无主,返回 None)。"""
    body = (repo_key or "").split("://", 1)[-1]
    body = body.removesuffix(".git").strip("/")
    parts = [p for p in body.split("/") if p]
    if len(parts) < 3:
        return None
    return "/".join(parts[-2:])


def _norm_version(value: str) -> str:
    """版本串归一(剥 v 前缀/前导点/空白,小写)——tag 与本地版本比对口径。"""
    return (value or "").strip().lstrip("vV.").strip().lower()


def _github_json(owner_name: str, tail: str, timeout: float) -> dict | None:
    req = request.Request(
        f"https://api.github.com/repos/{owner_name}" + (f"/{tail}" if tail else ""),
        headers={"User-Agent": "MYStudio-comfy-host/1.0", "Accept": "application/vnd.github+json"},
    )
    with urlopen_outbound(req, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    return data if isinstance(data, dict) else None


def _github_repo_meta(owner_name: str, timeout: float) -> dict:
    """单仓库一趟:星标 + 最新版本(Releases tag 优先,无 release 回落默认分支
    HEAD 提交 sha——提交漂移即「可更新」)。逐段尽力:任一段失败不拖累其余。"""
    meta = {"stars": None, "latestTag": None, "latestSha": None}
    try:
        data = _github_json(owner_name, "", timeout)
        if data is not None:
            stars = data.get("stargazers_count")
            meta["stars"] = stars if isinstance(stars, int) else None
    except Exception:
        pass
    try:
        release = _github_json(owner_name, "releases/latest", timeout)
        tag = release.get("tag_name") if release else None
        if tag:
            meta["latestTag"] = str(tag)
    except Exception:
        pass
    if not meta["latestTag"]:
        try:
            req = request.Request(
                f"https://api.github.com/repos/{owner_name}/commits",
                headers={"User-Agent": "MYStudio-comfy-host/1.0", "Accept": "application/vnd.github+json"},
            )
            with urlopen_outbound(req, timeout=timeout) as response:
                commits = json.loads(response.read().decode("utf-8"))
            if isinstance(commits, list) and commits and isinstance(commits[0], dict):
                sha = commits[0].get("sha")
                if sha:
                    meta["latestSha"] = str(sha)
        except Exception:
            pass
    return meta


def _kick_github_stars_refresh(pending: list[str]) -> None:
    """后台线程补 GitHub 星标+最新版本;单飞不重入,预算 20s/轮(免鉴权 60 次/时,
    每轮 15 仓库×至多 3 请求=45 次,贴上限内)。全空结果不落缓存——真没了的
    仓库每轮白试几次,但限流等临时失败不会被负缓存钉死 24h。"""
    if not pending:
        return
    repos = sorted({(_normalize_repo(url), _repo_owner_name(_normalize_repo(url))) for url in pending if url})
    repos = [(key, owner) for key, owner in repos if owner]
    if not repos or not _registry_refresh_lock.acquire(blocking=False):
        return

    def _worker() -> None:
        try:
            updates: dict[str, dict] = {}
            deadline = time.monotonic() + _META_FETCH_BUDGET_S
            for repo_key, owner_name in repos[:_META_FETCH_PER_RUN]:
                if time.monotonic() > deadline:
                    break
                meta = _github_repo_meta(owner_name, timeout=_META_FETCH_TIMEOUT_S)
                if any(meta.values()):
                    updates[repo_key] = {"fetchedAt": int(time.time()), **meta}
                else:
                    # 空结果按 6h 短 TTL 落缓存(写入时刻回拨):防真没了的仓库
                    # 每轮重打挤占名额,也防限流类临时失败被 24h 钉死
                    updates[repo_key] = {
                        "fetchedAt": int(time.time()) - (_META_CACHE_TTL_S - _META_EMPTY_RETRY_S),
                        **meta,
                    }
            if updates:
                with _meta_file_lock:
                    cache = _load_plugin_meta_cache()
                    by_repo = cache.setdefault("byRepo", {})
                    # 空结果(限流/临时失败)不得清掉已有的 latestSha/latestTag:
                    # 否则会把刚更新的插件判定依据抹掉(09-19 根修,与
                    # _mark_repo_latest 同源的缓存一致性防线)。
                    for repo_key, update in updates.items():
                        prior = by_repo.get(repo_key) or {}
                        for keep in ("latestSha", "latestTag"):
                            if update.get(keep) is None and prior.get(keep):
                                update[keep] = prior[keep]
                    by_repo.update(updates)
                    _save_plugin_meta_cache(cache)
        finally:
            _registry_refresh_lock.release()

    threading.Thread(target=_worker, daemon=True, name="comfy-plugin-meta-refresh").start()


def list_plugins() -> list[dict]:
    curated_by_repo = {c.get("repo"): c for c in load_curated()}
    ledger = cm.plugin_ledger()
    nodes_root = cm.custom_nodes_dir()
    now = int(time.time())
    with _meta_file_lock:
        cache = _load_plugin_meta_cache()
    local_cache: dict = cache.setdefault("local", {})
    by_repo: dict = cache.setdefault("byRepo", {})
    registry_pending: list[str] = []
    local_dirty = False
    rows = []
    for plugin_dir, entry in ledger.items():
        curated = curated_by_repo.get(entry.get("repo")) or {}
        dir_path = nodes_root / plugin_dir
        # 本地四件套按台账签名缓存(commit/版本/装机时刻),变更才重算——避免
        # 每次进设置页都跑 2×N 个 git 子进程。
        sig = f'{entry.get("commit")}|{entry.get("version")}|{entry.get("installedAt")}'
        cached_local = local_cache.get(plugin_dir)
        if cached_local and cached_local.get("sig") == sig:
            local = cached_local["meta"]
        else:
            local = _plugin_local_meta(dir_path)
            local_cache[plugin_dir] = {"sig": sig, "meta": local}
            local_dirty = True
        repo = entry.get("repo") or local.get("repo")
        reg: dict = {}
        if repo:
            reg = by_repo.get(_normalize_repo(str(repo))) or {}
            # 旧缓存(缺 stars 或缺最新版本键)与过期条目都排队重拉
            needs_refresh = (
                "stars" not in reg
                or ("latestTag" not in reg and "latestSha" not in reg)
                or now - int(reg.get("fetchedAt") or 0) > _META_CACHE_TTL_S
            )
            if needs_refresh:
                registry_pending.append(str(repo))
        # 当前版本:pyproject 语义版优先,无则台账坐标(git 短 sha)
        current_version = local.get("version") or entry.get("version")
        # 可更新:release tag 与本地版本归一化不等;无 release 仓库按默认分支
        # HEAD 提交漂移判定。latestSha 供展示(短 sha)。
        latest_tag = reg.get("latestTag")
        latest_sha = reg.get("latestSha")
        updatable = False
        # tag 语义比对只对语义形态的本地版本生效(git 短 sha 不与 tag 硬比,防误报)
        semantic_local = bool(current_version and re.match(r"^\d+(\.\d+)+", str(current_version)))
        if (
            latest_tag and semantic_local
            and _norm_version(str(latest_tag)) != _norm_version(str(current_version))
        ):
            updatable = True
        elif latest_sha and entry.get("commit") and str(entry["commit"]).lower() != str(latest_sha).lower():
            updatable = True
        latest_display = latest_tag or (str(latest_sha)[:7] if latest_sha else None)
        node_count = len(entry.get("nodes") or [])
        deps_map = entry.get("deps") or {}
        rows.append({
            "id": plugin_dir, "name": curated.get("name") or plugin_dir,
            # 描述与 license:策展中文/实查优先 → 本地 pyproject/LICENSE
            "desc": curated.get("desc_zh") or local.get("desc") or (
                "本地收编(自旧 ComfyUI 目录拷贝,引擎已加载)" if entry.get("source") == "local" else None
            ),
            "license": curated.get("verified_license") or local.get("license"),
            "state": "updatable" if updatable else "installed",
            "version": current_version,
            "latestVersion": latest_display,
            # 依赖:台账(漫影装过的 pip 依赖)优先,空则吐 requirements 实单
            "deps": list(deps_map.keys()) if deps_map else local.get("deps") or [],
            "author": local.get("author"),
            "stars": reg.get("stars"),
            "source": entry.get("source"), "repo": repo,
            "nodeCount": node_count if node_count > 0 else None,
            "dirExists": dir_path.is_dir(),
        })
    if local_dirty:
        # 09-11 P3:save 前锁内重读合并——旧实现用进入函数时的旧快照整写,
        # 后台星标线程恰在 load 与 save 之间落盘的 byRepo 更新会被整份覆盖。
        with _meta_file_lock:
            fresh = _load_plugin_meta_cache()
            fresh.setdefault("local", {}).update(local_cache)
            _save_plugin_meta_cache(fresh)
    _kick_github_stars_refresh(registry_pending)
    pip_row = _pip_manager_row()
    if pip_row:
        rows.append(pip_row)
    return rows


# ── /comfy/workflows* 组:自管工作流库的纯文件操作 ──────────────────
def _safe_workflow_id(workflow_id: str) -> Path:
    """工作流 id=库内相对路径;拒绝绝对路径与 .. 穿越。"""
    candidate = (workflow_id or "").strip().strip("/")
    if not candidate or ".." in candidate.split("/") or "\\" in candidate:
        raise EngineOpError("无效的工作流路径")
    path = (cm.workflows_dir() / candidate).resolve()
    if not str(path).startswith(str(cm.workflows_dir().resolve())):
        raise EngineOpError("无效的工作流路径")
    return path


REPO_ID_PREFIX = "repo:"


def _safe_repo_workflow_id(workflow_id: str) -> Path:
    """repo 源条目 id=repo:<仓库相对路径>;同款防穿越。"""
    rel = workflow_id[len(REPO_ID_PREFIX):].strip().strip("/")
    if not rel or ".." in rel.split("/") or "\\" in rel:
        raise EngineOpError("无效的工作流路径")
    base = cm.repo_workflows_dir().resolve()
    path = (base / rel).resolve()
    if not str(path).startswith(str(base)):
        raise EngineOpError("无效的工作流路径")
    return path


def _iter_repo_workflow_files():
    base = cm.repo_workflows_dir()
    if not base.is_dir():
        return
    for wf in sorted(base.rglob("*.json")):
        if wf.name == ".keep.json":
            continue
        # 09-14 三次修订:桥模板(API 格式)归位本库后不进侧栏——画布打不开
        # schemaVersion+graph 无 nodes 的文件,漏进列表=变相误置件
        if _is_bridge_template(wf):
            continue
        yield wf


def _is_bridge_template(wf: Path) -> bool:
    try:
        data = json.loads(wf.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return False
    return (
        isinstance(data, dict)
        and "schemaVersion" in data
        and "graph" in data
        and "nodes" not in data
    )


def list_workflows(prefix: str | None = None, light: bool = False) -> dict:
    """库内工作流树(节点数统计+缺失插件标记);引擎未跑时 missingNodes=null。

    09-12 workflow-single-open 海量参数(默认行为不变,旧调用方零影响):
    - prefix:按库内相对路径前缀过滤,早跳不读文件(主线卡只拉 0_工作流主线/);
    - light:跳过逐文件 JSON 解析与缺失插件计算(只 id/name/sizeBytes)——
      4125 章≈4千~1万条时逐文件解析是数量级雷,侧栏浏览用轻量。
    """
    engine = engine_manager()
    node_map = _plugin_nodes_map()
    engine_online = engine.is_healthy()
    object_names: set[str] = set()
    if engine_online and not light:
        try:
            object_names = engine.object_info_names()
        except (EngineOpError, OSError, error.URLError):
            engine_online = False
    entries = []
    for wf in _iter_workflow_files():
        rel = wf.relative_to(cm.workflows_dir()).as_posix()
        if prefix and not rel.startswith(prefix):
            continue
        if light:
            entries.append({
                "id": rel,
                "name": wf.stem, "sizeBytes": wf.stat().st_size,
            })
            continue
        obj = parse_workflow_json(wf.read_text(encoding="utf-8", errors="replace"))
        types = workflow_node_types(obj)
        missing_nodes: list[str] | None = None
        missing_plugins: list[str] | None = None
        if engine_online:
            missing = sorted(types - object_names)
            missing_nodes = missing
            missing_plugins = sorted({node_map[t] for t in missing if t in node_map})
        entries.append({
            "id": rel,
            "name": wf.stem, "sizeBytes": wf.stat().st_size,
            "nodeCount": workflow_node_count(obj),
            "missingNodes": missing_nodes, "missingPlugins": missing_plugins,
            "invalidJson": obj is None,
        })
    # 漫影自研静态流真源合并(09-14 裁定:仓库 repo 源;id=repo:<相对路径>,
    # 只读——写操作走引擎家用户区,repo 前缀在 _safe_workflow_id 天然不存在)
    base = cm.repo_workflows_dir()
    for wf in _iter_repo_workflow_files():
        rel = wf.relative_to(base).as_posix()
        rid = REPO_ID_PREFIX + rel
        if prefix and not rel.startswith(prefix) and not rid.startswith(prefix):
            continue
        if light:
            entries.append({"id": rid, "name": wf.stem,
                            "sizeBytes": wf.stat().st_size, "source": "repo"})
            continue
        obj = parse_workflow_json(wf.read_text(encoding="utf-8", errors="replace"))
        types = workflow_node_types(obj)
        missing_nodes: list[str] | None = None
        missing_plugins: list[str] | None = None
        if engine_online:
            missing_nodes = sorted(types - object_names)
            missing_plugins = sorted({node_map[t] for t in missing if t in node_map})
        entries.append({
            "id": rid, "name": wf.stem, "sizeBytes": wf.stat().st_size,
            "nodeCount": workflow_node_count(obj),
            "missingNodes": missing_nodes, "missingPlugins": missing_plugins,
            "invalidJson": obj is None, "source": "repo",
        })
    return {"engineOnline": engine_online, "workflows": entries}


def read_workflow(workflow_id: str) -> dict:
    if workflow_id.startswith(REPO_ID_PREFIX):
        path = _safe_repo_workflow_id(workflow_id)
        if not path.is_file():
            raise EngineOpError(f"工作流不存在: {workflow_id}")
        return {"id": workflow_id, "content": path.read_text(encoding="utf-8", errors="replace")}
    path = _safe_workflow_id(workflow_id)
    if not path.is_file():
        raise EngineOpError(f"工作流不存在: {workflow_id}")
    return {"id": workflow_id, "content": path.read_text(encoding="utf-8", errors="replace")}


def import_workflows(files: list[dict], overwrite: bool = False) -> dict:
    """外部工作流显式复制入库(同名冲突由前端弹窗先问,overwrite 才覆盖)。"""
    merge_legacy_workflows_dir()  # 导入前并入旧库(可能不经过列表直达导入)
    if not isinstance(files, list) or not files:
        raise EngineOpError("files 不能为空")
    imported, skipped = [], []
    for item in files[:50]:
        name = item.get("name") if isinstance(item, dict) else None
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(name, str) or not name.endswith(".json"):
            raise EngineOpError("导入项的 name 必须以 .json 结尾")
        target = _safe_workflow_id(name)
        if target.exists() and not overwrite:
            skipped.append(name)
            continue
        if parse_workflow_json(content if isinstance(content, str) else "") is None:
            raise EngineOpError(f"{name} 不是有效的 JSON,已取消导入")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        # 根须 resolve 对齐 _safe_workflow_id(库根带符号链接前缀时,
        # 未 resolve 的 relative_to 会 400 而文件已落盘——09-09 实弹抓出)
        imported.append(target.relative_to(cm.workflows_dir().resolve()).as_posix())
    return {"imported": imported, "skipped": skipped}


def rename_workflow(workflow_id: str, new_name: str) -> dict:
    path = _safe_workflow_id(workflow_id)
    if not path.is_file():
        raise EngineOpError(f"工作流不存在: {workflow_id}")
    if not isinstance(new_name, str) or not new_name.strip() or "/" in new_name or ".." in new_name:
        raise EngineOpError("新名称不能包含路径分隔符")
    new_path = path.with_name(f"{new_name.strip()}.json")
    if new_path.exists():
        raise EngineOpError(f"已有同名工作流: {new_path.stem}")
    new_path.write_text(path.read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
    path.unlink()
    return {"id": new_path.relative_to(cm.workflows_dir().resolve()).as_posix()}


def move_workflow(workflow_id: str, to_dir: str) -> dict:
    path = _safe_workflow_id(workflow_id)
    if not path.is_file():
        raise EngineOpError(f"工作流不存在: {workflow_id}")
    # to_dir 为空 = 移回根层(渲染层 folderId=null 的语义,09-08 集成补充)。
    raw_dir = to_dir.strip().strip("/") if isinstance(to_dir, str) else ""
    if raw_dir:
        target_dir = _safe_workflow_id(raw_dir)
        if target_dir.is_file():
            raise EngineOpError("目标位置是文件不是目录")
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        # 与 _safe_workflow_id 同源 resolve:防符号链接前缀错位
        target_dir = cm.workflows_dir().resolve()
    target = target_dir / path.name
    if target.exists():
        raise EngineOpError(f"目标目录已有同名工作流: {path.name}")
    shutil.move(str(path), str(target))
    return {"id": target.relative_to(cm.workflows_dir().resolve()).as_posix()}


def delete_workflow(workflow_id: str, confirm: bool = False) -> dict:
    """删除先返回引用扫描(它用到哪些插件节点),确认后才执行+快照备份。"""
    path = _safe_workflow_id(workflow_id)
    if not path.is_file():
        raise EngineOpError(f"工作流不存在: {workflow_id}")
    obj = parse_workflow_json(path.read_text(encoding="utf-8", errors="replace"))
    types = workflow_node_types(obj)
    node_map = _plugin_nodes_map()
    scan = {
        "id": workflow_id, "nodeCount": workflow_node_count(obj),
        "nodeTypes": sorted(types),
        "pluginsUsed": sorted({node_map[t] for t in types if t in node_map}),
    }
    if not confirm:
        return {"needsConfirmation": True, **scan}
    backup_dir = cm.snapshots_dir() / "workflow-backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup_dir / f"{time.strftime('%Y%m%d-%H%M%S')}-{path.name}")
    path.unlink()
    return {"deleted": True, **scan,
            "message": f"已删除 {workflow_id}(已备份到快照目录,可恢复)"}


# ── my_nodes 自研节点包(09-09 comfyui-frontend-swap 阶段1)─────────────
# design.md 2.1:源码位随 backend 平铺打包;运行位=引擎源码内 custom_nodes
# (引擎只读源码内目录);硬拷不软链(快照毒教训);tests 不进引擎。

MY_DIR = "my-nodes"
# 09-14 manying→my 改名前的旧运行目录:同步后须摘除,否则双份节点注册
LEGACY_MY_DIR = "manying-nodes"


def my_source_dir() -> Path:
    return Path(__file__).resolve().parent / "my_nodes"


def sync_my_nodes() -> dict:
    """硬拷源码位 → custom_nodes/my-nodes(tmp 原子换入;幂等)。

    同时摘除改名前旧目录 manying-nodes(双份注册防线;custom_nodes 本就是
    官方扩展位,不违引擎家 git 零改动铁律)。
    """
    source = my_source_dir()
    if not (source / "__init__.py").is_file():
        raise EngineOpError(f"my_nodes 源码位缺失:{source}")
    target = cm.custom_nodes_dir() / MY_DIR
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / (MY_DIR + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    shutil.copytree(source, tmp, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "tests"))
    if target.exists():
        shutil.rmtree(target)
    tmp.rename(target)
    removed_legacy = False
    legacy = target.parent / LEGACY_MY_DIR
    if legacy.exists():
        shutil.rmtree(legacy)
        removed_legacy = True
    files = sum(1 for p in target.rglob("*") if p.is_file())
    return {"copied": files, "source": str(source), "target": str(target), "removedLegacy": removed_legacy}


def my_sync_state() -> dict:
    target = cm.custom_nodes_dir() / MY_DIR
    return {
        "synced": (target / "__init__.py").is_file(),
        "source": str(my_source_dir()),
        "target": str(target),
    }
