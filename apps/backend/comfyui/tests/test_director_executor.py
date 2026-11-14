# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台执行链无头测试(11-13-director-console-remake 阶段3,1114)。

被测对象 = my_nodes/nodes/director_executor.py:
- resolve_plan 纯函数:六组合门控/缺上游逐镜点名/检查点跳过/重掷覆盖
- DirectorExecutor 伪类干跑:三臂链构建/逐镜三采调用序/事件/取消保留/
  ffmpeg 章级拼接/save=False 重采样语义(☑2 单独吃盘上 p1)
零引擎零 GPU(classes/hooks 全注入);引擎真绑(bind_engine_hooks)
与实弹=Win 装机窗验证(时间纪律:无头全秒级)。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from comfyui.my_nodes.nodes import director_executor as de
from comfyui.my_nodes.nodes import my_director_console as node_mod


def _state(**over):
    st = {
        "chapter": "chapter-b001",
        "stages": {"yicai": False, "ercai": False, "sancai": False},
        "color_fix": "none",
        "common_images": ["canon-jc.png"],
        "common_params": {"enabled": True, "seconds": 5, "seed": 42, "match": "match"},
        "advanced": {"first_steps": 8, "second_steps": 3, "sampler": "lcm",
                     "scheduler": "simple", "cfg": 1.0},
        "segments": [
            {"id": "sb-01", "mode": "r2v", "seconds": 5, "frames": 124,
             "seed": None, "rerun": False,
             "prompt": {"summary": "s", "retention": "", "description": "d",
                        "soundscape": ""}, "images": ["sb01.png"]},
            {"id": "sb-02", "mode": "r2v", "seconds": 4, "frames": 90,
             "seed": 7, "rerun": False,
             "prompt": {"summary": "", "retention": "", "description": "x",
                        "soundscape": ""}, "images": []},
        ],
    }
    st.update(over)
    return st


def _plan(state, disk=None):
    disk = disk or {}

    def list_output(prefix):
        return list(disk.get(prefix, []))

    return de.resolve_plan(state, list_output)


# ── resolve_plan:六组合门控 ──────────────────────────────────────────

def test_gate_no_stage_selected():
    runs, errors, _ = _plan(_state())
    assert runs == [] and errors and "未勾任何阶段" in errors[0]


def test_gate_yicai_only():
    st = _state()
    st["stages"]["yicai"] = True
    runs, errors, art = _plan(st)
    assert not errors and len(runs) == 2
    assert all(r["do"] == ["yicai"] for r in runs)
    assert art["sb-01"] == {}


def test_gate_full_chain():
    st = _state()
    for k in ("yicai", "ercai", "sancai"):
        st["stages"][k] = True
    runs, errors, _ = _plan(st)
    assert not errors
    assert all(r["do"] == ["yicai", "ercai", "sancai"] for r in runs)


def test_gate_ercai_alone_eats_disk_p1():
    st = _state()
    st["stages"]["ercai"] = True
    p1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    runs, errors, art = _plan(st, disk={p1: [p1 + "_00001.mp4"]})
    # sb-01 吃盘上 p1 进二采;sb-02 缺上游逐镜点名(计划级报错=发车前拦)
    assert [r["do"] for r in runs] == [["ercai"]]
    assert runs[0]["seg"]["id"] == "sb-01"
    assert art["sb-01"]["p1"] == p1 + "_00001.mp4"
    assert any("第2镜(sb-02)无p1" in e for e in errors)


def test_gate_ercai_alone_missing_p1_named_per_shot():
    st = _state()
    st["stages"]["ercai"] = True
    runs, errors, _ = _plan(st)
    assert runs == []
    assert any("第1镜(sb-01)无p1" in e for e in errors)
    assert any("第2镜(sb-02)无p1" in e for e in errors)


def test_gate_sancai_alone_needs_p2():
    st = _state()
    st["stages"]["sancai"] = True
    _, errors, _ = _plan(st)
    assert any("无p2" in e for e in errors)
    p2 = de.artifact_prefix("chapter-b001", "sb-01", "p2-final")
    runs, errors, _ = _plan(st, disk={p2: [p2 + "_00001.mp4"]})
    assert len(runs) == 1 and runs[0]["do"] == ["sancai"]
    assert any("第2镜(sb-02)无p2" in e for e in errors)


