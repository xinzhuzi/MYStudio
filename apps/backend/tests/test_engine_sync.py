"""1104 引擎同步中心单测(tasks/11-04-engine-sync R5)。

矩阵:
  ① engine-sync.json 读/写/合并(load 缺失/坏 JSON → 空骨架;merge 有则更新
     URL 无则追加;write 原子回读);
  ② Mac 扫描(git 包收录,my-nodes/非 git 目录排除);
  ③ manifest 四态(both/mac-only/win-only/skip,mock SSH 的 dir 与 git HEAD);
  ④ sync_engine 逐项逻辑(mock SSH:1104 用户裁定「Windows 从 GitHub 拉最新,
     不 SSH 推 Mac HEAD」——engine/both=git pull --ff-only(零 reset --hard)、
     mac-only=clone、win-only/skip=跳过、pip PYTHONUTF8、验证只看目录在+HEAD
     可读(不比 Mac HEAD)、部分失败不阻断、整体超时、pip 失败不阻断)。

零真 SSH/网络:run_remote_command 一律实例级 Mock;Mac 侧用 tmp 真迷你 git 仓
(git init+remote add+空提交)承载扫描与 HEAD 读取。
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
import unittest
from email.message import Message
from http import HTTPStatus
from pathlib import Path
from unittest.mock import Mock, patch

from image_gen import server
from remote_ssh import service as svc_mod
from remote_ssh.service import SSHService, SSHServiceError

BACKEND_ROOT = Path(__file__).resolve().parents[1]

WIN_NODES = svc_mod._WIN_CUSTOM_NODES
WIN_ENGINE = svc_mod._WIN_COMFY_ROOT + "\\ComfyUI"


def _make_git_repo(path: Path, url: str) -> str:
    """tmp 迷你 git 仓:remote origin + 一个空提交;回 HEAD。"""
    path.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}
    subprocess.run(["git", "init", "-q", "--initial-branch=main"], cwd=path, check=True, env=env)
    subprocess.run(["git", "remote", "add", "origin", url], cwd=path, check=True, env=env)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "x"],
        cwd=path, check=True, env=env,
    )
    out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=path, capture_output=True, text=True, env=env)
    return out.stdout.strip()


class _MacHome:
    """tmp Mac 引擎家:ComfyUI(引擎仓)+ custom_nodes(plugin 仓/干扰件)。"""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.engine_head = _make_git_repo(root / "ComfyUI", "https://github.com/comfyanonymous/ComfyUI")
        self.nodes = root / "ComfyUI" / "custom_nodes"
        self.heads: dict[str, str] = {}
        for name, url in (
            ("pluginA", "https://example.com/a.git"),
            ("pluginB", "https://example.com/b.git"),
        ):
            self.heads[name] = _make_git_repo(self.nodes / name, url)
        # 干扰件:my-nodes(Q2 排除)/非 git 目录/散件文件
        _make_git_repo(self.nodes / "my-nodes", "https://example.com/my.git")
        (self.nodes / "notgit").mkdir()
        (self.nodes / "example_node.py.example").write_text("# 散件\n", encoding="utf-8")


class EngineSyncFileTests(unittest.TestCase):
    """① engine-sync.json 读/写/合并(R1)。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._json_path = Path(self._tmp.name) / "engine-sync.json"
        # 路径缝:env 覆写指向 tmp,防写脏仓库文件
        seal = patch.dict(os.environ, {"MYSTUDIO_ENGINE_SYNC_JSON": str(self._json_path)})
        seal.start()
        self.addCleanup(seal.stop)

    def test_load_missing_file_returns_empty_skeleton(self) -> None:
        doc = svc_mod.load_engine_sync_doc()
        self.assertEqual(doc["version"], 1)
        self.assertEqual(doc["comfyui"]["repo"], svc_mod._COMFYUI_REPO_URL)
        self.assertEqual(doc["comfyui"]["strategy"], "match-local")
        self.assertEqual(doc["plugins"], [])

    def test_load_bad_json_returns_empty_skeleton(self) -> None:
        self._json_path.write_text("{oops", encoding="utf-8")
        self.assertEqual(svc_mod.load_engine_sync_doc()["plugins"], [])

    def test_load_preserves_manual_comfyui_entry(self) -> None:
        self._json_path.write_text(
            json.dumps({"version": 1, "comfyui": {"repo": "https://x/y.git", "strategy": "match-local"},
                        "plugins": [{"name": "p", "url": "u"}]}),
            encoding="utf-8",
        )
        doc = svc_mod.load_engine_sync_doc()
        self.assertEqual(doc["comfyui"]["repo"], "https://x/y.git")
        self.assertEqual(doc["plugins"], [{"name": "p", "url": "u"}])

    def test_merge_appends_new_and_updates_url(self) -> None:
        doc = svc_mod.load_engine_sync_doc()
        doc, changed = svc_mod.merge_mac_scan_into_doc(doc, {"a": "u1"})
        self.assertTrue(changed)
        doc, changed = svc_mod.merge_mac_scan_into_doc(doc, {"a": "u2", "b": "ub"})
        self.assertTrue(changed)
        self.assertEqual(doc["plugins"], [{"name": "a", "url": "u2"}, {"name": "b", "url": "ub"}])
        doc, changed = svc_mod.merge_mac_scan_into_doc(doc, {"a": "u2", "b": "ub"})
        self.assertFalse(changed)  # 幂等:无变化不回写

    def test_write_then_load_roundtrip(self) -> None:
        doc = svc_mod.load_engine_sync_doc()
        doc, _ = svc_mod.merge_mac_scan_into_doc(doc, {"a": "u1"})
        svc_mod.write_engine_sync_doc(doc)
        self.assertEqual(svc_mod.load_engine_sync_doc(), doc)
        self.assertFalse((self._json_path.parent / "engine-sync.json.tmp").exists())  # tmp 已 replace

    def test_repo_single_source_file_exists_with_plugins(self) -> None:
        """验收锚:仓库单真源文件在位且带引擎条目(committed 真件,非 tmp)。"""
        path = BACKEND_ROOT / "comfyui" / "engine-sync.json"
        self.assertTrue(path.exists(), "engine-sync.json 单真源应随仓库提交")
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["comfyui"]["strategy"], "match-local")
        self.assertGreater(len(data["plugins"]), 0)
        self.assertNotIn("my-nodes", [p["name"] for p in data["plugins"]])


class MacScanTests(unittest.TestCase):
    """② Mac 扫描:git 包收录,my-nodes/非 git 排除(R1)。"""

    def test_scan_collects_git_packages_and_excludes_noise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _MacHome(Path(tmp))
            with patch("comfyui.manifest.comfy_home", return_value=home.root):
                scan = svc_mod._scan_mac_git_packages()
        self.assertEqual(
            scan,
            {"pluginA": "https://example.com/a.git", "pluginB": "https://example.com/b.git"},
        )


