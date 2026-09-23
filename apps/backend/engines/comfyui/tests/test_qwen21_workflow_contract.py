"""Qwen-Image-2.1(Q2-1图像)工作流契约测试(09-23 制作;同日深夜扩三件;同日 PRO 件四件;同日装配子图轮改名;同日午道劫直写旧件退役删件)。

被测对象 = 仓库真源三件(09-23 午道劫直写旧件 qwen21-daojie 退役删除后):
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-t2i.json
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json
    engines/comfyui/workflows/1_图片/Q2-1图像/3_改图/qwen21-edit.json

格式口径(09-23 取舍,引擎 v0.37 直开为最终裁判):三件为**引擎前端格式**
(nodes/links/groups + MarkdownNote + pos 布局),非桥 API 格式
(schemaVersion+graph)——桥格式画布打不开(plugin_manager._is_bridge_template
刻意不进侧栏),而设计要求横向排版/group id/MarkdownNote 使用说明,只有前端
格式能承载;布线语义从官方模板 image_qwen_image_2_1_t2i/image_edit 换算。

09-23 深夜三改造(用户拍板:PE进画布/RGBA要选项/道劫单独适配;其幂等生成器脚本
随 09-23 午道劫直写旧件退役一并删除):
  A. t2i 加「PE 提示词改写组」默认旁路——PE 专用 CLIPLoader
     (qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16,type=qwen_image)→ 插件节点
     QwenImage21_T2IPromptRewrite(类名逐字)→ 核心 ComfySwitchNode(STRING)
     二选一 → TextEncodeQwenImage21.prompt(转换输入)。
  B. t2i 加「RGBA 透明开关」默认普通——双 TextEncodeQwenImage21
     conditioning(普通 vs 官方 RGBA 包裹句式)→ ComfySwitchNode
     (CONDITIONING)二选一 → KSampler.positive。
  C. 新增 daojie 直写件(以改造后 t2i 为骨架,默认直写提示词=道劫水墨国风修仙
     英文长文;DNA:ink wash/expressive brushwork/expansive negative space/
     Chinese cultivation-fantasy;零质量词)——该件 09-23 午定谳被 qi21 件
     完全取代,随本轮退役删除。

09-23 装配子图轮(用户三件令:改名+子图化+底座美化;幂等脚本
apps/build/scripts/qi21_daojie_t2i_0923.py 驱动;前代 qwen21-daojie-t2i-pro.json
与其生成器 qwen21_daojie_pro_0923.py 随本轮退役删除):
  H. 旧 pro 件(九型分层装配平铺版)改名 qi21-道劫-t2i.json 并**子图化**——
     布局学 K2-文生图-道劫.json [90] 组织法:『底座九选一+主体句+通用锁层+
     装配链+PE 组+RGBA 开关』整体收进一个 definitions.subgraphs 子图(宿主
     [40]);外部只剩加载器/分辨率/采样/解码/保存/说明 Note 与外露件
     ([24] 主体句、[27] 装配预览)。子图外露参数:型选择控制(八级选型开关=
     宿主面板 BOOLEAN widget 输入)、主体句([24] PrimitiveStringMultiline,
     仿 K2 [50])、PE 开关/RGBA 开关(宿主面板)、分辨率([4])、seed([7])。
     子图契约(docs/comfyui-kb/子图工作流工程契约.md):groups 必带 int id、
     子图 IO 必须写 inputs[].linkIds/outputs[].linkIds、内部 links 对象格式。
  I. 九型底座常量=05 库②层「09-23 美化版」(《三国望神州》v2.2+手册词汇成文,
     纯画法零物象骨/锁质要点逐项保留/禁自造质感词与质量词);canon-json
     逐字锚废止,型名/顺序仍与 daojie_bases.json 对齐;通用锁层常量A 照旧
     逐字=库首常量(写全条款不动)。真源链:05 库→工作流常量逐字=库→本测试
     库↔工作流互锁(TestQi21SubgraphContract)。

design.md §6 七条对应:TestFilesInPlace(1)/TestLoaderTriple(2)/
TestSamplerContract(3)/TestTopology(4)/TestCanvasDiscipline(5)/
TestEditContract(6)/TestCountAnchor(7);深夜新增 TestCanvasOptions(A+B;
TestDaojieContract(C)随道劫直写旧件 09-23 午退役删除);装配子图轮新增
TestQi21SubgraphContract(H+I,取代旧 TestDaojieProContract)。
其中第 5 条的「新 schema 必需字段(schemaVersion/graph)在位」随格式取舍改为
「前端格式必需字段(nodes/links/groups)在位」——schemaVersion/graph 是桥 API
格式字段,与画布流格式互斥(混写会被侧栏当成画布件解析出错)。

09-23 布局重排轮(用户裁定:子图布局太奇葩、group 泛滥——改「从上到下=阶段
行、行内从左到右」):TestQi21SubgraphContract 新增排版断言——子图恰 4 行=
四阶段(底座常量/选型级联/装配路由/编码输出),行间 y 严格递增且净行距≥100,
行内(数据流序)x 严格递增,主图+子图节点零重叠;group 预算 子图≤2/主图≤3;
真源=生成器 qi21_daojie_t2i_0923.py 布局段(改布局禁手改 json)。

纯读文件断言,零网络零引擎依赖(真前端 graphToPrompt 干跑与实弹由 e2e 层
另行验证)。

09-23 修复轮注记:脚本层 pytest 曾报「file or directory not found」——本地仓库根
同命令 collect 正常,文件运行期零 cwd 依赖(真源定位走 __file__,json 读取与
rglob 均绝对锚定);根因是执行侧以非仓库根 cwd 解析仓库相对路径,修复=调用侧
改用绝对路径寻址本文件,测试逻辑无改动。
"""
from __future__ import annotations

import json
import pathlib
import re

# ── 真源定位 ──────────────────────────────────────────────────────

_TESTS_DIR = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS_DIR.parents[4]  # tests → comfyui → engines → backend → apps → 仓库根
_IMG_DIR = _TESTS_DIR.parent / "workflows" / "1_图片"
T2I = _IMG_DIR / "Q2-1图像" / "1_文生图" / "qwen21-t2i.json"
QI21 = _IMG_DIR / "Q2-1图像" / "1_文生图" / "qi21-道劫-t2i.json"
EDIT = _IMG_DIR / "Q2-1图像" / "3_改图" / "qwen21-edit.json"
K2_DIR = _IMG_DIR / "K2图像"
PROMPT_LIB = _REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
BASES_JSON = _TESTS_DIR.parent / "my_nodes/nodes/daojie_bases.json"

WORKFLOWS = {"t2i": T2I, "edit": EDIT, "qi21": QI21}
GRAPHS = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in WORKFLOWS.items()}

# 加载器三件套(bf16,MPS 主选;int8_convrot 是 CUDA 路线不用)
UNET_FILE = "qwen_image_2.1_bf16.safetensors"
CLIP_FILE = "qwen3vl_8b_bf16.safetensors"
VAE_FILE = "qwen_image_2.1_vae_bf16.safetensors"

# PE 改写组契约(插件 ComfyUI-Qwen-Image-2.1-Prompt-Enhancer)
PE_CLASS = "QwenImage21_T2IPromptRewrite"
PE_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"
# QwenImage21_T2IPromptRewrite widgets_values 序(插件 INPUT_TYPES 真实字段序):
# [prompt, temperature, top_p, top_k, presence_penalty, max_new_tokens, seed]
PE_PARAMS = [1.0, 0.95, 20, 1.5, 16256, 42]

# PE-I2I(edit 件)契约:类名/权重/参数序(09-23;object_info 实读)
PE_I2I_CLASS = "QwenImage21_EditPromptRewrite"
PE_I2I_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors"
# QwenImage21_EditPromptRewrite widgets_values 序(required+optional 实读):
# [prompt, temperature, top_p, presence_penalty, max_length, seed]
# 官方 Edit 硬口径:presence_penalty=0(T2I 是 1.5,Edit 必 0)、max_length=24000
PE_I2I_PARAMS = [1.0, 0.95, 0.0, 24000, 42]

# RGBA 官方包裹句式(模板原文,逐字)——t2i/edit 旧件沿用(固定演示句版)
RGBA_HEAD = "This is an RGBA format image with transparency."
RGBA_TAIL = "The image has an alpha channel and a transparent background."
# RGBA 官方公式头尾(qi21 件 09-23 深检吸收轮正字:research/12 答A必改1——旧版
# 『an RGBA format image/a transparent background』两处微差就此对齐官方原文)
RGBA_HEAD_OFFICIAL = "This is an RGBA image with transparency."
RGBA_TAIL_OFFICIAL = "The image has alpha channel and the background is transparent."
RGBA_HEAD_ZH = "这是一张带有透明度的RGBA图像。"
RGBA_TAIL_ZH = "该图像具有alpha通道,背景是透明的。"

# KSampler widgets_values 序:[seed, control, steps, cfg, sampler, scheduler, denoise]
K_SAMPLER_WV = {"seed": 0, "steps": 2, "cfg": 3, "sampler": 4, "scheduler": 5, "denoise": 6}
# TextEncodeQwenImage21 widgets_values 序:[prompt, negative_prompt, resolution]
TE_WV = {"prompt": 0, "negative": 1, "resolution": 2}

