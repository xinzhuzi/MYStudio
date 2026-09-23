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

09-23 九型分层装配轮(同日第二版,设计=.trellis design.md §11 + 库 05 甲案重写;
幂等脚本同文件升级重写):pro 件四选一版退役,改九型分层装配——
  E. 底座区九型选一链:[17]-[23][25][26] 九 StringConstant=库九型「②型底座+
     ④配色行」(型底座逐字=daojie_bases.json 该型 positive;人物系六型另含
     常量B·人物系增量四锁,随型走)+ [28]→[35] 八级 ComfySwitchNode 级联
     (全 false=①人物默认)。
  F. 装配区四层成链:[24] 主体句槽(①层,默认=库人物型例一)+ 底座级联输出 +
     [36] 通用锁层常量A(③层·库首节全文·全九型恒挂)经 [37][38] 核心
     StringConcatenate(delimiter="\n" 换行分层)接成一段 → [14] → [6] prompt;
     [27] easy showAnything 装配预览。拼接节点选型=核心 StringConcatenate
     (comfy_extras/nodes_string.py:39;仓库在库先例 K2-角色设定-道劫.json [305]);
     RegexReplace 换 B 槽随旧结构退役(甲案装配=主体句领头换行分层,无槽可换)。
     层次序如实注:画布行序=①②(增量锁)④③,库直写件行序=①②③④——层内容
     零差异仅行序不同(锁层恒挂不可拆,增量锁随型走),画布 Note 载明。
  G. 画幅档:九型 aspect/megapixels 联动表入 Note(档位=ResolutionSelector
     真实 combo 值,核自引擎源码 comfy_extras/nodes_resolution.py:7-15)。

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


def _resolve_default_string_origins(graph: dict) -> dict:
    """沿主编码 prompt 上游开关的 false 支路走到底 = 默认直写路的最终来源集合。

    t2i/daojie:零跳,StringConstant 直接;pro:穿底座选型级联(全 false)与
    StringConcatenate 拼接节点(全支路)收集全部 StringConstant 源。中途任一
    开关非 false 即红——该谓词只描述「默认态」的来源。"""
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
            # pro=穿底座选型级联+拼接节点后={底座①人物[17]/主体句[24]/锁层A[36]}三源。
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
                f"{name}: PE 开关 on_false 支路最终来源应为 StringConstant" \
                f"(直写提示词;09-23 由 PrimitiveNode 改核心实节点——PrimitiveNode 队列时内联消解," \
                f"round2 e2e 实证 StringConstant 形态)"
            if name == "pro":
                assert sorted(false_origins) == [17, 24, 36], \
                    f"pro 默认装配三源应为 [17]底座/[24]主体句/[36]锁层, 得 {sorted(false_origins)}"
            else:
                assert len(false_origins) == 1, \
                    f"{name}: 直写路应恰 1 个 StringConstant 源, 得 {sorted(false_origins)}"
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


# ── 6d. daojie pro 件专属契约(九型分层装配:底座区九选一×锁层恒挂×拼接成链)──
# 结构(幂等脚本 apps/build/scripts/qwen21_daojie_pro_0923.py 驱动,选型依据见其
# 文档串:九选一=八级 ComfySwitchNode 链;四层成链=核心 StringConcatenate,
# 在库先例 K2-角色设定-道劫.json [305];RegexReplace 换 B 槽随旧四选一版退役):

BASES_JSON = _TESTS_DIR.parent / "my_nodes/nodes/daojie_bases.json"
# 人物系六型(库 §二:常量B 加挂型,与库各型装配全文实测交叉核验)
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
# 九型底座常量 id(库顺序①-⑨;[24]=主体句槽/[27]=装配预览预留,故⑧⑨用 25/26)
PRO_CONST_IDS = [17, 18, 19, 20, 21, 22, 23, 25, 26]
PRO_SWITCH_IDS = [28, 29, 30, 31, 32, 33, 34, 35]  # 选型①-⑧(⑧=九选一汇总)


