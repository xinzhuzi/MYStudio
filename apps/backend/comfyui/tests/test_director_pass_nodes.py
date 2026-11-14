# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台三采调试薄壳测试(11-13-director-console-remake 阶段3.5,1114)。

被测对象 = my_nodes/nodes/director_pass_nodes.py:
- 注册面:三壳在 my_nodes 双表+CATEGORY 漫影/导演台+中文显示名
- 口位契约:Pass1 (VIDEO,LATENT)/Pass2 av_latent optional/Pass3 VIDEO 进出
- 伪类干跑:三壳分别落 p1-draft/p2-final/p3-recavsr;Pass2 不接
  av_latent→确定性重采样路(SamplerCustomAdvanced 先跑一采采样)
- 单源同构:同镜同参,壳节点类调用名序列=executor.run() 单镜子集
  (逐类计数一致——与导演台同一执行真源的硬证据)
复用 test_director_executor 的伪类/伪钩子/SaveVideo 盘模拟件。
"""
from __future__ import annotations

from collections import Counter

from comfyui.my_nodes.nodes import director_executor as de
from comfyui.my_nodes.nodes import director_pass_nodes as dpn
from test_director_executor import (FakeCls, _fake_classes, _fake_hooks,
                                    _patch_save, _state)

P1 = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
P2 = de.artifact_prefix("chapter-b001", "sb-01", "p2-final")
P3 = de.artifact_prefix("chapter-b001", "sb-01", "p3-recavsr")


# ── 注册面与口位契约 ─────────────────────────────────────────────────

def test_registration_in_mappings():
    import comfyui.my_nodes as root
    for key, display in (("MyDaoyanPass1", "导演台·一采单镜"),
                         ("MyDaoyanPass2", "导演台·二采单镜"),
                         ("MyDaoyanPass3", "导演台·三采单镜")):
        assert key in root.NODE_CLASS_MAPPINGS
        assert root.NODE_DISPLAY_NAME_MAPPINGS[key] == display
        assert root.NODE_CLASS_MAPPINGS[key].CATEGORY == "漫影/导演台"


def test_input_output_contract():
    p1 = dpn.MyDaoyanPass1.INPUT_TYPES()
    req = p1["required"]
    assert req["model"][0] == "MODEL" and req["video_vae"][0] == "VAE"
    assert req["audio_vae"][0] == "VAE" and req["clip"][0] == "CLIP"
    assert req["mode"][0] == ["t2v", "i2v", "fl2v", "r2v"]
    assert req["mode"][1]["default"] == "r2v"
    assert req["frames"] == ("INT", {"default": 124, "min": 5, "step": 17})
    for f in ("prompt_summary", "prompt_retention", "prompt_description",
              "prompt_soundscape"):
        assert req[f][0] == "STRING" and req[f][1]["multiline"] is True
    assert req["chapter"][1]["default"] == "chapter-debug"
    assert req["seg_id"][1]["default"] == "debug-01"
    assert p1["optional"]["ref_image"][0] == "IMAGE"
    assert dpn.MyDaoyanPass1.RETURN_TYPES == ("VIDEO", "LATENT")

    p2 = dpn.MyDaoyanPass2.INPUT_TYPES()
    assert p2["optional"]["av_latent"][0] == "LATENT"
    assert dpn.MyDaoyanPass2.RETURN_TYPES == ("VIDEO",)

    p3 = dpn.MyDaoyanPass3.INPUT_TYPES()
    req3 = p3["required"]
    assert req3["p2_video"][0] == "VIDEO"
    assert req3["color_fix"][0] == ["none", "adain", "wavelet"]
    assert dpn.MyDaoyanPass3.RETURN_TYPES == ("VIDEO",)


# ── 伪类干跑 ─────────────────────────────────────────────────────────

def _bind_fake(monkeypatch, disk=None):
    classes = _fake_classes()
    hooks, side, box = _fake_hooks(disk=disk)
    monkeypatch.setattr(dpn, "_bind_engine_hooks", lambda: (classes, hooks))
    return classes, hooks, side, box


def _saved_prefixes():
    return [kw["filename_prefix"] for n, kw in FakeCls.calls
            if n == "SaveVideo"]


def _names_count():
    return Counter(n for n, _ in FakeCls.calls)


def test_pass1_shell_saves_p1_and_returns_latent(monkeypatch):
    """Pass1.execute→SaveVideo 前缀=video/导演台/{chapter}/{seg_id}/
    p1-draft;返回 (CreateVideo 产物, av_latent)。"""
    _, _, side, _ = _bind_fake(monkeypatch)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    video, av_latent = dpn.MyDaoyanPass1().execute(
        "model", "vv", "aa", "cc", mode="r2v", frames=124, seed=42,
        prompt_summary="s", prompt_description="d",
        ref_names="canon-jc.png,sb01.png", chapter="chapter-b001",
        seg_id="sb-01")
    assert _saved_prefixes() == [P1]
    assert video == "VIDEO" and av_latent == "av_latent"


def test_pass2_shell_resamples_when_no_latent(monkeypatch):
    """Pass2 不接 av_latent→确定性重采样路(SamplerCustomAdvanced 先跑
    一采采样再跑二采,共2发);落 p2-final。"""
    classes, hooks, side, box = _bind_fake(monkeypatch)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    (video,) = dpn.MyDaoyanPass2().execute(
        "model", "vv", "aa", "cc", mode="r2v", frames=124, seed=42,
        prompt_summary="s", prompt_description="d",
        ref_names="canon-jc.png,sb01.png", chapter="chapter-b001",
        seg_id="sb-01", av_latent=None)
    assert _saved_prefixes() == [P2]
    assert video == "VIDEO"
    assert _names_count()["SamplerCustomAdvanced"] == 2  # 重采样+二采


def test_pass2_shell_direct_latent_skips_resample(monkeypatch):
    """Pass2 接 av_latent(画布 Pass1 出口直连)→零重采样(单发采样)。"""
    _, _, side, _ = _bind_fake(monkeypatch)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    (video,) = dpn.MyDaoyanPass2().execute(
        "model", "vv", "aa", "cc", mode="r2v", frames=124, seed=42,
        prompt_summary="s", prompt_description="d",
        ref_names="canon-jc.png,sb01.png", chapter="chapter-b001",
        seg_id="sb-01", av_latent="av-from-pass1")
    assert _saved_prefixes() == [P2]
    assert _names_count()["SamplerCustomAdvanced"] == 1


def test_pass3_shell_canvas_video(monkeypatch):
    """Pass3 伪 VIDEO 直喂→ReCaVSRUpscale 吃画布视频,color_fix/seed 透传;
    落 p3-recavsr。"""
    _, _, side, _ = _bind_fake(monkeypatch)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    (video,) = dpn.MyDaoyanPass3().execute(
        p2_video="vid:p2.mp4", color_fix="adain", seed=7,
        chapter="chapter-b001", seg_id="sb-01")
    assert _saved_prefixes() == [P3]
    assert video == "VIDEO3"
    kw = next(kw for n, kw in FakeCls.calls if n == "ReCaVSRUpscale")
    assert kw["color_fix"] == "adain" and kw["seed"] == 7
    assert kw["video"] == "vid:p2.mp4"


# ── 单源同构 ─────────────────────────────────────────────────────────

def test_single_source_parity(monkeypatch):
    """同镜同参:壳节点类调用名序列=executor.run() 单镜子集(逐类计数
    一致;三对:yicai 壳↔勾1、二采壳(重采样)↔勾2吃盘p1、三采壳↔勾3
    吃盘p2)。"""
    p1_disk = de.artifact_prefix("chapter-b001", "sb-01", "p1-draft")
    p2_disk = de.artifact_prefix("chapter-b001", "sb-01", "p2-final")

    def executor_run(st, disk):
        hooks, side, box = _fake_hooks(disk=disk)
        _patch_save(monkeypatch, side)
        FakeCls.calls.clear()
        de.DirectorExecutor(_fake_classes(), hooks).run(
            "model", "vv", "aa", "cc", st, unique_id=1)
        return _names_count()

    def shell_run(fn):
        _, _, side, _ = _bind_fake(monkeypatch)
        _patch_save(monkeypatch, side)
        FakeCls.calls.clear()
        fn()
        return _names_count()

    # ① 一采:勾1 单镜 ↔ Pass1 壳
    st = _state()
    st["segments"] = [dict(st["segments"][0])]
    st["stages"]["yicai"] = True
    exec_counts = executor_run(st, None)
    shell_counts = shell_run(lambda: dpn.MyDaoyanPass1().execute(
        "model", "vv", "aa", "cc", mode="r2v", frames=124, seed=42,
        prompt_summary="s", prompt_description="d",
        ref_names="canon-jc.png,sb01.png", chapter="chapter-b001",
        seg_id="sb-01"))
    assert exec_counts == shell_counts

    # ② 二采:勾2 吃盘上 p1(重采样) ↔ Pass2 壳(不接 av_latent)
    st = _state()
    st["segments"] = [dict(st["segments"][0])]
    st["stages"]["ercai"] = True
    exec_counts = executor_run(st, {p1_disk: [p1_disk + "_00001.mp4"]})
    shell_counts = shell_run(lambda: dpn.MyDaoyanPass2().execute(
        "model", "vv", "aa", "cc", mode="r2v", frames=124, seed=42,
        prompt_summary="s", prompt_description="d",
        ref_names="canon-jc.png,sb01.png", chapter="chapter-b001",
        seg_id="sb-01", av_latent=None))
    assert exec_counts == shell_counts

    # ③ 三采:勾3 吃盘上 p2(文件化交接) ↔ Pass3 壳(画布直喂)
    st = _state()
    st["segments"] = [dict(st["segments"][0])]
    st["stages"]["sancai"] = True
    exec_counts = executor_run(st, {p2_disk: [p2_disk + "_00001.mp4"]})
    shell_counts = shell_run(lambda: dpn.MyDaoyanPass3().execute(
        p2_video="vid:p2.mp4", color_fix="none", seed=42,
        chapter="chapter-b001", seg_id="sb-01"))
    assert exec_counts == shell_counts


# ── 参考图预算(1114:9槽/8异图,画布直喂张量占1名额)──────────────────

def test_pass1_shell_budgets_names_with_canvas_tensor(monkeypatch):
    """壳路径预算:画布张量占1异图名额→名预算7异图;末端口径
    ref_images=7名+张量共8槽(≤9槽/8异图),≥5异图→match。"""
    _, _, side, _ = _bind_fake(monkeypatch)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    dpn.MyDaoyanPass1().execute(
        "model", "vv", "aa", "cc", mode="r2v",
        ref_names=",".join(f"r{i}.png" for i in range(9)),
        chapter="chapter-b001", seg_id="sb-01", ref_image="TENSOR")
    kw = next(kw for n, kw in FakeCls.calls
              if n == "MiniMaxH3ReferenceToVideo")
    assert len(kw["ref_images"]) == 8  # 7名(r0..r6)+1张量
    assert kw["ref_images"]["ref_image_7"] == "TENSOR"
    assert kw["ref_image_size"] == "match"


def test_pass2_shell_budgets_names(monkeypatch):
    """Pass2 壳:9异图名→名预算截第9;8异图≥5→match。"""
    _, _, side, _ = _bind_fake(monkeypatch)
    _patch_save(monkeypatch, side)
    FakeCls.calls.clear()
    dpn.MyDaoyanPass2().execute(
        "model", "vv", "aa", "cc", mode="r2v",
        ref_names=",".join(f"r{i}.png" for i in range(9)),
        chapter="chapter-b001", seg_id="sb-01", av_latent="av-direct")
    kw = next(kw for n, kw in FakeCls.calls
              if n == "MiniMaxH3ReferenceToVideo")
    assert len(kw["ref_images"]) == 8
    assert kw["ref_image_size"] == "match"
