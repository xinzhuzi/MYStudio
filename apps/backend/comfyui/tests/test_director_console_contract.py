"""导演台工作流契约测试(11-12-h3-director-console,design §5 十一条)。

被测对象 = 仓库真源 `2_视频/H3视频/1_漫影自研/导演台.json`(生成器
apps/build/scripts/director_console_build_1112.py 幂等产出;母本
0_单镜视频/三采-单镜.json,克隆源逐 id 对账=research/anatomy-1112.md A 节)。
零引擎依赖纯静态;禁手改产物 JSON——一切改动回生成器。

结构:SHARED(119/120/127/128/219/338/103)恒原 id 单源扇出三镜;SHOT_TEMPLATE
(一采35+二采17+三采2)每镜克隆 id+1000k;新造 3000/3001 草片拼+3300 系三采
文件化入口+4000/4001/4002 说明卡。链 id 全量重编号 1..N;outputs 由链表全量重建。

锚偏差备注(实况对 design):
  §5-10 树锚 design 写 144(起草时树 143);生成时 1_图片/MiniMax/ 已落 2 件(树 145),
  导演台 +1 → 146。锚随实况;树再漂移须连生成器 TREE_ANCHOR 同改。

开关语义修正备注(1112 深检 F1):
  母本 [219] 出厂 true 而 ComfySwitchNode 语义 on_true 真,母本接线 on_true←i2v 臂
  (251/220 系)系母本文案倒挂(出厂实跑 i2v,与 219 title/Note103/台本卡「√=r2v」相悖)。
  导演台生成器克隆链后处理交换两臂槽位引用——导演台 on_true=r2v 臂/on_false=i2v 臂。
  §5-6 断言方向已随之改向;母本零改动,母本修复候用户另裁。
"""
from __future__ import annotations

import json
from pathlib import Path

WF = (Path(__file__).resolve().parents[1] / "workflows" / "2_视频" / "H3视频"
      / "1_漫影自研" / "导演台.json")
MOTHER = (Path(__file__).resolve().parents[1] / "workflows" / "2_视频" / "H3视频"
          / "1_漫影自研" / "三采-单镜.json")
WORKFLOWS_ROOT = Path(__file__).resolve().parents[1] / "workflows"

K_OFF = tuple(1000 * k for k in range(3))
FIRST_STAGE = {
    9, 14, 16, 20, 22, 110, 111, 112, 113, 121, 122, 123, 125, 126, 129, 130, 131,
    140, 145, 204, 216, 217, 218, 220, 221, 222, 250, 251,
    260, 261, 262, 263, 264, 265, 266,
}
SECOND_STAGE = {4, 100, 202, 203, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 223, 267}
THIRD_STAGE = {339, 340}
SHARED = {103, 119, 120, 127, 128, 219, 338}
TREE_ANCHOR = 145  # design §5-10 写 144(时树 143);实况 145+1,见模块 docstring


def _load():
    assert WF.exists(), f"工作流真源缺失: {WF}"
    d = json.loads(WF.read_text(encoding="utf-8"))
    return d, {n["id"]: n for n in d["nodes"]}, d["links"]


def _wget(node: dict, named_key: str, pos_idx: int):
    """widget 取值:named 优先(named 在位时前端以其为准),缺则回退位置序。"""
    named = node.get("widgets_values_named")
    if isinstance(named, dict) and named_key in named:
        return named[named_key]
    return node["widgets_values"][pos_idx]


def _links_between(links, frm, to, to_slot=None):
    return [l for l in links if l[1] == frm and l[3] == to
            and (to_slot is None or l[4] == to_slot)]


def _rect(node):
    x, y = node["pos"][0], node["pos"][1]
    return (x, y, x + node.get("size", [0, 0])[0], y + node.get("size", [0, 0])[1])


def _grect(g):
    bx, by, bw, bh = g["bounding"]
    return (bx, by, bx + bw, by + bh)


# ── §5-1 json 有效 + id 全件无重复 ────────────────────────────────────
def test_json_valid_and_unique_ids():
    doc, nodes, links = _load()
    assert len(nodes) == len(doc["nodes"]), "节点 id 重复"
    ids = [l[0] for l in links]
    assert len(set(ids)) == len(ids), f"链 id 重复: {sorted({i for i in ids if ids.count(i) > 1})}"
    assert len(doc["nodes"]) == 177, f"节点总数 {len(doc['nodes'])} != 177(3×54 模板+7 SHARED+8 新造)"


