"""Qwen-Image-2.1(qi21)文生图/图生图引擎模块——经自管 ComfyUI 引擎执行。

复用 comfyui_bridge 的提交/轮询/取图机制,模板=qwen21_道劫_t2i_api
(qi21-道劫-t2i.json 工作流本体按 fire 展平逻辑生成:装配子图[6] ApiPE 双链回落
+加速子图[7] 默认官方 Turbo 8步(LoRA×1.0、官方 sigma、BasicGuider)
+SeedVR2 2K 超分双产物;生成器=
apps/build/scripts/qwen21_bridge_template_build.py,型/档随画布现值)。
10-19 图生图·道劫美术风格转换:带参考图走 qwen21_道劫_i2i_api(qi21-道劫-i2i.json 展平;
1116 §五.4 三槽手术:模板常驻原生三参考链 [10]/[16]+[11]/[17]+[12]/[18]→4015
images.image_1/2/3,不足三张由桥按张数剪链;快照=画布现值,运行时覆写 6:4011 组装用途=
道劫美术风格转换——底座由装配层自动追加;seed 每次随机,fire 铁令);无参考走原 t2i 路
(逐字节不变)。
10-22 图生图·型层注入:ctx 带 base_type 时 i2i 路切「道劫美术类型」全拼档——
apply_base_type 注 6:4010 型选择,6:4011/6:4022 组装用途同覆写(4022=画幅路由,
型画幅 vs 参考画幅),RGBA 由 6:180 连线 6:4010 自动跟型;首用例=角色弹窗表情差分。
"""
from __future__ import annotations

import base64
import json
import math
import os
import random
import time
import uuid
from pathlib import Path
from typing import Any
from urllib import parse
from urllib.parse import urlencode

from .comfyui_bridge import (
    _available_node_classes,
    _fetch_bytes,
    _history_output,
    _http_json,
    _pipeline_error,
    _upload_image,
    _warn_if_version_below_min,
    bridge_url,
    curated_node_class_packs,
    graph_node_classes,
    instantiate_template,
    load_template,
    missing_nodes_message,
)

MODEL_NAME = "qwen-image-2-1"
LAYOUT = "qwen21-viggle"
SUPPORTS_REFERENCE = True
# 1116 分镜正典线(§五.4 七刀):i2i 原生三参考放开(槽位=image_1 主角立绘/
# image_2 场景/image_3 前帧或次角色,prd §4.5;>3 张由 generate 内拒)
# 1120 多图令:≥2 张参考恒原生40步(正源=[4015]槽0,快档单图域装不下多图;
# 见 generate 参考分支与 _apply_native_40step(multiref=True))
SUPPORTS_MULTI_REFERENCE = True

SPEC = {
    "label": "Qwen-Image-2.1",
    "repo_id": "ComfyUI 服务(本机)",
    "repo_ids": ("ComfyUI 服务(本机)",),
    "size_mb": 0,
    "license": "本机 ComfyUI 配置",
    "steps": 6,
    "description": "本地 Qwen-Image-2.1 生图(道劫产线工作流:默认档4 PrunaAI 6步+mikkoani+SeedVR2 2K 超分,1108 三件拉齐;图生图=道劫美术风格转换)",
    "layout": LAYOUT,
}

TEMPLATE_NAME = "qwen21_道劫_t2i_api"
TEMPLATE_NAME_I2I = "qwen21_道劫_i2i_api"
ASSEMBLY_PURPOSE_STYLE_TRANSFER = "道劫美术风格转换"
# 10-22 i2i 型层注入路(表情差分首用例):带 base_type 即切全拼档
# (参考图锚身份+型文全拼+型负面 merge+RGBA 跟型+型画幅路由)。
ASSEMBLY_PURPOSE_TYPE_FULL = "道劫美术类型"

ASPECT_RATIOS = {
    # 10-19 用户令「图生图 size 不低于 1K」:短边恒 ≥1024;16:9 取 t2i 多视图
    # 同款 1824×1024,其余按比例推至短边 1024(全表 8 对齐)
    "1:1": (1024, 1024), "16:9": (1824, 1024), "9:16": (1024, 1824),
    "4:3": (1360, 1024), "3:4": (1024, 1360),
}


def resolve_big_files(models_dir: Path | None = None, cache_dir: Path | None = None) -> dict[str, Any] | None:
    from .comfyui_bridge import resolve_big_files as _bridge_resolve

    return _bridge_resolve(models_dir, cache_dir)


def find_cached(models_dir: Path | None = None, cache_dir: Path | None = None) -> dict[str, Any] | None:
    stats = resolve_big_files()
    if not stats:
        return None
    host = parse.urlparse(bridge_url()).netloc
    return {"repo_id": f"comfyui-service:{host}", "cache_dir": stats["cache_dir"], "repo_cache_dir": stats["cache_dir"], "size_mb": 0}