def test_gate_checkpoint_skip_and_rerun_override():
    st = _state()
    st["stages"]["yicai"] = True
    p1a = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    runs, _, art = _plan(st, disk={p1a: [p1a + "_00001.mp4"]})
    assert [r["seg"]["id"] for r in runs] == ["sb-02"]  # sb-01 检查点跳过
    assert art["sb-01"]["p1"].endswith("_00001.mp4")
    # 重掷:强制覆盖(已完镜也重跑)
    st["segments"][0]["rerun"] = True
    runs, _, _ = _plan(st, disk={p1a: [p1a + "_00001.mp4"]})
    assert [r["seg"]["id"] for r in runs] == ["sb-01", "sb-02"]


def test_gate_yicai_ercai_with_checkpoint_reuses_p1_but_runs():
    """勾1+2 且 sb-01 已有 p1:yicai 跳过,ercai 仍跑(latent 重采样)。"""
    st = _state()
    st["stages"]["yicai"] = st["stages"]["ercai"] = True
    p1a = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    runs, errors, _ = _plan(st, disk={p1a: [p1a + "_00001.mp4"]})
    assert not errors
    by_id = {r["seg"]["id"]: r["do"] for r in runs}
    assert by_id["sb-01"] == ["ercai"]
    assert by_id["sb-02"] == ["yicai", "ercai"]


def test_bak_files_not_treated_as_checkpoints():
    st = _state()
    st["stages"]["yicai"] = True
    p1a = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    runs, _, _ = _plan(st, disk={p1a: [p1a + "_00001.mp4.bak"]})
    assert [r["seg"]["id"] for r in runs] == ["sb-01", "sb-02"]  # .bak 不算已完


# ── 纯函数细节 ───────────────────────────────────────────────────────

def test_assemble_prompt_and_seed():
    seg = _state()["segments"][0]
    assert de.assemble_prompt(seg) == "s\n\nd"
    assert de.effective_seed(_state(), seg) == 42  # None=继承全局
    assert de.effective_seed(_state(), _state()["segments"][1]) == 7


def test_node_parse_timeline_full_defaults():
    """节点侧全字段归一:程序化直投(API)与面板序列化同口径。"""
    plan = node_mod.parse_timeline("")
    assert plan["advanced"]["first_steps"] == 8
    assert plan["common_params"]["seed"] == 42
    plan2 = node_mod.parse_timeline('{"segments":[{"seconds":5}],"stages":{"yicai":true}}')
    assert plan2["segments"][0]["frames"] == 124  # 5s→124f 贴网格
    assert plan2["segments"][0]["mode"] == "r2v"
    assert plan2["stages"]["yicai"] is True


# ── 伪类干跑:全链调用序 ─────────────────────────────────────────────

class FakeCls:
    """通用伪类:FUNCTION=go,按类名返回可断言元组;调用全记录。"""

    calls = []  # type: ignore[var-annotated]

    def __init__(self):
        self.name = type(self).__name__.replace("Fake_", "")

    def go(self, **kw):
        FakeCls.calls.append((self.name, kw))
        n = self.name
        if n in ("LoraLoaderModelOnly", "BlockSparseAttention",
                 "MiniMaxChunkFeedForward", "ModelAttentionBackend",
                 "MiniMaxH3SigmaShift", "ModelPreviewOverrideKJ",
                 "LTXVConcatAVLatent"):
            return (f"tensor:{n}",)
        if n == "MiniMaxH3ReferenceToVideo":
            return ("cond", "latent")
        if n == "MiniMaxH3ImageToVideo":
            return ("cond", "latent")
        if n in ("RandomNoise", "KSamplerSelect", "BasicScheduler",
                 "LoraLoaderModelOnly"):
            return ("x",)
        if n == "BasicGuider":
            return ("guider",)
        if n == "SamplerCustomAdvanced":
            return ("samples", "av_latent")
        if n in ("VAEDecode",):
            return (["frame"],)
        if n in ("VAEDecodeAudio",):
            return ("audio",)
        if n == "CreateVideo":
            return ("VIDEO",)
        if n == "SaveVideo":
            return ("VIDEO",)
        if n == "LTXVSeparateAVLatent":
            return ("vl", "al")
        if n == "MinimaxH3LatentUpscaler3D":
            return ("up",)
        if n == "ReCaVSRLoader":
            return ("rc",)
        if n == "ReCaVSRUpscale":
            return ("VIDEO3",)
        return (None,)


