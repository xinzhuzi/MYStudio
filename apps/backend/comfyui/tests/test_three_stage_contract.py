"""道劫三段链工作流契约测试(11-05-daojie-h3-three-stage)。

被测对象 = 仓库真源 `2_视频/H3视频/1_漫影自研/单镜.json`
(1111 用户裁定换防主线:三采主力 RelayVSR→ReCaVSR;1112 用户裁定复名:自研件不用外来技术名,
挑战臂役暂名 三采-recavsr-单镜.json 复名回 三采-单镜;1119 用户裁定主线件改名
(旧名三采-单镜→现名单镜,全仓引用面同步);旧 RelayVSR 版主线退役件
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
     片尾字幕乱码红线);[3071] SaveVideo 锚移挂二采产物=默认终档(五段前缀+MyShot
     回写契约不变,组装器 buildShotRefWorkflowFromTemplate 兼容)。
  ③ 三采超分 = ReCaVSR 主线(scale2.667:1440×832→3840×2220=4K UHD 宽,1117 用户令三采默认 4K)。
     1113 手术重放(trellis 11-13-sancai-workflow-surgery-replay,自 875124ad 原版重放):
     TESSERA 38 节点整组出主线(零跨界,参数契约随独立件 7_测试/TESSERA-超分-1080p.json
     由 test_tessera_upscale_contract 把守);RelayVSR 旁路 [268][269]+监控死端 [264][265]
     删除(用户令「ReCaVSR 已稳不需要兜底」;RelayVSR 回退档=7_测试/三采-单镜-RelayVSR-1110.json
     留档);三 Note 合一为 [9999] README;布局五组横排(加载模型→输入→一阶段采样→
     二采放大→三采超分),深度阶梯严格右向。

锚点契约(与 ref2v 族同构,组装器 assertH3TemplateIntegrity 对齐):
    [3071] SaveVideo / [1] LoadImage(出厂 mode=4) / [21] PrimitiveStringMultiline
    / [20] PrimitiveFloat / [3061] MyShot / [9999] MarkdownNote 在位;
    [2001] MiniMaxH3ReferenceToVideo(r2v 族锚)。

零引擎依赖纯静态。布局口径:结构判据(零负区/est 零重叠/零左向/组框两两不交)
由 layout_check 把门(交叉/遮挡现值入任务档,不入 WORKFLOW_TARGETS 棘轮——
与单镜家族全部未入闸一致)。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

WF_DIR = Path(__file__).resolve().parents[1] / "workflows" / "2_视频" / "H3视频" / "1_漫影自研"
WF = WF_DIR / "单镜.json"  # 1119 git mv 改名(旧名 三采-单镜 随役退役)

PIKA_SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"


def _load():
    assert WF.exists(), f"工作流真源缺失: {WF}"
    d = json.loads(WF.read_text(encoding="utf-8"))
    return d, {n["id"]: n for n in d["nodes"]}, {l[0]: l for l in d["links"]}


def test_anchors_assembler_contract():
    """组装器锚点齐全(assertH3TemplateIntegrity 对齐)+ [2001] r2v 族锚;
    1113 火力扩展锚:15-18 参考图(ref_image_5..8)/31 尾帧/41 参考视频,全 MUTED 出厂(1114 用户令统一称参考图)。"""
    _, nodes, _ = _load()
    for nid, ntype in ((3071, "SaveVideo"), (1, "LoadImage"), (21, "PrimitiveStringMultiline"),
                       (51, "PrimitiveFloat"), (3061, "MyShot"), (9999, "MarkdownNote")):
        assert nodes[nid]["type"] == ntype, f"[{nid}] 应为 {ntype}"
    assert nodes[1]["mode"] == 0, "[1] 必填主图出厂激活(1114 用户令:手动选图即跑零额外点击;忘选图=fail-fast报错优于静默空跑)"
    for nid in (11, 12, 13, 14, 15, 16, 17, 18, 31):
        assert nodes[nid]["type"] == "LoadImage" and nodes[nid]["mode"] == 4, f"[{nid}] 参考锚应 MUTED LoadImage"
    assert nodes[41]["type"] == "LoadVideo" and nodes[41]["mode"] == 4, "[41] 参考视频锚"
    assert nodes[42]["type"] == "GetVideoComponents" and nodes[42]["mode"] == 4, \
        "[42] 拆帧桥出厂旁路(346旁路时桥悬空必填=手动直跑校验红,1114 根修)"
    assert nodes[2001]["type"] == "MiniMaxH3ReferenceToVideo", "[2001] r2v 族锚"


def test_input_firepower_1113():
    """1113 火力满配(ref_image_0..8 九槽+尾帧+参考视频):
    引擎 AUTOGROW max=9 实证;三步同步连线;组装器 SANCAI_REF_IDS 八卡同构。"""
    d, nodes, links = _load()
    for dst in (2001, 3031):
        slots = {e["name"]: e for e in nodes[dst]["inputs"] if e["name"].startswith("ref_images.ref_image_")}
        assert len(slots) == 9, f"[{dst}] 图槽应 9(ref_image_0..8),现 {len(slots)}"
        assert all(e["link"] is not None for e in slots.values()), f"[{dst}] 有空槽"
        # 槽-源对位:0←9,1..4←11-14,5..8←15-18
        for n, src in [(0, 1), (1, 11), (2, 12), (3, 13), (4, 14), (5, 15), (6, 16), (7, 17), (8, 18)]:
            lid = slots[f"ref_images.ref_image_{n}"]["link"]
            assert links[lid][1] == src, f"[{dst}] 槽{n} 应←[{src}],实←[{links[lid][1]}]"
    lf = next(e for e in nodes[2002]["inputs"] if e["name"] == "last_frame")
    assert lf["link"] is not None and links[lf["link"]][1] == 31, "[2002].last_frame 应←[31] 尾帧锚"
    rv = next(e for e in nodes[2001]["inputs"] if e["name"] == "ref_videos.ref_video_0")
    assert rv["link"] is not None and links[rv["link"]][1] == 42, "[16].ref_video_0 应←[42]桥(GetVideoComponents)"
    assert nodes[42]["type"] == "GetVideoComponents" and links[nodes[42]["inputs"][0]["link"]][1] == 41, \
        "[42]桥应←[41]LoadVideo(VIDEO→IMAGE 帧桥)"


def test_stage1_mainline_recipe_unchanged():
    """一阶段配方逐值:LoRA/lcm/BasicScheduler(simple,8) 自动 σ/统一底模/注意力。
    1105 用户裁定:H3 底模统一 Cobijada(hybrid 一件双能,B 发 471.5s 快过官方 fl2va 491.0s)。"""
    _, nodes, _ = _load()
    assert nodes[1001]["widgets_values"][0] == "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
    assert nodes[1011]["widgets_values"] == ["pika_h3_flex_ref2va_comfy_bf16.safetensors", 1]
    assert nodes[2022]["widgets_values"] == ["lcm"]
    # [2021] BasicScheduler(simple, 8, 1.0) 替代了旧 [147] ManualSigmas(1107 Turbo 8步)
    w250 = nodes[2021]["widgets_values"]
    assert w250[0] == "simple" and w250[1] == 8 and w250[2] == 1.0, "一采 σ 源=BasicScheduler(simple,8,dn1.0)"
    assert nodes[1042]["widgets_values"] == ["comfy kitchen attention"]
    assert nodes[54]["widgets_values"] == [42, "fixed"]


def test_stage1_factory_tier_052mp():
    """一采出厂档 0.52MP 960×544(1110 A/B 裁定,1280 无增益回退);帧数 124=17k+5 网格。"""
    _, nodes, _ = _load()
    assert nodes[53]["widgets_values"][1] == 0.5
    assert nodes[2001]["widgets_values"][1:3] == [960, 544]
    assert nodes[2002]["widgets_values"][1:3] == [960, 544], "I2V 一采分辨率同步"
    assert nodes[2001]["widgets_values"][4] == "max", "参考图恒 max(1110 用户令)"
    md9999 = nodes[9999]["widgets_values"][0]
    assert "4096" in md9999 and "图质越高视频越好" in md9999, "参考图定律入 Note101(1110:超分+磨皮 4096 再入链)"
    assert nodes[2001]["widgets_values"][3] == 124


def test_stage2_up_recipe():
    """二采=UP 配方逐值:upscaler 3d_bf16→1280×704 cuda / taomate@0.7 /
    fl2va int8 pruned / lcm 复用 / BasicScheduler simple/3/0.2 / SigmaShift[12,3]。"""
    _, nodes, _ = _load()
    assert nodes[3002]["type"] == "MinimaxH3LatentUpscaler3D"
    w = nodes[3002]["widgets_values"]
    assert w[0] == "minimax_h3_latent_upscaler_3d_bf16.safetensors"
    assert w[1:5] == ["target dimensions", 1440, 832, 32]
    assert w[5] is True and w[6] is True, "chunking/force_unload 开(Win 先例 fasth3-二采超分-2x)"
    assert w[7] == "cuda", "Win 产线引擎,device 必须 cuda(社区件出厂 mps 已勘正)"
    assert nodes[1021]["widgets_values"] == ["taomate_h3_3step.safetensors", 0.7]
    assert nodes[1033]["type"] == "BlockSparseAttention" and nodes[1033]["mode"] == 0, "1108 二采挂 sol-attn"
    # 1105 统一改造:单 UNETLoader(Cobijada)扇出双 LoRA 臂,换装段消失(taomate@Cobijada 候实弹)
    assert nodes[3041]["widgets_values"] == ["simple", 3, 0.2], "UP 定谳:simple/3步/denoise 0.2"
    assert nodes[3021]["widgets_values"] == [12, 3]
    assert nodes[3031]["type"] == "MiniMaxH3ReferenceToVideo"
    assert nodes[3031]["widgets_values"][1:3] == [1440, 832]
    assert nodes[3031]["widgets_values"][4] == "max", "二采参考图恒 max(1113 用户令「用Max」;与 [16] 同律)"
    assert nodes[3043]["type"] == "SamplerCustomAdvanced"


def test_stage2_model_mainline_passes_through_chunkffn():
    """1106 E2 吸收件在位:[3011] MiniMaxChunkFeedForward 恒在 MODEL 主线
    [1021]taomate LoRA → [3011] → [3021]SigmaShift 上,出厂 chunks=1 = 源码恒等旁路
    (comfyui-kjnodes/nodes/minimax_nodes.py:69-71 原对象返回,零 clone 零 patch)。
    本例防的是"日后布局手术把 1021→3021 直接重焊"——test_links_bidirectional_consistency
    只验拓扑合法,不验此件存在,缺它则 E2 静默蒸发。"""
    d, nodes, links = _load()
    assert nodes[3011]["type"] == "MiniMaxChunkFeedForward"
    assert nodes[3011]["mode"] == 0, "旁路靠 chunks=1(恒等),不靠 mode 静默"
    assert nodes[3011]["widgets_values"][0] == 2, "chunks=2(1118 lowvram 役激活削峰)"
    assert nodes[3011]["widgets_values"][1] == 4096, "seq_threshold 留节点默认"
    assert [i["name"] for i in nodes[3011]["inputs"]] == ["model"], "只留 model 口,widget 走面板"
    up = links[nodes[3011]["inputs"][0]["link"]]
    down_ids = nodes[3011]["outputs"][0]["links"]
    assert len(down_ids) == 1, "[3011] 输出恒单挂"
    down = links[down_ids[0]]
    assert (up[1], up[3], up[5]) == (1033, 3011, "MODEL"), "上游=[1021]→[1033]sol-attn→[3011](1108 二采挂 sol-attn)"
    assert (down[1], down[3], down[5]) == (3011, 3021, "MODEL"), "下游=[3021] 且走 MODEL"
    fed = {l[3] for l in d["links"] if l[1] == 1021 and l[5] == "MODEL"}
    assert fed == {1033}, "[1021] 的 MODEL 唯一去向=[1033]sol-attn→[3011](1108 二采主线)"


def test_stage2_single_source_fanout_no_duplicate():
    """零真重复:[2022] lcm 与 [54] 噪声单源扇出供两段采样器;VAE/TE 同源扇出;
    底模单源:[1001] Cobijada 扇出 pika/taomate 双 LoRA 臂(1105 统一改造;
    1118 四采修脸臂 5006 复用同源——全图恒单 UNETLoader,禁双载显存爆)。"""
    d, nodes, links = _load()
    unets = [n for n in nodes.values() if n["type"] == "UNETLoader" and n["id"] < 9000]
    assert len(unets) == 1 and unets[0]["id"] == 1001, "默认路径底模恒单源(Cobijada 统一;i2v 臂为 LoRA 分支非独立底模;四采臂 5006 亦复用,禁第二个 UNETLoader)"
    fed = {l[3] for l in d["links"] if l[1] == 1001 and l[5] == "MODEL"}
    assert fed == {1011, 1021, 1012, 5006}, "Cobijada 扇出三 LoRA 臂+四采修脸臂 5006(1118);调度器[2021/3041]改吃 σshift 后模型(1110 σ接线定谳,见 test_sigma_feed_scheduler_gets_shifted_model)"
    samplers = []
    for l in d["links"]:
        if l[1] == 2022 and l[5] == "SAMPLER":
            samplers.append(l[3])
    assert sorted(samplers) == [2032, 3043], "KSamplerSelect(lcm) 应单源扇出至一采/二采"
    ksel = sorted(n["id"] for n in nodes.values() if n["type"] == "KSamplerSelect" and n["id"] < 9000)
    assert ksel == [2022, 5017], "主链(一采+二采)共享 [2022](零真重复);四采修脸臂独立 [5017] lcm(1118,5000 段分区)"
    # 默认路径(①+②,id<300)视频 VAE 单源;1113 手术后 ≥300 仅剩 ReCaVSR 三件,
    # ③组自足 VAELoader 已随 TESSERA 整组出主线(零残留)
    vae_video = [n for n in nodes.values() if n["id"] < 9000 and n["type"] == "VAELoader"
                 and "video_vae_int8" in json.dumps(n.get("widgets_values"))]
    assert len(vae_video) == 1
    vae_g3 = [n for n in nodes.values() if not (1000 <= n["id"] < 1100) and n["type"] == "VAELoader"]
    assert not vae_g3, "≥300 段不得再有 VAELoader(TESSERA 出主线后仅 ReCaVSR 4001/4002/4003)"


def test_anchor4_final_mounted_on_stage2():
    """[4] 锚移挂二采产物=默认终档;一采预览落 [2061];[4]→[3061] 回写线在。"""
    d, nodes, links = _load()
    in4 = nodes[3071]["inputs"][0]["link"]
    src = links[in4]
    assert src[1] == 3053 and src[2] == 0, "[4] 应吃二采 CreateVideo[3053] 输出"
    assert nodes[3053]["type"] == "CreateVideo"
    assert nodes[2061]["type"] == "SaveVideo"
    in204 = nodes[2061]["inputs"][0]["link"]
    assert links[in204][1] == 2051, "[2061] 一采预览应吃一采 CreateVideo[2051]"
    wb = [l for l in d["links"] if l[1] == 3071 and l[3] == 3061]
    assert wb, "[4]→[3061] MyShot 回写线应在"
    assert "p2-final" in nodes[3071]["widgets_values"][0]
    assert "p1-preview" in nodes[2061]["widgets_values"][0]


def test_stage2_latent_pipeline_wiring():
    """放大链接线:2032.denoised→3001 分离→3002 放大→3003 合并(音轨直通)→3043。"""
    d, nodes, links = _load()
    def src_of(nid, slot):
        lid = nodes[nid]["inputs"][slot]["link"]
        assert lid is not None, f"[{nid}] 输入槽 {slot} 未连线"
        l = links[lid]
        return l[1], l[2]
    assert src_of(3001, 0) == (2032, 1), "分离件应吃一采 denoised_output"
    assert src_of(3002, 0) == (3001, 0)
    assert src_of(3003, 0) == (3002, 0)
    assert src_of(3003, 1) == (3001, 1), "音轨 latent 必须直通不经放大"
    assert src_of(3043, 4) == (3003, 0)
    assert nodes[3001]["type"] == "LTXVSeparateAVLatent"
    assert nodes[3003]["type"] == "LTXVConcatAVLatent"


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
    1118 增两只:四采修脸组(5000 段)+终档组(5100/4100 p-final),共七组;
    1119 双档:扩四采组框罩全 14 新件(组数恒 7 不新增第 8 组,组标题更新双档口径;
    PRD 3.6 用户裁决=两档同组);两两不交,标题口径正确(TESSERA/RelayVSR 已出主线,标题不得再含);
    罩全门(1113 刻碑:负高度组框实弹事故——深度阶梯改版丢 g_max_y 更新行,五组高度全 -20,
    画布上组框退化成标题条、节点全部框外;检查器不查组覆盖须自算,此处入契约)。"""
    d, nodes, _ = _load()
    gs = d["groups"]
    assert len(gs) == 7, "七组=加载模型/输入/一阶段采样/二阶段放大/三采超分+四采修脸+终档(1118 内置修脸臂)"
    assert any("三采超分" in g["title"] for g in gs), "三采超分组必须在册"
    assert any("ReCaVSR" in g["title"] for g in gs), "ReCaVSR 主线组必须在册"
    for g in gs:
        x, y, w, h = g["bounding"]
        assert w > 0 and h > 0, f"组[{g['title']}] 尺寸非正 bounding={g['bounding']}(负高度=标题条退化)"
    for nid, n in nodes.items():
        if n["type"] == "MarkdownNote":
            continue  # 1114:Note101=README 恒居组外(用户令),罩全门豁免
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
    for kw in ("加载模型", "输入", "一阶段采样", "二阶段放大", "三采超分", "四采修脸", "终档"):
        assert kw in titles, f"七组标题缺: {kw}"
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
    单一布尔源 [1061] 扇出(默认 True=r2v 多参考;i2v 臂含 pika_fl2va LoRA)。"""
    d, nodes, links = _load()
    assert nodes[1061]["type"] == "PrimitiveBoolean" and nodes[1061]["widgets_values"] == [True]
    assert nodes[2002]["type"] == "MiniMaxH3ImageToVideo", "i2v 条件(吸收自 fl2v)"
    # 1112 回归闸:引擎 0.45.2 已无 audio_vae 入参(object_info 实证),陈旧线必炸 i2v 实弹
    assert all(i["name"] != "audio_vae" for i in nodes[2002]["inputs"]), \
        "[2002] 不得声明 audio_vae 槽(0.45.2 TypeError)"
    # 1112 回归闸③:MyShot shot_id 必须等于 [4] p2 前缀 parts[3](my_shot.py:71;S00 克隆残留实踩)
    _p2_prefix = next(n["widgets_values"][0] for n in d["nodes"] if n["id"] == 3071)
    assert nodes[3061]["widgets_values"][0] == _p2_prefix.split("/")[3], \
        "[3061] MyShot shot_id 与 p2 前缀失配,画布默认态二采必炸"
    assert nodes[1012]["widgets_values"] == ["pika_turbo_8step_fl2va.safetensors", 1]
    fans = sorted(l[3] for l in d["links"] if l[1] == 1061)
    assert fans == [1062, 2011, 2012], "模式开关单源扇出三选择点"
    for sid in (1062, 2011, 2012):
        ins = {i["name"]: i for i in nodes[sid]["inputs"]}
        assert nodes[sid]["type"] == "ComfySwitchNode"
        # 1112 F1 修正后真实槽语义:on_true=√(1061=true)→r2v 臂,on_false→i2v 臂
        # (母本原接线倒挂=on_true 接 i2v,1112 sancai_mother_fix_1112.py 已换;
        #  旧断言把 ins[1](实为 on_false 槽)读作 t_slot 系与倒挂共谋,随修复改写)
        assert links[ins["on_true"]["link"]][1] in (2001, 1042), "on_true=r2v 臂(√=r2v 真语义)"
        assert links[ins["on_false"]["link"]][1] in (1041, 2002, 1051), "on_false=i2v 臂"
        assert "audio_vae" not in ins or sid != 2002, "可达性哨(2002 无开关槽)"
    # 三 Seam 出口:底模→[1071]taeh3 预览器→[2031].model(1108 用户令装 taeh3) / 条件→[2031].conditioning / 潜空间→[2032].latent_image
    assert nodes[1071]["type"] == "ModelPreviewOverrideKJ" and nodes[1071]["widgets_values"][5] == "taeh3.safetensors"
    assert links[nodes[1071]["inputs"][0]["link"]][1] == 1072, \
        "预览器应吃三 Seam 底模出口(81f8909f lowvram 插桩后经 1072 头分块收束点,随迁漏笔 1118 补)"
    assert links[nodes[2031]["inputs"][0]["link"]][1] == 1071
    assert links[nodes[2031]["inputs"][1]["link"]][1] == 2011
    assert links[nodes[2032]["inputs"][4]["link"]][1] == 2012
    # 首帧槽:[9]→[2002].first_frame(i2v 臂)+[9]→[16].ref_image_0(r2v 臂)双吃
    f9 = sorted(l[3] for l in d["links"] if l[1] == 1)
    assert f9 == [2001, 2002, 3031, 5012], "[1] 应喂 r2v[2001]/i2v首帧[2002]/二采条件[3031]/四采条件[5012] 四处(1118)"


def test_single_shot_dir_inventory():
    """1_漫影自研 件册(1112 扁平化+历史档外迁裁定:零子夹):主线 单镜.json
    (1111 换防退役件 三采-单镜-RelayVSR-1110.json 已移 7_测试/ 留档;1118 df4162c8 又迁出
    三采-单镜-小脸修复.json=克隆模板件归 7_测试/;1119a 三采-单镜-修脸.json=融合修脸件役毕双臂对拍+4K 验活后归 7_测试/;
    1119b 主线 git mv 改名(三采-单镜→单镜)+修脸双档内置(远景=默认/高清,四采修脸组同组双档)。
    现册=一镜到底-分段+单镜+导演台 三件)。
    1112 用户令:1_漫影自研 下不设子文件夹;归档语义由文件名后缀承载。"""
    expected = [
        "一镜到底-分段.json",
        "单镜.json",
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
    assert model_src(2021) == 1051, "一采调度器[2021]必须吃[1051]σshift[6,3]后的模型"
    assert model_src(3041) == 3021, "二采调度器[3041]必须吃[3021]σshift[12,3]后的模型"


def test_facerefine_inline_arm_1118():
    """1118 四采修脸臂内置(11-17-facerefine-inline-bypass):19 节点默认旁路;1119 双档扩
    (11-19-dualmode-facerefine-rename)再 +14(远景/高清双档)=画布 101、API 99
    (66+19 臂+lowvram役#1072+clip_vision#800+14 双档)。[1065] False 时
    50xx 臂被引擎惰性剪除,终档 4100=p3 直通;True 时走进修脸→终档一条线。结构契约:
    节点数 101/开关默认 False/恒单 UNETLoader(5006←1001 复用,PRD 单向门#2 显存修订)/
    5002 拆帧源=4002(三采 p3 4K 出片口,1119 回正=用户裁定「三采 4K 后修脸」;4002 仍喂
    5100.on_false=p3 直通)/
    5012 画布宽高=5011 追踪器出口联线(禁手填)/5100 极性 on_true←5113 出口(1119 等效改接,
    远景态经 5113 直通臂)·on_false=4002 p3 直通。双档结构契约见 test_facerefine_dual_mode_1119。
    prune 执行面不在静态测试面,由探针跑架双态实弹把门——1118 双态探针已落定(引擎 history
    pid 8afe0df4/146293f2+产物复测:旁路 p-final≡p3 MD5 逐字节一致、修脸远端 t=1s 帧 >12
    差分 24,467px),极性与接线一致,防 wf2api 反转坑。"""
    d, nodes, links = _load()
    arm = {25, 1065, 4100, 5002, 5006, 5011, 5012, 5013, 5014, 5015,
           5016, 5017, 5018, 5019, 5020, 5021, 5022, 5023, 5100}
    assert arm <= set(nodes), f"四采臂缺件: {arm - set(nodes)}"
    assert len(nodes) == 101, \
        "画布节点数=101(66+19 四采臂+lowvram役#1072+clip_vision#800+14 双档;1119 双档役)"
    assert nodes[1065]["type"] == "PrimitiveBoolean" and nodes[1065]["widgets_values"] == [False], \
        "[1065] 四采开关出厂必须 False(默认旁路,PRD 单向门#1)"
    assert nodes[25]["type"] == "PrimitiveStringMultiline" and \
        isinstance(nodes[25]["widgets_values"][0], str) and nodes[25]["widgets_values"][0].strip(), \
        "[25] 修脸身份提示词默认通用句非空"

    def src_of(nid, slot_name):
        s = next(e for e in nodes[nid]["inputs"] if e["name"] == slot_name)
        assert s.get("link") is not None, f"[{nid}].{slot_name} 未连线"
        return links[s["link"]]

    assert src_of(5002, "video")[1] == 4002, \
        "[5002] 拆帧必须内存态直吃 [4002](三采 p3 4K;1119 回正=用户裁定「三采 4K 后修脸」+融合役红旗(3053=开修脸丢三采超分);multiseg 3053 是 auto-context 墙专属,三采无此墙禁泛化)"
    assert src_of(5006, "model")[1] == 1001, "[5006] LoRA 必须复用 [1001] 单 loader"
    wl, hl = src_of(5012, "width"), src_of(5012, "height")
    assert (wl[1], nodes[5011]["outputs"][wl[2]]["name"]) == (5011, "canvas_w"), \
        "[5012].width 必须吃 [5011] canvas_w 出口联线(禁手填)"
    assert (hl[1], nodes[5011]["outputs"][hl[2]]["name"]) == (5011, "canvas_h"), \
        "[5012].height 必须吃 [5011] canvas_h 出口联线"
    assert src_of(5012, "length")[1] == 52 and src_of(5012, "ref_images.ref_image_0")[1] == 1 \
        and src_of(5012, "prompt")[1] == 25, "[5012] length←[52]/主图←[1]/提示词←[25]"
    assert src_of(5014, "audio")[1] == 5002, "[5014] 音轨锁吃 [5002]②音轨"
    assert nodes[5015]["widgets_values"][3:5] == [60.0, 200.0], "[5015] 逐帧 denoise 60/200(4K 源口径)"
    assert nodes[5018]["widgets_values"] == ["simple", 8, 0.45], "[5018] 修脸采样 simple/8步/0.45"
    assert nodes[5022]["widgets_values"][1:3] == [16, 24], "[5022] 贴回 mask_dilation=16/feather=24"
    sw = {i["name"]: links[i["link"]] for i in nodes[5100]["inputs"]}
    assert nodes[5100]["type"] == "ComfySwitchNode"
    assert sw["switch"][1] == 1065 and sw["on_true"][1] == 5113 and sw["on_false"][1] == 4002, \
        "[5100] 极性:switch←[1065]/on_true←[5113]出口(1119 等效改接,远景态经 5113 直通臂)·" \
        "on_false←[4002]p3 直通(1118 双态实测定谳:False=p-final≡p3 MD5 逐字节直通/True=修脸片;勿改防 wf2api 反转坑)"
    assert src_of(4100, "video")[1] == 5100, "[4100] 终档吃 [5100] 出口"
    assert nodes[4100]["widgets_values"][0] == "video/漫影/chapter-001/sb-chapter-001-001/p-final", \
        "[4100] 终档 prefix=p-final(纯增量口;3061/3071 锚零改动,PRD 单向门#3)"
    md9999_fr = nodes[9999]["widgets_values"][0]
    assert "## 四采修脸(内置·默认旁路·1118)" in md9999_fr, "README 9999「四采修脸」调用段必须在册"
    assert "bypass(1065=false)=直通" in md9999_fr and "repair(1065=true)=修脸" in md9999_fr, \
        "README 9999 极性口径=1118 双态实测定谳(bypass=直通/repair=修脸),外部参数 1065+25"


def test_facerefine_dual_mode_1119():
    """1119 修脸双技术档(11-19-dualmode-facerefine-rename,远景=默认/高清,出口复制案):
    1065(四采总开关,出厂 False)× 5111(高清子开关,出厂 False=远景档)四态矩阵;
    投切全官方件(ComfySwitchNode×2+PrimitiveBoolean)零自定义投切,防缓存静默串档
    (PRD §1.7)。生成器=apps/build/scripts/sancai_inline_facerefine_build_1118.py(唯一真源,
    5112 中链=生成器内隔离块 midchain_latent_switch_wiring,双态探针 P2 若证墙只改该函数)。
    静态面断言:节点 87→101/5111 默认 False/远景态数据流等效(5021→5022 直连+5022.masks
    悬空 face_only 保真+5024/5025 复制对 widgets 逐位同 5022/5023)/5112/5113 极性/
    高清段 widgets 逐位承融合件 1119b(5110 control=fixed)。实弹面(AC2/AC3/AC5)不在本测试。"""
    d, nodes, links = _load()
    hd = {5101, 5102, 5103, 5104, 5105, 5106, 5107, 5109, 5110,
          5111, 5112, 5113, 5024, 5025}
    assert hd <= set(nodes), f"双档段缺件: {hd - set(nodes)}"
    assert len(nodes) == 101, "画布节点数=101(87+14 双档)"

    def src_of(nid, slot_name):
        s = next(e for e in nodes[nid]["inputs"] if e["name"] == slot_name)
        assert s.get("link") is not None, f"[{nid}].{slot_name} 未连线"
        return links[s["link"]]

    assert nodes[5111]["type"] == "PrimitiveBoolean" and nodes[5111]["widgets_values"] == [False], \
        "[5111] 高清子开关出厂必须 False(远景=默认修脸档,PRD 裁决 2)"
    # 5112 中链 LATENT Switch(唯一;隔离块=探针 P2 对象)
    sw12 = {i["name"]: links[i["link"]] for i in nodes[5112]["inputs"]}
    assert nodes[5112]["type"] == "ComfySwitchNode"
    assert (sw12["switch"][1], sw12["on_false"][1], sw12["on_true"][1]) == (5111, 5013, 5107), \
        "[5112] 中链极性:switch←[5111]/on_false←[5013]直通(远景态数据流等效 1118)/on_true←[5107]遮罩潜空间"
    assert src_of(5014, "av_latent")[1] == 5112, \
        "[5014].av_latent 必须吃 [5112] 出口(原 859 直连线等效改接,PRD §1.2 两处等效改接之一)"
    # 5113 出口 VIDEO Switch
    sw13 = {i["name"]: links[i["link"]] for i in nodes[5113]["inputs"]}
    assert nodes[5113]["type"] == "ComfySwitchNode"
    assert (sw13["switch"][1], sw13["on_false"][1], sw13["on_true"][1]) == (5111, 5023, 5025), \
        "[5113] 出口极性:switch←[5111]/on_false←[5023]远景/on_true←[5025]高清"
    assert src_of(5100, "on_true")[1] == 5113, \
        "[5100].on_true 必须吃 [5113] 出口(原 5023 直连线等效改接)"
    # 远景臂零语义改写(AC4:远景态=正典现状数据流等效)
    assert src_of(5022, "refined_crops")[1] == 5021, "[5022].refined_crops 直连 [5021](871 线零改写)"
    m22 = next(e for e in nodes[5022]["inputs"] if e["name"] == "masks")
    assert m22.get("link") is None and m22.get("shape") == 7, \
        "[5022].masks 恒悬空 shape7(face_only 脸框贴回=正典现状;验尸 V1:全 1 SolidMask≠悬空,禁 mask 投切)"
    # 高清复制对 widgets 逐位同 5022/5023
    assert nodes[5024]["widgets_values"] == nodes[5022]["widgets_values"], \
        "[5024] 高清贴回 widgets 必须逐位同 [5022](出口复制案)"
    assert nodes[5025]["widgets_values"] == nodes[5023]["widgets_values"], \
        "[5025] 高清合成 widgets 必须逐位同 [5023]"
    # 5024 四进口 + SAM3 mask 路B(贴回约束)
    assert (src_of(5024, "masks")[1], src_of(5024, "refined_crops")[1],
            src_of(5024, "base_images")[1], src_of(5024, "transform")[1]) == (5104, 5110, 5002, 5011), \
        "[5024] masks←[5104](SAM3 贴回约束,只进高清对)/refined_crops←[5110](VOSR2)/base←[5002]/transform←[5011]"
    assert (src_of(5025, "images")[1], src_of(5025, "audio")[1]) == (5024, 5002), \
        "[5025] images←[5024]/audio←[5002]②"
    # 高清段链与参数(逐位承融合件 1119b;差分扩散 5108 禁回加)
    assert (src_of(5103, "images")[1], src_of(5103, "model")[1], src_of(5103, "conditioning")[1]) \
        == (5011, 5101, 5102), "[5103] SAM3:images←[5011].crops/model←[5101]/conditioning←[5102]"
    assert (src_of(5104, "track_data")[1], src_of(5105, "masks")[1], src_of(5106, "masks")[1],
            src_of(5106, "vae")[1], src_of(5107, "mask")[1], src_of(5107, "samples")[1]) \
        == (5103, 5104, 5105, 1003, 5106, 5013), \
        "mask 路A(潜空间限区):5103→5104→5105→5106(vae←[1003])→5107(samples←[5013])"
    assert (src_of(5110, "model")[1], src_of(5110, "image")[1]) == (5109, 5021), \
        "VOSR2 尾档:5109→5110(image←[5021])"
    assert 5108 not in nodes, "[5108] 差分扩散已移除(1119 定谳 dn0.45 反噬,禁回加)"
    assert nodes[5103]["widgets_values"] == [0.5, 1, 1], "[5103] SAM3 widgets=0.5/1/1"
    assert nodes[5105]["widgets_values"] == [0.3, "shrink_grow", 12, 4, 16], "[5105] MVEx 清洗 widgets"
    assert nodes[5106]["widgets_values"] == ["auto", "max", "max", 36, 1, "both"], "[5106] MVEx 入潜 widgets"
    assert nodes[5109]["widgets_values"] == ["VOSR2", "default"], "[5109] VOSR2 加载 widgets"
    assert nodes[5110]["widgets_values"] == [1, 300831622214023, "fixed", "wavelet", 512, 32, 1024, 32], \
        "[5110] VOSR2 widgets:seed 锁 300831622214023/control=**fixed**(禁 randomize 回抖,任务约束 B③)"
    assert nodes[5101]["widgets_values"] == ["sam3.1_multiplex_fp16.safetensors"], "[5101] SAM3 检查点"
    assert nodes[5102]["widgets_values"] == ["face"], "[5102] SAM3 文本提示"
    # README 1119 调用段(四态矩阵+非法态+极性延伸)
    md = nodes[9999]["widgets_values"][0]
    assert "### 1119 双档调用(远景=默认 / 高清)" in md and "非法态" in md, \
        "README 9999 必须载 1119 双档调用段(四态矩阵+非法态对策,PRD 修订#15)"


def test_stage3_relayvsr_inline_group():
    """1113 用户令「ReCaVSR 已稳不需要兜底,删 RelayVSR 相关节点」:[268][269]
    删除零残留;回退能力由 7_测试/三采-单镜-RelayVSR-1110.json 存档承载
    (1119 历史锚:该件名=1110 主线终名,随 3.3 留档不改名,改名役豁免)。"""
    _, nodes, links = _load()
    relay = [nid for nid, n in nodes.items() if "RelayVSR" in n["type"]]
    assert not relay, f"主线不得残留 RelayVSR 件(1113 用户令删): {relay}"
    assert 268 not in nodes and 269 not in nodes, "[268][269] 应已删"
    archive = WF_DIR.parent / "7_测试" / "三采-单镜-RelayVSR-1110.json"
    assert archive.exists(), "RelayVSR 回退存档件应在 7_测试 在册"


def test_stage3_recavsr_mainline_arm():
    """1111 换防主线臂:[4001]ReCaVSRLoader(int8 ConvRot)→[4002]ReCaVSRUpscale
    (scale2.667/fast/flashdecoder)→[4003]SaveVideo(p3-recavsr);二采[3053]直喂;
    1440×832→2880×1664,交付层归一 1080(对称旧口径);实弹=同档对拍 59.1s vs
    RelayVSR 185.6s(3.14×),PSNR 对源保真 35.7(生成系加细节)。"""
    d, nodes, links = _load()
    assert nodes[4001]["type"] == "ReCaVSRLoader"
    assert nodes[4001]["mode"] == 0 and nodes[4001]["widgets_values"] == ["transformer_int8_convrot.safetensors"]
    assert nodes[4002]["type"] == "ReCaVSRUpscale"
    assert nodes[4002]["mode"] == 0
    w = nodes[4002]["widgets_values"]
    assert abs(w[0] - 2.667) < 1e-6, "scale=2.667:1440×832→3840×2220(4K UHD 宽)"
    assert w[5] == "fast" and w[4] == "flashdecoder", "kernels=fast / decoder=flashdecoder"
    assert nodes[4003]["type"] == "SaveVideo" and nodes[4003]["mode"] == 0
    assert nodes[4003]["widgets_values"][0] == "video/漫影/chapter-001/sb-chapter-001-001/p3-recavsr"
    # 接线:780=[3053]→[4002].video / 781=[4001]→[4002].model / 782=[4002]→[4003]
    l780 = links[780]; l781 = links[781]; l782 = links[782]
    assert (l780[1], l780[3], l780[5]) == (3053, 4002, "VIDEO"), "三采主臂直吃二采 CreateVideo[3053]"
    assert (l781[1], l781[3], l781[5]) == (4001, 4002, "RECAVSR"), "模型链型=RECAVSR(作者件槽型原样)"
    assert (l782[1], l782[3], l782[5]) == (4002, 4003, "VIDEO")
    assert d["last_node_id"] >= 4003 and d["last_link_id"] >= 782, "计数器不落后(1033/776 落后雷刻碑)"
