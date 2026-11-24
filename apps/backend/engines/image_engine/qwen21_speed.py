"""qwen21_speed.py — Qwen-Image-2.1(qi21)加速档位与型级路由(1124 超线文件拆分:自 qwen21.py 原样搬出)。

档位常量(档3 混动/档4 PrunaAI)、型级路由名单、E 臂运行时补注、官方 Turbo 8 步臂、原生 40 步臂。
qwen21.py 经 from .qwen21_speed import … 使用;外部仍可经 qwen21.<名字> 访问(转出口保留)。
"""

from __future__ import annotations

from typing import Any
from .comfyui_bridge import _pipeline_error


# 10-26 用户裁定:有手型生图默认档3混动(其余型/缺省维持画布默认 Turbo,1021 令延续)。
# **1101 用户令:默认档3混动替换 Turbo(全型);1108 用户令:默认档4 PrunaAI 6步
# (全型)——画布/API 模板档位值已翻「4 · PrunaAI 6步」,有手型强制规则随默认
# 指向档4(1108 六车道实弹:Pruna+mikkoani 手部全绿,人物海报用户验收),保留为
# 冗余保险;档3 终态的 E 臂运行时补注路全保留(手切他档画布兼容)。**
# 依据=档位 A/B 实弹(apps/build/scripts/gear_ab_*_1026.py,9 发:Turbo 唯一重崩
# 指融合+剑柄穿模,混动 1绿1黄1红轻,原生 2绿1红最好但 ~5×耗时被裁定不用于默认)。
# 有手型=全身人物常态入画六型(手/剑高发);人脸基准(止颈特写)/场景三型/道具/表情差分
# 等无手或手部罕见型不切(1101 起这些型也走默认档3,经模板档位值而非强制规则)。
SPEED_MODE_E_HYBRID = "3 · 混动 40步+缓存"
# 1108 默认档:⑦Pruna 臂(p_q 6步v0.2×1.0+mikkoani@0.6,六步原表+关CFG);拉齐轮起三件(t2i/i2i/edit)通吃
SPEED_MODE_PRUNA = "4 · PrunaAI 6步"
# 有手型名单(10-26 立,1108 随默认指向档4;实测人物海报=虚握剑鞘手部全绿)
# 1120 型级路由定谳(十发三臂对拍,产物 qi21-routing-p4-1120):美宣+人物海报=
# 原生40步(海报 8.6 分碾压 pruna6 7.6,超分增益最大);设定卡=官方Turbo 8步
# (文字生死线 turbo8 9/10 vs native40 6/10 vs pruna6 3/10 乱码);人物多视图维持
# PrunaAI(7.8 vs 8.2 险差,6 步拿九成画质+版面最净=性价比);其余型不动。
_TYPE_NATIVE_40STEP = frozenset({"美宣", "人物海报"})  # 1119 美宣终裁;1120 海报入列
_TYPE_TURBO_8STEP = frozenset({"设定卡"})  # 1120 文字生死线定谳
_HAND_PRUNA_TYPES = frozenset({"无衣物定妆", "人物海报", "人物多视图", "设定卡", "美宣", "自由"})
# E 臂配方逐字对齐画布加速子图(my_nodes/subgraphs/qi21-道劫-加速子图*.json):
# 1101 Phase1 案B(用户选定):E 尾 SCA 三件(7041/7042/7043)→单 KSampler [7045] cfg=4
# ——模型链=mikkoani(7:7034)出→detailFix×1.0→7040 LazyCache(0.2/0.15/0.95)→7045
# KSampler(40步 cfg4 euler/simple;正负向/latent 内置,seed=7:7014 单源直连)。
# fix 件号随形:t2i 模板=画布共享 7:7026;i2i 模板=自有 7:7044(1101晚 撤 turbo 口径)。
# 前置实弹(1101 21:30 已毕):KSampler+LazyCache+cfg4 全兼容,S=0.331 色重完全消退。
# 历史账:1101晚 撤 turbo(7044 源 7028→7034;Win 实弹 45.6s→24.8s);charcard 采样段
# 的 Turbo LoRA 是另一管线(AICG3D,裸模+缓存=黑片已证伪),不在本令范围。
_DETAIL_FIX_LORA = "qwen2.1-detail-fix-2.0.safetensors"
_MIKKOANI_LORA_NODE = "7:7034"
_ENCODER_NODE = "4015"        # MyQi21FastEncode:槽0=正向/槽1=负向(负向出口=道劫负面基线)
_SEED_SOURCE_NODE = "7:7014"  # seed 单源(1101 Phase1 起 E KSampler 直连新扇出)
# 测试侧 mock 可用类集须并入(真实引擎 object_info 已含,模板类集不含——
# 旧模板漂移重注路运行时注入 LazyCache/KSampler;KSampler 为核心类,仅
# mock 类集面需要补,真实引擎零安装动作。1120:Turbo 臂注 ManualSigmas 同理)。
E_HYBRID_INJECTED_CLASSES = frozenset({"LazyCache", "BasicScheduler", "KSampler", "ManualSigmas"})


