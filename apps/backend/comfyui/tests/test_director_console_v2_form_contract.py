# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台新形态件契约测试(11-13-director-console-remake 阶段2.5,1114 缺口①)。

被测对象 = apps/build/scripts/director_console_v2_generate_1114.py
(PRD R1.3:恰一条链 ≤8 节点——loader×4 → 导演台×1 → CreateVideo →
SaveVideo + 说明 Note;零组/零克隆/零多余件)。

钉值真源交叉核:生成器 widgets ↔ my_nodes DIRECTOR_RECIPE 四件套
(单源纪律:两处钉值若漂移,本测试红=防配方面出现第二真源)。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from comfyui.my_nodes.nodes import my_director_console as node_mod

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]  # apps/backend/comfyui/tests → 仓库根
GENERATOR = REPO_ROOT / "apps/build/scripts/director_console_v2_generate_1114.py"


def _generate(tmp_path: Path) -> dict:
    out = tmp_path / "导演台.json"
    proc = subprocess.run(
        [sys.executable, str(GENERATOR), "--out", str(out)],
        capture_output=True, text=True, check=True)
    assert "8 节点" in proc.stdout
    return json.loads(out.read_text(encoding="utf-8"))


def _console(graph):
    matches = [n for n in graph["nodes"] if n["type"] == "MyDirectorConsole"]
    assert len(matches) == 1
    return matches[0]


# ── 形态门:恰一条链 ≤8 节点(PRD R1.3 核心硬指标)──────────────────
def test_exactly_eight_nodes_one_chain(tmp_path):
    graph = _generate(tmp_path)
    nodes = graph["nodes"]
    assert len(nodes) <= 8, f"PRD R1.3 硬指标 ≤8 节点,实数 {len(nodes)}"
    types = sorted(n["type"] for n in nodes)
    assert types == ["CLIPLoader", "CreateVideo", "MarkdownNote",
                     "MyDirectorConsole", "SaveVideo", "UNETLoader",
                     "VAELoader", "VAELoader"]
    assert graph["groups"] == [], "零组:多镜全在面板内,画布无镜头组"


def test_links_form_single_line(tmp_path):
    graph = _generate(tmp_path)
    by_id = {n["id"]: n for n in graph["nodes"]}
    console = _console(graph)
    # 四 loader 直喂四输入口(口名与节点 INPUT_TYPES 同序,各占各槽)
    in_links = {i["name"]: i["link"] for i in console["inputs"]}
    port_order = ["model", "video_vae", "audio_vae", "clip"]
    assert list(in_links) == port_order
    for name, link_id in in_links.items():
        src_id, src_slot, dst_id, dst_slot, dtype = graph["links"][link_id - 1][1:]
        assert by_id[src_id]["type"] in {
            "model": "UNETLoader", "video_vae": "VAELoader",
            "audio_vae": "VAELoader", "clip": "CLIPLoader"}[name]
        assert (dst_id, dst_slot, dtype) == (
            console["id"], port_order.index(name), {
                "model": "MODEL", "video_vae": "VAE",
                "audio_vae": "VAE", "clip": "CLIP"}[name])
    # 导演台 → CreateVideo.images → SaveVideo.video(一条直线,无分叉件)
    out_link = graph["links"][console["outputs"][0]["links"][0] - 1]
    create_video = by_id[out_link[3]]
    assert create_video["type"] == "CreateVideo"
    assert out_link[5] == "IMAGE"
    cv_out = graph["links"][create_video["outputs"][0]["links"][0] - 1]
    save_video = by_id[cv_out[3]]
    assert save_video["type"] == "SaveVideo"
    assert cv_out[5] == "VIDEO"
    # 链完整性:每条 link 的两端节点/槽位实存且类型对齐
    for link in graph["links"]:
        _, src_id, src_slot, dst_id, dst_slot, dtype = link
        src_out = by_id[src_id]["outputs"][src_slot]
        dst_in = by_id[dst_id]["inputs"][dst_slot]
        assert src_out["type"] == dst_in["type"] == dtype


# ── 钉值交叉核:生成器 widgets ↔ DIRECTOR_RECIPE(防第二真源)────────
def test_loader_widgets_match_recipe(tmp_path):
    graph = _generate(tmp_path)
    widgets = {n["type"]: n["widgets_values"] for n in graph["nodes"]
               if n["type"] in ("UNETLoader", "CLIPLoader")}
    vaes = [n["widgets_values"][0] for n in graph["nodes"]
            if n["type"] == "VAELoader"]
    r = node_mod.DIRECTOR_RECIPE
    assert widgets["UNETLoader"][0] == r["unet"]
    assert widgets["CLIPLoader"][0] == r["clip"]
    assert sorted(vaes) == sorted([r["video_vae"], r["audio_vae"]])


def test_console_channel_and_outputs(tmp_path):
    console = _console(_generate(tmp_path))
    # timeline_data 单通道:默认空串(新台本空态,面板接管后写回 JSON)
    assert console["widgets_values"] == [""]
    outs = [(o["name"], o["type"]) for o in console["outputs"]]
    assert outs == [("IMAGE", "IMAGE")], "与节点 RETURN_TYPES ('IMAGE',) 对齐"


def test_note_carries_run_rules(tmp_path):
    note = next(n for n in _generate(tmp_path)["nodes"]
                if n["type"] == "MarkdownNote")
    text = note["widgets_values"][0]
    # Note103 运行法则要点入画布说明(PRD R1.2 漫影化+连带账⑤前哨)
    assert "勾啥跑啥" in text and "检查点" in text and "/free" in text


def test_deterministic_output(tmp_path):
    outs = []
    for i in range(2):
        p = tmp_path / f"run{i}.json"
        subprocess.run([sys.executable, str(GENERATOR), "--out", str(p)],
                       check=True, capture_output=True)
        outs.append(p.read_bytes())
    assert outs[0] == outs[1], "幂等生成:同参重跑字节级一致(阶段4 落件防漂移)"
