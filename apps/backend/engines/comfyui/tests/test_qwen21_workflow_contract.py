"""Qwen-Image-2.1(Q2-1图像)工作流契约测试(09-23 制作)。

被测对象 = 仓库真源两件:
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-t2i.json
    engines/comfyui/workflows/1_图片/Q2-1图像/3_改图/qwen21-edit.json

格式口径(09-23 取舍,引擎 v0.37 直开为最终裁判):两件为**引擎前端格式**
(nodes/links/groups + MarkdownNote + pos 布局),非桥 API 格式
(schemaVersion+graph)——桥格式画布打不开(plugin_manager._is_bridge_template
刻意不进侧栏),而设计要求横向排版/group id/MarkdownNote 使用说明,只有前端
格式能承载;布线语义从官方模板 image_qwen_image_2_1_t2i/image_edit 换算。

design.md §6 七条对应:TestFilesInPlace(1)/TestLoaderTriple(2)/
TestSamplerContract(3)/TestTopology(4)/TestCanvasDiscipline(5)/
TestEditContract(6)/TestCountAnchor(7)。
其中第 5 条的「新 schema 必需字段(schemaVersion/graph)在位」随格式取舍改为
「前端格式必需字段(nodes/links/groups)在位」——schemaVersion/graph 是桥 API
格式字段,与本两件画布流格式互斥(混写会被侧栏当成画布件解析出错)。

纯读文件断言,零网络零引擎依赖。

09-23 修复轮注记:脚本层 pytest 曾报「file or directory not found」——本地仓库根
同命令 collect 正常(20 tests collected),文件运行期零 cwd 依赖(真源定位走
__file__,json 读取与 rglob 均绝对锚定);根因是执行侧以非仓库根 cwd 解析仓库
相对路径,修复=调用侧改用绝对路径寻址本文件,测试逻辑无改动。
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
EDIT = _IMG_DIR / "Q2-1图像" / "3_改图" / "qwen21-edit.json"
K2_DIR = _IMG_DIR / "K2图像"

WORKFLOWS = {"t2i": T2I, "edit": EDIT}
GRAPHS = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in WORKFLOWS.items()}

# 加载器三件套(bf16,MPS 主选;int8_convrot 是 CUDA 路线不用)
UNET_FILE = "qwen_image_2.1_bf16.safetensors"
CLIP_FILE = "qwen3vl_8b_bf16.safetensors"
VAE_FILE = "qwen_image_2.1_vae_bf16.safetensors"

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


# ── 1. 两文件在位、文件名合规(09-18 命名铁律:无 MY- 前缀、无下划线)──

class TestFilesInPlace:
    def test_both_files_exist(self):
        for name, path in WORKFLOWS.items():
            assert path.is_file(), f"Q2-1图像 {name} 件缺失: {path}"

    def test_filenames_comply_naming_rules(self):
        for path in WORKFLOWS.values():
            stem = path.stem
            assert not stem.startswith("MY-"), f"{path.name} 残留 MY- 前缀(09-18 废止)"
            assert "_" not in stem, f"{path.name} 含下划线(命名铁律:一律连字符)"


# ── 2. 三加载器在图且文件名逐字精确(bf16 三件 + CLIPLoader type=qwen_image)──

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
            assert len(loaders) == 1, f"{name}: CLIPLoader 应恰 1 个"
            wv = loaders[0]["widgets_values"]
            assert wv[0] == CLIP_FILE, f"{name}: clip_name 应逐字 {CLIP_FILE!r}"
            assert wv[1] == "qwen_image", f"{name}: CLIPLoader type 必须为 qwen_image(得 {wv[1]!r})"

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


# ── 4. 链路完整性(link 双向一致、无孤儿节点、输出节点可达)─────────

class TestTopology:
    def test_links_bidirectional_consistency(self):
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            for link in graph["links"]:
                lid, origin_id, origin_slot, target_id, target_slot, typ = link
                origin, target = nodes[origin_id], nodes[target_id]
                assert typ == origin["outputs"][origin_slot]["type"], \
                    f"{name} link{l}: origin 槽类型不匹配"
                assert lid in (origin["outputs"][origin_slot].get("links") or []), \
                    f"{name} link{l}: origin.outputs[{origin_slot}].links 未登记 {lid}"
                assert target["inputs"][target_slot].get("link") == lid, \
                    f"{name} link{l}: target.inputs[{target_slot}].link != {lid}"

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
            orphans = sorted(
                nodes[i]["type"] for i in nodes
                if i not in seen and nodes[i]["type"] != "MarkdownNote"
            )
            assert not orphans, f"{name}: 存在不可达 SaveImage 的孤儿节点: {orphans}"

    def test_t2i_resolution_selector_feeds_latent(self):
        graph = GRAPHS["t2i"]
        nodes = _nodes(graph)
        selectors = _by_type(graph, "ResolutionSelector")
        assert len(selectors) == 1, "t2i 件应含 ResolutionSelector(官方档位出宽高)"
        latent = _by_type(graph, "EmptyLatentImage")[0]
        width_in = latent["inputs"][0]
        assert width_in["name"] == "width" and width_in["link"] is not None, \
            "EmptyLatentImage.width 必须由 ResolutionSelector.width 供给"
        origin_id = next(l[1] for l in graph["links"] if l[0] == width_in["link"])
        assert nodes[origin_id]["type"] == "ResolutionSelector", \
            "EmptyLatentImage.width 上游必须是 ResolutionSelector"


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


# ── 7. 计数锚(防漂移):K2图像 36 件不变 + Q2-1图像 2 件 ────────────
# 口径注:本锚按目录 json 实数(K2图像 全量=桥 API 8 + 画布件 28,09-23 现状)。
# AGENTS.md「K2图像18」是 09-15 静态自研 MY- 流的历史账口径,与目录文件数
# 非同一账本;本测试锁目录实数——任何件数漂移(误删/误增)即红。

class TestCountAnchor:
    def test_qwen21_dir_exactly_two(self):
        files = sorted(p.name for p in (_IMG_DIR / "Q2-1图像").rglob("*.json"))
        assert files == ["qwen21-edit.json", "qwen21-t2i.json"], \
            f"Q2-1图像 应恰 2 件(本任务定谳),得 {files}"

    def test_k2_dir_unchanged_36(self):
        files = sorted(p.name for p in K2_DIR.rglob("*.json") if p.name != ".DS_Store")
        assert len(files) == 36, \
            f"K2图像 目录 json 应 36 件不变(09-23 现状锚),得 {len(files)}: {files}"
