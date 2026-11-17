"""1117 钉版判据单测(tasks/11-17-engine-sync-pin-verdict)。

矩阵:
  ① 钉版正常(本地 sha==钉定 tag 上游 commit sha)→ updateAvailable=False 恒绿;
  ② 钉版 master 大步领先 → 仍绿(0.45.2 对 master 永久 diverging 假警报根除);
  ③ 钉版漂移(本地 sha≠钉定 sha)→ 红(阳性对照:真分叉=引擎家 git 恒 0 改动被破);
  ④ annotated tag → 取 peeled ^{} 行的 commit sha(误用 tag 对象 sha=永久假红);
  ⑤ 断网/无钉定 tag 行 → 静默绿不误报;
  ⑥ 非钉版口径回归:master 差→红、master 同→绿;
  ⑦ update_job 钉版:正常=「已是最新」拒发;漂移=目标恒=钉定 tag(回钉,禁拉 master)。

零网络:em._git 只按 ls-remote 桩应答;本地 sha 走账本回落(engine_source_dir
不存在 → _local_engine_sha 回 engine.sha),不触 rev-parse。
"""

from __future__ import annotations

from pathlib import Path

import pytest

import remote_ssh.service as svc
from comfyui import engine_manager as em

# 40 位 hex sha 桩(_SHA_RE 同构;仅目标判字符串等值,内容无语义)
MASTER = "1" * 40          # master HEAD(钉版对它永久分叉=假警报源)
PIN_TAG_OBJ = "2" * 40     # annotated tag 对象 sha(禁用:≠commit)
PIN = "3" * 40             # 钉定 tag 的 commit sha(正身)
DRIFT = "4" * 40           # 本地漂移 sha
OLD = "5" * 40             # 旧 release tag commit

LS_REMOTE_ANNOTATED = [
    f"{MASTER}\trefs/heads/master",
    f"{PIN_TAG_OBJ}\trefs/tags/0.45.2",
    f"{PIN}\trefs/tags/0.45.2^{{}}",   # peeled commit sha
    f"{OLD}\trefs/tags/0.44.2",
]
LS_REMOTE_LIGHTWEIGHT = [
    f"{MASTER}\trefs/heads/master",
    f"{PIN}\trefs/tags/0.45.2",        # 无 ^{} 行:本行即 commit sha
    f"{OLD}\trefs/tags/0.44.2",
]
LS_REMOTE_NO_PIN_TAG = [                # 断网/tag 消失:取不到钉定 sha
    f"{MASTER}\trefs/heads/master",
    f"{OLD}\trefs/tags/0.44.2",
]


def _pin_manifest(pinned: bool, sha: str, version: str = "0.45.2") -> dict:
    return {"engine": {"version": version, "sha": sha, "pinned": pinned}}


class _Fixture:
    """update_check 全链桩:_git 只喂 ls-remote;manifest/账本走字典。"""

    def __init__(self, monkeypatch, manifest: dict, ls_remote_lines: list[str]) -> None:
        self.mgr = em.EngineManager()
        monkeypatch.setattr(
            em, "_git",
            lambda args, **kw: "\n".join(ls_remote_lines) if args[:1] == ["ls-remote"] else "",
            raising=True,
        )
        monkeypatch.setattr(em.cm, "load_manifest", lambda: manifest)
        monkeypatch.setattr(em.cm, "mutate_manifest", lambda fn: None)
        monkeypatch.setattr(em.cm, "timestamp_ms", lambda: 1)
        # 源码目录不存在 → _local_engine_sha 回落账本 sha(不触 rev-parse)
        monkeypatch.setattr(em.cm, "engine_source_dir", lambda: Path("/nonexistent-pin-verdict"))


