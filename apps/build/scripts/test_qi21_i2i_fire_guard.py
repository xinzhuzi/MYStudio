#!/usr/bin/env python3
"""qi21_i2i_workflow_fire.py --guard 自测(1014 透明锚役 T5;PIL 合成+monkeypatch,零引擎依赖)。

覆盖:judge_png 判据边界(img_stat_1014.py:19/:23 同式:nonblack 恰 0.01=过/
amax=6=过/amax=5=黑)+guard 主循环三形态(恒黑有界重抽=guard_max+1 发、种子
两两不同、废件入 guard-rejected、exit 1/首发过=恰 1 发 exit 0/轮询恒无产物=
timeout 有界退出)。import 期零网络(引擎无关),build_graph/submit/poll_products/
download 四缝 monkeypatch 后全程不触网。
"""
import argparse
import importlib.util
import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("i2i_fire", HERE / "qi21_i2i_workflow_fire.py")
fire = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fire)


def mkpng(p, rgb=128, alpha=255, size=(64, 64), bright_px=None, alpha_top=None):
    """PIL 合成 RGBA:rgb 均值底色+bright_px 个亮像素(nonblack 边界用)+alpha 顶行覆写。"""
    a = np.zeros((size[1], size[0], 4), dtype=np.uint8)
    a[..., :3] = rgb
    a[..., 3] = alpha
    if bright_px:
        a[0, :bright_px, :3] = 255
    if alpha_top is not None:
        a[0, :, 3] = alpha_top
    Image.fromarray(a, "RGBA").save(p)
    return p


def ns(**kw):
    base = dict(guard=True, guard_max=2, guard_nonblack=0.01, guard_alpha_max=5,
                seed=None, out=None, instruction="t", type="人物海报", tier="2 · viggle",
                ref1="a.png", ref2="b.png", ref3=None,
                enable_ref3=False, enable_anchor=False,
                empty_latent=None)  # 诚实测试缝:与 argparse 缺省同值(--empty-latent 1015 役③)
    base.update(kw)
    return argparse.Namespace(**base)


# ── judge_png 判据边界(img_stat_1014 同式)──────────────────────────────
def test_judge_pure_black_is_black(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=0, alpha=255))
    assert not j["ok"] and "纯黑屏" in j["verdict"]


def test_judge_full_transparent_is_black(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=200, alpha=0))
    assert not j["ok"] and "全透明" in j["verdict"]


def test_judge_solid_pass(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=128, alpha=255))
    assert j["ok"] and j["amin"] == 255


def test_judge_mixed_alpha_pass(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=200, alpha=255, alpha_top=0))
    assert j["ok"] and j["amin"] == 0 and j["amax"] == 255  # 半透明混态=带透语义,过


def test_judge_bright_pass(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=255, alpha=255))
    assert j["ok"] and j["nonblack"] == 1.0


def test_judge_boundary_nonblack_exactly_001_pass(tmp_path):
    # 100×100 恰 100 亮像素 → nonblack==0.01,判式为 <0.01 → 恰等=过(img_stat:19 同式)
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=0, alpha=255, size=(100, 100), bright_px=100))
    assert j["nonblack"] == 0.01 and j["ok"]


def test_judge_boundary_amax6_pass(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=200, alpha=6))
    assert j["amax"] == 6 and j["ok"]  # amax<=5 才黑,:23 同式


def test_judge_boundary_amax5_black(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=200, alpha=5))
    assert j["amax"] == 5 and not j["ok"]


def test_judge_alpha_gate_off(tmp_path):
    j = fire.judge_png(mkpng(tmp_path / "a.png", rgb=200, alpha=5), 0.01, 0)
    assert j["ok"]  # guard-alpha-max 0=关


