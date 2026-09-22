#!/usr/bin/env python3
"""九型配方 i2i 两辅路工作流实装(09-19 R3;K2 图像线,零新引擎件)。

新建两条小流(文件名连字符规范,落 1_图片/K2图像/2_图生图/):
  K2-人脸精修-道劫.json  高清人脸←人物图裁切精修:
    [7]人物图 → [75/76]YuNet 检测裁脸(padding 0.9 含发肩) → [5]缩 1.0MP →
    [8]VAEEncode → [12]KSampler(denoise 0.35·12步·cfg1) → 保存;
    提示词/按型 LoRA 组=[80]MyDaojieBase(高清人脸)+[90]MyDaojieLoraStack
    (preset=跟随底座型,[80].base 供线联动——与 t2i 主链同机制)。
  K2-表情差分-道劫.json  表情差分←人脸变体:
    [7]人脸基准图 → [5]缩 1.0MP → VAEEncode → KSampler(denoise 0.25)→保存;
    [80]=高清人脸型(单脸内容基准;其 LoRA 组与表情差分型同三件,联动等价);
    情绪轴主体句逐格跑 → 拼表情差分资产(型主路=21:9 多格 t2i 直出)。

构造纪律:UI litegraph 全两向登记(links↔inputs.link↔outputs.links);
[90] widgets 逐字复用 t2i 现值(preset+28 槽开关/权重);写后 workflow_graph_lint。
幂等:文件已存在且 sha 相同即跳过重写;内容漂移即拒绝覆盖(防手改丢失)。
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_DIR = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图")
LINT = REPO / "apps/build/scripts/workflow_graph_lint.py"
T2I = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
       / "K2-文生图-道劫.json")

SUBJECT_FACE = ("一位驻颜有素的女修面容特写：眉如远山含黛，眼尾微挑，瞳色深棕近黑，"
                "鼻梁挺秀，唇色淡朱；神情是劫后余生的平静，几缕碎发贴在微汗的额角，"
                "柔和顶光勾勒出面部的立体轮廓。")
SUBJECT_EXPR = ("同一位女修的平静面容：眉如远山含黛，眼尾微挑，瞳色深棕近黑，鼻梁挺秀，"
                "唇色淡朱；神情沉静垂目，视线低垂向画面左下；光源方向与原基准图保持一致。")

CARD_FACE = """# 高清人脸←人物图裁切精修(九型配方·高清人脸辅路)

## 用法
1. [7] 载入人物立绘图 → [76] YuNet 自动检测裁脸(裁不到脸=原图过小/过糊,换图或手调 confidence 槽降 0.3);
2. [80] 道劫底座=高清人脸(默认);[50] 主体句=同脸锚(描述原人物气质五官,保身份);
3. [12] denoise=0.35 起步(A/B 档 0.25 更保身份;步数 12=质量档,cfg1 负向不生效);
4. 种子固定复跑保脸;[90] LoRA 栈=跟随底座型(细节×1+亚洲面孔×0.4+鎏金×0.3,与主链同单源 daojie_loras 栈数据)。

## 去噪强度口径(09-19 v0.2 待用户终审)
- 0.35=精修档:清晰化+保形,五官微整形;
- 0.25=保守档:几乎只做质感,身份最稳;
- ≥0.5 走改图流(K2-图像编辑-整合流),本流不承载。"""

CARD_EXPR = """# 表情差分←人脸变体(九型配方·表情差分辅路)

