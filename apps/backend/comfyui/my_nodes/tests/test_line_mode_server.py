# 产线显存档位自动切换(line_mode_server)单测(2026-11-01,1101 自动化改版;
# 评审修回:限频/自愈/复查路径改测真实语义,不再用抛桩冒充真实行为)。
# 加载纪律:importlib.util.spec_from_file_location 直载模块文件(不 import
# my_nodes 包,test_my_qi21_api_pe.py:4-10 同款禁令);全部用例跑在测试进程
# 内同步驱动 _Switcher._run_sequence(不起 daemon 线程),MODE/action/result
# 全部重定向 tmp_path,零触碰真实 Windows 路径与网络。
#
# 覆盖边界如实声明(评审#8③):本文件证的是切换器单模块语义——「切换不伤
# 在途渲染」的端到端(触发提交自身渲染与 /free 并发、装载窗口对向提交竞态、
# 看门狗 tick 与切换器实机并发)单测层不可证,归属实弹 G4/G5 验收域。
from __future__ import annotations

import importlib.util
import json
import re
import sys
import threading
import time
import types
from pathlib import Path

import pytest

_NODE = Path(__file__).resolve().parents[1] / "line_mode_server.py"
_spec = importlib.util.spec_from_file_location("line_mode_server_uut", _NODE)
lm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lm)

_APPS = Path(__file__).resolve().parents[4]
_IMAGE_STUDIO = _APPS / "frontend" / "lib" / "assist" / "image-studio"
_QWEN21_T2I_API = (_APPS / "backend" / "comfyui" / "workflows" / "1_图片" /
                   "QwenImage2.1" / "1_文生图" / "qwen21-道劫-t2i-api.json")
_YUE2_OFFICIAL = (_APPS / "backend" / "comfyui" / "workflows" / "3_声音" /
                  "Yue2" / "yue2-整曲-官方版.json")


# ── fixture 与小工具 ──────────────────────────────────────────────────────────
@pytest.fixture()
def mode_env(tmp_path, monkeypatch):
    """MODE/action/result/急停标记全部重定向 tmp;清模块级缓存态。"""
    mode = tmp_path / "win-line-mode.json"
    action = tmp_path / "line-mode-action.json"
    result = tmp_path / "line-mode-result.json"
    disabled = tmp_path / "win-line-mode.disabled"
    monkeypatch.setattr(lm, "MODE_PATH", str(mode))
    monkeypatch.setattr(lm, "ACTION_PATH", str(action))
    monkeypatch.setattr(lm, "RESULT_PATH", str(result))
    monkeypatch.setattr(lm, "DISABLED_FLAG", str(disabled))
    monkeypatch.setattr(lm, "_engine_base_cache", "http://127.0.0.1:17000")
    with lm._kind_map_lock:
        lm._kind_map.clear()
    return types.SimpleNamespace(mode=mode, action=action, result=result,
                                 disabled=disabled)


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _video_api(name: str) -> dict:
    return json.loads((_IMAGE_STUDIO / name).read_text(encoding="utf-8"))


def _output_nodes(prompt: dict, classes: set) -> list:
    return [nid for nid, node in prompt.items()
            if isinstance(node, dict) and node.get("class_type") in classes]


def _make_switcher() -> lm._Switcher:
    sw = lm._Switcher()
    return sw


def _stub_steps(switcher, watchdog=None, lmm=None, free=None):
    """把三个步骤法替换成记录桩;返回调用记录。"""
    calls = []
    def wd():
        calls.append(("watchdog",))
        if watchdog:
            watchdog()
    def st_lm(target):
        calls.append(("lm", target))
        if lmm:
            lmm(target)
    def st_free():
        calls.append(("free",))
        if free:
            free()
    switcher._step_watchdog = wd  # type: ignore[method-assign]
    switcher._step_lm = st_lm  # type: ignore[method-assign]
    switcher._step_free = st_free  # type: ignore[method-assign]
    return calls


def _fake_request(remote: str):
    class _Req:
        pass
    req = _Req()
    req.remote = remote  # type: ignore[attr-defined]
    return req


class _FakeWebResponse:
    def __init__(self, payload, status):
        self.payload, self.status = payload, status


@pytest.fixture()
def fake_aiohttp(monkeypatch):
    """无 aiohttp 环境的 web 模块桩(json_response 仅此一用面)。"""
    fake = types.ModuleType("aiohttp")
    web = types.ModuleType("aiohttp.web")

    def json_response(payload, status=200):
        return _FakeWebResponse(payload, status)

    web.json_response = json_response  # type: ignore[attr-defined]
    fake.web = web
    monkeypatch.setitem(sys.modules, "aiohttp", fake)
    monkeypatch.setitem(sys.modules, "aiohttp.web", web)
    return web


# ── ① 平台守卫 ───────────────────────────────────────────────────────────────
def test_platform_guard_darwin_noop(monkeypatch, mode_env):
    """非 win32:install no-op——不起线程、不触文件、不置 _installed。"""
    monkeypatch.setattr(sys, "platform", "darwin")
    threads_before = threading.active_count()
    lm.install()
    assert threading.active_count() == threads_before
    assert not mode_env.mode.exists()
    assert lm._installed is False


# ── ② 分类器(fixture=真实 API 图) ────────────────────────────────────────────
@pytest.mark.parametrize("name", [
    "h3-shot-template.api.json",
    "h3-multiseg-template.api.json",
    "fasth3-shot-template.api.json",
])
def test_classify_video_templates(name, mode_env):
    """三视频模板(裸 API 图)终输出=SaveVideo → video。"""
    prompt = _video_api(name)
    outputs = _output_nodes(prompt, {"SaveVideo"})
    assert outputs, f"{name} 无 SaveVideo 终输出"
    item = (1, "pid-v", prompt, {}, outputs, {})
    assert lm._classify_item(item) == "video"


