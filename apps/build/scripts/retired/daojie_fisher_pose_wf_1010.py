#!/usr/bin/env python3
"""道劫-摆姿-fisher 产线工作流建件(1010;用户令「按照你的建议去做」)。

今日实证终版配方(五发同seed对照+G发全域彩色达标)烙进自研件:
  image1=编辑器人偶(姿势) image2=人物立绘(外观) extra_prompt=四件套锚
  (人物归属句+image1封禁句+人物色彩锚+彩色场景句+浓度句) cfg1.0官方参。
链=bf16底模+VNCCS LoRA×1+FisherQwenFreePose+KSampler25cfg1+VAEDecode+Save
+使用说明Note(配方模板+已知边界)。零实验支路(多视角模型未装不建)。
"""
import json
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/道劫-摆姿-fisher.json"

UE = {"widget_ue_connectable": {}, "version": "7.8", "input_ue_unconnectable": {}}
EXTRA_TEMPLATE = (
    "Use the exact colors, costume, hairstyle and materials of the person in image2. "
    "image1 is a gray mannequin for pose only — ignore its gray color and material everywhere.\n"
    "【人物色彩锚·替换为本角色】青玉色道袍，月白腰带，长发半束素银发簪；乌木剑鞘，白玉剑格，暗红剑穗。\n"
    "【场景句·替换为主体句场景段】身后成排朱红残旗在晨风中飘动，赭石城墙被战火映成暖金色，"
    "青灰魔雾里透出石青与青绿的法术流光，旧金色天光自云隙垂落。\n"
    "传统色较高强度多色相并陈，色彩饱满分明，背景色面连续铺到画框边缘。"
)
NOTE = (
    "## 道劫 · 摆姿产线(Fisher-Pose 官方参·1010 实证版)\n\n"
    "**用法**:双击 [6] Fisher 编辑器摆人偶姿势(image1)→[5] 上传人物立绘(image2)→"
    "[6] extra_prompt 按四件套模板替换【人物色彩锚】【场景句】两段→Queue。\n\n"
    "**四件套锚配方(1010 同seed七发实证,缺一层出一层病)**:\n"
    "①人物归属句:colors/costume/hairstyle from image2(英)\n"
    "②image1 封禁句:gray mannequin for pose only, ignore its gray color(英)\n"
    "③人物色彩锚:色卡词逐件给色(中)\n"
    "④彩色场景句:直接贴美宣主体句的场景段——**背景颜色来自场景句,不照抄立绘的宣纸白**(F发教训)\n"
    "⑤浓度句:传统色较高强度多色相并陈\n\n"
    "**已验边界**:cfg=1.0 官方参即可(文字锚够强);持械规范站姿一次成型;"
    "非常规姿势(举臂类)带文字锚不跟人偶→文字栏清空出姿势图再上色(二段法);\n"
    "image2 请用高清大图立绘(低对比小图→外观保真弱);多视角支路模型未装不建。\n\n"
    "**实测基线**(seed 518817361/25步/1024):全域饱和度141.5/有彩92%,"
    "五场景元素全落地,人物五色全锁——对照档案 apps/output/fisher-pose-test/。"
)


def node(nid, ntype, pos, size, title, wv=None, inputs=None, outputs=None, order=0):
    n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
         "order": order, "mode": 0, "title": title,
         "properties": {"Node name for S&R": ntype, "ue_properties": dict(UE)},
         "inputs": inputs or [], "outputs": outputs or []}
    if wv is not None:
        n["widgets_values"] = wv
    return n


def inp(t, name, loc, link):
    return {"localized_name": loc, "name": name, "type": t, "link": link}


def out(t, name, loc, links):
    return {"localized_name": loc, "name": name, "type": t, "links": links}


