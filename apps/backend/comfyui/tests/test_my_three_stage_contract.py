"""道劫三段链工作流契约测试(11-05-daojie-h3-three-stage)。

被测对象 = 仓库真源 `2_视频/H3视频/1_漫影自研/0_单镜视频/MY-三采-单镜.json`(1110 用户令改名,旧名 pika-单镜视频-三段链)
(GUI 格式,fork pika-单镜视频-ref2v.json 出生)。

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
  ③ 质量精修 TESSERA = tessera_upscaler_master 精简+api_formal_v4(第四发 1080p
     定谳)参数:×1.5→1920×1056、σ"1, 0.7, 0.4, 0.0"、er_sde+euler、taomate@0.7
     +LMS 0.75/1.0、sol-attn、TE nvfp4_awq、CRF12、seed 786110;全组 mode=2
     默认旁路(质量档只作测试,不默认跑);1056→1080 归一=图外 ffmpeg 交付步。

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

WF_DIR = Path(__file__).resolve().parents[1] / "workflows" / "2_视频" / "H3视频" / "1_漫影自研" / "0_单镜视频"
WF = WF_DIR / "MY-三采-单镜.json"

PIKA_SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"
TESSERA_SIGMAS = "1, 0.7, 0.4, 0.0"


def _load():
    assert WF.exists(), f"工作流真源缺失: {WF}"
    d = json.loads(WF.read_text(encoding="utf-8"))
    return d, {n["id"]: n for n in d["nodes"]}, {l[0]: l for l in d["links"]}


def test_anchors_assembler_contract():
    """组装器锚点齐全(assertH3TemplateIntegrity 对齐)+ [16] r2v 族锚。"""
    _, nodes, _ = _load()
    for nid, ntype in ((4, "SaveVideo"), (9, "LoadImage"), (14, "PrimitiveStringMultiline"),
                       (20, "PrimitiveFloat"), (100, "MyShot"), (101, "MarkdownNote")):
        assert nodes[nid]["type"] == ntype, f"[{nid}] 应为 {ntype}"
    assert nodes[9]["mode"] == 4, "[9] 分镜帧占位出厂应旁路(mode=4)"
    for nid in (110, 111, 112, 113):
        assert nodes[nid]["type"] == "LoadImage" and nodes[nid]["mode"] == 4
    assert nodes[16]["type"] == "MiniMaxH3ReferenceToVideo", "[16] r2v 族锚"


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
    # 默认路径(①+②,id<300)视频 VAE 单源;③组自足支路自备同款 VAELoader
    # (muted 分支零加载;设计偏差已入任务档:自足+官方验证路径优先于单源扇出)
    vae_video = [n for n in nodes.values() if n["id"] < 300 and n["type"] == "VAELoader"
                 and "video_vae_int8" in json.dumps(n.get("widgets_values"))]
    assert len(vae_video) == 1
    vae_g3 = [n for n in nodes.values() if n["id"] >= 300 and n["type"] == "VAELoader"
              and "video_vae_int8" in json.dumps(n.get("widgets_values"))]
    assert len(vae_g3) == 1 and vae_g3[0]["mode"] == 2, "③组自足 VAELoader 恒旁路"


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
    """质量档=第四发 1080p 定谳参数;默认旁路(全 mode=2)。"""
    _, nodes, _ = _load()
    assert all(n.get("mode") == 2 for nid, n in nodes.items() if nid >= 300), "③组全员默认旁路 mode=2"
    assert nodes[303]["type"] == "TesseraEncode"
    assert nodes[303]["widgets_values"][0] == 1.5, "×1.5 → 1920×1056(1104 12:55 终裁 1080p 档)"
    assert nodes[319]["widgets_values"] == [TESSERA_SIGMAS]
    assert nodes[317]["widgets_values"] == ["er_sde"]
    assert nodes[318]["widgets_values"] == ["euler"]
    assert nodes[314]["widgets_values"] == ["taomate_h3_3step.safetensors", 0.7]
    assert nodes[315]["widgets_values"] == ["minimax_h3_lms_v1.0_r64.safetensors", 0.75]
    assert nodes[316]["widgets_values"] == ["minimax_h3_lms_v1.0_r64.safetensors", 1]
    assert nodes[308]["widgets_values"][0] == "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors", "1105 统一深化:③组底模随双模归档同迁 Cobijada"
    assert nodes[309]["widgets_values"][0] == "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    refine = nodes[305]["widgets_values"]
    assert refine[10] == 1.0 and refine[11] == 786110 and refine[12] == "fixed"
    assert refine[0] == "high_vram" and refine[3] == "high_vram", "chunked=官方验证路径"
    sv = nodes[336]["widgets_values"]
    assert sv[0].endswith("p3-tessera-x15-1920x1056") and sv[4] == 12.0
    assert nodes[300]["type"] == "LoadVideo", "③组输入=LoadVideo 指向②组产物(文件交接,验证路径)"


def test_links_bidirectional_consistency():
    """连线双向一致:inputs[].link ↔ links[] ↔ outputs[].links。"""
    d, nodes, _ = _load()
    for l in d["links"]:
        lid, s, ss, t, ts, _t = l
        assert s in nodes and t in nodes, f"link {lid} 端点悬空"
        assert nodes[t]["inputs"][ts]["link"] == lid, f"link {lid} 目标端未登记"
        assert lid in (nodes[s]["outputs"][ss].get("links") or []), f"link {lid} 源端未登记"


def test_groups_three_bands_non_overlap():
    """三段=三组框,两两不交,标题口径正确。"""
    d = _load()[0]
    gs = d["groups"]
    assert len(gs) == 4, "四组=一采/二采/三采超分(RelayVSR)/TESSERA 旁路(1110 三采内联)"
    assert any("三采超分" in g["title"] for g in gs), "三采超分组必须在册"
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            a, b = gs[i]["bounding"], gs[j]["bounding"]
            ox = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
            oy = a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
            assert not (ox and oy), f"组框重叠: {gs[i]['title']} × {gs[j]['title']}"
    titles = "".join(g["title"] for g in gs)
    for kw in ("一阶段采样", "二采放大", "TESSERA"):
        assert kw in titles


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
    assert nodes[216]["widgets_values"] == ["pika_turbo_8step_fl2va.safetensors", 1]
    fans = sorted(l[3] for l in d["links"] if l[1] == 219)
    assert fans == [218, 221, 222], "模式开关单源扇出三选择点"
    for sid, t_slot, f_slot in ((218, 1, 2), (221, 1, 2), (222, 1, 2)):
        ins = nodes[sid]["inputs"]
        assert nodes[sid]["type"] == "ComfySwitchNode"
        assert links[ins[t_slot]["link"]][1] == 16 or links[ins[t_slot]["link"]][1] == 140, "on_true=r2v 臂"
        assert links[ins[f_slot]["link"]][1] in (217, 220, 251), "on_false=i2v 臂"
    # 三 Seam 出口:底模→[266]taeh3 预览器→[126].model(1108 用户令装 taeh3) / 条件→[126].conditioning / 潜空间→[125].latent_image
    assert nodes[266]["type"] == "ModelPreviewOverrideKJ" and nodes[266]["widgets_values"][5] == "taeh3.safetensors"
    assert links[nodes[266]["inputs"][0]["link"]][1] == 218, "预览器应吃三 Seam 底模出口"
    assert links[nodes[126]["inputs"][0]["link"]][1] == 266
    assert links[nodes[126]["inputs"][1]["link"]][1] == 221
    assert links[nodes[125]["inputs"][4]["link"]][1] == 222
    # 首帧槽:[9]→[220].first_frame(i2v 臂)+[9]→[16].ref_image_0(r2v 臂)双吃
    f9 = sorted(l[3] for l in d["links"] if l[1] == 9)
    assert f9 == [16, 208, 220], "[9] 应喂 r2v[16]/二采条件[208]/i2v首帧[220] 三处"


def test_single_shot_dir_only_three_stage():
    """1105 只保留裁定:0_单镜视频 恰一件(1110 起名 MY-三采-单镜.json)。"""
    lib = WF_DIR
    jsons = sorted(p.name for p in lib.glob("*.json"))
    assert jsons == ["MY-三采-单镜.json"], f"0_单镜视频 应只剩三采单镜件,现有 {jsons}"


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
    """1110 三采内联:二采产物[214]→RelayVSR streaming 1920 宽(交付裁 15px=1080),
    bundle=RelayVSR_X2 bf16 offload 恒开(1106 刻碑)。"""
    _, nodes, links = _load()
    assert nodes[268]["type"] == "RelayVSRModelLoader"
    assert nodes[268]["widgets_values"] == ["RelayVSR_X2", "bf16", True, ""]
    assert nodes[269]["type"] == "RelayVSRUpscaleStreaming"
    w = nodes[269]["widgets_values"]
    assert w[0] == 1920 and w[1] == 2, "终版阶梯:1440×832→1920 宽"
    vin = [l for l in links.values() if l[5] == "VIDEO" and l[3] == 269]
    assert len(vin) == 1 and vin[0][1] == 214, "三采吃二采 CreateVideo[214] 产物"
