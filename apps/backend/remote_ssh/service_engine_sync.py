"""service_engine_sync.py — 引擎同步域(插件同步、同步清单与加载健康、逐项同步与结果)

本模块的类由 service.SSHService 混入组合而成:方法体自 SSHService 逐字搬出(1124 超线文件拆分),对外接口不变。

两点约定:
- 须在 service 之后导入(类体里用到的名字在 service 初始化时才就绪;单独先导入本模块会循环导入失败);
- 测试会在 service 上整个替换的名字、以及定义在原类之后的名字,一律经 `service.<名字>` 取(调用时才查),
  在 service 上打桩的效果与搬出前相同。
"""

from __future__ import annotations

from pathlib import PureWindowsPath
import re
import time

from . import service
from .service import (
    SSHServiceError,
    _COMFYUI_REPO_URL,
    _ENGINE_SYNC_ENGINE_NAME,
    _ENGINE_SYNC_ITEM_TIMEOUT_S,
    _ENGINE_SYNC_OVERALL_TIMEOUT_S,
    _ENGINE_SYNC_SKIP_NAMES,
    _SYNC_NAME_RE,
    _SYNC_URL_RE,
    _WIN_BASE_PYTHON,
    _WIN_COMFY_ROOT,
    _WIN_CUSTOM_NODES,
    _WIN_VENV_PYTHON,
    _exclusive_engine_sync,
    _is_session_drop,
    _mac_custom_nodes_dir,
    _parse_plugin_import_failures,
    _utc_now_iso,
    write_engine_sync_doc,
)


