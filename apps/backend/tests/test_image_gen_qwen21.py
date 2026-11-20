"""Qwen-Image-2.1(qwen21-viggle)本地渠道注册与模板契约测试。"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from engines.image_engine import model_cache, qwen21
from image_gen import pipeline


REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_PATH = (
    REPO_ROOT
    / "backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
)
I2I_TEMPLATE_PATH = (
    REPO_ROOT
    / "backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json"
)
I2I_CANVAS_PATH = (
    REPO_ROOT
    / "backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json"
)


class Qwen21RegistrationTests(unittest.TestCase):
    def test_model_registered_with_service_layout(self) -> None:
        spec = model_cache.IMAGE_MODELS[qwen21.MODEL_NAME]
        self.assertEqual(qwen21.MODEL_NAME, "qwen-image-2-1")
        self.assertEqual(spec["layout"], "qwen21-viggle")
        self.assertIn("qwen21-viggle", pipeline._ENGINE_BY_LAYOUT)
        self.assertIs(pipeline._ENGINE_BY_LAYOUT["qwen21-viggle"], qwen21)

    def test_reference_supported_flags(self) -> None:
        # 10-19 图生图·道劫美术风格转换(D3):单参考放开(SUPPORTS_REFERENCE=True 走 i2i 分流);
        # 1116 §五.4 三槽正典:原生三参考放开(>3 张由 generate 拒)
        self.assertTrue(qwen21.SUPPORTS_REFERENCE)
        self.assertTrue(qwen21.SUPPORTS_MULTI_REFERENCE)


class Qwen21TemplateContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.template = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))

    def test_bridge_contract_shape(self) -> None:
        self.assertEqual(self.template["schemaVersion"], 1)
        self.assertIsInstance(self.template["graph"], dict)
        self.assertIsInstance(self.template["inputs"], dict)
        self.assertTrue(
            any(node.get("class_type") == "SaveImage" for node in self.template["graph"].values())
        )

    def test_bindings_point_at_live_nodes(self) -> None:
        for key, binding in self.template["inputs"].items():
            node = self.template["graph"][str(binding["node"])]
            self.assertEqual(node["class_type"], binding["class_type"], key)
            self.assertIn(binding["field"], node["inputs"], key)

    def test_runs_daojie_production_graph(self) -> None:
        # 现行 GUI/API 契约(1108 默认档4):ApiPE 装配、⑦Pruna 臂(7034 mikkoani→
        # 7110 p_q v0.2×1.0 运行时旁路→六步原表+关CFG)、Gem ② 分块超分接棒 2K
        # (v2: [8107] Stitch → [8121] JoinImageWithAlpha → [504];alpha 旁路);
        # E 臂(1101-1108 任默认)随档4 裁枝出模板;7:7027 Fix×0.5 不得回灌。
        classes = {node["class_type"] for node in self.template["graph"].values()}
        self.assertIn("MyQi21ApiPE", classes)
        self.assertIn("MyQi21DaojieBase", classes)
        self.assertIn("ViggleTurboLora", classes)  # 1108 默认档4:⑦Pruna 臂随模板物质化(E 臂 LazyCache 死枝被裁)
        self.assertIn("SamplerCustomAdvanced", classes)  # 1108 ⑦Pruna 臂=SamplerCustomAdvanced 六步采样(E 尾 KSampler 随裁枝出)
        self.assertNotIn("BasicScheduler", classes)      # SCA σ表件随案B 退役(⑦臂用 ViggleTurboSigmas)
        self.assertIn("ViggleTurboSigmas", classes)      # 1108 ⑦臂六步原表动态shift
        self.assertNotIn("SeedVR2VideoUpscaler", classes)  # 1117 Gem ② 接棒:SeedVR2 节点级 mode4 旁路出模板
        self.assertIn("GemTiledUpscale", classes)        # 1117 ② 分块超分链在场(8108-8120)
        self.assertNotIn("7:7027", self.template["graph"])
        self.assertNotIn("7:7028", self.template["graph"])  # 1101晚 E 臂撤 turbo
        self.assertNotIn("7:7044", self.template["graph"])  # t2i 模板吃画布共享 7:7026
        for gone in ("7:7041", "7:7042", "7:7043"):
            self.assertNotIn(gone, self.template["graph"])  # SCA 三件/共享噪声采样件出 E-only 模板
        self.assertEqual(self.template["graph"]["7:7034"]["class_type"], "LoraLoaderModelOnly")
        style = self.template["graph"]["7:7034"]["inputs"]
        self.assertEqual(style["lora_name"], "qi21-mikkoani.safetensors")
        self.assertEqual(style["strength_model"], 0.6)
        self.assertEqual(style["model"], ["1", 0])
        # 1106 双旁路:HQ 出模
        # hq = self.template["graph"]["7:7100"]["inputs"]
        self.assertNotIn("7:7026", self.template["graph"])  # 1106 双旁路
        speed = self.template["graph"]["7:7015"]["inputs"]
        self.assertEqual(speed["mode"], "4 · PrunaAI 6步")  # 1108 用户令:默认档4 PrunaAI
        self.assertEqual(speed["latent_p"], ["7:7112", 0])   # ⑦臂 SamplerCustomAdvanced
        self.assertNotIn("latent_e", speed)                   # E 臂死枝随档4 裁枝
        pruna = self.template["graph"]["7:7110"]
        self.assertEqual(pruna["class_type"], "ViggleTurboLora")
        self.assertEqual(pruna["inputs"]["lora_name"], "p_q_image_2.1_6_steps_v0.2.safetensors")
        self.assertEqual(pruna["inputs"]["strength"], 1.0)
        self.assertEqual(pruna["inputs"]["model"], ["7:7034", 0])  # 产线风格栈 mikkoani
        self.assertIs(self.template['graph']['6:4013']['inputs']['AI扩写开关'], False)

    def test_seed_single_source(self) -> None:
        # seed 单源=PrimitiveInt(7:7014);1108 档4 模板=⑦Pruna 臂消费 7:7017 共用噪声
        # (noise_seed 直连单源;E 臂 7045 随裁枝出模板);绑定必须指它
        self.assertNotIn("7:7045", self.template["graph"])
        noise_seed = self.template["graph"]["7:7017"]["inputs"]["noise_seed"]
        self.assertEqual(noise_seed, ["7:7014", 0])
        binding = self.template["inputs"]["seed"]
        self.assertEqual((binding["node"], binding["field"]), ("7:7014", "value"))

    def test_engine_model_files_are_real_installed_names(self) -> None:
        # 幽灵文件名回归锁(int8_convrot/r128 从未安装,见 1005 记忆)
        self.assertEqual(self.template["graph"]["1"]["inputs"]["unet_name"], "qwen_image_2.1_bf16.safetensors")
        self.assertEqual(self.template["graph"]["2"]["inputs"]["clip_name"], "qwen3vl_8b_bf16_heretic.safetensors")
        lora = self.template["graph"]["7:7034"]["inputs"]["lora_name"]
        self.assertEqual(lora, "qi21-mikkoani.safetensors")
        self.assertNotIn("7:7026", self.template["graph"])  # 1106 双旁路
        if False: self.assertEqual(
            self.template["graph"]["7:7026"]["inputs"]["lora_name"],
            "qwen2.1-detail-fix-2.0.safetensors",
        )

    def test_small_pieces_ready_when_template_loadable(self) -> None:
        status = qwen21.small_pieces_status()
        self.assertTrue(status["ready"], f"模板应可加载: {status}")

    def test_base_type_override_applies_to_assembly_subgraph(self) -> None:
        # 型参数面(1010):调用方点名型→覆写[6:4010];缺省/空串→保持画布现值
        graph = {"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "人物", "透明覆盖": False}}}
        qwen21.apply_base_type(graph, "分镜")
        self.assertEqual(graph["6:4010"]["inputs"]["base"], "分镜")
        qwen21.apply_base_type(graph, None)
        self.assertEqual(graph["6:4010"]["inputs"]["base"], "分镜")
        qwen21.apply_base_type(graph, "   ")
        self.assertEqual(graph["6:4010"]["inputs"]["base"], "分镜")

    def test_upscaled_output_preferred_over_base(self) -> None:
        history = {"pid": {"status": {"status_str": "success"}, "outputs": {
            "8": {"images": [{"filename": "base.png"}]},
            "504": {"images": [{"filename": "2k.png"}]},
        }}}
        state, image = qwen21._prefer_upscaled_output(history, "pid")
        self.assertEqual(state, "success")
        self.assertEqual(image["filename"], "2k.png")
        only_base = {"pid": {"status": {"status_str": "success"}, "outputs": {
            "8": {"images": [{"filename": "base.png"}]},
        }}}
        state, image = qwen21._prefer_upscaled_output(only_base, "pid")
        self.assertEqual(image["filename"], "base.png")


class Qwen21I2iTemplateContractTests(unittest.TestCase):
    """10-19 图生图·道劫美术风格转换:i2i API 模板契约(由 build 脚本 --target i2i 从
    qi21-道劫-i2i.json 展平生成;1116 §五.4 三槽手术=画布投影+三参考链常驻——
    [11]/[17]+[12]/[18] 从画布版逐字移植、4015 绑 image_2/3、references 三 slot,
    不足三张由桥按张数剪链;快照=画布现值锁——组装用途=自由出图、Turbo 8步、
    PE 关、SeedVR2 2K 链在场(10-21 重生成后现状),运行时才覆写组装用途=道劫美术
    风格转换或道劫美术类型(10-22 型层注入)。"""

    def setUp(self) -> None:
        self.template = json.loads(I2I_TEMPLATE_PATH.read_text(encoding="utf-8"))
        self.graph = self.template["graph"]

    def test_i2i_template_contract(self) -> None:
        self.assertEqual(self.template["schemaVersion"], 1)
        self.assertEqual(self.template["name"], "qwen21_道劫_i2i_api")
        inputs = self.template["inputs"]
        # 绑定指向活节点且 class 吻合:prompt→400 / seed→7:7014
        prompt_binding = inputs["prompt"]
        self.assertEqual((prompt_binding["node"], prompt_binding["field"]), ("400", "value"))
        self.assertEqual(self.graph["400"]["class_type"], "PrimitiveStringMultiline")
        seed_binding = inputs["seed"]
        self.assertEqual((seed_binding["node"], seed_binding["field"]), ("7:7014", "value"))
        self.assertEqual(self.graph["7:7014"]["class_type"], "PrimitiveInt")
        # 1116 §五.4 三槽手术:references 三绑定 slot0/1/2 → [10]/[11]/[12]
        references = inputs.get("references")
        self.assertIsInstance(references, list)
        self.assertEqual(len(references), 3)
        for ref, (node_id, slot) in zip(references, (("10", 0), ("11", 1), ("12", 2))):
            self.assertEqual((ref["node"], ref["slot"], ref["field"]), (node_id, slot, "image"))
            self.assertEqual(ref["class_type"], "LoadImage")
        load_images = sorted(key for key, node in self.graph.items() if node["class_type"] == "LoadImage")
        # 三参考链常驻(画布 11/12 旁路态的激活直投;505 透明锚仍不入桥模板)
        self.assertEqual(load_images, ["10", "11", "12"])
        self.assertEqual(self.graph["4015"]["inputs"]["images.image_1"], ["16", 0])
        self.assertEqual(self.graph["4015"]["inputs"]["images.image_2"], ["17", 0])
        self.assertEqual(self.graph["4015"]["inputs"]["images.image_3"], ["18", 0])
        # 预缩链逐字=画布版(16/17/18 同参;lanczos 1MP 32 步)
        for scale_id, src_id in (("16", "10"), ("17", "11"), ("18", "12")):
            node = self.graph[scale_id]
            self.assertEqual(node["class_type"], "ImageScaleToTotalPixels", scale_id)
            self.assertEqual(node["inputs"]["image"], [src_id, 0], scale_id)
            self.assertEqual(
                (node["inputs"]["upscale_method"], node["inputs"]["megapixels"],
                 node["inputs"]["resolution_steps"]),
                ("lanczos", 1, 32), scale_id,
            )
        # 171 加速编码恒单主参考(grill 1116 硬事实:加速臂只吃 image_1,不吃 image_2/3)
        self.assertEqual(self.graph["171"]["inputs"]["images.image_1"], ["16", 0])
        self.assertNotIn("images.image_2", self.graph["171"]["inputs"])
        self.assertNotIn("images.image_3", self.graph["171"]["inputs"])
        self.assertIn("image", self.graph["10"]["inputs"])
        self.assertEqual(self.graph["504"]["class_type"], "SaveImage")
        # 1117 Gem ② 接棒:SeedVR 子图整体剪出,2K 产物改吃 [8120] 拼缝件
        self.assertNotIn("503:7401", self.graph)
        self.assertIn("8120", self.graph)
        self.assertEqual(self.graph["8107"]["class_type"], "GemTiledUpscaleStitch")  # v2: 8120→8107
        self.assertEqual(self.graph["504"]["inputs"]["images"], ["8121", 0])  # v2: alpha旁路后504←8121(Join)
        self.assertNotIn("505", self.graph)  # 透明锚(画布旁路件)不入桥模板
        # SaveImage [8] 在场(唯一产物口;504 缺席→_prefer_upscaled_output 自然回落 8)
        self.assertEqual(self.graph["8"]["class_type"], "SaveImage")

    def test_i2i_snapshot_locks_canvas_values(self) -> None:
        # 组装用途快照=自由出图(GUI 现值;运行时覆写道劫美术风格转换)
        self.assertEqual(self.graph["6:4011"]["inputs"]["组装用途"], "自由出图")
        # 10-22 型层注入路结构锁:4022 画幅路由在场且同持快照值;4010 base 烘焙值;
        # 6:180 rgba_hint 连线 6:4010(RGBA 跟型——base 注入后透明链自动激活的前提)
        self.assertEqual(self.graph["6:4022"]["class_type"], "MyQi21PurposeCanvas")
        self.assertEqual(self.graph["6:4022"]["inputs"]["组装用途"], "自由出图")
        self.assertEqual(self.graph["6:4010"]["inputs"]["base"], "人物海报")
        self.assertEqual(self.graph["6:180"]["inputs"]["rgba_hint"], ["6:4010", 4])
        # 档位快照=档4 PrunaAI(1108 拉齐令:三件默认统一)
        self.assertEqual(self.graph["7:7015"]["inputs"]["mode"], "4 · PrunaAI 6步")
        self.assertEqual(self.graph["7:7015"]["inputs"]["latent_p"], ["7:7112", 0])
        self.assertNotIn("latent_e", self.graph["7:7015"]["inputs"])
        # 指令择文直接持有 PE 开关；关闭时 selected_graph 不保留 PE 依赖。
        self.assertNotIn("6:4012", self.graph)
        self.assertEqual(self.graph["6:4014"]["class_type"], "MyQi21InstructionSelect")
        self.assertIs(self.graph["6:4014"]["inputs"]["pe开关"], False)
        self.assertEqual(self.graph["6:4014"]["inputs"]["原始指令"], ["400", 0])
        self.assertNotIn("PE出文", self.graph["6:4014"]["inputs"])
        self.assertNotIn("PE负面", self.graph["6:4014"]["inputs"])
        self.assertEqual(self.graph["6:153"]["class_type"], "MyQi21FinalOutput")
        self.assertEqual(self.graph["6:153"]["inputs"]["正向提示词"], ["6:4011", 0])
        self.assertEqual(self.graph["6:153"]["inputs"]["负向提示词"], ["6:4011", 1])
        # seed 单源=PrimitiveInt(7:7014);1108 档4=⑦臂消费 7:7017 共用噪声
        # (noise_seed 直连单源;E 臂 7045 随裁枝出模板)
        self.assertNotIn("7:7045", self.graph)
        self.assertEqual(self.graph["7:7017"]["inputs"]["noise_seed"], ["7:7014", 0])
        self.assertEqual(graph_cls := self.graph["7:7110"]["class_type"], "ViggleTurboLora")
        self.assertEqual(self.graph["7:7110"]["inputs"]["model"], ["7:7034", 0])


class Qwen21I2iGenerateTests(unittest.TestCase):
    """10-19 图生图·道劫美术风格转换:i2i 分流行为测(mock 上传/提交/取图)。"""

    def _all_classes_available(self) -> frozenset[str]:
        classes: set[str] = set()
        for template in (qwen21.load_template(qwen21.TEMPLATE_NAME), qwen21.load_template(qwen21.TEMPLATE_NAME_I2I)):
            classes.update(qwen21.graph_node_classes(template["graph"]))
        # 10-26 E 混动臂运行时注入类(真实引擎 object_info 已含;桥模板只含 Turbo 臂)
        classes.update(qwen21.E_HYBRID_INJECTED_CLASSES)
        return frozenset(classes)

    def _run_generate(self, *, prompt_id: str = "p-run", **generate_kwargs: object) -> tuple[dict, object, object]:
        """跑一次 generate 并捕获提交图/上传调用;返回 (submitted_graph, http_json, upload)。"""
        submitted: dict = {}

        def http_json(method: str, url: str, payload: dict | None = None, timeout: float = 2) -> dict:
            if url.endswith("/prompt"):
                submitted.update(payload["prompt"])
                return {"prompt_id": prompt_id}
            if "/history/" in url:
                return {prompt_id: {"status": {"status_str": "success"}, "outputs": {
                    "8": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]},
                }}}
            raise AssertionError(url)

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch.object(
            qwen21, "_available_node_classes", return_value=self._all_classes_available()
        ), patch.object(qwen21, "_http_json", side_effect=http_json) as http_mock, patch.object(
            qwen21, "_upload_image", return_value={"name": "qwen21-i2i-uploaded.png"}
        ) as upload_mock, patch.object(qwen21, "_fetch_bytes", return_value=b"i2i-png"), patch(
            "comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            qwen21.generate(**generate_kwargs)
        return submitted, http_mock, upload_mock

    def test_i2i_generate_overrides_assembly_purpose(self) -> None:
        canvas_before = I2I_CANVAS_PATH.read_bytes()
        graph_one, _, upload_one = self._run_generate(
            prompt="画风转换指令甲", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=None,
            reference_b64="aWlpcmVmaW9uZQ==",
        )
        self.assertEqual(graph_one["6:4011"]["inputs"]["组装用途"], "道劫美术风格转换")
        # 缺省=道劫美术风格转换:型层注入路三锚全部不动(4010 base=烘焙值人物、
        # 4022 画幅路由=快照值自由出图=恒跟参考画幅)——10-22 型层注入的回归锁
        self.assertEqual(graph_one["6:4010"]["inputs"]["base"], "人物海报")
        self.assertEqual(graph_one["6:4022"]["inputs"]["组装用途"], "自由出图")
        # 单参考净化(1116 单源在桥 instantiate_template 按数剪链):1 张请求
        # [11]/[17]/[12]/[18] 链物理摘除+编码器 image_2/3 槽清空
        self.assertNotIn("11", graph_one)
        self.assertNotIn("17", graph_one)
        self.assertNotIn("images.image_2", graph_one["4015"]["inputs"])
        self.assertEqual(graph_one["10"]["inputs"]["image"], "qwen21-i2i-uploaded.png")
        self.assertRegex(upload_one.call_args.args[2], r"^qwen21-i2i-[0-9a-f]{32}\.png$")
        self.assertEqual(graph_one["400"]["inputs"]["value"], "画风转换指令甲")
        # seed=None 时每次随机(fire 铁令):两次提交的 7:7014 不同
        graph_two, _, _ = self._run_generate(
            prompt="画风转换指令乙", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=None,
            reference_b64="aWlpcmVmaW9uZQ==",
        )
        seed_one = graph_one["7:7014"]["inputs"]["value"]
        seed_two = graph_two["7:7014"]["inputs"]["value"]
        self.assertIsInstance(seed_one, int)
        self.assertNotEqual(seed_one, seed_two)
        self.assertTrue(1 <= seed_one <= 2**31 - 1 and 1 <= seed_two <= 2**31 - 1)
        # GUI 本体文件未被改写
        self.assertEqual(I2I_CANVAS_PATH.read_bytes(), canvas_before)

    def test_i2i_base_type_switches_type_full_assembly(self) -> None:
        # 10-22 型层注入路:带 base_type → 4010 注型 + 4011/4022 组装用途同切
        # 「道劫美术类型」(4022=画幅路由,只改 4011 会恒跟参考画幅——晏燎役方形案同坑)
        graph, _, _ = self._run_generate(
            prompt="表情差分指令", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            reference_b64="aWlpcmVmaW9uZQ==", base_type="表情差分",
        )
        self.assertEqual(graph["6:4010"]["inputs"]["base"], "表情差分")
        self.assertEqual(graph["6:4011"]["inputs"]["组装用途"], "道劫美术类型")
        self.assertEqual(graph["6:4022"]["inputs"]["组装用途"], "道劫美术类型")
        # 注入路同样吃单参考净化(demo 链不得随型层注入回潮)
        self.assertNotIn("11", graph)
        self.assertNotIn("17", graph)
        self.assertNotIn("images.image_2", graph["4015"]["inputs"])

    def test_i2i_super_native_type_canvas_capped(self) -> None:
        # 1118 碎格根修:人物海报 override 1536×2048(3.15MP)超安全档 →
        # node4 EmptyLatentImage 字面量压回 ≤1.25MP,3:4 纵横比保持,/32 对齐
        graph, _, _ = self._run_generate(
            prompt="海报指令", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=7,
            reference_b64="aWlpcmVmaW9uZQ==", base_type="人物海报",
        )
        latent = graph["4"]["inputs"]
        self.assertIsInstance(latent["width"], int)
        self.assertIsInstance(latent["height"], int)
        self.assertLessEqual(latent["width"] * latent["height"], 1_250_000)
        self.assertGreater(latent["width"] * latent["height"], 900_000)
        self.assertAlmostEqual(latent["width"] / latent["height"], 0.75, delta=0.03)
        self.assertEqual(latent["width"] % 32, 0)
        self.assertEqual(latent["height"] % 32, 0)

    def test_i2i_safe_type_canvas_untouched(self) -> None:
        # 道具(1:1 1.0MP 公式型)安全档内零注入:node4 仍连 WhSuggest 型画幅
        graph, _, _ = self._run_generate(
            prompt="道具指令", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=7,
            reference_b64="aWlpcmVmaW9uZQ==", base_type="道具",
        )
        self.assertEqual(graph["4"]["inputs"]["width"], ["6:4018", 0])
        self.assertEqual(graph["4"]["inputs"]["height"], ["6:4018", 1])

    def test_i2i_manual_size_capped_when_super_native(self) -> None:
        # type-shot 横幅手动 1824×1024(1.87MP)超安全档:压回保 16:9;
        # WhSuggest 手动槽照旧由 apply_manual_size 写入(原值不被改写)
        graph, _, _ = self._run_generate(
            prompt="横幅指令", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=7,
            reference_b64="aWlpcmVmaW9uZQ==", base_type="人物海报",
            manual_width=1824, manual_height=1024,
        )
        latent = graph["4"]["inputs"]
        self.assertIsInstance(latent["width"], int)
        self.assertLessEqual(latent["width"] * latent["height"], 1_250_000)
        self.assertAlmostEqual(latent["width"] / latent["height"], 1824 / 1024, delta=0.05)
        self.assertEqual(graph["6:4018"]["inputs"]["手动宽"], 1824)
        self.assertEqual(graph["6:4018"]["inputs"]["手动高"], 1024)

    def test_i2i_unknown_type_fails_open(self) -> None:
        # 型不在册(表解析 fail-open):零注入回退旧行为,node4 连线原样
        graph, _, _ = self._run_generate(
            prompt="未知型指令", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=7,
            reference_b64="aWlpcmVmaW9uZQ==", base_type="不存在的型",
        )
        self.assertEqual(graph["4"]["inputs"]["width"], ["6:4018", 0])

    def test_i2i_rejects_fourth_reference(self) -> None:
        # 1116 §五.4 七刀①:拒线从「>1 拒」改「>3 拒」——三槽正典下 1-3 张全放,
        # 第四张拒(原生三参考槽上限)
        from image_gen.pipeline import PipelineError

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch(
            "comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            with self.assertRaises(PipelineError) as caught:
                qwen21.generate(
                    "指令", "1:1", None, 8, None,
                    reference_b64="c2Vjb25kcmVm",
                    reference_images_b64=["cmVmMQ==", "cmVmMg==", "cmVmMw==", "cmVmNA=="],
                )
        self.assertEqual(caught.exception.code, "reference-unsupported")

    def test_i2i_multi_reference_chain_matrix(self) -> None:
        # 1116 §五.4 七刀⑤按数剪链矩阵:3 张全留 / 2 张剪三链摘 image_3 /
        # 1 张剪二三链摘 image_2+3;上传逐张循环(七刀②);全列表注入 slot0/1/2(③)
        for count, expect_in, expect_out, expect_slots in (
            (3, ("10", "11", "12", "16", "17", "18"), (), ("images.image_1", "images.image_2", "images.image_3")),
            (2, ("10", "11", "16", "17"), ("12", "18"), ("images.image_1", "images.image_2")),
            (1, ("10", "16"), ("11", "12", "17", "18"), ("images.image_1",)),
        ):
            refs = ["cmVmMQ==", "cmVmMg==", "cmVmMw=="][:count]
            graph, _, upload_mock = self._run_generate(
                prompt=f"{count} 参考指令", aspect_ratio="1:1", negative_prompt=None,
                steps=8, seed=42, reference_b64=refs[0], reference_images_b64=refs,
            )
            self.assertEqual(upload_mock.call_count, count, count)
            for node_id in expect_in:
                self.assertIn(node_id, graph, f"{count} 张: {node_id} 应在场")
            for node_id in expect_out:
                self.assertNotIn(node_id, graph, f"{count} 张: {node_id} 应剪除")
            encode_inputs = graph["4015"]["inputs"]
            for slot in expect_slots:
                self.assertIn(slot, encode_inputs, f"{count} 张: 4015.{slot} 应保留")
            for slot in ("images.image_1", "images.image_2", "images.image_3"):
                if slot not in expect_slots:
                    self.assertNotIn(slot, encode_inputs, f"{count} 张: 4015.{slot} 应摘除")
            # 每张参考落到对应槽位节点(上传 mock 恒返同名 → 在场 LoadImage 值统一)
            for node_id in ("10", "11", "12"):
                if node_id in graph:
                    self.assertEqual(graph[node_id]["inputs"]["image"], "qwen21-i2i-uploaded.png", node_id)
            # 171 加速编码恒单主参考(剪链不影响)
            self.assertEqual(graph["171"]["inputs"]["images.image_1"], ["16", 0])

    def test_i2i_multiref_forces_native_40step(self) -> None:
        # 1120 用户令:i2i ≥2 张参考恒原生40步——正源=[4015]多参考编码槽0
        # (快档 Pruna 引导器只吃 [171]=image_1,场景/前帧在快档下不生效;
        # 少步×多参考=黑屏域 0928/1014 铁案)。7500 直注+解码[5]直指;
        # 1 张=单参考域不触发(默认/手型路由照旧)
        graph, _, _ = self._run_generate(
            prompt="双图换上衣", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            reference_b64="cmVmMQ==", reference_images_b64=["cmVmMQ==", "cmVmMg=="],
        )
        native = graph["7500"]
        self.assertEqual(native["class_type"], "KSampler")
        ins = native["inputs"]
        self.assertEqual(ins["positive"], ["4015", 0])    # 多参考正源(镜像路=[171]单图,弃)
        self.assertEqual(ins["negative"], ["4015", 1])
        self.assertEqual(ins["latent_image"], ["20", 0])  # 画幅开关域(同快档镜像源)
        self.assertEqual(ins["model"], ["7:7034", 0])
        self.assertEqual(ins["seed"], ["7:7014", 0])      # seed 单源
        self.assertEqual((ins["steps"], ins["cfg"], ins["denoise"]), (40, 4.0, 1.0))
        self.assertEqual(graph["5"]["inputs"]["samples"], ["7500", 0])  # 解码直指原生臂
        # 分镜剧情图+三参考=动机案例:型级路由表无分镜→默认档让位本令
        sb, _, _ = self._run_generate(
            prompt="分镜镜1", aspect_ratio="16:9", negative_prompt=None, steps=8, seed=42,
            reference_b64="cmVmMQ==",
            reference_images_b64=["cmVmMQ==", "cmVmMg==", "cmVmMw=="],
            base_type="分镜剧情图",
        )
        self.assertEqual(sb["7500"]["inputs"]["positive"], ["4015", 0])
        # 美宣(型级原生40注臂)×2 参考=7500 同键覆写,最终正源恒多参考
        mx, _, _ = self._run_generate(
            prompt="美宣双参考", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            reference_b64="cmVmMQ==", reference_images_b64=["cmVmMQ==", "cmVmMg=="],
            base_type="美宣",
        )
        self.assertEqual(mx["7500"]["inputs"]["positive"], ["4015", 0])
        # 1 张=单参考域,原生覆写不触发(手型路由照旧留守档4)
        single, _, _ = self._run_generate(
            prompt="单参考画布轻编辑", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            reference_b64="cmVmMQ==", base_type="无衣物定妆",
        )
        self.assertNotIn("7500", single)
        self.assertEqual(single["7:7015"]["inputs"]["mode"], qwen21.SPEED_MODE_PRUNA)

    def test_t2i_path_unchanged_without_reference(self) -> None:
        # 回归锁:无参考图走原 t2i 路(t2i 模板实例化+E 臂默认补注后原样提交,不上传参考图;
        # 1101 默认档3后,E 臂补注并入确定性路径,逐字节可复现)
        submitted, _, upload_mock = self._run_generate(
            prompt="t2i 回归", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
        )
        upload_mock.assert_not_called()
        expected = qwen21.instantiate_template(
            qwen21.load_template(qwen21.TEMPLATE_NAME), "t2i 回归", None, 8, 42, "1:1", [],
        )
        qwen21.apply_hand_speed_mode(expected, None)  # 1101:默认档3→E 臂补注(与产线同路)
        self.assertEqual(submitted, expected)
        self.assertNotIn("10", submitted)

    def test_hand_type_t2i_defaults_pruna(self) -> None:
        # 1108 用户令:默认档4 PrunaAI——有手型与默认合一(⑦臂随模板物质化,
        # hand_default=档4 幂等);链=7034 mikkoani→7110 p_q v0.2×1.0(ViggleTurboLora
        # 运行时旁路)→7111 BasicGuider 关CFG+7113 六步原表→7112;E 臂死枝全裁
        # 1120 型级路由后人物海报走 native40,此测换无衣物定妆(手型留守档4 代表)
        graph, _, _ = self._run_generate(
            prompt="定妆主体句", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            base_type="无衣物定妆",
        )
        sel = graph["7:7015"]["inputs"]
        self.assertEqual(sel["mode"], qwen21.SPEED_MODE_PRUNA)
        self.assertEqual(sel["latent_p"], ["7:7112", 0])
        self.assertNotIn("latent_e", sel)
        self.assertEqual(graph["7:7034"]["inputs"]["lora_name"], "qi21-mikkoani.safetensors")
        lora = graph["7:7110"]
        self.assertEqual(lora["class_type"], "ViggleTurboLora")
        self.assertEqual(lora["inputs"]["lora_name"], "p_q_image_2.1_6_steps_v0.2.safetensors")
        self.assertEqual(lora["inputs"]["strength"], 1.0)
        self.assertEqual(lora["inputs"]["model"], ["7:7034", 0])
        self.assertEqual(graph["7:7111"]["inputs"]["conditioning"], ["4015", 0])
        self.assertEqual(graph["7:7113"]["inputs"]["nodes"],
                         "1.0, 0.925, 0.85, 0.625, 0.375, 0.125")
        smp = graph["7:7112"]["inputs"]
        self.assertEqual((smp["guider"], smp["sampler"], smp["sigmas"], smp["noise"]),
                         (["7:7111", 0], ["7:7018", 0], ["7:7113", 0], ["7:7017", 0]))
        self.assertEqual(graph["7:7017"]["inputs"]["noise_seed"], ["7:7014", 0])  # seed 单源
        for gone in ("7:7045", "7:7040", "7:7028", "7:7011", "7:7012", "7:7010"):
            self.assertNotIn(gone, graph)  # 他臂死枝随档4 裁枝

    def test_hand_type_i2i_defaults_pruna(self) -> None:
        # 1108 拉齐令:i2i ⑦Pruna 臂入列,手型默认随 t2i=档4——
        # 链=7034 mikkoani→7110 p_q×1.0→7111 关CFG+7113 六步原表→7112;
        # 条件=171 单参考域(同②⑤臂),latent=[20] 画幅开关域;E 臂死枝全裁
        # 1120 型级路由后人物海报走 native40,此测换无衣物定妆
        graph, _, _ = self._run_generate(
            prompt="定妆指令", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            reference_b64="aWlpcmVmaW9uZQ==", base_type="无衣物定妆",
        )
        sel = graph["7:7015"]["inputs"]
        self.assertEqual(sel["mode"], qwen21.SPEED_MODE_PRUNA)
        self.assertEqual(sel["latent_p"], ["7:7112", 0])
        self.assertNotIn("latent_e", sel)
        lora = graph["7:7110"]
        self.assertEqual(lora["class_type"], "ViggleTurboLora")
        self.assertEqual(lora["inputs"]["lora_name"], "p_q_image_2.1_6_steps_v0.2.safetensors")
        self.assertEqual(lora["inputs"]["model"], ["7:7034", 0])
        self.assertEqual(graph["7:7111"]["inputs"]["conditioning"], ["171", 0])  # 单参考编码域
        self.assertEqual(graph["7:7112"]["inputs"]["latent_image"], ["20", 0])   # 画幅开关 latent 域
        self.assertEqual(graph["7:7017"]["inputs"]["noise_seed"], ["7:7014", 0]) # seed 单源
        for gone in ("7:7045", "7:7040", "7:7044", "7:7028", "7:7011", "7:7012", "7:7010"):
            self.assertNotIn(gone, graph)  # 他臂死枝随档4 裁枝

    def test_non_hand_types_default_pruna(self) -> None:
        # 1108 用户令:默认档4 PrunaAI——非有手型走模板默认档4,
        # ⑦臂随模板物质化(与 hand_default 强制合一=幂等零动作)
        for base_type in ("道具", "人脸基准", "场景", None, "  "):
            graph, _, _ = self._run_generate(
                prompt=f"主体句{base_type}", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
                base_type=base_type,
            )
            self.assertEqual(graph["7:7015"]["inputs"]["mode"], "4 · PrunaAI 6步", base_type)
            self.assertEqual(graph["7:7015"]["inputs"]["latent_p"], ["7:7112", 0], base_type)
            self.assertIn("7:7110", graph, base_type)  # ⑦Pruna 臂在场

    def test_hand_speed_mode_fail_closed_on_missing_turbo_source(self) -> None:
        # 模板漂移防线:镜像源缺失→显式 bridge-template-missing,禁静默降级直出
        from image_gen.pipeline import PipelineError

        with self.assertRaises(PipelineError) as caught:
            # 1108 分域:E 臂补注路的 fail-closed 用 hand_default=档3 触达
            # (默认档4 无补注路;i2i 域恒走档3 口径)
            qwen21.apply_hand_speed_mode({"7:7015": {"inputs": {}}}, "人物海报",
                                         hand_default=qwen21.SPEED_MODE_E_HYBRID)
        self.assertEqual(caught.exception.code, "bridge-template-missing")

    def test_manual_size_overrides_whsuggest_t2i_and_i2i(self) -> None:
        # 10-26 用户裁定「人物海报横竖皆可」:manual_width/height 手动槽覆写
        # WhSuggest(t2i=[4018]/i2i=[6:4018]);缺省零动作=跟型
        g1, _, _ = self._run_generate(
            prompt="横幅海报", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            manual_width=1824, manual_height=1024,
        )
        self.assertEqual((g1["4018"]["inputs"]["手动宽"], g1["4018"]["inputs"]["手动高"]), (1824, 1024))
        g2, _, _ = self._run_generate(
            prompt="横幅海报i2i", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            reference_b64="aWlpcmVmaW9uZQ==", manual_width=1824, manual_height=1024,
        )
        self.assertEqual((g2["6:4018"]["inputs"]["手动宽"], g2["6:4018"]["inputs"]["手动高"]), (1824, 1024))
        g3, _, _ = self._run_generate(
            prompt="跟型", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
        )
        self.assertEqual(g3["4018"]["inputs"]["手动宽"], 0)

    def test_manual_size_aligns_to_8_and_ignores_bad_values(self) -> None:
        g = {"4018": {"class_type": "MyQi21WhSuggest",
                      "inputs": {"九型WIDTH": ["6:4010", 1], "九型HEIGHT": ["6:4010", 2],
                                  "手动宽": 0, "手动高": 0}}}
        qwen21.apply_manual_size(g, 1826, 1023)
        self.assertEqual((g["4018"]["inputs"]["手动宽"], g["4018"]["inputs"]["手动高"]), (1824, 1016))
        qwen21.apply_manual_size(g, None, 800)
        self.assertEqual(g["4018"]["inputs"]["手动宽"], 1824)  # 非法零动作
        qwen21.apply_manual_size(g, -5, 800)
        self.assertEqual(g["4018"]["inputs"]["手动高"], 1016)
        qwen21.apply_manual_size(g, "abc", 800)
        self.assertEqual(g["4018"]["inputs"]["手动高"], 1016)


if __name__ == "__main__":
    unittest.main()


class Qwen21ForcedTemplateContractTests(unittest.TestCase):
    """1102 控制中心 S3 绑定注入:forced_template 消费契约(源码锁,仿字面量锁范式)。

    语义链两端行为各有测锁:前端映射层(McpSettingsTab.test S3 describe,库内路径→
    API 模板键)+ 本类锁引擎消费点不回退——删除任一分支的 forced 消费即红。"""

    SOURCE = (Path(__file__).resolve().parents[1] / "engines" / "image_engine" / "qwen21.py").read_text(
        encoding="utf-8"
    )

    def test_forced_template_read_from_ctx(self) -> None:
        # 消费点存在:照 comfyui_bridge.py:452-454 同款先例读 ctx["template"]
        self.assertIn('forced_template = ctx.get("template")', self.SOURCE)

    def test_both_branches_honor_forced_template(self) -> None:
        # t2i 与 i2i 两分支均 forced 优先于常量(缺省 None=自动路由零迁移)
        self.assertIn("template_key = forced_template or TEMPLATE_NAME_I2I", self.SOURCE)
        self.assertIn("template_key = forced_template or TEMPLATE_NAME", self.SOURCE)
        # 且两分支都以 template_key 载入(而非仍载常量)
        self.assertIn("template = load_template(template_key)", self.SOURCE)


class Qwen21WideEdgeAnchorTests(unittest.TestCase):
    """1120 P4 边长锚+终格断言(trellis 11-19 四格蓝图③④格):16:9 交付线
    恒宽 3840——比例门→8100/8122 megapixels 覆写→取图后 lanczos 终格微整
    +禁欠终断;竖/方型拦候裁零动作。"""

    def test_ratio_gate_boundaries(self) -> None:
        # 16:9 族容差核 2%:全 16:9 型画幅过,竖/方拦
        self.assertTrue(qwen21.ratio_gate(2048, 1152))   # 精确 16:9
        self.assertTrue(qwen21.ratio_gate(1824, 1024))   # 人物多视图 +0.2%
        self.assertTrue(qwen21.ratio_gate(1344, 768))    # 历史横档 -1.6%
        self.assertTrue(qwen21.ratio_gate(1920, 1080))
        self.assertFalse(qwen21.ratio_gate(1080, 1080))  # 道具/人脸族 1:1
        self.assertFalse(qwen21.ratio_gate(1536, 2048))  # 人物海报 3:4
        self.assertFalse(qwen21.ratio_gate(0, 0))

    def test_edge_anchor_mp_math(self) -> None:
        # 恒宽 3840 数学等价:16:9=8.2944(3840×2160);比例族内随 ratio 微变
        self.assertAlmostEqual(qwen21.edge_anchor_mp(2048, 1152), 8.2944, places=4)
        self.assertAlmostEqual(qwen21.edge_anchor_mp(16, 9), 8.2944, places=4)
        # 多视图比例(+0.2%)恒宽等价 MP 与 16:9 同值域
        self.assertLess(abs(qwen21.edge_anchor_mp(1824, 1024) - 8.2944), 0.03)

    def _t2i_graph(self) -> dict:
        return qwen21.instantiate_template(
            qwen21.load_template(qwen21.TEMPLATE_NAME), "p", None, 8, 42, "16:9", []
        )

    def test_anchor_overwrites_gem_mp_both_nodes(self) -> None:
        # 16:9 资产型(设定卡 2048×1152):8100 GemTiledUpscale+8122
        # ImageScaleToTotalPixels 两口同值 8.2944(等比同构,alpha 链跟主链)。
        # 1121 分镜锚修:例型从分镜剧情图换设定卡(分镜域已改钉型画幅,见下)
        graph = self._t2i_graph()
        self.assertTrue(qwen21.apply_wide_edge_anchor(graph, "设定卡", None, None, "16:9"))
        self.assertEqual(graph["8100"]["inputs"]["megapixels"], 8.2944)
        self.assertEqual(graph["8122"]["inputs"]["megapixels"], 8.2944)

    def test_storyboard_type_pins_type_canvas_mp(self) -> None:
        # 1121 分镜锚修:分镜剧情图(分镜域)不进 3840 交付线——升档口
        # (8100 Gem 8.25/8122 8.25)钉型画幅 2048×1152=2.3593MP;1MP 参考
        # 压缩口(16/17/18)低于目标零动作;终格微整不激活(返回 False)
        graph = self._t2i_graph()
        self.assertFalse(qwen21.apply_wide_edge_anchor(graph, "分镜剧情图", None, None, "16:9"))
        self.assertEqual(graph["8100"]["inputs"]["megapixels"], 2.3593)
        self.assertEqual(graph["8122"]["inputs"]["megapixels"], 2.3593)
        # t2i 模板无 1MP 参考压缩口;i2i 模板的压缩口由集成测试的提交图核
        # (分镜锚修只压超标口,低于目标零动作——"2 口"打点即证据)

    def test_storyboard_manual_pair_pins_manual_mp(self) -> None:
        # 分镜域+手动成对值:钉手动画幅 MP(手动语义=用户意图优先,同 _edge_canvas)
        graph = self._t2i_graph()
        self.assertFalse(qwen21.apply_wide_edge_anchor(graph, "分镜剧情图", 1920, 1088, "16:9"))
        self.assertAlmostEqual(graph["8100"]["inputs"]["megapixels"], 2.089, places=3)

    def test_square_type_blocked_keeps_825_cap(self) -> None:
        # 竖/方型=用户裁定拦候裁:两口维持 8.25MP 帽,返回 False
        graph = self._t2i_graph()
        self.assertFalse(qwen21.apply_wide_edge_anchor(graph, "道具", None, None, "1:1"))
        self.assertEqual(graph["8100"]["inputs"]["megapixels"], 8.25)
        self.assertEqual(graph["8122"]["inputs"]["megapixels"], 8.25)

    def test_manual_wide_canvas_takes_priority(self) -> None:
        # 手动成对值优先于型画幅:1080×1080 手动压过 16:9 型(手动语义=用户意图)
        graph = self._t2i_graph()
        self.assertFalse(qwen21.apply_wide_edge_anchor(
            graph, "分镜剧情图", 1080, 1080, "16:9"))
        graph = self._t2i_graph()
        self.assertTrue(qwen21.apply_wide_edge_anchor(
            graph, "道具", 1920, 1080, "1:1"))
        self.assertEqual(graph["8100"]["inputs"]["megapixels"], 8.2944)

    def test_aspect_ratio_string_alone_no_longer_anchors(self) -> None:
        # 1121 第三出口封死:无型无参考无手动,aspect 串(传输层缺省恒 "16:9")
        # 不再作锚判据——曾把非 16:9 任务锚成 8.2944MP 巨幅拉爆引擎;16:9
        # 交付线正主=分镜域带 base_type(型画幅锚),aspect 兜底无正主。
        graph = self._t2i_graph()
        self.assertFalse(qwen21.apply_wide_edge_anchor(graph, None, None, None, "16:9"))
        # 零动作:两口维持 8.25MP 帽
        self.assertEqual(graph["8100"]["inputs"]["megapixels"], 8.25)
        self.assertEqual(graph["8122"]["inputs"]["megapixels"], 8.25)

    def test_type_present_but_data_gap_blocks_aspect_fallback(self) -> None:
        # 1121 独孤实录根修(1120 晏燎案同族第二出口):带型注入而型画幅查不到
        # (装机 Resources 下仓内真源 json 进 asar,明文件层不可达+env 未设→
        # 两候选全空)——禁落 aspect 串(传输层缺省 "16:9" 会把 3:4 竖幅型
        # 锚成 8.2944MP 巨幅,引擎崩+sidecar 收摊+前端连接中断实录)。
        graph = self._t2i_graph()
        with patch.object(qwen21, "_daojie_type_canvas", return_value=None):
            self.assertFalse(qwen21.apply_wide_edge_anchor(
                graph, "无衣物定妆", None, None, "16:9"))
        # 零动作:两口维持 8.25MP 帽,未被覆写
        self.assertEqual(graph["8100"]["inputs"]["megapixels"], 8.25)
        self.assertEqual(graph["8122"]["inputs"]["megapixels"], 8.25)

    def test_generate_t2i_submits_anchored_mp(self) -> None:
        # generate 集成:t2i 设定卡(资产 16:9 型)全链后提交图两口=8.2944
        # (与 1118 碎格根修压幅/i2i 安全档共存;mock 取图非 PNG→终格 fail-open
        # 原样)。1121 分镜锚修:例型换设定卡(分镜域钉型画幅 2.3593,见分镜测试)
        submitted = {}
        # 照 Qwen21I2iGenerateTests._run_generate 同款 mock(t2i 无上传面)
        classes: set = set()
        for template in (qwen21.load_template(qwen21.TEMPLATE_NAME),
                         qwen21.load_template(qwen21.TEMPLATE_NAME_I2I)):
            classes.update(qwen21.graph_node_classes(template["graph"]))
        classes.update(qwen21.E_HYBRID_INJECTED_CLASSES)

        def http_json(method, url, payload=None, timeout=2):
            if url.endswith("/prompt"):
                submitted.update(payload["prompt"])
                return {"prompt_id": "p-edge"}
            if "/history/" in url:
                return {"p-edge": {"status": {"status_str": "success"}, "outputs": {
                    "8": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]},
                }}}
            raise AssertionError(url)

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch.object(
            qwen21, "_available_node_classes", return_value=frozenset(classes)
        ), patch.object(qwen21, "_http_json", side_effect=http_json), patch.object(
            qwen21, "_fetch_bytes", return_value=b"t2i-png"
        ), patch(
            "comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            result = qwen21.generate(
                prompt="设定卡主体句", aspect_ratio="16:9", negative_prompt=None,
                steps=8, seed=42, base_type="设定卡",
            )
        self.assertEqual(submitted["8100"]["inputs"]["megapixels"], 8.2944)
        self.assertEqual(submitted["8122"]["inputs"]["megapixels"], 8.2944)
        self.assertEqual(result, "dDJpLXBuZw==")  # 非 PNG 终格 fail-open 原样

    def test_generate_t2i_storyboard_pins_type_canvas(self) -> None:
        # 1121 分镜锚修集成:t2i 分镜剧情图全链后升档两口=型画幅 2.3593
        # (不进 3840 交付线);1MP 压缩口不动;终格微整不激活
        submitted = {}
        classes: set = set()
        for template in (qwen21.load_template(qwen21.TEMPLATE_NAME),
                         qwen21.load_template(qwen21.TEMPLATE_NAME_I2I)):
            classes.update(qwen21.graph_node_classes(template["graph"]))
        classes.update(qwen21.E_HYBRID_INJECTED_CLASSES)

        def http_json(method, url, payload=None, timeout=2):
            if url.endswith("/prompt"):
                submitted.update(payload["prompt"])
                return {"prompt_id": "p-sb"}
            if "/history/" in url:
                return {"p-sb": {"status": {"status_str": "success"}, "outputs": {
                    "8": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]},
                }}}
            raise AssertionError(url)

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch.object(
            qwen21, "_available_node_classes", return_value=frozenset(classes)
        ), patch.object(qwen21, "_http_json", side_effect=http_json), patch.object(
            qwen21, "_fetch_bytes", return_value=b"t2i-png"
        ), patch(
            "comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            qwen21.generate(
                prompt="分镜剧情图主体句", aspect_ratio="16:9", negative_prompt=None,
                steps=8, seed=42, base_type="分镜剧情图",
            )
        self.assertEqual(submitted["8100"]["inputs"]["megapixels"], 2.3593)
        self.assertEqual(submitted["8122"]["inputs"]["megapixels"], 2.3593)

    def test_final_anchor_resize_lanczos_to_exact(self) -> None:
        # ④格:3872×2176(多视图源出口)与 3840×2144(精确16:9源出口)均
        # lanczos 微整到精确 3840×2160 且保 RGBA(P3 出口恒 RGBA)
        import io
        from PIL import Image
        for w, h in ((3872, 2176), (3840, 2144)):
            src = Image.new("RGBA", (w, h), (120, 80, 200, 255))
            buf = io.BytesIO()
            src.save(buf, format="PNG")
            out = Image.open(io.BytesIO(qwen21.final_anchor_resize(buf.getvalue())))
            self.assertEqual(out.size, (3840, 2160))
            self.assertEqual(out.mode, "RGBA")

    def test_final_anchor_resize_already_exact_passthrough(self) -> None:
        # 已精确 3840×2160:字节原样返回(不重编码)
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGBA", (3840, 2160), (10, 20, 30, 255)).save(buf, format="PNG")
        raw = buf.getvalue()
        self.assertEqual(qwen21.final_anchor_resize(raw), raw)

    def test_final_anchor_resize_rejects_offspec(self) -> None:
        # 偏差>3% 禁欠终断:修生成侧,禁移动球门(3600×2000 高差 -7.4%)
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (3600, 2000), (0, 0, 0)).save(buf, format="PNG")
        with self.assertRaises(pipeline.PipelineError):
            qwen21.final_anchor_resize(buf.getvalue())

    def test_final_anchor_resize_non_wide_passthrough(self) -> None:
        # 非 16:9 出口(竖/方拦候裁线):原样放行交 output_gate 域分流
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (1536, 2048), (0, 0, 0)).save(buf, format="PNG")
        raw = buf.getvalue()
        self.assertEqual(qwen21.final_anchor_resize(raw), raw)


class Qwen21TypeRoutingTests(unittest.TestCase):
    """1120 型级加速路由定谳(十发三臂对拍,产物 qi21-routing-p4-1120):
    人物海报→native40(画质 8.6 碾压)/设定卡→官方Turbo 8步(文字生死线
    9/10)/人物多视图→PrunaAI 6步(性价比留守)。命名纪律:6步必带 PrunaAI
    前缀、8步必带官方Turbo 前缀。"""

    def _run_t2i(self, base_type: str) -> dict:
        submitted: dict = {}
        classes: set = set()
        for template in (qwen21.load_template(qwen21.TEMPLATE_NAME),
                         qwen21.load_template(qwen21.TEMPLATE_NAME_I2I)):
            classes.update(qwen21.graph_node_classes(template["graph"]))
        classes.update(qwen21.E_HYBRID_INJECTED_CLASSES)

        def http_json(method, url, payload=None, timeout=2):
            if url.endswith("/prompt"):
                submitted.update(payload["prompt"])
                return {"prompt_id": "p-route"}
            if "/history/" in url:
                return {"p-route": {"status": {"status_str": "success"}, "outputs": {
                    "8": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]},
                }}}
            raise AssertionError(url)

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch.object(
            qwen21, "_available_node_classes", return_value=frozenset(classes)
        ), patch.object(qwen21, "_http_json", side_effect=http_json), patch.object(
            qwen21, "_fetch_bytes", return_value=b"route-png"
        ), patch(
            "comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            qwen21.generate(prompt=f"{base_type}主体句", aspect_ratio="1:1",
                            negative_prompt=None, steps=8, seed=42, base_type=base_type)
        return submitted

    def test_poster_routes_native40(self) -> None:
        graph = self._run_t2i("人物海报")
        ks = graph["7500"]["inputs"]
        self.assertEqual((ks["steps"], ks["cfg"]), (40, 4.0))
        self.assertEqual(ks["model"], ["7:7034", 0])  # mikkoani 链
        self.assertEqual(graph["5"]["inputs"]["samples"], ["7500", 0])  # 旁路 speed

    def test_charcard_routes_turbo8(self) -> None:
        graph = self._run_t2i("设定卡")
        sel = graph["7:7015"]["inputs"]
        self.assertEqual(sel["mode"], "0 · Turbo 8步")
        self.assertEqual(sel["latent_turbo"], ["7:7131", 0])
        lora = graph["7:7128"]["inputs"]
        self.assertEqual(lora["lora_name"], "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors")
        self.assertEqual((lora["strength_model"], lora["model"]), (1.0, ["1", 0]))  # 直连底模
        self.assertEqual(graph["7:7129"]["inputs"]["conditioning"], ["4015", 0])     # 纯正向 cfg1
        self.assertEqual(len(graph["7:7130"]["inputs"]["sigmas"].split(",")), 9)     # 官方σ表
        sca = graph["7:7131"]["inputs"]
        self.assertEqual((sca["noise"], sca["latent_image"]), (["7:7017", 0], ["4", 0]))
        self.assertNotIn("7500", graph)

    def test_multiview_stays_pruna(self) -> None:
        graph = self._run_t2i("人物多视图")
        sel = graph["7:7015"]["inputs"]
        self.assertEqual(sel["mode"], "4 · PrunaAI 6步")
        self.assertNotIn("7500", graph)
        self.assertNotIn("7:7128", graph)
        self.assertEqual(graph["5"]["inputs"]["samples"], ["7:7015", 0])


class Qwen21I2iWideEdgeAnchorTests(unittest.TestCase):
    """1120 P4 i2i 分支边锚(与 t2i 对称接线的专项锁)。"""

    def test_i2i_wide_type_anchors_gem_mp(self) -> None:
        # i2i 带参考+16:9 型(场景 2048×1152):8100/8122 两口同覆 8.2944;
        # 与 1118 安全档压幅共存(压的是生成段 EmptyLatentImage,锚的是超分帽)
        submitted: dict = {}
        classes: set = set()
        for template in (qwen21.load_template(qwen21.TEMPLATE_NAME),
                         qwen21.load_template(qwen21.TEMPLATE_NAME_I2I)):
            classes.update(qwen21.graph_node_classes(template["graph"]))
        classes.update(qwen21.E_HYBRID_INJECTED_CLASSES)

        def http_json(method, url, payload=None, timeout=2):
            if url.endswith("/prompt"):
                submitted.update(payload["prompt"])
                return {"prompt_id": "p-i2i-edge"}
            if "/history/" in url:
                return {"p-i2i-edge": {"status": {"status_str": "success"}, "outputs": {
                    "8": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]},
                }}}
            raise AssertionError(url)

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch.object(
            qwen21, "_available_node_classes", return_value=frozenset(classes)
        ), patch.object(qwen21, "_http_json", side_effect=http_json), patch.object(
            qwen21, "_upload_image", return_value={"name": "ref.png"}
        ), patch.object(qwen21, "_fetch_bytes", return_value=b"i2i-png"
        ), patch(
            "comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            qwen21.generate(prompt="场景指令", aspect_ratio="1:1", negative_prompt=None,
                            steps=8, seed=42, reference_b64="cg==", base_type="场景")
        self.assertEqual(submitted["8100"]["inputs"]["megapixels"], 8.2944)
        self.assertEqual(submitted["8122"]["inputs"]["megapixels"], 8.2944)