def test_classify_qi21_image(mode_env):
    """qi21/qwen21 道劫 t2i(api 图 graph 字段)终输出=SaveImage×2 → image。"""
    assert _QWEN21_T2I_API.is_file(), "qwen21-道劫-t2i-api.json 缺失"
    prompt = json.loads(_QWEN21_T2I_API.read_text(encoding="utf-8"))["graph"]
    outputs = _output_nodes(prompt, {"SaveImage"})
    assert outputs, "t2i api 图无 SaveImage"
    item = (1, "pid-i", prompt, {}, outputs, {})
    assert lm._classify_item(item) == "image"


def test_classify_yue2_audio(mode_env):
    """Yue2 整曲(SaveAudioAdvanced 终输出)→audio 且不触发切档;map 记 audio。"""
    assert _YUE2_OFFICIAL.is_file(), "yue2-整曲-官方版.json 缺失"
    # 真实图锚:官方版工作流含 SaveAudioAdvanced 终输出节点(实读节点清单)
    wf = json.loads(_YUE2_OFFICIAL.read_text(encoding="utf-8"))
    wf_types = {n.get("type") for n in wf.get("nodes", [])}
    assert "SaveAudioAdvanced" in wf_types
    # API 形构造(节点类型取自真实图:SaveAudioAdvanced ← VAEDecodeAudioTiled)
    prompt = {
        "17": {"class_type": "VAEDecodeAudioTiled", "inputs": {"samples": ["5", 0], "vae": ["18", 0]}},
        "10": {"class_type": "SaveAudioAdvanced", "inputs": {"audio": ["17", 0], "filename_prefix": "yue2"}},
    }
    item = (1, "pid-a", prompt, {}, ["10"], {})
    assert lm._classify_item(item) == "audio"
    with lm._kind_map_lock:
        assert lm._kind_map["pid-a"] == "audio"
    # audio 不触发切档:put 包装只对 image/video 发 request
    requests = []
    class _FakeSwitcher:
        def request(self, target):
            requests.append(target)
    orig_put_calls = []

    def orig_put(self, *a, **k):
        orig_put_calls.append(a)
        return "OK"

    wrapped = lm._put_wrapper_factory(orig_put)
    fake_sw = _FakeSwitcher()
    monkey_sw = lm._switcher
    lm._switcher = fake_sw  # type: ignore[assignment]
    try:
        assert wrapped(None, item) == "OK"
    finally:
        lm._switcher = monkey_sw
    assert requests == []
    assert orig_put_calls and orig_put_calls[0][0] is item


def test_classify_skipped_branch(mode_env):
    """图含未执行 SaveVideo 分支但 outputs_to_execute 只含 SaveImage → image。"""
    prompt = {
        "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0]}},
        "4": {"class_type": "SaveVideo", "inputs": {"video": ["36", 0]}},  # 分支未进执行集
    }
    item = (1, "pid-s", prompt, {}, ["8"], {})
    assert lm._classify_item(item) == "image"


def test_classify_seedvr_not_video(mode_env):
    """SeedVR2VideoUpscaler 字样在图内(非终输出)不误判 video。"""
    prompt = json.loads(_QWEN21_T2I_API.read_text(encoding="utf-8"))["graph"]
    assert any(n.get("class_type") == "SeedVR2VideoUpscaler" for n in prompt.values())
    outputs = _output_nodes(prompt, {"SaveImage"})
    item = (1, "pid-sv", prompt, {}, outputs, {})
    assert lm._classify_item(item) == "image"


def test_classify_empty_unknown(mode_env):
    """空 outputs_to_execute → unknown(G0c:validate_prompt 收敛后的空集)。"""
    item = (1, "pid-u", {"8": {"class_type": "SaveImage", "inputs": {}}}, [], {})
    assert lm._classify_item(item) == "unknown"


def test_classify_priority(mode_env):
    """多类同集:video>image>audio;image+audio→image。"""
    prompt = {
        "4": {"class_type": "SaveVideo", "inputs": {}},
        "8": {"class_type": "SaveImage", "inputs": {}},
        "10": {"class_type": "SaveAudioAdvanced", "inputs": {}},
    }
    assert lm._classify_item((1, "p1", prompt, {}, ["4", "8", "10"], {})) == "video"
    assert lm._classify_item((1, "p2", prompt, {}, ["8", "10"], {})) == "image"


# ── ③ 状态机 ─────────────────────────────────────────────────────────────────
def test_state_machine_transitions(mode_env):
    """none→image→video 全转移,steps_done 三步全落;看门狗两向恒 ENABLE(D4a)。"""
    sw = _make_switcher()
    calls = _stub_steps(sw)
    sw._run_sequence("image")
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"]) == ("image", "active")
    assert m["steps_done"] == ["watchdog", "lm", "free"]
    # D5b:反向切换有 5min 驻留——测试把 switched_at 推到窗外再切
    stale = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - lm.MIN_MODE_DWELL - 60))
    lm._write_mode_atomic({**m, "switched_at": stale})
    sw._run_sequence("video")
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"]) == ("video", "active")
    # 评审#2:切 video 档不再 DISABLE 看门狗——两向都是同一恒开步
    assert calls == [("watchdog",), ("lm", "image"), ("free",),
                     ("watchdog",), ("lm", "video"), ("free",)]