class _SshStub:
    """run_remote_command 桩:按命令片段路由回 (code, out)。

    Win 侧目录名集合与 HEAD 表可注入;clone/pip 默认成功(clone 回 ok,pip 回
    NO_REQ=无 requirements),可经 clone_results/pip_results 按名覆写失败场景。
    """

    def __init__(
        self,
        win_dirs: set[str],
        win_heads: dict[str, str],
        clone_results: dict[str, tuple[int, str]] | None = None,
        pip_results: dict[str, tuple[int, str]] | None = None,
        pull_results: dict[str, tuple[int, str]] | None = None,
        win_procs: list[str] | None = None,
        win_tags: dict[str, str] | None = None,
        win_fallback_tags: dict[str, str] | None = None,
        on_latest_tag: bool = False,
    ) -> None:
        self.win_dirs = win_dirs
        self.win_heads = win_heads
        self.clone_results = clone_results or {}
        self.pip_results = pip_results or {}
        self.pull_results = pull_results or {}
        self.win_procs = win_procs or []
        self.win_tags = win_tags or {}
        self.win_fallback_tags = win_fallback_tags or {}
        self.on_latest_tag = on_latest_tag
        self.ledger_patches: list[str] = []
        self.commands: list[str] = []
        self.timeouts: list[float] = []

    def __call__(self, command: str, timeout_s: float = 30) -> tuple[int, str]:
        self.commands.append(command)
        self.timeouts.append(timeout_s)
        if "-EncodedCommand " in command:
            script = base64.b64decode(command.split("-EncodedCommand ", 1)[1]).decode("utf-16le")
            if "Win32_Process" in script:
                # 1122 根修后探针回 PROC|pid|b64 行+PROCDONE(变异判据在 Python 侧)
                lines = [
                    f"PROC|{1000 + i}|{base64.b64encode(cl.encode('utf-8')).decode()}"
                    for i, cl in enumerate(self.win_procs)
                ]
                lines.append("PROCDONE")
                return (0, "\n".join(lines) + "\n")
        if "dir /b /ad" in command:
            return (0, "\r\n".join(sorted(self.win_dirs)))
        if "manifest.json" in command and "import json" in command:
            # 1122 账本补记:引擎仓移动后同步写 Win 账本(python -c 幂等补记)
            self.ledger_patches.append(command)
            return (0, "")
        if command.startswith("cd /d") and "rev-parse HEAD" in command and "rev-list" not in command:
            # 账本补记前取 HEAD(cd 形态,无 -C,先于通用 rev-parse 分支;
            # 须排除含 rev-list 的比对命令,免误吞)
            return (0, "e" * 40 + "\n")
        if "ls-remote --tags origin" in command:
            # 1122 截3:引擎件对齐最新 release tag(ls-remote 取远端 tag 榜)
            return (0, "".join(
                f"{'f' * 40}\trefs/tags/{t}\n{'e' * 40}\trefs/tags/{t}^{{}}\n"
                for t in (self.win_tags.get(WIN_ENGINE, "v0.46.2"),)
            ))
        if "rev-list -n 1" in command:
            # 引擎件「已在最新 tag?」比对(rev-parse HEAD & rev-list tag;
            # 须先于 fetch 分支——两命令在同一条 exec 里)
            head = self.win_heads.get(WIN_ENGINE, "e" * 40)
            tag_sha = "e" * 40 if self.on_latest_tag else "d" * 40
            return (0, f"{head}\n{tag_sha}\n")
        if "git fetch origin tag" in command:
            return (0, " * [new tag] fetched\n")
        if "fetch --tags origin" in command:
            # 1125 版本展示:clone 后补拉 tag(浅克隆不带 tag;与引擎分支的
            # 「git fetch origin tag」和插件比对命令的「git fetch origin --tags」
            # 子串互不重叠)
            return (0, " * [new tag] v1.2.3 -> v1.2.3\n")
        if "git checkout --force" in command:
            return (0, "Note: switching to 'v0.46.2'.\nHEAD is now at eeeeeee\n")
        if "rev-parse HEAD" in command:
            # 精确路径匹配(引擎路径是插件路径前缀,子串匹配会撞车)
            match = re.search(r'git -C "([^"]+)" rev-parse HEAD', command)
            key = match.group(1) if match else command
            if key in self.win_heads:
                head = self.win_heads[key]
                if head:
                    tag = self.win_tags.get(key, "")
                    if not tag:
                        # 1125 浅克隆兜底:describe 空 → for-each-ref 按时间取最新本地 tag
                        tag = self.win_fallback_tags.get(key, "")
                    return (0, head + "\n===V===\n" + (tag + "\n" if tag else ""))
                return (128, "===V===\n")  # 实弹:rev-parse 失败走 2>nul,stdout 仅余分隔行
            return (128, "===V===\n")
        if "git pull" in command:
            for name, result in self.pull_results.items():
                if name in command:
                    return result
            return (0, "Already up to date.\n")
        if "git clone" in command:
            for name, result in self.clone_results.items():
                if name in command:
                    return result
            return (0, "Cloning into 'x'...\ndone.\n")
        if "pip install" in command:
            for name, result in self.pip_results.items():
                if name in command:
                    return result
            return (0, "NO_REQ\n")
        if "schtasks" in command:
            return (0, "SUCCESS: The scheduled task \"EngineDurable\" has been started.\n")
        raise AssertionError(f"unexpected command: {command}")


def _service_with_stub(stub: _SshStub) -> SSHService:
    svc = SSHService()
    svc.run_remote_command = stub  # type: ignore[method-assign]
    return svc