class EngineSyncMixin:
    """引擎同步域(插件同步、同步清单与加载健康、逐项同步与结果)"""

    def sync_plugins(self, timeout_s: float = 300) -> dict:
        """1104 插件同步:Mac→Windows(版本对齐+缺装+有更+依赖+建议重启)。

        .. deprecated:: 1104 引擎同步中心
            已被 get_engine_sync_manifest/sync_engine 取代(R4:后端端点保留
            兼容,UI 入口已撤);新调用方请走 engine-sync 两法。

        返回 {comfyuiSynced, installed, updated, pipInstalled, engineRestarted, errors[], notes[]}
        """
        import json as _json

        result = {"comfyuiSynced": False, "installed": [], "updated": [], "pipInstalled": [], "engineRestarted": False, "errors": [], "notes": []}

        # ① 读 Mac 本机插件清单
        try:
            from comfyui.manifest import comfy_home
            local_nodes = comfy_home() / "ComfyUI" / "custom_nodes"
            if not local_nodes.is_dir():
                result["errors"].append("本机引擎未配置(custom_nodes 目录不存在)——请先在设置→本地配置准备本机引擎")
                return result
            mac_plugins = {}
            for d in local_nodes.iterdir():
                git_dir = d / ".git"
                if git_dir.is_dir() and d.name not in ("my-nodes",):
                    # 读 origin url
                    try:
                        import subprocess as _sp
                        url = _sp.run(["git", "-C", str(d), "remote", "get-url", "origin"],
                                      capture_output=True, text=True, timeout=5).stdout.strip()
                        if url:
                            mac_plugins[d.name] = url
                    except Exception:
                        pass
        except Exception as exc:
            result["errors"].append(f"读本机插件清单失败: {exc}")
            return result
        # F-1 (1109 审计): 过滤非法 name/url(cmd 元字符)进 errors,绝不带入远端命令
        safe_plugins = {}
        for name, url in mac_plugins.items():
            if not _SYNC_NAME_RE.match(name):
                result["errors"].append(f"跳过非法插件名(cmd 元字符): {name!r}")
                continue
            if url and not _SYNC_URL_RE.match(url):
                result["errors"].append(f"跳过 {name} 非法 URL(cmd 元字符): {url!r}")
                continue
            safe_plugins[name] = url
        mac_plugins = safe_plugins
        result["notes"].append(f"Mac 本机 {len(mac_plugins)} 件插件")

        # ② 读 Windows 引擎 custom_nodes
        code, out = self.run_remote_command("dir /b E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\custom_nodes 2>nul", 15)
        win_existing = {l.strip() for l in out.splitlines() if l.strip() and not l.startswith("Volume")} if code == 0 else set()
        result["notes"].append(f"Windows 现有 {len(win_existing)} 件")

        # ③ ComfyUI 版本对齐(git pull master)
        code, out = self.run_remote_command(
            "cd /d E:\\IP\\漫影工作室\\comfyui\\ComfyUI && git fetch origin 2>&1 && git pull --ff-only origin master 2>&1", 60)
        if "Already up to date" in out or code == 0:
            result["comfyuiSynced"] = True
            result["notes"].append("引擎版本已对齐" if "Already" not in out else "引擎版本已最新")
        else:
            result["errors"].append(f"引擎版本对齐失败: {out[:100]}")

        # ④ 缺的装(clone)/有的更(pull)
        win_nodes_base = "E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\custom_nodes"
        venv_pip = "E:\\IP\\漫影工作室\\comfyui\\venv\\Scripts\\python.exe -m pip install -q"
        for name, url in mac_plugins.items():
            if name in win_existing:
                code, out = self.run_remote_command(
                    f"cd /d {win_nodes_base}\\{name} && git pull --ff-only 2>&1", 30)
                if code == 0 and "Already" not in out:
                    result["updated"].append(name)
            else:
                code, out = self.run_remote_command(
                    f"cd /d {win_nodes_base} && git clone --depth 1 {url} {name} 2>&1", 60)
                if code == 0:
                    result["installed"].append(name)
                else:
                    result["errors"].append(f"装 {name} 失败: {out[:80]}")

        # ⑤ 依赖安装(每件有 requirements.txt 则装)
        for name in list(mac_plugins.keys()):
            code, out = self.run_remote_command(
                f"if exist {win_nodes_base}\\{name}\\requirements.txt "
                f"(set PYTHONUTF8=1&& {venv_pip} -r {win_nodes_base}\\{name}\\requirements.txt 2>&1) else (echo NO_REQ)",
                120)
            if code == 0 and "NO_REQ" not in out:
                result["pipInstalled"].append(name)

        # ⑥ 建议重启(不自动重启)
        if result["installed"] or result["updated"] or result["comfyuiSynced"]:
            result["notes"].append("插件已同步——建议重启引擎(设置→本地配置→启动服务)")

        return result

    # ── 1104 引擎同步中心(tasks/11-04-engine-sync R2)──────────────────

    def _win_custom_nodes_names(self) -> set[str]:
        """SSH 读 Windows custom_nodes 目录名集合(dir /b /ad;失败回空集)。"""
        code, out = self.run_remote_command(
            f"dir /b /ad {_WIN_CUSTOM_NODES} 2>nul", 15
        )
        if code != 0:
            return set()
        return {
            line.strip()
            for line in out.splitlines()
            if line.strip() and not line.startswith("Volume") and not line.startswith("Directory of")
        }

    def _win_git_head(self, win_path: str) -> str | None:
        """SSH 读 Windows 侧 git HEAD(目录非 git/不存在/超时 → None)。"""
        return self._win_git_info(win_path)[0]

    def _patch_win_engine_ledger(self, win_path: str, latest: str, deadline: float, sha: str | None = None) -> str:
        """Win 引擎账本补记(1122 冲突弹窗根修);返回空=成功,非空=不阻断警句。

        引擎同步移动 Win 引擎仓(checkout tag)后,Win App 账本 manifest.json
        的 engine.version/sha/lastCheck 若不跟着写,Win 卡会「显旧版+假可更新
        横幅」而 update_job 按仓实况拒发——两口径互咬。幂等补记(只动 engine
        三键);失败不阻断同步,警句走回执 pipError 位。"""
        if not sha:
            code, out = self.run_remote_command(
                f'cd /d "{win_path}" & git rev-parse HEAD 2>nul',
                self._remaining_timeout(deadline, 20),
            )
            lines = [l.strip() for l in out.splitlines() if l.strip()]
            sha = lines[-1] if lines else ""
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            return f"账本补记跳过(HEAD 不可读: {sha[:40] or '空'})"
        patch = (
            "import json;"
            f"p=r'{_WIN_COMFY_ROOT}\\manifest.json';"
            "d=json.load(open(p,encoding='utf-8'));"
            "e=d.setdefault('engine',{});"
            f"e['version']='{latest}';e['sha']='{sha}';"
            f"e['lastCheck']={{'at':{int(time.time() * 1000)},'latest':'{latest}',"
            "'headSha':'','aheadBy':None,"
            f"'pinnedSha':'{sha}'}};"
            "json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)"
        )
        code, out = self.run_remote_command(
            f'"{_WIN_BASE_PYTHON}" -c "{patch}" 2>&1',
            self._remaining_timeout(deadline, 20),
        )
        return "" if code == 0 else f"账本补记失败(不阻断): {out.strip()[:120]}"

    @staticmethod
    def _git_ceiling(win_path: str) -> str:
        """git 找仓上溯上限(1123 根修):=目标目录的父目录。

        git 在目录内执行时会逐级上溯父目录找 .git;zip 直装插件(无 .git)
        目录内的 git 命令因此实际落在引擎仓上——面板把引擎版本冒充插件版本,
        拉取分支对引擎仓 fetch/pull 误报 diverging(且引擎仓若可快进会被
        插件同步悄悄移动)。GIT_CEILING_DIRECTORIES 让 git 只在目标目录内找仓
        (cwd 恒不被排除,引擎目录自身照常命中)。须用 PureWindowsPath 取父目录:
        本模块跑在 macOS,Posix Path 不认反斜杠分隔符。
        """
        return str(PureWindowsPath(win_path).parent)

    def _win_git_info(self, win_path: str) -> tuple[str | None, str | None]:
        """SSH 读 Win 侧 git HEAD+版本(单命令三读,零额外 SSH 往返)。

        版本口径(1122 用户令「同步面板要展示版本」):git describe 最近 tag
        剥前导 v(引擎 v0.45.2 → 0.45.2);1125 补兜底:浅克隆(--depth 1)里
        tag 指向的提交不在本地历史图上,describe 连不上线照样空——同步链
        fetch --tags 已把 tag 引用落到本地,再追加 for-each-ref 按时间取最新
        (不依赖图连通;describe 在能用时排前面优先);两者皆空回退短 sha
        (HEAD 前 7 位,上游真无 tag 的诚实显示);目录非 git/不存在/超时 →
        (None, None)。cmd `&` 链 exit code=末命令,故不以 code 作闸,逐段
        解析(tag 段取首个非空行=describe 在前则 describe,否则兜底 tag)。
        找仓上溯上限见 _git_ceiling(非 git 插件目录不再冒出引擎 HEAD)。
        """
        _, out = self.run_remote_command(
            f'set "GIT_CEILING_DIRECTORIES={self._git_ceiling(win_path)}" & '
            f'git -C "{win_path}" rev-parse HEAD 2>nul & echo ===V=== & '
            f'git -C "{win_path}" describe --tags --abbrev=0 2>nul & '
            f'git -C "{win_path}" for-each-ref --count=1 --sort=-creatordate '
            f"--format=%(refname:short) refs/tags 2>nul", 10
        )
        segments = out.split("===V===", 1)
        if len(segments) < 2:
            return (None, None)  # ===V=== 恒在(cmd & 无条件续行);缺席=输出被截
        head_lines = [l.strip() for l in segments[0].splitlines() if l.strip()]
        head = head_lines[-1] if head_lines else ""
        tag_lines = [l.strip() for l in segments[1].splitlines() if l.strip()] if len(segments) > 1 else []
        tag = tag_lines[0] if tag_lines else ""
        # 剥前导 v 与其后的可选点(实弹 rgthree-comfy tag=v.1.0.0 → 1.0.0;
        # 常规 v0.45.2 → 0.45.2 不受影响)
        version = re.sub(r"^v+\.?", "", tag) if tag else (head[:7] if head else "")
        return (head or None, version or None)

    @staticmethod
    def _engine_sync_status(mac_present: bool, win_present: bool, name: str) -> str:
        """R2 四态:both=两侧都有 / mac-only=Mac 侧有(本机仓或清单声明,1104 复核
        修:手动条目双侧均无时也归此态——可见可勾选,同步按 URL clone)且 Win 缺
        (需 clone)/ win-only=Win 独有(跳过,Q1 并集不删)/ skip=my-nodes(Q2);
        双侧皆无仅引擎条目可达(Mac/Win HEAD 都读不到=无处可同步,同 skip 不渲染)。"""
        if name in _ENGINE_SYNC_SKIP_NAMES:
            return "skip"
        if mac_present and win_present:
            return "both"
        if mac_present:
            return "mac-only"
        if win_present:
            return "win-only"
        return "skip"

    def get_engine_plugin_health(self) -> dict:
        """GET /comfy/ssh/engine-plugin-health:Win 引擎插件加载健康图。

        数据源(1107 用户令:自愈状态要在设置 UI 看得见):
        - 引擎日志最新启动段(Total VRAM 之后)的 Cannot import 行 → 挂件+挂因;
        - deps-install.log 尾段 → 近期依赖安装失败(pip 欠账,持续可见不再一闪而过;
          1125 销账:同包其后 OK 或 venv 运行时可导入=已还清,不再标黄)。
        loaded = Win 现存插件 ∪ 挂件之差;探针失败逐项容错(引擎未启=空图+cause)。
        """
        win_names = self._win_custom_nodes_names()
        health: dict[str, dict] = {}
        # ① 引擎日志尾段(启动加载在最后 Total VRAM 之后、startup banner 之前)
        try:
            code, out = self.run_remote_command(
                "powershell -NoProfile -NonInteractive -Command \""
                "Get-Content -LiteralPath 'E:\\IP\\漫影工作室\\comfyui\\logs\\engine.log' "
                "-Tail 8000\"", 60)
            if code == 0 and out:
                seg = out[out.rfind("Total VRAM"):] if "Total VRAM" in out else out
                health = _parse_plugin_import_failures(seg)
        except (SSHServiceError, RuntimeError, ValueError) as exc:
            return {"plugins": {}, "loadedCount": 0, "failedCount": 0,
                    "depsFailures": {}, "probedAt": _utc_now_iso(),
                    "error": f"引擎日志读取失败: {str(exc)[:200]}"}
        failed = set(health)
        # ② deps-install.log 近期安装失败(pip 欠账;>[FAIL ...]行)。1125 销账:
        #    同 (插件, 包基名) 其后的 OK 行先销一遍账,余下欠账再经引擎 venv
        #    运行时可导入性复核(triton 无 Windows 发行包但 venv 能导入 torch
        #    自带副本=运行时用得上就算还清)——已满足者不再标黄;1107「失败
        #    持续可见」设计不变,销的只是已还清的账。
        deps_failures: dict[str, list[str]] = {}
        try:
            code, out = self.run_remote_command(
                "powershell -NoProfile -NonInteractive -Command \""
                "Get-Content -LiteralPath 'E:\\IP\\漫影工作室\\comfyui\\logs\\deps-install.log' "
                "-Tail 400\"", 30)
            if code == 0 and out:
                debts, bases = service._collect_dep_debts(out)
                satisfied = self._venv_import_ok(bases)
                for (plugin, _base), raw in sorted(debts.items()):
                    if not satisfied.get(_base):
                        deps_failures.setdefault(plugin, []).append(raw)
        except (SSHServiceError, RuntimeError, ValueError):
            pass  # 欠账日志读失败不拦健康图
        return {
            "plugins": {**{n: {"loaded": True, "cause": ""} for n in sorted(win_names - failed)}, **health},
            "loadedCount": len(win_names - failed),
            "failedCount": len(failed & win_names),
            "depsFailures": deps_failures,
            "probedAt": _utc_now_iso(),
        }

    def _venv_import_ok(self, bases: list[str]) -> dict[str, bool]:
        """引擎 venv 逐包复核:metadata 有版本或可 find_spec 即算欠账已还清(1125)。

        base64 管道喂码(包名清单内嵌进码里,命令行恒 ASCII,绕 cmd/PS 引号雷);
        复核失败/venv python 缺位=空表——欠账如实保留(fail-open 到旧行为,
        不因销账复核失败而放大红面)。
        """
        if not bases:
            return {}
        import base64
        import json as _json
        code = (
            "import importlib.util as _u, importlib.metadata as _m, json as _j\n"
            "names = " + _json.dumps(list(bases)) + "\n"
            "out = {}\n"
            "for _n in names:\n"
            "    _ok = False\n"
            "    try:\n"
            "        _m.version(_n)\n"
            "        _ok = True\n"
            "    except Exception:\n"
            "        try:\n"
            "            _ok = _u.find_spec(_n.replace('-', '_')) is not None\n"
            "        except Exception:\n"
            "            _ok = False\n"
            "    out[_n] = _ok\n"
            "print(_j.dumps(out))\n"
        )
        b64 = base64.b64encode(code.encode("utf-8")).decode("ascii")
        cmd = ('echo ' + b64
               + ' | "' + _WIN_VENV_PYTHON + '" -c '
               '"import base64,sys;exec(base64.b64decode(sys.stdin.read().strip()).decode())"')
        try:
            rc, out = self.run_remote_command(cmd, 60)
            if rc != 0 or not out.strip():
                return {}
            return _json.loads(out.strip().splitlines()[-1])
        except (SSHServiceError, RuntimeError, ValueError):
            return {}

    def get_engine_sync_manifest(self) -> dict:
        """GET /comfy/ssh/engine-sync-manifest:单真源清单 + 双侧实况。

        流程(R2):读 engine-sync.json → 扫 Mac custom_nodes(新 git 包追加
        进清单+回写文件,R1 合并)→ SSH 扫 Windows custom_nodes(dir /b)→
        SSH 读 Win 各包/引擎 HEAD → 回 {items: [{name,url,macHead,winHead,status}]}。
        """
        scan = service._scan_mac_git_packages()
        doc = service.load_engine_sync_doc()
        doc, changed = service.merge_mac_scan_into_doc(doc, scan)
        if changed:
            write_engine_sync_doc(doc)  # R1:新插件自动追加+回写

        win_names = self._win_custom_nodes_names()
        mac_heads: dict[str, str | None] = {
            name: service._mac_git_head(_mac_custom_nodes_dir() / name) for name in scan
        }
        items: list[dict] = []
        # ComfyUI 引擎条目(恒首行)
        engine_mac_head = service._mac_git_head(_mac_custom_nodes_dir().parent)
        engine_win_head, engine_win_version = self._win_git_info(
            _WIN_COMFY_ROOT + "\\ComfyUI"
        )
        items.append(
            {
                "name": _ENGINE_SYNC_ENGINE_NAME,
                "url": doc.get("comfyui", {}).get("repo", _COMFYUI_REPO_URL),
                "macHead": engine_mac_head,
                "winHead": engine_win_head,
                "winVersion": engine_win_version,
                "status": self._engine_sync_status(
                    engine_mac_head is not None, engine_win_head is not None,
                    _ENGINE_SYNC_ENGINE_NAME,
                ),
            }
        )
        # 插件并集:清单条目 ∪ Mac 扫描 ∪ Win 现存(清单序稳定,Win 独有追加在后)
        plugins_by_name = {p["name"]: p for p in doc["plugins"]}
        win_only_names = sorted(win_names - set(plugins_by_name))
        for plugin in list(doc["plugins"]) + [
            {"name": n, "url": ""} for n in win_only_names
        ]:
            name = plugin["name"]
            mac_head = mac_heads.get(name)  # None=Mac 本机无此包(清单手动条目)
            win_head: str | None = None
            win_version: str | None = None
            if name in win_names:
                win_head, win_version = self._win_git_info(
                    f"{_WIN_CUSTOM_NODES}\\{name}"
                )
            items.append(
                {
                    "name": name,
                    "url": plugin.get("url", ""),
                    "macHead": mac_head,
                    "winHead": win_head,
                    "winVersion": win_version,
                    # Mac 侧在场=本机有仓,或「清单声明且 Win 缺」(R1 手动条目
                    # 双侧均无时不落 skip——skip 只留给 my-nodes Q2,否则手动新增
                    # 件在面板不可见永无法勾选;清单声明但 Win 已有而 Mac 无仓仍归
                    # win-only:无 Mac HEAD 可对齐,同步跳过保留,与 UI 灰显一致)
                    "status": self._engine_sync_status(
                        mac_head is not None
                        or (name in plugins_by_name and name not in win_names),
                        name in win_names,
                        name,
                    ),
                }
            )
        return {"items": items}

    @_exclusive_engine_sync
    def sync_engine(self, items: list[str], timeout_s: float | None = None) -> dict:
        """POST /comfy/ssh/sync-engine:逐项 SSH 同步(并集策略 Q1;GitHub 拉最新)。

        1104 用户裁定:「Windows 从 GitHub 拉最新,不 SSH 推 Mac HEAD」——
        删 git reset --hard <Mac HEAD> 强制对齐(Q6 就此废止),改为:
          Win 已有(引擎/both)→ git pull --ff-only(拉 GitHub 最新);
          Win 缺(mac-only/手动条目)→ git clone <清单 url>;
          win-only/skip(my-nodes) → 跳过(Q1 不删/Q2 不管);
          依赖 → 有 requirements.txt 则 PYTHONUTF8=1 venv pip install(失败不阻断,
          记 pipError);验证 → 只确认目录在+HEAD 可读(不比 Mac HEAD)。
        整体超时 30min(Q3,1104 修正 10→30min);部分失败不阻断(失败项在回执
        标明,C8)。

        返回 {items: [{name,type,macHead,winHead,action,verified,error,pipError}]}。
        """
        overall = _ENGINE_SYNC_OVERALL_TIMEOUT_S if timeout_s is None else timeout_s
        deadline = time.monotonic() + overall
        scan = service._scan_mac_git_packages()
        doc = service.load_engine_sync_doc()
        doc, changed = service.merge_mac_scan_into_doc(doc, scan)
        if changed:
            write_engine_sync_doc(doc)
        plugins_by_name = {p["name"]: p for p in doc["plugins"]}
        win_names = self._win_custom_nodes_names()

        results: list[dict] = []

        def _dispatch(name: str) -> dict:
            """单件调度(引擎/插件/清单缺失三分支);SSHServiceError 向上抛给重试层。"""
            if name == _ENGINE_SYNC_ENGINE_NAME:
                mac_head = service._mac_git_head(_mac_custom_nodes_dir().parent)
                return self._sync_one(
                    name=name, kind="engine", url=doc["comfyui"].get("repo", ""),
                    mac_head=mac_head, win_exists=True, deadline=deadline,
                )
            plugin = plugins_by_name.get(name)
            mac_head = service._mac_git_head(_mac_custom_nodes_dir() / name)
            if plugin is None and mac_head is None and name not in win_names:
                # 三处都无(清单/Mac/Win)——诚实报失败;Win 独有件交 _sync_one 走 skipped
                return self._sync_result(
                    name, "plugin", mac_head, None, "failed", False,
                    "清单里没有这件插件(Mac 本机与清单均无)",
                )
            return self._sync_one(
                name=name, kind="plugin",
                url=(plugin or {}).get("url", ""),
                mac_head=mac_head, win_exists=name in win_names,
                deadline=deadline,
            )

        for name in items:
            if time.monotonic() >= deadline:
                results.append(
                    self._sync_result(
                        name, "plugin" if name != _ENGINE_SYNC_ENGINE_NAME else "engine",
                        mac_head=None, win_head=None, action="failed", verified=False,
                        error=f"整体超时({int(overall / 60)}min),未同步",
                    )
                )
                continue
            try:
                results.append(_dispatch(name))
            except SSHServiceError as exc:
                # 断线自愈(1104 B5):长同步途中 TCP 被掐(paramiko EOF→session
                # not active / 未连接)→唤醒 keeper 立即重连,等翻绿后本件重试
                # 一次;重连不成或重试再败 → 诚实落 failed(不拦后续件 C8)
                if _is_session_drop(str(exc)) and self._reconnect_for_sync(deadline):
                    try:
                        results.append(_dispatch(name))
                        continue
                    except SSHServiceError as retry_exc:
                        results.append(
                            self._sync_result(
                                name, "plugin" if name != _ENGINE_SYNC_ENGINE_NAME else "engine",
                                None, None, "failed", False,
                                f"{retry_exc}(断线重连后重试仍败)",
                            )
                        )
                        continue
                results.append(
                    self._sync_result(
                        name, "plugin" if name != _ENGINE_SYNC_ENGINE_NAME else "engine",
                        None, None, "failed", False, str(exc),
                    )
                )
        # 1104 补:同步逐件结果落盘 comfyui 家 engine-sync.log(用户令:要有日志)
        try:
            from comfyui.manifest import comfy_home as _ch
            import datetime as _dt
            _log = _ch() / "engine-sync.log"
            _ts = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            _ok = sum(1 for i in results if i.get("action") in ("pulled", "cloned"))
            _fail = sum(1 for i in results if i.get("action") == "failed")
            _skip = sum(1 for i in results if i.get("action") == "skipped")
            _lines = [f"\n=== engine-sync {_ts} ==="]
            for _i in results:
                _icon = {"pulled": "✅", "cloned": "✅(新)", "skipped": "⏭️", "failed": "❌"}.get(_i.get("action"), "?")
                _err = f" | {_i['error']}" if _i.get("error") else ""
                _lines.append(f"  {_icon} {_i['name']} [{_i.get('action')}] {_err}")
            _lines.append(f"  总计: ✅{_ok} ❌{_fail} ⏭️{_skip}")
            with open(_log, "a", encoding="utf-8") as _f:
                _f.write("\n".join(_lines) + "\n")
        except Exception:  # noqa: BLE001 — 日志失败不阻断同步结果返回
            pass
        return {"items": results}

    @staticmethod
    def _sync_result(
        name: str, type_: str, mac_head: str | None, win_head: str | None,
        action: str, verified: bool, error: str | None = None,
        pip_error: str | None = None, win_version: str | None = None,
    ) -> dict:
        return {
            "name": name, "type": type_, "macHead": mac_head, "winHead": win_head,
            "winVersion": win_version,
            "action": action, "verified": verified, "error": error, "pipError": pip_error,
        }

    def _remaining_timeout(self, deadline: float, op_timeout_s: float) -> float:
        """单命令超时=操作上限与整体剩余量的较小者(下限 1s 让命令有机会自报)。"""
        return max(min(op_timeout_s, deadline - time.monotonic()), 1.0)

    def _sync_one(
        self, name: str, kind: str, url: str, mac_head: str | None,
        win_exists: bool, deadline: float,
    ) -> dict:
        """单件同步:Win 从 GitHub 拉最新(1104 用户裁定:不 SSH 推 Mac HEAD)。

        Win 已有(engine/both)→ git pull --ff-only;Win 缺 → git clone <url>;
        win-only/skip 直接过(Q1 不删/Q2 不管);验证只看目录在+HEAD 可读
        (不比 Mac HEAD,mac_head 仅随回执透传供参考)。
        """
        # F-1 (1109 审计): name/url 白名单闸——cmd 注入防御,失败即返 failed 不执行远端命令
        if not _SYNC_NAME_RE.match(name):
            return self._sync_result(name, kind, mac_head, None, "failed", False, f"非法插件名(cmd 元字符): {name!r}")
        if url and not _SYNC_URL_RE.match(url):
            return self._sync_result(name, kind, mac_head, None, "failed", False, f"非法 URL(cmd 元字符): {url!r}")
        win_path = (
            _WIN_COMFY_ROOT + "\\ComfyUI"
            if kind == "engine"
            else f"{_WIN_CUSTOM_NODES}\\{name}"
        )
        if name in _ENGINE_SYNC_SKIP_NAMES:  # Q2
            return self._sync_result(name, kind, mac_head, None, "skipped", False)
        action: str
        ledger_note = ""  # 引擎件账本补记警句(1122;空=成功/不适用)
        if not win_exists:
            # Win 缺(mac-only/手动条目)→ clone 新装(清单 URL;单件 300s)
            action = "cloned"
            code, out = self.run_remote_command(
                f"cd /d {_WIN_CUSTOM_NODES} && git clone --depth 1 {url} {name} 2>&1",
                self._remaining_timeout(deadline, _ENGINE_SYNC_ITEM_TIMEOUT_S),
            )
            if code != 0:
                return self._sync_result(
                    name, kind, mac_head, None, "failed", False,
                    f"git clone 失败: {out.strip()[:200]}",
                )
            # 1125 版本展示根修:新装浅克隆同样不带 tag——clone 成功后补拉
            # 一次(失败不阻断:装件本体已成功,只损失版本显示);带上溯上限
            # (1123 根修同款,防非 git 目录冒仓)。
            self.run_remote_command(
                f'set "GIT_CEILING_DIRECTORIES={self._git_ceiling(win_path)}" & '
                f'git -C "{win_path}" fetch --tags origin 2>&1',
                self._remaining_timeout(deadline, 60),
            )
        elif kind == "engine":
            # 1122 截3语义统一:引擎件对齐最新 release tag(update_job 同款幂等
            # 流=fetch tag+checkout --force)。旧 git pull --ff-only 在 tag-checkout
            # (detached)上必炸 diverging(0853 实弹:ComfyUI [failed])。注:cmd 的
            # ^ 是转义符,tag→commit 解析用 rev-list -n 1,不用 ^{} peel 语法。
            from comfyui.engine_manager import pick_latest_release
            code, out = self.run_remote_command(
                f'cd /d "{win_path}" && git ls-remote --tags origin 2>&1',
                self._remaining_timeout(deadline, 60),
            )
            latest = pick_latest_release(out.splitlines()) if code == 0 else None
            if not latest:
                return self._sync_result(
                    name, kind, mac_head, None, "failed", False,
                    "无法获取最新 release tag(网络?)",
                )
            code, out = self.run_remote_command(
                f'cd /d "{win_path}" && git fetch origin tag {latest} --force 2>&1 & '
                f"git rev-parse HEAD 2>nul & git rev-list -n 1 {latest} 2>nul",
                self._remaining_timeout(deadline, 90),
            )
            shas = [l.strip() for l in out.splitlines() if re.fullmatch(r"[0-9a-f]{40}", l.strip())]
            if len(shas) >= 2 and shas[0] == shas[-1]:
                # 已在最新 tag:账本仍可能停在旧值(历史移动未补记)——幂等补齐
                note = self._patch_win_engine_ledger(win_path, latest, deadline, shas[-1])
                return self._sync_result(
                    name, kind, mac_head, shas[-1], "skipped", True,
                    f"已是最新 release({latest})" + (f" | {note}" if note else ""),
                )
            action = "pulled"
            code, out = self.run_remote_command(
                f'cd /d "{win_path}" && git checkout --force {latest} 2>&1',
                self._remaining_timeout(deadline, _ENGINE_SYNC_ITEM_TIMEOUT_S),
            )
            if code != 0:
                return self._sync_result(
                    name, kind, mac_head, None, "failed", False,
                    f"对齐 {latest} 失败: {out.strip()[:200]}",
                )
            # 1122 冲突弹窗根修:引擎仓被移动,Win 账本同步补记(version/sha/
            # lastCheck)——否则 Win 卡显旧版,其 status 回放/启动横幅按旧账报
            # 「可更新」,点更新又被 update_job 按仓实况拒发,两边口径互咬。
            # 幂等补记(只动 engine 三键);警句不阻断,走回执 pipError 位。
            ledger_note = self._patch_win_engine_ledger(win_path, latest, deadline)
        elif mac_head is not None or win_exists:
            # Win 已有(both 插件/Win 独有)→ 先比 HEAD 再决定要不要 pull(1104
            # 优化:fetch 后 local HEAD == origin/HEAD = 已最新 → 跳过,省 SSH
            # 往返;落后才 pull。1122 用户令「Win 独有也要能更新」:Q1 旧「保留
            # 不动」退役——Win 独有件按仓自身 origin 拉最新,无 Mac HEAD 也照拉)
            # 1123 根修:找仓上溯上限=插件目录的父目录——非 git 目录(直装件)
            # 内的 git 不再落到引擎仓上,如实报「非 git 仓」而非误报 diverging。
            ceiling = self._git_ceiling(win_path)
            head_code, head_out = self.run_remote_command(
                f'set "GIT_CEILING_DIRECTORIES={ceiling}" & '
                f'cd /d "{win_path}" && git fetch origin --tags 2>&1 && '
                f"git rev-parse HEAD 2>&1 && git rev-parse origin/HEAD 2>&1",
                self._remaining_timeout(deadline, 60),
            )
            if head_code == 0:
                lines = [l.strip() for l in head_out.strip().splitlines() if l.strip() and not l.startswith(("From ", "origin/"))]
                if len(lines) >= 2 and lines[-2] == lines[-1]:
                    return self._sync_result(
                        name, kind, mac_head, lines[-1], "skipped", True,
                        # 1122 用户裁定:一致=成功态,措辞显「已是最新」不显「跳过」
                        "已是最新(与 GitHub 一致)",
                    )
            elif "not a git repository" in head_out:
                # Win 独有的手工件(zip 直装非 git 仓):拉不了也不算失败,诚实跳过
                return self._sync_result(
                    name, kind, None, None, "skipped", False,
                    "Win 独有且非 git 仓,保留不动",
                )
            # 不最新(或比对失败=保守走 pull)→ 从 GitHub 拉最新。
            # 1125 版本展示根修:fetch 带 --tags——存量件多为 --depth 1 浅克隆,
            # 本地无 tag,git describe 拿不到版本→面板只能回退短哈希(实盘
            # 81 行 52 行无版本);fetch 输出的 [new tag] 行在 rev-parse 之前,
            # 「已是最新」比对取末两行不受影响。
            action = "pulled"
            code, out = self.run_remote_command(
                f'set "GIT_CEILING_DIRECTORIES={ceiling}" & '
                f'cd /d "{win_path}" && git pull --ff-only 2>&1',
                self._remaining_timeout(deadline, _ENGINE_SYNC_ITEM_TIMEOUT_S),
            )
            if code != 0:
                return self._sync_result(
                    name, kind, mac_head, None, "failed", False,
                    f"git pull 失败: {out.strip()[:200]}",
                )
        # 依赖安装(R2⑤):有 requirements.txt 则 PYTHONUTF8=1 venv pip install
        pip_error = None
        code, out = self.run_remote_command(
            f'if exist "{win_path}\\requirements.txt" '
            f'(set PYTHONUTF8=1&& "{_WIN_VENV_PYTHON}" -m pip install -q -r "{win_path}\\requirements.txt" 2>&1) '
            f"else (echo NO_REQ)",
            self._remaining_timeout(deadline, 240),
        )
        if code != 0:
            pip_error = f"pip install 失败: {out.strip()[:200]}"  # ⚠️ 不阻断(C8)
        # 验证(1104 裁定口径):只确认目录在+HEAD 可读(_win_git_info 对缺目录/
        # 非 git/无提交恒 None),不比 Mac HEAD;winVersion 随回执(1122 版本展示)
        win_head, win_version = self._win_git_info(win_path)
        verified = win_head is not None
        return self._sync_result(
            name, kind, mac_head, win_head, action, verified, None,
            pip_error or ledger_note or None, win_version,
        )