def test_same_mode_noop_only_active(mode_env, monkeypatch):
    """评审#1 保真重写(真实探测函数+真实限频路径):
    active 同档全 no-op;degraded 限频窗内不打扰;窗外探测吻合→覆写 active;
    窗外探测不吻合→**补跑治理序列**(自愈主路,真实代码可达)。"""
    monkeypatch.setattr(lm.time, "sleep", lambda s: None)
    sw = _make_switcher()
    calls = _stub_steps(sw)
    # active 同档:no-op
    lm._write_mode_atomic({"mode": "image", "state": "active",
                           "steps_done": ["watchdog", "lm", "free"],
                           "degraded_steps": [], "switched_at": "t", "by": "x"})
    sw._run_sequence("image")
    assert calls == []
    assert _read(mode_env.mode)["state"] == "active"
    # degraded 同档+限频窗内:零打扰(不探测不补跑)
    lm._write_mode_atomic({"mode": "image", "state": "degraded",
                           "steps_done": ["watchdog", "free"],
                           "degraded_steps": ["lm"], "switched_at": "t", "by": "x"})
    probed = []

    def probe_side_effect():
        probed.append(1)
        return {lm.NINE_B_ID: "loaded"}

    monkeypatch.setattr(lm, "_probe_models", probe_side_effect)
    sw._last_probe_ts = time.monotonic()  # 限频窗口内
    sw._run_sequence("image")
    assert probed == [] and calls == []  # 窗内连探测都不发
    # 窗外+探测吻合(9B 已被外部装上):零动作覆写 active
    sw._last_probe_ts = time.monotonic() - lm.PROBE_THROTTLE - 1
    sw._run_sequence("image")
    assert probed == [1] and calls == []
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"]) == ("image", "active")
    # 窗外+探测不吻合(LM 形态未达目标)→补跑治理序列(评审#1 核心回归)
    lm._write_mode_atomic({"mode": "video", "state": "degraded",
                           "steps_done": ["watchdog"], "degraded_steps": ["lm"],
                           "switched_at": "t", "by": "x"})
    monkeypatch.setattr(lm, "_probe_models", lambda: {"some-27b": "loaded"})  # 未卸空→不吻合
    sw._last_probe_ts = time.monotonic() - lm.PROBE_THROTTLE - 1
    sw._run_sequence("video")
    assert ("lm", "video") in calls  # 自愈:治理序列真跑了
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"]) == ("video", "active")


def test_failed_retry_steps_done(mode_env):
    """缺步续跑非全序列(watchdog 已完成不重跑);失败重试受 5min 限频;
    连续 3 次失败后停。"""
    sw = _make_switcher()
    calls = _stub_steps(sw, lmm=lambda t: (_ for _ in ()).throw(lm.StepFailed("lm 步炸")))
    sw._run_sequence("image")
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"]) == ("image", "failed")
    assert m["steps_done"] == ["watchdog"]  # lm 前的步已落账
    assert sw._consecutive_failures == 1
    # 限频窗内(失败刚记时戳):重试被限频挡住
    calls.clear()
    sw._step_lm = lambda target: calls.append(("lm", target))  # type: ignore[method-assign]
    sw._run_sequence("image")
    assert calls == []  # 限频窗内不重撞
    # 窗外:续跑——watchdog 不重跑,lm 成功,free 补上
    sw._last_probe_ts = time.monotonic() - lm.PROBE_THROTTLE - 1
    sw._run_sequence("image")
    assert ("watchdog",) not in calls  # 缺步续跑非全序列
    assert ("lm", "image") in calls
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"]) == ("image", "active")
    assert m["steps_done"] == ["watchdog", "lm", "free"]
    # 3 次连续失败后停:重置到 failures=3 的 failed 态,窗外也不再动
    sw._consecutive_failures = lm.MAX_AUTO_RETRIES
    lm._write_mode_atomic({"mode": "video", "state": "failed",
                           "steps_done": [], "degraded_steps": [],
                           "switched_at": "t", "by": "x"})
    calls.clear()
    sw._last_probe_ts = time.monotonic() - lm.PROBE_THROTTLE - 1
    sw._run_sequence("video")
    assert calls == []  # 已停:不再自动重试
    assert _read(mode_env.mode)["state"] == "failed"


def test_step_exception_lands_failed(mode_env):
    """每步逐一抛未预期异常 → 终态 failed(非 switching),且能响应下一序列。"""
    for broken in ("watchdog", "lm", "free"):
        mode_env.mode.unlink(missing_ok=True)
        sw = _make_switcher()
        _stub_steps(sw,
                    watchdog=(lambda: (_ for _ in ()).throw(RuntimeError("wd boom"))) if broken == "watchdog" else None,
                    lmm=(lambda t: (_ for _ in ()).throw(RuntimeError("lm boom"))) if broken == "lm" else None,
                    free=(lambda: (_ for _ in ()).throw(RuntimeError("free boom"))) if broken == "free" else None)
        sw._run_sequence("image")
        m = _read(mode_env.mode)
        assert m["state"] == "failed", f"{broken} 步异常未收编 failed"
        assert m["state"] != "switching"
        # 线程(daemon)响应下一 request:failed 后新序列(限频窗外)仍可成功
        _stub_steps(sw)
        sw._consecutive_failures = 0
        sw._last_probe_ts = time.monotonic() - lm.PROBE_THROTTLE - 1
        sw._run_sequence("image")
        assert _read(mode_env.mode)["state"] == "active"


