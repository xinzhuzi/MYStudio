"""设置页「ComfyUI 引擎地址」全链测试(10-29 D1 终裁:URL 配一条,任务发远端引擎+产物回流)。

覆盖三层:
1. bridge_url() 发现优先级(settings remote-engine.json > env > manifest port > 17598);
2. EngineManager.remote_engine_status / set_remote_engine(读写/清除/非法 URL 拒);
3. execute._history_collect 的 videos 产物解析(远端模式产物回流的前置;
   SaveVideo/VHS_VideoCombine 类 ui["videos"] 与 images 同形状)。

10-29 T10 增补:
4. set_remote_engine 写后清 comfyui_bridge object_info 缓存(G9:切换后首个
   object_info 调用重新拉取,不按旧引擎节点清单误报/漏报缺插件);
5. JobRegistry 惰性淘汰(G16:终态 job 30 分钟后 get 过期即清)。

不启动引擎不联网:全部纯函数/临时目录级。
"""
from __future__ import annotations

import json
import pathlib
import sys
import threading
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from comfyui import engine_manager as em  # noqa: E402
from comfyui.execute import _history_collect  # noqa: E402
from engines.image_engine import comfyui_bridge  # noqa: E402


@pytest.fixture()
def tmp_home(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    monkeypatch.delenv("MYSTUDIO_COMFYUI_BRIDGE_URL", raising=False)
    return home


def _write_remote(home: pathlib.Path, url: str) -> None:
    (home / "remote-engine.json").write_text(json.dumps({"url": url}), encoding="utf-8")


# ── 1. bridge_url 优先级 ──────────────────────────────────────────

def test_bridge_url_settings_file_wins_over_env_and_manifest(tmp_home, monkeypatch):
    _write_remote(tmp_home, "http://192.168.0.101:17000/")
    monkeypatch.setenv("MYSTUDIO_COMFYUI_BRIDGE_URL", "http://127.0.0.1:9999")
    monkeypatch.setattr(comfyui_bridge, "__recorded_port__", None, raising=False)
    import comfyui.manifest as cm
    monkeypatch.setattr(cm, "recorded_port", lambda: 17001)
    assert comfyui_bridge.bridge_url() == "http://192.168.0.101:17000"


def test_bridge_url_env_when_no_settings_file(tmp_home, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_BRIDGE_URL", "http://127.0.0.1:9999")
    assert comfyui_bridge.bridge_url() == "http://127.0.0.1:9999"


def test_bridge_url_local_fallback_without_settings_or_env(tmp_home, monkeypatch):
    import comfyui.manifest as cm
    monkeypatch.setattr(cm, "recorded_port", lambda: 17001)
    assert comfyui_bridge.bridge_url() == "http://127.0.0.1:17001"
    monkeypatch.setattr(cm, "recorded_port", lambda: None)
    assert comfyui_bridge.bridge_url() == "http://127.0.0.1:17598"


def test_remote_settings_file_tolerates_garbage(tmp_home):
    (tmp_home / "remote-engine.json").write_text("not json", encoding="utf-8")
    assert comfyui_bridge.remote_engine_url_from_settings() is None
    _write_remote(tmp_home, "")
    assert comfyui_bridge.remote_engine_url_from_settings() is None


# ── 1b. remote-engine.json 损坏告警(10-29 T15/G10:静默回本地 + sidecar 日志一行) ──

def test_remote_settings_corrupt_json_warns_once_and_falls_back(tmp_home, capsys):
    (tmp_home / "remote-engine.json").write_text("{not json", encoding="utf-8")
    assert comfyui_bridge.remote_engine_url_from_settings() is None
    out = capsys.readouterr().out
    assert "remote-engine.json 损坏" in out
    assert "回本地发现" in out


def test_remote_settings_non_dict_shape_warns_and_falls_back(tmp_home, capsys):
    # 顶层数组=形态损坏:旧实现 data.get 直接 AttributeError 炸调用链,此处钉死回 None
    (tmp_home / "remote-engine.json").write_text('["http://192.168.0.101:17000"]', encoding="utf-8")
    assert comfyui_bridge.remote_engine_url_from_settings() is None
    assert "remote-engine.json 损坏" in capsys.readouterr().out


def test_remote_settings_missing_file_stays_silent(tmp_home, capsys):
    # 缺文件=未配置常态:不许有告警噪音
    assert comfyui_bridge.remote_engine_url_from_settings() is None
    assert capsys.readouterr().out == ""


# ── 2. 设置读写(status / set) ─────────────────────────────────────

def _bare_manager() -> em.EngineManager:
    mgr = em.EngineManager.__new__(em.EngineManager)
    mgr._lock = threading.Lock()
    mgr._proc = None
    return mgr


def test_set_and_clear_remote_engine(tmp_home):
    mgr = _bare_manager()
    out = mgr.set_remote_engine({"url": "http://192.168.0.101:17000/"})
    assert out == {"url": "http://192.168.0.101:17000", "cleared": False}
    status = mgr.remote_engine_status()
    assert status["url"] == "http://192.168.0.101:17000"
    assert status["effective"] == "http://192.168.0.101:17000"
    assert status["source"] == "settings"
    cleared = mgr.set_remote_engine({"url": ""})
    assert cleared == {"url": None, "cleared": True}
    assert mgr.remote_engine_status()["source"] != "settings"


def test_set_remote_engine_rejects_malformed_urls(tmp_home):
    mgr = _bare_manager()
    for bad in ("192.168.0.101:17000", "ftp://x", "http://", 123, None):
        with pytest.raises(em.EngineOpError):
            mgr.set_remote_engine({"url": bad})


# ── 2b. set 后 object_info 缓存失效(10-29 T10①/G9) ────────────────

@pytest.fixture()
def clean_object_info_cache():
    comfyui_bridge._object_info_cache = None
    yield
    comfyui_bridge._object_info_cache = None


def test_set_remote_engine_invalidates_object_info_cache(
    tmp_home, clean_object_info_cache, monkeypatch
):
    """切换引擎后首个 object_info 调用重新拉取:预填 TTL 新鲜的旧引擎缓存,
    set 写入后缓存必须已清,下一次 _available_node_classes() 打新 base 走 HTTP
    (不清则整 60s TTL 内仍按旧引擎清单判缺插件)。"""
    # 模拟 sidecar 进程刚按旧引擎拉过清单(TTL 窗内,若不失效必被命中)
    comfyui_bridge._object_info_cache = (time.monotonic(), frozenset({"OldEngineNode"}))
    mgr = _bare_manager()
    mgr.set_remote_engine({"url": "http://192.168.0.101:17000"})
    assert comfyui_bridge._object_info_cache is None  # 已失效

    fetched: list[str] = []

    def fake_http_json(method, url, payload=None, timeout=2):
        fetched.append(url)
        return {"NewEngineNode": {}}

    monkeypatch.setattr(comfyui_bridge, "_http_json", fake_http_json)
    names = comfyui_bridge._available_node_classes()
    # 重新拉取(而非吃旧清单),且打的是新 base
    assert fetched == ["http://192.168.0.101:17000/object_info"]
    assert "NewEngineNode" in names
    assert "OldEngineNode" not in names


def test_clear_remote_engine_also_invalidates_cache(tmp_home, clean_object_info_cache):
    """清除回本地=同样换引擎,缓存一并失效(写/清两路都清,不留半面)。"""
    comfyui_bridge._object_info_cache = (time.monotonic(), frozenset({"OldEngineNode"}))
    mgr = _bare_manager()
    mgr.set_remote_engine({"url": ""})  # 清除路径
    assert comfyui_bridge._object_info_cache is None


def test_invalidate_object_info_is_public_api():
    """公开失效口存在且可调(引擎管理器侧不直捅 _object_info_cache 私变量)。"""
    comfyui_bridge._object_info_cache = (time.monotonic(), frozenset({"X"}))
    comfyui_bridge.invalidate_object_info()
    assert comfyui_bridge._object_info_cache is None


# ── 5. JobRegistry 惰性淘汰(10-29 T10③/G16) ───────────────────────

def test_job_registry_evicts_expired_terminal_jobs_on_get():
    registry = em.JobRegistry()
    job_id = registry.create("comfy-execute")
    registry.update(job_id, result={"images": [{"b64": "x"}]})
    assert registry.get(job_id)["status"] == "complete"  # 窗内正常取回
    # 注入过期:终态 updatedAt 回拨到保留窗之外
    with registry._lock:
        registry._jobs[job_id]["updatedAt"] -= (em.JOB_RETENTION_S + 1) * 1000
    assert registry.get(job_id) is None  # 过期即清,get 返回 None
    with registry._lock:
        assert job_id not in registry._jobs  # 且已从 registry 摘除(内存真释放)


def test_job_registry_keeps_fresh_terminal_and_running_jobs():
    registry = em.JobRegistry()
    fresh = registry.create("comfy-execute")
    registry.update(fresh, result={"ok": True})
    assert registry.get(fresh) is not None  # 刚终态:保留

    running = registry.create("comfy-execute")
    with registry._lock:  # running 态即便超窗也不淘汰(等它终态再计时)
        registry._jobs[running]["updatedAt"] -= (em.JOB_RETENTION_S + 999) * 1000
    assert registry.get(running) is not None
    assert registry.get(running)["status"] == "running"


def test_job_registry_error_state_jobs_also_evicted_after_window():
    registry = em.JobRegistry()
    job_id = registry.create("comfy-execute")
    registry.update(job_id, error="boom")
    with registry._lock:
        registry._jobs[job_id]["updatedAt"] -= (em.JOB_RETENTION_S + 1) * 1000
    assert registry.get(job_id) is None  # error 终态同样淘汰


def test_job_registry_retention_window_is_30_minutes():
    assert em.JOB_RETENTION_S == 30 * 60  # 任务卡口径钉死(改窗须改卡)


# ── 3. _history_collect videos 解析(产物回流前置) ─────────────────

def _video_history() -> dict:
    return {"pid-1": {
        "status": {"status_str": "success"},
        "outputs": {
            "19": {"videos": [{"filename": "shot-2x.mp4", "subfolder": "video/win", "type": "output"}]},
            "4": {"images": [{"filename": "a.png", "subfolder": "", "type": "output"}]},
        },
    }}


def test_history_collect_returns_videos_alongside_images():
    state, images, audios, texts, videos = _history_collect(_video_history(), "pid-1")
    assert state == "success"
    assert images and images[0]["filename"] == "a.png"
    assert videos == [{"nodeId": "19", "filename": "shot-2x.mp4", "subfolder": "video/win", "type": "output"}]
    assert audios == [] and texts == []


def test_history_collect_core_savevideo_mp4_in_images_key_routes_to_videos():
    # 10-29 D1 实弹勘正:核心 SaveVideo 的 history 键=images 且 metadata.kind=video
    # (T4 实弹:mp4 曾被当图回流);分流规则=kind==video 或视频后缀。
    history = {"p": {"status": {"status_str": "success"}, "outputs": {
        "4": {"images": [{
            "filename": "t4-remote_00001_.mp4",
            "subfolder": "video\\漫影\\chapter-001\\S01",
            "type": "output",
            "metadata": {"kind": "video", "width": 608, "height": 352, "duration": 5.17, "fps": 24.0},
        }]},
    }}}
    state, images, audios, texts, videos = _history_collect(history, "p")
    assert state == "success"
    assert images == []
    assert videos == [{"nodeId": "4", "filename": "t4-remote_00001_.mp4",
                       "subfolder": "video\\漫影\\chapter-001\\S01", "type": "output"}]


def test_history_collect_pending_and_error_shapes_unchanged():
    assert _history_collect({}, "missing") == ("pending", [], [], [], [])
    bad = {"p": {"status": {"status_str": "error"}, "messages": "boom"}}
    with pytest.raises(Exception, match="ComfyUI 执行失败"):
        _history_collect(bad, "p")


# ── 6. generate() 引擎前置门(10-29 D1 收账·H3 盲投修复) ──────────
# 最终 base 非本机=远端模式:ensure_engine_ready 零调用,改远端可达探测
# (GET {base}/system_stats 经 comfyui_bridge._http_json 可 mock 层);探测
# 2xx=可达放行,异常/非 2xx→fail-fast『远端引擎不可达: {base}』。全程 mock,
# 零真实网络(评审:探测之外还须罩住 :423-425 的 resolve_big_files)。

def _spy_engine_manager(monkeypatch):
    ensure_calls: list[str] = []

    class _SpyManager:
        def ensure_engine_ready(self):
            ensure_calls.append("ensure")
            raise AssertionError("远端模式不得拉本地引擎")

    monkeypatch.setattr(em, "engine_manager", lambda: _SpyManager())
    return ensure_calls


def test_generate_remote_settings_skips_local_launch_and_probes(tmp_home, monkeypatch):
    """settings 指远端:ensure 零调用;探测 GET {远端}/system_stats 恰一次;
    放行后走 resolve_big_files(mock 返回 None→既有『没在运行』收口,证明
    已越过门且未再触网)。"""
    _write_remote(tmp_home, "http://192.168.0.101:17000")
    ensure_calls = _spy_engine_manager(monkeypatch)
    probes: list[tuple[str, str]] = []

    def fake_http_json(method, url, payload=None, timeout=2):
        probes.append((method, url))
        return {"comfyui_version": "remote-fake"}

    monkeypatch.setattr(comfyui_bridge, "_http_json", fake_http_json)
    monkeypatch.setattr(comfyui_bridge, "resolve_big_files", lambda *args, **kwargs: None)

    from image_gen.pipeline import PipelineError

    with pytest.raises(PipelineError, match="没在运行"):
        comfyui_bridge.generate("一只猫", "1:1", None, 8, None)
    assert ensure_calls == []
    assert probes == [("GET", "http://192.168.0.101:17000/system_stats")]


def test_generate_remote_settings_unreachable_fail_fast(tmp_home, monkeypatch):
    """探测异常(连接拒绝/超时/非 2xx 同经 _http_json 上抛)→fail-fast
    『远端引擎不可达: {base}』,不落回拉本地引擎。"""
    _write_remote(tmp_home, "http://192.168.0.101:17000")
    ensure_calls = _spy_engine_manager(monkeypatch)
    probes: list[tuple[str, str]] = []

    def refused_http_json(method, url, payload=None, timeout=2):
        probes.append((method, url))
        raise comfyui_bridge._pipeline_error("bridge-unreachable", f"ComfyUI 引擎不可达({url})")

    monkeypatch.setattr(comfyui_bridge, "_http_json", refused_http_json)

    from image_gen.pipeline import PipelineError

    with pytest.raises(PipelineError, match="远端引擎不可达: http://192.168.0.101:17000"):
        comfyui_bridge.generate("一只猫", "1:1", None, 8, None)
    assert ensure_calls == []
    assert probes == [("GET", "http://192.168.0.101:17000/system_stats")]
