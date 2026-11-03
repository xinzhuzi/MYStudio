"""1104 引擎同步中心单测(tasks/11-04-engine-sync R5)。

矩阵:
  ① engine-sync.json 读/写/合并(load 缺失/坏 JSON → 空骨架;merge 有则更新
     URL 无则追加;write 原子回读);
  ② Mac 扫描(git 包收录,my-nodes/非 git 目录排除);
  ③ manifest 四态(both/mac-only/win-only/skip,mock SSH 的 dir 与 git HEAD);
  ④ sync_engine 逐项逻辑(mock SSH:engine/both=fetch+reset --hard Mac HEAD、
     mac-only=clone、win-only/skip=跳过、pip PYTHONUTF8、验证比对、部分失败
     不阻断、整体超时、pip 失败不阻断)。

零真 SSH/网络:run_remote_command 一律实例级 Mock;Mac 侧用 tmp 真迷你 git 仓
(git init+remote add+空提交)承载扫描与 HEAD 读取。
"""

from __future__ import annotations

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
from remote_ssh.service import SSHService

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
        reset_results: dict[str, tuple[int, str]] | None = None,
    ) -> None:
        self.win_dirs = win_dirs
        self.win_heads = win_heads
        self.clone_results = clone_results or {}
        self.pip_results = pip_results or {}
        self.reset_results = reset_results or {}
        self.commands: list[str] = []

    def __call__(self, command: str, timeout_s: float = 30) -> tuple[int, str]:
        self.commands.append(command)
        if "dir /b /ad" in command:
            return (0, "\r\n".join(sorted(self.win_dirs)))
        if "rev-parse HEAD" in command:
            # 精确路径匹配(引擎路径是插件路径前缀,子串匹配会撞车)
            match = re.search(r'git -C "([^"]+)" rev-parse HEAD', command)
            key = match.group(1) if match else command
            if key in self.win_heads:
                head = self.win_heads[key]
                return (0, head + "\n") if head else (128, "fatal: not a git repository\n")
            return (128, "fatal: no path matched\n")
        if "reset --hard" in command:
            for name, result in self.reset_results.items():
                if name in command:
                    return result
            return (0, "HEAD is now at x\n")
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

    def test_engine_aligned_via_fetch_and_hard_reset_to_mac_head(self) -> None:
        stub = self._stub(engine=self.home.engine_head)  # 验证读回=Mac HEAD
        result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual((item["type"], item["action"], item["verified"]), ("engine", "aligned", True))
        reset = [c for c in stub.commands if "reset --hard" in c]
        self.assertEqual(len(reset), 1)
        self.assertIn(self.home.engine_head, reset[0])  # Q6 强制对齐 Mac HEAD
        self.assertIn(WIN_ENGINE, reset[0])
        # 依赖链:PYTHONUTF8=1 venv pip install(R2⑤)
        pip = [c for c in stub.commands if "pip install" in c]
        self.assertEqual(len(pip), 1)
        self.assertIn("PYTHONUTF8=1", pip[0])
        self.assertIn(svc_mod._WIN_VENV_PYTHON, pip[0])

    def test_both_plugin_resets_to_mac_head(self) -> None:
        stub = self._stub(pluginA=self.home.heads["pluginA"])
        result = _service_with_stub(stub).sync_engine(["pluginA"])
        item = result["items"][0]
        self.assertEqual((item["type"], item["action"], item["verified"]), ("plugin", "aligned", True))
        self.assertIn(
            f'reset --hard {self.home.heads["pluginA"]}',
            " ".join(stub.commands),
        )

    def test_mac_only_plugin_clones_without_reset(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginB"])
        item = result["items"][0]
        self.assertEqual((item["action"], item["verified"]), ("cloned", True))  # 新装验证=目录在+HEAD 可读
        self.assertTrue(any("git clone https://example.com/b.git pluginB" in c for c in stub.commands))
        self.assertFalse(any("reset --hard" in c for c in stub.commands))  # R2③ clone 不 reset

    def test_win_only_and_my_nodes_skip_without_touch(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginC", "my-nodes"])
        self.assertEqual([r["action"] for r in result["items"]], ["skipped", "skipped"])  # Q1 不删 / Q2 不管
        self.assertFalse(any("reset --hard" in c or "git clone" in c for c in stub.commands))

    def test_manual_file_entry_without_mac_repo_clones_by_url(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginManual"])
        item = result["items"][0]
        self.assertEqual((item["action"], item["verified"]), ("cloned", True))
        self.assertTrue(any("git clone https://example.com/m.git pluginManual" in c for c in stub.commands))

    def test_partial_failure_does_not_block_rest(self) -> None:
        # pluginA reset 失败(exit 1);pluginB 正常 → 逐项回执 failed+cloned 并存(C8)
        stub = self._stub()
        stub.reset_results["pluginA"] = (1, "error: cannot lock ref")
        result = _service_with_stub(stub).sync_engine(["pluginA", "pluginB"])
        by_name = {r["name"]: r for r in result["items"]}
        self.assertEqual(by_name["pluginA"]["action"], "failed")
        self.assertIn("git fetch/reset 失败", by_name["pluginA"]["error"])
        self.assertEqual(by_name["pluginB"]["action"], "cloned")

    def test_verification_mismatch_reports_unverified(self) -> None:
        stub = self._stub(engine="different0head0not0mac0head0at0all")  # 验证读回≠Mac HEAD
        result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual(item["action"], "aligned")
        self.assertFalse(item["verified"])  # 诚实报未验证

    def test_pip_failure_does_not_block_item(self) -> None:
        stub = self._stub(engine=self.home.engine_head)
        stub.pip_results["ComfyUI"] = (1, "ERROR: Could not find a version")
        result = _service_with_stub(stub).sync_engine(["ComfyUI"])
        item = result["items"][0]
        self.assertEqual(item["action"], "aligned")
        self.assertTrue(item["verified"])  # ⚠️ pip 失败不阻断(C8),仍验证
        self.assertIn("pip install 失败", item["pipError"])

    def test_overall_timeout_marks_remaining_items_failed(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["pluginA", "pluginB"], timeout_s=0)
        self.assertEqual([r["action"] for r in result["items"]], ["failed", "failed"])
        self.assertIn("整体超时", result["items"][0]["error"])  # Q3 10min 口径
        # 超时后零改动类 SSH 命令(仅同步前的 Win 目录盘点)
        self.assertFalse(any("reset --hard" in c or "git clone" in c or "pip install" in c for c in stub.commands))

    def test_unknown_plugin_reports_failed(self) -> None:
        stub = self._stub()
        result = _service_with_stub(stub).sync_engine(["no-such-plugin"])
        self.assertEqual(result["items"][0]["action"], "failed")
        self.assertIn("清单里没有", result["items"][0]["error"])


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
        fake.sync_engine.return_value = {"items": [{"name": "ComfyUI", "action": "aligned"}]}
        with patch("image_gen.server._ssh_service", return_value=fake):
            body, status = self._comfy("POST", "/comfy/ssh/sync-engine", {"items": ["ComfyUI"]})
        self.assertEqual(status, HTTPStatus.OK)
        fake.sync_engine.assert_called_once_with(["ComfyUI"])
        self.assertEqual(body["items"][0]["action"], "aligned")

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