nodes = [
    node(1, "UNETLoader", [60, 300], [340, 84], "[1] 底模·UNETLoader",
         ["qwen_image_2.1_bf16.safetensors", "default"],
         outputs=[out("MODEL", "MODEL", "模型", [1])]),
    node(3, "CLIPLoader", [60, 480], [360, 130], "[3] 主TE·CLIPLoader",
         ["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"],
         outputs=[out("CLIP", "CLIP", "CLIP", [4])]),
    node(4, "VAELoader", [60, 680], [340, 60], "[4] VAE·VAELoader",
         ["qwen_image_2.1_vae_bf16.safetensors"],
         outputs=[out("VAE", "VAE", "VAE", [5])]),
    node(2, "LoraLoaderModelOnly", [480, 300], [315, 130], "[2] VNCCS 姿势LoRA×1",
         ["VNCCS_QI2_PoseStudioV1.1.safetensors", 1],
         inputs=[inp("MODEL", "model", "模型", 1)],
         outputs=[out("MODEL", "MODEL", "模型", [2])]),
    node(5, "LoadImage", [480, 640], [340, 380], "[5] 人物立绘=image2(必填)",
         ["daojie_char_1007.png", "image"],
         outputs=[out("IMAGE", "IMAGE", "图像", [6])]),
    node(6, "FisherQwenFreePose", [900, 380], [400, 420], "[6] 摆姿势·编辑器(双击进)",
         [1024, 1024, 1024, EXTRA_TEMPLATE, "{}"],
         inputs=[inp("CLIP", "clip", "CLIP", 4), inp("VAE", "vae", "VAE", 5),
                 inp("IMAGE", "reference_image", "人物图", 6)],
         outputs=[out("CONDITIONING", "正向", "正向", [7]),
                  out("CONDITIONING", "负向", "负向", [8]),
                  out("LATENT", "latent", "latent", [9])]),
    node(7, "KSampler", [1380, 380], [330, 260], "[7] 25步 cfg1·官方参",
         [0, "fixed", 25, 1, "euler", "simple", 1],
         inputs=[inp("MODEL", "model", "模型", 2),
                 inp("CONDITIONING", "positive", "正面条件", 7),
                 inp("CONDITIONING", "negative", "负面条件", 8),
                 inp("LATENT", "latent_image", "Latent图像", 9)],
         outputs=[out("LATENT", "LATENT", "Latent", [10])]),
    node(8, "VAEDecode", [1770, 380], [210, 50], "[8] 解码",
         inputs=[inp("LATENT", "samples", "Latent", 10)],
         outputs=[out("IMAGE", "IMAGE", "图像", [11])]),
    node(9, "SaveImage", [2030, 380], [340, 400], "[9] 存图",
         ["道劫-摆姿/"], inputs=[inp("IMAGE", "images", "图像", 11)]),
    node(10, "MarkdownNote", [60, 40], [620, 460], "[10] 使用说明·配方",
         [NOTE], order=0),
]
# VAE 双扇出修正(4→6 与 4→8)
nodes[2]["outputs"][0]["links"] = [5]

links = [
    {"id": 1, "origin_id": 1, "origin_slot": 0, "target_id": 2, "target_slot": 0, "type": "MODEL"},
    {"id": 2, "origin_id": 2, "origin_slot": 0, "target_id": 7, "target_slot": 0, "type": "MODEL"},
    {"id": 4, "origin_id": 3, "origin_slot": 0, "target_id": 6, "target_slot": 0, "type": "CLIP"},
    {"id": 5, "origin_id": 4, "origin_slot": 0, "target_id": 6, "target_slot": 1, "type": "VAE"},
    {"id": 6, "origin_id": 5, "origin_slot": 0, "target_id": 6, "target_slot": 2, "type": "IMAGE"},
    {"id": 7, "origin_id": 6, "origin_slot": 0, "target_id": 7, "target_slot": 1, "type": "CONDITIONING"},
    {"id": 8, "origin_id": 6, "origin_slot": 1, "target_id": 7, "target_slot": 2, "type": "CONDITIONING"},
    {"id": 9, "origin_id": 6, "origin_slot": 2, "target_id": 7, "target_slot": 3, "type": "LATENT"},
    {"id": 10, "origin_id": 7, "origin_slot": 0, "target_id": 8, "target_slot": 0, "type": "LATENT"},
    {"id": 11, "origin_id": 8, "origin_slot": 0, "target_id": 9, "target_slot": 0, "type": "IMAGE"},
]
# VAE 第二扇出(节点8 也吃 VAE——重接:4 输出 links=[5,12],8.vae←link12)
nodes[7]["inputs"].append(inp("VAE", "vae", "VAE", 12))
nodes[2]["outputs"][0]["links"] = [5, 12]
links.append({"id": 12, "origin_id": 4, "origin_slot": 0, "target_id": 8, "target_slot": 1, "type": "VAE"})

doc = {
    "id": "b7e2f4a1-1010-4d9c-8a2f-daojiefisher01",
    "revision": 0, "last_node_id": 10, "last_link_id": 12,
    "nodes": nodes, "links": links,
    "groups": [{"id": 1, "title": "道劫·摆姿产线(官方参·1010实证:image1人偶=姿势/image2立绘=外观/四件套锚=颜色场景)",
                "bounding": [40, 250, 2360, 860], "color": "#4d9e6a", "flags": {}}],
    "config": {}, "extra": {}, "format_version": 0,
}
WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

# 自验:双向登记+槽界+关键 widgets
d = json.loads(WF.read_text(encoding="utf-8"))
nd = {n["id"]: n for n in d["nodes"]}; lk = {l["id"]: l for l in d["links"]}
for n in d["nodes"]:
    for i in n["inputs"]:
        if i.get("link") is not None:
            l = lk[i["link"]]
            assert (l["target_id"], l["target_slot"]) == (n["id"], next(k for k, ii in enumerate(n["inputs"]) if ii is i)), n["id"]
for n in d["nodes"]:
    for oi, o in enumerate(n["outputs"]):
        for lid in o.get("links", []):
            assert lk[lid]["origin_id"] == n["id"] and lk[lid]["origin_slot"] == oi
assert nd[6]["type"] == "FisherQwenFreePose" and "image2" in nd[6]["widgets_values"][3]
assert nd[7]["widgets_values"][2:4] == [25, 1]
print("[OK] 道劫-摆姿-fisher.json 建件(10节点12线,双向登记自验过)")