class ManifestFourStatesTests(unittest.TestCase):
    """③ GET manifest 四态(R2:both/mac-only/win-only/skip;新 git 包追加回写)。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = _MacHome(Path(self._tmp.name))
        self.json_path = Path(self._tmp.name) / "engine-sync.json"
        envs = patch.dict(os.environ, {"MYSTUDIO_ENGINE_SYNC_JSON": str(self.json_path)})
        envs.start()
        self.addCleanup(envs.stop)
        self.comfy = patch("comfyui.manifest.comfy_home", return_value=self.home.root)
        self.comfy.start()
        self.addCleanup(self.comfy.stop)

    def test_manifest_reports_four_states_and_merges_scan_into_file(self) -> None:
        # Win 侧:pluginA(both)+ pluginC(win-only)+ my-nodes(skip 态由名单决定)
        stub = _SshStub(
            win_dirs={"pluginA", "pluginC", "my-nodes"},
            win_heads={
                WIN_ENGINE: "winengine0head",
                f"{WIN_NODES}\\pluginA": "winaplugin0head",
                f"{WIN_NODES}\\pluginC": "wincplugin0head",
            },
        )
        manifest = _service_with_stub(stub).get_engine_sync_manifest()
        by_name = {item["name"]: item for item in manifest["items"]}
        # 引擎条目恒首行且 both
        self.assertEqual(manifest["items"][0]["name"], "ComfyUI")
        self.assertEqual(by_name["ComfyUI"]["status"], "both")
        self.assertEqual(by_name["ComfyUI"]["macHead"], self.home.engine_head)
        self.assertEqual(by_name["ComfyUI"]["winHead"], "winengine0head")
        self.assertEqual(by_name["pluginA"]["status"], "both")
        self.assertEqual(by_name["pluginB"]["status"], "mac-only")  # Win 缺 → clone
        self.assertIsNone(by_name["pluginB"]["winHead"])
        self.assertEqual(by_name["pluginC"]["status"], "win-only")  # Win 独有 → 跳过
        self.assertEqual(by_name["pluginC"]["url"], "")  # 遗存件无 url
        self.assertEqual(by_name["my-nodes"]["status"], "skip")  # Q2
        # R1 合并回写:Mac 扫描(pluginA/pluginB)已进单真源文件
        written = json.loads(self.json_path.read_text(encoding="utf-8"))
        self.assertEqual(
            [p["name"] for p in written["plugins"]],
            ["pluginA", "pluginB"],
        )

    def test_manifest_only_manual_entry_reports_mac_only_not_skip(self) -> None:
        """1104 复核修:手动清单条目(R1 手动可编辑增删)双侧均无时不落 skip
        ——skip 只留给 my-nodes(Q2);手动件报 mac-only(可见可勾选,同步按
        URL clone,路径由 test_manual_file_entry_without_mac_repo_clones_by_url 钉)。"""
        self.json_path.write_text(
            json.dumps({
                "version": 1,
                "comfyui": {"repo": "https://github.com/comfyanonymous/ComfyUI", "strategy": "match-local"},
                "plugins": [{"name": "pluginManual", "url": "https://example.com/m.git"}],
            }),
            encoding="utf-8",
        )
        stub = _SshStub(
            win_dirs={"pluginA"},  # Win 亦无 pluginManual
            win_heads={WIN_ENGINE: "winengine0head", f"{WIN_NODES}\\pluginA": "wina0head"},
        )
        manifest = _service_with_stub(stub).get_engine_sync_manifest()
        by_name = {item["name"]: item for item in manifest["items"]}
        self.assertEqual(by_name["pluginManual"]["status"], "mac-only")  # 不再被 skip 吞掉
        self.assertIsNone(by_name["pluginManual"]["macHead"])
        self.assertIsNone(by_name["pluginManual"]["winHead"])
        # 边角钉死:清单声明但 Mac 无仓而 Win 已有 → 仍 win-only(无 Mac HEAD
        # 可对齐,同步跳过保留;归 both 会让 UI 承诺对齐而同步实际跳过)
        stub_declared_win_present = _SshStub(
            win_dirs={"pluginA", "pluginManual"},
            win_heads={
                WIN_ENGINE: "winengine0head",
                f"{WIN_NODES}\\pluginA": "wina0head",
                f"{WIN_NODES}\\pluginManual": "winm0head",
            },
        )
        manifest2 = _service_with_stub(stub_declared_win_present).get_engine_sync_manifest()
        by_name2 = {item["name"]: item for item in manifest2["items"]}
        self.assertEqual(by_name2["pluginManual"]["status"], "win-only")
        self.assertEqual(by_name2["pluginManual"]["winHead"], "winm0head")


class ManifestWinVersionTests(unittest.TestCase):
    """③b 清单版本展示(1122 用户令:面板要展示版本)。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = _MacHome(Path(self._tmp.name))
        self.json_path = Path(self._tmp.name) / "engine-sync.json"
        envs = patch.dict(os.environ, {"MYSTUDIO_ENGINE_SYNC_JSON": str(self.json_path)})
        envs.start()
        self.addCleanup(envs.stop)
        self.comfy = patch("comfyui.manifest.comfy_home", return_value=self.home.root)
        self.comfy.start()
        self.addCleanup(self.comfy.stop)

    def test_manifest_carries_win_version_tag_and_short_sha_fallback(self) -> None:
        stub = _SshStub(
            win_dirs={"pluginA"},
            win_heads={
                WIN_ENGINE: "e" * 40,
                f"{WIN_NODES}\\pluginA": "a" * 40,
            },
            win_tags={WIN_ENGINE: "v0.45.2"},  # pluginA 无 tag → 短 sha 回退
        )
        manifest = _service_with_stub(stub).get_engine_sync_manifest()
        by_name = {item["name"]: item for item in manifest["items"]}
        self.assertEqual(by_name["ComfyUI"]["winVersion"], "0.45.2")  # 剥前导 v
        self.assertEqual(by_name["pluginA"]["winVersion"], "a" * 7)  # 无 tag → 短 sha
        self.assertIsNone(by_name["pluginB"]["winVersion"])  # Win 缺 → None
        self.assertIsNone(by_name["pluginB"]["winHead"])

    def test_manifest_nongit_plugin_on_win_has_no_head_or_version(self) -> None:
        """1123 根修:zip 直装件(无 .git)在 Win 盘上存在但读不到自身 HEAD——
        不得把引擎仓的 HEAD/版本冒充成插件版本(实弹:ItsGemTools 行显示
        引擎版本 0.46.2)。"""
        stub = _SshStub(
            win_dirs={"pluginA", "pluginC"},  # pluginC 在盘但非 git(win_heads 无它)
            win_heads={WIN_ENGINE: "e" * 40, f"{WIN_NODES}\\pluginA": "a" * 40},
        )
        manifest = _service_with_stub(stub).get_engine_sync_manifest()
        by_name = {item["name"]: item for item in manifest["items"]}
        self.assertIsNone(by_name["pluginC"]["winHead"])
        self.assertIsNone(by_name["pluginC"]["winVersion"])
        self.assertEqual(by_name["pluginC"]["status"], "win-only")
        # 引擎行不受上溯上限影响(引擎目录自身照常命中)
        self.assertEqual(by_name["ComfyUI"]["winHead"], "e" * 40)
        self.assertEqual(by_name["pluginA"]["winVersion"], "a" * 7)

    def test_manifest_version_falls_back_to_local_tag_when_describe_empty(self) -> None:
        """1125 浅克隆根修:--depth 1 里 tag 指向的提交不在本地历史图上,
        describe 连不上线必空——同步链 fetch --tags 已把 tag 引用落本地,
        _win_git_info 追加 for-each-ref 按时间取最新兜底(describe 在能
        用时仍优先)。"""
        stub = _SshStub(
            win_dirs={"pluginA"},
            win_heads={
                WIN_ENGINE: "e" * 40,
                f"{WIN_NODES}\\pluginA": "a" * 40,
            },
            # 引擎:describe 可用(tag==HEAD 所在)→ 仍走 describe;
            # pluginA:describe 空 → for-each-ref 兜底亮出本地 tag
            win_tags={WIN_ENGINE: "v0.46.3"},
            win_fallback_tags={f"{WIN_NODES}\\pluginA": "v.1.0.0"},
        )
        manifest = _service_with_stub(stub).get_engine_sync_manifest()
        by_name = {item["name"]: item for item in manifest["items"]}
        self.assertEqual(by_name["ComfyUI"]["winVersion"], "0.46.3")  # describe 优先不变
        self.assertEqual(by_name["pluginA"]["winVersion"], "1.0.0")  # 兜底 tag,剥前导 v 及可选点
        # 两者皆空才回退短 sha(既有测试覆盖)