def _pro_truth():
    """库 05 ↔ daojie_bases.json 双源解析(独立于生成器实现,双记账互锁)。

    返回 (types, const_a, b_first_line):types=[(zh, subject, base, constant_text)];
    constant_text=画布型底座常量应有全文=②型底座(+常量B·人物系增量四锁)+④配色行。"""
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    zh_order = [b["zh"] for b in bases]
    fences = re.findall(r"```text\n(.*?)\n```", md.split("## 三、")[0], re.S)
    assert len(fences) >= 3, "库 §二 常量围栏不足(装配顺序块+常量A+常量B)"
    const_a, const_b = fences[1], fences[2]
    a_lines, b_lines = const_a.split("\n"), const_b.split("\n")

    types = []
    for zh, canon in zip(zh_order, bases):
        m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
        assert m, f"库缺条目 ### {zh}-基础"
        fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S).group(1)
        lines = fence.split("\n")
        assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh} 首行非 ⟨①:…⟩ 槽"
        subject = lines[0][len("⟨①:"):-len("⟩")]
        base, color, mid = lines[1], lines[-1], lines[2:-1]
        assert base == canon["positive"], f"{zh} ②型底座与 daojie_bases.json positive 不逐字一致"
        assert color == PRO_COLOR_MAP[zh], f"{zh} ④配色行与 §一映射表不一致"
        want_mid = a_lines[:2] + b_lines + a_lines[2:] if zh in PRO_CHAR_TYPES else a_lines
        assert mid == want_mid, f"{zh} ③锁层中间行与常量A/B 组合不一致(甲案互锁破)"
        constant_text = "\n".join([base] + (b_lines if zh in PRO_CHAR_TYPES else []) + [color])
        types.append((zh, subject, base, constant_text))
    return types, const_a, b_lines[0]


