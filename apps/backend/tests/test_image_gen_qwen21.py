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
    / "backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json"
)
I2I_TEMPLATE_PATH = (
    REPO_ROOT
    / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json"
)
I2I_CANVAS_PATH = (
    REPO_ROOT
    / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
)


class Qwen21RegistrationTests(unittest.TestCase):
    def test_model_registered_with_service_layout(self) -> None:
        spec = model_cache.IMAGE_MODELS[qwen21.MODEL_NAME]
        self.assertEqual(qwen21.MODEL_NAME, "qwen-image-2-1")
        self.assertEqual(spec["layout"], "qwen21-viggle")
        self.assertIn("qwen21-viggle", pipeline._ENGINE_BY_LAYOUT)
        self.assertIs(pipeline._ENGINE_BY_LAYOUT["qwen21-viggle"], qwen21)

    def test_reference_supported_flags(self) -> None:
        # 10-19 图生图·道劫美术风格转换(D3):单参考放开(SUPPORTS_REFERENCE=True 走 i2i 分流),
        # 多参考仍关(恒单参考,--enable-ref3 语义不在本役)
        self.assertTrue(qwen21.SUPPORTS_REFERENCE)
        self.assertFalse(qwen21.SUPPORTS_MULTI_REFERENCE)


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
        # 现行 GUI/API 契约:ApiPE 装配、E 臂 40 步+LazyCache、SeedVR2 2K 超分在场;
        # 1101晚 用户令「混动不需要 turbo×1.0」:E 臂=mikkoani×0.8→7026 detail-fix×1.0,
        # 7:7028 turbo 装载件自 E-only 模板删除;1016 拆除的7027 Fix×0.5不得回灌。
        # 1101 Phase1 案B:E 尾 SCA 三件→单 KSampler [7:7045] cfg=4(模板随画布再生成)。
        classes = {node["class_type"] for node in self.template["graph"].values()}
        self.assertIn("MyQi21ApiPE", classes)
        self.assertIn("MyQi21DaojieBase", classes)
        self.assertIn("LazyCache", classes)  # 1101 默认档3:E 臂随模板物质化(Turbo 臂死枝被裁)
        self.assertIn("KSampler", classes)   # 1101 Phase1:E 尾=单 KSampler cfg4
        self.assertNotIn("BasicScheduler", classes)      # SCA σ表件随案B 退役
        self.assertNotIn("SamplerCustomAdvanced", classes)  # E-only 模板 SCA 已删
        self.assertNotIn("ViggleTurboLora", classes)
        self.assertNotIn("ViggleTurboSigmas", classes)
        self.assertIn("SeedVR2VideoUpscaler", classes)
        self.assertNotIn("7:7027", self.template["graph"])
        self.assertNotIn("7:7028", self.template["graph"])  # 1101晚 E 臂撤 turbo
        self.assertNotIn("7:7044", self.template["graph"])  # t2i 模板吃画布共享 7:7026
        for gone in ("7:7041", "7:7042", "7:7043", "7:7017", "7:7018"):
            self.assertNotIn(gone, self.template["graph"])  # SCA 三件/共享噪声采样件出 E-only 模板
        self.assertEqual(self.template["graph"]["7:7034"]["class_type"], "LoraLoaderModelOnly")
        style = self.template["graph"]["7:7034"]["inputs"]
        self.assertEqual(style["lora_name"], "qi21-mikkoani.safetensors")
        self.assertEqual(style["strength_model"], 0.8)
        self.assertEqual(style["model"], ["1", 0])
        self.assertEqual(self.template["graph"]["7:7026"]["class_type"], "LoraLoaderModelOnly")
        fix = self.template["graph"]["7:7026"]["inputs"]
        self.assertEqual(fix["lora_name"], "qwen2.1-detail-fix-2.0.safetensors")
        self.assertEqual(fix["strength_model"], 1.0)
        self.assertEqual(fix["model"], ["7:7034", 0])  # 1101晚 源自 mikkoani 直连(共享件随E入模)
        speed = self.template["graph"]["7:7015"]["inputs"]
        self.assertEqual(speed["mode"], "3 · 混动 40步+缓存")  # 1101 默认档3混动替换 Turbo
        self.assertEqual(speed["latent_e"], ["7:7045", 0])     # 1101 Phase1:E 尾 KSampler
        e_ks = self.template["graph"]["7:7045"]
        self.assertEqual(e_ks["class_type"], "KSampler")
        ks = e_ks["inputs"]
        self.assertEqual(ks["model"], ["7:7040", 0])
        self.assertEqual(ks["positive"], ["4015", 0])   # 装配正向出(t2i 域)
        self.assertEqual(ks["negative"], ["4015", 1])   # MyQi21FastEncode 负向出口(Q2/Q5)
        self.assertEqual(ks["latent_image"], ["4", 0])  # EmptyLatentImage(t2i 域)
        self.assertEqual(ks["seed"], ["7:7014", 0])     # seed 单源直连(1101 新增扇出)
        self.assertEqual((ks["steps"], ks["cfg"], ks["sampler_name"], ks["scheduler"], ks["denoise"]),
                         (40, 4.0, "euler", "simple", 1.0))
        self.assertIs(self.template['graph']['6:4013']['inputs']['AI扩写开关'], False)

    def test_seed_single_source(self) -> None:
        # seed 单源=PrimitiveInt(7:7014);1101 Phase1 起 E KSampler seed 直连它
        # (旧 7:7017 RandomNoise 消费线随 SCA 删出 E-only 模板);绑定必须指它
        self.assertNotIn("7:7017", self.template["graph"])
        e_seed = self.template["graph"]["7:7045"]["inputs"]["seed"]
        self.assertEqual(e_seed, ["7:7014", 0])
        binding = self.template["inputs"]["seed"]
        self.assertEqual((binding["node"], binding["field"]), ("7:7014", "value"))

    def test_engine_model_files_are_real_installed_names(self) -> None:
        # 幽灵文件名回归锁(int8_convrot/r128 从未安装,见 1005 记忆)
        self.assertEqual(self.template["graph"]["1"]["inputs"]["unet_name"], "qwen_image_2.1_bf16.safetensors")
        self.assertEqual(self.template["graph"]["2"]["inputs"]["clip_name"], "qwen3vl_8b_bf16_heretic.safetensors")
        lora = self.template["graph"]["7:7034"]["inputs"]["lora_name"]
        self.assertEqual(lora, "qi21-mikkoani.safetensors")
        self.assertEqual(
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
    qi21-道劫-i2i.json 展平生成;快照=画布现值锁——组装用途=自由出图、Turbo 8步、
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
        # references→[10].image(LoadImage 恰 1 个=激活槽 [10])
        references = inputs.get("references")
        self.assertIsInstance(references, list)
        self.assertEqual(len(references), 1)
        ref = references[0]
        self.assertEqual((ref["node"], ref["slot"], ref["field"]), ("10", 0, "image"))
        self.assertEqual(ref["class_type"], "LoadImage")
        load_images = sorted(key for key, node in self.graph.items() if node["class_type"] == "LoadImage")
        # selected_graph 按现画布旁路状态裁去第二/第三参考，保留第一参考与超分链。
        self.assertEqual(load_images, ["10"])
        self.assertEqual(self.graph["4015"]["inputs"]["images.image_1"], ["16", 0])
        self.assertNotIn("images.image_2", self.graph["4015"]["inputs"])
        self.assertNotIn("images.image_3", self.graph["4015"]["inputs"])
        self.assertIn("image", self.graph["10"]["inputs"])
        self.assertEqual(self.graph["504"]["class_type"], "SaveImage")
        self.assertIn("503:7401", self.graph)
        for absent in ("11", "12", "17", "505"):
            self.assertNotIn(absent, self.graph, absent)
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
        # 档位快照=档3混动(1101 默认替换 Turbo)
        self.assertEqual(self.graph["7:7015"]["inputs"]["mode"], "3 · 混动 40步+缓存")
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
        # seed 单源=PrimitiveInt(7:7014);1101 Phase2 起 E 尾=KSampler cfg4(seed 直连
        # 单源,旧 7:7017 RandomNoise 消费线随 SCA 删出 E-only 模板)
        self.assertNotIn("7:7017", self.graph)
        self.assertEqual(self.graph["7:7045"]["inputs"]["seed"], ["7:7014", 0])
        self.assertEqual(self.graph["7:7015"]["inputs"]["latent_e"], ["7:7045", 0])
        self.assertEqual(self.graph["7:7045"]["class_type"], "KSampler")
        self.assertEqual(self.graph["7:7045"]["inputs"]["cfg"], 4.0)


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
        # 单参考净化:[11]/[17] demo 链物理摘除+编码器 image_2 槽清空
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

    def test_i2i_rejects_multi_reference(self) -> None:
        from image_gen.pipeline import PipelineError

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch(
            "comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            with self.assertRaises(PipelineError) as caught:
                qwen21.generate(
                    "指令", "1:1", None, 8, None,
                    reference_b64="c2Vjb25kcmVm",
                    reference_images_b64=["cmVmMQ==", "cmVmMg=="],
                )
        self.assertEqual(caught.exception.code, "reference-unsupported")

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

    def test_hand_type_t2i_defaults_e_hybrid(self) -> None:
        # 1101 用户令:默认档3混动替换 Turbo——有手型与默认合一(E 臂随模板
        # 物质化,运行时补注=幂等零动作);1101 Phase1 案B:E 尾=单 KSampler cfg4
        graph, _, _ = self._run_generate(
            prompt="人物海报主体句", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            base_type="人物海报",
        )
        self.assertEqual(graph["7:7015"]["inputs"]["mode"], qwen21.SPEED_MODE_E_HYBRID)
        self.assertEqual(graph["7:7015"]["inputs"]["latent_e"], ["7:7045", 0])
        self.assertEqual(graph["7:7026"]["inputs"]["model"], ["7:7034", 0])  # 1101晚 撤 turbo→mikkoani 直连(共享件)
        self.assertEqual(graph["7:7026"]["inputs"]["lora_name"], "qwen2.1-detail-fix-2.0.safetensors")
        self.assertEqual(graph["7:7040"]["class_type"], "LazyCache")
        self.assertEqual(graph["7:7040"]["inputs"]["reuse_threshold"], 0.2)
        self.assertEqual(graph["7:7040"]["inputs"]["start_percent"], 0.15)
        self.assertEqual(graph["7:7040"]["inputs"]["end_percent"], 0.95)
        self.assertEqual(graph["7:7040"]["inputs"]["model"], ["7:7026", 0])
        self.assertEqual(graph["7:7045"]["class_type"], "KSampler")  # 1101 Phase1 案B
        ks = graph["7:7045"]["inputs"]
        self.assertEqual(ks["model"], ["7:7040", 0])
        self.assertEqual(ks["positive"], ["4015", 0])   # 装配正向出(t2i 域)
        self.assertEqual(ks["negative"], ["4015", 1])   # MyQi21FastEncode 负向出口
        self.assertEqual(ks["latent_image"], ["4", 0])  # t2i=EmptyLatentImage
        self.assertEqual(ks["seed"], ["7:7014", 0])     # seed 单源直连(新扇出)
        self.assertEqual((ks["steps"], ks["cfg"], ks["sampler_name"], ks["scheduler"], ks["denoise"]),
                         (40, 4.0, "euler", "simple", 1.0))
        for gone in ("7:7041", "7:7042", "7:7043"):
            self.assertNotIn(gone, graph)  # SCA 三件随案B 退役

    def test_hand_type_i2i_defaults_e_hybrid(self) -> None:
        # i2i 路(带参考图)同切:1101 Phase2 起 E 尾 KSampler 形随模板物质化
        # (运行时补注=幂等零动作);fix=i2i 自有 7044,正源=positive_single 单参考域
        graph, _, _ = self._run_generate(
            prompt="人物海报指令", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
            reference_b64="aWlpcmVmaW9uZQ==", base_type="人物海报",
        )
        self.assertEqual(graph["7:7015"]["inputs"]["mode"], qwen21.SPEED_MODE_E_HYBRID)
        self.assertEqual(graph["7:7015"]["inputs"]["latent_e"], ["7:7045", 0])
        self.assertEqual(graph["7:7045"]["class_type"], "KSampler")
        self.assertEqual(graph["7:7045"]["inputs"]["negative"], ["4015", 1])   # MyQi21FastEncode 负向出口
        self.assertEqual(graph["7:7045"]["inputs"]["positive"], ["171", 0])    # 单参考编码域(positive_single)
        self.assertEqual(graph["7:7045"]["inputs"]["model"], ["7:7040", 0])
        self.assertEqual(graph["7:7040"]["inputs"]["model"], ["7:7044", 0])    # i2i 自有 fix 件
        self.assertEqual(graph["7:7045"]["inputs"]["latent_image"], ["20", 0])  # 参考编码 latent 域([20] 画幅开关)
        self.assertEqual(graph["7:7045"]["inputs"]["seed"], ["7:7014", 0])     # seed 单源直连(新扇出)
        self.assertEqual((graph["7:7045"]["inputs"]["steps"], graph["7:7045"]["inputs"]["cfg"],
                          graph["7:7045"]["inputs"]["sampler_name"], graph["7:7045"]["inputs"]["scheduler"],
                          graph["7:7045"]["inputs"]["denoise"]), (40, 4.0, "euler", "simple", 1.0))
        for gone in ("7:7041", "7:7042", "7:7043", "7:7017", "7:7018"):
            self.assertNotIn(gone, graph)  # SCA 三件+共享噪声采样件出 E-only 模板

    def test_non_hand_types_default_e_hybrid(self) -> None:
        # 1101 用户令:默认档3混动替换 Turbo——非有手型走模板默认档3,
        # E 臂随模板物质化(运行时补注=幂等零动作;t2i 模板=KSampler 形)
        for base_type in ("道具", "人脸基准", "场景", None, "  "):
            graph, _, _ = self._run_generate(
                prompt=f"主体句{base_type}", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
                base_type=base_type,
            )
            self.assertEqual(graph["7:7015"]["inputs"]["mode"], "3 · 混动 40步+缓存", base_type)
            self.assertEqual(graph["7:7015"]["inputs"]["latent_e"], ["7:7045", 0], base_type)
            self.assertIn("7:7040", graph, base_type)  # LazyCache 臂在场

    def test_hand_speed_mode_fail_closed_on_missing_turbo_source(self) -> None:
        # 模板漂移防线:镜像源缺失→显式 bridge-template-missing,禁静默降级直出
        from image_gen.pipeline import PipelineError

        with self.assertRaises(PipelineError) as caught:
            qwen21.apply_hand_speed_mode({"7:7015": {"inputs": {}}}, "人物海报")
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