class PipRunningPredicateTests(unittest.TestCase):
    """③c 变异 pip 判据(1122 同步全败根修的判据本体,纯函数零 SSH)。"""

    VENV = "E:\\IP\\漫影工作室\\comfyui\\venv\\Scripts\\python.exe"

    @staticmethod
    def _lines(*cmdlines: str, done: bool = True) -> list[str]:
        out = [
            f"PROC|{4000 + i}|{base64.b64encode(cl.encode('utf-8')).decode()}"
            for i, cl in enumerate(cmdlines)
        ]
        if done:
            out.append("PROCDONE")
        return out

    def test_mutating_pip_blocks(self) -> None:
        self.assertTrue(svc_mod._pip_running_from_proc_lines(
            self._lines(f'"{self.VENV}" -m pip install torch==2.14.1'), self.VENV))

    def test_forward_slash_venv_form_blocks(self) -> None:
        # engine_task.py 启动形态(正斜杠):真装依赖时也须拦门
        self.assertTrue(svc_mod._pip_running_from_proc_lines(
            self._lines("E:/IP/漫影工作室/comfyui/venv/Scripts/python.exe -m pip install triton -i https://pypi.tuna.tsinghua.edu.cn/simple"),
            self.VENV))

    def test_readonly_pip_show_never_blocks(self) -> None:
        # 1122 用户实弹症:torch-info 轮询的 pip show 探针曾把门恒关
        self.assertFalse(svc_mod._pip_running_from_proc_lines(
            self._lines(f'"{self.VENV}" -m pip show torch'), self.VENV))

    def test_readonly_import_probe_never_blocks(self) -> None:
        self.assertFalse(svc_mod._pip_running_from_proc_lines(
            self._lines(f'"{self.VENV}" -c "import torch; print(torch.__version__)"'), self.VENV))

    def test_engine_main_py_never_blocks(self) -> None:
        self.assertFalse(svc_mod._pip_running_from_proc_lines(
            self._lines("E:/IP/漫影工作室/comfyui/venv/Scripts/python.exe E:/IP/漫影工作室/comfyui/ComfyUI/main.py --listen 0.0.0.0 --port 17000"),
            self.VENV))
        self.assertFalse(svc_mod._pip_running_from_proc_lines(
            self._lines(f'"{self.VENV}" E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\main.py --port 17000'), self.VENV))

    def test_non_venv_pip_ignored(self) -> None:
        self.assertFalse(svc_mod._pip_running_from_proc_lines(
            self._lines('D:\\Python312\\python.exe -m pip install requests'), self.VENV))

    def test_no_python_procs_is_open_gate(self) -> None:
        # 引擎全停+无探针:PROCDONE 独在 = 合法空清单 → 放行
        self.assertFalse(svc_mod._pip_running_from_proc_lines(
            self._lines(done=True), self.VENV))

    def test_missing_procdone_fails_closed(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "无法核实"):
            svc_mod._pip_running_from_proc_lines(
                self._lines(f'"{self.VENV}" -m pip show torch', done=False), self.VENV)

    def test_clixml_noise_tolerated(self) -> None:
        noisy = ["<Obj S=\"progress\">CLIXML 噪声</Obj>"] + self._lines(
            f'"{self.VENV}" -m pip download torch'
        )
        self.assertTrue(svc_mod._pip_running_from_proc_lines(noisy, self.VENV))