# ── guard 主循环三形态(四缝 monkeypatch,零引擎)────────────────────────
def _patch(monkeypatch, tmp_path, *, poll=None, rgb=0, alpha=255):
    """恒定缝:build_graph/submit/poll_products/download 全替;download 落合成 PNG。"""
    state = {"submits": 0, "downloads": 0, "seeds": []}

    def fake_build(args, seed):
        state["seeds"].append(seed)
        return ("2 · viggle", {"fake": True})

    def fake_submit(graph):
        state["submits"] += 1
        return f"pid-{state['submits']}"

    def fake_download(outs, outdir):
        state["downloads"] += 1
        p = mkpng(outdir / f"out{state['downloads']}.png", rgb=rgb, alpha=alpha)
        return [p]

    monkeypatch.setattr(fire, "build_graph", fake_build)
    monkeypatch.setattr(fire, "submit", fake_submit)
    monkeypatch.setattr(fire, "poll_products", poll if poll else
                        lambda pid, poll_timeout=1500, interval=10: {"8": {"images": []}})
    monkeypatch.setattr(fire, "download", fake_download)
    return state


def test_guard_all_black_bounded_refire(monkeypatch, tmp_path):
    state = _patch(monkeypatch, tmp_path, rgb=0, alpha=255)  # 恒黑
    code = fire.run_guard(ns(out=str(tmp_path)), tmp_path)
    assert code == 1
    meta = json.loads((tmp_path / "meta_guard.json").read_text(encoding="utf-8"))
    assert len(meta["attempts"]) == 2 + 1  # 总发≤guard_max+1
    assert all(a["status"] == "black" for a in meta["attempts"])
    assert meta["final"] == "black"
    seeds = [a["seed"] for a in meta["attempts"]]
    assert len(set(seeds)) == len(seeds)  # 种子两两不同(禁复用判黑种子)
    assert state["seeds"] == seeds
    rej = tmp_path / "guard-rejected"
    assert rej.is_dir() and len(list(rej.iterdir())) == 3  # 三发废件全移入
    assert not list(tmp_path.glob("out*.png"))  # 通过件才原位;黑发零残留
    assert meta["seed_policy"].startswith("首发可 --seed 固定")


def test_guard_first_fire_pass(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path, rgb=128, alpha=255)  # 恒过
    code = fire.run_guard(ns(seed=42, out=str(tmp_path)), tmp_path)
    assert code == 0
    meta = json.loads((tmp_path / "meta_guard.json").read_text(encoding="utf-8"))
    assert len(meta["attempts"]) == 1  # 首发过=恰 1 发
    assert meta["attempts"][0]["seed"] == 42 and meta["final"] == "pass"
    assert (tmp_path / "out1.png").exists()  # 通过件原位
    assert not (tmp_path / "guard-rejected").exists()


def test_guard_poll_timeout_bounded(monkeypatch, tmp_path, capsys):
    _patch(monkeypatch, tmp_path, poll=lambda pid, poll_timeout=1500, interval=10: None)  # 恒无产物
    code = fire.run_guard(ns(out=str(tmp_path)), tmp_path)
    assert code == 1
    meta = json.loads((tmp_path / "meta_guard.json").read_text(encoding="utf-8"))
    assert len(meta["attempts"]) == 3  # timeout 计入 attempts,有界
    assert all(a["status"] == "timeout" for a in meta["attempts"])
    assert meta["final"] == "timeout"
    seeds = [a["seed"] for a in meta["attempts"]]
    assert len(set(seeds)) == len(seeds)
    assert not (tmp_path / "guard-rejected").exists()  # 无产物可移
    assert "超时非黑" in capsys.readouterr().out  # 盲抽不放量终局显式归类


def test_guard_off_single_shot_black_exit1(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path, rgb=0, alpha=255)
    code = fire.run_guard(ns(guard=False, out=str(tmp_path)), tmp_path)  # --guard 关=单发不重抽
    assert code == 1
    meta = json.loads((tmp_path / "meta_guard.json").read_text(encoding="utf-8"))
    assert len(meta["attempts"]) == 1 and meta["guard_max"] == 0


def test_import_without_engine_network():
    # import 期零引擎网络:object_info 缓存恒空(填充只发生在 flatten 期 objinfo 调用)
    assert fire._objinfo == {}