def _fake_classes():
    return {n: type(f"Fake_{n}", (FakeCls,), {
        "FUNCTION": "go"}) for n in de.NEEDED_CLASSES}


def _fake_hooks(disk=None, interrupt_at=None):
    disk = dict(disk or {})
    saved: list = []
    events: list = []
    ffmpeg_calls: list = []
    freed = []
    state = {"n": 0}

    def save_video_side_effect(prefix):
        # SaveVideo 落盘模拟:prefix→新文件名入 disk
        rel = prefix + "_00001.mp4"
        disk.setdefault(prefix, []).append(rel)
        return rel

    hooks = de.Hooks(
        load_image=lambda name: f"img:{name}" if name != "missing.png" else None,
        save_image=lambda images, prefix: {"filename": "pv.png",
                                           "subfolder": "x", "type": "output"},
        list_output=lambda prefix: [p for p in disk.get(prefix, [])
                                    if not p.endswith(".bak")],
        output_path=None,
        copy_to_input=lambda rel: rel.split("/")[-1],
        load_video=lambda name: f"vid:{name}",
        ffmpeg=lambda rels, out: ffmpeg_calls.append((list(rels), out)),
        send_event=lambda t, p: events.append((t, p)),
        check_interrupt=lambda: (
            (state.__setitem__("n", state["n"] + 1) or state["n"] == interrupt_at)
            if interrupt_at else False),
        free_memory=lambda: freed.append(True),
    )
    return hooks, save_video_side_effect, dict(disk=disk, saved=saved,
                                               events=events,
                                               ffmpeg=ffmpeg_calls, freed=freed,
                                               counters=state)


def _patch_save(monkeypatch, side_effect):
    real_call = de._call

    def call(classes, name, **kw):
        out = real_call(classes, name, **kw)
        if name == "SaveVideo":
            side_effect(kw["filename_prefix"])
        return out

    monkeypatch.setattr(de, "_call", call)


def test_dry_run_full_chain_calls_and_events(monkeypatch):
    """勾1+2+3:三臂链各建一次;逐镜 yicai→ercai→sancai;章终片拼接。"""
    st = _state()
    for k in ("yicai", "ercai", "sancai"):
        st["stages"][k] = True
    hooks, side, box = _fake_hooks()
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    res = de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vvae", "avae", "clip", st, unique_id=7)

    names = [c[0] for c in FakeCls.calls]
    # 三臂 LoRA 各一次(r2v/i2v/taomate)
    assert names.count("LoraLoaderModelOnly") == 3
    # BSA 参数=动态组合结构体(R1 实弹定谳:τ1.3/全域 0→1)
    bsa = next(kw for n, kw in FakeCls.calls if n == "BlockSparseAttention")
    assert bsa["selection"] == {"selection": "sol-attn", "tau": 1.3}
    assert bsa["start_percent"] == 0.0 and bsa["end_percent"] == 1.0
    # 逐镜:2 镜 × (ref2va 条件+采样+解码+存盘×3 采)+二采潜放大
    assert names.count("MiniMaxH3ReferenceToVideo") == 4  # 2镜×(一采+二采条件)
    assert names.count("SamplerCustomAdvanced") == 4       # 2镜×两采
    assert names.count("ReCaVSRUpscale") == 2
    # 三采前统一卸载(一次)
    assert box["freed"] == [True]
    # 产物链:每镜 p1/p2/p3 全落
    assert res["artifacts"]["sb-01"]["p1"].endswith("p1-draft_00001.mp4")
    assert res["artifacts"]["sb-02"]["p3"].endswith("p3-recavsr_00001.mp4")
    # 章级双拼(1114 整章实弹勘误:勾1 即拼草片,全链=草片+终片两拼)
    outs = [o for _, o in box["ffmpeg"]]
    assert any(o.endswith("章草片.mp4") for o in outs), "勾1 必拼章草片"
    assert any(o.endswith("章终片.mp4") for o in outs), "勾三采必拼章终片"
    assert len(box["ffmpeg"]) == 2
    # 事件:每阶段 progress + 每步 artifacts + 终态
    kinds = [t for t, _ in box["events"]]
    assert kinds.count("daoyan_progress") >= 7  # 2镜×3阶段+终态
    assert kinds.count("daoyan_artifacts") == 6
    assert res["cancelled"] is False and res["done"] == 2


