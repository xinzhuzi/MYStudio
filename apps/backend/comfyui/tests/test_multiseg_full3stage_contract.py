"""一镜到底-分段 全链三采契约测试(11-14-multiseg-full-3stage)。

被测对象 = 仓库真源 `2_视频/H3视频/1_漫影自研/一镜到底-分段.json`
(1114 用户裁定「都过三采」:分段生成(一采)→ TaoMate 精修(二采 1440×832)→
ReCaVSR 超分(三采 3840×2220=4K 终档,1117 默认改 4K);与 单镜.json 分工=单镜 ≤15s 高质线 /
本件任意时长全梯线)。镜像样板 test_three_stage_contract.py 模式:零引擎依赖纯静态。

契约(PRD R2 七件):
  ① 新锚(3071/4003/3030/3031)在位;p1 五节点(6/2/102/36/4)接线不变+101.slot0 双扇出保留
  ② 二采配方逐值(3002 九元组/1021 taomate@0.7/3041 simple-3-0.2/3021 [12,3]/3022 lcm/
     3031 1440-832-56-match)
  ③ 101.slot1→3001;音轨直通;3043 五口喂源;模型链 34→1021→1033→3011→3021 双扇出→3041/3044→3042
  ④ 单源扇出:UNETLoader 全图唯一(34)扇出 {41,1021};KSamplerSelect/RandomNoise 各恰一
  ⑤ 段B 出厂旁路+内联接线(1115 实弹勘误):4001-4003 mode=4,3053→4002 直连;4002 九元组
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


def test_stage1_canonical_arm():
    """一采正典臂(1115 B3 定谳=全库 Pika 必须 lcm 的完整配对):41 turbo→1041 sol-attn τ1.3
    →1042 ChunkFFN[2]→1043 kitchen→1044 σshift[6,3](一采值,非二采[12,3])→101.model;
    101 外接 sampler←1046 lcm + sigmas←1045 simple/8(README :205 官方覆盖门)。"""
    d, nodes, links = _load()
    expect = {46: (41, 0, 1041, 0), 47: (1041, 0, 1042, 0), 48: (1042, 0, 1043, 0),
              49: (1043, 0, 1044, 0), 50: (1044, 0, 101, 0), 51: (1046, 0, 101, 5),
              52: (1044, 0, 1045, 0), 53: (1045, 0, 101, 6)}
    for lid, exp in expect.items():
        l = links.get(lid)
        assert l and (l[1], l[2], l[3], l[4]) == exp, f"一采臂 link{lid} 漂移: 期望 {exp}, 实 {l}"
    assert nodes[41]["outputs"][0]["links"] == [46], "[41] 出线应 [46](直连废除)"
    assert 2 not in links, "旧直连 link2 应不存在"
    assert nodes[1044]["widgets_values"] == [6, 3], "σshift 一采值 [6,3]"
    assert nodes[1042]["widgets_values"] == [2, 4096], "ChunkFFN [2,4096](照抄 i2v 臂)"
    assert nodes[1046]["widgets_values"] == ["lcm"], "一采采样器=lcm(Pika 必须 lcm)"
    assert nodes[1045]["widgets_values"] == ["simple", 8, 1.0]
    assert nodes[1041]["widgets_values"][1] == 1.3, "sol-attn τ1.3"
    assert nodes[101]["widgets_values"][4] == "euler", "内置 euler 留作 widget 展示位(被外接覆盖,README :205)"


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
    assert nodes[3011]["widgets_values"] == [2, 4096], "ChunkFFN 1118 激活(chunks 1→2,削峰)"
    assert nodes[3021]["widgets_values"] == [12, 3]
    assert nodes[3022]["widgets_values"] == ["lcm"], "TaoMate 二采必须 LCM(雷#1)"
    assert nodes[3041]["widgets_values"] == ["simple", 3, 0.2]
    assert nodes[3044]["widgets_values"] == ["comfy kitchen attention"]
    assert nodes[3040]["widgets_values"] == [42, "fixed"]
    w = nodes[3031]["widgets_values"]
    assert w[1:3] == [1440, 832], "二采目标 1440×832"
    assert w[3] == 56, "出厂 length=56(帧数公式 2×1秒,雷#13)"
    assert w[4] == "match", "零参考 ref_image_size 出厂 match(注:单镜用 max 是其参考图在役语境)"
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
    assert nodes[1066]["type"] == "MiniMaxLowVRAMAttention", "1118 削峰:统一底模后先过 LowVRAM 头分块"
    assert nodes[1066]["widgets_values"] == [2], "head_chunks=2"
    assert src_of(1066, 0) == (34, 0), "34→1066(LowVRAM)三扇出前插桩(1118)"
    assert src_of(1021, 0) == (1066, 0), "二采支从 [1066] 分叉(不新增 UNETLoader)"
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
    """单源扇出:UNETLoader 全图唯一(34)扇出 {41,1021,5006}(1118 修脸臂复用 34,禁第二 loader);
    KSamplerSelect/RandomNoise 正片各恰一(1046/3022/3040)+ 修脸臂自带 5017/5016(seed 42 同 3040)。"""
    d, nodes, _ = _load()
    unets = [n for n in nodes.values() if n["type"] == "UNETLoader"]
    assert len(unets) == 1 and unets[0]["id"] == 34, "底模恒单源(Cobijada 一件双能)"
    fed = {l[3] for l in d["links"] if l[1] == 34 and l[5] == "MODEL"}
    assert fed == {1066}, "[34]→[1066]LowVRAM 单下家(1118 lowvram 插桩)"
    fan = {l[3] for l in d["links"] if l[1] == 1066 and l[5] == "MODEL"}
    assert fan == {41, 1021, 5006}, "[1066] 扇出一采 pika 臂 + 二采 taomate 臂 + 四采修脸臂"
    ksel = sorted((n for n in nodes.values() if n["type"] == "KSamplerSelect"), key=lambda n: n["id"])
    assert [n["id"] for n in ksel] == [1046, 3022, 5017], \
        "KSamplerSelect 三枚(1115 正典臂:一采 1046 + 二采 3022,均 lcm;1118 修脸臂 5017 同 lcm)"
    noise = {n["id"]: n["widgets_values"] for n in nodes.values() if n["type"] == "RandomNoise"}
    assert sorted(noise) == [3040, 5016] and noise[5016] == noise[3040] == [42, "fixed"], \
        "RandomNoise 正片 3040 恰一 + 修脸臂 5016(seed 42 同源)"
    # VAE 视频单源(7)扇出 101/6/3031/3051+修脸 5012/5013/5021;音频 VAE 单源(13)扇出 101/2/3031/3052+修脸 5012/5014
    fed7 = {l[3] for l in d["links"] if l[1] == 7 and l[5] == "VAE"}
    assert fed7 == {101, 6, 3031, 3051, 5012, 5013, 5021}, f"[7] 扇出漂移: {fed7}"
    fed13 = {l[3] for l in d["links"] if l[1] == 13 and l[5] == "VAE"}
    assert fed13 == {101, 2, 3031, 3052, 5012, 5014}, f"[13] 扇出漂移: {fed13}"


def test_stage3_inline_factory():
    """段B 出厂旁路+内联接线(1115 实弹勘误终态):三节点 mode=4,3053→4002 直连保留
    (两步法手册:整图直跑出 p1/p2→激活段B 选中局部执行=缓存复用;整图一发含段B=引擎崩,禁);
    4002 九元组逐值;p3 前缀。API 两发拆链由 extend.py build_stageB_api 合成 300 LoadVideo。"""
    d, nodes, links = _load()
    assert 4000 not in nodes, "[4000] LoadVideo 应不存在(1115 内联正典)"
    for nid, ntype in ((4001, "ReCaVSRLoader"),
                       (4002, "ReCaVSRUpscale"), (4003, "SaveVideo")):
        assert nodes[nid]["type"] == ntype, f"[{nid}] 应为 {ntype}"
        assert nodes[nid]["mode"] == 4, f"[{nid}] 出厂应旁路(1115 实弹勘误:整图一发含段B=引擎崩,两步法)"
    l44 = links.get(44)
    assert l44 and (l44[1], l44[2], l44[3], l44[4]) == (3053, 0, 4002, 1), \
        "link44 应 3053.0→4002.1(内联直喂)"
    fan_targets = {l[3] for l in d["links"] if l[1] == 3053}
    assert {3071, 4002, 5002, 5100} <= fan_targets, \
        "[3053] 扇出应含 3071/4002/5002(拆帧)/5100(终档直通臂)(语义断言,1118 追踪参数同步役改)"
    assert nodes[4001]["widgets_values"] == ["transformer_int8_convrot.safetensors"]
    assert nodes[4002]["widgets_values"] == [2.667, "none", 42, "fixed", "flashdecoder",
                                             "fast", False, "auto", 30], "4002 九元组逐值(1117 三采默认 4K:scale2.667→3840×2220)"
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
    assert d["last_node_id"] == 9999 and d["last_link_id"] == max(l[0] for l in d["links"]), \
        "计数器对齐最大链号(node 计数含 README 9999;语义断言,1118 追踪参数同步役改)"


def test_groups_five_bands():
    """五组横排(①加载模型 ②一采分段 ③一采直出 ④二采精修 ⑤三采超分):
    两两不交、罩全(MarkdownNote 豁免)、尺寸非正=退化红线。"""
    d, nodes, _ = _load()
    gs = d["groups"]
    assert len(gs) == 8, "八组横排(1115 六组 + 1118 修脸组两只:四采修脸组/终档组)"
    titles = "".join(g["title"] for g in gs)
    for kw in ("加载模型", "一采分段", "一采直出", "二采精修", "三采超分", "四采修脸组", "终档组"):
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


def test_facerefine_group_inline_bypass():
    """四采修脸组(1118 内置·默认旁路;生成器 multiseg_inline_facerefine_build_1118.py):
    开关默认 False / 5006 复用 34 / 5012 宽高=5011 出口联线 / length 与 3031 同源同值 /
    5100 极性 on_true=修脸·on_false=3053 直通 / 组框罩全。"""
    d, nodes, links = _load()
    OWN = {25: "PrimitiveStringMultiline", 1065: "PrimitiveBoolean",
           5002: "GetVideoComponents", 5006: "LoraLoaderModelOnly",
           5011: "H3FaceTrackCrop", 5012: "MiniMaxH3ReferenceToVideo",
           5013: "H3InjectVideoLatent", 5014: "MiniMaxH3NativeAudioLock",
           5015: "H3PerFrameDenoise", 5016: "RandomNoise", 5017: "KSamplerSelect",
           5018: "BasicScheduler", 5019: "BasicGuider", 5020: "SamplerCustomAdvanced",
           5021: "VAEDecode", 5022: "H3FaceStitch", 5023: "CreateVideo",
           5100: "ComfySwitchNode", 4100: "SaveVideo"}
    for nid, ntype in OWN.items():
        assert nid in nodes and nodes[nid]["type"] == ntype, f"[{nid}] 应为 {ntype}"

    def src_of(nid, slot):
        lid = next(s["link"] for s in nodes[nid]["inputs"] if s["name"] == slot)
        l = links[lid]
        return l[1], nodes[l[1]]["outputs"][l[2]]["name"]

    assert nodes[1065]["widgets_values"] == [False], "修脸开关默认 False=旁路(50xx 臂惰性剪除)"
    assert src_of(5002, "video")[0] == 3053, "5002 拆帧源=3053(二采 p2 出片口)"
    assert src_of(5006, "model")[0] == 1066, \
        "5006 LoRA 复用唯一 UNETLoader 链(81f8909f lowvram 插桩后经 1066 头分块收束点=34 扇出之后,随迁漏笔 1118 补)"
    assert src_of(5012, "width") == (5011, "canvas_w"), "5012.width=5011.canvas_w 出口联线勿手填"
    assert src_of(5012, "height") == (5011, "canvas_h"), "5012.height=5011.canvas_h 出口联线勿手填"
    assert nodes[5012]["widgets_values"][3] == nodes[3031]["widgets_values"][3] == 56, \
        "5012.length 与 3031.length 同源同值(本件无帧数图出口,widget 同步纪律)"
    assert src_of(5100, "on_true")[0] == 5023 and src_of(5100, "on_false")[0] == 3053 \
        and src_of(5100, "switch")[0] == 1065, "5100 极性:真=修脸片/假=3053 直通(1118 双态实测定谳)"
    assert src_of(4100, "video")[0] == 5100
    assert nodes[4100]["widgets_values"][0] == "video/H3/分段视频/p-final", "p-final 终档前缀"
    assert bool(nodes[25]["widgets_values"][0].strip()), "#25 修脸身份提示词默认通用句非空"
    for nid, ntype in OWN.items():
        n = nodes[nid]
        covered = any(g["bounding"][0] <= n["pos"][0] and g["bounding"][1] <= n["pos"][1]
                      and n["pos"][0] + n["size"][0] <= g["bounding"][0] + g["bounding"][2]
                      and n["pos"][1] + n["size"][1] <= g["bounding"][1] + g["bounding"][3]
                      for g in d["groups"])
        assert covered, f"[{nid}] 修脸组节点未被组框罩全"