# ── §5-2 悬空引用双向扫 + outputs 重建一致性 ─────────────────────────
def test_no_dangling_refs_and_outputs_rebuild():
    doc, nodes, links = _load()
    link_ids = {l[0] for l in links}
    for l in links:
        lid, frm, fslot, to, tslot, _ = l
        assert frm in nodes, f"链 {lid} from 节点 {frm} 不存在"
        assert to in nodes, f"链 {lid} to 节点 {to} 不存在"
        assert fslot < len(nodes[frm].get("outputs", [])), f"链 {lid} from_slot 越界(node {frm})"
        assert tslot < len(nodes[to].get("inputs", [])), f"链 {lid} to_slot 越界(node {to})"
    for n in doc["nodes"]:
        for i, inp in enumerate(n.get("inputs", [])):
            lk = inp.get("link")
            assert lk is None or lk in link_ids, \
                f"节点 {n['id']} 输入槽 {i}({inp.get('name')}) 引用悬空链 {lk}"
        for si, out in enumerate(n.get("outputs", [])):
            expect = [l[0] for l in links if l[1] == n["id"] and l[2] == si]
            assert out.get("links", []) == expect, \
                f"节点 {n['id']} 输出槽 {si}({out.get('name')}) 重建不一致: {out.get('links')} != {expect}"


# ── §5-3 SHARED 恰一份 ────────────────────────────────────────────────
def test_shared_single_copy():
    doc, nodes, _ = _load()
    for sid in (119, 120, 127, 128, 219, 338):
        hits = [n["id"] for n in doc["nodes"] if n["id"] == sid]
        assert hits == [sid], f"SHARED [{sid}] 应恰一份,实得 {hits}"
    # 单源反证:不得存在 +1000k 克隆位
    clones = [sid + off for sid in (119, 120, 127, 128, 219, 338) for off in (1000, 2000)]
    leaked = [c for c in clones if c in nodes]
    assert not leaked, f"SHARED 克隆泄漏: {leaked}"


# ── §5-4 每镜节点花名册 ───────────────────────────────────────────────
def test_per_shot_node_roster():
    _, nodes, _ = _load()
    for k, off in enumerate(K_OFF):
        for nid, ntype in ((16 + off, "MiniMaxH3ReferenceToVideo"),
                           (220 + off, "MiniMaxH3ImageToVideo"),
                           (204 + off, "SaveVideo"), (4 + off, "SaveVideo"),
                           (340 + off, "SaveVideo"), (3300 + k, "LoadVideo")):
            assert nodes[nid]["type"] == ntype, \
                f"镜{k + 1} [{nid}] 应为 {ntype},实为 {nodes[nid]['type']}"
    counts = {}
    for n in nodes.values():
        counts[n["type"]] = counts.get(n["type"], 0) + 1
    # R2V 全局 6 = 一采锚 16+k ×3 + 二采条件 208+k ×3(同为该类);I2V 仅 220+k ×3
    assert counts.get("MiniMaxH3ReferenceToVideo") == 6, counts.get("MiniMaxH3ReferenceToVideo")
    assert counts.get("MiniMaxH3ImageToVideo") == 3, counts.get("MiniMaxH3ImageToVideo")
    assert counts.get("SaveVideo") == 10, f"SaveVideo 应 9 镜内+3001 草片=10,实 {counts.get('SaveVideo')}"
    assert counts.get("LoadVideo") == 3, counts.get("LoadVideo")


# ── §5-5 模型钉值 ─────────────────────────────────────────────────────
def test_model_pins():
    _, nodes, _ = _load()
    assert _wget(nodes[127], "unet_name", 0) == "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
    assert _wget(nodes[128], "clip_name", 0) == "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    assert _wget(nodes[119], "vae_name", 0) == "minimax_h3_video_vae_int8_convrot.safetensors"
    assert _wget(nodes[120], "vae_name", 0) == "minimax_h3_audio_vae_fp32.safetensors"
    assert _wget(nodes[338], "transformer", 0) == "transformer_int8_convrot.safetensors"
    for k, off in enumerate(K_OFF):
        assert (_wget(nodes[145 + off], "lora_name", 0), _wget(nodes[145 + off], "strength_model", 1)) \
            == ("pika_h3_flex_ref2va_comfy_bf16.safetensors", 1), f"镜{k + 1} [145+{off}] ref2va 钉值漂移"
        assert (_wget(nodes[216 + off], "lora_name", 0), _wget(nodes[216 + off], "strength_model", 1)) \
            == ("pika_turbo_8step_fl2va.safetensors", 1), f"镜{k + 1} [216+{off}] fl2va 钉值漂移"
        assert (_wget(nodes[202 + off], "lora_name", 0), _wget(nodes[202 + off], "strength_model", 1)) \
            == ("taomate_h3_3step.safetensors", 0.7), f"镜{k + 1} [202+{off}] taomate 钉值漂移"


