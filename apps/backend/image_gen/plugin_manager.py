"""ComfyUI 插件管理器(一期后端流 A)——安装五步/卸载扫描/依赖账本/体检/目录。

裁定 5:插件 = 目录 + 账本管理,依赖 = 预检 + 计数 + 可复位。
安装五步:git clone(或 Registry zip)→ 解析 requirements → 冲突预检(大白话)
→ 引擎 venv pip install → 重启 + /object_info 前后差分(「新增 N 个节点」才算成功)。
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
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from urllib import error, request

from . import comfy_manifest as cm
from .engine_manager import EngineOpError, _git, _pip, diff_node_sets, engine_manager, jobs

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


def workflow_node_count(obj) -> int:
    if not isinstance(obj, dict):
        return 0
    if isinstance(obj.get("nodes"), list):
        return len(obj["nodes"])
    return sum(1 for node in obj.values() if isinstance(node, dict) and "class_type" in node)


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
            with request.urlopen(req, timeout=timeout) as response:
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


def catalog_search(query: str, limit: int = 40) -> dict:
    """策展 + Registry 合并;离线时仅返回策展(大白话注明)。"""
    ledger = cm.plugin_ledger()
    q = (query or "").strip().lower()
    curated = []
    for entry in load_curated():
        haystack = f"{entry.get('id','')} {entry.get('name','')} {entry.get('desc_zh','')} {entry.get('category','')}".lower()
        if q and q not in haystack:
            continue
        curated.append({**entry, "source": "curated", "verified": True,
                        "installed": entry.get("id") in ledger or entry.get("dir") in ledger})
    registry: list[dict] = []
    registry_error: str | None = None
    try:
        payload = _registry_get("/nodes/search", {"search": query or "", "limit": min(100, max(1, limit))})
        for node in payload.get("nodes", [])[:limit]:
            entry = _registry_entry(node)
            if entry:
                entry["installed"] = entry["id"] in ledger
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
    if target.exists():
        raise EngineOpError(f"插件目录已存在({plan['dirName']});如需重装请先卸载")

    jobs.update(job_id, progress=6, step="snapshot", message="安装前快照账本(失败可回滚)…")
    snapshot_id = engine.create_snapshot(reason=f"plugin-install:{plan['dirName']}", full=False)
    freeze_before = parse_freeze("\n".join(engine.venv_freeze()))

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
            "warnings": req_warnings,
        }

    cm.mutate_manifest(_record)
    jobs.update(job_id, result={
        "plugin": plan["dirName"], "addedNodes": diff["addedCount"], "nodeTypes": diff["added"][:200],
        "message": f"安装成功:{plan['name'] or plan['dirName']} 新增 {diff['addedCount']} 个节点",
    })


def _acquire(plan: dict, target: Path) -> None:
    if plan["source"] == "registry":
        # Registry zip 通道(git 外备选)
        with tempfile.TemporaryDirectory(prefix="comfy-plugin-") as tmp:
            zip_path = Path(tmp) / "node.zip"
            req = request.Request(plan["zipUrl"], headers={"User-Agent": "MYStudio-comfy-host/1.0"})
            with request.urlopen(req, timeout=300.0) as response, open(zip_path, "wb") as fh:
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


def _iter_workflow_files():
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


def update_plugin_job(plugin_id: str) -> str:
    plugin_id = _safe_plugin_id(plugin_id)
    entry = cm.plugin_ledger().get(plugin_id)
    if not entry:
        raise EngineOpError(f"账本里没有这个插件: {plugin_id}")
    if entry.get("source") in ("registry", "local"):
        raise EngineOpError("Registry zip / 本地目录安装的插件请重新安装新版本(无 git 历史可拉取)")
    job_id = jobs.create("plugin-update", f"更新插件 {plugin_id}")
    jobs.start(job_id, lambda jid: _update_plugin_job(jid, plugin_id))
    return job_id


def _update_plugin_job(job_id: str, plugin_id: str) -> None:
    engine = engine_manager()
    target = cm.custom_nodes_dir() / plugin_id
    if not target.is_dir():
        raise EngineOpError(f"插件目录不存在: {plugin_id}(可能已被手动删除,请跑一次依赖体检)")
    jobs.update(job_id, progress=10, step="snapshot", message="更新前快照…")
    engine.create_snapshot(reason=f"plugin-update:{plugin_id}", full=False)
    jobs.update(job_id, progress=25, step="pull", message="拉取插件最新代码…")
    _git(["pull", "--ff-only"], cwd=target, timeout=600.0)
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
    jobs.update(job_id, result={
        "plugin": plugin_id, "commit": commit[:8], "addedNodes": diff["addedCount"],
        "message": f"已更新 {plugin_id} 到 {commit[:8]},新增 {diff['addedCount']} 个节点",
    })


# -- 体检:缺失/漂移/孤儿 ------------------------------------------------
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
        for p in sorted(cm.custom_nodes_dir().glob("*")) if p.is_dir() and p.name not in ledger_dirs and not p.name.startswith(".")
    ]
    return {"missing": missing, "drifted": drifted, "orphan": orphan,
            "healthy": not missing and not drifted and not orphan}


def list_plugins() -> list[dict]:
    curated_by_repo = {c.get("repo"): c for c in load_curated()}
    rows = []
    for plugin_dir, entry in cm.plugin_ledger().items():
        curated = curated_by_repo.get(entry.get("repo")) or {}
        rows.append({
            "id": plugin_dir, "name": curated.get("name") or plugin_dir,
            "desc": curated.get("desc_zh"), "license": curated.get("verified_license"),
            "state": "installed", "version": entry.get("version"),
            "deps": entry.get("deps") or {}, "source": entry.get("source"),
            "nodeCount": len(entry.get("nodes") or []),
            "dirExists": (cm.custom_nodes_dir() / plugin_dir).is_dir(),
        })
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


def list_workflows() -> dict:
    """库内工作流树(节点数统计+缺失插件标记);引擎未跑时 missingNodes=null。"""
    engine = engine_manager()
    node_map = _plugin_nodes_map()
    engine_online = engine.is_healthy()
    object_names: set[str] = set()
    if engine_online:
        try:
            object_names = engine.object_info_names()
        except (EngineOpError, OSError, error.URLError):
            engine_online = False
    entries = []
    for wf in _iter_workflow_files():
        obj = parse_workflow_json(wf.read_text(encoding="utf-8", errors="replace"))
        types = workflow_node_types(obj)
        missing_nodes: list[str] | None = None
        missing_plugins: list[str] | None = None
        if engine_online:
            missing = sorted(types - object_names)
            missing_nodes = missing
            missing_plugins = sorted({node_map[t] for t in missing if t in node_map})
        entries.append({
            "id": wf.relative_to(cm.workflows_dir()).as_posix(),
            "name": wf.stem, "sizeBytes": wf.stat().st_size,
            "nodeCount": workflow_node_count(obj),
            "missingNodes": missing_nodes, "missingPlugins": missing_plugins,
            "invalidJson": obj is None,
        })
    return {"engineOnline": engine_online, "workflows": entries}


def read_workflow(workflow_id: str) -> dict:
    path = _safe_workflow_id(workflow_id)
    if not path.is_file():
        raise EngineOpError(f"工作流不存在: {workflow_id}")
    return {"id": workflow_id, "content": path.read_text(encoding="utf-8", errors="replace")}


def import_workflows(files: list[dict], overwrite: bool = False) -> dict:
    """外部工作流显式复制入库(同名冲突由前端弹窗先问,overwrite 才覆盖)。"""
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
        imported.append(target.relative_to(cm.workflows_dir()).as_posix())
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
    return {"id": new_path.relative_to(cm.workflows_dir()).as_posix()}


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
        target_dir = cm.workflows_dir()
    target = target_dir / path.name
    if target.exists():
        raise EngineOpError(f"目标目录已有同名工作流: {path.name}")
    shutil.move(str(path), str(target))
    return {"id": target.relative_to(cm.workflows_dir()).as_posix()}


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
