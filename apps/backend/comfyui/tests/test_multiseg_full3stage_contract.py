"""一镜到底-分段 全链三采契约测试(11-14-multiseg-full-3stage)。

被测对象 = 仓库真源 `2_视频/H3视频/1_漫影自研/一镜到底-分段.json`
(1114 用户裁定「都过三采」:分段生成(一采)→ TaoMate 精修(二采 1440×832)→
ReCaVSR 超分(三采 2880×1664 终档);与 三采-单镜.json 分工=单镜 ≤15s 高质线 /
本件任意时长全梯线)。镜像样板 test_three_stage_contract.py 模式:零引擎依赖纯静态。

契约(PRD R2 七件):
  ① 新锚(3071/4003/3030/3031)在位;p1 五节点(6/2/102/36/4)接线不变+101.slot0 双扇出保留
  ② 二采配方逐值(3002 九元组/1021 taomate@0.7/3041 simple-3-0.2/3021 [12,3]/3022 lcm/
     3031 1440-832-56-match)
  ③ 101.slot1→3001;音轨直通;3043 五口喂源;模型链 34→1021→1033→3011→3021 双扇出→3041/3044→3042
  ④ 单源扇出:UNETLoader 全图唯一(34)扇出 {41,1021};KSamplerSelect/RandomNoise 各恰一
  ⑤ 段B 内联正典(1115):4001-4003 mode=0,3053→4002 直连,零 LoadVideo;4002 九元组
  ⑥ 出厂自洽四元组:100 提示词 2×1秒/total=56/3031.length=56/3030 与 100 同文
  ⑦ 三面一致/五组横排罩全/零负区零左向(镜像样板三件)

布局口径:交叉/遮挡由 layout_check 把门(判据 `python3 .zcode/skills/node-graph/tools/layout_check.py <件>`
exit 0);本文件只钉结构判据。
"""
from __future__ import annotations

import json
from pathlib import Path

WF_DIR = Path(__file__).resolve().parents[1] / "workflows" / "2_视频" / "H3视频" / "1_漫影自研"
WF = WF_DIR / "一镜到底-分段.json"

FACTORY_PROMPT_HEAD = "段1:1秒"
P2_PREFIX = "video/H3/分段视频/p2-final"
P3_PREFIX = "video/H3/分段视频/p3-recavsr"


def _load():
    assert WF.exists(), f"工作流真源缺失: {WF}"
    d = json.loads(WF.read_text(encoding="utf-8"))
    return d, {n["id"]: n for n in d["nodes"]}, {l[0]: l for l in d["links"]}


def test_anchors_and_p1_untouched():
    """新锚在位;p1 五节点接线不变(段A 一采直出链=960×544 草稿档,links 7-14 原样);
    101.slot0 双扇出 [6]/[2] 保留(复核定谳②:slot1 接二采,p1 解码链原样)。"""
    d, nodes, links = _load()
    for nid, ntype in ((3071, "SaveVideo"), (4003, "SaveVideo"),
                       (3030, "PrimitiveStringMultiline"), (3031, "MiniMaxH3ReferenceToVideo")):
        assert nid in nodes and nodes[nid]["type"] == ntype, f"[{nid}] 应为 {ntype}"
    p1_expected = {7: (101, 0, 6, 0), 9: (101, 0, 2, 0), 8: (7, 0, 6, 1), 10: (13, 0, 2, 1),
                   11: (6, 0, 102, 0), 12: (102, 0, 36, 0), 13: (2, 0, 36, 1), 14: (36, 0, 4, 0)}
    for lid, (s, ss, t, ts) in p1_expected.items():
        l = links[lid]
        assert (l[1], l[2], l[3], l[4]) == (s, ss, t, ts), f"p1 链 link {lid} 漂移"
    assert nodes[101]["outputs"][0]["links"] == [7, 9], "[101].slot0 应双扇出 [6]/[2]"
    assert nodes[4]["widgets_values"][0] == "video/H3/分段视频", "[4] p1 前缀原样"
    assert nodes[101]["widgets_values"][1] == 42, "[101] seed=42 出厂"


