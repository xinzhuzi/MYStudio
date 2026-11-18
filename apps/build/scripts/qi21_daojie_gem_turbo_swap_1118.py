#!/usr/bin/env python3
"""qi21 道劫两画布 · Gem② 换装发车 · 1118(方案已复核,手术真源=本件)。

每画布恰改四点(1118 用户令,donor=同件加速子图官方 turbo 臂 7:7028/7:7030):
  1. [8112] LoraLoaderModelOnly:viggle r256 → 官方 turbo r178 ×1
     (index0 换名;index1 strength=1 保持=donor 7028 现值 1.0);
  2. [8117] TextEncodeQwenImage21:人脸修复域旧句 → 全域插画超分域新句
     (仅 index0;negative 空/resolution 0 不动);
  3. [8118] KSampler:steps 6→8(仅 index2;seed=0/"fixed"/cfg=1/"euler"/
     "simple"/denoise=1 六位逐字节不动——1118 硬边界:donor 只取 LoRA 本件+
     步数,禁镜像 sampler/scheduler/cfg/denoise/超分结构/拼缝参数);
  4. 组 7 题名:「道劫·⑤b·Gem分块超分·2K」→「道劫·⑤b·Gem分块超分」
     (id=7 锚定;bounding/color 不动)。

fail-closed:术前态逐位断言(旧值/新值二态机,半改态或异构态退出非零);
幂等:已换装态复跑=无变化退出 0(回滚到旧值后可再发车)。
零扰动:before/after 深比对差异恰=四点路径,其余全等。

A 硬边界明示不动清单(断言+深比对双保险,本脚本禁改):
  [8116]=[10,2,256,32,64,True]、[8120]=[1,"translation",64,0]、
  守卫三件 8108(无 widgets_values)/8109/8110、加载器栈 8111/8113(mikkoani
  0.6)/8114/8115、20 根 link(8217-8236)整表、SeedVR mode4 五节点(503+
  f0a844a8 内四件)、加速子图 7014-7031 全件含 7015 现值「4 · PrunaAI 6步」、
  其余全部顶层键(config/extensions/extra/seed_widgets/…)与 wiringNotes 背景。

节点 title(8112/8118 旧题名随换装失真)为发令人保留决策点,本脚本不改
(title 非 widget,1118 硬边界保守读法;graft TITLES 表同不改)。

用法:
  python3 apps/build/scripts/qi21_daojie_gem_turbo_swap_1118.py           # 发车(旧态→新态;新态=幂等跳过)
  python3 apps/build/scripts/qi21_daojie_gem_turbo_swap_1118.py --check   # 只验不改(两画布应处新态)
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CANVASES = {
    "t2i": REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json",
    "i2i": REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json",
}

NEW_LORA = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"
OLD_LORA = "Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors"
NEW_PROMPT = ("Upscale this illustration to ultra-high definition: remove blur, "
              "noise and compression artifacts, recover crisp linework, clean "
              "flat color planes and fine detail across figures, garments, "
              "scenery, architecture and props, keeping the same composition, "
              "characters, identities and hand-drawn Chinese guofeng anime "
              "style unchanged.")
OLD_PROMPT = ("Restore the photo: remove blur, noise and compression artifacts, "
              "recover sharp natural facial detail, clean skin texture, hair strands "
              "and lip texture, keeping the same composition, identity and people.")

OLD_WIDGETS = {
    8112: [OLD_LORA, 1],
    8117: [OLD_PROMPT, "", 0],
    8118: [0, "fixed", 6, 1, "euler", "simple", 1],
}
NEW_WIDGETS = {
    8112: [NEW_LORA, 1],
    8117: [NEW_PROMPT, "", 0],
    8118: [0, "fixed", 8, 1, "euler", "simple", 1],
}
OLD_GROUP_TITLE = "道劫·⑤b·Gem分块超分·2K"
NEW_GROUP_TITLE = "道劫·⑤b·Gem分块超分"

SEEDVR_SG = "f0a844a8-9bf5-4c71-8af5-f1c9f17c0324"
SEEDVR_SG_IDS = (501, 502, 7401, 7402)
ACCEL_SG_NAME = "道劫·加速子图"
SIGMA9 = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"

# ── A 硬边界不动清单(widgets 逐位;graft WIDGETS 表同源)──────────────────
HARD_BORDER = {
    8108: None,                                    # 整键省略 widgets_values
    8109: ["min(1, 1024 / max(a, b))"],
    8110: ["lanczos", 1],
    8111: ["qwen_image_2.1_int8_convrot.safetensors", "default"],
    8113: ["qi21-mikkoani.safetensors", 0.6],      # 1118 B 案,不动
    8114: ["qwen3vl_8b_int8_convrot.safetensors", "qwen_image", "default"],
    8115: ["qwen_image_2.1_vae_bf16.safetensors"],
    8116: [10, 2, 256, 32, 64, True],
    8119: None,
    8120: [1, "translation", 64, 0],
}
# 20 根 link 整表(graft LINKS 同源逐字;8217-8236)
LINKS = (
    (8217, 7500, 0, 8108, 0, "IMAGE"), (8218, 7500, 0, 8110, 0, "IMAGE"),
    (8219, 8108, 0, 8109, 0, "INT"), (8220, 8108, 1, 8109, 1, "INT"),
    (8221, 8109, 0, 8110, 2, "FLOAT"), (8222, 8110, 0, 8116, 0, "IMAGE"),
    (8223, 8111, 0, 8112, 0, "MODEL"), (8224, 8112, 0, 8113, 0, "MODEL"),
    (8225, 8113, 0, 8118, 0, "MODEL"), (8226, 8114, 0, 8117, 0, "CLIP"),
    (8227, 8115, 0, 8117, 4, "VAE"), (8228, 8116, 0, 8117, 1, "IMAGE"),
    (8229, 8117, 0, 8118, 1, "CONDITIONING"), (8230, 8117, 1, 8118, 2, "CONDITIONING"),
    (8231, 8117, 2, 8118, 3, "LATENT"), (8232, 8118, 0, 8119, 0, "LATENT"),
    (8233, 8115, 0, 8119, 1, "VAE"), (8234, 8119, 0, 8120, 0, "IMAGE"),
    (8235, 8116, 1, 8120, 1, "ITSGEM_TILE_STITCHER"), (8236, 8120, 0, 504, 0, "IMAGE"),
)
# 加速子图 donor 锚(1118 换装 donor=官方 turbo 臂现值;7015 现值禁顺手改)
ACCEL_ANCHOR = {
    7014: [0, "fixed"],
    7015: ["4 · PrunaAI 6步"],
    7017: [0, "fixed"],
    7018: ["euler"],
    7028: [NEW_LORA, 1.0],
    7029: [],
    7030: [SIGMA9],
    7031: [],
}


class Fail(AssertionError):
    pass


def need(cond: bool, msg: str) -> None:
    if not cond:
        raise Fail(msg)


def deep_diff(a, b, path=()):
    """全树深比对,返回不等路径列(叶级;dict 缺键=键路径,list 异长=路径+__len__)。"""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b), key=str):
            if k not in a or k not in b:
                out.append(path + (k,))
            else:
                out.extend(deep_diff(a[k], b[k], path + (k,)))
        return out
    if isinstance(a, list) and isinstance(b, list):
        out = [] if len(a) == len(b) else [path + ("__len__",)]
        for i, (x, y) in enumerate(zip(a, b)):
            out.extend(deep_diff(x, y, path + (i,)))
        return out
    return [] if a == b and type(a) is type(b) else [path]


def check_hard_border(name: str, wf: dict) -> None:
    """A 硬边界不动清单断言(旧态/新态两态都得过;漂移即拒发)。"""
    nodes = {n["id"]: n for n in wf["nodes"]}
    for nid, want in HARD_BORDER.items():
        need(nid in nodes, f"{name}: 硬边界缺节点 {nid}")
        if want is None:
            need("widgets_values" not in nodes[nid],
                 f"{name}: {nid} 应整键省略 widgets_values")
        else:
            need(nodes[nid].get("widgets_values") == want,
                 f"{name}: {nid} widgets 漂移: {nodes[nid].get('widgets_values')!r} ≠ {want!r}")
    links = {l[0]: tuple(l) for l in wf["links"]}
    for l in LINKS:
        need(links.get(l[0]) == l, f"{name}: link {l[0]} 缺失或形不符(硬边界 8217-8236)")
    # SeedVR mode4 五节点(503 顶层宿主 + f0a844a8 内四件)
    need(nodes.get(503, {}).get("mode") == 4, f"{name}: 503 mode 应 4(SeedVR 旁路零删)")
    sg = next((s for s in wf["definitions"]["subgraphs"] if s["id"] == SEEDVR_SG), None)
    need(sg is not None, f"{name}: 缺 SeedVR 子图定义")
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    for i in SEEDVR_SG_IDS:
        need(i in sg_nodes and sg_nodes[i].get("mode") == 4,
             f"{name}: SeedVR 子图 {i} 缺或 mode≠4")
    # 加速子图 donor/现值锚(7014-7031 段锚件在场+widgets 逐位;全子图零扰动由
    # 深比对兜底——加速子图节点集两画布本不同构,不做整段 census 以免过拟)
    acc = next((s for s in wf["definitions"]["subgraphs"] if s.get("name") == ACCEL_SG_NAME), None)
    need(acc is not None, f"{name}: 缺加速子图({ACCEL_SG_NAME})")
    acc_nodes = {n["id"]: n for n in acc["nodes"]}
    for i, want in ACCEL_ANCHOR.items():
        need(i in acc_nodes, f"{name}: 加速子图缺锚件 {i}")
        need(acc_nodes[i].get("widgets_values") == want,
             f"{name}: 加速子图 {i} 漂移: {acc_nodes[i].get('widgets_values')!r} ≠ {want!r}(7015 现值禁顺手改)")


def canvas_state(name: str, wf: dict) -> str:
    """旧态/新态/异态三判(四点整体判,半改态=异态拒发)。"""
    nodes = {n["id"]: n for n in wf["nodes"]}
    grp7 = [g for g in wf["groups"] if g.get("id") == 7]
    need(len(grp7) == 1, f"{name}: 组 id 7 应恰一组(得 {len(grp7)})")
    w_ok = lambda want: all(nodes[i].get("widgets_values") == want[i] for i in want)
    t_old = grp7[0].get("title") == OLD_GROUP_TITLE
    t_new = grp7[0].get("title") == NEW_GROUP_TITLE
    if w_ok(OLD_WIDGETS) and t_old:
        return "old"
    if w_ok(NEW_WIDGETS) and t_new:
        return "new"
    got = {i: nodes[i].get("widgets_values") for i in NEW_WIDGETS}
    raise Fail(f"{name}: 非旧态非新态(半改态/异构态,拒发;8112/8117/8118 现值="
               f"{got!r};组7题名={grp7[0].get('title')!r})")


def surgery(name: str, path: Path) -> str:
    wf = json.loads(path.read_text(encoding="utf-8"))
    before = copy.deepcopy(wf)
    check_hard_border(name, wf)
    state = canvas_state(name, wf)
    if state == "new":
        print(f"[gem-swap] {name}: 已处新态(幂等跳过,四点核验+硬边界 PASS)")
        return "new"

    nodes = {n["id"]: n for n in wf["nodes"]}
    for nid in (8112, 8117, 8118):
        nodes[nid]["widgets_values"] = copy.deepcopy(NEW_WIDGETS[nid])
    grp7 = next(g for g in wf["groups"] if g.get("id") == 7)
    grp7["title"] = NEW_GROUP_TITLE  # 仅题名;bounding/color 不动

    # 零扰动深比对:差异恰=四点(差异路径前缀折算——widgets 整列替换只报叶位)
    idx = {n["id"]: i for i, n in enumerate(wf["nodes"])}
    gi7 = next(i for i, g in enumerate(wf["groups"]) if g.get("id") == 7)
    expect = {("nodes", idx[8112], "widgets_values"),
              ("nodes", idx[8117], "widgets_values"),
              ("nodes", idx[8118], "widgets_values"),
              ("groups", gi7, "title")}
    hits, extra = set(), []
    for p in deep_diff(before, wf):
        p = tuple(p)
        for pre in expect:
            if p[:len(pre)] == pre:
                hits.add(pre)
                break
        else:
            extra.append(p)
    need(not extra and hits == expect,
         f"{name}: 零扰动破门:期望外差异 {extra}(四点命中 {len(hits)}/4)"
         if extra or hits != expect else "")

    text = json.dumps(wf, ensure_ascii=False, indent=2)
    path.write_text(text, encoding="utf-8")

    # 写盘后复读终验(真验:盘上态==新态+硬边界)
    after = json.loads(path.read_text(encoding="utf-8"))
    need(canvas_state(name, after) == "new", f"{name}: 写盘后非新态")
    check_hard_border(name, after)
    print(f"[gem-swap] {name}: 四点换装完成(8112→{NEW_LORA} ×1 / 8117→新超分句 / "
          f"8118 steps 6→8 / 组7→「{NEW_GROUP_TITLE}」);零扰动深比对 PASS")
    return "swapped"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="只验不改(两画布应处新态)")
    args = ap.parse_args()
    for name, path in CANVASES.items():
        wf = json.loads(path.read_text(encoding="utf-8"))
        check_hard_border(name, wf)
        state = canvas_state(name, wf)
        if args.check:
            need(state == "new", f"{name}: --check 要求新态(得 {state})")
            print(f"[gem-swap] {name}: 新态核验 PASS(四点+硬边界)")
        elif state == "new":
            print(f"[gem-swap] {name}: 已处新态(幂等跳过)")
        else:
            surgery(name, path)
    print(f"[gem-swap] 完成。两画布四点={NEW_LORA}×1 + steps 8 + 全域超分句 + 组名「{NEW_GROUP_TITLE}」")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as exc:
        print(f"[gem-swap] FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
