"""道劫三段链工作流契约测试(11-05-daojie-h3-three-stage)。

被测对象 = 仓库真源 `2_视频/H3视频/1_漫影自研/三采-单镜.json`
(1111 用户裁定换防主线:三采主力 RelayVSR→ReCaVSR;1112 用户裁定复名:自研件不用外来技术名,
挑战臂役暂名 三采-recavsr-单镜.json 复名回 三采-单镜.json;旧 RelayVSR 版主线退役件
三采-单镜-RelayVSR-1110.json(1112 吸收归档撤域后与主线同住 0_单镜视频);克隆血统=1110 主线终名(更早 pika-单镜视频-三段链),
fork pika-单镜视频-ref2v.json 出生)(GUI 格式)。

三段契约:
  ① 一阶段采样 = 现役 ref2v 主力线原样(ref2va int8 pruned + Pika turbo 8step HD @1.0
     + lcm + BasicScheduler(simple,8) + kitchen attention),出厂档 0.52MP 960×544(1110 A/B 实测 1280 无增益,用户定 960;二采 1440×832(32 网格吸附)渐进升格,三采 RelayVSR 1920×1080)
     (1105 用户裁定;家族其余件仍 0.2MP)。
  ② 二采放大·默认终档 = UP 主黎黎原上咩配方(BV1AsxD6JEJJ 参数深挖定谳,
     对拍档 .trellis/tasks/11-05-11-05-daojie-h3-three-stage/research/UP二采参数对拍.md):
     LTXVSeparate→MinimaxH3LatentUpscaler3D(3d_bf16,target 1472×832,cuda)
     →LTXVConcat(音轨 latent 直通)→FL2VA int8 pruned+taomate@0.7+SigmaShift[12,3]
     +kitchen+lcm+BasicScheduler simple/3步/dn0.2(TaoMate 二采必须 LCM,Euler→
     片尾字幕乱码红线);[4] SaveVideo 锚移挂二采产物=默认终档(五段前缀+MyShot
     回写契约不变,组装器 buildShotRefWorkflowFromTemplate 兼容)。
  ③ 三采超分 = ReCaVSR 主线(scale2:1440×832→2880×1664,交付层归一 1080)。
     1113 手术重放(trellis 11-13-sancai-workflow-surgery-replay,自 875124ad 原版重放):
     TESSERA 38 节点整组出主线(零跨界,参数契约随独立件 7_测试/TESSERA-超分-1080p.json
     由 test_tessera_upscale_contract 把守);RelayVSR 旁路 [268][269]+监控死端 [264][265]
     删除(用户令「ReCaVSR 已稳不需要兜底」;RelayVSR 回退档=7_测试/三采-单镜-RelayVSR-1110.json
     留档);三 Note 合一为 [101] 产线速查;布局五组横排(加载模型→输入→一阶段采样→
     二采放大→三采超分),深度阶梯严格右向。

锚点契约(与 ref2v 族同构,组装器 assertH3TemplateIntegrity 对齐):
    [4] SaveVideo / [9] LoadImage(出厂 mode=4) / [14] PrimitiveStringMultiline
    / [20] PrimitiveFloat / [100] MyShot / [101] MarkdownNote 在位;
    [16] MiniMaxH3ReferenceToVideo(r2v 族锚)。

零引擎依赖纯静态。布局口径:结构判据(零负区/est 零重叠/零左向/组框两两不交)
由 layout_check 把门(交叉/遮挡现值入任务档,不入 WORKFLOW_TARGETS 棘轮——
与单镜家族全部未入闸一致)。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

WF_DIR = Path(__file__).resolve().parents[1] / "workflows" / "2_视频" / "H3视频" / "1_漫影自研"
WF = WF_DIR / "三采-单镜.json"

PIKA_SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"


def _load():
    assert WF.exists(), f"工作流真源缺失: {WF}"
    d = json.loads(WF.read_text(encoding="utf-8"))
    return d, {n["id"]: n for n in d["nodes"]}, {l[0]: l for l in d["links"]}


def test_anchors_assembler_contract():
    """组装器锚点齐全(assertH3TemplateIntegrity 对齐)+ [16] r2v 族锚;
    1113 火力扩展锚:341-344 参考卡(ref_image_5..8)/345 尾帧/346 参考视频,全 MUTED 出厂。"""
    _, nodes, _ = _load()
    for nid, ntype in ((4, "SaveVideo"), (9, "LoadImage"), (14, "PrimitiveStringMultiline"),
                       (20, "PrimitiveFloat"), (100, "MyShot"), (101, "MarkdownNote")):
        assert nodes[nid]["type"] == ntype, f"[{nid}] 应为 {ntype}"
    assert nodes[9]["mode"] == 4, "[9] 分镜帧占位出厂应旁路(mode=4)"
    for nid in (110, 111, 112, 113, 341, 342, 343, 344, 345):
        assert nodes[nid]["type"] == "LoadImage" and nodes[nid]["mode"] == 4, f"[{nid}] 参考锚应 MUTED LoadImage"
    assert nodes[346]["type"] == "LoadVideo" and nodes[346]["mode"] == 4, "[346] 参考视频锚"
    assert nodes[16]["type"] == "MiniMaxH3ReferenceToVideo", "[16] r2v 族锚"


def test_input_firepower_1113():
    """1113 火力满配(ref_image_0..8 九槽+尾帧+参考视频):
    引擎 AUTOGROW max=9 实证;三步同步连线;组装器 SANCAI_REF_IDS 八卡同构。"""
    d, nodes, links = _load()
    for dst in (16, 208):
        slots = {e["name"]: e for e in nodes[dst]["inputs"] if e["name"].startswith("ref_images.ref_image_")}
        assert len(slots) == 9, f"[{dst}] 图槽应 9(ref_image_0..8),现 {len(slots)}"
        assert all(e["link"] is not None for e in slots.values()), f"[{dst}] 有空槽"
        # 槽-源对位:0←9,1..4←110-113,5..8←341-344
        for n, src in [(0, 9), (1, 110), (2, 111), (3, 112), (4, 113), (5, 341), (6, 342), (7, 343), (8, 344)]:
            lid = slots[f"ref_images.ref_image_{n}"]["link"]
            assert links[lid][1] == src, f"[{dst}] 槽{n} 应←[{src}],实←[{links[lid][1]}]"
    lf = next(e for e in nodes[220]["inputs"] if e["name"] == "last_frame")
    assert lf["link"] is not None and links[lf["link"]][1] == 345, "[220].last_frame 应←[345] 尾帧锚"
    rv = next(e for e in nodes[16]["inputs"] if e["name"] == "ref_videos.ref_video_0")
    assert rv["link"] is not None and links[rv["link"]][1] == 347, "[16].ref_video_0 应←[347]桥(GetVideoComponents)"
    assert nodes[347]["type"] == "GetVideoComponents" and links[nodes[347]["inputs"][0]["link"]][1] == 346, \
        "[347]桥应←[346]LoadVideo(VIDEO→IMAGE 帧桥)"


def test_stage1_mainline_recipe_unchanged():
    """一阶段配方逐值:LoRA/lcm/BasicScheduler(simple,8) 自动 σ/统一底模/注意力。
    1105 用户裁定:H3 底模统一 Cobijada(hybrid 一件双能,B 发 471.5s 快过官方 fl2va 491.0s)。"""
    _, nodes, _ = _load()
    assert nodes[127]["widgets_values"][0] == "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
    assert nodes[145]["widgets_values"] == ["pika_h3_flex_ref2va_comfy_bf16.safetensors", 1]
    assert nodes[123]["widgets_values"] == ["lcm"]
    # [250] BasicScheduler(simple, 8, 1.0) 替代了旧 [147] ManualSigmas(1107 Turbo 8步)
    w250 = nodes[250]["widgets_values"]
    assert w250[0] == "simple" and w250[1] == 8 and w250[2] == 1.0, "一采 σ 源=BasicScheduler(simple,8,dn1.0)"
    assert nodes[140]["widgets_values"] == ["comfy kitchen attention"]
    assert nodes[129]["widgets_values"] == [42, "fixed"]


def test_stage1_factory_tier_052mp():
    """一采出厂档 0.52MP 960×544(1110 A/B 裁定,1280 无增益回退);帧数 124=17k+5 网格。"""
    _, nodes, _ = _load()
    assert nodes[22]["widgets_values"][1] == 0.5
    assert nodes[16]["widgets_values"][1:3] == [960, 544]
    assert nodes[220]["widgets_values"][1:3] == [960, 544], "I2V 一采分辨率同步"
    assert nodes[16]["widgets_values"][4] == "max", "参考图恒 max(1110 用户令)"
    md101 = nodes[101]["widgets_values"][0]
    assert "4096" in md101 and "图质越高视频越好" in md101, "参考图定律入 Note101(1110:超分+磨皮 4096 再入链)"
    assert nodes[16]["widgets_values"][3] == 124


def test_stage2_up_recipe():
    """二采=UP 配方逐值:upscaler 3d_bf16→1280×704 cuda / taomate@0.7 /
    fl2va int8 pruned / lcm 复用 / BasicScheduler simple/3/0.2 / SigmaShift[12,3]。"""
    _, nodes, _ = _load()
    assert nodes[206]["type"] == "MinimaxH3LatentUpscaler3D"
    w = nodes[206]["widgets_values"]
    assert w[0] == "minimax_h3_latent_upscaler_3d_bf16.safetensors"
    assert w[1:5] == ["target dimensions", 1440, 832, 32]
    assert w[5] is True and w[6] is True, "chunking/force_unload 开(Win 先例 fasth3-二采超分-2x)"
    assert w[7] == "cuda", "Win 产线引擎,device 必须 cuda(社区件出厂 mps 已勘正)"
    assert nodes[202]["widgets_values"] == ["taomate_h3_3step.safetensors", 0.7]
    assert nodes[267]["type"] == "BlockSparseAttention" and nodes[267]["mode"] == 0, "1108 二采挂 sol-attn"
    # 1105 统一改造:单 UNETLoader(Cobijada)扇出双 LoRA 臂,换装段消失(taomate@Cobijada 候实弹)
    assert nodes[209]["widgets_values"] == ["simple", 3, 0.2], "UP 定谳:simple/3步/denoise 0.2"
    assert nodes[203]["widgets_values"] == [12, 3]
    assert nodes[208]["type"] == "MiniMaxH3ReferenceToVideo"
    assert nodes[208]["widgets_values"][1:3] == [1440, 832]
    assert nodes[208]["widgets_values"][4] == "max", "二采参考图恒 max(1113 用户令「用Max」;与 [16] 同律)"
    assert nodes[211]["type"] == "SamplerCustomAdvanced"


def test_stage2_model_mainline_passes_through_chunkffn():
    """1106 E2 吸收件在位:[223] MiniMaxChunkFeedForward 恒在 MODEL 主线
    [202]taomate LoRA → [223] → [203]SigmaShift 上,出厂 chunks=1 = 源码恒等旁路
    (comfyui-kjnodes/nodes/minimax_nodes.py:69-71 原对象返回,零 clone 零 patch)。
    本例防的是"日后布局手术把 202→203 直接重焊"——test_links_bidirectional_consistency
    只验拓扑合法,不验此件存在,缺它则 E2 静默蒸发。"""
    d, nodes, links = _load()
    assert nodes[223]["type"] == "MiniMaxChunkFeedForward"
    assert nodes[223]["mode"] == 0, "旁路靠 chunks=1(恒等),不靠 mode 静默"
    assert nodes[223]["widgets_values"][0] == 1, "chunks 出厂恒 1(=上游 min)"
    assert nodes[223]["widgets_values"][1] == 4096, "seq_threshold 留节点默认"
    assert [i["name"] for i in nodes[223]["inputs"]] == ["model"], "只留 model 口,widget 走面板"
    up = links[nodes[223]["inputs"][0]["link"]]
    down_ids = nodes[223]["outputs"][0]["links"]
    assert len(down_ids) == 1, "[223] 输出恒单挂"
    down = links[down_ids[0]]
    assert (up[1], up[3], up[5]) == (267, 223, "MODEL"), "上游=[202]→[267]sol-attn→[223](1108 二采挂 sol-attn)"
    assert (down[1], down[3], down[5]) == (223, 203, "MODEL"), "下游=[203] 且走 MODEL"
    fed = {l[3] for l in d["links"] if l[1] == 202 and l[5] == "MODEL"}
    assert fed == {267}, "[202] 的 MODEL 唯一去向=[267]sol-attn→[223](1108 二采主线)"


def test_stage2_single_source_fanout_no_duplicate():
    """零真重复:[123] lcm 与 [129] 噪声单源扇出供两段采样器;VAE/TE 同源扇出;
    底模单源:[127] Cobijada 扇出 pika/taomate 双 LoRA 臂(1105 统一改造)。"""
    d, nodes, links = _load()
    unets = [n for n in nodes.values() if n["type"] == "UNETLoader" and n["id"] < 300]
    assert len(unets) == 1 and unets[0]["id"] == 127, "默认路径底模恒单源(Cobijada 统一;i2v 臂为 LoRA 分支非独立底模)"
    fed = {l[3] for l in d["links"] if l[1] == 127 and l[5] == "MODEL"}
    assert fed == {145, 202, 216}, "Cobijada 扇出三 LoRA 臂;调度器[250/209]改吃 σshift 后模型(1110 σ接线定谳,见 test_sigma_feed_scheduler_gets_shifted_model)"
    samplers = []
    for l in d["links"]:
        if l[1] == 123 and l[5] == "SAMPLER":
            samplers.append(l[3])
    assert sorted(samplers) == [125, 211], "KSamplerSelect(lcm) 应单源扇出至一采/二采"
    ksel = [n for n in nodes.values() if n["type"] == "KSamplerSelect" and n["id"] < 300]
    assert len(ksel) == 1, "一采+二采共享一个 KSamplerSelect(零真重复)"
    # 默认路径(①+②,id<300)视频 VAE 单源;1113 手术后 ≥300 仅剩 ReCaVSR 三件,
    # ③组自足 VAELoader 已随 TESSERA 整组出主线(零残留)
    vae_video = [n for n in nodes.values() if n["id"] < 300 and n["type"] == "VAELoader"
                 and "video_vae_int8" in json.dumps(n.get("widgets_values"))]
    assert len(vae_video) == 1
    vae_g3 = [n for n in nodes.values() if n["id"] >= 300 and n["type"] == "VAELoader"]
    assert not vae_g3, "≥300 段不得再有 VAELoader(TESSERA 出主线后仅 ReCaVSR 338/339/340)"


def test_anchor4_final_mounted_on_stage2():
    """[4] 锚移挂二采产物=默认终档;一采预览落 [204];[4]→[100] 回写线在。"""
    d, nodes, links = _load()
    in4 = nodes[4]["inputs"][0]["link"]
    src = links[in4]
    assert src[1] == 214 and src[2] == 0, "[4] 应吃二采 CreateVideo[214] 输出"
    assert nodes[214]["type"] == "CreateVideo"
    assert nodes[204]["type"] == "SaveVideo"
    in204 = nodes[204]["inputs"][0]["link"]
    assert links[in204][1] == 130, "[204] 一采预览应吃一采 CreateVideo[130]"
    wb = [l for l in d["links"] if l[1] == 4 and l[3] == 100]
    assert wb, "[4]→[100] MyShot 回写线应在"
    assert "p2-final" in nodes[4]["widgets_values"][0]
    assert "p1-preview" in nodes[204]["widgets_values"][0]


def test_stage2_latent_pipeline_wiring():
    """放大链接线:125.denoised→205 分离→206 放大→207 合并(音轨直通)→211。"""
    d, nodes, links = _load()
    def src_of(nid, slot):
        lid = nodes[nid]["inputs"][slot]["link"]
        assert lid is not None, f"[{nid}] 输入槽 {slot} 未连线"
        l = links[lid]
        return l[1], l[2]
    assert src_of(205, 0) == (125, 1), "分离件应吃一采 denoised_output"
    assert src_of(206, 0) == (205, 0)
    assert src_of(207, 0) == (206, 0)
    assert src_of(207, 1) == (205, 1), "音轨 latent 必须直通不经放大"
    assert src_of(211, 4) == (207, 0)
    assert nodes[205]["type"] == "LTXVSeparateAVLatent"
    assert nodes[207]["type"] == "LTXVConcatAVLatent"


def test_stage3_tessera_params_v4():
    """1113 手术:TESSERA 整组(38 节点)出主线零残留;参数契约随独立件
    7_测试/TESSERA-超分-1080p.json 由 test_tessera_upscale_contract 把守。"""
    _, nodes, _ = _load()
    tessera_nodes = [nid for nid, n in nodes.items() if "Tessera" in n["type"]]
    assert not tessera_nodes, f"主线不得残留 TESSERA 件(1113 用户令移 7_测试): {tessera_nodes}"
    assert not [nid for nid in nodes if 300 <= nid <= 337], "300-337 号段(旧 TESSERA 组)应整段清空"


def test_links_bidirectional_consistency():
    """连线双向一致:inputs[].link ↔ links[] ↔ outputs[].links。
    1113 反向门:outputs[].links/inputs[].link 里的 id 必须落在 links 表内——
    删节点清了链表却留登记(上午手术实留 8 处悬空)即红。"""
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
                assert lid in link_ids, f"[{nid}] 输出槽 {o.get('name')} 悬空登记 {lid}(删节点未清登记)"
        for i in n.get("inputs", []):
            assert i.get("link") is None or i["link"] in link_ids, \
                f"[{nid}] 输入槽 {i['name']} 悬空登记 {i.get('link')}"


def test_groups_three_bands_non_overlap():
    """1113 手术后=五组横排:加载模型→输入→一阶段采样→二阶段放大→三采超分;
    两两不交,标题口径正确(TESSERA/RelayVSR 已出主线,标题不得再含);
    罩全门(1113 刻碑:负高度组框实弹事故——深度阶梯改版丢 g_max_y 更新行,五组高度全 -20,
    画布上组框退化成标题条、节点全部框外;检查器不查组覆盖须自算,此处入契约)。"""
    d, nodes, _ = _load()
    gs = d["groups"]
    assert len(gs) == 5, "五组=加载模型/输入/一阶段采样/二阶段放大/三采超分(1113 手术终态)"
    assert any("三采超分" in g["title"] for g in gs), "三采超分组必须在册"
    assert any("ReCaVSR" in g["title"] for g in gs), "ReCaVSR 主线组必须在册"
    for g in gs:
        x, y, w, h = g["bounding"]
        assert w > 0 and h > 0, f"组[{g['title']}] 尺寸非正 bounding={g['bounding']}(负高度=标题条退化)"
    for nid, n in nodes.items():
        nx, ny = n["pos"]
        covered = any(g["bounding"][0] <= nx and g["bounding"][1] <= ny
                      and nx < g["bounding"][0] + g["bounding"][2]
                      and ny < g["bounding"][1] + g["bounding"][3] for g in gs)
        assert covered, f"[{nid}] {n['type']} 不在任何组框内(组框罩全红线)"
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            a, b = gs[i]["bounding"], gs[j]["bounding"]
            ox = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
            oy = a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
            assert not (ox and oy), f"组框重叠: {gs[i]['title']} × {gs[j]['title']}"
    titles = "".join(g["title"] for g in gs)
    for kw in ("加载模型", "输入", "一阶段采样", "二阶段放大", "三采超分"):
        assert kw in titles, f"五组标题缺: {kw}"
    for gone in ("TESSERA", "RelayVSR"):
        assert gone not in titles, f"{gone} 已出主线,组标题不得残留"


def test_no_negative_zone_and_no_leftward():
    """结构判据:零负区(pos≥80)+ 恒向右(target.x > origin.x)。"""
    d, nodes, _ = _load()
    for nid, n in nodes.items():
        assert n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{nid}] 负区 pos={n['pos']}"
    for l in d["links"]:
        sx = nodes[l[1]]["pos"][0]
        tx = nodes[l[3]]["pos"][0]
        assert tx > sx, f"link {l[0]} 左向线 [{l[1]}]→[{l[3]}]"


def test_absorbed_fl2v_firstframe_mode():
    """1105 吸收裁定:fl2v 首帧模式并入 G1——双臂+三 Seam 懒选择(ComfySwitchNode),
    单一布尔源 [219] 扇出(默认 True=r2v 多参考;i2v 臂含 pika_fl2va LoRA)。"""
    d, nodes, links = _load()
    assert nodes[219]["type"] == "PrimitiveBoolean" and nodes[219]["widgets_values"] == [True]
    assert nodes[220]["type"] == "MiniMaxH3ImageToVideo", "i2v 条件(吸收自 fl2v)"
    # 1112 回归闸:引擎 0.45.2 已无 audio_vae 入参(object_info 实证),陈旧线必炸 i2v 实弹
    assert all(i["name"] != "audio_vae" for i in nodes[220]["inputs"]), \
        "[220] 不得声明 audio_vae 槽(0.45.2 TypeError)"
    # 1112 回归闸③:MyShot shot_id 必须等于 [4] p2 前缀 parts[3](my_shot.py:71;S00 克隆残留实踩)
    _p2_prefix = next(n["widgets_values"][0] for n in d["nodes"] if n["id"] == 4)
    assert nodes[100]["widgets_values"][0] == _p2_prefix.split("/")[3], \
        "[100] MyShot shot_id 与 p2 前缀失配,画布默认态二采必炸"
    assert nodes[216]["widgets_values"] == ["pika_turbo_8step_fl2va.safetensors", 1]
    fans = sorted(l[3] for l in d["links"] if l[1] == 219)
    assert fans == [218, 221, 222], "模式开关单源扇出三选择点"
    for sid in (218, 221, 222):
        ins = {i["name"]: i for i in nodes[sid]["inputs"]}
        assert nodes[sid]["type"] == "ComfySwitchNode"
        # 1112 F1 修正后真实槽语义:on_true=√(219=true)→r2v 臂,on_false→i2v 臂
        # (母本原接线倒挂=on_true 接 i2v,1112 sancai_mother_fix_1112.py 已换;
        #  旧断言把 ins[1](实为 on_false 槽)读作 t_slot 系与倒挂共谋,随修复改写)
        assert links[ins["on_true"]["link"]][1] in (16, 140), "on_true=r2v 臂(√=r2v 真语义)"
        assert links[ins["on_false"]["link"]][1] in (217, 220, 251), "on_false=i2v 臂"
        assert "audio_vae" not in ins or sid != 220, "可达性哨(220 无开关槽)"
    # 三 Seam 出口:底模→[266]taeh3 预览器→[126].model(1108 用户令装 taeh3) / 条件→[126].conditioning / 潜空间→[125].latent_image
    assert nodes[266]["type"] == "ModelPreviewOverrideKJ" and nodes[266]["widgets_values"][5] == "taeh3.safetensors"
    assert links[nodes[266]["inputs"][0]["link"]][1] == 218, "预览器应吃三 Seam 底模出口"
    assert links[nodes[126]["inputs"][0]["link"]][1] == 266
    assert links[nodes[126]["inputs"][1]["link"]][1] == 221
    assert links[nodes[125]["inputs"][4]["link"]][1] == 222
    # 首帧槽:[9]→[220].first_frame(i2v 臂)+[9]→[16].ref_image_0(r2v 臂)双吃
    f9 = sorted(l[3] for l in d["links"] if l[1] == 9)
    assert f9 == [16, 208, 220], "[9] 应喂 r2v[16]/二采条件[208]/i2v首帧[220] 三处"


def test_single_shot_dir_inventory():
    """1_漫影自研 件册(1112 扁平化+历史档外迁裁定:零子夹,六件平铺):主线 三采-单镜.json
    (1111 换防退役件 三采-单镜-RelayVSR-1110.json 已移 7_测试/ 留档)+ 1105 被吸收旧主线 pika-{fl2v,ref2v}.json
    +首跑样本 单镜视频 · chapter-001 · S01.json + 导演台.json + h3-autocontext-multiseg.json。
    1112 用户令:1_漫影自研 下不设子文件夹;归档语义由文件名后缀承载。"""
    expected = [
        "一镜到底-分段.json",
        "三采-单镜.json",
        "导演台.json",
    ]
    jsons = sorted(p.name for p in WF_DIR.glob("*.json"))
    assert jsons == expected, f"1_漫影自研 件册漂移,现有 {jsons}"
    subs = [d.name for d in WF_DIR.iterdir() if d.is_dir()]
    assert not subs, f"1_漫影自研 应零子夹(1112 扁平化裁定),现有 {subs}"

def test_sigma_feed_scheduler_gets_shifted_model():
    """1110 σ接线定谳:BasicScheduler.execute 源码=σ表从自身 MODEL 的
    model_sampling 推导(comfy_extras/nodes_custom_sampler.py);σshift 节点
    docstring 明言 video shift 驱动采样器 σ 表——故调度器必须吃 σshift 后的模型,
    吃裸底模=网格用默认 shift 与 DiT 预期脱钩(一采曾裸喂,Pika FL2VA 官方[6,3]
    档从未真正落到 σ 网格上)。"""
    _, _, links = _load()
    def model_src(to_node):
        srcs = [l[1] for l in links.values() if l[5] == "MODEL" and l[3] == to_node]
        assert len(srcs) == 1, f"[{to_node}] MODEL 应恰一条入线,现有 {srcs}"
        return srcs[0]
    assert model_src(250) == 251, "一采调度器[250]必须吃[251]σshift[6,3]后的模型"
    assert model_src(209) == 203, "二采调度器[209]必须吃[203]σshift[12,3]后的模型"


def test_stage3_relayvsr_inline_group():
    """1113 用户令「ReCaVSR 已稳不需要兜底,删 RelayVSR 相关节点」:[268][269]
    删除零残留;回退能力由 7_测试/三采-单镜-RelayVSR-1110.json 存档承载。"""
    _, nodes, links = _load()
    relay = [nid for nid, n in nodes.items() if "RelayVSR" in n["type"]]
    assert not relay, f"主线不得残留 RelayVSR 件(1113 用户令删): {relay}"
    assert 268 not in nodes and 269 not in nodes, "[268][269] 应已删"
    archive = WF_DIR.parent / "7_测试" / "三采-单镜-RelayVSR-1110.json"
    assert archive.exists(), "RelayVSR 回退存档件应在 7_测试 在册"


def test_stage3_recavsr_mainline_arm():
    """1111 换防主线臂:[338]ReCaVSRLoader(int8 ConvRot)→[339]ReCaVSRUpscale
    (scale2/fast/flashdecoder)→[340]SaveVideo(p3-recavsr);二采[214]直喂;
    1440×832→2880×1664,交付层归一 1080(对称旧口径);实弹=同档对拍 59.1s vs
    RelayVSR 185.6s(3.14×),PSNR 对源保真 35.7(生成系加细节)。"""
    d, nodes, links = _load()
    assert nodes[338]["type"] == "ReCaVSRLoader"
    assert nodes[338]["mode"] == 0 and nodes[338]["widgets_values"] == ["transformer_int8_convrot.safetensors"]
    assert nodes[339]["type"] == "ReCaVSRUpscale"
    assert nodes[339]["mode"] == 0
    w = nodes[339]["widgets_values"]
    assert w[0] == 2, "scale=2:1440×832→2880×1664"
    assert w[5] == "fast" and w[4] == "flashdecoder", "kernels=fast / decoder=flashdecoder"
    assert nodes[340]["type"] == "SaveVideo" and nodes[340]["mode"] == 0
    assert nodes[340]["widgets_values"][0] == "video/漫影/chapter-001/sb-chapter-001-001/p3-recavsr"
    # 接线:780=[214]→[339].video / 781=[338]→[339].model / 782=[339]→[340]
    l780 = links[780]; l781 = links[781]; l782 = links[782]
    assert (l780[1], l780[3], l780[5]) == (214, 339, "VIDEO"), "三采主臂直吃二采 CreateVideo[214]"
    assert (l781[1], l781[3], l781[5]) == (338, 339, "RECAVSR"), "模型链型=RECAVSR(作者件槽型原样)"
    assert (l782[1], l782[3], l782[5]) == (339, 340, "VIDEO")
    assert d["last_node_id"] >= 340 and d["last_link_id"] >= 782, "计数器不落后(267/776 落后雷刻碑)"