# qi21 件结构锚(id 与生成器 qi21_daojie_t2i_0923.py 同表;09-23 总装轮:
# MyQi21DaojieBase 进子图,九 StringConstant 与八级级联退役)
QI21_HOST_ID = 40
QI21_SUBJECT_ID, QI21_PREVIEW_ID = 24, 27
QI21_LATENT_ID, QI21_SAMPLER_ID = 5, 7
QI21_SG_BASE_ID = 150                                              # MyQi21DaojieBase 九选一
QI21_SG_LOCK_ID = 110                                              # 通用锁层常量A
QI21_SG_RGBA_HEAD_ID, QI21_SG_RGBA_TAIL_ID = 160, 161              # RGBA 官方头/尾常量
QI21_SG_CONCAT_IDS = [130, 131]
QI21_SG_RGBA_CAT_IDS = [162, 163]                                  # RGBA 公式拼接
QI21_SG_PE_RW, QI21_SG_PE_SW = 140, 141
QI21_SG_TE, QI21_SG_TE_RGBA, QI21_SG_RGBA_SW = 142, 143, 144
QI21_SG_RATIO_IDS = [151, 152]                                     # wh_ratio 正则取宽/高比
QI21_SG_CONV_IDS = [153, 154]                                      # 字串→数
QI21_SG_MATH_IDS = [155, 156]                                      # 公式求宽/高
QI21_SG_SW_WH_IDS = [157, 158]                                     # 宽/高联动开关(INT)
# 人物系六型(库 §二:常量B 加挂型)
PRO_CHAR_TYPES = ("人物", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分")
# ④配色行映射(库 §一映射表)
PRO_COLOR_MAP = {
    "人物": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "场景": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
    "道具": "道具旧金=宣纸白+浓墨+旧金+暗玉青",
    "美宣": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "三视图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "高清人脸": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "分镜剧情图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "表情差分": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "概念气氛图": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
}
# 宿主面板 widget 型子图输入(槽序;①主体句外连 [24],其余为面板 widget)
QI21_HOST_WIDGET_INPUTS = [
    "主体句", "型选择", "PE改写开关", "RGBA透明开关", "画幅联动开关",
]
QI21_BASES_JSON = _TESTS_DIR.parent / "my_nodes/nodes/qi21_bases.json"


def _nodes(graph: dict) -> dict:
    return {n["id"]: n for n in graph["nodes"]}


def _by_type(graph: dict, class_type: str) -> list[dict]:
    return [n for n in graph["nodes"] if n.get("type") == class_type]


def _widget(node: dict, index: int):
    return node["widgets_values"][index]


def _links(graph: dict) -> dict:
    return {link[0]: link for link in graph["links"]}


def _resolve_default_string_origins(graph: dict) -> dict:
    """沿主编码 prompt 上游开关的 false 支路走到底 = 默认直写路的最终来源集合。

    t2i:零跳,StringConstant 直接。"""
    nodes, links = _nodes(graph), _links(graph)
    main_te = next(
        n for n in graph["nodes"]
        if n["type"] == "TextEncodeQwenImage21"
        and any(i["name"] == "prompt" and i.get("link") for i in n["inputs"])
    )
    stack = [nodes[links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")][1]]]
    origins: dict[int, dict] = {}
    hops = 0
    while stack:
        node = stack.pop()
        if node["id"] in origins:
            continue
        origins[node["id"]] = node
        hops += 1
        assert hops <= 60, "默认链解析超限(疑似环)"
        if node["type"] == "ComfySwitchNode":
            assert node["widgets_values"][0] is False, \
                f"默认链中途开关非 false: node{node['id']} {node.get('title')!r}"
            stack.append(nodes[links[node["inputs"][0]["link"]][1]])
        elif node["type"] == "StringConcatenate":
            for inp in node["inputs"]:
                if inp.get("link") is not None:
                    stack.append(nodes[links[inp["link"]][1]])
    return {nid: n for nid, n in origins.items() if n["type"] == "StringConstant"}


# ── 1. 四文件在位、文件名合规(09-18 命名铁律:无 MY- 前缀、无下划线)──

class TestFilesInPlace:
    def test_all_files_exist(self):
        for name, path in WORKFLOWS.items():
            assert path.is_file(), f"Q2-1图像 {name} 件缺失: {path}"

    def test_filenames_comply_naming_rules(self):
        for path in WORKFLOWS.values():
            stem = path.stem
            assert not stem.startswith("MY-"), f"{path.name} 残留 MY- 前缀(09-18 废止)"
            assert "_" not in stem, f"{path.name} 含下划线(命名铁律:一律连字符)"


# ── 2. 加载器契约(bf16 三件 + CLIPLoader type=qwen_image;PE 组带专属加载器)──

class TestLoaderTriple:
    def test_unet_loader_exact_file(self):
        for name, graph in GRAPHS.items():
            loaders = _by_type(graph, "UNETLoader")
            assert len(loaders) == 1, f"{name}: UNETLoader 应恰 1 个"
            assert _widget(loaders[0], 0) == UNET_FILE, \
                f"{name}: unet_name 应逐字 {UNET_FILE!r}"

    def test_clip_loader_exact_file_and_type(self):
        for name, graph in GRAPHS.items():
            loaders = _by_type(graph, "CLIPLoader")
            expected = 2  # 三件全带 PE 组另加一个 PE 加载器
            assert len(loaders) == expected, f"{name}: CLIPLoader 应恰 {expected} 个"
            main = [n for n in loaders if _widget(n, 0) == CLIP_FILE]
            assert len(main) == 1, f"{name}: 主 CLIP(qwen3vl_8b_bf16)应恰 1 个"
            assert _widget(main[0], 1) == "qwen_image", \
                f"{name}: 主 CLIPLoader type 必须为 qwen_image"

    def test_pe_clip_loader_exact_file_and_type(self):
        pe_files = {"t2i": PE_CLIP_FILE, "edit": PE_I2I_CLIP_FILE}
        for name, expected_file in pe_files.items():
            graph = GRAPHS[name]
            pe_clips = [n for n in _by_type(graph, "CLIPLoader") if _widget(n, 0) == expected_file]
            assert len(pe_clips) == 1, f"{name}: PE CLIPLoader 应恰 1 个(权重文件名逐字 {expected_file})"
            assert _widget(pe_clips[0], 1) == "qwen_image", \
                f"{name}: PE CLIPLoader type 必须为 qwen_image(PE 走原生 CLIPLoader 路线)"

    def test_vae_loader_exact_file(self):
        for name, graph in GRAPHS.items():
            loaders = _by_type(graph, "VAELoader")
            assert len(loaders) == 1, f"{name}: VAELoader 应恰 1 个"
            assert _widget(loaders[0], 0) == VAE_FILE, \
                f"{name}: vae_name 应逐字 {VAE_FILE!r}"


# ── 3. KSampler 参数(cfg=1.0 / 25-50 步 / euler+simple / denoise=1.0)──

class TestSamplerContract:
    def test_sampler_params(self):
        for name, graph in GRAPHS.items():
            samplers = _by_type(graph, "KSampler")
            assert len(samplers) == 1, f"{name}: KSampler 应恰 1 个"
            wv = samplers[0]["widgets_values"]
            assert wv[K_SAMPLER_WV["cfg"]] == 1.0, f"{name}: cfg 必须恒 1.0(官方路径)"
            assert 25 <= wv[K_SAMPLER_WV["steps"]] <= 50, \
                f"{name}: steps 应在官方区间 25-50(模板 25 起手)"
            assert wv[K_SAMPLER_WV["sampler"]] == "euler", f"{name}: sampler 必须 euler"
            assert wv[K_SAMPLER_WV["scheduler"]] == "simple", f"{name}: scheduler 必须 simple"
            assert wv[K_SAMPLER_WV["denoise"]] == 1.0, f"{name}: denoise 必须 1.0"

    def test_qi21_steps_full_tier_40(self):
        """qi21 件 09-23 总装轮用户令『不希望25步,要完整态』:steps 钉 40
        (官方完整档;官方区间 40-50 写进 Note)。"""
        wv = _by_type(GRAPHS["qi21"], "KSampler")[0]["widgets_values"]
        assert wv[K_SAMPLER_WV["steps"]] == 40, \
            f"qi21 steps 应=40(官方完整档,用户令完整态),得 {wv[K_SAMPLER_WV['steps']]}"

    def test_seed_control_modes(self):
        assert _widget(_by_type(GRAPHS["t2i"], "KSampler")[0], 1) == "fixed", \
            "t2i 件 seed 应 fixed(官方 t2i 模板口径)"
        assert _widget(_by_type(GRAPHS["edit"], "KSampler")[0], 1) == "randomize", \
            "edit 件 seed 应 randomize(官方 edit 模板口径)"
        assert _widget(_by_type(GRAPHS["qi21"], "KSampler")[0], 1) == "fixed", \
            "qi21 件 seed 应 fixed(风格迭代要可复现,随 daojie 骨架)"


# ── 4. 链路完整性(link 双向一致、无孤儿节点、输出节点可达)─────────

class TestTopology:
    def test_links_bidirectional_consistency(self):
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            for link in graph["links"]:
                lid, origin_id, origin_slot, target_id, target_slot, typ = link
                origin, target = nodes[origin_id], nodes[target_id]
                assert typ == origin["outputs"][origin_slot]["type"], \
                    f"{name} link{lid}: origin 槽类型不匹配"
                assert lid in (origin["outputs"][origin_slot].get("links") or []), \
                    f"{name} link{lid}: origin.outputs[{origin_slot}].links 未登记 {lid}"
                assert target["inputs"][target_slot].get("link") == lid, \
                    f"{name} link{lid}: target.inputs[{target_slot}].link != {lid}"

    def test_no_orphans_and_save_reachable(self):
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            savers = _by_type(graph, "SaveImage")
            assert len(savers) == 1, f"{name}: SaveImage 应恰 1 个"
            seen, stack = set(), [savers[0]["id"]]
            while stack:
                nid = stack.pop()
                if nid in seen:
                    continue
                seen.add(nid)
                node = nodes[nid]
                for slot_index, inp in enumerate(node.get("inputs", [])):
                    lid = inp.get("link")
                    if lid is None:
                        continue
                    origin_id = next(l[1] for l in graph["links"] if l[0] == lid)
                    stack.append(origin_id)
            # MarkdownNote=说明卡、easy showAnything=显示型端点(画布预览,无下游)——
            # 两者都是合法画布端点,不计孤儿(qi21 件 [27] 装配预览,骨承 K2 件 [62]/[86])
            display_endpoints = {"MarkdownNote", "easy showAnything"}
            orphans = sorted(
                nodes[i]["type"] for i in nodes
                if i not in seen and nodes[i]["type"] not in display_endpoints
            )
            assert not orphans, f"{name}: 存在不可达 SaveImage 的孤儿节点: {orphans}"

    def test_t2i_resolution_selector_feeds_latent(self):
        for name in ("t2i",):
            graph = GRAPHS[name]
            nodes = _nodes(graph)
            selectors = _by_type(graph, "ResolutionSelector")
            assert len(selectors) == 1, f"{name}: 应含 ResolutionSelector(官方档位出宽高)"
            latent = _by_type(graph, "EmptyLatentImage")[0]
            width_in = latent["inputs"][0]
            assert width_in["name"] == "width" and width_in["link"] is not None, \
                f"{name}: EmptyLatentImage.width 必须由 ResolutionSelector.width 供给"
            origin_id = next(l[1] for l in graph["links"] if l[0] == width_in["link"])
            assert nodes[origin_id]["type"] == "ResolutionSelector", \
                f"{name}: EmptyLatentImage.width 上游必须是 ResolutionSelector"

    def test_qi21_latent_fed_by_subgraph_width_height(self):
        """qi21 件 09-23 总装轮:ResolutionSelector 退役,[5] 空潜宽高=子图宿主
        width/height 输出直驱(MyQi21DaojieBase 按型直出 W/H)。"""
        graph = GRAPHS["qi21"]
        assert not _by_type(graph, "ResolutionSelector"), \
            "qi21 件不应再有 ResolutionSelector(写死档位表已废止,宽高随型直驱)"
        latent = _by_type(graph, "EmptyLatentImage")[0]
        for slot, want_out in ((0, "width"), (1, "height")):
            inp = latent["inputs"][slot]
            assert inp["name"] == want_out and inp["link"] is not None, \
                f"qi21: EmptyLatentImage.{want_out} 必须由 [40] 宿主 {want_out} 输出供给"
            link = next(l for l in graph["links"] if l[0] == inp["link"])
            assert link[1] == QI21_HOST_ID and link[2] == (3 if want_out == "width" else 4), \
                f"qi21: EmptyLatentImage.{want_out} 上游应是 [40] 宿主 {want_out} 输出槽"


# ── 5. 画布纪律(前端格式必需字段、groups 全带 id、横向排版、说明 Note)──

class TestCanvasDiscipline:
    def test_frontend_format_required_fields(self):
        for name, graph in GRAPHS.items():
            for field in ("nodes", "links", "groups"):
                assert isinstance(graph.get(field), list), \
                    f"{name}: 前端格式必需字段 {field} 缺失或非数组"
            assert "schemaVersion" not in graph and "graph" not in graph, \
                f"{name}: 画布流不得混入桥 API 格式字段(schemaVersion/graph)"

    def test_groups_all_carry_id(self):
        for name, graph in GRAPHS.items():
            assert graph["groups"], f"{name}: 应有分组(引擎 1.53 契约:缺 id 只活第一个)"
            for group in graph["groups"]:
                assert isinstance(group.get("id"), int), \
                    f"{name}: group {group.get('title')!r} 缺 id 字段(缺 id 只活第一个)"
            if graph.get("definitions", {}).get("subgraphs"):
                for sg in graph["definitions"]["subgraphs"]:
                    assert sg["groups"], f"{name}: 子图应有分组"
                    for group in sg["groups"]:
                        assert isinstance(group.get("id"), int), \
                            f"{name}: 子图 group {group.get('title')!r} 缺 id 字段"

    def test_horizontal_layout_no_vertical_tower(self):
        """每条连线 target.x > origin.x:数据流恒向右=每链横向一行,纵塔不可过。
        子图内部同判(边界线以子图 IO 槽 pos 为端点)。"""
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            for link in graph["links"]:
                origin, target = nodes[link[1]], nodes[link[3]]
                assert target["pos"][0] > origin["pos"][0], (
                    f"{name} link{link[0]}: {origin['type']}→{target['type']} "
                    f"未向右({origin['pos']} → {target['pos']}),纵向塔违规"
                )
            for sg in graph.get("definitions", {}).get("subgraphs", []):
                i_nodes = {n["id"]: n for n in sg["nodes"]}
                for l in sg["links"]:
                    ox = sg["inputs"][l["origin_slot"]]["pos"][0] \
                        if l["origin_id"] == -10 else i_nodes[l["origin_id"]]["pos"][0]
                    tx = sg["outputs"][l["target_slot"]]["pos"][0] \
                        if l["target_id"] == -20 else i_nodes[l["target_id"]]["pos"][0]
                    assert tx > ox, (
                        f"{name} 子图 link{l['id']}: 未向右({ox} → {tx}),纵向塔违规"
                    )

    def test_usage_note_with_parameter_bible(self):
        # qi21 件 09-23 吸收轮起 RGBA 句式=官方正字(This is an RGBA image…);
        # t2i/edit 旧件沿用旧句式(This is an RGBA format image…)
        rgba_token = {
            "qi21": RGBA_HEAD_OFFICIAL, "t2i": RGBA_HEAD, "edit": RGBA_HEAD,
        }
        for name, graph in GRAPHS.items():
            notes = _by_type(graph, "MarkdownNote")
            assert notes, f"{name}: 应有 MarkdownNote 使用说明(禁大标题横幅,说明卡合法)"
            text = notes[0]["widgets_values"][0]
            assert "cfg 恒 1" in text, f"{name}: 说明缺参数圣经要点(cfg 恒 1)"
            assert rgba_token[name] in text, \
                f"{name}: 说明缺 RGBA 透明句式原文({rgba_token[name]!r})"
            assert "qwen-image-2-1-prompter" in text, \
                f"{name}: 说明缺已装提示词技能 qwen-image-2-1-prompter 提示"
            assert not text.lstrip().startswith("# "), \
                f"{name}: 说明以一级大标题开幅(画布禁大标题横幅)"


# ── 6. edit 件专属契约(双图输入、官方换装例句、resolution=0)────────

class TestEditContract:
    def test_textencode_has_two_image_inputs_wired(self):
        graph = GRAPHS["edit"]
        encoders = _by_type(graph, "TextEncodeQwenImage21")
        assert len(encoders) == 1, "edit 件应恰 1 个 TextEncodeQwenImage21"
        wired = [i for i in encoders[0]["inputs"] if i["name"].startswith("images.") and i.get("link")]
        assert len(wired) >= 2, "TextEncodeQwenImage21 应接 ≥2 张图(image_1 画布 + image_2 参考)"

    def test_prompt_is_official_outfit_example(self):
        graph = GRAPHS["edit"]
        encoder = _by_type(graph, "TextEncodeQwenImage21")[0]
        assert _widget(encoder, TE_WV["prompt"]) == "", \
            "09-23 PE 组轮起直写指令收进 StringConstant,主编码 prompt widget 应清空"
        origins = _resolve_default_string_origins(graph)
        assert len(origins) == 1, f"直写路应恰 1 个源,得 {sorted(origins)}"
        prompt = _widget(next(iter(origins.values())), 0)
        for token in ("<image1>", "<image2>"):
            assert token in prompt, f"默认 prompt 应含点名 {token}"
        assert "denim shirt" in prompt, "默认 prompt 应为官方换装例句(light blue denim shirt)"
        assert _widget(encoder, TE_WV["resolution"]) == 0, \
            "edit 件 resolution 应=0(不重采样,仅取整 32 倍数,输出跟随 image_1)"

    def test_load_images_are_official_samples(self):
        images = sorted(
            _widget(n, 0) for n in _by_type(GRAPHS["edit"], "LoadImage")
        )
        assert images == ["clothing_light_blue_denim_shirt.png", "portrait_model_denim.png"], \
            f"edit 件应预填官方示例双图(人像+衬衫),得 {images}"

    def test_latent_follows_textencode_output(self):
        """潜空取 TextEncode.latent(custom_size off 官方默认语义,禁接 EmptyLatentImage)。"""
        graph = GRAPHS["edit"]
        assert not _by_type(graph, "EmptyLatentImage"), \
            "edit 件不应带 EmptyLatentImage(简化为默认路径:latent 跟随 image_1)"
        sampler = _by_type(graph, "KSampler")[0]
        latent_in = next(i for i in sampler["inputs"] if i["name"] == "latent_image")
        origin_id = next(l[1] for l in graph["links"] if l[0] == latent_in["link"])
        assert _nodes(graph)[origin_id]["type"] == "TextEncodeQwenImage21", \
            "KSampler.latent_image 上游必须是 TextEncodeQwenImage21.latent"
        assert _by_type(graph, "QwenImage21Cache"), "edit 件应带 QwenImage21Cache(auto)"


# ── 6a. edit 件 PE-I2I 改写组契约(09-23:看图改写,Edit 硬口径)────────

class TestEditPEContract:
    def test_edit_pe_node_and_hard_params(self):
        graph = GRAPHS["edit"]
        pe_nodes = _by_type(graph, PE_I2I_CLASS)
        assert len(pe_nodes) == 1, "edit 件应恰 1 个 QwenImage21_EditPromptRewrite"
        assert pe_nodes[0]["widgets_values"][1:] == PE_I2I_PARAMS, \
            f"PE-I2I 参数漂移(官方 Edit 硬口径 {PE_I2I_PARAMS}),得 {pe_nodes[0]['widgets_values'][1:]}"

    def test_edit_pe_group_titled_with_ids(self):
        graph = GRAPHS["edit"]
        titles = [g.get("title", "") for g in graph["groups"]]
        assert any("PE-I2I 改写组" in t and "默认旁路" in t for t in titles), \
            "edit 件缺「PE-I2I 改写组(默认旁路…)」分组"
        ids = [g.get("id") for g in graph["groups"]]
        assert len(ids) == len(set(ids)) and all(isinstance(i, int) for i in ids), \
            "groups 必须带互异 int id(子图契约:缺 id 只活第一个)"

    def test_edit_pe_switch_wiring(self):
        graph = GRAPHS["edit"]
        nodes, links = _nodes(graph), _links(graph)
        main_te = _by_type(graph, "TextEncodeQwenImage21")[0]
        prompt_link = links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")]
        switch = nodes[prompt_link[1]]
        assert switch["type"] == "ComfySwitchNode", "TextEncode.prompt 上游应是核心 ComfySwitchNode"
        assert switch["outputs"][0]["type"] == "STRING", "PE 开关应为 STRING 泛型(MatchType)"
        assert switch["widgets_values"][0] is False, "PE 开关默认必须 false(直写,PE 旁路)"
        true_origin = nodes[links[switch["inputs"][1]["link"]][1]]
        assert true_origin["type"] == PE_I2I_CLASS, \
            f"开关 on_true 上游应为 {PE_I2I_CLASS}(PE 看图改写)"
        false_origins = _resolve_default_string_origins(graph)
        assert len(false_origins) == 1 and all(
            n["type"] == "StringConstant" for n in false_origins.values()), \
            f"直写路应恰 1 个 StringConstant 源,得 {sorted(false_origins)}"

    def test_edit_pe_sees_canvas_image(self):
        """PE 是看图改写:image_1 必须真接编辑画布 LoadImage(非悬空)。"""
        graph = GRAPHS["edit"]
        nodes, links = _nodes(graph), _links(graph)
        pe = _by_type(graph, PE_I2I_CLASS)[0]
        img1 = next(i for i in pe["inputs"] if i["name"] == "image_1")
        assert img1.get("link"), "PE image_1 应有连线(PE 看图改写的根)"
        src = nodes[links[img1["link"]][1]]
        assert src["type"] == "LoadImage", "PE image_1 上游应为 LoadImage(编辑画布)"


# ── 6b. 画布选项契约(09-23 深夜 A+B:PE 组默认旁路 / RGBA 开关默认普通)──
# qi21 件的 PE/RGBA 开关收进装配子图,其断言在 TestQi21SubgraphContract。

class TestCanvasOptions:
    def test_pe_group_present_and_bypassed_by_default(self):
        for name in ("t2i",):
            graph = GRAPHS[name]
            titles = [g.get("title", "") for g in graph["groups"]]
            assert any("PE 提示词改写" in t and "默认旁路" in t for t in titles), \
                f"{name}: 缺「PE 提示词改写(默认旁路…)」分组"

            pe_nodes = _by_type(graph, PE_CLASS)
            assert len(pe_nodes) == 1, f"{name}: {PE_CLASS} 应恰 1 个(类名逐字)"
            # PE 七参契约逐字硬锁(temperature…seed);t2i 09-23 午为画布重存版,
            # 前端在 seed 后追加 control_after_generate 尾项('randomize')——容忍
            # 该序列化尾项,七参本体仍逐字锚(qi21 生成器版无尾项,两种形状皆过)。
            wv = pe_nodes[0]["widgets_values"][1:]
            assert wv[:len(PE_PARAMS)] == PE_PARAMS, \
                f"{name}: PE 参数漂移(官方 T2I 硬口径 {PE_PARAMS}),得 {wv}"
            extra = wv[len(PE_PARAMS):]
            assert not extra or extra[0] in ("fixed", "increment", "decrement", "randomize"), \
                f"{name}: PE widgets_values 尾项应为 seed control_after_generate,得 {extra}"

            # PE 开关(输出喂 TextEncode.prompt 的 STRING 开关)默认 false=直写
            nodes, links = _nodes(graph), _links(graph)
            main_te = next(
                n for n in graph["nodes"]
                if n["type"] == "TextEncodeQwenImage21"
                and any(i["name"] == "prompt" and i.get("link") for i in n["inputs"])
            )
            prompt_link = links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")]
            switch = nodes[prompt_link[1]]
            assert switch["type"] == "ComfySwitchNode", \
                f"{name}: TextEncode.prompt 上游应是核心 ComfySwitchNode"
            assert switch["outputs"][0]["type"] == "STRING", \
                f"{name}: PE 开关应为 STRING 泛型(MatchType)"
            assert switch["widgets_values"][0] is False, \
                f"{name}: PE 开关默认必须 false(直写,PE 组旁路)"
            false_origins = _resolve_default_string_origins(graph)
            assert all(n["type"] == "StringConstant" for n in false_origins.values()), \
                f"{name}: PE 开关 on_false 支路最终来源应为 StringConstant"
            assert len(false_origins) == 1, \
                f"{name}: 直写路应恰 1 个 StringConstant 源, 得 {sorted(false_origins)}"
            true_origin = nodes[links[switch["inputs"][1]["link"]][1]]
            assert true_origin["type"] == PE_CLASS, \
                f"{name}: PE 开关 on_true 上游应为 {PE_CLASS}(PE 扩写)"

    def test_rgba_switch_defaults_to_normal_path(self):
        for name in ("t2i",):
            graph = GRAPHS[name]
            nodes, links = _nodes(graph), _links(graph)
            sampler = _by_type(graph, "KSampler")[0]
            pos_link = links[next(i["link"] for i in sampler["inputs"] if i["name"] == "positive")]
            switch = nodes[pos_link[1]]
            assert switch["type"] == "ComfySwitchNode", \
                f"{name}: KSampler.positive 上游应是 ComfySwitchNode(与 PE 开关同款)"
            assert switch["outputs"][0]["type"] == "CONDITIONING"
            assert switch["widgets_values"][0] is False, \
                f"{name}: RGBA 开关默认必须 false(普通路)"

            # on_false=主编码 positive(prompt 接 PE 开关的那个);on_true=RGBA 编码
            main_te = nodes[links[switch["inputs"][0]["link"]][1]]
            assert main_te["type"] == "TextEncodeQwenImage21"
            assert any(i["name"] == "prompt" and i.get("link") for i in main_te["inputs"]), \
                f"{name}: RGBA 开关 on_false 应接主编码(prompt 可切的那个),得 {main_te.get('title')}"
            rgba_te = nodes[links[switch["inputs"][1]["link"]][1]]
            assert rgba_te["type"] == "TextEncodeQwenImage21"
            assert rgba_te is not main_te, f"{name}: RGBA 应为独立编码节点(双路)"
            prompt = _widget(rgba_te, TE_WV["prompt"])
            assert prompt.startswith(RGBA_HEAD) and prompt.endswith(RGBA_TAIL), \
                f"{name}: RGBA 编码默认 prompt 应为官方包裹句式(首尾逐字)"


# ── 6c. daojie 件专属契约 TestDaojieContract(道劫五件套长文/DNA 实词/零质量词)
# 已随道劫直写旧件 09-23 午退役删除;qi21 件的道劫装配断言见 TestQi21SubgraphContract。──

# ── 6e. qi21 件专属契约(装配子图:子图在场+外露参数+库↔工作流底座互锁)──
# 结构(幂等脚本 apps/build/scripts/qi21_daojie_t2i_0923.py 驱动;子图契约=
# docs/comfyui-kb/子图工作流工程契约.md:groups int id、IO linkIds 逐项登记、
# 内部 links 对象格式、装载稳定序):


def _qi21_truth():
    """库 05(②层=09-23 美化版)解析(独立于生成器实现,双记账互锁)。

    返回 (types, const_a):types=[(zh, subject, base, constant_text)];
    constant_text=子图底座常量应有全文=②美化版底座(+常量B·人物系增量四锁)+④配色行。
    canon-json 逐字锚已废止(型名/顺序仍对齐 daojie_bases.json zh)。"""
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    zh_order = [b["zh"] for b in bases]
    fences = re.findall(r"```text\n(.*?)\n```", md.split("## 三、")[0], re.S)
    assert len(fences) >= 3, "库 §二 常量围栏不足(装配顺序块+常量A+常量B)"
    const_a, const_b = fences[1], fences[2]
    b_lines = const_b.split("\n")

    types = []
    for zh in zh_order:
        m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
        assert m, f"库缺条目 ### {zh}-基础"
        fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S).group(1)
        lines = fence.split("\n")
        assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh} 首行非 ⟨①:…⟩ 槽"
        subject = lines[0][len("⟨①:"):-len("⟩")]
        base, color, mid = lines[1], lines[-1], lines[2:-1]
        assert color == PRO_COLOR_MAP[zh], f"{zh} ④配色行与 §一映射表不一致"
        want_mid_len = 7 if zh in PRO_CHAR_TYPES else 3
        assert len(mid) == want_mid_len, f"{zh} ③锁层行数 {len(mid)} ≠ {want_mid_len}"
        if zh in PRO_CHAR_TYPES:
            assert mid[2:6] == b_lines, f"{zh} ③锁层中段与常量B 不逐字一致"
        constant_text = "\n".join([base] + (b_lines if zh in PRO_CHAR_TYPES else []) + [color])
        types.append((zh, subject, base, constant_text))
    return types, const_a


def _qi21_sg(graph: dict) -> dict:
    sgs = graph.get("definitions", {}).get("subgraphs", [])
    assert len(sgs) == 1, "qi21 件应恰含 1 个装配子图"
    return sgs[0]


def _qi21_sg_nodes(graph: dict) -> dict:
    return {n["id"]: n for n in _qi21_sg(graph)["nodes"]}


def _qi21_sg_links(graph: dict) -> dict:
    return {l["id"]: l for l in _qi21_sg(graph)["links"]}


class TestQi21SubgraphContract:
    # ── 子图在场与宿主结构 ──────────────────────────────────────────

    def test_subgraph_and_host_present(self):
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        host = _nodes(graph)[QI21_HOST_ID]
        assert host["type"] == sg["id"], "[40] 宿主 type 应=子图 uuid"
        assert host["properties"]["subgraph"] == sg["id"], "[40] properties.subgraph 应=子图 uuid"
        assert "道劫" in sg["name"] and "装配子图" in sg["name"], "子图 name 应带道劫·装配子图字号"
        assert sg["inputNode"]["id"] == -10 and sg["outputNode"]["id"] == -20, \
            "子图 inputNode/outputNode 锚应为 -10/-20"

    def test_subgraph_io_link_ids_registered(self):
        """子图契约铁律:IO 槽 linkIds 逐项登记且端点真实(缺登记=前端不渲染/转换断)。"""
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        i_links = _qi21_sg_links(graph)
        for slot, io in enumerate(sg["inputs"]):
            assert io.get("linkIds"), f"inputs[{slot}]({io['name']}) linkIds 为空(契约铁律)"
            for lid in io["linkIds"]:
                l = i_links[lid]
                assert l["origin_id"] == -10 and l["origin_slot"] == slot, \
                    f"inputs[{slot}] linkIds[{lid}] 端点不实"
        for slot, io in enumerate(sg["outputs"]):
            assert io.get("linkIds"), f"outputs[{slot}]({io['name']}) linkIds 为空(契约铁律)"
            for lid in io["linkIds"]:
                l = i_links[lid]
                assert l["target_id"] == -20 and l["target_slot"] == slot, \
                    f"outputs[{slot}] linkIds[{lid}] 端点不实"

    def test_subgraph_internal_links_object_format_and_bidirectional(self):
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        i_nodes, i_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        for l in sg["links"]:
            assert {"id", "origin_id", "origin_slot", "target_id", "target_slot", "type"} <= set(l), \
                f"子图 link{l['id']} 应为对象格式(origin_id/target_id 字段)"
            if l["origin_id"] != -10:
                origin = i_nodes[l["origin_id"]]
                assert l["id"] in (origin["outputs"][l["origin_slot"]].get("links") or []), \
                    f"子图 link{l['id']}: origin.outputs 未登记"
                assert l["type"] == origin["outputs"][l["origin_slot"]]["type"], \
                    f"子图 link{l['id']}: origin 槽类型不匹配"
            if l["target_id"] != -20:
                target = i_nodes[l["target_id"]]
                assert target["inputs"][l["target_slot"]].get("link") == l["id"], \
                    f"子图 link{l['id']}: target.inputs 不匹配"

    # ── 外露参数(型选择 COMBO/主体句/PE/RGBA/画幅联动/seed)──────────

    def test_host_panel_exposes_type_pe_rgba_widgets(self):
        """宿主面板=子图 widget 型输入:主体句(外连)+型选择(COMBO,九选一默认人物)
        +PE+RGBA+画幅联动(BOOLEAN);widgets_values 按槽序=[人物例一主体句, 人物, False×3]。"""
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        host = _nodes(graph)[QI21_HOST_ID]
        assert len(host["inputs"]) == len(sg["inputs"]) == 8, \
            "宿主/子图 inputs 应恰 8 槽(clip/vae/pe_clip/主体句+型选择+PE+RGBA+画幅联动)"
        for i, (hi, si) in enumerate(zip(host["inputs"], sg["inputs"])):
            assert hi["name"] == si["name"] and hi["type"] == si["type"], \
                f"宿主 inputs[{i}]({hi['name']}) 与子图 inputs[{i}]({si['name']}) 不对齐(装载稳定序)"
        widget_inputs = [i for i in host["inputs"] if "widget" in i]
        assert [i["name"] for i in widget_inputs] == QI21_HOST_WIDGET_INPUTS, \
            "宿主面板 widget 型输入应为 主体句+型选择+PE+RGBA+画幅联动(槽序)"
        types, _ = _qi21_truth()
        assert host["widgets_values"] == [types[0][1], "人物", False, False, False], \
            "宿主 widgets_values 应=[库人物型例一主体句, 人物, False×3](默认①人物/三开关全关)"
        named = host.get("widgets_values_named", {})
        assert named.get("主体句") == types[0][1] and named.get("型选择") == "人物", \
            "宿主 widgets_values_named 主体句/型选择漂移"
        assert named.get("PE改写开关") is False and named.get("RGBA透明开关") is False \
            and named.get("画幅联动开关") is False, "宿主 widgets_values_named 开关键漂移"
        # 面板 widget 未外连(面板控制),主体句外连 [24]
        by_name = {i["name"]: i for i in host["inputs"]}
        assert by_name["主体句"]["link"] is not None, "主体句槽应外连 [24]"
        for name in QI21_HOST_WIDGET_INPUTS[1:]:
            assert by_name[name]["link"] is None, f"面板 widget {name} 应为宿主 widget(未外连)"

    def test_external_wiring_only_loaders_sampler_save_note(self):
        """外部接线:[2][3][11]→宿主 clip/vae/pe_clip;[24]→主体句;宿主
        positive/negative→[7];prompt→[27];width/height→[5]。主图应无
        TextEncode/开关/PE/ResolutionSelector 平铺(装配核心已收进子图)。"""
        graph = GRAPHS["qi21"]
        got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in graph["links"]}
        for want in [
            (12, 2, 0, QI21_HOST_ID, 0, "CLIP"),
            (13, 3, 0, QI21_HOST_ID, 1, "VAE"),
            (14, 11, 0, QI21_HOST_ID, 2, "CLIP"),
            (15, QI21_SUBJECT_ID, 0, QI21_HOST_ID, 3, "STRING"),
            (1, QI21_HOST_ID, 3, QI21_LATENT_ID, 0, "INT"),
            (2, QI21_HOST_ID, 4, QI21_LATENT_ID, 1, "INT"),
            (16, QI21_HOST_ID, 0, QI21_SAMPLER_ID, 1, "CONDITIONING"),
            (17, QI21_HOST_ID, 1, QI21_SAMPLER_ID, 2, "CONDITIONING"),
            (18, QI21_HOST_ID, 2, QI21_PREVIEW_ID, 0, "STRING"),
        ]:
            assert want in got, f"外部接线缺: link{want[0]}"
        assert not _by_type(graph, "TextEncodeQwenImage21"), \
            "主图不应有平铺 TextEncode(主编码/RGBA 编码已收进子图)"
        assert not _by_type(graph, "ComfySwitchNode"), \
            "主图不应有平铺开关(PE/RGBA/画幅联动已收进子图)"
        assert not _by_type(graph, PE_CLASS), "PE 改写件应收进子图"
        assert not _by_type(graph, "ResolutionSelector"), \
            "主图不应有 ResolutionSelector(写死档位表废止,宽高随型直驱)"
        subjects = [n for n in graph["nodes"] if n["type"] == "PrimitiveStringMultiline"]
        assert len(subjects) == 1 and subjects[0]["id"] == QI21_SUBJECT_ID, \
            "[24] 应为外露 PrimitiveStringMultiline 主体句(仿 K2 [50])"

    def test_subject_slot_defaults_to_library_renwen_example(self):
        types, _ = _qi21_truth()
        subject = _nodes(GRAPHS["qi21"])[QI21_SUBJECT_ID]
        assert subject["widgets_values"][0] == types[0][1], \
            "[24] 默认主体句应=库人物型例一"
        assert types[0][0] == "人物", "库首型应为人物(默认型锚)"

    def test_seed_exposed_fixed(self):
        sampler = _by_type(GRAPHS["qi21"], "KSampler")[0]
        assert _widget(sampler, 1) == "fixed", "seed 控制应 fixed(可复现)"
        assert not any(i["name"] == "seed" and i.get("link") for i in sampler["inputs"]), \
            "seed 应保持 widget 外露(不外连)"

    # ── MyQi21DaojieBase 在场+三真源互锁(05 库↔qi21_bases.json↔工作流)────

    def test_qi21_base_node_present_and_combo_default(self):
        """[150] MyQi21DaojieBase 在子图内:combo base 槽=widget 转输入接 -10 槽4
        (宿主面板「型选择」COMBO 九选一);widgets 默认=人物;四出 BASE/WIDTH/HEIGHT/型名;
        BASE 喂拼接①,W/H 喂联动开关 on_false(默认直驱路)。"""
        graph = GRAPHS["qi21"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        bases = [n for n in sg_nodes.values() if n["type"] == "MyQi21DaojieBase"]
        assert len(bases) == 1 and bases[0]["id"] == QI21_SG_BASE_ID, \
            f"子图应恰 1 个 MyQi21DaojieBase[{QI21_SG_BASE_ID}]"
        node = bases[0]
        assert node["widgets_values"] == ["人物"], "[150] combo 默认应=人物(DEFAULT_BASE 钉死)"
        base_inp = node["inputs"][0]
        assert base_inp["name"] == "base" and "widget" in base_inp, \
            "[150].base 应为 widget 转输入(combo 经宿主面板外露)"
        bl = sg_links[base_inp["link"]]
        assert bl["origin_id"] == -10 and bl["origin_slot"] == 4 and bl["type"] == "COMBO", \
            "[150].base 应接 -10 槽4(宿主面板「型选择」COMBO)"
        assert [o["name"] for o in node["outputs"]] == ["BASE", "WIDTH", "HEIGHT", "型名"], \
            "[150] 四出应为 BASE/WIDTH/HEIGHT/型名"
        concat1 = sg_nodes[QI21_SG_CONCAT_IDS[0]]
        assert sg_links[concat1["inputs"][1]["link"]]["origin_id"] == QI21_SG_BASE_ID, \
            "拼接①.string_b 上游应为 [150].BASE(级联退役,一处选型)"
        for sw_id, out_slot, out_name in ((QI21_SG_SW_WH_IDS[0], 1, "WIDTH"),
                                          (QI21_SG_SW_WH_IDS[1], 2, "HEIGHT")):
            sw = sg_nodes[sw_id]
            fl = sg_links[sw["inputs"][0]["link"]]
            assert fl["origin_id"] == QI21_SG_BASE_ID and fl["origin_slot"] == out_slot, \
                f"[{sw_id}].on_false 上游应为 [150].{out_name}(九型直驱默认路)"

    def test_qi21_bases_json_interlocks_library(self):
        """三真源互锁:qi21_bases.json(MyQi21DaojieBase 运行时读)base_text 逐字=
        05 库「②美化版底座(+人物系增量四锁B)+④配色行」;型名/顺序=canon zh;
        aspect/MP/override 镜像 canon(与 test_my_qi21_base.py 双记账)。"""
        types, _ = _qi21_truth()
        canon = json.loads(BASES_JSON.read_text(encoding="utf-8"))
        qi21 = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))
        assert [e["zh"] for e in qi21] == [t[0] for t in types] == [b["zh"] for b in canon], \
            "qi21_bases.json 型名/顺序应与 05 库/canon 三方同序"
        canon_by_zh = {b["zh"]: b for b in canon}
        for e, (zh, _subj, _base, want_text) in zip(qi21, types):
            assert e["base_text"] == want_text, \
                f"qi21_bases.json「{zh}」base_text 与 05 库②层(美化版)装配不逐字一致"
            c = canon_by_zh[zh]
            assert e["aspect_ratio"] == c["aspect_ratio"] and e["megapixels"] == c["megapixels"] \
                and e.get("resolution_override") == c.get("resolution_override"), \
                f"qi21_bases.json「{zh}」画幅档应镜像 canon"
        # 美化版锚词抽验(人物型):纯画法骨与配色行形状
        renwu = qi21[0]["base_text"]
        for kw in ("细墨线", "提按顿挫", "墨色浓淡分明"):
            assert kw in renwu, f"qi21_bases.json 人物 base_text 缺美化版锚词 {kw}"
        for bad in ("眉眼", "发丝", "衣褶如", "骨相"):
            assert bad not in renwu.split("\n")[0], f"人物②层残留物象词 {bad}(纯画法零物象骨)"
        assert renwu.split("\n")[-1] == PRO_COLOR_MAP["人物"], "人物 base_text 末行应=④配色行"

    def test_lock_constant_present_and_always_wired(self):
        """锁层常量在场:[110]=库首节常量A 全文逐字,恒挂(直连拼接节点,不经开关)。"""
        graph = GRAPHS["qi21"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        _, const_a = _qi21_truth()
        lock = sg_nodes[QI21_SG_LOCK_ID]
        assert lock["type"] == "StringConstant", "[110] 应为 StringConstant(通用锁层常量A)"
        assert _widget(lock, 0) == const_a, "[110] 通用锁层常量A 与库首节常量不逐字一致"
        lock_link = sg_links[lock["outputs"][0]["links"][0]]
        assert lock_link["target_id"] == QI21_SG_CONCAT_IDS[1] and lock_link["type"] == "STRING", \
            "[110] 应恒挂直连拼接②(不随型走开关)"

    def test_cascade_retired_and_linkage_switches_wired(self):
        """级联退役(09-23 总装轮):子图 ComfySwitchNode 恰 4 枚=提示词开关(STRING)/
        RGBA 开关(CONDITIONING)/宽高联动双开关(INT);九 StringConstant 不复活
        (子图 StringConstant 恰 3=锁层A+RGBA 官方头尾);联动链 wh_ratio→正则→转数→
        公式→开关 on_true,switch 槽全部接 -10 且默认 false。"""
        graph = GRAPHS["qi21"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        switches = {n["id"]: n for n in sg_nodes.values() if n["type"] == "ComfySwitchNode"}
        assert sorted(switches) == sorted(
            [QI21_SG_PE_SW, QI21_SG_RGBA_SW, *QI21_SG_SW_WH_IDS]), \
            f"级联退役:子图开关应恰 4 枚,得 {sorted(switches)}"
        for sid, typ in ((QI21_SG_PE_SW, "STRING"), (QI21_SG_RGBA_SW, "CONDITIONING"),
                         (QI21_SG_SW_WH_IDS[0], "INT"), (QI21_SG_SW_WH_IDS[1], "INT")):
            sw = switches[sid]
            assert sw["outputs"][0]["type"] == typ, f"[{sid}] 开关输出型应为 {typ}"
            assert sw["widgets_values"][0] is False, f"[{sid}] 开关默认非 false"
            sl = sg_links[sw["inputs"][2]["link"]]
            assert sl["origin_id"] == -10, f"[{sid}] switch 槽应接 -10(宿主面板)"
        sconsts = {n["id"] for n in sg_nodes.values() if n["type"] == "StringConstant"}
        assert sconsts == {QI21_SG_LOCK_ID, QI21_SG_RGBA_HEAD_ID, QI21_SG_RGBA_TAIL_ID}, \
            f"级联退役:子图 StringConstant 应恰 3 枚(锁层A+RGBA头尾),得 {sorted(sconsts)}"
        # 联动链锚:[140].wh_ratio 扇出两线喂正则;正则→转数→公式→开关 on_true
        pe = sg_nodes[QI21_SG_PE_RW]
        wh = pe["outputs"][2]
        assert wh["name"] == "wh_ratio" and sorted(wh["links"] or []) == [28, 29], \
            "[140].wh_ratio 应扇出两线喂宽高正则(联动源)"
        for rid in QI21_SG_RATIO_IDS:
            assert sg_nodes[rid]["type"] == "RegexExtract", f"[{rid}] 应为 RegexExtract"
            assert sg_nodes[rid]["widgets_values"][2] == "First Group", f"[{rid}] 应 First Group"
        for cid in QI21_SG_CONV_IDS:
            assert sg_nodes[cid]["type"] == "ComfyNumberConvert", f"[{cid}] 应为 ComfyNumberConvert"
        for mid, sw_id in zip(QI21_SG_MATH_IDS, QI21_SG_SW_WH_IDS):
            assert sg_nodes[mid]["type"] == "ComfyMathExpression", f"[{mid}] 应为 ComfyMathExpression"
            tl = sg_nodes[sw_id]["inputs"][1]["link"]
            assert tl is not None and sg_links[tl]["origin_id"] == mid, \
                f"[{sw_id}].on_true 上游应为公式 [{mid}]"
        # 联动开关 switch 槽同接 -10 槽7(画幅联动开关,一槽双线)
        for sw_id in QI21_SG_SW_WH_IDS:
            sl = sg_links[switches[sw_id]["inputs"][2]["link"]]
            assert sl["origin_slot"] == 7, f"[{sw_id}] switch 槽应接 -10 槽7(画幅联动开关)"

    def test_default_assembly_equals_library_composition(self):
        """默认人物型:装配全文=[24]主体句+[150]BASE(qi21_bases.json 人物,逐字=库)
        +[110]锁层A 逐字组合(画布行序①②(增量锁)④③,库直写行序①②③④——层内容零差异)。"""
        graph = GRAPHS["qi21"]
        nodes = _nodes(graph)
        sg_nodes = _qi21_sg_nodes(graph)
        types, const_a = _qi21_truth()
        qi21 = {e["zh"]: e for e in json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))}
        assembled = "\n".join([
            _widget(nodes[QI21_SUBJECT_ID], 0),
            qi21["人物"]["base_text"],
            _widget(sg_nodes[QI21_SG_LOCK_ID], 0)])
        want = "\n".join([types[0][1], types[0][3], const_a])
        assert assembled == want, "默认装配全文与库人物型四层组合不逐字一致"

    def test_pe_group_and_rgba_switch_inside_subgraph(self):
        """PE/RGBA 承袭(收进子图,逻辑原样):PE 参数=插件官方 README 推荐值(A/B 后再定);
        两开关 switch 槽接宿主面板 widget,默认 false(直写/普通);RGBA=官方公式
        头尾常量逐字+拼接路(头句+装配全文+尾句),[143].prompt 接公式输出且 widget 清空。"""
        graph = GRAPHS["qi21"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        pe = sg_nodes[QI21_SG_PE_RW]
        assert pe["type"] == PE_CLASS, f"[{QI21_SG_PE_RW}] 应为 {PE_CLASS}(类名逐字)"
        assert pe["widgets_values"][1:] == PE_PARAMS, \
            f"PE 参数漂移(插件官方 T2I 推荐值 {PE_PARAMS}),得 {pe['widgets_values'][1:]}"
        pe_sw = sg_nodes[QI21_SG_PE_SW]
        assert pe_sw["outputs"][0]["type"] == "STRING", "提示词开关应为 STRING 泛型"
        pe_sw_link = sg_links[pe_sw["inputs"][2]["link"]]
        assert pe_sw_link["origin_id"] == -10 and pe_sw_link["origin_slot"] == 5, \
            "PE 开关 switch 槽应接 -10 槽5(宿主面板 PE改写开关)"
        false_src = sg_links[pe_sw["inputs"][0]["link"]]
        assert false_src["origin_id"] == QI21_SG_CONCAT_IDS[1], \
            "PE 开关 on_false 应接装配链末梢(拼接②)"
        true_src = sg_links[pe_sw["inputs"][1]["link"]]
        assert true_src["origin_id"] == QI21_SG_PE_RW, "PE 开关 on_true 应接 PE 改写"
        # RGBA 官方公式(09-23 深检吸收必改1)
        assert _widget(sg_nodes[QI21_SG_RGBA_HEAD_ID], 0) == RGBA_HEAD_OFFICIAL, \
            "RGBA 官方头句常量非官方原文逐字(This is an RGBA image with transparency.)"
        assert _widget(sg_nodes[QI21_SG_RGBA_TAIL_ID], 0) == RGBA_TAIL_OFFICIAL, \
            "RGBA 官方尾句常量非官方原文逐字(The image has alpha channel…transparent.)"
        cat1, cat2 = (sg_nodes[i] for i in QI21_SG_RGBA_CAT_IDS)
        assert sg_links[cat1["inputs"][0]["link"]]["origin_id"] == QI21_SG_RGBA_HEAD_ID, \
            "RGBA 拼接①.string_a 上游应为官方头句常量"
        assert sg_links[cat1["inputs"][1]["link"]]["origin_id"] == QI21_SG_CONCAT_IDS[1], \
            "RGBA 拼接①.string_b 上游应为装配全文([27] 同源)"
        assert sg_links[cat2["inputs"][1]["link"]]["origin_id"] == QI21_SG_RGBA_TAIL_ID, \
            "RGBA 拼接②.string_b 上游应为官方尾句常量"
        assert cat1["widgets_values"][2] == " " and cat2["widgets_values"][2] == " ", \
            "RGBA 公式拼接 delimiter 应为空格(官方公式内联式)"
        rgba_te = sg_nodes[QI21_SG_TE_RGBA]
        assert _widget(rgba_te, TE_WV["prompt"]) == "", \
            "RGBA 编码 prompt widget 应清空(公式路现拼,固定演示句已废止)"
        assert sg_links[rgba_te["inputs"][3]["link"]]["origin_id"] == QI21_SG_RGBA_CAT_IDS[1], \
            "RGBA 编码 prompt 应接 [163] 公式拼接输出"
        rgba_sw = sg_nodes[QI21_SG_RGBA_SW]
        assert rgba_sw["outputs"][0]["type"] == "CONDITIONING", "RGBA 开关应为 CONDITIONING 泛型"
        rgba_sw_link = sg_links[rgba_sw["inputs"][2]["link"]]
        assert rgba_sw_link["origin_id"] == -10 and rgba_sw_link["origin_slot"] == 6, \
            "RGBA 开关 switch 槽应接 -10 槽6(宿主面板 RGBA透明开关)"
        for sid in (QI21_SG_PE_SW, QI21_SG_RGBA_SW):
            assert sg_nodes[sid]["widgets_values"][0] is False, f"[{sid}] 开关默认非 false"
        # 宿主面板:PE/RGBA/画幅联动默认关(懒执行——旁路支路不进默认装配)
        host = _nodes(graph)[QI21_HOST_ID]
        assert host["widgets_values"][2] is False and host["widgets_values"][3] is False \
            and host["widgets_values"][4] is False, \
            "宿主面板 PE/RGBA/画幅联动开关默认必须 false"

    def test_subgraph_outputs_feed_sampler_latent_and_preview(self):
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        assert [o["name"] for o in sg["outputs"]] == \
            ["positive", "negative", "prompt", "width", "height"], \
            "子图输出应为 positive/negative/prompt/width/height(宽高直驱主图空潜)"
        host = _nodes(graph)[QI21_HOST_ID]
        assert [o["type"] for o in host["outputs"]] == \
            ["CONDITIONING", "CONDITIONING", "STRING", "INT", "INT"]
        previews = _by_type(graph, "easy showAnything")
        assert len(previews) == 1 and previews[0]["id"] == QI21_PREVIEW_ID, \
            "应恰 1 个 easy showAnything 装配预览(接子图 prompt 输出)"
        pv = previews[0]
        assert _links(graph)[pv["inputs"][0]["link"]][1] == QI21_HOST_ID, \
            "预览输入应接 [40] 宿主 prompt 输出"
        assert pv["pos"][0] > host["pos"][0], "预览节点应在宿主右侧(横向排版)"
        assert "道劫" in (pv.get("title") or ""), "预览节点标题应带道劫字号"

    # ── 布局契约(从上到下=阶段行,行内从左到右;group 收敛)──────────────

    def test_subgraph_row_layout_top_to_bottom(self):
        """子图排版=恰 4 阶段行(行1 源行:底座九选一/锁层A/RGBA头尾/PE改写→
        行2 装配路由→行3 画幅联动→行4 编码输出):行间 y 严格递增且净距≥100;
        行内(数组序=数据流序)x 严格递增。行成员按 id 锚定,防回退到旧布局。"""
        graph = GRAPHS["qi21"]
        sg_nodes = _qi21_sg_nodes(graph)
        rows: dict[int, list[int]] = {}
        for n in _qi21_sg(graph)["nodes"]:
            rows.setdefault(n["pos"][1], []).append(n["id"])
        row_ys = sorted(rows)
        assert len(row_ys) == 4, f"子图应恰 4 行(阶段行),得 {len(row_ys)} 行"
        want_rows = [
            [QI21_SG_BASE_ID, QI21_SG_LOCK_ID, QI21_SG_RGBA_HEAD_ID,
             QI21_SG_RGBA_TAIL_ID, QI21_SG_PE_RW],
            [*QI21_SG_CONCAT_IDS, *QI21_SG_RGBA_CAT_IDS, QI21_SG_PE_SW],
            [*QI21_SG_RATIO_IDS, *QI21_SG_CONV_IDS, *QI21_SG_MATH_IDS, *QI21_SG_SW_WH_IDS],
            [QI21_SG_TE, QI21_SG_TE_RGBA, QI21_SG_RGBA_SW],
        ]
        for y, want in zip(row_ys, want_rows):
            got = sorted(rows[y])
            assert got == sorted(want), f"行 y={y} 成员漂移: 应 {sorted(want)} 得 {got}"
            xs = [sg_nodes[nid]["pos"][0] for nid in rows[y]]  # 数组序=数据流序
            assert all(b > a for a, b in zip(xs, xs[1:])), \
                f"行 y={y} 行内 x 非严格递增(应从左到右): {xs}"
        for y, next_y in zip(row_ys, row_ys[1:]):
            bottom = y + max(sg_nodes[nid]["size"][1] for nid in rows[y])
            assert next_y - bottom >= 100, \
                f"行 y={y} 与下行净距不足(<100): 行底 {bottom} → 下行 y={next_y}"

    def test_no_node_overlap_and_group_budget(self):
        """零重叠(主图+子图节点矩形两两不相交);group 预算:子图≤2、主图≤3
        (group 泛滥即红);子图 group 必须各含其阶段行全部节点且互不相交(真机构框)。"""
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        assert len(sg["groups"]) <= 2, \
            f"子图 group 应≤2(只框 装配路由 与 画幅联动),得 {len(sg['groups'])}"
        assert len(graph["groups"]) <= 3, \
            f"主图 group 应≤3(加载器/主链/装配外露),得 {len(graph['groups'])}"
        for scope, nodes in (("主图", graph["nodes"]), ("子图", sg["nodes"])):
            for i in range(len(nodes)):
                for j in range(i + 1, len(nodes)):
                    a, b = nodes[i], nodes[j]
                    ax, ay, aw, ah = a["pos"][0], a["pos"][1], a["size"][0], a["size"][1]
                    bx, by, bw, bh = b["pos"][0], b["pos"][1], b["size"][0], b["size"][1]
                    assert not (ax < bx + bw and bx < ax + aw
                                and ay < by + bh and by < ay + ah), \
                        f"{scope} node{a['id']} 与 node{b['id']} 矩形重叠"
        # 子图 group 包含性:框住的行节点全在其 bounding 内;两框不相交
        boxes = [(grp["bounding"][0], grp["bounding"][1],
                  grp["bounding"][0] + grp["bounding"][2],
                  grp["bounding"][1] + grp["bounding"][3]) for grp in sg["groups"]]
        assert not (boxes[0][0] < boxes[1][2] and boxes[1][0] < boxes[0][2]
                    and boxes[0][1] < boxes[1][3] and boxes[1][1] < boxes[0][3]), \
            "子图两 group 框相交"
        for grp in sg["groups"]:
            gx0, gy0 = grp["bounding"][0], grp["bounding"][1]
            gx1, gy1 = gx0 + grp["bounding"][2], gy0 + grp["bounding"][3]
            inside = [n for n in sg["nodes"]
                      if gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                      and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1]
            assert inside, f"子图 group {grp['title']!r} 未框住任何节点(装饰框即病)"
            same_row = len({n["pos"][1] for n in inside}) == 1
            assert same_row, f"子图 group {grp['title']!r} 跨行框住节点(应只框单一阶段行)"
            row_all = [n["id"] for n in sg["nodes"] if n["pos"][1] == inside[0]["pos"][1]]
            assert sorted(n["id"] for n in inside) == sorted(row_all), \
                f"子图 group {grp['title']!r} 应框住其阶段行全部节点"

    def test_usage_note_subgraph_warnings(self):
        """子图版 Note 要点锁:装配子图用法/MyQi21DaojieBase 九选一/主体句纪律(空镜无人)/
        脚本重跑重置警示/[27] 过目指引/锁层恒挂/底座美化口径/steps 40 完整态/RGBA 官方
        公式(中英)/画幅联动开关说明。Note 被重跑回退即红。"""
        note = _by_type(GRAPHS["qi21"], "MarkdownNote")[0]["widgets_values"][0]
        for token in ("装配子图", "MyQi21DaojieBase", "九型", "空镜无人", "重置回库文档现读值",
                      "[27]", "恒挂", "美化", "05-道劫规范提示词库.md", "步数 40", "40-50",
                      RGBA_HEAD_OFFICIAL, RGBA_TAIL_OFFICIAL, RGBA_HEAD_ZH, RGBA_TAIL_ZH,
                      "画幅联动", "ResolutionSelector 已退役"):
            assert token in note, f"Note 缺子图版要点: {token!r}"

    def test_prompt_library_nine_types_anchor(self):
        """库锚(②层=09-23 美化版):### 恰九型且与 daojie_bases.json zh 同序;
        每型装配全文围栏行数=10(人物系)/6(场景系),字符带 1400-2400;
        首行 ⟨①:…⟩ 槽、末行配色行;②层与 canon positive 不再逐字互锁(锚废止的负证);
        §六 演进与待裁定节在场(09-23 深检吸收轮立账)。"""
        md = PROMPT_LIB.read_text(encoding="utf-8")
        bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
        zh_order = [b["zh"] for b in bases]
        headings = re.findall(r"^### (.+?)-基础\s*$", md, re.M)
        assert headings == zh_order, \
            f"库 ### 九型标题应与 daojie_bases.json zh 同序,得 {headings}"
        canon_pos = {b["zh"]: b["positive"] for b in bases}
        diff = 0
        for zh in zh_order:
            m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
            fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S).group(1)
            lines = fence.split("\n")
            want_lines = 10 if zh in PRO_CHAR_TYPES else 6
            assert len(lines) == want_lines, \
                f"{zh}: 装配全文应 {want_lines} 行(②型底座+③锁层[+增量锁]+④配色行),得 {len(lines)}"
            assert 1400 <= len(fence) <= 2400, \
                f"{zh}: 装配全文字符数 {len(fence)} 出带 1400-2400(库自查 1539-2267+槽括号)"
            assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh}: 首行应为 ⟨①:…⟩ 槽"
            assert lines[-1] == PRO_COLOR_MAP[zh], f"{zh}: 末行应为④配色行"
            if lines[1] != canon_pos[zh]:
                diff += 1
        assert diff == 9, \
            f"②层应为美化版成文(与 canon positive 逐字互锁已废止,九型均应有差异),diff={diff}"
        assert "## 六、演进与待裁定" in md, "库应含 §六 演进与待裁定(09-23 深检吸收轮立账)"
        assert "②③层放行显式禁句" in md, "库 §四.4 应含 ②③层放行显式禁句条款(09-23 深检吸收)"