def test_stale_switching_pid_dead(mode_env):
    """switching+pid 死→回退 none;pid 活→不动。"""
    lm._write_mode_atomic({"mode": "video", "state": "switching", "pid": 3999999,
                           "steps_done": ["watchdog"], "degraded_steps": []})
    monkey_alive = lm._pid_alive
    lm._pid_alive = lambda pid: False  # type: ignore[assignment]
    try:
        lm._recover_stale_switching()
        m = _read(mode_env.mode)
        assert (m["mode"], m["state"]) == ("none", "none")
        # pid 活:不动
        lm._write_mode_atomic({"mode": "video", "state": "switching", "pid": 1234,
                               "steps_done": [], "degraded_steps": []})
        lm._pid_alive = lambda pid: True  # type: ignore[assignment]
        lm._recover_stale_switching()
        assert _read(mode_env.mode)["state"] == "switching"
    finally:
        lm._pid_alive = monkey_alive


def test_legacy_schema_trusts_mode(mode_env):
    """旧 {mode,switched_at,by} 缺 state→legacy:同档探测吻合→覆写 active。"""
    mode_env.mode.write_text(json.dumps(
        {"mode": "video", "switched_at": "2026-11-01T09:00:00", "by": "retired-manual-switcher"}),
        encoding="utf-8")
    sw = _make_switcher()
    calls = _stub_steps(sw)
    sw._light_probe_matches = lambda target: True  # type: ignore[method-assign]
    sw._run_sequence("video")
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"]) == ("video", "active")
    assert m["steps_done"] == ["watchdog", "lm", "free"]
    assert calls == []  # 探测吻合:零动作覆写


def test_mode_atomic_write(mode_env, monkeypatch):
    """tmp+os.replace:正常路径完整 JSON 无 .tmp 残留;写中断不产生半 JSON。"""
    lm._write_mode_atomic({"mode": "video", "state": "active"})
    assert _read(mode_env.mode) == {"mode": "video", "state": "active"}
    assert not Path(str(mode_env.mode) + ".tmp").exists()
    # 中断:json.dump 抛错 → 目标保持旧内容(读方永不见半文件)
    real_dump = lm.json.dump

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(lm.json, "dump", boom)
    with pytest.raises(OSError):
        lm._write_mode_atomic({"mode": "image", "state": "active"})
    assert _read(mode_env.mode) == {"mode": "video", "state": "active"}


# ── ④ 序列与守卫 ─────────────────────────────────────────────────────────────
def test_video_sequence_order(mode_env, monkeypatch):
    """video 序:MODE 原子先落盘(switching)→看门狗(actor)→LM(actor)→
    /free;全程 LM/看门狗治理走 actor 通路。"""
    events = []
    real_write = lm._write_json_atomic

    def traced_write(target, payload):
        if Path(target) == mode_env.mode:
            events.append(("mode_write", payload.get("state"), payload.get("mode")))
        return real_write(target, payload)

    monkeypatch.setattr(lm, "_write_json_atomic", traced_write)

    def fake_actor(action, params=None, budget=30.0, action_path=None, result_path=None):
        events.append(("actor", action))
        if action == "lms_ps":
            return {"attempt_id": "x", "status": "done", "exit_code": 0,
                    "stdout": json.dumps([{"identifier": "m2", "status": "idle"}])}
        return {"attempt_id": "x", "status": "done", "exit_code": 0, "stdout": ""}

    monkeypatch.setattr(lm, "_actor_exec", fake_actor)
    monkeypatch.setattr(lm, "_engine_queue_ids", lambda: set())
    monkeypatch.setattr(lm, "_probe_models", lambda: {})

    sw = _make_switcher()
    # 看门狗 State 复核走 powershell Get-ScheduledTask(评审#5:恒英文枚举);
    # 测试注入目标态(恒 ENABLE 语义,目标态恒 Ready)
    sw._watchdog_state = lambda: "Ready"  # type: ignore[method-assign]
    # free 步真身走引擎 HTTP(非 actor);此处只验序,替换为记录桩
    sw._step_free = lambda: events.append(("free",))  # type: ignore[method-assign]
    sw._run_sequence("video")
    idx_mode = events.index(("mode_write", "switching", "video"))
    idx_wd = events.index(("actor", "watchdog"))
    idx_ps = events.index(("actor", "lms_ps"))
    idx_unload = events.index(("actor", "unload"))
    idx_free = events.index(("free",))
    idx_active = events.index(("mode_write", "active", "video"))
    assert idx_mode < idx_wd < idx_ps < idx_unload < idx_free < idx_active
    m = _read(mode_env.mode)
    assert (m["mode"], m["state"], m["steps_done"]) == ("video", "active", ["watchdog", "lm", "free"])


