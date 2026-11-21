"""1122 用户裁定截 3:引擎跟随最新 release(钉定版语义整体退役)。

矩阵(update_check):
  ① 本地在最新 release tag 上(local sha==latest tag sha)→ 恒绿;
  ② 本地在旧 tag(0.45.2)而最新=0.46.2 → 红(可更新;用户实录症);
  ③ master 大步领先但 release 无新 → 仍绿(release 轨道不比 master);
  ④ annotated tag → 取 peeled ^{} 行的 commit sha(误用 tag 对象=永久假红);
  ⑤ 断网/无 latest tag 行 → 静默绿不误报;
  ⑥ 账本 version 为 master 展示标签(vX.Y---gsha)→ 比对口径剥 ---尾段;
  ⑦ update_job:已是最新拒发;落后/漂移 → 目标恒=最新 release tag(禁 master sha)。

零网络:em._git 只按 ls-remote 桩应答;本地 sha 走账本回落(engine_source_dir
不存在 → _local_engine_sha 回 engine.sha),不触 rev-parse。
"""

from __future__ import annotations

from pathlib import Path

import pytest

import remote_ssh.service as svc
from comfyui import engine_manager as em

MASTER = "1" * 40          # master HEAD(release 轨道不比它)
TAG_OBJ = "2" * 40         # annotated tag 对象 sha(禁用:≠commit)
LATEST_SHA = "3" * 40      # 最新 release tag 的 commit sha(正身)
DRIFT = "4" * 40           # 本地漂移/旧版 sha
OLD = "5" * 40             # 旧 release tag commit

LS_ANNOTATED = [
    f"{MASTER}\trefs/heads/master",
    f"{TAG_OBJ}\trefs/tags/0.46.2",
    f"{LATEST_SHA}\trefs/tags/0.46.2^{{}}",   # peeled commit sha
    f"{OLD}\trefs/tags/0.45.2",
]
LS_LIGHTWEIGHT = [
    f"{MASTER}\trefs/heads/master",
    f"{LATEST_SHA}\trefs/tags/0.46.2",        # 无 ^{} 行:本行即 commit sha
    f"{OLD}\trefs/tags/0.45.2",
]
LS_OFFLINE = [                               # 断网:只剩 master,无任何 tag 行
    f"{MASTER}\trefs/heads/master",
]


def _manifest(sha: str, version: str = "0.46.2", pinned: bool = True) -> dict:
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
        monkeypatch.setattr(em.cm, "engine_source_dir", lambda: Path("/nonexistent-pin-verdict"))


class TestUpdateCheckFollowLatest:
    def test_on_latest_tag_green(self, monkeypatch):
        fx = _Fixture(monkeypatch, _manifest(LATEST_SHA), LS_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] == LATEST_SHA and out["updateAvailable"] is False

    def test_old_tag_red_update_available(self, monkeypatch):
        # 用户实录症:本地 0.45.2(tag sha=OLD)、最新 0.46.2 → 必须报可更新
        fx = _Fixture(monkeypatch, _manifest(OLD, version="0.45.2"), LS_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] == LATEST_SHA and out["updateAvailable"] is True

    def test_master_far_ahead_release_same_still_green(self, monkeypatch):
        # master 领先无数:release 轨道只看 tag,不比 master(假警报根除保留)
        fx = _Fixture(monkeypatch, _manifest(LATEST_SHA), LS_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is False

    def test_annotated_tag_uses_peeled_sha(self, monkeypatch):
        # pinnedSha 必须取 ^{} 行(LATEST_SHA)而非 tag 对象(TAG_OBJ)
        fx = _Fixture(monkeypatch, _manifest(DRIFT), LS_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] == LATEST_SHA

    def test_lightweight_tag_sha(self, monkeypatch):
        fx = _Fixture(monkeypatch, _manifest(DRIFT), LS_LIGHTWEIGHT)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] == LATEST_SHA

    def test_offline_silent_green(self, monkeypatch):
        # 断网/latest tag 行缺失:取不到基线 → 静默绿不误报
        fx = _Fixture(monkeypatch, _manifest(DRIFT), LS_OFFLINE)
        out = fx.mgr.update_check()
        assert out["pinnedSha"] is None and out["updateAvailable"] is False

    def test_master_display_label_version_stripped(self, monkeypatch):
        # 账本 version=vX.Y---gsha(master 展示标签):比对口径剥 ---尾段不误红
        fx = _Fixture(monkeypatch, _manifest(LATEST_SHA, version="0.46.2---g102350e"), LS_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is False

    def test_pinned_field_no_longer_gates(self, monkeypatch):
        # pinned=True 不再改变判据:本地落后照样红(截 3 核心断言)
        fx = _Fixture(monkeypatch, _manifest(OLD, version="0.45.2", pinned=True), LS_ANNOTATED)
        out = fx.mgr.update_check()
        assert out["updateAvailable"] is True


class TestUpdateJobFollowLatest:
    """⑦ update_job:已是最新拒发;落后/漂移 → 目标恒=最新 release tag(禁 master)。"""

    def _armed(self, monkeypatch, manifest: dict):
        mgr = em.EngineManager()
        mgr._last_check = {
            "current": manifest["engine"]["version"],
            "latest": "0.46.2",
            "headSha": MASTER, "pinnedSha": LATEST_SHA, "aheadBy": None,
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

    def test_on_latest_refuses_update(self, monkeypatch):
        mgr, captured = self._armed(monkeypatch, _manifest(LATEST_SHA))
        with pytest.raises(em.EngineOpError, match="已是最新"):
            mgr.update_job()
        assert captured == []

    def test_behind_targets_latest_tag_not_master(self, monkeypatch):
        # 本地 0.45.2 落后:目标=最新 release tag(0.46.2);禁 master sha
        mgr, captured = self._armed(monkeypatch, _manifest(OLD, version="0.45.2"))
        mgr.update_job()
        assert captured == ["0.46.2"]
        assert MASTER not in captured
