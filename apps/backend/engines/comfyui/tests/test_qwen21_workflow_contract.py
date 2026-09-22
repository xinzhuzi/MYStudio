"""Qwen-Image-2.1(Q2-1图像)工作流契约测试(09-23 制作;同日深夜扩三件;同日 PRO 件四件)。

被测对象 = 仓库真源四件:
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-t2i.json
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-daojie-t2i.json
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-daojie-t2i-pro.json
    engines/comfyui/workflows/1_图片/Q2-1图像/3_改图/qwen21-edit.json

格式口径(09-23 取舍,引擎 v0.37 直开为最终裁判):三件为**引擎前端格式**
(nodes/links/groups + MarkdownNote + pos 布局),非桥 API 格式
(schemaVersion+graph)——桥格式画布打不开(plugin_manager._is_bridge_template
刻意不进侧栏),而设计要求横向排版/group id/MarkdownNote 使用说明,只有前端
格式能承载;布线语义从官方模板 image_qwen_image_2_1_t2i/image_edit 换算。

09-23 深夜三改造(用户拍板:PE进画布/RGBA要选项/道劫单独适配,幂等脚本
apps/build/scripts/qwen21_canvas_options_0923.py 驱动):
  A. t2i(+daojie)加「PE 提示词改写组」默认旁路——PE 专用 CLIPLoader
     (qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16,type=qwen_image)→ 插件节点
     QwenImage21_T2IPromptRewrite(类名逐字)→ 核心 ComfySwitchNode(STRING)
     二选一 → TextEncodeQwenImage21.prompt(转换输入)。switch 选型依据:核心
     nodes_logic.py 的 ComfySwitchNode 是 io.MatchType 泛型(官方 edit 模板在
     LATENT 上用它,类型无关),且懒执行——旁路时 PE 子树不求值、PE 模型不加载。
     converted-widget 序列化口径照抄在库 Yue2 件(widgets_values 保留占位槽 +
     inputs 带 widget 标记)。
  B. t2i(+daojie)加「RGBA 透明开关」默认普通——双 TextEncodeQwenImage21
     conditioning(普通 vs 官方 RGBA 包裹句式)→ ComfySwitchNode
     (CONDITIONING)二选一 → KSampler.positive,与 A 共用同款 switch。
  C. 新增 daojie 件——以改造后 t2i 为骨架,默认直写提示词=按官方 PE 宪法五件套
     手写的道劫水墨国风修仙英文长文(DNA:ink wash/expressive brushwork/
     expansive negative space/Chinese cultivation-fantasy;零质量词)。

09-23 PRO 件(第四件 qwen21-daojie-t2i-pro.json,幂等脚本
apps/build/scripts/qwen21_daojie_pro_0923.py 驱动,底座全文从库文档
docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md 现读——json↔md 逐字互锁):
  D. K2 道劫『一处选型+分件装配』思想的 Q2-1 原生落地——底座区四选一链
     ([17]-[20] StringConstant 四类型首条 + [21][22][23] ComfySwitchNode 级联,
     全 false=人物首条默认)+ 主体句区([24] 唯一手写位 → [26] 核心 RegexReplace
     pattern=⟨B:[^⟩]*⟩ 换 B 槽(『同段换句』拼法的图内自动化)→ [25] 拼装开关
     false=纯底座)。选型依据:核心无 N 路字符串切换(SwitchNode 二路,链式级联),
     RegexReplace 为核心 text 类节点(comfy_extras/nodes_string.py)。
     PE 组与 RGBA 开关自 daojie 件深拷贝原样承袭。

09-23 修订轮(评审 medium×5,授权范围=PRO 件/库文档/本契约测试/台账):
  - 库 16 条底座**词数带 336-408** 入库入测(官方 400-500 随本仓句数收窄 15-20
    同步下探,宪法 :141-142「a single quiet subject runs shorter」自留口径;
    实测句均 21.9-25.5 守住宪法句均约 25 的密度);
  - pro 件 +[27] easy showAnything **装配预览**(承 K2 件 [62] 骨;接 [25] 输出,
    [25] true 换槽文本跑图前可见=「进 [6] 的文本含 CJK 即违规」的画布判定点;
    显示型端点不计孤儿);
  - pro 件 Note 三警示(手贴底座会被脚本重跑重置回首条 / 换型后 [24] 须同步换成
    本底座 B 槽主体句 / [27] 过目指引)+库文档三步用库与对接点表补 PRO 件对接。
  已知残留:生成脚本 qwen21_daojie_pro_0923.py 未回灌 [27] 与 Note 警示(超出本
  轮授权文件清单)——重跑脚本会回退这两处并触发本测试红,属预期守恒:先同步脚本
  (NOTE_TEXT/孤儿豁免/+节点27)再重跑。

design.md §6 七条对应:TestFilesInPlace(1)/TestLoaderTriple(2)/
TestSamplerContract(3)/TestTopology(4)/TestCanvasDiscipline(5)/
TestEditContract(6)/TestCountAnchor(7);深夜新增 TestCanvasOptions(A+B)与
TestDaojieContract(C);PRO 轮新增 TestDaojieProContract(D)。
其中第 5 条的「新 schema 必需字段(schemaVersion/graph)在位」随格式取舍改为
「前端格式必需字段(nodes/links/groups)在位」——schemaVersion/graph 是桥 API
格式字段,与画布流格式互斥(混写会被侧栏当成画布件解析出错)。

纯读文件断言,零网络零引擎依赖。

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
DAOJIE = _IMG_DIR / "Q2-1图像" / "1_文生图" / "qwen21-daojie-t2i.json"
DAOJIE_PRO = _IMG_DIR / "Q2-1图像" / "1_文生图" / "qwen21-daojie-t2i-pro.json"
EDIT = _IMG_DIR / "Q2-1图像" / "3_改图" / "qwen21-edit.json"
K2_DIR = _IMG_DIR / "K2图像"
PROMPT_LIB = _REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"

WORKFLOWS = {"t2i": T2I, "edit": EDIT, "daojie": DAOJIE, "pro": DAOJIE_PRO}
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

# RGBA 官方包裹句式(模板原文,逐字)
RGBA_HEAD = "This is an RGBA format image with transparency."
RGBA_TAIL = "The image has an alpha channel and a transparent background."

# 道劫 DNA 实词与质量词黑名单
DAOJIE_DNA_WORDS = ("ink", "wash", "brushwork", "negative space", "cultivation")
DAOJIE_QUALITY_BAN = ("masterpiece", "8k", "highly detailed", "award-winning", "best quality", "ultra detailed")
# 走帧句首位置短语(五件套自查;与生成脚本同表)
_DAOJIE_POSITIONAL = (
    "In the centre of the frame,", "Along the upper edge,", "At the lower left,",
    "Below the figure,", "To the right of the figure,", "Behind the pine,",
    "Near the top right corner,", "Around the waist,", "Across the middle distance,",
    "Along the left margin,",
)

# KSampler widgets_values 序:[seed, control, steps, cfg, sampler, scheduler, denoise]
K_SAMPLER_WV = {"seed": 0, "steps": 2, "cfg": 3, "sampler": 4, "scheduler": 5, "denoise": 6}
# TextEncodeQwenImage21 widgets_values 序:[prompt, negative_prompt, resolution]
TE_WV = {"prompt": 0, "negative": 1, "resolution": 2}


def _nodes(graph: dict) -> dict:
    return {n["id"]: n for n in graph["nodes"]}


def _by_type(graph: dict, class_type: str) -> list[dict]:
    return [n for n in graph["nodes"] if n.get("type") == class_type]


def _widget(node: dict, index: int):
    return node["widgets_values"][index]


def _links(graph: dict) -> dict:
    return {link[0]: link for link in graph["links"]}


def _resolve_default_string_origin(graph: dict) -> dict:
    """沿主编码 prompt 上游开关的 false 支路走到底 = 默认直写路的最终来源。

    t2i/daojie:零跳,StringConstant 直接;pro:穿底座选型/拼装开关级联
    (全 false)落到 [17] StringConstant。中途任一开关非 false 即红——
    该谓词只描述「默认态」的来源。"""
    nodes, links = _nodes(graph), _links(graph)
    main_te = next(
        n for n in graph["nodes"]
        if n["type"] == "TextEncodeQwenImage21"
        and any(i["name"] == "prompt" and i.get("link") for i in n["inputs"])
    )
    origin = nodes[links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")][1]]
    hops = 0
    while origin["type"] == "ComfySwitchNode":
        hops += 1
        assert hops <= 10, "默认链解析超限(疑似环)"
        assert origin["widgets_values"][0] is False, \
            f"默认链中途开关非 false: node{origin['id']} {origin.get('title')!r}"
        origin = nodes[links[origin["inputs"][0]["link"]][1]]
    return origin


# ── 1. 三文件在位、文件名合规(09-18 命名铁律:无 MY- 前缀、无下划线)──

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
            expected = 2 if name in ("t2i", "daojie", "pro") else 1  # PE 组另带一个 PE 加载器
            assert len(loaders) == expected, f"{name}: CLIPLoader 应恰 {expected} 个"
            main = [n for n in loaders if _widget(n, 0) == CLIP_FILE]
            assert len(main) == 1, f"{name}: 主 CLIP(qwen3vl_8b_bf16)应恰 1 个"
            assert _widget(main[0], 1) == "qwen_image", \
                f"{name}: 主 CLIPLoader type 必须为 qwen_image"

    def test_pe_clip_loader_exact_file_and_type(self):
        for name in ("t2i", "daojie", "pro"):
            graph = GRAPHS[name]
            pe_clips = [n for n in _by_type(graph, "CLIPLoader") if _widget(n, 0) == PE_CLIP_FILE]
            assert len(pe_clips) == 1, f"{name}: PE CLIPLoader 应恰 1 个(权重文件名逐字)"
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

    def test_seed_control_modes(self):
        assert _widget(_by_type(GRAPHS["t2i"], "KSampler")[0], 1) == "fixed", \
            "t2i 件 seed 应 fixed(官方 t2i 模板口径)"
        assert _widget(_by_type(GRAPHS["edit"], "KSampler")[0], 1) == "randomize", \
            "edit 件 seed 应 randomize(官方 edit 模板口径)"
        assert _widget(_by_type(GRAPHS["daojie"], "KSampler")[0], 1) == "fixed", \
            "daojie 件 seed 应 fixed(风格迭代要可复现,随 t2i 骨架)"
        assert _widget(_by_type(GRAPHS["pro"], "KSampler")[0], 1) == "fixed", \
            "pro 件 seed 应 fixed(风格迭代要可复现,随 daojie 骨架)"


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
            # 两者都是合法画布端点,不计孤儿(pro 件 [27] 装配预览,骨承 K2 件 [62]/[86])
            display_endpoints = {"MarkdownNote", "easy showAnything"}
            orphans = sorted(
                nodes[i]["type"] for i in nodes
                if i not in seen and nodes[i]["type"] not in display_endpoints
            )
            assert not orphans, f"{name}: 存在不可达 SaveImage 的孤儿节点: {orphans}"

    def test_t2i_resolution_selector_feeds_latent(self):
        for name in ("t2i", "daojie", "pro"):
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

    def test_horizontal_layout_no_vertical_tower(self):
        """每条连线 target.x > origin.x:数据流恒向右=每链横向一行,纵塔不可过。"""
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            for link in graph["links"]:
                origin, target = nodes[link[1]], nodes[link[3]]
                assert target["pos"][0] > origin["pos"][0], (
                    f"{name} link{link[0]}: {origin['type']}→{target['type']} "
                    f"未向右({origin['pos']} → {target['pos']}),纵向塔违规"
                )

    def test_usage_note_with_parameter_bible(self):
        for name, graph in GRAPHS.items():
            notes = _by_type(graph, "MarkdownNote")
            assert notes, f"{name}: 应有 MarkdownNote 使用说明(禁大标题横幅,说明卡合法)"
            text = notes[0]["widgets_values"][0]
            assert "cfg 恒 1" in text, f"{name}: 说明缺参数圣经要点(cfg 恒 1)"
            assert "RGBA format image with transparency" in text, \
                f"{name}: 说明缺 RGBA 透明句式原文"
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
        encoder = _by_type(GRAPHS["edit"], "TextEncodeQwenImage21")[0]
        prompt = _widget(encoder, TE_WV["prompt"])
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


# ── 6b. 画布选项契约(09-23 深夜 A+B:PE 组默认旁路 / RGBA 开关默认普通)──

class TestCanvasOptions:
    def test_pe_group_present_and_bypassed_by_default(self):
        for name in ("t2i", "daojie", "pro"):
            graph = GRAPHS[name]
            titles = [g.get("title", "") for g in graph["groups"]]
            assert any("PE 提示词改写" in t and "默认旁路" in t for t in titles), \
                f"{name}: 缺「PE 提示词改写(默认旁路…)」分组"

            pe_nodes = _by_type(graph, PE_CLASS)
            assert len(pe_nodes) == 1, f"{name}: {PE_CLASS} 应恰 1 个(类名逐字)"
            assert pe_nodes[0]["widgets_values"][1:] == PE_PARAMS, \
                f"{name}: PE 参数漂移(官方 T2I 硬口径 {PE_PARAMS}),得 {pe_nodes[0]['widgets_values'][1:]}"

            # PE 开关(输出喂 TextEncode.prompt 的 STRING 开关)默认 false=直写;
            # on_false 来源沿 false 支路解析:t2i/daojie=StringConstant 直挂,
            # pro=穿底座选型/拼装开关级联后落 [17] StringConstant。
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
            false_origin = _resolve_default_string_origin(graph)
            assert false_origin["type"] == "StringConstant", \
                f"{name}: PE 开关 on_false 支路最终来源应为 StringConstant" \
                f"(直写提示词;09-23 由 PrimitiveNode 改核心实节点——PrimitiveNode 队列时内联消解," \
                f"round2 e2e 实证 StringConstant 形态;pro 件穿开关级联后同源),得 {false_origin.get('title')!r}"
            true_origin = nodes[links[switch["inputs"][1]["link"]][1]]
            assert true_origin["type"] == PE_CLASS, \
                f"{name}: PE 开关 on_true 上游应为 {PE_CLASS}(PE 扩写)"

    def test_rgba_switch_defaults_to_normal_path(self):
        for name in ("t2i", "daojie", "pro"):
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


# ── 6c. daojie 件专属契约(道劫五件套长文 / DNA 实词 / 零质量词)────────

class TestDaojieContract:
    def _default_prompt(self) -> str:
        prims = _by_type(GRAPHS["daojie"], "StringConstant")
        assert len(prims) == 1, "daojie 件应恰 1 个 StringConstant(默认直写提示词)"
        return _widget(prims[0], 0)

    def test_daojie_skeleton_carries_pe_and_rgba_options(self):
        graph = GRAPHS["daojie"]
        assert _by_type(graph, PE_CLASS), "daojie 件应含 PE 组(与 t2i 同骨架)"
        assert len(_by_type(graph, "ComfySwitchNode")) == 2, \
            "daojie 件应恰 2 个开关(提示词开关 + RGBA 开关)"

    def test_default_prompt_five_part_structure(self):
        prompt = self._default_prompt()
        sentences = [s for s in re.split(r"(?<=[.])\s+", prompt.strip()) if s]
        assert 15 <= len(sentences) <= 20, \
            f"道劫默认 prompt 应 15-20 句(宪法五件套长文),得 {len(sentences)}"
        # 锚定句点名 ink-wash 媒介 + 画幅词
        assert sentences[0].startswith("The image is a "), "锚定句应以 The image is a 开头"
        assert "ink-wash" in sentences[0].split(",")[0], "锚定句应点名 ink-wash 风格"
        # 走帧:句首位置短语 8-10 个
        opens = sum(1 for s in sentences if s.startswith(_DAOJIE_POSITIONAL))
        assert 8 <= opens <= 10, f"句首位置短语应 8-10 个,得 {opens}"
        # 光照句恰 1 + 唯一总结句
        assert sum(1 for s in sentences if s.startswith("The lighting is")) == 1, "光照句应恰 1"
        assert sum(1 for s in sentences if s.startswith("The overall composition")) == 1, \
            "总结句应唯一(Write exactly one such sentence)"

    def test_default_prompt_dna_words_and_no_quality_boosters(self):
        prompt = self._default_prompt().lower()
        for word in DAOJIE_DNA_WORDS:
            assert word in prompt, f"道劫默认 prompt 缺 DNA 实词 {word!r}"
        for bad in DAOJIE_QUALITY_BAN:
            assert bad not in prompt, f"道劫默认 prompt 含质量词 {bad!r}(宪法禁用)"

    def test_titles_and_groups_carry_daojie_marker(self):
        graph = GRAPHS["daojie"]
        for group in graph["groups"]:
            assert "道劫" in group["title"], f"分组标题应带道劫字号: {group['title']!r}"
        for node in graph["nodes"]:
            title = node.get("title") or ""
            assert "道劫" in title, f"节点标题应带道劫字号: node{node['id']} {title!r}"

    def test_daojie_note_mentions_krea2_line_and_user_review(self):
        note = _by_type(GRAPHS["daojie"], "MarkdownNote")[0]["widgets_values"][0]
        assert "krea2" in note, "道劫说明应写明与 krea2 道劫线的关系"
        assert "风格终审=用户" in note, "道劫说明应声明风格终审=用户(适配首发版)"


# ── 6d. daojie pro 件专属契约(规范化装配:底座区四选一×主体句区换槽)──
# 结构(幂等脚本 apps/build/scripts/qwen21_daojie_pro_0923.py 驱动,选型依据见其
# 文档串:核心无 N 路字符串切换 → ComfySwitchNode 链;换槽装配 → 核心 RegexReplace):

def _library_first_base() -> str:
    md = PROMPT_LIB.read_text(encoding="utf-8")
    fence = re.search(r"```text\n(.*?)\n```", md, re.S)
    assert fence, "库文档缺 ```text 底座围栏"
    return fence.group(1)


class TestDaojieProContract:
    def test_base_and_subject_region_groups_present(self):
        graph = GRAPHS["pro"]
        titles = [g.get("title", "") for g in graph["groups"]]
        assert any("底座区" in t for t in titles), f"pro 件缺底座区分组: {titles}"
        assert any("主体句区" in t for t in titles), f"pro 件缺主体句区分组: {titles}"

    def test_titles_and_groups_carry_daojie_marker(self):
        graph = GRAPHS["pro"]
        for group in graph["groups"]:
            assert "道劫" in group["title"], f"分组标题应带道劫字号: {group['title']!r}"
        for node in graph["nodes"]:
            title = node.get("title") or ""
            assert "道劫" in title, f"节点标题应带道劫字号: node{node['id']} {title!r}"

    def test_base_region_four_way_chain_and_default_head(self):
        """底座区=四类型首条 StringConstant + 三级 ComfySwitchNode 级联,默认=首条。"""
        graph = GRAPHS["pro"]
        nodes = _nodes(graph)
        bases = [n for n in graph["nodes"] if n["type"] == "StringConstant"]
        assert len(bases) == 5, \
            f"pro 件应恰 5 个 StringConstant(四底座+主体句区),得 {len(bases)}"
        origin = _resolve_default_string_origin(graph)
        assert origin["id"] == 17 and origin["type"] == "StringConstant", \
            f"默认链头应为 [17] StringConstant(人物首条底座),得 [{origin['id']}]{origin['type']}"

    def test_subject_region_wiring_and_identity_default(self):
        """主体句区=[24] 独立 StringConstant → [26] RegexReplace B 槽换句 → [25] 拼装开关。"""
        graph = GRAPHS["pro"]
        nodes, links = _nodes(graph), _links(graph)
        subject = nodes[24]
        assert subject["type"] == "StringConstant", "主体句区 [24] 应为独立 StringConstant"
        assemblers = _by_type(graph, "RegexReplace")
        assert len(assemblers) == 1, "pro 件应恰 1 个 RegexReplace(B 槽换句装配)"
        asm = assemblers[0]
        assert asm["widgets_values"][1] == "⟨B:[^⟩]*⟩", \
            f"装配 pattern 应为 B 主体槽整段角括号,得 {asm['widgets_values'][1]!r}"
        string_in = next(i for i in asm["inputs"] if i["name"] == "string")
        replace_in = next(i for i in asm["inputs"] if i["name"] == "replace")
        assert nodes[links[string_in["link"]][1]]["id"] == 23, "装配 string 上游应为选型③汇总"
        assert nodes[links[replace_in["link"]][1]]["id"] == 24, "装配 replace 上游应为主体句区 [24]"
        assembly_switch = nodes[25]
        assert assembly_switch["type"] == "ComfySwitchNode" and assembly_switch["widgets_values"][0] is False, \
            "拼装开关 [25] 默认必须 false(纯底座直用)"
        assert nodes[links[assembly_switch["inputs"][0]["link"]][1]]["id"] == 23, \
            "[25] on_false 应为纯底座(选型③直通)"
        assert nodes[links[assembly_switch["inputs"][1]["link"]][1]]["id"] == asm["id"], \
            "[25] on_true 应为换槽装配输出"
        # 主体句区默认=首条底座 B 槽预置句(对首条内容恒等)
        b1 = _widget(nodes[17], 0)
        slot = re.search(r"⟨B:(.*?)⟩", b1)
        assert slot, "首条底座应含 B 主体槽"
        assert _widget(subject, 0) == slot.group(1), \
            "主体句区默认值应=首条底座 B 槽预置句(对首条内容恒等)"

    def test_inherits_pe_group_and_rgba_switch(self):
        graph = GRAPHS["pro"]
        assert _by_type(graph, PE_CLASS), "pro 件应承袭 PE 改写组(与 daojie 同骨架)"
        switches = _by_type(graph, "ComfySwitchNode")
        assert len(switches) == 6, \
            f"pro 件应恰 6 个开关(底座选型3+拼装1+提示词1+RGBA1),得 {len(switches)}"
        assert all(s["widgets_values"][0] is False for s in switches), \
            "全部开关默认必须 false(纯底座直写+普通路)"

    def test_default_prompt_matches_library_first_base(self):
        origin = _resolve_default_string_origin(GRAPHS["pro"])
        prompt = _widget(origin, 0)
        first = _library_first_base()
        assert prompt[:60] == first[:60], "默认 prompt 应与库首条底座前 60 字符一致"
        assert prompt == first, "默认底座应与库首条底座全文逐字一致(json↔md 互锁)"

    def test_assembly_preview_node_present(self):
        """[27] easy showAnything 装配预览(09-23 修订轮补骨,承 K2 件 [62] 同骨)。

        接 [25] 拼装开关输出——[6] prompt 被连线覆盖前端不显实值,[25] true 换槽后的
        文本此前跑图前不可见;预览节点=「进 [6] 的文本含 CJK 即违规」的画布判定点。
        注:生成脚本尚未回灌 [27],重跑脚本会删掉本节点并触发本断言红——预期守恒
        (先同步脚本再重跑,见文件头修订轮注记)。"""
        graph = GRAPHS["pro"]
        nodes, links = _nodes(graph), _links(graph)
        previews = _by_type(graph, "easy showAnything")
        assert len(previews) == 1, \
            f"pro 件应恰 1 个 easy showAnything 装配预览,得 {len(previews)}"
        pv = previews[0]
        src = links[pv["inputs"][0]["link"]]
        assert src[1] == 25, \
            f"预览输入应接 [25] 拼装开关输出(与进 [14]/[6] 的文本同源),得 node{src[1]}"
        assert src[5] == "STRING", "预览接线类型应随 [25] 输出为 STRING"
        assert pv["pos"][0] > nodes[25]["pos"][0], "预览节点应在 [25] 右侧(横向排版)"
        assert "道劫" in (pv.get("title") or ""), "预览节点标题应带道劫字号"

    def test_usage_note_revision_round_warnings(self):
        """09-23 修订轮 Note 三警示锁:①脚本重跑会重置手贴底座 ②换型后 [24] 须同步
        换成本底座 B 槽主体句 ③[27] 预览过目指引。Note 被脚本重跑回退首版即红。"""
        note = _by_type(GRAPHS["pro"], "MarkdownNote")[0]["widgets_values"][0]
        assert "重置回库四类型首条" in note, \
            "Note 缺警示:生成脚本重跑会把 [17]-[20] 重置回库四类型首条(手贴被覆盖)"
        assert "须同步换成本底座对应的 B 槽主体句" in note, \
            "Note 缺指引:换型([21]-[23])后 [24] 须同步换成本底座对应主体句"
        assert "[27]" in note, "Note 缺指引:跑图前在 [27] 装配预览过目换槽实值"

    def test_prompt_library_size_band_all_entries(self):
        """库 16 条底座总量带(09-23 修订轮入库):句数 15-20 + 词数 336-408。

        官方量级「about twenty sentences and four to five hundred words, roughly
        twenty-five words a sentence」(宪法 :139-140)——本仓句数收窄 15-20,词数随
        句数同步收窄,宪法同段自留「a single quiet subject runs shorter」(:141-142)
        口径;实测 16 条全带 336-408 词、句均 21.9-25.5(词数=空白分词),以句均密度
        守住宪法句均约 25 的量级。锁带=改词出带即红,先改本断言口径再改词(与库文档
        文末自查表同口径同数字)。"""
        md = PROMPT_LIB.read_text(encoding="utf-8")
        entries = re.findall(r"^### (.+)$", md, re.M)
        assert len(entries) == 16, f"库 ### 底座条目应恰 16(4 类型×4),得 {len(entries)}"
        for heading in entries:
            m = re.search(rf"^### {re.escape(heading)}\s*$", md, re.M)
            fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S)
            assert fence, f"条目 {heading} 缺 ```text 底座围栏"
            text = fence.group(1)
            sentences = [s for s in re.split(r"(?<=[.])\s+", text.strip()) if s]
            assert 15 <= len(sentences) <= 20, \
                f"{heading}: 句数 {len(sentences)} 出带 15-20"
            words = len(text.split())
            assert 336 <= words <= 408, f"{heading}: 词数 {words} 出带 336-408"

    def test_prompt_library_exists_with_entries(self):
        assert PROMPT_LIB.is_file(), f"道劫规范提示词库缺失: {PROMPT_LIB}"
        md = PROMPT_LIB.read_text(encoding="utf-8")
        headings = re.findall(r"^### (.+)$", md, re.M)
        assert len(headings) >= 12, f"库 ### 底座条目应 ≥12,得 {len(headings)}"
        types = sorted({h.split("-", 1)[0] for h in headings})
        assert len(types) >= 4, f"库底座类型应 ≥4(人物/场景/道具/美宣),得 {types}"


# ── 7. 计数锚(防漂移):K2图像 36 件不变 + Q2-1图像 4 件 ────────────
# 口径注:本锚按目录 json 实数(K2图像 全量=桥 API 8 + 画布件 28,09-23 现状)。
# AGENTS.md「K2图像18」是 09-15 静态自研 MY- 流的历史账口径,与目录文件数
# 非同一账本;本测试锁目录实数——任何件数漂移(误删/误增)即红。

class TestCountAnchor:
    def test_qwen21_dir_exactly_four(self):
        files = sorted(p.name for p in (_IMG_DIR / "Q2-1图像").rglob("*.json"))
        assert files == [
            "qwen21-daojie-t2i-pro.json", "qwen21-daojie-t2i.json",
            "qwen21-edit.json", "qwen21-t2i.json",
        ], f"Q2-1图像 应恰 4 件(09-23 PRO 件入位后定谳),得 {files}"

    def test_k2_dir_unchanged_36(self):
        files = sorted(p.name for p in K2_DIR.rglob("*.json") if p.name != ".DS_Store")
        assert len(files) == 36, \
            f"K2图像 目录 json 应 36 件不变(09-23 现状锚),得 {len(files)}: {files}"