# ── §5-6 σ接线(i2v 臂有 σshift,r2v 臂无)────────────────────────────
def test_sigma_wiring():
    _, nodes, links = _load()
    for k, off in enumerate(K_OFF):
        assert nodes[251 + off]["type"] == "MiniMaxH3SigmaShift", f"镜{k + 1} [{251 + off}] 应为 σshift"
        assert nodes[251 + off]["widgets_values"][:2] == [6, 3], \
            f"镜{k + 1} [{251 + off}] σshift 应 [6,3],实 {nodes[251 + off]['widgets_values']}"
        assert _links_between(links, 217 + off, 251 + off), f"镜{k + 1} 缺 217→251(i2v 臂进 σshift)"
        assert _links_between(links, 251 + off, 250 + off), f"镜{k + 1} 缺 251→250"
        # F1 修正后方向:i2v 臂走 on_false、r2v 臂走 on_true(母本倒挂已由生成器交换)
        assert _links_between(links, 251 + off, 218 + off, to_slot=1), \
            f"镜{k + 1} 缺 251→218.on_false(slot1)(F1 修正后 i2v 臂走 on_false)"
        assert _links_between(links, 140 + off, 218 + off, to_slot=2), \
            f"镜{k + 1} 缺 140→218.on_true(slot2)(F1 修正后 r2v 臂走 on_true)"
        # r2v 臂断言无 σshift 下游:140+k 的全部出线只进 218+k.on_true
        stray = [l for l in links if l[1] == 140 + off and not (l[3] == 218 + off and l[4] == 2)]
        assert not stray, f"镜{k + 1} [140+{off}] 出线越界(不得有 σshift 下游): {stray}"


# ── §5-7 二采红线照母本 ───────────────────────────────────────────────
def test_second_stage_redlines():
    _, nodes, _ = _load()
    for k, off in enumerate(K_OFF):
        assert nodes[209 + off]["widgets_values"][:3] == ["simple", 3, 0.2], \
            f"镜{k + 1} [209+{off}] 应 simple/3步/dn0.2,实 {nodes[209 + off]['widgets_values']}"
        assert _wget(nodes[123 + off], "sampler_name", 0) == "lcm", \
            f"镜{k + 1} [123+{off}] 采样器必须 lcm(Euler→片尾乱码红线)"
        assert nodes[203 + off]["widgets_values"][:2] == [12, 3], \
            f"镜{k + 1} [203+{off}] 二采 σshift 应 [12,3]"


# ── §5-8 mode 门控 ────────────────────────────────────────────────────
def test_mode_gating():
    _, nodes, _ = _load()
    for k, off in enumerate(K_OFF):
        for nid in sorted(FIRST_STAGE):
            assert nodes[nid + off]["mode"] == 0, f"镜{k + 1} 一采件 [{nid + off}] mode!=0"
        for nid in sorted(SECOND_STAGE | THIRD_STAGE):
            assert nodes[nid + off]["mode"] == 2, f"镜{k + 1} 二三采件 [{nid + off}] mode!=2"
        assert nodes[3300 + k]["mode"] == 2, f"镜{k + 1} [3300+{k}] 三采入口 mode!=2"
    for sid in sorted(SHARED):
        assert nodes[sid]["mode"] == 0, f"SHARED [{sid}] mode!=0"
    assert nodes[3000]["mode"] == 0 and nodes[3001]["mode"] == 0, "草片拼组应 mode=0"
    assert nodes[4000]["mode"] == 2 and nodes[4001]["mode"] == 2, "桥/口型锁说明卡应 mode=2(预留)"


