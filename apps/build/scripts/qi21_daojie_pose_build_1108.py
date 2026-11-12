# -*- coding: utf-8 -*-
"""1108 道劫人物姿势工作流·幂等生成器(持械挂腰姿势根治役)。

产物: workflows/1_图片/QwenImage2.1/4_姿势编辑/qi21-道劫-人物姿势.json(画布件;1108 归位令自 2_图生图 迁入,文件名不变)
架构 = 道劫三层装配(qi21_bases 型库) × Fisher-Pose 姿势控制:
  FisherPoseStudio(文字摆人偶:手钉腰侧鞘位) → FisherQwenFreePose(姿势条件+
  装配文 extra_prompt) + VNCCS 姿势 LoRA@1.0 → KSampler 25步/CFG1 euler → 出图
母本配方 = 道劫-摆姿-fisher.json(1010 实证版);新增=型库装配层+姿势句模板。
用法: python3 qi21_daojie_pose_build_1108.py [--dry-run]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
QI21_BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
OUT = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/4_姿势编辑/qi21-道劫-人物姿势.json"

BOILERPLATE = ("image1 is a gray mannequin for pose only — ignore its gray color and material "
               "everywhere. 画面人物、服装、配器与场景完全按下方道劫装配文执行，人偶只提供姿势骨架。")
POSE_SENTENCE = ("正面全身站立的灰色人偶：身体微向左转约四分之一侧，重心落于右腿，左脚轻点地面；"
                 "右臂自然垂落、右肘微屈，右手五指松拢、虚握停在右腰侧佩剑的剑鞘上端位置；"
                 "左臂自然垂落，左手五指放松；头颈端正，目视前方，全身比例匀称。")
SUBJECT = ("一位筑基后期的年轻女修，青玉色道袍束月白腰带，足蹬青布道履，乌黑长发半束只簪一支素银簪，"
           "眉目沉静中带一点锋芒；她立于山门赭石石阶最上一级，身体正面朝向观者、微向左转约四分之一侧，"
           "重心落于右腿，左脚虚点下一级石阶，左臂自然垂落、左手五指放松；一柄长剑以石青剑绦系于画面左侧腰间，"
           "剑鞘斜垂、与地面约呈四十五度，鞘尾朝画面左下方、剑柄朝画面右上方，乌木剑鞘、白玉剑格、剑柄缠灰银丝、"
           "鞘口垂暗红剑穗，剑身完整收在鞘中，全身仅此一柄长剑、始终挂定腰间；右臂自然垂落、右肘微屈，"
           "右手五指环拢虚握在剑格护手正下方的鞘身上段、指腹贴实鞘面，剑柄与柄头完整露在手的上方且始终无人触碰，"
           "剑身重量仍由腰间剑绦承担；视线越过阶下青灰云海望向远处青绿群山，旧金色晨光自左侧斜照，衣袂被山风微微掀起。")

NOTE = """## 道劫·人物姿势工作流(1108 持械根治役:道劫装配 × Fisher-Pose 姿势控制)

**为什么**:持械挂载(剑挂腰+虚握鞘)是纯文本两模型(Q2.1/MOSS)都啃不动的接触绑定长尾——几何必须从图侧给(全网社区定谳路)。

**用法**:
1. [10] FisherPoseStudio 姿势句摆人偶(默认句已把右手钉在腰侧鞘位;可改任意姿势句)
2. [1] 选型(默认人物海报)+[2] 主体句(色词/部件清单句/性别锚纪律同 05 库)
3. Queue → 姿势由人偶钉死,人物/服装/剑按装配文渲染

**配方母本**=道劫-摆姿-fisher.json(1010 实证):qwen_image_2.1_bf16+heretic TE+texture_fix VAE+VNCCS 姿势 LoRA@1.0+25步/CFG1/euler/simple
**新增**=型库三层装配层(MyQi21DaojieBase→MyQi21PromptAssembly)+Fisher 官方灰人偶声明句(Text Concatenate 拼接,防灰色渗染)+姿势句模板(手在鞘位)
**对照**:同主体句无姿势件=qi21-道劫-t2i.json(纯文本路,持械弱);本件=姿势钉死路