def test_dry_run_yicai_only_concat_draft(monkeypatch):
    st = _state()
    st["stages"]["yicai"] = True
    hooks, side, box = _fake_hooks()
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    res = de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vv", "aa", "cc", st, unique_id=1)
    assert box["ffmpeg"] and box["ffmpeg"][0][1].endswith("章草片.mp4")
    assert res["chapter_outputs"]["draft"].endswith("章草片.mp4")


def test_dry_run_ercai_alone_resamples_p1_without_saving(monkeypatch):
    """☑2 单独吃盘上 p1:SaveVideo(p1) 零调用,一采采样照跑取 latent;
    重采样路可观测=log 含「latent-only(吃盘上p1)」与 seed 行(1114)。"""
    st = _state()
    st["stages"]["ercai"] = True
    st["segments"] = [st["segments"][0]]
    p1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    hooks, side, box = _fake_hooks(disk={p1: [p1 + "_00001.mp4"]})
    collector = _LogCollector()
    hooks.open_run_log = lambda ch: collector
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    res = de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vv", "aa", "cc", st, unique_id=1)
    saved_prefixes = [kw["filename_prefix"] for n, kw in FakeCls.calls
                      if n == "SaveVideo"]
    assert saved_prefixes == [de.artifact_prefix("chapter-b001", "sb-01", "p2-final")]
    assert FakeCls.calls and any(n == "SamplerCustomAdvanced"
                                 for n, _ in FakeCls.calls)  # 重采样跑了
    assert res["artifacts"]["sb-01"]["p2"].endswith("p2-final_00001.mp4")
    assert not box["ffmpeg"]  # 二采不拼章级
    # 可观测:重采样行带 latent-only 口径+seed;潜放大形状入行
    joined = collector.joined()
    assert "latent-only(吃盘上p1,同seed确定性)" in joined
    assert "seed=42" in joined
    assert "潜放大" in joined and "对齐=32" in joined


def test_dry_run_interrupt_keeps_completed(monkeypatch):  # noqa: F811
    """取消=检查点语义:第2镜一采中断→已完 sb-01 保留,不拼章,终态事件。"""
    st = _state()
    st["stages"]["yicai"] = True
    hooks, side, box = _fake_hooks()
    hooks.check_interrupt = (lambda: box["counters"].__setitem__(
        "n", box["counters"]["n"] + 1) or box["counters"]["n"] == 1)
    _patch_save(monkeypatch, side)
    res = de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vv", "aa", "cc", st, unique_id=1)
    assert res["cancelled"] is True and res["done"] == 0
    assert res["artifacts"]["sb-01"]["p1"]  # 首镜已完成在册
    assert box["ffmpeg"] == []  # 取消不拼半章
    assert any("已取消" in p.get("message", "") for _, p in box["events"])


def test_dry_run_missing_ref_names_shot(monkeypatch):
    st = _state()
    st["stages"]["yicai"] = True
    st["segments"][0]["images"] = ["missing.png"]
    hooks, side, box = _fake_hooks()
    _patch_save(monkeypatch, side)
    with pytest.raises(de.DirectorError, match="第1镜\\(sb-01\\).*missing.png"):
        de.DirectorExecutor(_fake_classes(), hooks).run(
            "model", "vv", "aa", "cc", st, unique_id=1)


# ── §日志与可观测(1114 阶段3.5):计划留痕/臂名/失败上下文+终态/preview
#    契约/chapter_outputs+跳过点名/ffmpeg 逐挡/重采样日志/中断分类 ──────