def _materialize_e_hybrid(graph: dict[str, Any]) -> None:
    """E 混动臂三件 KSampler 形运行时补注(1101 Phase1 案B:SCA 三件→单 KSampler cfg=4):
    API 桥模板按选中档物质化 E 臂,本补注器只对「未接线/旧形态」模板兜底——
    ①已物质化 KSampler 形(latent_e=["7:7045",0])→ 调用侧零动作(幂等);
    ②旧 SCA 形模板(latent_e=["7:7043",0])→ 重注 KSampler 形并拆除 7:7041/7:7042/
    7:7043 死件(视为模板漂移修复,禁新旧双采样双跑);
    ③未接线(旧-old Turbo-only 模板)→ 全量补注。
    模型链=mikkoani(7:7034)→detailFix×1.0(t2i 共享 7:7026/i2i 自有 7:7044)→
    7:7040 LazyCache→7:7045 KSampler(正=装配正向出镜像/负=[4015,1] MyQi21FastEncode
    负向出口/latent=随模板域镜像/seed=[7:7014] 直连,40步 cfg4 euler/simple)。
    镜像源缺任一=fail-closed(模板漂移须显式暴露,禁静默降级)。"""
    speed = graph.get("7:7015")
    mikko_lora = graph.get(_MIKKOANI_LORA_NODE)
    if not (isinstance(speed, dict) and isinstance(mikko_lora, dict)):
        raise _pipeline_error(
            "bridge-template-missing",
            "桥模板缺 E 臂源节点(7:7015/7:7034),无法补注 E 混动臂",
        )
    if not (isinstance(graph.get(_ENCODER_NODE), dict)
            and isinstance(graph.get(_SEED_SOURCE_NODE), dict)):
        raise _pipeline_error(
            "bridge-template-missing",
            f"桥模板缺 E 臂负向/seed 源节点({_ENCODER_NODE}/{_SEED_SOURCE_NODE}),无法补注",
        )
    # 正源/latent 逐槽镜像现图 E 臂(优先旧 SCA 形 guider/SCA;更旧 Turbo 臂兜底;
    # 1119 修:v2 架构 turbo 路 BasicGuider/SamplerCustomAdvanced 等价槽 fallback)
    def _mirror(node_id: str, slot: str) -> Any:
        node = graph.get(node_id)
        return node.get("inputs", {}).get(slot) if isinstance(node, dict) else None
    conditioning = (_mirror("7:7042", "conditioning")
                    or _mirror("7:7029", "conditioning")
                    or _mirror("7:7111", "conditioning"))
    latent_image = (_mirror("7:7043", "latent_image")
                    or _mirror("7:7031", "latent_image")
                    or _mirror("7:7112", "latent_image"))
    if not isinstance(conditioning, list) or not isinstance(latent_image, list):
        raise _pipeline_error(
            "bridge-template-missing",
            "桥模板缺 E 臂正源/latent 镜像槽(7:7042/7:7043 或旧 Turbo 臂),无法补注",
        )
    # fix 件号随形:t2i=共享 7:7026(在册即复用);i2i=自有 7:7044;更旧模板按域标
    # (i2i 画幅建议器在装配子图内=6:4018;t2i=根 4018)新立
    if isinstance(graph.get("7:7026"), dict):
        fix_node = "7:7026"
    elif isinstance(graph.get("7:7044"), dict):
        fix_node = "7:7044"
    elif "6:4018" in graph:
        fix_node = "7:7044"
    else:
        fix_node = "7:7026"
    graph[fix_node] = {"class_type": "LoraLoaderModelOnly", "inputs": {
        "lora_name": _DETAIL_FIX_LORA, "strength_model": 1.0,
        "model": [_MIKKOANI_LORA_NODE, 0]}}
    graph["7:7040"] = {"class_type": "LazyCache", "inputs": {
        "model": [fix_node, 0], "reuse_threshold": 0.2, "start_percent": 0.15,
        "end_percent": 0.95, "verbose": False}}
    graph["7:7045"] = {"class_type": "KSampler", "inputs": {
        "model": ["7:7040", 0], "positive": conditioning,
        "negative": [_ENCODER_NODE, 1], "latent_image": latent_image,
        "seed": [_SEED_SOURCE_NODE, 0], "steps": 40, "cfg": 4.0,
        "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
    for dead in ("7:7041", "7:7042", "7:7043"):
        graph.pop(dead, None)  # 旧 SCA 形死件拆除(禁双采样双跑)
    speed["inputs"]["latent_e"] = ["7:7045", 0]


def apply_hand_speed_mode(graph: dict[str, Any], base_type: Any,
                           hand_default: str = SPEED_MODE_PRUNA) -> None:
    """1108 拉齐泛化(1101 前史:默认档3混动替换 Turbo):
    ①有手型(10-26 名单)→ 强制 mode=hand_default——三件均=档4 PrunaAI(1108 拉齐令,
    ⑦臂已铺 t2i/i2i/edit;六车道实弹手部全绿);
    ②终态 mode==档3 且 latent_e 未物质化 KSampler 形态 → 运行时补注(幂等——
    已物质化 ["7:7045",0] 零动作;旧 SCA 形 ["7:7043",0] 视为模板漂移重注)。
    非档3 终态(调用方显式改派他档)零动作照旧。
    镜像源缺任一=fail-closed(模板漂移须显式暴露,禁静默降级)。"""
    speed = graph.get("7:7015")
    # 1108:有手型 → 强制 hand_default(t2i=档4 PrunaAI;i2i=档3 混动)
    if isinstance(speed, dict) and isinstance(base_type, str) and base_type.strip() in _HAND_PRUNA_TYPES:
        speed.setdefault("inputs", {})["mode"] = hand_default
    if not (isinstance(speed, dict) and isinstance(speed.get("inputs", {}).get("mode"), str)
            and speed["inputs"]["mode"] == SPEED_MODE_E_HYBRID):
        # 1119 美宣终裁:原生40步覆写(在档3检查之前,优先级最高);
        # 1120 型级路由:native40 > turbo8 > hand_default(设定卡走官方Turbo臂)
        if isinstance(base_type, str) and base_type.strip() in _TYPE_NATIVE_40STEP:
            _apply_native_40step(graph)
        elif isinstance(base_type, str) and base_type.strip() in _TYPE_TURBO_8STEP:
            _apply_turbo_8step(graph)
        return
    if speed["inputs"].get("latent_e") == ["7:7045", 0]:
        return  # 已物质化 KSampler 形(1101 Phase1 幂等)
    _materialize_e_hybrid(graph)


_TURBO_LORA_FILE = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"
# 官方 Turbo σ表(画布件 [7030] widgets 逐字镜像;9 值=8 步)
_TURBO_SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"


def _apply_turbo_8step(graph: dict[str, Any]) -> None:
    """1120 型级路由:设定卡=官方Turbo 8步(文字生死线对拍定谳)。配方=画布
    加速子图 [7028]-[7031] 真身镜像:r178 LoRA×1.0 直连底模→BasicGuider cfg1
    纯正向→ManualSigmas 官方σ表→SamplerCustomAdvanced;噪声/采样器共享
    7:7017/7:7018,latent=[4]。新键 7:7128-31(模板恒缺,防撞);speed 节点
    mode 切「0 · Turbo 8步」+latent_turbo 接线。镜像源缺=fail-closed。"""
    for nid in ("7:7017", "7:7018", "7:7015", "7:7112"):
        if not isinstance(graph.get(nid), dict):
            raise _pipeline_error(
                "bridge-template-missing",
                f"桥模板缺 Turbo 臂共享源节点({nid}),无法注臂",
            )
    latent = graph["7:7112"]["inputs"].get("latent_image")  # t2i=[4]/i2i=[20] 域随形
    if not isinstance(latent, list):
        raise _pipeline_error(
            "bridge-template-missing",
            "桥模板缺 Turbo 臂 latent 镜像槽(7:7112.latent_image),无法注臂",
        )
    graph["7:7128"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
        "lora_name": _TURBO_LORA_FILE, "strength_model": 1.0, "model": ["1", 0]}}
    graph["7:7129"] = {"class_type": "BasicGuider", "inputs": {
        "model": ["7:7128", 0], "conditioning": ["4015", 0]}}
    graph["7:7130"] = {"class_type": "ManualSigmas", "inputs": {"sigmas": _TURBO_SIGMAS}}
    graph["7:7131"] = {"class_type": "SamplerCustomAdvanced", "inputs": {
        "noise": ["7:7017", 0], "guider": ["7:7129", 0],
        "sampler": ["7:7018", 0], "sigmas": ["7:7130", 0],
        "latent_image": latent}}
    speed = graph["7:7015"]
    speed.setdefault("inputs", {})["mode"] = "0 · Turbo 8步"
    speed["inputs"]["latent_turbo"] = ["7:7131", 0]


def _apply_native_40step(graph: dict[str, Any], multiref: bool = False) -> None:
    """1119 用户终裁:美宣=原生40步(1120 人物海报入列)。绕过加速子图,直注 KSampler(cfg4/40步)。
    1120 多图令:multiref=True 正源显式=多参考编码器[4015]槽0——镜像路=[171]单图域
    看不见 image_2/3,少步×多参考=黑屏域(0928/1014 铁案);[4015] positive 在 API
    模板零消费者=i2i 多图默认不生效的根,本参数补通(7500 同键覆写=幂等)。"""
    cond = ["4015", 0] if multiref else None; latent = None
    if cond is None:  # 显式多参考正源跳过镜像(镜像路=[171]单图域)
        for nid in ("7:7111", "7:7042", "7:7029"):
            n = graph.get(nid)
            if isinstance(n, dict):
                cond = n.get("inputs", {}).get("conditioning")
                if isinstance(cond, list):
                    break
    for nid in ("7:7112", "7:7043", "7:7031"):
        n = graph.get(nid)
        if isinstance(n, dict):
            latent = n.get("inputs", {}).get("latent_image")
            if isinstance(latent, list):
                break
    if not isinstance(cond, list) or not isinstance(latent, list):
        return
    graph["7500"] = {"class_type": "KSampler", "inputs": {
        "model": [_MIKKOANI_LORA_NODE, 0],
        "positive": cond, "negative": [_ENCODER_NODE, 1],
        "latent_image": latent, "seed": [_SEED_SOURCE_NODE, 0],
        "steps": 40, "cfg": 4.0,
        "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
    if isinstance(graph.get("5"), dict):
        graph["5"]["inputs"]["samples"] = ["7500", 0]