**1108 五轮实弹验证配方(已烙为本件默认值)**:
- image2(人物立绘)=**无剑/预贴挂腰剑立绘**——绝不可用含手持剑姿势的立绘(参照姿势会压制人偶,v3 实锤复制级压制);无剑参照+装配文剑段=双手空+挂腰唯一写法(「始终由腰间剑绦系挂/重量由腰带承担/双臂自然垂落双手悬空/全身仅此一柄」),禁写手触鞘语句(手触鞘段+人偶垂手=双剑分裂,v4 实锤)
- 人偶姿势=右手垂在腰侧鞘位(v4 起姿势迁移实证成立:v3 复制立绘姿势→v4/v5 人偶姿势胜出)
- 预贴剑合成注意:贴片须视觉连腰(挂姿贴法),浮贴会被 1:1 泄漏成场景悬浮实体(v5 实锤,含出鞘刃污染)——推荐掩膜贴或事后局部重绘抹泄漏
- 无头/批量路:pose_json 可走文件引用 {"poseReferenceFile":{"filename":"<人偶图>","subfolder":""}}(人偶图放引擎 input/),免开编辑器;交互路=双击 [30] 编辑器摆姿点「应用到节点」

**1108 调优终版配方(九轮迭代,C5 交付)**:姿势链 cfg 1.0→2.5(风格稀释第一杠杆)→泄漏区精确蒙版 inpaint(蒙版须自 y46% 罩起,柄首在旧椭圆上沿外=经典漏罩)→dn0.55 风格回收(B 车道实证风格真位移档,须配硬剑负向「悬浮的剑/出鞘的刃/多余的剑/第二把剑/空剑鞘」守住唯一性;dn0.38/0.50 位移≈0 实测)。风格天花板账:姿势链 multiref 条件拉厚涂,i2n 文本杠杆每轮仅收窄 1-2.5pp(距靶心约 20pp 软渐变);终极贴靶=MOSS 侧跨模(edit LoRA/color_depth_control 拿结构件当几何参考,权重落盘候令)=结构件与风格件二段分工

**1108 终局(用户令「摆人偶+加道具」破局,C11 三要素全达成)**:姿势参照=人偶+道具剑合成(45° 斜垂+石青绦连腰带;**剑沿轴上移 80px 让护手居手上方**——剑位偏下手会握柄=拔剑预备式,C10 实锤);image2=净腰立绘(立绘腰带禁悬挂物,绦垂结会被画成第二剑,C10 根治实证);装配文=「五指环拢虚握在剑格护手正下方的鞘身上段,剑柄与柄头完整露在手上无人触碰」护手下方点名句;局部重绘修手/修剑=全线翻车(C6 巨拳/C8 羽翼/C9 白斑),解剖区 inpaint 与手-鞘绑定同属能力断层,勿再走;全网工具备查=JustSketchMe(数百道具)/PoseMy.Art(持武器姿势库)/Magic Poser,Fisher 编辑器存档字段含 grip sliders