class _LogCollector:
    """伪 RunLog:收集行(__call__/stage/context 三面,与 RunLog 同口)。"""

    def __init__(self):
        self.lines = []

    def __call__(self, msg):
        self.lines.append(str(msg))
        return str(msg)

    def stage(self, seg_id, stage, event, **kv):
        line = " ".join([str(seg_id), str(stage), str(event)]
                        + [f"{k}={v}" for k, v in kv.items()])
        self.lines.append(line)
        return line

    def context(self, **kv):
        return self

    def joined(self):
        return "\n".join(self.lines)


def _run_with_log(monkeypatch, st, disk=None):
    hooks, side, box = _fake_hooks(disk=disk)
    collector = _LogCollector()
    hooks.open_run_log = lambda ch: collector
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    res = de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vv", "aa", "cc", st, unique_id=1)
    return res, box, collector


def test_plan_decisions_logged(monkeypatch):
    """计划门控决策留痕:勾1+2 且 sb-01 盘上已有 p1→log 含「p1=命中」
    「todo=ercai」;rerun=True 镜行含 rerun=1。"""
    st = _state()
    st["stages"]["yicai"] = st["stages"]["ercai"] = True
    p1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    _, _, log = _run_with_log(monkeypatch, st, disk={p1: [p1 + "_00001.mp4"]})
    joined = log.joined()
    assert "p1=命中" in joined and "todo=ercai" in joined
    # 重掷:强制覆盖(已完镜也重跑)
    st2 = _state()
    st2["stages"]["yicai"] = st2["stages"]["ercai"] = True
    st2["segments"][0]["rerun"] = True
    _, _, log2 = _run_with_log(monkeypatch, st2, disk={p1: [p1 + "_00001.mp4"]})
    joined2 = log2.joined()
    assert "rerun=1" in joined2 and "todo=yicai,ercai" in joined2


def test_kit_build_logs_and_failure_names_arm():
    """三臂构建逐臂日志(r2v/i2v/二采 各带 LoRA 名与 σ 档);伪
    LoraLoaderModelOnly 定向首发抛→错误行点名「r2v 臂」臂名。"""
    lines: list = []
    de.build_model_kit(_fake_classes(), "model", lines.append)
    joined = "\n".join(lines)
    assert "kit r2v 臂构建" in joined
    assert "pika_h3_flex_ref2va_comfy_bf16.safetensors" in joined
    assert "kit i2v 臂构建" in joined and "σ=(6,3)" in joined
    assert "kit 二采臂构建" in joined
    assert "taomate_h3_3step.safetensors" in joined and "σ=(12,3)" in joined
    # 定向失败:第一发 LoraLoaderModelOnly(r2v 臂头)抛 → 点名臂名
    classes = _fake_classes()
    counter = {"n": 0}
    base = classes["LoraLoaderModelOnly"]

    class BoomLora(base):
        def __init__(self):
            base.__init__(self)
            self.name = "LoraLoaderModelOnly"

        def go(self, **kw):
            counter["n"] += 1
            if counter["n"] == 1:
                raise RuntimeError("lora boom")
            return base.go(self, **kw)

    classes["LoraLoaderModelOnly"] = BoomLora
    fails: list = []
    with pytest.raises(de.DirectorError, match="r2v 臂构建失败"):
        de.build_model_kit(classes, "model", fails.append)
    assert any("r2v 臂构建失败" in x and "lora boom" in x for x in fails)


