"""09-08 流G 四项加固单测(对应 implement.md「后续加固记账」①②③):

- stop 彻底性:SIGTERM 装死 → 升级 SIGKILL;stopped 以进程真实退出为准;
- 孤儿收编:门槛=端口应答 /system_stats 且形状像 ComfyUI,收养后刷新节点数;
- 回滚原子化:毒 tar/坏 gzip/转正失败都不留半还原树,旧树挪回原位、tmp 保留;
- 快照创建端:绝对路径符号链接拒收(跳过并记 warning 进 meta);
- workflows nodeCount:API 格式按顶层键数扣 _meta,UI 格式仍按 nodes.length。

全部走临时 MYSTUDIO_COMFYUI_HOME,零网络零真实子进程。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tarfile

import pytest

from engines.comfyui import manifest as cm
from engines.comfyui import engine_manager as em
from engines.comfyui.engine_manager import EngineManager, EngineOpError
from engines.comfyui.plugin_manager import workflow_node_count
from urllib import error as url_error


def _use_tmp_home(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    return home


def _plant_installed_engine(tmp_path, monkeypatch):
    """已装引擎的家:账本带版本+端口,源码目录一棵小树;返回 home 路径。"""
    home = _use_tmp_home(tmp_path, monkeypatch)
    cm.mutate_manifest(lambda m: m.update({"engine": {"version": "v0.9.2", "port": 17600}}))
    src = cm.engine_source_dir()
    src.mkdir(parents=True, exist_ok=True)
    (src / "main.py").write_text("print('engine')\n", encoding="utf-8")
    return home


def _stub_runtime(monkeypatch, manager: EngineManager) -> None:
    """回滚链路里与文件换树无关的重活全部打桩(stop/pip/restart/健康)。"""
    monkeypatch.setattr(manager, "stop", lambda: {"running": False, "stopped": True})
    monkeypatch.setattr(manager, "restart", lambda progress=None: {"running": True})
    monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: True)
    monkeypatch.setattr(em, "_pip", lambda argv, **kwargs: "")


# ── 加固①:stop 彻底性 ─────────────────────────────────────────────

class _FakeProc:
    """stop() 单测替身:可控的 SIGTERM/SIGKILL 行为(不真开子进程)。"""

    def __init__(self, *, die_on_terminate: bool = False, die_on_kill: bool = True) -> None:
        self._alive = True
        self.die_on_terminate = die_on_terminate
        self.die_on_kill = die_on_kill
        self.terminate_calls = 0
        self.kill_calls = 0

    def poll(self):
        return None if self._alive else 0

    def terminate(self) -> None:
        self.terminate_calls += 1
        if self.die_on_terminate:
            self._alive = False

    def kill(self) -> None:
        self.kill_calls += 1
        if self.die_on_kill:
            self._alive = False

    def wait(self, timeout=None):
        if self._alive:
            raise subprocess.TimeoutExpired(cmd="fake-comfy", timeout=timeout)
        return 0


class TestStopThoroughness:
    def test_terminate_ignored_escalates_to_sigkill(self, tmp_path, monkeypatch):
        manager = EngineManager()
        proc = _FakeProc(die_on_terminate=False, die_on_kill=True)  # SIGTERM 装死
        manager._proc = proc
        monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: False)
        result = manager.stop()
        assert proc.terminate_calls == 1
        assert proc.kill_calls == 1  # wait 超时后升级 SIGKILL
        assert result["stopped"] is True  # 进程真实退出
        assert result["running"] is False
        assert manager._proc is None

    def test_honest_stopped_false_when_unkillable(self, tmp_path, monkeypatch):
        manager = EngineManager()
        proc = _FakeProc(die_on_kill=False)  # 连 SIGKILL 都收不回(极端场景)
        manager._proc = proc
        monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: False)
        result = manager.stop()  # 不抛异常,如实上报
        assert proc.kill_calls == 1
        assert result["stopped"] is False

    def test_clean_terminate_never_escalates(self, tmp_path, monkeypatch):
        manager = EngineManager()
        proc = _FakeProc(die_on_terminate=True)
        manager._proc = proc
        monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: False)
        result = manager.stop()
        assert proc.kill_calls == 0
        assert result["stopped"] is True


# ── 加固①:孤儿收编门槛 + 收养刷新节点数 ────────────────────────────

class TestOrphanAdoption:
    def test_adoption_forces_node_count_refresh(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        manager._proc = None
        manager._last_node_count = 910  # 旧缓存(卸载前的节点数)
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_enable_guard", lambda: None)
        refresh_calls: list[int] = []

        def fake_node_count():
            refresh_calls.append(1)
            manager._last_node_count = 934
            return 934

        monkeypatch.setattr(manager, "node_count", fake_node_count)
        result = manager.start_sync()
        assert result["adopted"] is True
        assert result["running"] is True
        assert refresh_calls == [1]  # 收养后强制刷新一次 object_info
        assert manager._last_node_count == 934

    def test_adoption_gate_rejects_unverified_port(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        manager._proc = None
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: False)
        # 端口不可绑定 → 重探测换端口;但源码目录没有可启动入口 → 走到 spawn 前置检查报错
        monkeypatch.setattr(em, "_port_bindable", lambda port: False)
        monkeypatch.setattr(em, "find_free_port", lambda: 17005)
        (cm.engine_source_dir() / "main.py").unlink()
        with pytest.raises(EngineOpError) as ctx:
            manager.start_sync()
        assert "源码目录不完整" in str(ctx.value)  # 没有误收编,而是走正常启动路径

    def test_gate_requires_comfyui_shaped_system_stats(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(em, "_get_json", lambda url, timeout=5.0: {"system": {"os": "mac"}, "devices": []})
        assert manager._orphan_is_comfyui(17600) is True
        monkeypatch.setattr(em, "_get_json", lambda url, timeout=5.0: {"hello": "world"})
        assert manager._orphan_is_comfyui(17600) is False  # JSON 应答≠ComfyUI

    def test_gate_survives_port_refused(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()

        def _refused(url, timeout=5.0):
            raise url_error.URLError("connection refused")

        monkeypatch.setattr(em, "_get_json", _refused)
        assert manager._orphan_is_comfyui(17600) is False


# ── 加固②:快照创建端拒收绝对路径符号链接 ───────────────────────────

class TestSnapshotSymlinkGuard:
    def test_absolute_symlink_skipped_with_warning_in_meta(self, tmp_path, monkeypatch):
        home = _plant_installed_engine(tmp_path, monkeypatch)
        src = cm.engine_source_dir()
        os.symlink("/etc/hosts", src / "evil-abs")
        os.symlink("main.py", src / "ok-rel")  # 相对软链是生态正常用法,保留
        manager = EngineManager()
        monkeypatch.setattr(manager, "venv_freeze", lambda: [])
        snap_id = manager.create_snapshot(reason="hardening", full=True)
        snap_dir = home / "snapshots" / snap_id
        meta = json.loads((snap_dir / "meta.json").read_text(encoding="utf-8"))
        assert any("evil-abs" in w for w in meta.get("warnings", []))
        with tarfile.open(snap_dir / "comfyui-src.tar.gz") as tar:
            members = {m.name: m for m in tar.getmembers()}
        assert "ComfyUI/evil-abs" not in members  # 绝对软链没进 tar
        assert members["ComfyUI/ok-rel"].issym()  # 相对软链原样保留
        assert "ComfyUI/main.py" in members

    def test_windows_style_absolute_link_also_rejected(self):
        warnings: list[str] = []
        filt = em._tar_snapshot_filter(warnings)
        info = tarfile.TarInfo("ComfyUI/win-abs")
        info.type = tarfile.SYMTYPE
        info.linkname = "C:\\Windows\\System32"
        assert filt(info) is None
        assert warnings and "win-abs" in warnings[0]


# ── 加固②:回滚原子化 ──────────────────────────────────────────────

def _make_poison_snapshot(home, snap_id: str, member_factory) -> None:
    """手工构造带危险成员/坏字节的快照目录(不走 create_snapshot 正门)。"""
    snap_dir = home / "snapshots" / snap_id
    snap_dir.mkdir(parents=True)
    (snap_dir / "manifest.json").write_text(json.dumps(cm.load_manifest()), encoding="utf-8")
    member_factory(snap_dir / "comfyui-src.tar.gz")


class TestRollbackAtomic:
    def test_success_swaps_tree_and_cleans_up(self, tmp_path, monkeypatch):
        home = _plant_installed_engine(tmp_path, monkeypatch)
        src = cm.engine_source_dir()
        (src / "current-marker.txt").write_text("snapshot-era\n", encoding="utf-8")
        manager = EngineManager()
        monkeypatch.setattr(manager, "venv_freeze", lambda: [])
        snap_id = manager.create_snapshot(reason="rollback-test", full=True)

        # 快照之后现树继续漂移
        (src / "current-marker.txt").unlink()
        (src / "drift.txt").write_text("drift\n", encoding="utf-8")

        _stub_runtime(monkeypatch, manager)
        result = manager.rollback_snapshot(snap_id)
        assert result["rolledBackTo"] == snap_id
        assert (src / "main.py").is_file()
        assert (src / "current-marker.txt").is_file()  # 回到快照时点
        assert not (src / "drift.txt").exists()
        assert not (home / ".rollback-tmp").exists()  # 临时壳清理
        assert not [p for p in home.iterdir() if p.name.startswith("ComfyUI.bak-failed-")]

    def test_poison_tar_preserves_live_tree_and_keeps_tmp(self, tmp_path, monkeypatch):
        home = _plant_installed_engine(tmp_path, monkeypatch)
        src = cm.engine_source_dir()
        (src / "live.txt").write_text("live\n", encoding="utf-8")

        def _poison(tar_path):
            with tarfile.open(tar_path, "w:gz") as tar:  # 绝对路径软链=毒快照事故原样
                info = tarfile.TarInfo("ComfyUI/evil")
                info.type = tarfile.SYMTYPE
                info.linkname = "/etc/passwd"
                tar.addfile(info)

        _make_poison_snapshot(home, "snap-poison0001-test", _poison)
        manager = EngineManager()
        _stub_runtime(monkeypatch, manager)
        with pytest.raises(EngineOpError) as ctx:
            manager.rollback_snapshot("snap-poison0001-test")
        message = str(ctx.value)
        assert "回滚失败" in message and ".rollback-tmp" in message  # 大白话 + 现场位置
        assert (src / "live.txt").is_file()  # 原树未被动过(不再留半还原树)
        assert (src / "main.py").is_file()
        assert (home / ".rollback-tmp").is_dir()  # 解包现场保留供人工救

    def test_corrupt_gzip_preserves_live_tree(self, tmp_path, monkeypatch):
        home = _plant_installed_engine(tmp_path, monkeypatch)
        src = cm.engine_source_dir()
        (src / "live.txt").write_text("live\n", encoding="utf-8")

        def _garbage(tar_path):
            tar_path.write_bytes(b"this is not a gzip stream at all")

        _make_poison_snapshot(home, "snap-corrupt0001-tes", _garbage)
        manager = EngineManager()
        _stub_runtime(monkeypatch, manager)
        with pytest.raises(EngineOpError) as ctx:
            manager.rollback_snapshot("snap-corrupt0001-tes")
        assert "回滚失败" in str(ctx.value)
        assert (src / "live.txt").is_file()
        assert (home / ".rollback-tmp").is_dir()

    def test_promote_failure_restores_backup_tree(self, tmp_path, monkeypatch):
        home = _plant_installed_engine(tmp_path, monkeypatch)
        src = cm.engine_source_dir()
        manager = EngineManager()
        monkeypatch.setattr(manager, "venv_freeze", lambda: [])
        snap_id = manager.create_snapshot(reason="rollback-test", full=True)
        (src / "drift.txt").write_text("post-snapshot\n", encoding="utf-8")

        real_move = shutil.move

        def _move_fails_on_promote(src_arg, dst_arg):
            if str(src_arg).endswith(".rollback-tmp/ComfyUI"):
                raise OSError("simulated disk full during promote")
            return real_move(src_arg, dst_arg)

        monkeypatch.setattr(em.shutil, "move", _move_fails_on_promote)
        _stub_runtime(monkeypatch, manager)
        with pytest.raises(EngineOpError) as ctx:
            manager.rollback_snapshot(snap_id)
        assert "回滚失败" in str(ctx.value)
        # 旧树(含快照后的漂移标记)被挪回原位,目录里没有 bak 残留
        assert (src / "drift.txt").is_file()
        assert (src / "main.py").is_file()
        assert not [p for p in home.iterdir() if p.name.startswith("ComfyUI.bak-failed-")]


# ── 加固③:workflows 列表 nodeCount(API/UI 两格式) ─────────────────

class TestWorkflowNodeCountFormats:
    def test_api_format_counts_top_level_keys(self):
        obj = {"3": {"class_type": "KSampler"}, "9": {"class_type": "SaveImage"}}
        assert workflow_node_count(obj) == 2

    def test_api_format_subtracts_meta_keys(self):
        obj = {
            "_meta": {"title": "Krea2 专业流"},
            "1": {"class_type": "UNETLoader"},
            "2": {"class_type": "KSampler"},
            "7": {"class_type": "SaveImage"},
        }
        assert workflow_node_count(obj) == 3  # _meta 不算节点

    def test_api_format_strange_node_values_still_counted(self):
        # 键数口径的回归点:节点值形状稍有出入(非 dict/缺 class_type)不再漏计
        obj = {"1": "junk", "2": {"class_type": "X"}}
        assert workflow_node_count(obj) == 2

    def test_ui_format_still_uses_nodes_length(self):
        obj = {"nodes": [{"type": "A"}, {"type": "B"}, {"type": "C"}], "_meta": {"extra": True}}
        assert workflow_node_count(obj) == 3  # UI 格式 _meta 不参与扣减

    def test_invalid_payload_is_zero(self):
        assert workflow_node_count(None) == 0
        assert workflow_node_count("junk") == 0


# ── 09-08 补口:按需启动 + 孤儿清理 ──
class TestEnsureEngineReady:
    def test_not_installed_returns_false(self, monkeypatch, tmp_path):
        import engines.comfyui.engine_manager as em
        mgr = em.EngineManager.__new__(em.EngineManager)
        monkeypatch.setattr(em.cm, "engine_installed", lambda: False)
        assert mgr.ensure_engine_ready() is False

    def test_healthy_short_circuits(self, monkeypatch):
        import engines.comfyui.engine_manager as em
        mgr = em.EngineManager.__new__(em.EngineManager)
        monkeypatch.setattr(em.cm, "engine_installed", lambda: True)
        mgr._proc = None  # 无进程 → 不满足快捷路径
        called = []
        monkeypatch.setattr(mgr, "start_sync", lambda: called.append(1) or {"running": True})
        assert mgr.ensure_engine_ready() is True
        assert called == [1]

    def test_installed_stopped_starts_sync(self, monkeypatch):
        import engines.comfyui.engine_manager as em
        mgr = em.EngineManager.__new__(em.EngineManager)
        monkeypatch.setattr(em.cm, "engine_installed", lambda: True)
        import types
        mgr._proc = types.SimpleNamespace(poll=lambda: 1)  # 进程已退出
        monkeypatch.setattr(mgr, "is_healthy", lambda *a, **k: False)
        called = []
        monkeypatch.setattr(mgr, "start_sync", lambda: called.append(1) or {"running": True})
        assert mgr.ensure_engine_ready() is True
        assert called == [1]


class TestCleanOrphanPlugins:
    def test_removes_only_unregistered_dirs(self, monkeypatch, tmp_path):
        import engines.comfyui.plugin_manager as pm
        cn = tmp_path / "custom_nodes"
        (cn / "registered-plugin").mkdir(parents=True)
        (cn / "_orphan_manual").mkdir(parents=True)
        (cn / ".hidden").mkdir(parents=True)
        (cn / "notes.txt").write_text("not a dir")
        monkeypatch.setattr(pm.cm, "custom_nodes_dir", lambda: cn)
        monkeypatch.setattr(pm.cm, "load_manifest", lambda: {"engine": {}, "plugins": {"registered-plugin": {"deps": {}}}})
        fake_engine = types_simple_ns = type("E", (), {"is_healthy": staticmethod(lambda: False)})()
        monkeypatch.setattr(pm, "engine_manager", lambda: fake_engine)
        result = pm.clean_orphan_plugins()
        assert result["removed"] == ["_orphan_manual"]
        assert (cn / "registered-plugin").is_dir()
        assert not (cn / "_orphan_manual").exists()
        assert "没有需要清理" not in result["message"]