def test_stage2_recipe_values():
    """二采配方逐值(UP 定谳 + 1114 嫁接快照):3002 九元组 target 1440×832 cuda /
    taomate@0.7 / sol-attn τ1.3 / σshift[12,3] / kitchen / lcm / simple-3步-dn0.2。"""
    _, nodes, _ = _load()
    assert nodes[3002]["type"] == "MinimaxH3LatentUpscaler3D"
    assert nodes[3002]["widgets_values"] == [
        "minimax_h3_latent_upscaler_3d_bf16.safetensors", "target dimensions",
        1440, 832, 32, True, True, "cuda", "fp16"], "3002 九元组逐值"
    assert nodes[1021]["widgets_values"] == ["taomate_h3_3step.safetensors", 0.7]
    assert nodes[1033]["type"] == "BlockSparseAttention"
    assert nodes[1033]["widgets_values"] == ["sol-attn", 1.3, 0, 1, "", 12288, 256,
                                             "exact_kv_and_rows", False]
    assert nodes[3011]["widgets_values"] == [1, 4096], "ChunkFFN 出厂恒等(chunks=1)"
    assert nodes[3021]["widgets_values"] == [12, 3]
    assert nodes[3022]["widgets_values"] == ["lcm"], "TaoMate 二采必须 LCM(雷#1)"
    assert nodes[3041]["widgets_values"] == ["simple", 3, 0.2]
    assert nodes[3044]["widgets_values"] == ["comfy kitchen attention"]
    assert nodes[3040]["widgets_values"] == [42, "fixed"]
    w = nodes[3031]["widgets_values"]
    assert w[1:3] == [1440, 832], "二采目标 1440×832"
    assert w[3] == 56, "出厂 length=56(帧数公式 2×1秒,雷#13)"
    assert w[4] == "match", "零参考 ref_image_size 出厂 match(注:三采-单镜用 max 是其参考图在役语境)"
    assert nodes[3053]["widgets_values"] == [24, 8, "sRGB"]
    assert nodes[3071]["widgets_values"][0] == P2_PREFIX


def test_stage2_wiring_slot1():
    """101.slot1(denoised)→3001 分离→3002 放大→3003 回拼(音轨直通不经放大)→3043.latent;
    3043 五口喂源;模型链 34→1021→1033→3011→3021 双扇出→{3041,3044}→3042。"""
    d, nodes, links = _load()

    def src_of(nid, slot):
        lid = nodes[nid]["inputs"][slot]["link"]
        assert lid is not None, f"[{nid}] 槽 {slot} 未连线"
        l = links[lid]
        return l[1], l[2]

    assert src_of(3001, 0) == (101, 1), "分离件应吃一采 denoised_output(复核定谳②)"
    assert nodes[3001]["type"] == "LTXVSeparateAVLatent"
    assert src_of(3002, 0) == (3001, 0)
    assert src_of(3003, 0) == (3002, 0)
    assert src_of(3003, 1) == (3001, 1), "音轨 latent 必须直通不经放大"
    assert nodes[3003]["type"] == "LTXVConcatAVLatent"
    assert src_of(3043, 4) == (3003, 0)
    assert src_of(3043, 0) == (3040, 0) and src_of(3043, 1) == (3042, 0)
    assert src_of(3043, 2) == (3022, 0) and src_of(3043, 3) == (3041, 0)
    assert nodes[3043]["type"] == "SamplerCustomAdvanced"
    # 模型链
    assert src_of(1021, 0) == (34, 0), "二采支从 [34] 统一底模分叉(不新增 UNETLoader)"
    assert src_of(1033, 0) == (1021, 0) and src_of(3011, 0) == (1033, 0)
    assert src_of(3021, 0) == (3011, 0)
    assert sorted(l[3] for l in d["links"] if l[1] == 3021 and l[5] == "MODEL") == [3041, 3044], \
        "[3021] 双扇出 {3041,3044}"
    assert src_of(3041, 0) == (3021, 0), "调度器必须吃 σshift 后模型(1110 σ接线定谳)"
    assert src_of(3044, 0) == (3021, 0)
    assert src_of(3042, 0) == (3044, 0) and src_of(3042, 1) == (3031, 0)
    # 3031 条件:clip/vae/audio_vae 复用 21/7/13;prompt←3030(独立原语,复核定谳⑤)
    assert src_of(3031, 0) == (21, 0) and src_of(3031, 1) == (7, 0) and src_of(3031, 2) == (13, 0)
    assert src_of(3031, 3) == (3030, 0)
    # 二采解码:3043→{3051,3052}→3053→3071;VAE 复用
    assert src_of(3051, 0) == (3043, 0) and src_of(3052, 0) == (3043, 0)
    assert src_of(3051, 1) == (7, 0) and src_of(3052, 1) == (13, 0)
    assert src_of(3053, 0) == (3051, 0) and src_of(3053, 1) == (3052, 0)
    assert src_of(3071, 0) == (3053, 0)