## 用法
1. [7] 载入人脸基准图(高清人脸型产物或裁切脸图)→ [5] 缩 1.0MP;
2. [80] 道劫底座=高清人脸(单脸内容基准;其按型 LoRA 组与表情差分型同组:细节×1+亚洲面孔×0.4+鎏金×0.3);
3. [50] 主体句=情绪轴句(只换神态词:含笑不语/怒目剑眉/痛楚闭眼…),脸型五官锚句逐字不动=跨格同脸;
4. [12] denoise=0.25 起步(低去噪保面容;A/B 档 0.35 变化更大);逐格换句+固定种子跑 → 后期拼 21:9 表情差分资产;
5. 21:9 多格直出主路=K2-文生图-道劫 选「表情差分」(两路 A/B 定主辅)。"""


def _node(nid, ntype, pos, size, widgets, inputs, outputs, title=None,
          order=None, properties=None):
    n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
         "order": order if order is not None else nid, "mode": 0,
         "inputs": inputs, "outputs": outputs,
         "properties": properties or {"Node name for S&R": ntype},
         "widgets_values": widgets}
    if title:
        n["title"] = title
    return n


def _in(name, itype, link=None, widget=False, label=None, shape=None):
    d = {"name": name, "type": itype, "link": link}
    if shape is not None:
        d["shape"] = shape  # 7=litegraph 可选槽形态(forceInput optional 先例)
    if widget:
        d["widget"] = {"name": name}
    if label:
        d["label"] = label
    return d


def _out(name, otype, links=None, label=None):
    d = {"name": name, "type": otype, "links": links}
    if label:
        d["label"] = label
    return d


class Graph:
    """双向往返登记的极小 UI 图构造器。"""

    def __init__(self):
        self.nodes: list[dict] = []
        self.links: list[list] = []
        self._next_link = 1

    def add(self, node: dict) -> int:
        self.nodes.append(node)
        return node["id"]

    def wire(self, src: int, src_slot: int, dst: int, dst_slot: int, ltype: str):
        lid = self._next_link
        self._next_link += 1
        self.links.append([lid, src, src_slot, dst, dst_slot, ltype])
        s = next(n for n in self.nodes if n["id"] == src)
        d = next(n for n in self.nodes if n["id"] == dst)
        if s["outputs"][src_slot]["links"] is None:
            s["outputs"][src_slot]["links"] = []
        s["outputs"][src_slot]["links"].append(lid)
        assert d["inputs"][dst_slot]["link"] is None, "重复接线"
        d["inputs"][dst_slot]["link"] = lid
        return lid


def stack_widgets() -> list:
    """[90] 槽开关/权重逐字复用 t2i 现值(单源:工作流只存初值,点亮靠 preset)。"""
    wf = json.loads(T2I.read_text(encoding="utf-8"))
    return next(n for n in wf["nodes"] if n["id"] == 90)["widgets_values"]


def build_common(base_type: str, subject: str, save_prefix: str, denoise: float,
                 card: str) -> tuple[Graph, dict]:
    """两辅路公共骨架(型/主体句/denoise/卡不同,图同构)。"""
    g = Graph()
    g.add(_node(7, "LoadImage", [-1180, 20], [316, 434], ["example.png", "image"],
                [_in("image", "COMBO", widget=True), _in("upload", "IMAGEUPLOAD", widget=True)],
                [_out("IMAGE", "IMAGE", []), _out("MASK", "MASK", None)], title="[7] 载入图像"))
    g.add(_node(15, "CLIPLoader", [-1180, 520], [316, 82],
                ["qwen3-vl-4b-heretic.safetensors", "krea2", "default"],
                [_in("clip_name", "COMBO", widget=True), _in("type", "COMBO", widget=True),
                 _in("device", "COMBO", widget=True)],
                [_out("CLIP", "CLIP", [])], title="[15] TE加载(4B)"))
    g.add(_node(10, "VAELoader", [-1180, 660], [316, 58],
                ["qwen_image_vae.safetensors"], [_in("vae_name", "COMBO", widget=True)],
                [_out("VAE", "VAE", [])], title="[10] VAE加载"))
    g.add(_node(21, "UNETLoader", [-1180, 780], [316, 82],
                ["krea2_turbo_bf16.safetensors", "default"],
                [_in("unet_name", "COMBO", widget=True), _in("weight_dtype", "COMBO", widget=True)],
                [_out("MODEL", "MODEL", [])], title="[21] DiT加载(turbo)"))
    g.add(_node(50, "PrimitiveStringMultiline", [-800, 20], [400, 200], [subject],
                [], [_out("STRING", "STRING", [])], title="[50] 主体句(同脸锚/情绪轴)"))
    n80 = _node(80, "MyDaojieBase", [-360, 20], [340, 260], [base_type],
                [_in("positive", "STRING", label="主体句", shape=7), _in("negative", "STRING", label="负向补充", shape=7)],
                [_out("positive", "STRING", []), _out("negative", "STRING", []),
                 _out("aspect", "COMBO", None), _out("megapixels", "FLOAT", None),
                 _out("base", "COMBO", None)],
                title="[80] 道劫底座(型驱动)", order=80)
    n80["widgets_values_named"] = {"base": base_type}  # 对齐 t2i 序列化(named 锚)
    g.add(n80)
    g.add(_node(51, "CLIPTextEncode", [40, 20], [316, 110], [""],
                [_in("text", "STRING", label="正向文本"), _in("clip", "CLIP")],
                [_out("CONDITIONING", "CONDITIONING", [])], title="[51] 正向编码"))
    g.add(_node(65, "CLIPTextEncode", [40, 180], [316, 110], [""],
                [_in("text", "STRING", label="负向文本"), _in("clip", "CLIP")],
                [_out("CONDITIONING", "CONDITIONING", [])], title="[65] 负向编码"))
    g.add(_node(90, "MyDaojieLoraStack", [40, 560], [380, 660], stack_widgets(),
                [_in("model", "MODEL"), _in("base", "COMBO", label="底座型")],
                [_out("model", "MODEL", []), _out("applied", "STRING", [])],
                title="[90] LoRA栈·九型驱动14槽(preset=跟随底座型)", order=90))
    g.add(_node(20, "Seed (rgthree)", [40, 340], [200, 100], [42, "", "", "okay"],
                [_in("seed", "INT", widget=True)], [_out("SEED", "SEED", [])],
                title="[20] 种子(固定复跑保脸)"))
    n12 = _node(12, "KSampler", [440, 20], [315, 560],
                [42, "fixed", 12, 1, "euler", "simple", denoise],
                [_in("model", "MODEL"), _in("positive", "CONDITIONING"),
                 _in("negative", "CONDITIONING"), _in("latent_image", "LATENT"),
                 _in("seed", "INT", widget=True), _in("steps", "INT", widget=True),
                 _in("cfg", "FLOAT", widget=True), _in("sampler_name", "COMBO", widget=True),
                 _in("scheduler", "COMBO", widget=True), _in("denoise", "FLOAT", widget=True)],
                [_out("LATENT", "LATENT", [])], title="[12] KSampler(denoise 见卡)")
    n12["widgets_values_named"] = {  # 对齐 t2i 序列化(前端 named 锚;control_after_generate 纯 UI)
        "seed": 42, "control_after_generate": "fixed", "steps": 12, "cfg": 1,
        "sampler_name": "euler", "scheduler": "simple", "denoise": denoise}
    g.add(n12)
    g.add(_node(11, "VAEDecode", [800, 20], [140, 46], None,
                [_in("samples", "LATENT"), _in("vae", "VAE")],
                [_out("IMAGE", "IMAGE", [])], title="[11] 解码出图"))
    g.add(_node(4, "SaveImage", [980, 20], [330, 290], [save_prefix],
                [_in("images", "IMAGE")], [_out("IMAGE", "IMAGE", None)], title="[4] 保存图片"))
    g.add(_node(86, "easy showAnything", [440, 660], [300, 120], ["(待运行)"],
                [_in("anything", "*")], [_out("output", "*", None)],
                title="[86] 按型LoRA生效清单"))
    g.add(_node(66, "MarkdownNote", [-1180, -520], [620, 480], [card],
                [], [], title="[66] 用法速查"))
    g.wire(50, 0, 80, 0, "STRING")
    g.wire(80, 0, 51, 0, "STRING")
    g.wire(80, 1, 65, 0, "STRING")
    g.wire(15, 0, 51, 1, "CLIP")
    g.wire(15, 0, 65, 1, "CLIP")
    g.wire(21, 0, 90, 0, "MODEL")
    g.wire(80, 4, 90, 1, "COMBO")
    g.wire(90, 0, 12, 0, "MODEL")
    g.wire(51, 0, 12, 1, "CONDITIONING")
    g.wire(65, 0, 12, 2, "CONDITIONING")
    g.wire(20, 0, 12, 4, "INT")
    g.wire(12, 0, 11, 0, "LATENT")
    g.wire(10, 0, 11, 1, "VAE")
    g.wire(11, 0, 4, 0, "IMAGE")
    g.wire(90, 1, 86, 0, "*")
    return g, {}


def build_face() -> dict:
    g, _ = build_common("高清人脸", SUBJECT_FACE, "K2道劫人脸精修_", 0.35, CARD_FACE)
    # 裁脸链:[75] YuNet 模型 → [76] 检测裁脸 → [5] 缩 1.0MP → [8] VAEEncode
    g.add(_node(75, "WASYuNetModelLoader", [-800, 660], [300, 58], [],
                [], [_out("yunet_model", "YUNET_MODEL", [])], title="[75] YuNet检测模型"))
    g.add(_node(76, "WASImageCropFaceYuNet", [-800, 300], [360, 220],
                [0.9, 0.6, "largest"],
                [_in("image", "IMAGE"), _in("yunet_model", "YUNET_MODEL"),
                 _in("crop_padding_factor", "FLOAT", widget=True),
                 _in("confidence", "FLOAT", widget=True),
                 _in("select", "COMBO", widget=True)],
                [_out("IMAGE", "IMAGE", []), _out("CROP_DATA", "CROP_DATA", None),
                 _out("faces_found", "INT", None), _out("confidence_score", "FLOAT", None)],
                title="[76] 自动裁脸(padding0.9含发肩)"))
    g.add(_node(5, "ImageScaleToTotalPixels", [-420, 300], [340, 130],
                ["lanczos", 1, 8],
                [_in("image", "IMAGE"), _in("upscale_method", "COMBO", widget=True),
                 _in("megapixels", "FLOAT", widget=True),
                 _in("resolution_steps", "INT", widget=True)],
                [_out("IMAGE", "IMAGE", [])], title="[5] 缩到1.0MP(人脸型底座分辨率)"))
    g.add(_node(8, "VAEEncode", [-420, 660], [140, 46], None,
                [_in("pixels", "IMAGE"), _in("vae", "VAE")],
                [_out("LATENT", "LATENT", [])], title="[8] 图编码"))
    g.wire(7, 0, 76, 0, "IMAGE")
    g.wire(75, 0, 76, 1, "YUNET_MODEL")
    g.wire(76, 0, 5, 0, "IMAGE")
    g.wire(5, 0, 8, 0, "IMAGE")
    g.wire(10, 0, 8, 1, "VAE")
    g.wire(8, 0, 12, 3, "LATENT")
    return {"nodes": g.nodes, "links": g.links, "groups": [], "config": {},
            "extra": {}, "version": 0.4}


def build_expr() -> dict:
    g, _ = build_common("高清人脸", SUBJECT_EXPR, "K2道劫表情差分_", 0.25, CARD_EXPR)
    g.add(_node(5, "ImageScaleToTotalPixels", [-800, 300], [340, 130],
                ["lanczos", 1, 8],
                [_in("image", "IMAGE"), _in("upscale_method", "COMBO", widget=True),
                 _in("megapixels", "FLOAT", widget=True),
                 _in("resolution_steps", "INT", widget=True)],
                [_out("IMAGE", "IMAGE", [])], title="[5] 缩到1.0MP"))
    g.add(_node(8, "VAEEncode", [-800, 660], [140, 46], None,
                [_in("pixels", "IMAGE"), _in("vae", "VAE")],
                [_out("LATENT", "LATENT", [])], title="[8] 图编码"))
    g.wire(7, 0, 5, 0, "IMAGE")
    g.wire(5, 0, 8, 0, "IMAGE")
    g.wire(10, 0, 8, 1, "VAE")
    g.wire(8, 0, 12, 3, "LATENT")
    return {"nodes": g.nodes, "links": g.links, "groups": [], "config": {},
            "extra": {}, "version": 0.4}


def emit(path: Path, doc: dict) -> None:
    payload = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    if path.exists():
        prev = path.read_text(encoding="utf-8")
        if prev != payload:
            digest = hashlib.sha256(prev.encode()).hexdigest()[:12]
            print(f"✗ {path.name} 已存在且内容有异(sha {digest}),拒绝覆盖;"
                  "如确要重建请先 git mv 备份", file=sys.stderr)
            sys.exit(2)
        print(f"= {path.name} 已是目标态(幂等跳过)")
        return
    path.write_text(payload, encoding="utf-8")
    print(f"+ {path.name} 写入({len(doc['nodes'])} 节点/{len(doc['links'])} 连线)")


def main() -> int:
    targets = [(WF_DIR / "K2-人脸精修-道劫.json", build_face()),
               (WF_DIR / "K2-表情差分-道劫.json", build_expr())]
    for path, doc in targets:
        emit(path, doc)
    r = subprocess.run([sys.executable, str(LINT), *[str(p) for p, _ in targets]],
                       capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    if r.returncode != 0:
        return 2
    print("OK i2i 两辅路实装:K2-人脸精修-道劫.json / K2-表情差分-道劫.json(lint 绿)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