def test_wait_queue_empty_task_boundary(mode_env, monkeypatch):
    """D5:lms unload/load 与 /free 对齐任务边界——队列**完全空**才放行
    (方向性守卫已被完全空包含:同向/对向/unknown 一律等);非空→5s 轮询
    等待;15min 超时→StepDegraded(治理推迟);空→过。"""
    sw = _make_switcher()
    sleeps = []
    monkeypatch.setattr(lm.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(lm, "QUEUE_GUARD_TIMEOUT", 0.05)
    # 空队 → 放行(零等待)
    monkeypatch.setattr(lm, "_engine_queue_ids", lambda: set())
    sw._wait_queue_empty("lm")
    assert sleeps == []
    # 任何条目在队(不分方向/种类)→ 轮询等待 → 超时降级
    for blocker in ({"q-i"}, {"q-v"}, {"q-a"}, {"q-u"}):
        sleeps.clear()
        monkeypatch.setattr(lm, "_engine_queue_ids", lambda b=blocker: set(b))
        with pytest.raises(lm.StepDegraded) as ei:
            sw._wait_queue_empty("lm")
        assert ei.value.step == "lm"
        assert "队列未空" in ei.value.reason
    # 等待期间队列转空 → 通过(真实轮询循环)
    calls = {"n": 0}

    def drain():
        calls["n"] += 1
        return {"x"} if calls["n"] < 3 else set()

    monkeypatch.setattr(lm, "_engine_queue_ids", drain)
    sleeps.clear()  # blocker 段零耗时轮询的计数不清零会污染断言
    sw._wait_queue_empty("free")
    assert calls["n"] == 3 and len(sleeps) == 2  # 两次等待后第三查放行


def test_preaction_queue_recheck(mode_env, monkeypatch):
    """D5 单循环守卫(复查内化于循环):等待期内存留/新到条目持续拦
    (不分方向),队列转空才放行,放行后动作才发(lms_ps)。"""
    monkeypatch.setattr(lm.time, "sleep", lambda s: None)
    queue_calls = []
    with lm._kind_map_lock:
        lm._kind_map.clear()

    def queue_ids():
        queue_calls.append(1)
        if len(queue_calls) <= 2:
            return {"q-stay"}  # 前两轮任务在队(存留→新到同形)
        return set()           # 第三轮任务跑完 → 放行

    monkeypatch.setattr(lm, "_engine_queue_ids", queue_ids)
    sw = _make_switcher()
    actor_calls = []
    monkeypatch.setattr(lm, "_actor_exec",
                        lambda *a, **k: actor_calls.append(a[0]) or
                        {"attempt_id": "x", "status": "done", "exit_code": 0,
                         "stdout": json.dumps([{"identifier": "m", "status": "idle"}])})
    monkeypatch.setattr(lm, "_probe_models", lambda: {})
    sw._step_lm("video")  # 不抛:等两轮后放行
    assert len(queue_calls) == 3
    assert actor_calls[:1] == ["lms_ps"]   # 放行后动作才发
    assert actor_calls.count("unload") == 1


def test_lm_busy_immediate_degrade(mode_env, monkeypatch):
    """D1:LM status≠idle → 立即 degraded 零等待零轮询(无 sleep、无动作)。"""
    sw = _make_switcher()
    monkeypatch.setattr(lm, "_engine_queue_ids", lambda: set())  # D5 任务边界守卫直通
    sleeps = []
    actor_calls = []
    monkeypatch.setattr(lm.time, "sleep", lambda s: sleeps.append(s))

    def fake_actor(action, params=None, budget=30.0, action_path=None, result_path=None):
        actor_calls.append(action)
        return {"attempt_id": "x", "status": "done", "exit_code": 0,
                "stdout": json.dumps([{"identifier": "qwen3.8-27b-coder390", "status": "generating"}])}

    monkeypatch.setattr(lm, "_actor_exec", fake_actor)
    t0 = time.monotonic()
    with pytest.raises(lm.StepDegraded) as ei:
        sw._step_lm("video")
    elapsed = time.monotonic() - t0
    assert ei.value.step == "lm"
    assert "LM 忙" in ei.value.reason
    assert sleeps == []      # 零轮询
    assert actor_calls == ["lms_ps"]  # 只探测,零治理动作
    assert elapsed < 0.5    # 立即(D1:不等待)


def test_verify_grace_polling(mode_env, monkeypatch):
    """宽限轮询:按 interval 节奏;过验即返;宽限耗尽→该步 failed。"""
    sw = _make_switcher()
    # 分档常量与蓝图对齐:watchdog 30s / lm-load 300s / lm-unload 120s
    assert (lm.GRACE_WATCHDOG, lm.GRACE_LM_LOAD, lm.GRACE_LM_UNLOAD) == (30, 300, 120)
    # 虚拟时钟:sleep 推进 monotonic,零真实等待
    clock = {"now": 1000.0}
    sleeps = []
    monkeypatch.setattr(lm.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(lm.time, "sleep", lambda s: (sleeps.append(s), clock.__setitem__("now", clock["now"] + s)))
    # 第 2 次过验:恰好 1 次 sleep
    checks = iter([False, True])
    sw._verify_grace(lambda: next(checks), interval=30.0, deadline=90.0, what="X")
    assert sleeps == [30.0]
    # 永不过验:轮到宽限耗尽 → StepFailed
    sleeps.clear()
    with pytest.raises(lm.StepFailed):
        sw._verify_grace(lambda: False, interval=30.0, deadline=90.0, what="X")
    assert len(sleeps) >= 2  # 90s/30s 至少两轮


def test_free_step_only_200(mode_env, monkeypatch):
    """评审#9:/free 只验 200(不验显存水位);发前等队列完全空——队列不空
    超时→StepDegraded("free")且 HTTP 零发出(全局清缓存永不落在途渲染中辙)。"""
    sw = _make_switcher()
    import urllib.request
    monkeypatch.setattr(lm, "_engine_queue_ids", lambda: set())  # 队列空

    class _FakeResp:
        def __init__(self, status):
            self.status = status

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    sent = {}

    def fake_urlopen(req, timeout=None):
        sent["url"] = req.full_url
        sent["body"] = json.loads(req.data.decode("utf-8"))
        return _FakeResp(200)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    sw._step_free()
    assert sent["url"].endswith("/free")
    # 1109 降级:unload_models=False(主动全量卸载在大驻留下原生崩溃,腾显存
    # 交还引擎按需换出);free_memory=True 清缓存保留
    assert sent["body"] == {"unload_models": False, "free_memory": True}

    def fake_500(req, timeout=None):
        return _FakeResp(500)

    monkeypatch.setattr(urllib.request, "urlopen", fake_500)
    with pytest.raises(lm.StepFailed):
        sw._step_free()

    # 队列不空:守卫等待→超时降级(free 推迟),HTTP 不发
    sent.clear()
    monkeypatch.setattr(lm, "_engine_queue_ids", lambda: {"in-flight"})
    monkeypatch.setattr(lm, "QUEUE_GUARD_TIMEOUT", 0.05)
    monkeypatch.setattr(lm.time, "sleep", lambda s: None)
    with pytest.raises(lm.StepDegraded) as ei:
        sw._step_free()
    assert ei.value.step == "free"
    assert "队列未空" in ei.value.reason
    assert sent == {}  # /free 未发出


# ── ⑤ actor 通路 ─────────────────────────────────────────────────────────────
def test_actor_attempt_id_handshake(mode_env, monkeypatch):
    """attempt_id 三段式:action 原子写→schtasks /Run→2s 轮询只认当前 id;
    旧 id 丢弃;超时 failed;result error/exit_code≠0 皆败;全原子无 .tmp 残留。"""
    monkeypatch.setattr(lm, "RESULT_POLL_INTERVAL", 0.01)
    runs = []

    def fake_run(argv, **kwargs):
        runs.append(argv)
        # actor 立即响应:按当前 action 文件回写 result(done)
        action = _read(mode_env.action)
        mode_env.result.write_text(json.dumps(
            {"attempt_id": action["attempt_id"], "status": "done",
             "exit_code": 0, "stdout": "ok"}), encoding="utf-8")
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(lm.subprocess, "run", fake_run)
    out = lm._actor_exec("lms_ps", {}, budget=2.0,
                         action_path=str(mode_env.action), result_path=str(mode_env.result))
    assert out["status"] == "done"
    assert runs[0] == ["schtasks", "/Run", "/TN", "MY-LineMode-actor"]
    action = _read(mode_env.action)
    assert action["action"] == "lms_ps" and action["attempt_id"]
    assert not Path(str(mode_env.action) + ".tmp").exists()
    assert not Path(str(mode_env.result) + ".tmp").exists()

    # 旧 id 丢弃:result 文件先残留旧 id(上次会话),actor 单次 Run 写当前
    # id → 轮询先读到旧 id 丢弃,后读到新 id 才认
    mode_env.result.write_text(json.dumps(
        {"attempt_id": "stale-id", "status": "done", "exit_code": 0, "stdout": "old"}),
        encoding="utf-8")

    def fake_run_stale(argv, **kwargs):
        action = _read(mode_env.action)
        mode_env.result.write_text(json.dumps(
            {"attempt_id": action["attempt_id"], "status": "done",
             "exit_code": 0, "stdout": "ok"}), encoding="utf-8")
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(lm.subprocess, "run", fake_run_stale)
    out = lm._actor_exec("lms_ps", {}, budget=2.0,
                         action_path=str(mode_env.action), result_path=str(mode_env.result))
    assert out["status"] == "done"
    assert out["stdout"] == "ok"  # 读到的是新 id 的 result,非 stale 残留

    # 超时 → StepFailed
    monkeypatch.setattr(lm.subprocess, "run",
                        lambda argv, **k: types.SimpleNamespace(returncode=0, stdout="", stderr=""))
    with pytest.raises(lm.StepFailed):
        lm._actor_exec("lms_ps", {}, budget=0.05,
                       action_path=str(mode_env.action), result_path=str(mode_env.result))
    # exit_code≠0 → StepFailed
    def fake_run_bad_exit(argv, **kwargs):
        action = _read(mode_env.action)
        mode_env.result.write_text(json.dumps(
            {"attempt_id": action["attempt_id"], "status": "done",
             "exit_code": 1, "stdout": "boom"}), encoding="utf-8")
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(lm.subprocess, "run", fake_run_bad_exit)
    with pytest.raises(lm.StepFailed):
        lm._actor_exec("lms_ps", {}, budget=2.0,
                       action_path=str(mode_env.action), result_path=str(mode_env.result))


def test_actor_load_idempotent(mode_env, monkeypatch):
    """load 前已 loaded 同 id(lms ps 在列)→跳过 load9b。"""
    sw = _make_switcher()
    monkeypatch.setattr(lm, "_engine_queue_ids", lambda: set())  # D5 守卫直通
    actor_calls = []

    def fake_actor(action, params=None, budget=30.0, action_path=None, result_path=None):
        actor_calls.append(action)
        if action == "lms_ps":
            return {"attempt_id": "x", "status": "done", "exit_code": 0,
                    "stdout": json.dumps([{"identifier": lm.NINE_B_ID, "status": "idle"}])}
        return {"attempt_id": "x", "status": "done", "exit_code": 0, "stdout": ""}

    monkeypatch.setattr(lm, "_actor_exec", fake_actor)
    monkeypatch.setattr(lm, "_probe_models", lambda: {lm.NINE_B_ID: "loaded"})
    sw._step_lm("image")
    assert "load9b" not in actor_calls  # 9B 已在位:幂等跳过


# ── ⑥ 路由(限源/诊断) ───────────────────────────────────────────────────────
def test_get_route_loopback_only(mode_env, fake_aiohttp):
    """非 127.0.0.1/::1 → 403;环回 → 200 回显 MODE。"""
    resp = lm._handle_line_mode_get(_fake_request("192.168.0.5"))
    assert resp.status == 403
    resp = lm._handle_line_mode_get(_fake_request("::ffff:10.0.0.1"))
    assert resp.status == 403
    lm._write_mode_atomic({"mode": "video", "state": "active",
                           "steps_done": ["watchdog", "lm", "free"], "degraded_steps": []})
    resp = lm._handle_line_mode_get(_fake_request("127.0.0.1"))
    assert resp.status == 200
    assert resp.payload["mode"] == "video"
    assert resp.payload["state"] == "active"
    resp = lm._handle_line_mode_get(_fake_request("::1"))
    assert resp.status == 200


def test_diagnosis_route_disabled_default(mode_env, fake_aiohttp, monkeypatch):
    """默认关→404;开时固定 argv 只读+SHA256 内存基线对拍(漂移拒绝)。"""
    assert lm.LINE_MODE_DIAGNOSIS_ENABLED is False
    resp = lm._handle_diagnosis_get(_fake_request("127.0.0.1"))
    assert resp.status == 404
    monkeypatch.setattr(lm, "LINE_MODE_DIAGNOSIS_ENABLED", True)
    monkeypatch.setattr(lm, "_DIAG_BASELINE", None)

    def fake_run(argv, **kwargs):
        assert kwargs.get("timeout"), "诊断子进程必须带 timeout"
        env = kwargs.get("env") or {}
        assert env.get("USERPROFILE") == lm.LMS_ENV["USERPROFILE"]  # env 注入
        return types.SimpleNamespace(returncode=0,
                                     stdout="PS-STABLE-OUTPUT", stderr="")

    monkeypatch.setattr(lm.subprocess, "run", fake_run)
    resp = lm._handle_diagnosis_get(_fake_request("127.0.0.1"))
    assert resp.status == 200 and resp.payload["baseline_established"] is True
    # 基线已铸:同输出 → 通过;输出漂移 → 409 拒绝
    resp = lm._handle_diagnosis_get(_fake_request("127.0.0.1"))
    assert resp.status == 200
    monkeypatch.setattr(lm.subprocess, "run",
                        lambda argv, **k: types.SimpleNamespace(returncode=0, stdout="PS-CHANGED", stderr=""))
    resp = lm._handle_diagnosis_get(_fake_request("127.0.0.1"))
    assert resp.status == 409
    # 非环回 → 403
    resp = lm._handle_diagnosis_get(_fake_request("10.1.2.3"))
    assert resp.status == 403


# ── ⑦ 工程纪律扫描 ───────────────────────────────────────────────────────────
def test_subprocess_all_have_timeout():
    """源码内每个 subprocess.run 必带 timeout;诊断通路必注入 LMS_ENV。"""
    src = _NODE.read_text(encoding="utf-8")
    for m in re.finditer(r"subprocess\.run\(", src):
        window = src[m.start():m.start() + 400]
        assert "timeout=" in window, f"subprocess.run 缺 timeout(偏移 {m.start()})"
    assert "env={**os.environ, **LMS_ENV}" in src


def test_put_passthrough_on_error(mode_env, monkeypatch):
    """分类抛错/入参畸形 → 原 put 透传(绝不挡入队)。"""
    monkeypatch.setattr(lm, "_classify_item", lambda item: (_ for _ in ()).throw(RuntimeError("boom")))
    orig_calls = []

    def orig_put(self, *a, **k):
        orig_calls.append(a)
        return 42

    wrapped = lm._put_wrapper_factory(orig_put)
    item = (1, "p", {}, {}, [], {})
    assert wrapped(None, item) == 42
    assert orig_calls == [(item,)]


def test_disabled_flag(mode_env):
    """急停标记文件在 → 切换器 no-op(MODE 零写入)。"""
    mode_env.disabled.write_text("", encoding="utf-8")
    sw = _make_switcher()
    calls = _stub_steps(sw)
    sw.request("video")
    sw._run_sequence("video")
    assert calls == []
    assert not mode_env.mode.exists()


def test_mode_dwell_anti_pingpong(mode_env):
    """D5b:反向切换最小驻留 5 分钟——到位态刚切过→拒切分毫不动;
    驻留期满→放行;failed 态不拦(没成功驻留过);同档补跑不拦。"""
    sw = _make_switcher()
    calls = _stub_steps(sw)
    fresh = time.strftime("%Y-%m-%dT%H:%M:%S")  # 刚切
    stale = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - lm.MIN_MODE_DWELL - 60))
    # image active 刚切 1 秒 → 反向 video 拒切
    lm._write_mode_atomic({"mode": "image", "state": "active", "switched_at": fresh,
                           "steps_done": ["watchdog", "lm", "free"], "degraded_steps": []})
    sw._run_sequence("video")
    assert calls == [] and _read(mode_env.mode)["mode"] == "image"
    # 驻留期满(6min 前)→ 放行
    lm._write_mode_atomic({"mode": "image", "state": "active", "switched_at": stale,
                           "steps_done": ["watchdog", "lm", "free"], "degraded_steps": []})
    sw._run_sequence("video")
    assert ("lm", "video") in calls
    assert _read(mode_env.mode)["mode"] == "video"
    # degraded 态同样受驻留保护(乒乓防的是到位语义,含治理推迟态)
    calls.clear()
    mode_env.mode.unlink()
    lm._write_mode_atomic({"mode": "video", "state": "degraded", "switched_at": fresh,
                           "steps_done": ["watchdog"], "degraded_steps": ["lm"]})
    sw._run_sequence("image")
    assert calls == [] and _read(mode_env.mode)["mode"] == "video"
    # failed 态不拦(未成功驻留);同档(video→video)不拦
    calls.clear()
    lm._write_mode_atomic({"mode": "image", "state": "failed", "switched_at": fresh,
                           "steps_done": ["watchdog"], "degraded_steps": []})
    sw._consecutive_failures = 1
    sw._last_probe_ts = 0.0
    sw._run_sequence("video")
    assert ("lm", "video") in calls  # failed 反向不拦,序列照跑