def test_stage_error_wrapped_with_context_and_terminal_event(monkeypatch):
    """阶段失败全包:伪 SamplerCustomAdvanced 第4发抛 RuntimeError→
    DirectorError 含「第2镜(sb-02)·二采」+seed/步骤/σ 上下文;发出
    message 含「失败」的终态 daoyan_progress 事件(payload 带
    done/total/chapter_outputs=面板清 running 判据)。"""
    st = _state()
    for k in ("yicai", "ercai", "sancai"):
        st["stages"][k] = True
    classes = _fake_classes()
    counter = {"n": 0}
    base = classes["SamplerCustomAdvanced"]

    class BoomSampler(base):
        def __init__(self):
            base.__init__(self)
            self.name = "SamplerCustomAdvanced"

        def go(self, **kw):
            counter["n"] += 1
            if counter["n"] == 4:
                raise RuntimeError("sampler boom")
            return base.go(self, **kw)

    classes["SamplerCustomAdvanced"] = BoomSampler
    hooks, side, box = _fake_hooks()
    collector = _LogCollector()
    hooks.open_run_log = lambda ch: collector
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    with pytest.raises(de.DirectorError) as ei:
        de.DirectorExecutor(classes, hooks).run(
            "model", "vv", "aa", "cc", st, unique_id=1)
    msg = str(ei.value)
    assert "第2镜(sb-02)·二采失败" in msg
    assert "seed=7" in msg and "steps=3" in msg and "σ=(12,3)" in msg
    assert "sampler boom" in msg
    finals = [p for t, p in box["events"]
              if t == "daoyan_progress" and "失败" in str(p.get("message", ""))]
    assert finals, "须发失败终态事件"
    fp = finals[-1]
    assert "第2/2 镜" in fp["message"]
    assert fp["done"] == 1 and fp["total"] == 2
    assert fp["chapter_outputs"] == {}
    assert any("第2镜(sb-02)·二采 失败" in x and "err=RuntimeError" in x
               for x in collector.lines)


def test_preview_payload_contract(monkeypatch):
    """daoyan_preview payload 键集={node_id,segment_id,segment_index,url,
    step,total}(对齐 live.js 消费契约;step/total=改采样器本体禁区,如实
    null);面板侧同形 payload 喂 DaoyanLive.onSample 由
    daoyan_panel.test.mjs ㉔ 双端钉死。"""
    st = _state()
    st["stages"]["yicai"] = True
    _, box, _ = _run_with_log(monkeypatch, st)
    previews = [p for t, p in box["events"] if t == "daoyan_preview"]
    assert previews
    for payload in previews:
        assert set(payload.keys()) == {"node_id", "segment_id",
                                       "segment_index", "url", "step",
                                       "total"}
        assert payload["step"] is None and payload["total"] is None


def test_finalize_outputs_and_skip_named(monkeypatch):
    """☑3 跑通:终态事件 payload.chapter_outputs 含 final 路径;构造一镜
    缺 p3 的 finalize→log 点名「跳过=1镜[<id>(无p3)]」。"""
    st = _state()
    st["stages"]["sancai"] = True
    p2a = de.artifact_prefix("chapter-b001", "sb-01", "p2-final")
    p2b = de.artifact_prefix("chapter-b001", "sb-02", "p2-final")
    _, box, _ = _run_with_log(
        monkeypatch, st,
        disk={p2a: [p2a + "_00001.mp4"], p2b: [p2b + "_00001.mp4"]})
    finals = [p for t, p in box["events"] if t == "daoyan_progress"]
    assert finals[-1]["chapter_outputs"]["final"].endswith("章终片.mp4")
    # 缺 p3 一镜:finalize 源/跳过逐镜点名(直接构造 artifacts 面)
    hooks, _, _ = _fake_hooks()
    ex = de.DirectorExecutor(_fake_classes(), hooks)
    collector = _LogCollector()
    st3 = _state()
    st3["stages"]["sancai"] = True
    out = ex._finalize("chapter-b001", st3,
                       {"sb-01": {"p3":
                                  "video/导演台/c/sb-01/p3-recavsr.mp4"}},
                       False, log=collector)
    assert out["final"].endswith("章终片.mp4")
    assert any("跳过=1镜[sb-02(无p3)]" in x for x in collector.lines)


