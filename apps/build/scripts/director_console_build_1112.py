#!/usr/bin/env python3
"""导演台.json 幂等生成器(1112)。

依据 .trellis/tasks/11-12-h3-director-console/design.md(唯一施工依据)+
research/anatomy-1112.md A 节(克隆源逐 id 对账真源):
  母本=三采-单镜.json(1112 扁平化后同域) → 产物=1_漫影自研/导演台.json
  SHARED 恒原 id 单源 / SHOT_TEMPLATE 每镜克隆(id+1000k)/ 链全量重编号+outputs 重建 /
  出厂门控(一采 mode0·二三采 mode2)/ 组框自算两两零交集。

对 design 的三处已证实偏差(母本实测):
  1) design §4 字面 stride=2400:一采+二采模板纵幅实测≈5.25k(80→5324),2400 必致
     镜头①②③组 bbox 相交,违反同节契约「两两组 bbox 零交集(1109 口径)」→
     stride 改由母本实测推导(整百上取,当前=5800),确定性恒成立。
  2) design §5-10 树锚 143→144:起草时树=143,其后 1_图片/MiniMax/ 落 2 件(未入 design
     账),生成时实测树=145 → 产物后=146。锚随实况,清单落账(145→146)归主会话步骤 6。
  3) design §5-6(照抄母本)的开关倒挂(1112 深检 F1):母本 [219] 出厂 true 而
     ComfySwitchNode 语义 on_true 真,母本接线 on_true←i2v 臂(251/220 系)/on_false←
     r2v 臂(140/16 系)→出厂实跑 i2v,与 219 title/Note103/台本卡「√=r2v」全文案倒挂。
     导演台克隆链后处理交换 218+k/221/222+k 三开关两臂槽位引用(true→on_true=r2v 臂);
     250+k 恒吃 251+k 的母本刻意接线不动(σ 网格单源,与开关无关)。母本零改动,
     母本修复候用户另裁。

克隆后处理另含 F3(文案):206+k/208+k 节点 title 陈旧文案「1280×704」→「1440×832」
(widgets 母本原值已 1440×832,title 未随,生成器统一)。

铁律:幂等(零随机零时间戳,连跑 shasum 一致)·链 id 全局重编号·禁手改产物 JSON·
母本零改动(运行前后 sha 比对自检)。自检不过→非零退出。
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MOTHER = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json"
OUT = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/导演台.json"
WORKFLOWS_ROOT = ROOT / "apps/backend/comfyui/workflows"

SHOT_COUNT = 3
ID_STRIDE = 1000
GROUP_PAD = 50
# 树计数锚:design §5-10 起草值 144(时树 143);生成时实况=MiniMax 域 2 件已落地(树 145),
# 导演台 +1 → 146。锚随实况,若树再漂移须连本锚与契约测试同改(清单落账归主会话)。
TREE_ANCHOR = 151  # 147(Qwen设定卡+2 并行)+4 AIMixer 参照件(7_测试)
STRIDE_ROUND = 100          # 镜距整百化
STRIDE_EXTRA = 500          # 镜距附加余量(组框间隙)

# ── design §1 节点切分(anatomy A 节对账)────────────────────────────────
FIRST_STAGE = {  # 一采 35(母本一阶段采样组成员去 SHARED 去 Note;1113 纯净化母本
    # 移除 [264]TokenCounter/[265]PreviewAny 两监视件——纯预览零生成影响,随母本同删)
    9, 14, 16, 20, 22,
    110, 111, 112, 113,
    121, 122, 123, 125, 126, 129, 130, 131,
    140, 145, 204,
    216, 217, 218, 220, 221, 222,
    250, 251,
    260, 261, 262, 263, 266,
}
SECOND_STAGE = {4, 100, 202, 203, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 223, 267}  # 二采 17
THIRD_STAGE = {339, 340}    # 三采 2(克隆后归三采组)
SHARED = {103, 119, 120, 127, 128, 219, 338}  # 恒原 id 全台单源
TESSERA = set(range(300, 338))
DROP = TESSERA | {268, 269, 101, 102}
DROP_LINK_IDS = {778, 780}  # design §2:母本 214→339(link780)与 214→269(link778)显式丢

TEMPLATE = FIRST_STAGE | SECOND_STAGE | THIRD_STAGE

# ── 出厂态文案(design §1/§3)───────────────────────────────────────────
PROMPT_TEMPLATE = (
    "【提示词模板·例】(拍摄后整段替换)国风赛璐璐动画:金水塾馆内,白发剑客右肩缠布条"
    "立于匾额下,中景缓推,檐角风铃与远雷。台词:\"塾师,这笔账,今天得清。\""
    "——角色台词必须写进英文双引号内(H3 据此驱动口型与语音;预算≈4 汉字/秒、"
    "起说延迟 1.3~2.4 秒,须与时长档匹配:124f≈5.2 秒,单镜台词≤20 字)。"
)

NOTE_103 = """## 导演台运行法则(1112·三段门控)