# ── §5-9 组框罩全 + 类白名单 ──────────────────────────────────────────
def test_group_coverage_and_class_whitelist():
    doc, nodes, _ = _load()
    groups = doc["groups"]
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            a, b = _grect(groups[i]), _grect(groups[j])
            ox, oy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            assert not (ox > 0 and oy > 0), \
                f"组 {groups[i]['id']}×{groups[j]['id']} bbox 相交(1109 口径零交集)"
    for n in doc["nodes"]:
        if n["type"] == "MarkdownNote":
            continue  # 契约豁免:说明卡不强制入组
        r = _rect(n)
        inside = [g["id"] for g in groups
                  if r[0] >= _grect(g)[0] and r[1] >= _grect(g)[1]
                  and r[2] <= _grect(g)[2] and r[3] <= _grect(g)[3]]
        assert len(inside) == 1, f"节点 [{n['id']}]({n['type']}) 组归属={inside},应恰一组"
    mother_types = {n["type"] for n in json.loads(MOTHER.read_text(encoding="utf-8"))["nodes"]}
    bad = {n["type"] for n in doc["nodes"]} - mother_types - {"ConcatenateVideo", "LoadVideo", "MarkdownNote"}
    assert not bad, f"类白名单(母本类集+3 新类)之外: {bad}"


# ── §5-10 树计数锚 ────────────────────────────────────────────────────
def test_tree_count_anchor():
    count = len(list(WORKFLOWS_ROOT.rglob("*.json")))
    assert count == TREE_ANCHOR, \
        f"workflows 树 rglob *.json={count} != 锚 {TREE_ANCHOR}(design 起草 144/时树 143;" \
        "实况 MiniMax+2 后 145,导演台+1=146;树漂移须连生成器 TREE_ANCHOR 与清单锚同改)"


# ── §5-11 草片拼三入口 + 三采文件化接线 ──────────────────────────────
def test_concat_and_loadvideo_wiring():
    _, nodes, links = _load()
    assert nodes[3000]["type"] == "ConcatenateVideo", f"[3000] 应为 ConcatenateVideo"
    for k, off in enumerate(K_OFF):
        got = _links_between(links, 130 + off, 3000, to_slot=k)
        assert got and got[0][5] == "VIDEO", \
            f"镜{k + 1} 缺 130+{off}→3000.video_{k + 1}(VIDEO) 接线"
        got = _links_between(links, 3300 + k, 339 + off, to_slot=1)
        assert got and got[0][5] == "VIDEO", \
            f"镜{k + 1} 缺 3300+{k}→339+{off}(VIDEO slot1) 三采文件化接线"
    assert _links_between(links, 3000, 3001), "缺 3000→3001 草片落盘接线"


# ── §5-13 i2v 臂陈旧入参回归闸(引擎 0.45.2 已无 audio_vae,1112 补测实踩) ──
def test_i2v_arm_no_stale_audio_vae():
    _, nodes, links = _load()
    for off in (0, 1000, 2000):
        n = nodes[220 + off]
        names = [i.get("name") for i in n.get("inputs", [])]
        assert "audio_vae" not in names, \
            f"[{220 + off}] MiniMaxH3ImageToVideo 不得声明 audio_vae 槽(引擎 0.45.2 无此参,实弹 TypeError)"
    targets = {l[3] for l in links}
    for off in (0, 1000, 2000):
        assert 220 + off in targets, f"[{220 + off}] i2v 臂应仍有 conditioning 入线"


# ── §5-12 模式开关扇出与方向(F1 修正后)+ F3 title 文案 ───────────────
def test_mode_switch_semantics():
    _, nodes, links = _load()
    # ③ 219 出厂 widgets=[true]
    assert nodes[219]["widgets_values"] == [True], \
        f"[219] 出厂应 widgets [true], 实 {nodes[219]['widgets_values']}"
    # ① 219 恰扇出 9 链,全进三镜 218/221/222 的 switch 槽(slot0)
    fanout = [l for l in links if l[1] == 219]
    expect = {b + off for b in (218, 221, 222) for off in K_OFF}
    assert len(fanout) == 9, f"[219] 应恰扇出 9 链(三镜×三开关), 实 {len(fanout)}"
    assert {l[3] for l in fanout} == expect, \
        f"[219] 扇出目标应=三镜 218/221/222 全体, 实 {sorted({l[3] for l in fanout})}"
    assert all(l[4] == 0 for l in fanout), f"[219] 扇出应全进 switch 槽(slot0), 实 {[(l[3], l[4]) for l in fanout]}"
    # ② 方向:on_true 恒←r2v 臂、on_false 恒←i2v 臂(母本倒挂由生成器克隆链后处理交换)
    for k, off in enumerate(K_OFF):
        for sw, t_src, f_src, arm in (
            (218 + off, 140 + off, 251 + off, "底模"),   # r2v=140 直供 / i2v=251 σshift
            (221 + off, 16 + off, 220 + off, "条件"),     # r2v=16 / i2v=220
            (222 + off, 16 + off, 220 + off, "潜空间"),   # r2v=16 / i2v=220
        ):
            names = [i.get("name") for i in nodes[sw]["inputs"]]
            it, if_ = names.index("on_true"), names.index("on_false")
            assert _links_between(links, t_src, sw, to_slot=it), \
                f"镜{k + 1} {arm}开关 [{sw}].on_true 应←r2v 臂 [{t_src}](F1 倒挂修正)"
            assert _links_between(links, f_src, sw, to_slot=if_), \
                f"镜{k + 1} {arm}开关 [{sw}].on_false 应←i2v 臂 [{f_src}](F1 倒挂修正)"
        assert _links_between(links, 251 + off, 250 + off), \
            f"镜{k + 1} [250+{off}] 应恒吃 [251+{off}](母本刻意接线,不动)"
    # F3:206+k/208+k title 陈旧文案 1280×704 已换 1440×832
    for off in K_OFF:
        for nid in (206 + off, 208 + off):
            t = nodes[nid].get("title") or ""
            assert "1440×832" in t and "1280×704" not in t, \
                f"[{nid}] title 应含 1440×832 且无陈旧 1280×704, 实 {t!r}"


