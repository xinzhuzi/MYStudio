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
            {"id": "sb-02", "mode": "r2v", "seconds": 4, "frames": 107,
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
    # BSA 参数=母本位序映射
    bsa = next(kw for n, kw in FakeCls.calls if n == "BlockSparseAttention")
    assert bsa["selection"] == "sol-attn" and bsa["start_percent"] == 1.3
    # 逐镜:2 镜 × (ref2va 条件+采样+解码+存盘×3 采)+二采潜放大
    assert names.count("MiniMaxH3ReferenceToVideo") == 4  # 2镜×(一采+二采条件)
    assert names.count("SamplerCustomAdvanced") == 4       # 2镜×两采
    assert names.count("ReCaVSRUpscale") == 2
    # 三采前统一卸载(一次)
    assert box["freed"] == [True]
    # 产物链:每镜 p1/p2/p3 全落
    assert res["artifacts"]["sb-01"]["p1"].endswith("p1-draft_00001.mp4")
    assert res["artifacts"]["sb-02"]["p3"].endswith("p3-recavsr_00001.mp4")
    # 章终片拼接(勾含三采):p3×2 入 ffmpeg;勾1+三采→不拼草片
    assert box["ffmpeg"] and box["ffmpeg"][0][1].endswith("章终片.mp4")
    assert len(box["ffmpeg"][0][0]) == 2
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
    """☑2 单独吃盘上 p1:SaveVideo(p1) 零调用,一采采样照跑取 latent。"""
    st = _state()
    st["stages"]["ercai"] = True
    st["segments"] = [st["segments"][0]]
    p1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    hooks, side, box = _fake_hooks(disk={p1: [p1 + "_00001.mp4"]})
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