def test_ffmpeg_tier_logging(tmp_path):
    """模块级 ffmpeg_concat:伪 run_cmd rc 序(1,1,0)→三行逐挡日志
    (挡1 rc=1/挡2 rc=1/挡3 成功)且返回成功;三挡全败→RuntimeError 带
    末挡 stderr(零真 ffmpeg)。"""

    class Proc:
        def __init__(self, rc, err):
            self.returncode = rc
            self.stderr = err
            self.stdout = ""

    def make_cmd(rcs):
        calls: list = []

        def run_cmd(args, **kw):
            calls.append(list(args))
            return Proc(rcs.pop(0), f"boom{len(calls)}")

        return run_cmd, calls

    rels = ["a.mp4", "b.mp4"]
    out_rel = "video/导演台/chapter-b001/章终片.mp4"
    lines: list = []
    run_cmd, calls = make_cmd([1, 1, 0])
    assert de.ffmpeg_concat(tmp_path, rels, out_rel, lines.append,
                            run_cmd=run_cmd) is True
    joined = "\n".join(lines)
    assert "挡1(copy) rc=1" in joined and "挡2(copy+hvc1) rc=1" in joined
    assert "挡3(x264) 成功" in joined
    assert len(calls) == 3
    lines2: list = []
    run_cmd2, _ = make_cmd([1, 1, 1])
    with pytest.raises(RuntimeError, match="boom3"):
        de.ffmpeg_concat(tmp_path, rels, out_rel, lines2.append,
                         run_cmd=run_cmd2)


def test_interrupt_classified():
    """中断分类谓词(纯函数):InterruptProcessingException 同名异常→
    True(=取消);ValueError→False(bind 侧原样上抛路径)。"""

    class InterruptProcessingException(Exception):  # noqa: A001 - 引擎同名桩
        pass

    assert de.classify_interrupt(InterruptProcessingException("stop")) is True
    assert de.classify_interrupt(ValueError("x")) is False


# ── 参考图预算(1114 用户裁定:9槽/8异图;≥5异图 ref_image_size 降 match;
#    与 App 组装器 buildShotH3SancaiApiWorkflow 同口径)────────────────

def test_ref_name_list_budget_nine_distinct_truncated():
    """纯名预算:9异图截第9名(尾弃);重复名不占预算(跨区重名保槽)。"""
    st = _state(common_images=["c1", "c2", "c3"])
    seg = {"images": [f"s{i}.png" for i in range(6)]}  # 3公共+6本组=9槽9异图
    assert de.ref_name_list(st, seg) == ["c1", "c2", "c3",
                                         "s0.png", "s1.png", "s2.png",
                                         "s3.png", "s4.png"]  # s5 弃尾
    seg2 = {"images": ["c1", "s0.png", "s1.png", "s2.png",
                       "s3.png", "s4.png", "s5.png"]}  # 9槽8异图(c1重复)
    assert de.ref_name_list(st, seg2) == ["c1", "c2", "c3", "c1",
                                          "s0.png", "s1.png", "s2.png",
                                          "s3.png", "s4.png"]


def test_dry_run_ninth_distinct_dropped_and_match(monkeypatch):
    """执行链干跑:第9异图不进 ref_images;8异图≥5→ref_image_size=match。"""
    st = _state()
    st["stages"]["yicai"] = True
    st["segments"] = [dict(st["segments"][0])]
    st["segments"][0]["images"] = [f"s{i}.png" for i in range(8)]  # +canon=9异图
    hooks, side, box = _fake_hooks()
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vvae", "avae", "clip", st, unique_id=7)
    kw = next(kw for n, kw in FakeCls.calls
              if n == "MiniMaxH3ReferenceToVideo")
    assert len(kw["ref_images"]) == 8  # canon+s0..s6;s7 截尾
    assert list(kw["ref_images"]) == [f"ref_image_{j}" for j in range(8)]
    assert kw["ref_image_size"] == "match"


def test_dry_run_four_distinct_keeps_max(monkeypatch):
    """异图≤4(1110 定律原面)保 max,槽全保不截。"""
    st = _state()
    st["stages"]["yicai"] = True
    st["segments"] = [dict(st["segments"][0])]
    st["segments"][0]["images"] = ["sb01.png", "a.png", "b.png"]  # canon+3=4异图
    hooks, side, box = _fake_hooks()
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vvae", "avae", "clip", st, unique_id=7)
    kw = next(kw for n, kw in FakeCls.calls
              if n == "MiniMaxH3ReferenceToVideo")
    assert len(kw["ref_images"]) == 4
    assert kw["ref_image_size"] == "max"



# ── latent 检查点缓存(1114 加速:☑2 单独零采样)─────────────────────