# ── 出厂 widget 覆写与交付链接线 ──────────────────────────────────────
def test_factory_widgets_and_delivery_wiring():
    _, nodes, links = _load()
    for k, off in enumerate(K_OFF):
        # ④ 一采出图档 960×544×124f(16+k r2v 锚 / 220+k i2v 首帧)
        for nid in (16 + off, 220 + off):
            assert nodes[nid]["widgets_values"][1:4] == [960, 544, 124], \
                f"镜{k + 1} [{nid}] 应 960×544×124f, 实 {nodes[nid]['widgets_values'][1:4]}"
        # ⑤ 二采终档 206+k widgets 1440×832
        assert nodes[206 + off]["widgets_values"][2:4] == [1440, 832], \
            f"镜{k + 1} [{206 + off}] 二采终档应 1440×832, 实 {nodes[206 + off]['widgets_values'][2:4]}"
        # ⑥ 每镜 seed 42/142/242(fixed)
        assert nodes[129 + off]["widgets_values"][0] == 42 + 100 * k, \
            f"镜{k + 1} [{129 + off}] seed 应 {42 + 100 * k}, 实 {nodes[129 + off]['widgets_values'][0]}"
        assert _wget(nodes[129 + off], "control_after_generate", 1) == "fixed", \
            f"镜{k + 1} [{129 + off}] seed 应 fixed"
        # ⑦ 交付前缀 p1-draft / p2-final / p3-final
        assert _wget(nodes[204 + off], "filename_prefix", 0) == \
            f"video/漫影/chapter-001/sb-chapter-001-{k + 1:03d}/p1-draft", \
            f"镜{k + 1} [{204 + off}] 前缀应 p1-draft"
        assert _wget(nodes[4 + off], "filename_prefix", 0) == \
            f"video/漫影/chapter-001/sb-chapter-001-{k + 1:03d}/p2-final", \
            f"镜{k + 1} [{4 + off}] 前缀应 p2-final"
        assert _wget(nodes[340 + off], "filename_prefix", 0) == \
            f"video/漫影/chapter-001/sb-chapter-001-{k + 1:03d}/p3-final", \
            f"镜{k + 1} [{340 + off}] 前缀应 p3-final"
        # ⑧ 三采文件化:338→339+k(SHARED 扇出)与 339+k→340+k 在册
        assert _links_between(links, 338, 339 + off), f"镜{k + 1} 缺 338→{339 + off}"
        assert _links_between(links, 339 + off, 340 + off), f"镜{k + 1} 缺 {339 + off}→{340 + off}"
    # ⑦ 3001 草片拼前缀 p1-draft-concat
    assert _wget(nodes[3001], "filename_prefix", 0) == "video/漫影/chapter-001/p1-draft-concat", \
        f"[3001] 前缀应 p1-draft-concat, 实 {_wget(nodes[3001], 'filename_prefix', 0)!r}"
    # ⑨ 3300+k file widget 为非空字符串(API 形态防丢参)
    for k in range(3):
        w = nodes[3300 + k]["widgets_values"][0]
        assert isinstance(w, str) and w, f"[3300+{k}] file widget 应非空字符串, 实 {w!r}"