**出厂门控**:镜头①②③(一采)+草片拼组 = mode 0;各镜二采段与三采组 = mode 2 旁路。
模式开关 **[219]**:√=r2v 多参考 / 去√=i2v 首帧锚定(全台单源,三镜同门)。

**一发(一采)**:直接跑 → 三镜各出 p1-draft(960×544)+ 草片拼 p1-draft-concat
(仅供人审,不进交付链;API 直投形态若草片拼丢参,兜底=三镜 p1 独立审+ffmpeg 外拼)。

**二发(二采)**:unmute 所需镜头的二采段 → p2-final(1440×832 终档)。
⚠️引擎跨发缓存不可依赖(1112 实测 101 节点仅 1 命中)——按「一采重算 ≈5min+二采」做预算,
勿以零重算排产;急件可走文件化降级(二采外挂件吃一发 p1 盘上产物)。
换发前 `POST /free {"unload_models": true}`(H3 全家桶驻留显存,不卸必饿,31:56 实测前科)。

**三发(三采)**:把二发 p2 产物拷入 input/ 目录 → unmute 三采组,
[3300/3301/3302] 分别指向镜①②③的 p2 文件 → p3-final(ReCaVSR int8 scale2→2880×1664,
交付层图外 ffmpeg 归一 1080p:lanczos/scale=1920:1080/crf18/preset slow)。

**红线**:二采采样器恒 lcm([209+k])·CFG 恒 1.0·σshift 一采 i2v 臂 [6,3]/二采 [12,3];
AR 阶梯 960×544→1440×832→×2(按输入图 AR 开方+32 对齐,改 [16+k]/[220+k]/[208+k]/[206+k] 四处);
offload 恒开。**seed**:镜①②③=[129+k] 42/142/242(fixed);时长档全表见台本卡 [4002]。"""

NOTE_4000 = """## 数字人桥工艺(预留·mode=2,零接线)

导演台后续接音频驱动数字人长片时,照 `8_数字人/数字人-音频驱动.json` 工艺:

- 段骨架:ReferenceToVideo → NativeAudioLock → SamplerCustomAdvanced
  (euler_ancestral + ManualSigmas 官方 6-NFE 七值,数字人域口径勿混 H3 视频域)→
  VAEDecode → CreateVideo。
- 段间接力:MotionContextSaveLatent(widget `dhui/segN`,clip_index N)→ 下段
  MotionContextLoadLatent(同 path,clip_index N+1)→ MotionContext
  (context_length=22,audio_context_length=0;conditioning←本段 positive;
  latent←本段 AudioLock av_latent)。
- 段间重叠:段尾 ImageFromBatch(batch_index=22)丢 22 帧;成片外部 ffmpeg concat。
- 扩段=克隆段组,SaveLatent/LoadLatent 的 clip_index 成对 +1。"""

NOTE_4001 = """## 口型锁工艺(预留·mode=2,零接线)

- 口型由音频驱动:NativeAudioLock(1111 装毕三插件:NativeAudioLock/Motion-Context/
  Context-Noise)把音视频绑进 av_latent,再经 MotionContext 跨段传递
  (audio_context_length=0),conditioning 唯一被消费输出→下段 BasicGuider。
- 台词进提示词:角色台词写英文双引号内(预算≈4 汉字/秒,起说延迟 1.3~2.4 秒);
  旁白走外置 TTS 轨,不入 H3 提示词。
- 本台三镜短片段出厂未挂锁;口型精度要求高的镜头,把该镜一采臂替换为数字人段骨架即可。"""

NOTE_4002 = """## 台本卡(导演台·三镜)

**每镜提示词**:写入对应 [14+k] PrimitiveStringMultiline。台词模板例句(与 [14] 同文):

> 【提示词模板·例】(拍摄后整段替换)国风赛璐璐动画:金水塾馆内,白发剑客右肩缠布条立于匾额下,
> 中景缓推,檐角风铃与远雷。台词:"塾师,这笔账,今天得清。"——角色台词必须写进英文双引号内
> (H3 据此驱动口型与语音;预算≈4 汉字/秒、起说延迟 1.3~2.4 秒,须与时长档匹配:
> 124f≈5.2 秒,单镜台词≤20 字)。

**参考图 5 槽(每镜)**:[9+k]=首帧/主参考(r2v ref 图 1·兼 i2v 首帧·兼二采条件锚);
[110+k]~[113+k]=辅参考 2-5(r2v 多参考)。出厂占位 manying-shot-h3-*.jpg,逐镜替换。

**时长档(17k+5 全档表,24fps)**:
5f 0.2s / 22f 0.9s / 39f 1.6s / 56f 2.3s / 73f 3.0s / 90f 3.8s / 107f 4.5s /
**124f 5.2s(出厂)** / 141f 5.9s / 158f 6.6s / 175f 7.3s / 192f 8.0s / 209f 8.7s /
226f 9.4s / 243f 10.1s。
改档:改 [20+k] 时长(秒)由 [131+k] 表达式自动落档,或直改 [16+k]/[220+k] length(须落 17k+5)。