class TestUpdateCheckPin:
    def test_pinned_normal_green(self, monkeypatch):
        fx = _Fixture(monkeypatch, _pin_manifest(True, PIN), LS_REMOTE_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is False
        assert out["pinnedSha"] == PIN

    def test_pinned_master_far_ahead_still_green(self, monkeypatch):
        # 假警报根除:master 与本地差一整个 sha,钉版口径不看 master
        fx = _Fixture(monkeypatch, _pin_manifest(True, PIN), LS_REMOTE_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is False and out["headSha"] == MASTER

    def test_pinned_drift_red_positive_control(self, monkeypatch):
        # 阳性对照:本地漂移(≠钉定 commit sha)→ 真分叉红
        fx = _Fixture(monkeypatch, _pin_manifest(True, DRIFT), LS_REMOTE_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is True

    def test_pinned_annotated_tag_uses_peeled_sha(self, monkeypatch):
        # annotated tag:基线必须=peeled ^{} 的 commit sha(PIN),误用 tag 对象
        # sha(PIN_TAG_OBJ)会对正身本地恒红
        fx = _Fixture(monkeypatch, _pin_manifest(True, PIN), LS_REMOTE_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] == PIN and out["pinnedSha"] != PIN_TAG_OBJ
        assert out["updateAvailable"] is False

    def test_pinned_lightweight_tag_sha(self, monkeypatch):
        fx = _Fixture(monkeypatch, _pin_manifest(True, PIN), LS_REMOTE_LIGHTWEIGHT)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] == PIN and out["updateAvailable"] is False

    def test_pinned_offline_silent_green(self, monkeypatch):
        # 断网/钉定 tag 行缺失:取不到基线 → 静默绿不误报
        fx = _Fixture(monkeypatch, _pin_manifest(True, DRIFT), LS_REMOTE_NO_PIN_TAG)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] is None and out["updateAvailable"] is False

    def test_unpinned_master_diff_red_regression(self, monkeypatch):
        # 非钉版口径回归:master 差 → 红(既有语义不动)
        fx = _Fixture(monkeypatch, _pin_manifest(False, DRIFT), LS_REMOTE_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is True

    def test_unpinned_master_same_green_regression(self, monkeypatch):
        fx = _Fixture(monkeypatch, _pin_manifest(False, MASTER), LS_REMOTE_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is False


class TestUpdateJobPinTarget:
    """⑦ update_job 钉版目标=钉定 tag(回钉),正常态拒发,禁拉 master。"""

    def _armed(self, monkeypatch, manifest: dict):
        mgr = em.EngineManager()
        # 预置 last_check(含 pinnedSha;headSha=master 用于验证「没被拿去当目标」)
        mgr._last_check = {
            "current": "0.45.2", "latest": "0.44.2",
            "headSha": MASTER, "pinnedSha": PIN, "aheadBy": None,
        }
        monkeypatch.setattr(em.cm, "load_manifest", lambda: manifest)
        monkeypatch.setattr(em.cm, "engine_installed", lambda: True)
        monkeypatch.setattr(em.cm, "engine_source_dir", lambda: Path("/nonexistent-pin-verdict"))
        monkeypatch.setattr(svc, "_torch_any_marker", lambda: False)
        monkeypatch.setattr(svc, "_ensure_stuck_marker_writable", lambda: None)
        monkeypatch.setattr(em.jobs, "active_of", lambda kind: None)
        monkeypatch.setattr(em.jobs, "create", lambda kind, message: "jid")
        captured: list[str] = []
        monkeypatch.setattr(mgr, "_update_job", lambda jid, target: captured.append(target))
        monkeypatch.setattr(em.jobs, "start", lambda jid, fn: fn(jid))
        return mgr, captured

    def test_pinned_normal_refuses_update(self, monkeypatch):
        mgr, captured = self._armed(monkeypatch, _pin_manifest(True, PIN))
        with pytest.raises(em.EngineOpError, match="已是最新"):
            mgr.update_job()
        assert captured == []

    def test_pinned_drift_targets_pinned_tag_not_master(self, monkeypatch):
        # 漂移修复=回钉 0.45.2;目标禁=master sha(破钉)
        mgr, captured = self._armed(monkeypatch, _pin_manifest(True, DRIFT))
        mgr.update_job()
        assert captured == ["0.45.2"]
        assert MASTER not in captured