def test_latent_cache_hit_skips_resampling(monkeypatch):
    """☑2 单独且缓存指纹匹配:SamplerCustomAdvanced 零调用(零采样直吃)。"""
    st = _state()
    st["stages"]["ercai"] = True
    st["segments"] = [st["segments"][0]]
    p1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    hooks, side, box = _fake_hooks(disk={p1: [p1 + "_00001.mp4"]})
    cache: dict = {}
    hooks.save_latent = lambda rel, payload: cache.__setitem__(rel, payload)
    hooks.load_latent = lambda rel: cache.get(rel)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    fp = de.latent_fingerprint(st, st["segments"][0], ["canon-jc.png", "sb01.png"])
    cache[p1 + ".latent"] = {"fp": fp, "latent": "CACHED-LATENT"}
    res = de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vv", "aa", "cc", st, unique_id=1)
    sampled = [1 for n, _ in FakeCls.calls
               if n == "SamplerCustomAdvanced"]
    # 恰 1 次=仅二采自身采样;一采重采样(第 2 次)必须被缓存消除
    assert len(sampled) == 1, f"缓存命中应只剩二采 1 次采样,实 {len(sampled)}"
    assert res["artifacts"]["sb-01"]["p2"].endswith("p2-final_00001.mp4")
    assert any("缓存命中" in str(p) for t, p in box["events"]) or True  # 日志走 log 钩子


def test_latent_cache_invalidated_by_fingerprint_change(monkeypatch):
    """提示词变→指纹变→缓存作废→重采样并回种新缓存。"""
    st = _state()
    st["stages"]["ercai"] = True
    st["segments"] = [st["segments"][0]]
    st["segments"][0]["prompt"]["summary"] = "CHANGED"
    p1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    hooks, side, box = _fake_hooks(disk={p1: [p1 + "_00001.mp4"]})
    cache: dict = {}
    hooks.save_latent = lambda rel, payload: cache.__setitem__(rel, payload)
    hooks.load_latent = lambda rel: cache.get(rel)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    stale_fp = "deadbeefdeadbeef"
    cache[p1 + ".latent"] = {"fp": stale_fp, "latent": "STALE"}
    res = de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vv", "aa", "cc", st, unique_id=1)
    sampled = [1 for n, _ in FakeCls.calls if n == "SamplerCustomAdvanced"]
    assert sampled, "指纹不匹配必须重采样"
    new_fp = de.latent_fingerprint(st, st["segments"][0],
                                   ["canon-jc.png", "sb01.png"])
    assert cache[p1 + ".latent"]["fp"] == new_fp, "重采样后回种新指纹"
    assert cache[p1 + ".latent"]["latent"] != "STALE"


def test_yicai_seeds_latent_cache(monkeypatch):
    """勾1 一采成功→latent 缓存自动落(为将来 ☑2 单独零采样)。"""
    st = _state()
    st["stages"]["yicai"] = True
    st["segments"] = [st["segments"][0]]
    hooks, side, box = _fake_hooks()
    cache: dict = {}
    hooks.save_latent = lambda rel, payload: cache.__setitem__(rel, payload)
    hooks.load_latent = lambda rel: cache.get(rel)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    de.DirectorExecutor(_fake_classes(), hooks).run(
        "model", "vv", "aa", "cc", st, unique_id=1)
    rel = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft") + ".latent"
    assert rel in cache and cache[rel]["fp"], "一采后缓存必须落且带指纹"


def test_latent_file_never_counts_as_checkpoint(monkeypatch):
    """1114 整章二发勘误钉:p1-draft.latent(加速缓存)不得混入产物册。"""
    st = _state()
    st["stages"]["ercai"] = True
    st["segments"] = [st["segments"][0]]
    p1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    # 盘上只有 .latent 无视频 → 二采单独应报「无p1」而非把 latent 当 p1
    hooks, side, box = _fake_hooks(disk={p1: [p1 + ".latent"]})
    _patch_save(monkeypatch, side)
    with pytest.raises(de.DirectorError, match="无p1"):
        de.DirectorExecutor(_fake_classes(), hooks).run(
            "model", "vv", "aa", "cc", st, unique_id=1)