def test_worker_get_waits_for_switching(mode_env, monkeypatch):
    """D6:worker 取任务遇 switching→首任务等待(≤120s)至窗口结束;
    超时放行+告警;同窗口后续任务直接放行;窗口结束一次性闸复位;
    put 永不阻塞纪律由 _put 自身保证(无等待路径)。"""
    origin_calls = []

    def orig_get(self, *a, **k):
        origin_calls.append(1)
        return ("item",)

    wrapped_get = lm._get_wrapper_factory(orig_get)
    sleeps = []
    # 虚拟时钟:每 sleep 推进 2s(与轮询步长一致)
    clock = {"now": 0.0}
    monkeypatch.setattr(lm.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(lm.time, "sleep",
                        lambda s: (sleeps.append(s), clock.__setitem__("now", clock["now"] + s)))
    # 场景1:switching,3 轮等待后 MODE 变 active → 放行(未超时)
    lm._write_mode_atomic({"mode": "video", "state": "switching", "switched_at": "t", "steps_done": []})
    mode_seq = ["switching", "switching", "active"]
    mode_reads = {"n": 0}

    def mode_reader():
        idx = min(mode_reads["n"], len(mode_seq) - 1)
        mode_reads["n"] += 1
        return {"state": mode_seq[idx]}

    monkeypatch.setattr(lm, "_read_mode", mode_reader)
    assert wrapped_get(None) == ("item",)
    assert len(sleeps) >= 2  # 真实等待了
    # 场景2:同窗口(sw 仍 switching)第二发任务 → 一次性闸已用,直接放行
    sleeps.clear()
    monkeypatch.setattr(lm, "_read_mode", lambda: {"state": "switching"})
    assert wrapped_get(None) == ("item",)
    assert sleeps == []
    # 场景3:窗口结束 → 闸复位;再次 switching 且永不结束 → 120s 超时放行+告警
    monkeypatch.setattr(lm, "_read_mode", lambda: {"state": "active"})
    wrapped_get(None)  # 复位
    clock["now"] = 0.0
    sleeps.clear()
    monkeypatch.setattr(lm, "_read_mode", lambda: {"state": "switching"})
    assert wrapped_get(None) == ("item",)  # 超时放行,不抛
    total_waited = sum(sleeps)
    assert total_waited >= lm.WORKER_SWITCH_WAIT  # 等满上限
    # 场景4:_read_mode 抛错 → 不挡取任务(透传 orig)
    monkeypatch.setattr(lm, "_read_mode", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert wrapped_get(None) == ("item",)
    assert len(origin_calls) == 5  # 场景1/2/复位/超时/异常 各一发,全真调原 get


def test_machine_guard_mutual_exclusion(mode_env, monkeypatch):
    """D7:机器动作锁与 win-control 会话互斥——空闲→拿锁(owner/purpose/
    ttl 落账)→释放删除;他人持锁未过期→等待→超时 StepDegraded("guard");
    过期锁→接管;释放只删自己的(owner 不符不动)。"""
    guard_lock = tmp_lock = mode_env.mode.parent / "win-control.json"
    monkeypatch.setattr(lm, "WIN_CONTROL_LOCK", str(guard_lock))
    monkeypatch.setattr(lm, "MACHINE_GUARD_ACQUIRE_TIMEOUT", 0.06)
    monkeypatch.setattr(lm.time, "sleep", lambda s: None)
    # 空闲 → 拿锁+落账+释放
    with lm._machine_guard("unload") as token:
        held = _read(guard_lock)
        assert held["owner"] == token and held["level"] == "L1"
        assert held["ttl_min"] == lm.MACHINE_GUARD_TTL_MIN
        assert "unload" in held["purpose"]
    assert not guard_lock.exists()  # 释放删锁
    # 他人持锁(未过期)→ 等待超时 StepDegraded
    import datetime
    other = {"owner": "session-x", "purpose": "manual", "level": "L2",
             "acquired": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
             "ttl_min": 30, "host": "mac"}
    lm._write_json_atomic(str(guard_lock), other)
    with pytest.raises(lm.StepDegraded) as ei:
        with lm._machine_guard("load9b"):
            pass
    assert ei.value.step == "guard" and "session-x" in ei.value.reason
    assert _read(guard_lock)["owner"] == "session-x"  # 他人锁未被碰
    # 过期锁(1 分钟前拿,TTL 0)→ 接管
    lm._write_json_atomic(str(guard_lock), {**other, "ttl_min": 0})
    with lm._machine_guard("watchdog") as token2:
        assert _read(guard_lock)["owner"] == token2
    assert not guard_lock.exists()
    # 释放只删自己的:锁被换成他人 owner 时 yield 后不强删
    with lm._machine_guard("unload") as token3:
        lm._write_json_atomic(str(guard_lock), {**other, "ttl_min": 30})  # 窗口内被他人覆写
    assert _read(guard_lock)["owner"] == "session-x"  # 不误删他人锁