def test_single_source_fanout():
    """单源扇出:UNETLoader 全图唯一(34)扇出 {41,1021};KSamplerSelect/RandomNoise 各恰一。"""
    d, nodes, _ = _load()
    unets = [n for n in nodes.values() if n["type"] == "UNETLoader"]
    assert len(unets) == 1 and unets[0]["id"] == 34, "底模恒单源(Cobijada 一件双能)"
    fed = {l[3] for l in d["links"] if l[1] == 34 and l[5] == "MODEL"}
    assert fed == {41, 1021}, "[34] 应扇出一采 pika 臂 + 二采 taomate 臂"
    ksel = [n for n in nodes.values() if n["type"] == "KSamplerSelect"]
    assert len(ksel) == 1 and ksel[0]["id"] == 3022, "KSamplerSelect 恰一(lcm 单源)"
    noise = [n for n in nodes.values() if n["type"] == "RandomNoise"]
    assert len(noise) == 1 and noise[0]["id"] == 3040, "RandomNoise 恰一"
    # VAE 视频单源(7)扇出 101/6/3031/3051;音频 VAE 单源(13)扇出 101/2/3031/3052
    fed7 = {l[3] for l in d["links"] if l[1] == 7 and l[5] == "VAE"}
    assert fed7 == {101, 6, 3031, 3051}, f"[7] 扇出漂移: {fed7}"
    fed13 = {l[3] for l in d["links"] if l[1] == 13 and l[5] == "VAE"}
    assert fed13 == {101, 2, 3031, 3052}, f"[13] 扇出漂移: {fed13}"


def test_stage3_inline_factory():
    """段B 内联正典(1115 用户令「都旁路太奇怪」):三节点激活,3053→4002 直连
    (UI 整图一发直出 p1/p2/p3;先例=三采-单镜 UI 件 link780);零 LoadVideo;
    4002 九元组逐值;p3 前缀。API 两发拆链由 extend.py build_stageB_api 合成 300 LoadVideo。"""
    d, nodes, links = _load()
    assert 4000 not in nodes, "[4000] LoadVideo 应不存在(1115 内联正典)"
    for nid, ntype in ((4001, "ReCaVSRLoader"),
                       (4002, "ReCaVSRUpscale"), (4003, "SaveVideo")):
        assert nodes[nid]["type"] == ntype, f"[{nid}] 应为 {ntype}"
        assert nodes[nid]["mode"] == 0, f"[{nid}] 应激活 mode=0(1115 内联正典)"
    l44 = links.get(44)
    assert l44 and (l44[1], l44[2], l44[3], l44[4]) == (3053, 0, 4002, 1), \
        "link44 应 3053.0→4002.1(内联直喂)"
    assert nodes[3053]["outputs"][0]["links"] == [42, 44], "[3053] 扇出应 [42,44]"
    assert nodes[4001]["widgets_values"] == ["transformer_int8_convrot.safetensors"]
    assert nodes[4002]["widgets_values"] == [2, "none", 42, "fixed", "flashdecoder",
                                             "fast", False, "auto", 30], "4002 九元组逐值"
    assert nodes[4003]["widgets_values"][0] == P3_PREFIX