class TestDaojieProContract:
    def test_base_and_assembly_region_groups_present(self):
        graph = GRAPHS["pro"]
        titles = [g.get("title", "") for g in graph["groups"]]
        assert any("底座区" in t and "九型" in t for t in titles), \
            f"pro 件缺「底座区·九型选型链」分组: {titles}"
        assert any("装配区" in t for t in titles), f"pro 件缺装配区分组: {titles}"

    def test_titles_and_groups_carry_daojie_marker(self):
        graph = GRAPHS["pro"]
        for group in graph["groups"]:
            assert "道劫" in group["title"], f"分组标题应带道劫字号: {group['title']!r}"
        for node in graph["nodes"]:
            title = node.get("title") or ""
            assert "道劫" in title, f"节点标题应带道劫字号: node{node['id']} {title!r}"

    def test_nine_type_constants_anchor_library(self):
        """库九型锚:九型底座常量逐字=库「②型底座(+人物系增量锁)+④配色行」,
        型底座另与 daojie_bases.json positive 逐字互锁;九底座两两唯一。"""
        graph = GRAPHS["pro"]
        nodes = _nodes(graph)
        types, _, b_first = _pro_truth()
        bases = [n for n in graph["nodes"] if n["type"] == "StringConstant"]
        assert len(bases) == 11, \
            f"pro 件应恰 11 个 StringConstant(九底座+主体句+锁层),得 {len(bases)}"
        for (zh, _subject, base, want_text), cid in zip(types, PRO_CONST_IDS):
            node = nodes[cid]
            assert node["type"] == "StringConstant", f"[{cid}] 应为 StringConstant(型底座常量)"
            text = _widget(node, 0)
            assert text == want_text, \
                f"[{cid}]{zh} 底座常量与库装配层不逐字一致"
            assert text.split("\n")[0] == base, f"[{cid}]{zh} 首行应=②型底座"
            assert text.split("\n")[-1] == PRO_COLOR_MAP[zh], f"[{cid}]{zh} 末行应=④配色行"
            assert (b_first in text) == (zh in PRO_CHAR_TYPES), \
                f"[{cid}]{zh} 常量B增量锁挂载错型(人物系六型应含,场景系三型不应含)"
        texts = [_widget(nodes[cid], 0) for cid in PRO_CONST_IDS]
        assert len(set(texts)) == 9, "九型底座常量两两不唯一"

    def test_lock_constant_present_and_always_wired(self):
        """锁层常量在场:[36]=库首节常量A 全文逐字,恒挂(直连拼接节点,不经开关)。"""
        graph = GRAPHS["pro"]
        nodes, links = _nodes(graph), _links(graph)
        _, const_a, _ = _pro_truth()
        lock = nodes[36]
        assert lock["type"] == "StringConstant", "[36] 应为 StringConstant(通用锁层常量A)"
        assert _widget(lock, 0) == const_a, "[36] 通用锁层常量A 与库首节常量不逐字一致"
        lock_link = links[lock["outputs"][0]["links"][0]]
        assert lock_link[3] == 38 and lock_link[5] == "STRING", \
            "[36] 应直连 [38] StringConcatenate(恒挂,不随型走开关)"

    def test_nine_way_cascade_wiring(self):
        """级联九路:八级 ComfySwitchNode 链,S1.on_false=①人物常量,
        S_k.on_true=C{k+2}型常量,前级输出接后级 on_false,末梢喂拼接①。"""
        graph = GRAPHS["pro"]
        nodes, links = _nodes(graph), _links(graph)
        for i, sid in enumerate(PRO_SWITCH_IDS):
            sw = nodes[sid]
            assert sw["type"] == "ComfySwitchNode", f"[{sid}] 应为 ComfySwitchNode"
            assert sw["widgets_values"][0] is False, f"[{sid}] 选型开关默认非 false"
            false_src = nodes[links[sw["inputs"][0]["link"]][1]]
            want_false = PRO_CONST_IDS[0] if i == 0 else PRO_SWITCH_IDS[i - 1]
            assert false_src["id"] == want_false, \
                f"[{sid}].on_false 上游应为 {'C①人物' if i == 0 else f'前级[{PRO_SWITCH_IDS[i-1]}]'}"
            true_src = nodes[links[sw["inputs"][1]["link"]][1]]
            assert true_src["id"] == PRO_CONST_IDS[i + 1], \
                f"[{sid}].on_true 上游应为型常量[{PRO_CONST_IDS[i + 1]}]"
        concat1 = nodes[37]
        cascade_src = nodes[links[concat1["inputs"][1]["link"]][1]]
        assert cascade_src["id"] == PRO_SWITCH_IDS[-1], \
            "拼接①.string_b 上游应为级联末梢(九选一汇总)"

    def test_default_is_renwen_type(self):
        """默认人物型:全开关 false 时装配三源=[17]①人物底座/[24]主体句/[36]锁层A,
        且组合全文=库人物型四层内容逐字(①主体句+②底座+增量锁+④配色行+③锁层A)。"""
        graph = GRAPHS["pro"]
        nodes = _nodes(graph)
        types, const_a, _ = _pro_truth()
        origins = _resolve_default_string_origins(graph)
        assert sorted(origins) == [17, 24, 36], \
            f"默认装配三源应=[17]底座/[24]主体句/[36]锁层,得 {sorted(origins)}"
        assembled = "\n".join([
            _widget(nodes[24], 0), _widget(nodes[17], 0), _widget(nodes[36], 0)])
        want = "\n".join([types[0][1], types[0][3], const_a])
        assert assembled == want, "默认装配全文与库人物型四层组合不逐字一致"
        assert types[0][0] == "人物", "库首型应为人物(默认型锚)"

    def test_concat_chain_into_prompt(self):
        """拼接成链:[37][38] StringConcatenate(delimiter=\n 换行分层)接
        [24]主体句+底座级联+锁层A → [14] 提示词开关 → [6] prompt;
        RegexReplace 随旧换槽结构退役;[24] 默认=库人物型例一。"""
        graph = GRAPHS["pro"]
        nodes, links = _nodes(graph), _links(graph)
        types, _, _ = _pro_truth()
        concats = _by_type(graph, "StringConcatenate")
        assert len(concats) == 2, f"pro 件应恰 2 个 StringConcatenate,得 {len(concats)}"
        for c in concats:
            assert c["widgets_values"][2] == "\n", f"[{c['id']}] delimiter 应为 \n(换行分层)"
            assert c.get("widgets_values_named", {}).get("delimiter") == "\n", \
                f"[{c['id']}] named delimiter 应为 \n(序列化口径承 K2 在库先例 [305])"
        assert not _by_type(graph, "RegexReplace"), \
            "RegexReplace 应随旧四选一结构退役(甲案装配=主体句领头换行分层,无槽可换)"
        c1, c2 = nodes[37], nodes[38]
        assert nodes[links[c1["inputs"][0]["link"]][1]]["id"] == 24, "[37].string_a 上游应为主体句槽 [24]"
        assert nodes[links[c1["inputs"][1]["link"]][1]]["id"] == 35, "[37].string_b 上游应为级联末梢 [35]"
        assert nodes[links[c2["inputs"][0]["link"]][1]]["id"] == 37, "[38].string_a 上游应为拼接① [37]"
        assert nodes[links[c2["inputs"][1]["link"]][1]]["id"] == 36, "[38].string_b 上游应为锁层A [36]"
        pe_switch = nodes[14]
        assert links[pe_switch["inputs"][0]["link"]][1] == 38, \
            "[14].on_false 应接装配链末梢 [38](直写默认路)"
        assert nodes[24]["type"] == "StringConstant", "[24] 应为独立 StringConstant(主体句槽)"
        assert _widget(nodes[24], 0) == types[0][1], "[24] 默认应=库人物型例一主体句"

    def test_inherits_pe_group_and_rgba_switch(self):
        graph = GRAPHS["pro"]
        assert _by_type(graph, PE_CLASS), "pro 件应承袭 PE 改写组(与 daojie 同骨架)"
        switches = _by_type(graph, "ComfySwitchNode")
        assert len(switches) == 10, \
            f"pro 件应恰 10 个开关(底座选型8+提示词1+RGBA1),得 {len(switches)}"
        assert all(s["widgets_values"][0] is False for s in switches), \
            "全部开关默认必须 false(①人物纯底座直写+普通路)"

    def test_assembly_preview_node_present(self):
        """[27] easy showAnything 装配预览:接 [38] 拼接②输出(与进 [14]/[6] 的
        文本同源)——跑图前过目将进 [6] 的最终装配文本;显示型端点不计孤儿。"""
        graph = GRAPHS["pro"]
        nodes, links = _nodes(graph), _links(graph)
        previews = _by_type(graph, "easy showAnything")
        assert len(previews) == 1, \
            f"pro 件应恰 1 个 easy showAnything 装配预览,得 {len(previews)}"
        pv = previews[0]
        src = links[pv["inputs"][0]["link"]]
        assert src[1] == 38, \
            f"预览输入应接 [38] 拼接②输出,得 node{src[1]}"
        assert src[5] == "STRING", "预览接线类型应随 [38] 输出为 STRING"
        assert pv["pos"][0] > nodes[38]["pos"][0], "预览节点应在 [38] 右侧(横向排版)"
        assert "道劫" in (pv.get("title") or ""), "预览节点标题应带道劫字号"

    def test_usage_note_nine_type_warnings(self):
        """九型版 Note 要点锁:九型选型说明/主体句纪律(空镜无人)/脚本重跑重置
        警示/[27] 过目指引/锁层恒挂说明。Note 被脚本重跑回退即红。"""
        note = _by_type(GRAPHS["pro"], "MarkdownNote")[0]["widgets_values"][0]
        for token in ("九型", "空镜无人", "重置回库文档现读值", "[27]", "恒挂"):
            assert token in note, f"Note 缺九型版要点: {token!r}"

    def test_prompt_library_nine_types_anchor(self):
        """库锚(canon 九型·甲案):### 恰九型且与 daojie_bases.json zh 同序;
        每型装配全文围栏行数=10(人物系)/6(场景系),字符带 1400-2350;
        首行 ⟨①:…⟩ 槽、末行配色行(库文末自查表同口径)。"""
        md = PROMPT_LIB.read_text(encoding="utf-8")
        bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
        zh_order = [b["zh"] for b in bases]
        headings = re.findall(r"^### (.+?)-基础\s*$", md, re.M)
        assert headings == zh_order, \
            f"库 ### 九型标题应与 daojie_bases.json zh 同序,得 {headings}"
        for zh in zh_order:
            m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
            fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S).group(1)
            lines = fence.split("\n")
            want_lines = 10 if zh in PRO_CHAR_TYPES else 6
            assert len(lines) == want_lines, \
                f"{zh}: 装配全文应 {want_lines} 行(②型底座+③锁层[+增量锁]+④配色行),得 {len(lines)}"
            assert 1400 <= len(fence) <= 2350, \
                f"{zh}: 装配全文字符数 {len(fence)} 出带 1400-2350(库自查 1475-2227+槽括号)"
            assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh}: 首行应为 ⟨①:…⟩ 槽"
            assert lines[-1] == PRO_COLOR_MAP[zh], f"{zh}: 末行应为④配色行"



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