**1111 回归根因定谳(收鞘剑参照令)**:人偶合成所用的剑道具图若带外露剑刃(道具提示词曾写「鞘口露出一段雪亮剑刃」),链路会忠实复制出鞘态——剑刃外露+鞘分离双件 3-seed 全崩(系统性,非掷骰);**换全收鞘剑道具(鞘口闭合零露刃)合成人偶后三要素全过**(唯一/挂腰 45°/完整收鞘+五指环拢虚握护手下方+柄头露出)。铁律:姿势参照里的道具状态=产出状态的几何真源,道具必须与目标态逐属性一致(收鞘/出鞘/握持)。软项:左右手镜像(Fisher 已知特性,文字补「右手」弱锚)"""


def _node(nid, ntype, pos, size, widgets=None, named=None, inputs=None, outputs=None):
    n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
         "order": nid, "mode": 0, "inputs": inputs or [], "outputs": outputs or [],
         "properties": {"Node name for S&R": ntype}}
    if widgets is not None:
        n["widgets_values"] = widgets
        if named:
            n["widgets_values_named"] = named
    return n


def _in(name, ntype, link):
    return {"name": name, "type": ntype, "link": link}


def _out(name, ntype, links, slot=0):
    return {"name": name, "type": ntype, "links": links, "slot_index": slot}


def build() -> dict:
    style_base = json.loads(QI21_BASES.read_text(encoding="utf-8"))["art_style_base"]["positive_text"]
    L = []

    def link(f, fs, t, ts, ty):
        L.append([len(L) + 1, f, fs, t, ts, ty])
        return len(L)

    nodes = [
        _node(1, "MyQi21DaojieBase", [0, 0], [340, 200], widgets=["人物海报"], named={"base": "人物海报"},
              outputs=[_out("BASE", "STRING", []), _out("WIDTH", "INT", [], 1), _out("HEIGHT", "INT", [], 2),
                       _out("负面词", "STRING", [], 3), _out("透明值", "BOOLEAN", [], 4), _out("型名", "STRING", [], 5)]),
        _node(2, "PrimitiveStringMultiline", [0, 240], [420, 220], widgets=[SUBJECT], named={"value": SUBJECT},
              outputs=[_out("STRING", "STRING", [])]),
        _node(3, "PrimitiveStringMultiline", [0, 500], [420, 200], widgets=[style_base], named={"value": style_base},
              outputs=[_out("STRING", "STRING", [])]),
        _node(4, "MyQi21PromptAssembly", [480, 0], [420, 260], widgets=["道劫美术类型"], named={"组装用途": "道劫美术类型"},
              outputs=[_out("装配全文", "STRING", []), _out("负面词", "STRING", [], 1)]),
        _node(5, "MyQi21PromptPreview", [480, 300], [420, 160]),
        _node(10, "FisherPoseStudio", [960, 0], [440, 240],
              widgets=["视角＋姿态", 896, 1152, POSE_SENTENCE, "{}"],
              named={"output_mode": "视角＋姿态", "width": 896, "height": 1152,
                     "extra_prompt": POSE_SENTENCE, "scene_json": "{}"},
              outputs=[_out("提示词", "STRING", []), _out("人偶姿态图", "IMAGE", [], 1), _out("镜头预览图", "IMAGE", [], 2)]),
        _node(11, "Text Concatenate", [960, 280], [380, 140],
              widgets=["\n\n", False], named={"delimiter": "\n\n", "clean_whitespace": False},
              outputs=[_out("STRING", "STRING", [])]),
        _node(12, "PrimitiveStringMultiline", [960, 460], [380, 130], widgets=[BOILERPLATE], named={"value": BOILERPLATE},
              outputs=[_out("STRING", "STRING", [])]),
        _node(20, "UNETLoader", [1440, 0], [340, 100],
              widgets=["qwen_image_2.1_bf16.safetensors", "default"],
              named={"unet_name": "qwen_image_2.1_bf16.safetensors", "weight_dtype": "default"},
              outputs=[_out("MODEL", "MODEL", [])]),
        _node(21, "CLIPLoader", [1440, 140], [340, 100],
              widgets=["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"],
              named={"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"},
              outputs=[_out("CLIP", "CLIP", [])]),
        _node(22, "VAELoader", [1440, 280], [360, 100],
              widgets=["texture_fix_vae_for_qwen_image_2.1_bf16.safetensors"],
              named={"vae_name": "texture_fix_vae_for_qwen_image_2.1_bf16.safetensors"},
              outputs=[_out("VAE", "VAE", [])]),
        _node(23, "LoraLoaderModelOnly", [1440, 420], [380, 110],
              widgets=["VNCCS_QI2_PoseStudioV1.1.safetensors", 1.0],
              named={"lora_name": "VNCCS_QI2_PoseStudioV1.1.safetensors", "strength_model": 1.0},
              inputs=[_in("model", "MODEL", None)], outputs=[_out("MODEL", "MODEL", [])]),
        _node(30, "FisherQwenFreePose", [1900, 0], [460, 320],
              widgets=[1088, 1440, 1024, "", "{}"],
              named={"width": 1088, "height": 1440, "reference_resolution": 1024,
                     "extra_prompt": "", "pose_json": "{}"},
              inputs=[_in("clip", "CLIP", None), _in("vae", "VAE", None),
                      _in("reference_image", "IMAGE", None), _in("width", "INT", None),
                      _in("height", "INT", None), _in("extra_prompt", "STRING", None)],
              outputs=[_out("CONDITIONING+", "CONDITIONING", []), _out("CONDITIONING-", "CONDITIONING", [], 1),
                       _out("LATENT", "LATENT", [], 2), _out("STRING", "STRING", [], 3),
                       _out("IMAGE", "IMAGE", [], 4), _out("STRING", "STRING", [], 5)]),
        _node(31, "KSampler", [2420, 0], [340, 280],
              widgets=[1108, "fixed", 25, 1.0, "euler", "simple", 1.0],
              named={"seed": 1108, "control_after_generate": "fixed", "steps": 25, "cfg": 1.0,
                     "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0},
              outputs=[_out("LATENT", "LATENT", [])]),
        _node(32, "VAEDecode", [2420, 320], [300, 110],
              outputs=[_out("IMAGE", "IMAGE", [])]),
        _node(33, "SaveImage", [2800, 320], [340, 110], widgets=["道劫-人物姿势/"],
              named={"filename_prefix": "道劫-人物姿势/"}),
        _node(34, "MarkdownNote", [0, 760], [460, 440], widgets=[NOTE]),
    ]
    by = {n["id"]: n for n in nodes}

    def wire(f, fs, t, ts, ty, iname):
        lid = link(f, fs, t, ts, ty)
        by[t]["inputs"] = [x for x in by[t]["inputs"] if x["name"] != iname]
        by[t]["inputs"].append(_in(iname, ty, lid))
        by[f]["outputs"][fs]["links"] = (by[f]["outputs"][fs].get("links") or []) + [lid]

    wire(1, 0, 4, 0, "STRING", "BASE")
    wire(1, 3, 4, 0, "STRING", "BASE负面")
    wire(2, 0, 4, 0, "STRING", "主体句")
    wire(3, 0, 4, 0, "STRING", "锁层A全文")
    wire(4, 0, 5, 0, "STRING", "正向提示词")
    wire(4, 1, 5, 0, "STRING", "负向提示词")
    wire(10, 1, 30, 0, "IMAGE", "reference_image")
    wire(12, 0, 11, 0, "STRING", "text_a")
    wire(4, 0, 11, 0, "STRING", "text_b")
    wire(11, 0, 30, 0, "STRING", "extra_prompt")
    wire(21, 0, 30, 0, "CLIP", "clip")
    wire(22, 0, 30, 0, "VAE", "vae")
    wire(1, 1, 30, 0, "INT", "width")
    wire(1, 2, 30, 0, "INT", "height")
    wire(20, 0, 23, 0, "MODEL", "model")
    wire(23, 0, 31, 0, "MODEL", "model")
    wire(30, 0, 31, 0, "CONDITIONING", "positive")
    wire(30, 1, 31, 0, "CONDITIONING", "negative")
    wire(30, 2, 31, 0, "LATENT", "latent_image")
    wire(31, 0, 32, 0, "LATENT", "samples")
    wire(22, 0, 32, 0, "VAE", "vae")
    wire(32, 0, 33, 0, "IMAGE", "images")

    groups = [
        {"id": 1, "title": "① 道劫型库·三层装配(文字:画什么)", "bounding": [-20, -60, 920, 860], "color": "#3f789e", "flags": {}},
        {"id": 2, "title": "② Fisher 姿势层(几何:怎么站)", "bounding": [940, -60, 480, 700], "color": "#a33", "flags": {}},
        {"id": 3, "title": "③ Q2.1 姿势条件采样链", "bounding": [1420, -60, 1380, 520], "color": "#88A", "flags": {}},
    ]
    return {"last_node_id": 34, "last_link_id": len(L), "nodes": nodes, "links": L,
            "groups": groups, "config": {}, "extra": {}, "version": 0.4, "revision": 0}


def main() -> int:
    if "--dry-run" in sys.argv:
        print(f"[DRY] 将写 {OUT.relative_to(REPO)}"); return 0
    d = build()
    OUT.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK qi21-道劫-人物姿势.json nodes={len(d['nodes'])} links={len(d['links'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