def test_factory_selfconsistency():
    """出厂自洽四元组:100 提示词含 段1:1秒×1+段2:1秒/100.total=56/3031.length=56/
    3030 与 100 同文(雷#13/#14;帧数公式 2×1秒@24fps→[22,34]→56,复核定谳⑨)。"""
    _, nodes, _ = _load()
    w100 = nodes[100]["widgets_values"]
    assert w100[0].count(FACTORY_PROMPT_HEAD) == 1 and "段2:1秒" in w100[0]
    assert w100[8] == 56, f"100.total_frames 出厂 56,现 {w100[8]}"
    assert nodes[3031]["widgets_values"][3] == 56
    assert nodes[3030]["widgets_values"][0] == w100[0], "3030 与 100 同文(雷#14 同频约定)"


def test_links_bidirectional():
    """三面一致:inputs[].link ↔ links[] ↔ outputs[].links 零悬空(删节点未清登记即红)。"""
    d, nodes, _ = _load()
    for l in d["links"]:
        lid, s, ss, t, ts, _t = l
        assert s in nodes and t in nodes, f"link {lid} 端点悬空"
        assert nodes[t]["inputs"][ts]["link"] == lid, f"link {lid} 目标端未登记"
        assert lid in (nodes[s]["outputs"][ss].get("links") or []), f"link {lid} 源端未登记"
    link_ids = {l[0] for l in d["links"]}
    for nid, n in nodes.items():
        for o in n.get("outputs", []):
            for lid in (o.get("links") or []):
                assert lid in link_ids, f"[{nid}] 输出悬空登记 {lid}"
        for i in n.get("inputs", []):
            assert i.get("link") is None or i["link"] in link_ids, \
                f"[{nid}] 输入槽 {i['name']} 悬空登记 {i.get('link')}"
    assert d["last_node_id"] == 4003 and d["last_link_id"] == 45, "计数器(14+31 新线)"


def test_groups_five_bands():
    """五组横排(①加载模型 ②一采分段 ③一采直出 ④二采精修 ⑤三采超分):
    两两不交、罩全(MarkdownNote 豁免)、尺寸非正=退化红线。"""
    d, nodes, _ = _load()
    gs = d["groups"]
    assert len(gs) == 5, "五组横排"
    titles = "".join(g["title"] for g in gs)
    for kw in ("加载模型", "一采分段", "一采直出", "二采精修", "三采超分"):
        assert kw in titles, f"五组标题缺: {kw}"
    for g in gs:
        x, y, w, h = g["bounding"]
        assert w > 0 and h > 0, f"组[{g['title']}] 尺寸非正"
    xs = [g["bounding"][0] for g in gs]
    assert xs == sorted(xs), f"五组应横排左→右,现 x 序 {xs}"
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            a, b = gs[i]["bounding"], gs[j]["bounding"]
            ox = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
            oy = a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
            assert not (ox and oy), f"组框重叠: {gs[i]['title']} × {gs[j]['title']}"
    for nid, n in nodes.items():
        if n["type"] == "MarkdownNote":
            continue  # README 恒居组外(罩全豁免)
        nx, ny = n["pos"]
        covered = any(g["bounding"][0] <= nx and g["bounding"][1] <= ny
                      and nx < g["bounding"][0] + g["bounding"][2]
                      and ny < g["bounding"][1] + g["bounding"][3] for g in gs)
        assert covered, f"[{nid}] {n['type']} 不在任何组框内(罩全红线)"
    assert 9999 in nodes and nodes[9999]["type"] == "MarkdownNote", "README Note 在位"
    md = nodes[9999]["widgets_values"][0]
    for kw in ("两发", "同步点", "3031", "ReCaVSR"):
        assert kw in md, f"README 缺关键内容: {kw}"


def test_no_negative_no_leftward():
    """结构判据:零负区(pos≥80)+ 恒向右(target.x > origin.x)。"""
    d, nodes, _ = _load()
    for nid, n in nodes.items():
        assert n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{nid}] 负区 pos={n['pos']}"
    for l in d["links"]:
        sx = nodes[l[1]]["pos"][0]
        tx = nodes[l[3]]["pos"][0]
        assert tx > sx, f"link {l[0]} 左向线 [{l[1]}]→[{l[3]}]"