def small_pieces_status(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    try:
        load_template(TEMPLATE_NAME)
        return {"ready": True, "missing": [], "snapshot_dirs": {}}
    except Exception:
        return {"ready": False, "missing": [TEMPLATE_NAME], "snapshot_dirs": {}}


def fetch_small_pieces(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return small_pieces_status()



def _prefer_upscaled_output(history: dict[str, Any], prompt_id: str) -> tuple[str, dict[str, Any] | None]:
    """道劫工作流双产物:优先 SeedVR2 2K(SaveImage 504),回落基础图(SaveImage 8)。"""
    entry = history.get(prompt_id)
    if not isinstance(entry, dict):
        return "pending", None
    status = entry.get("status", {})
    state = status.get("status_str")
    if state == "error":
        detail = str(status.get("messages", "ComfyUI 执行失败"))[:500]
        raise _pipeline_error("bridge-execution-failed", f"ComfyUI 执行失败: {detail}")
    if state != "success":
        return "pending", None
    outputs = entry.get("outputs", {})
    for node_id in ("504", "8"):
        images = outputs.get(node_id, {}).get("images", []) if isinstance(outputs.get(node_id), dict) else []
        if images:
            return "success", images[0]
    return "success", None


def apply_base_type(graph: dict[str, Any], base_type: Any) -> None:
    """调用方显式点名型(如分镜调用传「分镜」)时覆写装配子图[6]的型选择;
    非法类型由 ComfyUI 的 COMBO 校验拒单兜底。缺省不动的=模板里画布现值。"""
    if isinstance(base_type, str) and base_type.strip():
        graph["6:4010"]["inputs"]["base"] = base_type.strip()


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


def apply_manual_size(graph: dict[str, Any], width: Any, height: Any) -> None:
    """画幅手动覆写(10-26 用户裁定:人物海报横竖皆可——bases 型画幅仅为缺省,
    调用方可点名横幅/竖幅)。命中图内 MyQi21WhSuggest(t2i=[4018]/i2i=[6:4018],
    按类找不钉节点号)写手动宽/高;值取 8 倍数对齐节点契约;非正/缺省零动作=
    跟型(九型直通)。"""
    try:
        w = int(width) if width is not None else 0
        h = int(height) if height is not None else 0
    except (TypeError, ValueError):
        return
    if w <= 0 or h <= 0:
        return
    w -= w % 8
    h -= h % 8
    if w <= 0 or h <= 0:
        return
    for node in graph.values():
        if isinstance(node, dict) and node.get("class_type") == "MyQi21WhSuggest":
            node.setdefault("inputs", {})["手动宽"] = w
            node["inputs"]["手动高"] = h


# ── 1118 超原生网格伪影根修(i2i 带参考画幅安全档)──────────────────────────
# 分辨弹四发定谳(同 seed/参考/提示词控变量):QwenImage2.1 参考编辑路(i2i)
# 目标画幅超原生(>~1.4MP)时背景整片 voronoi 碎格化(黑描边+高饱和撞色)——
# 1536×2048 必碎/1024×1344 与 896×1184 干净/文生图 3.15MP 无参考不碎(纯
# t2i 路不受限,勿动)。修法=1117 用户令「大图=1MP 甜点+件内超分拨大」正典:
# 生成段压回安全档,大图由件内 Gem② 分块超分链恒出 8.25MP(4K帽,逐边ceil无对齐,
# 16:9→3830×2155;链对入口画幅无感,1118末 4K帽令 10→8.25)——压幅不缩交付(桥
# _prefer_upscaled_output
# 优先取 [504] 超分产物)。
_I2I_REF_SAFE_MP = 1.25


def _daojie_type_canvas(base_type: str) -> tuple[int, int] | None:
    """qi21_bases.json 型画幅两出:resolution_override 直出,缺则
    aspect_ratio×megapixels 公式自算(口径=引擎侧 my_qi21_base._width_height_of/
    native_px:MP 按 1024² 计,边长 8 对齐;此处只供压幅判定用,取整差异无碍)。
    解析链=MYSTUDIO_DAOJIE_DATA env → 仓内真源(engine_manager 同款路径);
    表缺/型不在册/数据非法=None(fail-open:调用方跳过压幅,回退型画幅旧行为)。"""
    candidates: list[Path] = []
    env_home = os.environ.get("MYSTUDIO_DAOJIE_DATA")
    if env_home:
        candidates.append(Path(env_home))
    candidates.append(Path(__file__).resolve().parents[3]
                      / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json")
    for home in candidates:
        try:
            data = json.loads((home / "qi21_bases.json").read_text(encoding="utf-8"))
            entries = data.get("types", []) if isinstance(data, dict) else []
        except (OSError, ValueError):
            continue
        for entry in entries:
            if not (isinstance(entry, dict) and entry.get("zh") == base_type):
                continue
            override = entry.get("resolution_override")
            if (isinstance(override, (list, tuple)) and len(override) == 2
                    and all(isinstance(v, int) and not isinstance(v, bool) and v > 0
                            for v in override)):
                return int(override[0]), int(override[1])
            try:
                aw_s, ah_s = str(entry.get("aspect_ratio") or "").strip().split()[0].split(":")
                aw, ah = float(aw_s), float(ah_s)
                mp = float(entry.get("megapixels"))
            except (IndexError, TypeError, ValueError):
                return None
            if aw <= 0 or ah <= 0 or mp <= 0:
                return None
            edge = math.sqrt(1024 * 1024 * mp)
            return int(round(edge * aw / ah / 8)) * 8, int(round(edge * ah / aw / 8)) * 8
    return None


def apply_ref_safe_canvas(graph: dict[str, Any], base_type: Any,
                          manual_width: Any, manual_height: Any) -> None:
    """i2i 参考图在场 + 型层注入路(TYPE_FULL 型画幅)时:有效画幅(手动成对值
    优先 > 型画幅)超安全档则按**原纵横比**压回 ≤_I2I_REF_SAFE_MP,以字面量
    注入 EmptyLatentImage(替换 [6:4018] WhSuggest 连线——其短边≥1024 地板
    在 16:9 下压不进安全档)。≤安全档零动作(型画幅/手动语义原样,如 道具
    1:1 1MP);表缺/型不在册/数据非法零动作(fail-open 回退旧行为)。手动值
    成对才作数(WhSuggest 同款纪律,半填=交给 WhSuggest 中文报错)。"""
    try:
        mw = int(manual_width) if manual_width is not None else 0
        mh = int(manual_height) if manual_height is not None else 0
    except (TypeError, ValueError):
        mw = mh = 0
    if mw > 0 and mh > 0:
        eff_w, eff_h = mw, mh
    else:
        if not (isinstance(base_type, str) and base_type.strip()):
            return
        dims = _daojie_type_canvas(base_type.strip())
        if dims is None:
            return
        eff_w, eff_h = dims
    cap_px = _I2I_REF_SAFE_MP * 1_000_000
    if eff_w <= 0 or eff_h <= 0 or eff_w * eff_h <= cap_px:
        return
    scale = math.sqrt(cap_px / (eff_w * eff_h))
    w32 = max(int(eff_w * scale) // 32 * 32, 64)
    h32 = max(int(eff_h * scale) // 32 * 32, 64)
    for node in graph.values():
        if isinstance(node, dict) and node.get("class_type") == "EmptyLatentImage":
            node.setdefault("inputs", {})["width"] = w32
            node["inputs"]["height"] = h32
            return


# ── 1120 P4 边长锚+终格断言(trellis 11-19 四格蓝图③④格)──────────────────
# Gem② 链出口尺寸=GemTiledUpscale 的 megapixels 单口(引擎侧 _gem_megapixel_size
# 比例误差优先枚举+32 对齐+面积禁欠):8.25MP 时 16:9(2048×1152 源)出口
# 3808×2144,离恒宽 3840 交付线差 -0.84%。本节=16:9 交付线边锚:按有效画幅算
# MP 覆写 8100/8122(边长锚经 MP 数学等价,出口恒宽≥3840)+取图后 lanczos
# 终格微整到精确 3840×2160(边偏差≤3% 才整,禁欠终断;比例门复核不过=上游
# 异常,原样放行交 output_gate 域分流)。竖/方型=用户既定裁定「非 16:9 资产
# 图默认拦候裁」(frontier#1):不覆写不微整,只打点。规格只锚产线自身口径
# (恒宽 3840),与下游平台无涉。
_EDGE_ANCHOR_W = 3840
_EDGE_ANCHOR_H = 2160
# 1121 分镜锚修:分镜域型(base_type)集合——双用降级裁定下分镜图=首帧/参考
# 物料,不进资产 3840 交付线;型册 resolution_override(2048×1152)=分镜自册
# 规格(在役 19 张 1920×1088 同档)。P4 边锚曾把全 16:9 族(含分镜剧情图)
# 推到 8.2944MP×原生40步多参考=25min/张(1121 镜3 两发实录,900s 必超时
# 被撤);分镜域改钉型画幅 MP,升档口只有超标者被压,1MP 参考压缩口不动。
_STORYBOARD_BASE_TYPES = frozenset({"分镜剧情图"})
_EDGE_RATIO_TOL = 0.02   # 16:9 族容差核(罩 1824×1024 +0.2% ~ 1344×768 -1.6%)
_EDGE_FINAL_TOL = 0.03   # 终格微整门(蓝图终裁 3% 容差,与 alpha 门同位)


def ratio_gate(w: int, h: int) -> bool:
    """16:9 族容差核(交付线先行门)。竖/方(道具/海报/人脸族)=拦候裁。"""
    if w <= 0 or h <= 0:
        return False
    return abs(w / h - 16 / 9) / (16 / 9) <= _EDGE_RATIO_TOL


def edge_anchor_mp(w: int, h: int) -> float:
    """恒宽边锚 MP:宽 3840 数学等价的兆像素(16:9=3840×2160→8.2944;
    GemTiledUpscale 只吃 MP 单口,边长锚经此数学等价,出口恒宽≥3840)。"""
    return _EDGE_ANCHOR_W * (_EDGE_ANCHOR_W * h / w) / 1e6


def _edge_canvas(base_type: Any, manual_width: Any, manual_height: Any,
                 aspect_ratio: Any,
                 ref_dims: tuple[int, int] | None = None) -> tuple[int, int] | None:
    """有效画幅(比例门判据):手动成对值 > 型画幅 > 参考图实幅(i2i)。
    解析不出=None(门不过零动作)。1120 高清人脸崩图根修:i2i 无型层任务的输出
    画幅跟参考图走,App 传输层缺省 aspect="16:9" 会骗过 16:9 族门(晏燎 3:4
    参考实录)——参考实幅必须位阶高于 aspect 串,竖/方参考正确落拦候裁。
    1121 aspect 串兜底位阶整段退役(第三出口):无型无参考无手动的 t2i,
    传输层(ai-sdk-bridge)对未指定画幅恒发缺省 "16:9"——伪信号曾三次把非
    16:9 任务锚成 8.2944MP 巨幅拉爆引擎(晏燎 i2i/独孤带型断层/风格转换);
    16:9 交付线正主=分镜域(base_type=分镜剧情图,型画幅锚),aspect 兜底
    无正主,禁再当判据。"""
    try:
        mw = int(manual_width) if manual_width is not None else 0
        mh = int(manual_height) if manual_height is not None else 0
    except (TypeError, ValueError):
        mw = mh = 0
    if mw > 0 and mh > 0:
        return mw, mh
    if isinstance(base_type, str) and base_type.strip():
        dims = _daojie_type_canvas(base_type.strip())
        if dims is not None:
            return dims
        # 1121 独孤无衣物定妆实录根修(1120 晏燎案同族第二出口):带型注入而
        # 型画幅查不到=daojie 数据可达性断裂(装机 Resources 下仓内真源 json
        # 打进 asar,明文件层不存在;env 候选未设→两候选全空)——若落 aspect
        # 串(传输层缺省 "16:9")则 3:4 竖幅型被锚成 8.2944MP 巨幅,引擎崩+
        # sidecar 收摊+前端「连接中断」。数据断层禁猜画幅:直接拦(锚零动作
        # fail-open 本位),打点供观测。
        print(f"[image-sidecar] qwen21: P4边锚拦数据断层(base_type={base_type.strip()} "
              f"型画幅不可达,禁落 aspect 串,零动作)", flush=True)
        return None
    if ref_dims is not None and ref_dims[0] > 0 and ref_dims[1] > 0:
        return ref_dims
    return None


def _b64_image_dims(image_b64: str) -> tuple[int, int] | None:
    """参考图实幅(i2i 比例门判据用):PIL 头部惰性读宽高,坏图/解码失败=None。"""
    try:
        import io as _io

        from PIL import Image

        with Image.open(_io.BytesIO(base64.b64decode(image_b64))) as im:
            w, h = im.size
        return (w, h) if w > 0 and h > 0 else None
    except Exception:  # noqa: BLE001 - 判据缺位=门回退 aspect 串,不拦产线
        return None


def apply_wide_edge_anchor(graph: dict[str, Any], base_type: Any,
                           manual_width: Any, manual_height: Any,
                           aspect_ratio: Any,
                           ref_dims: tuple[int, int] | None = None) -> bool:
    """P4 ③格:16:9 族比例门过→GemTiledUpscale+ImageScaleToTotalPixels 的
    megapixels 覆写为边锚 MP(两口同值等比,保 alpha 链与主链同构——join 内
    resize_mask 会把 alpha resample 到主链尺寸,覆写不破坏 join 恒稳);门
    不过(竖/方候裁/解析不出)零动作 fail-open+打点。返回=终格微整是否激活。"""
    dims = _edge_canvas(base_type, manual_width, manual_height, aspect_ratio, ref_dims)
    if isinstance(base_type, str) and base_type.strip() in _STORYBOARD_BASE_TYPES:
        # 1121 分镜锚修(见 _STORYBOARD_BASE_TYPES 头注):Gem/升档口钉型画幅
        # MP,终格微整不激活(3840 交付线与分镜域无涉);参考压缩口(1MP 档)
        # 当前值低于目标=零动作。装机侧 daojie 数据断层(型画幅 JSON 在 asar
        # 内不可达,_edge_canvas=None/P4 已拦零动作)时分镜域用自册默认画幅
        # 兜底——分镜锚修不依赖数据可达性(零动作=8.25MP 巨幅慢炸,0731 实弹)。
        if dims is None:
            dims = (2048, 1152)
        target_mp = round(dims[0] * dims[1] / 1_000_000, 4)
        touched = 0
        for node in graph.values():
            if not (isinstance(node, dict)
                    and node.get("class_type") in ("GemTiledUpscale", "ImageScaleToTotalPixels")):
                continue
            inputs = node.setdefault("inputs", {})
            try:
                current_value = float(inputs.get("megapixels"))
            except (TypeError, ValueError):
                continue
            if current_value > target_mp:
                inputs["megapixels"] = target_mp
                touched += 1
        if touched:
            print(f"[image-sidecar] qwen21: 分镜锚修 {touched} 口 megapixels={target_mp}"
                  f"(分镜域钉型画幅 {dims[0]}×{dims[1]},不进3840交付线)", flush=True)
        return False
    if dims is None:
        return False
    if not ratio_gate(*dims):
        print(f"[image-sidecar] qwen21: P4边锚拦候裁(非16:9族画幅 "
              f"{dims[0]}×{dims[1]},维持 8.25MP 帽)", flush=True)
        return False
    mp = round(edge_anchor_mp(*dims), 4)
    touched = 0
    for node in graph.values():
        if isinstance(node, dict) and node.get("class_type") in (
                "GemTiledUpscale", "ImageScaleToTotalPixels"):
            node.setdefault("inputs", {})["megapixels"] = mp
            touched += 1
    if touched:
        print(f"[image-sidecar] qwen21: P4边锚覆写 {touched} 口 megapixels={mp}"
              f"(16:9族 {dims[0]}×{dims[1]},出口恒宽≥3840)", flush=True)
    return touched > 0


def final_anchor_resize(content: bytes) -> bytes:
    """P4 ④格:终格微整+禁欠终断——lanczos 到精确 3840×2160;边偏差≤3% 才整,
    超容差 raise(产物不符规格修生成侧,禁移动球门);比例门复核不过/解码失败
    =原样返回(非 16:9 交付线与坏产物由 output_gate 域分流兜底)。"""
    try:
        from PIL import Image
    except ImportError:
        return content
    import io as _io
    try:
        image = Image.open(_io.BytesIO(content))
        w, h = image.size
    except Exception:
        return content
    if not ratio_gate(w, h):
        return content
    deviation = max(abs(w - _EDGE_ANCHOR_W) / _EDGE_ANCHOR_W,
                    abs(h - _EDGE_ANCHOR_H) / _EDGE_ANCHOR_H)
    if deviation > _EDGE_FINAL_TOL:
        raise _pipeline_error(
            "bridge-output-offspec",
            f"超分出口 {w}×{h} 偏离 3840×2160 交付线 {deviation:.1%}(容差 3%),"
            "禁欠不交——请检查 Gem 链 megapixels 口",
        )
    if (w, h) == (_EDGE_ANCHOR_W, _EDGE_ANCHOR_H):
        return content
    resized = image.convert("RGBA").resize((_EDGE_ANCHOR_W, _EDGE_ANCHOR_H), Image.LANCZOS)
    buffer = _io.BytesIO()
    resized.save(buffer, format="PNG")
    return buffer.getvalue()


def _embed_prompt_metadata(png_bytes: bytes, graph: dict[str, Any]) -> bytes:
    """1120 图↔词溯源:把实发 API 形工作流 JSON 写进 PNG tEXt(keyword=prompt),
    复刻 ComfyUI SaveImage 元数据约定——sidecar 路产物缺该块导致实发终稿弹窗
    no-texr(1120 用户实录)。幂等:已带 prompt 块原样返回;任何异常原样返回
    (观测埋点不阻断产线)。"""
    try:
        import io as _io

        from PIL import Image
        from PIL.PngImagePlugin import PngInfo

        png = Image.open(_io.BytesIO(png_bytes))
        if "prompt" in (png.info or {}):
            return png_bytes
        meta = PngInfo()
        # 1120 补修:必须默认 ensure_ascii=True(\uXXXX 纯 ASCII)——PIL 对原生中文
        # 恒落 iTXt 块,而 App 提取器只扫 tEXt(ComfyUI SaveImage 可读正因默认转义)
        meta.add_text("prompt", json.dumps(graph))
        buffer = _io.BytesIO()
        png.save(buffer, format="PNG", pnginfo=meta)
        out = buffer.getvalue()
        print(f"[image-sidecar] qwen21: 实发工作流已埋 PNG tEXt(产物 {len(out)}B)", flush=True)
        return out
    except Exception as exc:  # noqa: BLE001 - 埋点失败不拦产物
        print(f"[image-sidecar] qwen21: tEXt 埋点跳过({exc})", flush=True)
        return png_bytes


def generate(prompt: str, aspect_ratio: str, negative_prompt: str | None, steps: int, seed: int | None, reference_b64: str | None = None, **ctx: Any) -> str:
    from image_gen.pipeline import is_generation_cancelled

    def check_cancelled(prompt_id: str | None = None) -> None:
        if not is_generation_cancelled():
            return
        if prompt_id:
            try:
                _http_json("POST", f"{bridge_url()}/api/jobs/{parse.quote(prompt_id, safe='')}/cancel", {}, timeout=5)
            except Exception:
                pass
        raise _pipeline_error("generation-cancelled", "已停止")

    check_cancelled()
    from comfyui import engine_manager as _em
    try:
        _em.engine_manager().ensure_engine_ready()
    except _em.EngineOpError as exc:
        raise _pipeline_error("engine-start-failed", str(exc)) from exc
    check_cancelled()
    stats = resolve_big_files()
    if not stats:
        raise _pipeline_error("bridge-unreachable", "ComfyUI 没在运行，请先打开它再试")
    # 参考图分族(与 comfyui_bridge 同款约定):ctx 显式列表优先,否则单张 positional
    references = list(ctx.get("reference_images_b64") or ([] if not reference_b64 else [reference_b64]))
    # 指定模板(1102 控制中心 S3 绑定注入;照 comfyui_bridge.py:452-454 同款先例):
    # 调用方显式点名 ctx["template"] 时优先于自动路由(值=引擎 API 模板键,前端映射层
    # 已把道劫绑定件转成 qwen21_道劫_{t2i,i2i}_api;缺省 None=自动路由现行为零迁移)
    forced_template = ctx.get("template") if isinstance(ctx.get("template"), str) else None
    wide_anchor = False  # P4 ③格:比例门过→MP 覆写激活(④格终格跟随)

    if references:
        # 10-19 图生图·道劫美术风格转换(D3/D4)→1116 三槽正典(§五.4):原生三参考
        # (image_1/2/3,prd §4.5 槽位案);模板快照=画布现值,仅运行时覆写组装用途=
        # 道劫美术风格转换(底座由装配层追加);seed 每次随机(fire 铁令)
        if len(references) > 3:
            raise _pipeline_error(
                "reference-unsupported",
                "Qwen-Image-2.1 本地渠道图生图最多支持三张参考图(原生三参考槽)。",
            )
        template_key = forced_template or TEMPLATE_NAME_I2I
        template = load_template(template_key)
        _warn_if_version_below_min(stats, template)
        # 循环上传全参(1116 七刀②):逐张传引擎 input,文件名逐张随机;
        # 每张前查取消(照 comfyui_bridge.generate 上传循环先例)
        upload_names: list[str] = []
        for reference in references:
            check_cancelled()
            upload_name = _upload_image(
                f"{bridge_url()}/upload/image",
                reference,
                f"qwen21-i2i-{uuid.uuid4().hex}.png",
            ).get("name")
            if not isinstance(upload_name, str) or not upload_name:
                raise _pipeline_error("bridge-execution-failed", "ComfyUI 未返回参考图文件名")
            upload_names.append(upload_name)
        seed = seed if seed is not None else random.randint(1, 2**31 - 1)
        # 负面不传(cfg=1;模板无 negative_prompt 绑定,显式 None 表态);
        # 全列表注入(1116 七刀③):references 绑定 slot0/1/2→[10]/[11]/[12];
        # 未满三张的余链由 instantiate_template 按张数剪(1116 七刀⑤,与画布
        # 旁路等价)——旧 qwen21 侧剪链段随七刀④退役,单源在桥。
        graph = instantiate_template(template, prompt, None, steps, seed, aspect_ratio, upload_names)
        assembly = graph.get("6:4011")
        if not isinstance(assembly, dict) or "组装用途" not in assembly.get("inputs", {}):
            # fail-closed 防模板文件手术漂移(快照重构须重跑 build --target i2i)
            raise _pipeline_error(
                "bridge-template-missing",
                f"i2i 模板缺组装节点 6:4011: {TEMPLATE_NAME_I2I}",
            )
        base_type = ctx.get("base_type")
        if isinstance(base_type, str) and base_type.strip():
            # 10-22 型层注入路:参考图锚身份+型文全拼(类型句+型负面 merge);
            # RGBA 由 6:180 rgba_hint 连线 6:4010 自动跟型(透明型即激活透明链)。
            # 6:4022 画幅路由与 6:4011 必同覆写——4022 仅在道劫美术类型/无底座出图
            # 档路由型画幅,只改 4011 会恒跟参考画幅(晏燎役多视图方形案同坑);
            # 非法型名由 ComfyUI 的 COMBO 校验拒单兜底(与 t2i 路同款)。
            apply_base_type(graph, base_type)
            purpose_canvas = graph.get("6:4022")
            if not isinstance(purpose_canvas, dict) or "组装用途" not in purpose_canvas.get("inputs", {}):
                raise _pipeline_error(
                    "bridge-template-missing",
                    f"i2i 模板缺画幅路由节点 6:4022: {TEMPLATE_NAME_I2I}",
                )
            purpose_canvas["inputs"]["组装用途"] = ASSEMBLY_PURPOSE_TYPE_FULL
            assembly["inputs"]["组装用途"] = ASSEMBLY_PURPOSE_TYPE_FULL
            # 1108 拉齐:i2i ⑦Pruna 臂已入列,手型默认随 t2i=档4(在 apply_base_type 之后)
            apply_hand_speed_mode(graph, base_type, hand_default=SPEED_MODE_PRUNA)
            # 1118 碎格根修:超安全档的型/手动画幅按原纵横比压回 ≤1.25MP
            # (字面量注入 EmptyLatentImage,头注见 apply_ref_safe_canvas)
            apply_ref_safe_canvas(graph, base_type,
                                  ctx.get("manual_width"), ctx.get("manual_height"))
        else:
            # 缺省=道劫美术风格转换(指令+底座两段),既有画风转换/人脸/表情差分
            # 调用零回归(10-19 口径全量向后兼容)
            assembly["inputs"]["组装用途"] = ASSEMBLY_PURPOSE_STYLE_TRANSFER
        # 1120 用户令:i2i ≥2 张参考恒原生40步(正源=[4015]多参考编码槽0)——
        # 少步蒸馏×多参考=黑屏域,快档注臂镜像 [171] 单图看不见 image_2/3;型级
        # 路由(美宣/海报/设定卡/手型)与默认档均让位本令(置于 apply_hand_speed_mode
        # 之后=7500 同键覆写,最终正源恒多参考)
        if len(upload_names) >= 2:
            _apply_native_40step(graph, multiref=True)
        # 10-26 画幅手动覆写(横竖皆可裁定;i2i 手动槽优先于九型直通,
        # 4022 型画幅路由保持不动)
        apply_manual_size(graph, ctx.get("manual_width"), ctx.get("manual_height"))
        # 1120 P4 ③格:i2i 链同锚(Gem 链对入口画幅无感,生成段压回安全档
        # 不改交付意图比例;按型/手动比例算 MP,出口恒宽≥3840)
        # 1120 高清人脸崩图根修:i2i 无型层任务门判据补参考图实幅——App 缺省
        # aspect="16:9" 曾骗过 16:9 族门(晏燎 3:4 参考实录,Gem 链被拉爆引擎崩)
        wide_anchor = apply_wide_edge_anchor(
            graph, ctx.get("base_type"), ctx.get("manual_width"),
            ctx.get("manual_height"), aspect_ratio,
            ref_dims=_b64_image_dims(references[0]) if references else None)
    else:
        template_key = forced_template or TEMPLATE_NAME
        template = load_template(template_key)
        _warn_if_version_below_min(stats, template)
        graph = instantiate_template(template, prompt, negative_prompt, steps, seed, aspect_ratio, [])
        apply_base_type(graph, ctx.get("base_type"))
        # 10-26 有手型默认档;1108:t2i=档4 PrunaAI(用户令,在 apply_base_type 之后)
        apply_hand_speed_mode(graph, ctx.get("base_type"), hand_default=SPEED_MODE_PRUNA)
        # 10-26 画幅手动覆写(横竖皆可裁定;t2i 手动槽优先于九型直通)
        apply_manual_size(graph, ctx.get("manual_width"), ctx.get("manual_height"))
        # 1120 P4 ③格:16:9 族边锚覆写(8100/8122 megapixels→恒宽 3840 等
        # 价 MP;竖/方型拦候裁零动作)
        wide_anchor = apply_wide_edge_anchor(
            graph, ctx.get("base_type"), ctx.get("manual_width"),
            ctx.get("manual_height"), aspect_ratio)
    message = missing_nodes_message(
        [cls for cls in graph_node_classes(graph) if cls not in _available_node_classes()],
        curated_node_class_packs(),
    )
    if message:
        raise _pipeline_error("bridge-missing-nodes", message)
    check_cancelled()
    # 退化防线接线(blank-gate-1024 §6):提交前处置;桶键=模板+型档
    # (型档步时差同理分桶防互染,base_type 在上方两分支作用域内)
    base_type_value = ctx.get("base_type")
    bucket = template_key + "|" + (base_type_value if isinstance(base_type_value, str) and base_type_value.strip() else "")
    submit_started = time.time()  # 墙钟回落基准(测试 mock 只钉 monotonic;墙钟语义本就是客户端时钟)
    from . import engine_health
    engine_health.pre_submit(bridge_url())
    client_id = str(uuid.uuid4())
    # 1120 观测令:发车参数全文落 sidecar 日志(手动生图核装配输入;base_type 空=风格转换)
    print(
        f"[image-sidecar] qwen21 发车: template={template_key} "
        f"base_type={base_type_value if isinstance(base_type_value, str) and base_type_value.strip() else '(风格转换)'} "
        f"refs={len(references)} steps={steps} seed={seed} 主体句({len(prompt)}字): {prompt}",
        flush=True,
    )
    submitted = _http_json("POST", f"{bridge_url()}/prompt", {"prompt": graph, "client_id": client_id}, timeout=20)
    prompt_id = submitted.get("prompt_id")
    if not isinstance(prompt_id, str) or not prompt_id.strip():
        if submitted.get("node_errors"):
            raise _pipeline_error("bridge-execution-failed", f"ComfyUI 拒绝工作流: {str(submitted['node_errors'])[:500]}")
        raise _pipeline_error("bridge-execution-failed", "ComfyUI 未返回任务编号")
    if submitted.get("node_errors"):
        print(f"[image-sidecar] qwen21: 任务 {prompt_id} 部分输出校验失败,继续跟踪已接受输出: {str(submitted['node_errors'])[:500]}", flush=True)
    try:
        # 1119 二十四刀C:同 comfyui_bridge 600→1500(Gem v2 皮肤件超分慢镜>10min,
        # 600s 双墙任一打断=S01 三连 interrupted 实录,此处为第二堵墙)
        timeout_s = float(os.environ.get("MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S", "1500"))
    except (TypeError, ValueError, OverflowError):
        timeout_s = 1500.0
    if not math.isfinite(timeout_s) or timeout_s <= 0:
        timeout_s = 1500.0
    deadline = time.monotonic() + timeout_s
    from image_gen.pipeline import PipelineError as _PipelineError

    def _record(ok: bool, history_entry: dict | None = None) -> None:
        # 成功=喂锚定基线;失败(ok=False)只记不判
        engine_health.record_shot(bucket=bucket, steps=steps, history_entry=history_entry,
                                  wall_s=time.time() - submit_started, ok=ok)

    try:
        while time.monotonic() < deadline:
            check_cancelled(prompt_id)
            try:
                history = _http_json("GET", f"{bridge_url()}/history/{prompt_id}", timeout=5)
            except Exception:
                check_cancelled(prompt_id)
                raise
            check_cancelled(prompt_id)
            state, image = _prefer_upscaled_output(history, prompt_id)
            if state == "success":
                if not image:
                    raise _pipeline_error("bridge-no-output", "ComfyUI 已完成但没有输出图片")
                query = urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": image.get("type", "output")})
                try:
                    content = _fetch_bytes(f"{bridge_url()}/view?{query}")
                except Exception:
                    check_cancelled(prompt_id)
                    raise
                check_cancelled(prompt_id)
                if wide_anchor:
                    # 1120 P4 ④格:终格微整+禁欠终断(≤3% lanczos 到精确
                    # 3840×2160;超容差 raise 不交)
                    content = final_anchor_resize(content)
                # 1120 图↔词溯源补埋:sidecar 路产物不经引擎 SaveImage 落盘→tEXt
                # 「prompt」块缺失(实发终稿弹窗 no-texr 实录);此处复刻 SaveImage
                # 约定把实发 API 形工作流 JSON 写进 tEXt,②区可解构回放
                content = _embed_prompt_metadata(content, graph)
                _record(True, history.get(prompt_id) if isinstance(history, dict) else None)
                return base64.b64encode(content).decode("ascii")
            time.sleep(1)
    except _PipelineError:
        _record(False)
        raise
    _record(False)  # 超时路径:只记不判
    check_cancelled(prompt_id)
    try:
        _http_json("POST", f"{bridge_url()}/api/jobs/{parse.quote(prompt_id, safe='')}/cancel", {}, timeout=5)
    except Exception:
        pass
    raise _pipeline_error("bridge-timeout", "ComfyUI 生成超时")