class SyncEngineTests(unittest.TestCase):
    """④ sync_engine 逐项逻辑(mock SSH;R2 契约 + Q1/Q2/Q3/Q6/C8)。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = _MacHome(Path(self._tmp.name))
        self.json_path = Path(self._tmp.name) / "engine-sync.json"
        envs = patch.dict(os.environ, {"MYSTUDIO_ENGINE_SYNC_JSON": str(self.json_path)})
        envs.start()
        self.addCleanup(envs.stop)
        self.comfy = patch("comfyui.manifest.comfy_home", return_value=self.home.root)
        self.comfy.start()
        self.addCleanup(self.comfy.stop)
        # 预置清单(pluginA/pluginB 已入;pluginManual=手动条目 Mac 无本地仓)
        self.json_path.write_text(
            json.dumps({
                "version": 1,
                "comfyui": {"repo": "https://github.com/comfyanonymous/ComfyUI", "strategy": "match-local"},
                "plugins": [
                    {"name": "pluginA", "url": "https://example.com/a.git"},
                    {"name": "pluginB", "url": "https://example.com/b.git"},
                    {"name": "pluginManual", "url": "https://example.com/m.git"},
                ],
            }),
            encoding="utf-8",
        )

    def _stub(self, **win_heads: str | None) -> _SshStub:
        heads = {
            WIN_ENGINE: win_heads.get("engine", "winengine0head"),
            f"{WIN_NODES}\\pluginA": win_heads.get("pluginA", "wina0head"),
            f"{WIN_NODES}\\pluginB": win_heads.get("pluginB", "winb0head"),
            f"{WIN_NODES}\\pluginManual": win_heads.get("pluginManual", "winm0head"),
            f"{WIN_NODES}\\pluginC": win_heads.get("pluginC", "winc0head"),
        }
        return _SshStub(
            win_dirs={"pluginA", "pluginC", "my-nodes"},
            win_heads={k: v for k, v in heads.items() if v is not None},
        )

    def test_sync_defers_when_remote_pip_is_running(self) -> None:
        stub = _SshStub(
            set(), {},
            win_procs=[
                '"E:\\IP\\漫影工作室\\comfyui\\venv\\Scripts\\python.exe" -m pip '
                "install torch==2.14.1 --index-url https://mirror.sjtu.edu.cn/x"
            ],
        )
        with self.assertRaisesRegex(RuntimeError, "远端 pip 仍在运行"):
            _service_with_stub(stub).sync_engine(["ComfyUI"])

    def test_engine_aligned_to_latest_release_tag(self) -> None:
        """1122 截3语义统一:引擎件=对齐最新 release tag(fetch+checkout --force);
        旧 git pull --ff-only 在 tag-detached 上必炸 diverging(0853 实弹)。"""
        stub = self._stub(engine="winengine0head")  # Win HEAD 与 Mac HEAD 不同
        result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual((item["type"], item["action"], item["verified"]), ("engine", "pulled", True))
        checkout = [c for c in stub.commands if "git checkout --force" in c]
        self.assertEqual(len(checkout), 1)  # 从 GitHub 对齐最新 tag
        self.assertIn("v0.46.2", checkout[0])
        self.assertIn(WIN_ENGINE, checkout[0])
        # 1104 用户裁定:不 SSH 推 Mac HEAD——整轮零 reset --hard
        self.assertFalse(any("reset --hard" in c for c in stub.commands))
        # 引擎件不再走插件线的 pull --ff-only
        self.assertFalse(any("git pull" in c for c in stub.commands))
        # 验证不比 Mac HEAD:Win HEAD≠Mac HEAD 仍 verified(只看 HEAD 可读)
        self.assertNotEqual(item["winHead"], item["macHead"])
        self.assertTrue(item["verified"])
        # 依赖链:PYTHONUTF8=1 venv pip install(R2⑤)
        pip = [c for c in stub.commands if "pip install" in c]
        self.assertEqual(len(pip), 1)
        self.assertIn("PYTHONUTF8=1", pip[0])
        self.assertIn(svc_mod._WIN_VENV_PYTHON, pip[0])
        # 1122 账本补记:引擎仓被移动后同步写 Win 账本(version/sha/lastCheck)
        self.assertEqual(len(stub.ledger_patches), 1)
        self.assertIn("e['version']='v0.46.2'", stub.ledger_patches[0])
        self.assertIn(f"e['sha']='{'e' * 40}'", stub.ledger_patches[0])
        self.assertIn("'pinnedSha'", stub.ledger_patches[0])
        self.assertIsNone(item["pipError"])  # 补记成功=零警句

    def test_engine_on_latest_tag_skips(self) -> None:
        # 已在最新 release tag 上(HEAD==tag commit)→ skipped 不 checkout;
        # 账本仍幂等补记(历史移动可能没写账)
        stub = self._stub(engine="e" * 40)
        stub.on_latest_tag = True
        result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual(item["action"], "skipped")
        self.assertIn("已是最新 release", item["error"])
        self.assertFalse(any("git checkout" in c for c in stub.commands))
        self.assertEqual(len(stub.ledger_patches), 1)

    def test_engine_sync_works_without_mac_head(self) -> None:
        """1104 裁定随修:引擎不再要求 Mac HEAD 可读(不比 Mac 版本)——
        Mac 引擎目录非 git(HEAD=None)时照样对齐最新 tag,不再秒拒。"""
        stub = self._stub(engine="winengine0head")
        with patch.object(svc_mod, "_mac_git_head", return_value=None):
            result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual((item["action"], item["verified"]), ("pulled", True))
        self.assertTrue(any("git checkout --force" in c for c in stub.commands))

    def test_both_plugin_pulled_from_github(self) -> None:
        stub = self._stub(pluginA="wina0head")
        result = _service_with_stub(stub).sync_engine(["pluginA"])
        item = result["items"][0]
        self.assertEqual((item["type"], item["action"], item["verified"]), ("plugin", "pulled", True))
        pull = [c for c in stub.commands if "git pull" in c]
        self.assertEqual(len(pull), 1)
        self.assertIn(f"{WIN_NODES}\\pluginA", pull[0])
        self.assertIn("--ff-only", pull[0])
        # 不比 Mac 版本:命令里不许出现 Mac HEAD
        self.assertNotIn(self.home.heads["pluginA"], pull[0])
        # 1125 版本展示根修:存量件多为浅克隆本地无 tag(面板只显短哈希)——
        # 比对性 fetch 必带 --tags,拉回后 describe 才亮得出真版本号
        self.assertTrue(any("git fetch origin --tags" in c for c in stub.commands))

    def test_mac_only_plugin_clones_without_pull(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginB"])
        item = result["items"][0]
        self.assertEqual((item["action"], item["verified"]), ("cloned", True))  # 新装验证=目录在+HEAD 可读
        # acc324cb 起克隆带 --depth 1(浅克隆,Win→GitHub 提速)
        self.assertTrue(any("git clone --depth 1 https://example.com/b.git pluginB" in c for c in stub.commands))
        self.assertFalse(any("git pull" in c for c in stub.commands))  # clone 件不 pull
        self.assertFalse(any("reset --hard" in c for c in stub.commands))
        # 1125 版本展示根修:新装浅克隆同样不带 tag——clone 成功后补拉一次
        # (带上溯上限,失败不阻断;结果不影响 cloned/verified)
        tag_fetch = [c for c in stub.commands if "fetch --tags origin" in c]
        self.assertEqual(len(tag_fetch), 1)
        self.assertTrue(tag_fetch[0].startswith('set "GIT_CEILING_DIRECTORIES='))
        self.assertIn(f"{WIN_NODES}\\pluginB", tag_fetch[0])

    def test_win_only_pulls_from_own_origin_my_nodes_skips(self) -> None:
        """1122 用户令「Win 独有也要能更新」:win-only 件按仓自身 origin 拉最新
        (Q1 旧「保留不动」退役);my-nodes 仍跳过(Q2)。"""
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginC", "my-nodes"])
        self.assertEqual([r["action"] for r in result["items"]], ["pulled", "skipped"])
        pull = [c for c in stub.commands if "git pull" in c]
        self.assertEqual(len(pull), 1)
        self.assertIn(f"{WIN_NODES}\\pluginC", pull[0])
        self.assertFalse(any("git clone" in c for c in stub.commands))

    def test_win_only_non_git_dir_skips_without_red(self) -> None:
        # Win 独有的 zip 直装件(非 git 仓):拉不了也不算失败——诚实跳过
        stub = self._stub()
        svc = _service_with_stub(stub)
        inner = svc.run_remote_command
        def routed(command, timeout_s=30):
            # 真实形态:带上溯上限后,非 git 目录内的 fetch 如实报 not a git repository
            if "GIT_CEILING_DIRECTORIES" in command and "git fetch origin" in command:
                return (128, "fatal: not a git repository (or any of the parent directories): .git\n")
            return inner(command, timeout_s)
        svc.run_remote_command = routed  # type: ignore[method-assign]
        result = svc.sync_engine(["pluginC"])
        item = result["items"][0]
        self.assertEqual(item["action"], "skipped")
        self.assertIn("非 git 仓", item["error"])
        self.assertFalse(any("git pull" in c for c in stub.commands))

    def test_plugin_git_commands_capped_at_plugin_parent_dir(self) -> None:
        """1123 根修:插件路径的 git 命令一律带 GIT_CEILING_DIRECTORIES=插件目录的
        父目录——非 git 目录内的 git 不再上溯到引擎仓(误报 diverging/冒出版本)。"""
        stub = self._stub()
        svc = _service_with_stub(stub)
        svc.get_engine_sync_manifest()
        svc.sync_engine(["pluginA"])
        prefix = f'set "GIT_CEILING_DIRECTORIES={WIN_NODES}" & '
        plugin_git = [
            c for c in stub.commands if "git " in c and f"{WIN_NODES}\\pluginA" in c
        ]
        self.assertGreaterEqual(len(plugin_git), 3)  # 读版本+比对+拉取
        for command in plugin_git:
            self.assertTrue(command.startswith(prefix), command)
        # 引擎行:上限=引擎目录的父目录,引擎仓自身照常可读
        engine_info = [
            c for c in stub.commands if f'git -C "{WIN_ENGINE}" rev-parse HEAD' in c
        ]
        self.assertEqual(len(engine_info), 1)
        self.assertTrue(
            engine_info[0].startswith(
                f'set "GIT_CEILING_DIRECTORIES={svc_mod._WIN_COMFY_ROOT}" & '
            ),
            engine_info[0],
        )

    def test_git_ceiling_is_parent_dir_windows_semantics(self) -> None:
        # 本模块跑在 macOS:父目录须按 Windows 分隔符解析(Posix Path 不认反斜杠)
        self.assertEqual(
            svc_mod.SSHService._git_ceiling(f"{WIN_NODES}\\pluginA"), WIN_NODES
        )
        self.assertEqual(
            svc_mod.SSHService._git_ceiling(WIN_ENGINE), svc_mod._WIN_COMFY_ROOT
        )

    def test_manual_file_entry_without_mac_repo_clones_by_url(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginManual"])
        item = result["items"][0]
        self.assertEqual((item["action"], item["verified"]), ("cloned", True))
        self.assertTrue(any("git clone --depth 1 https://example.com/m.git pluginManual" in c for c in stub.commands))

    def test_session_drop_mid_sync_reconnects_and_retries_once(self) -> None:
        """1104 B5:克隆途中会话死(session not active)→唤醒 keeper 重连→本件重试成功。"""
        stub = self._stub()

        class _DropOnce:
            """首条 git clone 抛会话死指纹;其余透传 stub。

            可调用对象包装(实例 __call__ 赋值不进特殊方法类型查找,不生效)。
            """

            def __init__(self, inner: _SshStub) -> None:
                self.inner = inner
                self.dropped = False

            def __call__(self, command: str, timeout_s: float = 30) -> tuple[int, str]:
                if "git clone" in command and not self.dropped:
                    self.dropped = True
                    raise SSHServiceError("远端命令执行失败: SSH session not active")
                return self.inner(command, timeout_s)

        wrapper = _DropOnce(stub)
        svc = _service_with_stub(stub)
        svc.run_remote_command = wrapper  # type: ignore[method-assign]
        # keeper 已起且连接翻绿(_reconnect_for_sync 轮询立即通过)
        svc._started = True
        svc._connected = True
        svc._client = object()
        result = svc.sync_engine(["pluginB"])
        item = result["items"][0]
        self.assertEqual((item["action"], item["verified"]), ("cloned", True))
        self.assertTrue(wrapper.dropped)  # 首发确实被掐过

    def test_non_session_ssh_error_fails_without_reconnect_retry(self) -> None:
        """1104 B5 对照:非会话类 SSHServiceError(如权限拒)不触发重连重试,单次即败。"""
        stub = self._stub()

        class _RejectOnce:
            def __init__(self, inner: _SshStub) -> None:
                self.inner = inner
                self.rejected = False

            def __call__(self, command: str, timeout_s: float = 30) -> tuple[int, str]:
                if "git clone" in command and not self.rejected:
                    self.rejected = True
                    raise SSHServiceError("SFTP 打开失败: permission denied")
                return self.inner(command, timeout_s)

        wrapper = _RejectOnce(stub)
        svc = _service_with_stub(stub)
        svc.run_remote_command = wrapper  # type: ignore[method-assign]
        svc._started = True
        svc._connected = True
        svc._client = object()
        result = svc.sync_engine(["pluginB"])
        item = result["items"][0]
        self.assertEqual(item["action"], "failed")
        self.assertIn("permission denied", item["error"])
        self.assertTrue(wrapper.rejected)

    def test_empty_detail_channel_timeout_also_triggers_reconnect_retry(self) -> None:
        """1105 补:「远端命令执行失败:」尾空(socket.timeout/EOFError str 恒空)
        也走重连重试——01:11 实弹 Frame-Interpolation 件抽风形态。"""
        stub = self._stub()

        class _BlipOnce:
            def __init__(self, inner: _SshStub) -> None:
                self.inner = inner
                self.blipped = False

            def __call__(self, command: str, timeout_s: float = 30) -> tuple[int, str]:
                if "git clone" in command and not self.blipped:
                    self.blipped = True
                    raise SSHServiceError("远端命令执行失败: ")
                return self.inner(command, timeout_s)

        wrapper = _BlipOnce(stub)
        svc = _service_with_stub(stub)
        svc.run_remote_command = wrapper  # type: ignore[method-assign]
        svc._started = True
        svc._connected = True
        svc._client = object()
        result = svc.sync_engine(["pluginB"])
        item = result["items"][0]
        self.assertEqual((item["action"], item["verified"]), ("cloned", True))
        self.assertTrue(wrapper.blipped)

    def test_partial_failure_does_not_block_rest(self) -> None:
        # pluginA pull 失败(exit 1);pluginB 正常 → 逐项回执 failed+cloned 并存(C8)
        stub = self._stub()
        stub.pull_results["pluginA"] = (1, "error: not possible to fast-forward")
        result = _service_with_stub(stub).sync_engine(["pluginA", "pluginB"])
        by_name = {r["name"]: r for r in result["items"]}
        self.assertEqual(by_name["pluginA"]["action"], "failed")
        self.assertIn("git pull 失败", by_name["pluginA"]["error"])
        self.assertEqual(by_name["pluginB"]["action"], "cloned")

    def test_verification_head_unreadable_reports_unverified(self) -> None:
        stub = self._stub(engine=None)  # 验证读回:Win HEAD 读不到(目录非 git)
        result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual(item["action"], "pulled")
        self.assertIsNone(item["winHead"])
        self.assertFalse(item["verified"])  # 诚实报未验证

    def test_pip_failure_does_not_block_item(self) -> None:
        stub = self._stub(engine="winengine0head")
        stub.pip_results["ComfyUI"] = (1, "ERROR: Could not find a version")
        result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual(item["action"], "pulled")
        self.assertTrue(item["verified"])  # ⚠️ pip 失败不阻断(C8),仍验证
        self.assertIn("pip install 失败", item["pipError"])

    def test_overall_timeout_marks_remaining_items_failed(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginA", "pluginB"], timeout_s=0)
        self.assertEqual([r["action"] for r in result["items"]], ["failed", "failed"])
        self.assertIn("整体超时", result["items"][0]["error"])  # Q3 30min 口径
        # 超时后零改动类 SSH 命令(仅同步前的 Win 目录盘点)
        self.assertFalse(any("git pull" in c or "git clone" in c or "pip install" in c for c in stub.commands))

    def test_item_and_overall_timeouts_1104_calibration(self) -> None:
        """1104 修正锚:单件 git 上限 300s(clone/pull)、整体 30min(41 件全量
        clone 需要时间;旧值 180s/10min 实弹不够)。"""
        self.assertEqual(svc_mod._ENGINE_SYNC_ITEM_TIMEOUT_S, 300.0)
        self.assertEqual(svc_mod._ENGINE_SYNC_OVERALL_TIMEOUT_S, 1800.0)
        # both 件 pull 的单命令预算=300s 上限(剩余预算>300 时取 300)
        stub = self._stub()
        _service_with_stub(stub).sync_engine(["pluginA"])
        pull_timeouts = [t for c, t in zip(stub.commands, stub.timeouts) if "git pull" in c]
        self.assertEqual(pull_timeouts, [300.0])
        # mac-only 件 clone 的单命令预算同款 300s 上限
        stub2 = self._stub()
        _service_with_stub(stub2).sync_engine(["pluginB"])
        clone_timeouts = [t for c, t in zip(stub2.commands, stub2.timeouts) if "git clone" in c]
        self.assertEqual(clone_timeouts, [300.0])

    def test_unknown_plugin_reports_failed(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["no-such-plugin"])
        self.assertEqual(result["items"][0]["action"], "failed")
        self.assertIn("清单里没有", result["items"][0]["error"])

    def test_sync_one_rejects_malicious_name_before_exec(self) -> None:
        """F-1 (1109 审计): name 含 cmd 元字符 → 白名单闸拒,绝不执行远端命令。"""
        stub = self._stub()
        svc = _service_with_stub(stub)
        result = svc._sync_one("x & calc.exe", "plugin", "https://github.com/u/r.git", None, False, 1e12)
        self.assertEqual(result["action"], "failed")
        self.assertIn("cmd 元字符", result["error"])
        self.assertEqual(stub.commands, [])

    def test_sync_one_rejects_malicious_url_before_exec(self) -> None:
        """F-1: url 含 cmd 元字符(% 展开/ & 截断)→ 白名单闸拒,绝不执行远端命令。"""
        stub = self._stub()
        svc = _service_with_stub(stub)
        result = svc._sync_one("pluginB", "plugin", "https://x.com/%PATH% & calc", None, False, 1e12)
        self.assertEqual(result["action"], "failed")
        self.assertIn("cmd 元字符", result["error"])
        self.assertEqual(stub.commands, [])

    def test_sync_one_whitelist_charset_boundary(self) -> None:
        """F-1: 合法 name/url 字符集通过闸,正常 clone(白名单不误伤真插件)。"""
        stub = self._stub()
        svc = _service_with_stub(stub)
        result = svc._sync_one("plugin_ok-1.2", "plugin", "https://github.com/u/r.git", None, False, 1e12)
        self.assertEqual(result["action"], "cloned")
        self.assertIsNone(result["error"])


class RemoteMystudioTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = SSHService()
        self.service._client = object()
        self.service._connected = True
        self.commands = []
        self.app = False
        self.engine = False
        self.ready = False
        self.exe = True
        self.graceful = True
        self.kill_port = True
        self.daemon = False
        self.end_code = 0
        self.probe_code = 0
        self.lock = patch.object(svc_mod, "_acquire_torch_operation", side_effect=lambda _: svc_mod._TORCH_UPGRADE_LOCK.acquire())
        self.lock.start()
        self.addCleanup(self.lock.stop)
        self.service.run_remote_command = self.command

    def command(self, command, timeout_s=30):
        if "-EncodedCommand " in command:
            command = base64.b64decode(command.split("-EncodedCommand ", 1)[1]).decode("utf-16le")
        self.commands.append(command)
        if "Name='manying-studio.exe'" in command:
            return self.probe_code, str(int(self.app))
        if "Get-NetTCPConnection" in command:
            return 0, str(int(self.engine))
        if "Invoke-RestMethod" in command:
            return (0 if self.ready else 1), ""
        if "CloseMainWindow" in command:
            if self.graceful:
                self.app = False
            return 0, ""
        if "Stop-Process -Name manying-studio" in command:
            self.app = False
            return 0, ""
        if "Stop-Process -Id" in command:
            if self.kill_port:
                self.engine = False
            self.daemon = False
            return 0, ""
        if "Name like 'python%'" in command:
            return 0, str(int(self.engine or self.daemon))
        if command == "schtasks /End /TN EngineDurable":
            return self.end_code, "end failed" if self.end_code else "ok"
        if command.startswith("if exist"):
            return (0 if self.exe else 1), ""
        if command == "schtasks /Run /TN StartMYStudio":
            self.app = True
        return 0, "ok"

    def test_launch_running_does_not_relaunch(self):
        self.app = self.ready = True
        result = self.service.launch_remote_mystudio()
        self.assertTrue(result["alreadyRunning"])
        self.assertFalse(any("/Create" in command or "Stop-Process" in command for command in self.commands))

    def test_launch_running_restarts_dead_engine(self):
        self.app = True
        result = self.service.launch_remote_mystudio()
        self.assertTrue(result["engineRestarted"])
        self.assertIn("schtasks /Run /TN EngineDurable", self.commands)

    def test_launch_creates_interactive_task(self):
        result = self.service.launch_remote_mystudio()
        self.assertTrue(result["ok"])
        self.assertFalse(result["alreadyRunning"])
        commands = [command for command in self.commands if command.startswith(("if exist", "schtasks"))]
        self.assertTrue(commands[0].startswith("if exist"))
        self.assertIn("/IT /F", commands[1])
        self.assertEqual(commands[2], "schtasks /Run /TN StartMYStudio")

    def test_launch_missing_executable(self):
        self.exe = False
        result = self.service.launch_remote_mystudio()
        self.assertFalse(result["ok"])
        self.assertIn("未找到", result["output"])

    def test_shutdown_graceful(self):
        self.app = self.engine = True
        result = self.service.shutdown_remote_mystudio()
        self.assertTrue(result["ok"])
        self.assertFalse(any("Stop-Process -Name manying-studio" in command for command in self.commands))

    def test_shutdown_forces_app(self):
        self.app = True
        self.graceful = False
        clock = [0.0]
        with patch.object(svc_mod.time, "monotonic", side_effect=lambda: clock[0]), patch.object(
            svc_mod.time, "sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)
        ):
            result = self.service.shutdown_remote_mystudio()
        self.assertTrue(result["ok"])
        self.assertTrue(any("Stop-Process -Name manying-studio" in command for command in self.commands))

    def test_shutdown_already_stopped(self):
        result = self.service.shutdown_remote_mystudio()
        self.assertTrue(result["ok"])
        self.assertFalse(result["appWasRunning"])
        self.assertFalse(result["engineWasRunning"])
        self.assertFalse(any("Stop-Process" in command for command in self.commands))

    def test_probe_nonzero_exit_with_clean_count_is_tolerated(self):
        # 1110 实弹雷(两形态,exit code 不可信只看解析):①Get-NetTCPConnection
        # 零匹配时 powershell.exe exit=1(错误流副产品)而 stdout 干净 "0";
        # ②长连会话 recv_exit_status 毛刺返回 -1——计数在即答案,否则关完仍 503
        for probe_code in (1, -1):
            with self.subTest(probe_code=probe_code):
                self.setUp()
                self.probe_code = probe_code
                result = self.service.shutdown_remote_mystudio()
                self.assertTrue(result["ok"])
                self.assertFalse(result["appWasRunning"])

    def test_shutdown_port_still_listening(self):
        self.engine = True
        self.kill_port = False
        clock = [0.0]
        with patch.object(svc_mod.time, "monotonic", side_effect=lambda: clock[0]), patch.object(
            svc_mod.time, "sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)
        ):
            result = self.service.shutdown_remote_mystudio()
        self.assertFalse(result["ok"])
        self.assertIn("17000", result["output"])

    def test_session_switch_aborts_both_actions(self):
        for action in ("launch_remote_mystudio", "shutdown_remote_mystudio"):
            with self.subTest(action=action):
                original_client = object()
                new_client = object()
                self.service._client = original_client
                clients = []

                def switch_client(command, timeout_s=30, clients=clients, new_client=new_client):
                    clients.append(self.service._client)
                    self.service._client = new_client
                    return 0, "0"

                with patch.object(self.service, "run_remote_command", side_effect=switch_client), self.assertRaisesRegex(
                    SSHServiceError, "SSH 连接已切换,操作中止"
                ):
                    getattr(self.service, action)()
                self.assertEqual(clients, [original_client])

    def test_shutdown_kills_heal_watch_when_end_fails(self):
        self.daemon = True
        self.end_code = 1
        result = self.service.shutdown_remote_mystudio()
        self.assertTrue(result["ok"])
        kill = next(command for command in self.commands if "Stop-Process -Id" in command)
        self.assertIn("engine_task", kill)
        self.assertIn(svc_mod._TORCH_KILL_PATTERN, kill)
        self.assertLess(self.commands.index("schtasks /End /TN EngineDurable"), self.commands.index(kill))
        self.assertFalse(self.daemon)

    def test_actions_share_deadline_and_report_timeout(self):
        for action in ("launch_remote_mystudio", "shutdown_remote_mystudio"):
            with self.subTest(action=action):
                clock = [0.0]
                timeouts = []

                def slow_command(command, timeout_s=30, timeouts=timeouts, clock=clock):
                    timeouts.append(timeout_s)
                    clock[0] += 2
                    return 0, "0"

                with patch.object(svc_mod.time, "monotonic", side_effect=lambda clock=clock: clock[0]), patch.object(
                    self.service, "run_remote_command", side_effect=slow_command
                ):
                    result = getattr(self.service, action)(timeout_s=3)
                self.assertFalse(result["ok"])
                self.assertIn("超时", result["output"])
                self.assertEqual(timeouts, [3, 1])

    def test_busy_upgrade_sends_no_commands(self):
        with patch.object(svc_mod, "_acquire_torch_operation", side_effect=RuntimeError("升级进行中")):
            with self.assertRaises(SSHServiceError):
                self.service.launch_remote_mystudio()
        self.assertEqual(self.commands, [])

    def test_failed_probe_does_not_create_task(self):
        self.service.run_remote_command = lambda command, timeout_s=30: (1, "probe failed")
        with self.assertRaises(SSHServiceError):
            self.service.launch_remote_mystudio()


class _ComfyHandler(server.Handler):
    """照 test_remote_ssh_server_routes 范式:捕获应答+直通鉴权。"""

    def _authorized(self) -> bool:
        return True

    def _send_json(self, payload, status: int = HTTPStatus.OK) -> None:
        self.response = (payload, status)

    def _send_error_json(self, status: int, message: str, code: str = "error") -> None:
        self.response = ({"error": {"message": message, "code": code}}, status)


class EngineSyncRouteTests(unittest.TestCase):
    """R2 端点闸:SSH 断开 503 ssh-disconnected / items 空 400 / 通路上回执。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        seal = patch("comfyui.manifest.comfy_home", return_value=Path(self._tmp.name))
        seal.start()
        self.addCleanup(seal.stop)

    def _comfy(self, method: str, path: str, payload: dict | None = None):
        handler = _ComfyHandler.__new__(_ComfyHandler)
        handler.headers = Message()
        handler._comfy(method, path, payload or {}, {})
        return handler.response

    def test_manifest_sync_and_restart_routes_gate_on_disconnected_ssh(self) -> None:
        fake = Mock()
        fake.status.return_value = {"connected": False}
        with patch("image_gen.server._ssh_service", return_value=fake):
            for method, path, payload in (
                ("GET", "/comfy/ssh/engine-sync-manifest", None),
                ("POST", "/comfy/ssh/sync-engine", {"items": ["ComfyUI"]}),
                ("POST", "/comfy/ssh/restart-engine", {}),
            ):
                with self.subTest(path=path):
                    body, status = self._comfy(method, path, payload)
                    self.assertEqual(status, HTTPStatus.SERVICE_UNAVAILABLE)
                    self.assertEqual(body["error"]["code"], "ssh-disconnected")

    def test_sync_engine_rejects_empty_or_malformed_items(self) -> None:
        fake = Mock()
        fake.status.return_value = {"connected": True}
        with patch("image_gen.server._ssh_service", return_value=fake):
            for payload in ({"items": []}, {"items": "ComfyUI"}, {}, {"items": ["  "]}):
                with self.subTest(payload=payload):
                    body, status = self._comfy("POST", "/comfy/ssh/sync-engine", payload)
                    self.assertEqual(status, HTTPStatus.BAD_REQUEST)
                    self.assertEqual(body["error"]["code"], "sync-engine-invalid")

    def test_sync_engine_passes_items_through_to_service(self) -> None:
        fake = Mock()
        fake.status.return_value = {"connected": True}
        fake.sync_engine.return_value = {"items": [{"name": "ComfyUI", "action": "pulled"}]}
        with patch("image_gen.server._ssh_service", return_value=fake):
            body, status = self._comfy("POST", "/comfy/ssh/sync-engine", {"items": ["ComfyUI"]})
        self.assertEqual(status, HTTPStatus.OK)
        fake.sync_engine.assert_called_once_with(["ComfyUI"])
        self.assertEqual(body["items"][0]["action"], "pulled")

    def test_sync_engine_accepts_optional_timeout_s(self) -> None:
        """1104 复核修:可选 timeoutS(剩余预算秒数)透传——前端逐件单发时让
        整体 10min 超时(Q3)跨批次生效;非法值(0/负/字符串/bool)按 400 拒。"""
        fake = Mock()
        fake.status.return_value = {"connected": True}
        fake.sync_engine.return_value = {"items": []}
        with patch("image_gen.server._ssh_service", return_value=fake):
            body, status = self._comfy(
                "POST", "/comfy/ssh/sync-engine", {"items": ["ComfyUI"], "timeoutS": 30}
            )
            self.assertEqual(status, HTTPStatus.OK)
            self.assertEqual(body["items"], [])
            fake.sync_engine.assert_called_once_with(["ComfyUI"], timeout_s=30.0)
            for bad in (0, -5, "10", True):
                with self.subTest(payload_bad=bad):
                    fake.reset_mock()
                    payload = {"items": ["ComfyUI"], "timeoutS": bad}
                    _, status = self._comfy("POST", "/comfy/ssh/sync-engine", payload)
                    self.assertEqual(status, HTTPStatus.BAD_REQUEST)
                    self.assertEqual(fake.sync_engine.call_count, 0)


if __name__ == "__main__":
    unittest.main()