# ── 7. 计数锚(防漂移):K2图像 36 件不变 + Q2-1图像 3 自研件(+3 官方)───
# 口径注:本锚按目录 json 实数(K2图像 全量=桥 API 8 + 画布件 28,09-23 现状)。
# AGENTS.md「K2图像18」是 09-15 静态自研 MY- 流的历史账口径,与目录文件数
# 非同一账本;本测试锁目录实数——任何件数漂移(误删/误增)即红。
# 09-23 午:道劫直写旧件 qwen21-daojie-t2i 退役删除,7→6(自研 4→3)。

class TestCountAnchor:
    def test_qwen21_dir_exactly_six(self):
        files = sorted(p.name for p in (_IMG_DIR / "Q2-1图像").rglob("*.json"))
        assert files == [
            "image_qwen_image_2_1_background_removal.json",
            "image_qwen_image_2_1_image_edit.json",
            "image_qwen_image_2_1_t2i.json",
            "qi21-道劫-t2i.json",
            "qwen21-edit.json", "qwen21-t2i.json",
        ], f"Q2-1图像 应恰 6 件(3 自研+3 官方模板 09-23 入库),得 {files}"

    def test_official_templates_upstream_identical(self):
        """官方三件须与 Comfy-Org/workflow_templates 上游逐字节一致(官方件零改动铁律)。
        哈希=09-23 自上游 raw 拉取件烙印(t2i/edit 两件与研究档存档逐字节一致,
        background_removal 为当日新收);上游更新时重拉重烙并记台账。"""
        import hashlib
        pinned = {
            "image_qwen_image_2_1_t2i.json":
                "d33a6b36d530756e26ef4e25beb17d950daaea09d295475cd65f97f5d0af3b41",
            "image_qwen_image_2_1_image_edit.json":
                "d6dd8695469c20ca5e77b4bddf981b898ee0e034f0cfc5840c86f15b812ca081",
            "image_qwen_image_2_1_background_removal.json":
                "642e700e358fd47911d35f61c545945821fd516c898b793e9f58f5a92439aa72",
        }
        for name, sha in pinned.items():
            p = _IMG_DIR / "Q2-1图像" / "0_官方模板" / name
            assert p.exists(), f"官方模板缺失:{name}"
            actual = hashlib.sha256(p.read_bytes()).hexdigest()
            assert actual == sha, f"官方件被改动或上游漂移:{name}({actual})"

    def test_k2_dir_unchanged_36(self):
        files = sorted(p.name for p in K2_DIR.rglob("*.json") if p.name != ".DS_Store")
        assert len(files) == 36, \
            f"K2图像 目录 json 应 36 件不变(09-23 现状锚),得 {len(files)}: {files}"