**每镜 seed**:[129+k] = 42 / 142 / 242(fixed)。

**全局**:模式开关 [219](√r2v 多参考 / i2v 首帧);交付档 p1 人审 → p2 1440×832 终档 →
p3 2880×1664 → ffmpeg 1080p 归一;拆链发车与红线见 [103] 运行法则。"""

# ── 新造节点 id(design §1 表)──────────────────────────────────────────
NID_CONCAT, NID_DRAFT_SAVE = 3000, 3001
NID_LOADVIDEO = (3300, 3301, 3302)
NID_BRIDGE_NOTE, NID_LOCK_NOTE, NID_SCRIPT_CARD = 4000, 4001, 4002


def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rect(node: dict) -> tuple[float, float, float, float]:
    x, y = node["pos"][0], node["pos"][1]
    w = node.get("size", [0, 0])[0]
    h = node.get("size", [0, 0])[1]
    return (x, y, x + w, y + h)


def bbox_of(members: list[dict], pad: int = GROUP_PAD) -> list[float]:
    xs1, ys1, xs2, ys2 = zip(*(rect(m) for m in members))
    x0, y0 = min(xs1) - pad, min(ys1) - pad
    x1, y1 = max(xs2) + pad, max(ys2) + pad
    return [x0, y0, x1 - x0, y1 - y0]


def set_widget(node: dict, nid: int, pos_idx: int, named_key: str, value) -> None:
    wv = node.get("widgets_values")
    if not isinstance(wv, list) or len(wv) <= pos_idx:
        raise AssertionError(f"节点 {nid} widgets_values 缺位 {pos_idx}")
    wv[pos_idx] = value
    named = node.get("widgets_values_named")
    if isinstance(named, dict):
        if named_key not in named:
            raise AssertionError(f"节点 {nid} widgets_values_named 缺键 {named_key}")
        named[named_key] = value


def build() -> dict:
    mother = json.loads(MOTHER.read_text(encoding="utf-8"))
    mnodes = {n["id"]: n for n in mother["nodes"]}
    # links=151:1112 母本三笔修后(audio_vae 拔线,原 152)
    if len(mnodes) != 59 or len(mother["links"]) != 91 or len(mother["groups"]) != 5:  # 1113 纯净化母本(103/151→59/91)
        raise AssertionError(f"母本形态漂移: nodes={len(mnodes)} links={len(mother['links'])} groups={len(mother['groups'])}")

    # 切分完备性对账(anatomy A)
    # 1113 纯净化后 DROP 件(TESSERA/RelayVSR/监视对)已不在母本:对账语义改为
    # 「母本每个 id 必有归属」;DROP 中缺席者=已随母本净化移除,合法。
    unexpected = set(mnodes) - TEMPLATE - SHARED - DROP
    if unexpected or (TEMPLATE & SHARED) or (TEMPLATE & DROP) or (SHARED & DROP):
        raise AssertionError(f"母本 id 切分不符,未归类: {sorted(unexpected)}")
    if len(FIRST_STAGE) != 33 or len(SECOND_STAGE) != 17:  # 1113 纯净化:35-2 监视对=33
        raise AssertionError(f"一/二采模板件数漂移: {len(FIRST_STAGE)}/{len(SECOND_STAGE)}")

    # 母本关键 widget 原值核对(design §3「母本原值核对」)
    if mnodes[206]["widgets_values"][2:4] != [1440, 832]:
        raise AssertionError("母本 [206] 非 1440×832")
    if mnodes[219]["widgets_values"] != [True]:
        raise AssertionError("母本 [219] 非 true")
    for nid, expect in ((209, ["simple", 3, 0.2]), (250, ["simple", 8, 1.0]),
                        (251, [6, 3]), (203, [12, 3]), (123, ["lcm"])):
        if mnodes[nid]["widgets_values"] != expect:
            raise AssertionError(f"母本 [{nid}] widget 漂移: {mnodes[nid]['widgets_values']}")
    for nid in (206, 208):  # F3 前提:母本 title 仍带陈旧文案(母本若换文案/修复即断,防静默漂移)
        if "1280×704" not in (mnodes[nid].get("title") or ""):
            raise AssertionError(f"母本 [{nid}] title 无「1280×704」陈旧文案(F3 前提漂移)")

    # 镜距:由一采+二采模板纵幅推导(design 字面 2400 与零交集契约冲突,见模块 docstring)
    stage12 = [mnodes[i] for i in (FIRST_STAGE | SECOND_STAGE)]
    ys = rect_pairs = [rect(m) for m in stage12]
    extent = max(r[3] for r in ys) - min(r[1] for r in ys)
    stride = int(math.ceil((extent + STRIDE_EXTRA) / STRIDE_ROUND) * STRIDE_ROUND)
    base_y = min(r[1] for r in ys)

    nodes: list[dict] = []

    # 1) SHARED 恒原 id(§1);加载器五件挪专用区,Note103 挪台本卡区,338 原位
    shared_y = base_y + stride * SHOT_COUNT
    shared_pos = {119: (80, shared_y), 120: (80, shared_y + 240), 127: (80, shared_y + 480),
                  128: (80, shared_y + 720), 219: (80, shared_y + 960)}
    for nid in sorted(SHARED):
        if nid == 103:  # 1113 纯净化母本已删原 Note103 → 本台自造(运行法则三段门控版)
            n = {"id": 103, "type": "MarkdownNote", "pos": [80, shared_y + 1400],
                 "size": [520, 760], "flags": {}, "order": 0, "mode": 0,
                 "properties": {}, "widgets_values": [NOTE_103]}
            nodes.append(n)
            continue
        n = copy.deepcopy(mnodes[nid])
        n["mode"] = 0
        if nid in shared_pos:
            n["pos"] = list(shared_pos[nid])
        elif nid == 338:  # 1113:三采 loader 挪三采列顶(纯净化母本原位落加载器列)
            n["pos"] = [12300, 60]
        nodes.append(n)

    # 2) SHOT_TEMPLATE ×3 克隆(id+1000k, pos.y+stride*k)
    for k in range(SHOT_COUNT):
        for nid in sorted(TEMPLATE):
            n = copy.deepcopy(mnodes[nid])
            n["id"] = nid + ID_STRIDE * k
            if nid in THIRD_STAGE:  # 三采族显式右列位(1113 母本三采臂 x 位落镜头列带)
                n["pos"] = [12450, 480 + stride * k + (560 if nid == 339 else 1060)]
            else:
                n["pos"] = [n["pos"][0], n["pos"][1] + stride * k]
            n["mode"] = 2 if (nid in SECOND_STAGE or nid in THIRD_STAGE) else 0
            if nid in (206, 208):  # F3:title 陈旧文案 1280×704→1440×832(widgets 母本原值已 1440×832)
                n["title"] = n["title"].replace("1280×704", "1440×832")
            if nid == 129:
                set_widget(n, n["id"], 0, "noise_seed", 42 + 100 * k)
                set_widget(n, n["id"], 1, "control_after_generate", "fixed")
            elif nid == 204:
                set_widget(n, n["id"], 0, "filename_prefix", f"video/漫影/chapter-001/sb-chapter-001-{k + 1:03d}/p1-draft")
            elif nid == 4:
                set_widget(n, n["id"], 0, "filename_prefix", f"video/漫影/chapter-001/sb-chapter-001-{k + 1:03d}/p2-final")
            elif nid == 100:
                # MyShot 回写校验:prefix parts[3] 必须等于 shot_id(my_shot.py:71;母本 S00 系克隆残留)
                set_widget(n, n["id"], 0, "shot_id", f"sb-chapter-001-{k + 1:03d}")
            elif nid == 340:
                set_widget(n, n["id"], 0, "filename_prefix", f"video/漫影/chapter-001/sb-chapter-001-{k + 1:03d}/p3-final")
            elif nid == 14:
                set_widget(n, n["id"], 0, "value", PROMPT_TEMPLATE)
            elif nid == 16:
                for idx, key, val in ((1, "width", 960), (2, "height", 544), (3, "length", 124)):
                    set_widget(n, n["id"], idx, key, val)
                named = n.get("widgets_values_named")
                if isinstance(named, dict) and "ref_image_size" in named:
                    named["ref_image_size"] = n["widgets_values"][4]  # 对齐 anatomy A2:ref_image_size=max
            elif nid == 220:
                for idx, key, val in ((1, "width", 960), (2, "height", 544), (3, "length", 124)):
                    set_widget(n, n["id"], idx, key, val)
            nodes.append(n)

    by_id = {n["id"]: n for n in nodes}

    # 3) 新造节点(design §1 表;画布形态照母本同款先例:autogrow 槽位名「组名.槽名」)
    notes_y = shared_y + 1400
    by_id[NID_CONCAT] = {
        "id": NID_CONCAT, "type": "ConcatenateVideo", "pos": [11400, 80], "size": [400, 200],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"label": "video_1", "name": "videos.video_1", "shape": 7, "type": "VIDEO", "link": None},
            {"label": "video_2", "name": "videos.video_2", "shape": 7, "type": "VIDEO", "link": None},
            {"label": "video_3", "name": "videos.video_3", "shape": 7, "type": "VIDEO", "link": None},
            {"name": "complete_audio", "shape": 7, "type": "AUDIO", "link": None},
        ],
        "outputs": [{"name": "VIDEO", "type": "VIDEO", "links": []}],
        "properties": {"Node name for S&R": "ConcatenateVideo"},
        "widgets_values": ["auto"],
        "title": "草片拼(三镜 p1 顺序拼接·人审用·不进交付链)",
    }
    by_id[NID_DRAFT_SAVE] = {
        "id": NID_DRAFT_SAVE, "type": "SaveVideo", "pos": [11860, 80], "size": [300, 360],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "video", "type": "VIDEO", "link": None},
            {"name": "filename_prefix", "type": "STRING", "widget": {"name": "filename_prefix"}, "link": None},
            {"name": "format", "type": "COMFY_DYNAMICCOMBO_V3", "widget": {"name": "format"}, "link": None},
            {"name": "format.codec", "type": "COMFY_DYNAMICCOMBO_V3", "widget": {"name": "format.codec"}, "link": None},
            {"name": "codec", "shape": 7, "type": "COMFY_DYNAMICCOMBO_V3", "widget": {"name": "codec"}, "link": None},
        ],
        "outputs": [{"name": "video", "type": "VIDEO", "links": []}],
        "properties": {"Node name for S&R": "SaveVideo"},
        "widgets_values": ["video/漫影/chapter-001/p1-draft-concat", "auto", "auto", "auto"],
        "widgets_values_named": {"filename_prefix": "video/漫影/chapter-001/p1-draft-concat",
                                 "format": "auto", "format.codec": "auto", "codec": "auto"},
        "title": "草片落盘(p1-draft-concat)",
    }
    for k, nid in enumerate(NID_LOADVIDEO):
        by_id[nid] = {
            "id": nid, "type": "LoadVideo", "pos": [12450, 480 + stride * k], "size": [420, 500],
            "flags": {}, "order": 0, "mode": 2,
            "inputs": [],
            "outputs": [{"name": "VIDEO", "type": "VIDEO", "links": []}],
            "properties": {"cnr_id": "comfy-core", "ver": "0.35.0", "Node name for S&R": "LoadVideo"},
            "widgets_values": ["your_source_clip.mp4", "image"],
            "title": f"三采入口·镜{k + 1}(真源=镜{k + 1} p2 产物,三发前拷入 input/;TESSERA[300] 同款工艺)",
        }
    for nid, text, y, h in ((NID_BRIDGE_NOTE, NOTE_4000, notes_y + 2380, 620),
                            (NID_LOCK_NOTE, NOTE_4001, notes_y + 3060, 620),
                            (NID_SCRIPT_CARD, NOTE_4002, notes_y + 820, 1500)):
        by_id[nid] = {
            "id": nid, "type": "MarkdownNote", "pos": [80, y], "size": [520, h],
            "flags": {}, "order": 0,
            "mode": 2 if nid in (NID_BRIDGE_NOTE, NID_LOCK_NOTE) else 0,  # design §1:桥/口型锁=mode2 预留
            "inputs": [], "outputs": [],
            "widgets_values": [text],
        }
    nodes = [by_id[i] for i in sorted(by_id)]
    for idx, n in enumerate(nodes):
        n["order"] = idx
    for k in range(SHOT_COUNT):  # 偏差 4 剥槽:220+k 不再声明 audio_vae 输入槽
        n220 = by_id[220 + ID_STRIDE * k]
        n220["inputs"] = [i for i in n220.get("inputs", []) if i.get("name") != "audio_vae"]

    # 4) 链处理四步(design §2)
    # 偏差 4(1112 补测抓雷):引擎 0.45.2 的 MiniMaxH3ImageToVideo 已无 audio_vae 入参
    # (object_info 实证 required+optional 双无),母本 [120]→[220] 该线为 0.44 时代陈旧接线,
    # i2v 模式实弹必炸「unexpected keyword argument 'audio_vae'」——本台拔线剥槽;母本同病候用户另裁。
    m220 = next(n for n in mother["nodes"] if n["id"] == 220)
    AV_IDX = next((j for j, i in enumerate(m220.get("inputs", [])) if i.get("name") == "audio_vae"), None)
    raw_links: list[tuple[int, int, int, str]] = []  # (from, from_slot, to, to_slot, type) 前四+type
    for lid, frm, fslot, to, tslot, ltype in mother["links"]:
        if lid in DROP_LINK_IDS or frm in DROP or to in DROP:
            continue
        if to == 220 and AV_IDX is not None and tslot == AV_IDX:
            continue  # 陈旧 audio_vae 线(见偏差 4)
        f_in_t, t_in_t = frm in TEMPLATE, to in TEMPLATE
        if f_in_t and t_in_t:
            for k in range(SHOT_COUNT):
                raw_links.append((frm + ID_STRIDE * k, fslot, to + ID_STRIDE * k, tslot, ltype))
        elif frm in SHARED and t_in_t:
            for k in range(SHOT_COUNT):
                raw_links.append((frm, fslot, to + ID_STRIDE * k, tslot, ltype))
        else:  # FROM TEMPLATE→TO SHARED / 双端 SHARED:母本无此类,防御性单份保留
            raw_links.append((frm, fslot, to, tslot, ltype))

    # F1 开关语义(1112 深检;母本 73d91f9a 已同步修正,本块幂等):
    # 倒挂态(on_true←i2v 臂)→交换两臂槽位;已正态(on_true←r2v 臂)→直通。
    # 终态:true→on_true=r2v 臂(218+k←140+k / 221/222+k←16+k)、on_false←i2v 臂
    # (218+k←251+k / 221/222+k←220+k),与 219 title/Note103/台本卡「√=r2v」全文案对齐。
    # 250+k 恒吃 251+k 不动(σ 网格单源)。
    SWITCH_ARMS = {218: (140, 251), 221: (16, 220), 222: (16, 220)}  # base: (r2v_src, i2v_src)
    slot_of: dict[tuple[int, str], int] = {}
    for b in SWITCH_ARMS:
        names = [i.get("name") for i in mnodes[b].get("inputs", [])]
        slot_of[(b, "on_true")] = names.index("on_true")
        slot_of[(b, "on_false")] = names.index("on_false")
    for k in range(SHOT_COUNT):
        for b, (r2v_src, i2v_src) in SWITCH_ARMS.items():
            sw = b + ID_STRIDE * k
            j_t = [j for j, rl in enumerate(raw_links) if rl[2] == sw and rl[3] == slot_of[(b, "on_true")]]
            j_f = [j for j, rl in enumerate(raw_links) if rl[2] == sw and rl[3] == slot_of[(b, "on_false")]]
            if len(j_t) != 1 or len(j_f) != 1:
                raise AssertionError(f"F1 前置失败: 开关 {sw} on_true/on_false 槽各应恰一链, 实 {len(j_t)}/{len(j_f)}")
            if raw_links[j_t[0]][0] == i2v_src + ID_STRIDE * k:  # 倒挂态→换
                rl_t, rl_f = raw_links[j_t[0]], raw_links[j_f[0]]
                raw_links[j_t[0]] = rl_t[:3] + (slot_of[(b, "on_false")],) + rl_t[4:]
                raw_links[j_f[0]] = rl_f[:3] + (slot_of[(b, "on_true")],) + rl_f[4:]
            else:
                assert raw_links[j_t[0]][0] == r2v_src + ID_STRIDE * k, \
                    f"开关 {sw} on_true 源非两臂任一: {raw_links[j_t[0]][0]}"
    for k in range(SHOT_COUNT):  # 新链:三采文件化入口
        raw_links.append((NID_LOADVIDEO[k], 0, 339 + ID_STRIDE * k, 1, "VIDEO"))
    for k in range(SHOT_COUNT):  # 新链:草片拼三入口
        raw_links.append((130 + ID_STRIDE * k, 0, NID_CONCAT, k, "VIDEO"))
    raw_links.append((NID_CONCAT, 0, NID_DRAFT_SAVE, 0, "VIDEO"))  # 草片落盘

    links: list[list] = []          # 步骤 3:全量重编号 1..N(1109 重复占用前科)
    for new_id, (frm, fslot, to, tslot, ltype) in enumerate(raw_links, start=1):
        links.append([new_id, frm, fslot, to, tslot, ltype])

    # 步骤 4:inputs 回填 + outputs 全量重建(单源扇出多链引用由此自然成立)
    hits: dict[tuple[int, int], int] = {}
    for l in links:
        key = (l[3], l[4])
        if key in hits:
            raise AssertionError(f"同槽双链: node {l[3]} slot {l[4]} (links {hits[key]}/{l[0]})")
        hits[key] = l[0]
    for n in nodes:
        for i, inp in enumerate(n.get("inputs", [])):
            inp["link"] = hits.get((n["id"], i))
        outs = n.get("outputs", [])
        for si, out in enumerate(outs):
            out["links"] = [l[0] for l in links if l[1] == n["id"] and l[2] == si]

    # 5) 组框(design §4:bbox 自算,两两零交集)
    shot_members = [[n for n in nodes if n["id"] in
                     {i + ID_STRIDE * k for i in (FIRST_STAGE | SECOND_STAGE)}] for k in range(SHOT_COUNT)]
    third_ids = {338} | {i + ID_STRIDE * k for k in range(SHOT_COUNT) for i in THIRD_STAGE} | set(NID_LOADVIDEO)
    groups = [
        {"title": "镜头①(一采 p1-draft→二采 p2-final)", "bounding": bbox_of(shot_members[0]), "color": "#335533", "id": 9001, "mode": 0, "flags": {}},
        {"title": "镜头②(一采 p1-draft→二采 p2-final)", "bounding": bbox_of(shot_members[1]), "color": "#335533", "id": 9002, "mode": 0, "flags": {}},
        {"title": "镜头③(一采 p1-draft→二采 p2-final)", "bounding": bbox_of(shot_members[2]), "color": "#335533", "id": 9003, "mode": 0, "flags": {}},
        {"title": "草片拼(p1 人审·不进交付链)", "bounding": bbox_of([by_id[NID_CONCAT], by_id[NID_DRAFT_SAVE]]), "color": "#432255", "id": 9004, "mode": 0, "flags": {}},
        {"title": "三采·ReCaVSR 文件化(默认旁路;3300 系指向各镜 p2 产物)", "bounding": bbox_of([n for n in nodes if n["id"] in third_ids]), "color": "#3f789e", "id": 9005, "mode": 0, "flags": {}},
        {"title": "共享加载器(全台单源·扇出三镜)", "bounding": bbox_of([by_id[i] for i in (119, 120, 127, 128, 219)]), "color": "#553322", "id": 9006, "mode": 0, "flags": {}},
        {"title": "运行法则+台本卡", "bounding": bbox_of([by_id[i] for i in (103, 4000, 4001, 4002)]), "color": "#362933", "id": 9007, "mode": 0, "flags": {}},
    ]

    return {
        "config": {}, "extra": {}, "groups": groups, "id": "h3-director-console-1112",
        "last_link_id": len(links), "last_node_id": max(by_id), "links": links,
        "nodes": nodes, "revision": 1, "version": 0.4,
    }


def self_check(doc: dict) -> None:
    """终态自检(implement.md 步骤 1:§5 的 1/2/3 条为底线,外加零成本硬断言)。"""
    nodes = doc["nodes"]
    links = doc["links"]
    by_id = {n["id"]: n for n in nodes}
    link_ids = [l[0] for l in links]
    # §5-1:id 全件无重复 + 链 id 无重复
    assert len(by_id) == len(nodes), "节点 id 重复"
    assert len(set(link_ids)) == len(link_ids), "链 id 重复"
    # §5-2:悬空引用双向扫 + outputs 重建一致性
    for l in links:
        assert l[1] in by_id, f"链 {l[0]} from 节点 {l[1]} 不存在"
        assert l[3] in by_id, f"链 {l[0]} to 节点 {l[3]} 不存在"
        assert l[2] < len(by_id[l[1]].get("outputs", [])), f"链 {l[0]} from_slot {l[2]} 越界(node {l[1]})"
        assert l[4] < len(by_id[l[3]].get("inputs", [])), f"链 {l[0]} to_slot {l[4]} 越界(node {l[3]})"
    idset = set(link_ids)
    for n in nodes:
        for i, inp in enumerate(n.get("inputs", [])):
            assert inp.get("link") is None or inp["link"] in idset, \
                f"节点 {n['id']} 输入 {i} 引用悬空链 {inp.get('link')}"
        for si, out in enumerate(n.get("outputs", [])):
            expect = [l[0] for l in links if l[1] == n["id"] and l[2] == si]
            assert out.get("links", []) == expect, \
                f"节点 {n['id']} 输出 {si} 重建不一致: {out.get('links')} != {expect}"
    # §5-3:SHARED 恰一份
    for sid in (119, 120, 127, 128, 219, 338):
        cnt = sum(1 for n in nodes if n["id"] == sid)
        assert cnt == 1, f"SHARED 节点 {sid} 份数={cnt}"
    # 门控矩阵(§3/§5-8)
    for k in range(SHOT_COUNT):
        for nid in FIRST_STAGE:
            assert by_id[nid + ID_STRIDE * k]["mode"] == 0, f"一采件 {nid + ID_STRIDE * k} mode!=0"
        for nid in SECOND_STAGE | THIRD_STAGE:
            assert by_id[nid + ID_STRIDE * k]["mode"] == 2, f"二三采件 {nid + ID_STRIDE * k} mode!=2"
        assert by_id[NID_LOADVIDEO[k]]["mode"] == 2
    for sid in SHARED:
        assert by_id[sid]["mode"] == 0, f"SHARED {sid} mode!=0"
    assert by_id[NID_CONCAT]["mode"] == 0 and by_id[NID_DRAFT_SAVE]["mode"] == 0
    # 模型钉值(§5-5)
    pins = {127: ("unet_name", "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors", 0),
            128: ("clip_name", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", 0),
            119: ("vae_name", "minimax_h3_video_vae_int8_convrot.safetensors", 0),
            120: ("vae_name", "minimax_h3_audio_vae_fp32.safetensors", 0),
            338: ("transformer", "transformer_int8_convrot.safetensors", 0)}
    for nid, (key, val, idx) in pins.items():
        named = by_id[nid].get("widgets_values_named") or {}
        got = named.get(key, by_id[nid]["widgets_values"][idx])
        assert got == val, f"钉值漂移 node {nid} {key}={got}"
    for k in range(SHOT_COUNT):
        for nid, lora, st in ((145 + ID_STRIDE * k, "pika_h3_flex_ref2va_comfy_bf16.safetensors", 1),
                              (216 + ID_STRIDE * k, "pika_turbo_8step_fl2va.safetensors", 1),
                              (202 + ID_STRIDE * k, "taomate_h3_3step.safetensors", 0.7)):
            wv = by_id[nid]["widgets_values"]
            assert wv[0] == lora and wv[1] == st, f"LoRA 钉值漂移 node {nid}: {wv}"
    # 组框:两两零交集 + 非_note 节点∈恰一组(§4/§5-9)
    groups = doc["groups"]

    def grect(g):
        bx, by, bw, bh = g["bounding"]
        return (bx, by, bx + bw, by + bh)

    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            a, b = grect(groups[i]), grect(groups[j])
            ox = min(a[2], b[2]) - max(a[0], b[0])
            oy = min(a[3], b[3]) - max(a[1], b[1])
            assert not (ox > 0 and oy > 0), f"组 {groups[i]['id']}×{groups[j]['id']} bbox 相交"
    for n in nodes:
        if n["type"] == "MarkdownNote":
            continue
        r = rect(n)
        inside = [g["id"] for g in groups
                  if r[0] >= grect(g)[0] and r[1] >= grect(g)[1] and r[2] <= grect(g)[2] and r[3] <= grect(g)[3]]
        assert len(inside) == 1, f"节点 {n['id']} 组归属={inside}"
    # 类白名单(§5-9)
    mother_types = {n["type"] for n in json.loads(MOTHER.read_text(encoding="utf-8"))["nodes"]}
    bad = {n["type"] for n in nodes} - mother_types - {"ConcatenateVideo", "LoadVideo", "MarkdownNote"}
    assert not bad, f"类白名单外: {bad}"
    # 草片拼/三采接线(§5-11)
    for k in range(SHOT_COUNT):
        assert any(l[1] == 130 + ID_STRIDE * k and l[3] == NID_CONCAT and l[4] == k for l in links), f"镜{k + 1} 130→3000 缺链"
        assert any(l[1] == NID_LOADVIDEO[k] and l[3] == 339 + ID_STRIDE * k for l in links), f"镜{k + 1} 3300→339 缺链"
    assert any(l[1] == NID_CONCAT and l[3] == NID_DRAFT_SAVE for l in links), "3000→3001 缺链"
    # F1 开关语义(1112 修正后):[219] 扇出恰 9 链进三镜三开关 switch 槽;方向 true→on_true=r2v 臂
    assert by_id[219]["widgets_values"] == [True], "[219] 出厂应 widgets [true]"
    fanout = [l for l in links if l[1] == 219]
    expect_sw = {b + ID_STRIDE * k for b in (218, 221, 222) for k in range(SHOT_COUNT)}
    assert len(fanout) == 9 and {l[3] for l in fanout} == expect_sw and all(l[4] == 0 for l in fanout), \
        f"[219] 开关扇出应 9 链全进三镜 218/221/222 switch 槽, 实 {[(l[3], l[4]) for l in fanout]}"
    for k in range(SHOT_COUNT):
        off = ID_STRIDE * k
        for sw, t_src, f_src in ((218 + off, 140 + off, 251 + off),  # 底模:r2v=140 直供 / i2v=251 σshift
                                 (221 + off, 16 + off, 220 + off),   # 条件:r2v=16 / i2v=220
                                 (222 + off, 16 + off, 220 + off)):  # 潜空间:r2v=16 / i2v=220
            names = [i.get("name") for i in by_id[sw]["inputs"]]
            it, if_ = names.index("on_true"), names.index("on_false")
            assert any(l[1] == t_src and l[3] == sw and l[4] == it for l in links), \
                f"开关 {sw}.on_true 应←r2v 臂 {t_src}(F1 倒挂修正)"
            assert any(l[1] == f_src and l[3] == sw and l[4] == if_ for l in links), \
                f"开关 {sw}.on_false 应←i2v 臂 {f_src}(F1 倒挂修正)"
        assert any(l[1] == 251 + off and l[3] == 250 + off for l in links), \
            f"镜{k + 1} [250+{off}] 应恒吃 [251+{off}](母本刻意接线,不动)"
    # F3:206+k/208+k title 陈旧文案已换 1440×832
    for k in range(SHOT_COUNT):
        for nid in (206 + ID_STRIDE * k, 208 + ID_STRIDE * k):
            t = by_id[nid].get("title") or ""
            assert "1280×704" not in t and "1440×832" in t, f"节点 {nid} title 陈旧文案未换: {t}"


def main() -> int:
    mother_sha = sha_file(MOTHER)
    tree_before = len(list(WORKFLOWS_ROOT.rglob("*.json")))
    doc = build()
    self_check(doc)
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    OUT.write_text(text, encoding="utf-8")
    # 落盘后复检:母本零改动 + 产物可解析 + 二次构建字节一致(幂等) + 树计数锚
    assert sha_file(MOTHER) == mother_sha, "母本被改动(铁律④)"
    assert json.loads(OUT.read_text(encoding="utf-8"))["id"] == "h3-director-console-1112"
    assert json.dumps(build(), ensure_ascii=False, indent=1) == text, "二次构建漂移(非幂等)"
    tree_after = len(list(WORKFLOWS_ROOT.rglob("*.json")))
    assert tree_after == TREE_ANCHOR, f"树计数 {tree_after} != 锚 {TREE_ANCHOR}(跑前={tree_before})"
    print(f"OK 导演台.json: nodes={len(doc['nodes'])} links={len(doc['links'])} "
          f"groups={len(doc['groups'])} shots={SHOT_COUNT} tree={tree_after}(锚 {TREE_ANCHOR})")
    print(f"   out={OUT}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"SELF-CHECK FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
