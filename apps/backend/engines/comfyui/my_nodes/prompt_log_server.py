# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""出图全参数日志(09-15 道劫风格调教令:细节零丢失;终态=纯引擎侧,零工作流侵入)。

队列钩子:每次 /prompt 入队,把整张执行图(API 形态=全部节点的全部输入/
参数值)落日志——KSampler 六参数、LoRA 名称与强度、模型三件套、风格库
选择、分辨率、12带权重、ModelPatch、保存前缀、正/负提示词原文……零截断。

落点(双层):
  1) 文件:<comfy-home>/logs/image-prompts-YYYYMMDD.log(按日一档,追加写;
     路径=folder_paths.base_path.parent/logs 运行时相对解析,dev/装机/分发同构)
  2) 引擎 stdout(comfyui_<port>.log 同步可见,便于 tail 盯盘)

工程约束:
- 全程 try/except,日志任何失败绝不阻塞/改变出图;
- 只包一层 PromptQueue.put(幂等守卫,引擎 reload 不叠加);
- 不在画布放任何日志节点(09-15 用户裁定:工作流零侵入)。

文件行形态(搜「[MY出图]」即取):
  [MY出图][入队][2026-09-15 22:30:05] number=21 prompt_id=2e1faeed…
  [MY出图][摘要] KSampler: seed=42 cfg=3 … | LoRA: … ×2 | 风格: … | 分辨率: 1024x1024
  [MY出图][全量JSON] {完整 API 图,零截断}
"""

from __future__ import annotations

import json
import time

_installed = False
_logs_dir = None


def _fmt(v, n=60):
    s = str(v)
    return s if len(s) <= n else s[:n] + "…"


def _resolve_logs_dir():
    """<comfy-home>/logs(ComfyUI 安装根的父级);解析失败回落进程 cwd/logs。"""
    global _logs_dir
    if _logs_dir is not None:
        return _logs_dir
    from pathlib import Path
    try:
        import folder_paths
        _logs_dir = Path(folder_paths.base_path).resolve().parent / "logs"
    except Exception:
        _logs_dir = Path.cwd() / "logs"
    return _logs_dir


def _summary(prompt: dict) -> str:
    lines = []
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        cls = node.get("class_type", "")
        i = node.get("inputs", {}) or {}
        if cls == "KSampler":
            lines.append(
                "KSampler: seed={seed} cfg={cfg} steps={steps} sampler={sampler_name} "
                "scheduler={scheduler} denoise={denoise}".format(**{k: i.get(k) for k in
                ("seed", "cfg", "steps", "sampler_name", "scheduler", "denoise")})
            )
        elif cls in ("UNETLoader", "CLIPLoader", "VAELoader"):
            name = i.get("unet_name") or i.get("clip_name") or i.get("vae_name") or "?"
            lines.append(f"{cls}: {_fmt(name)}")
        elif cls in ("LoraLoaderModelOnly", "LoraLoader"):
            lines.append(f"LoRA: {_fmt(i.get('lora_name', '?'))} ×{i.get('strength_model', i.get('strength'))}")
        elif cls == "easy stylesSelector":
            lines.append(f"风格: {_fmt(i.get('styles', '?'))}/{_fmt(i.get('select_styles', ''))}")
        elif cls == "MyStylesLibrary":
            # 09-15 风格库节点(art_skills 现读):widget 只剩 style 一枚
            lines.append(f"风格: {_fmt(i.get('style', '?'))}")
        elif cls in ("EmptySD3LatentImage", "EmptyLatentImage"):
            lines.append(f"分辨率: {i.get('width')}x{i.get('height')} batch={i.get('batch_size')}")
        elif cls == "ConditioningKrea2Rebalance":
            lines.append(f"12带: multiplier={i.get('multiplier')} weights={_fmt(i.get('per_layer_weights'), 120)}")
        elif cls == "Krea2EditModelPatch":
            lines.append(f"ModelPatch: ref_boost={i.get('ref_boost')} a={i.get('ref_boost_a')} fit={i.get('fit_mode')}")
        elif cls == "SaveImage":
            lines.append(f"保存前缀: {i.get('filename_prefix')}")
    return " | ".join(lines)


def _resolve_text(prompt: dict, val, depth: int = 0):
    """API 图取文本:字面串直返;连线([节点id,槽])沿 value/text 递归解引。"""
    if isinstance(val, str) or val is None:
        return val
    if isinstance(val, list) and len(val) == 2 and depth < 5:
        src = prompt.get(str(val[0])) or {}
        inputs = src.get("inputs", {}) if isinstance(src, dict) else {}
        for key in ("value", "text"):
            if key in inputs:
                return _resolve_text(prompt, inputs[key], depth + 1)
    return None


def _style_final(prompt: dict) -> str:
    """风格终词:MyStylesLibrary 在图时按节点同款组装规则算出最终生效
    正/负词(API 图里编码文本是连线,终词只在运行时生成,须现算)——
    道劫风格调教要对账的就是这段词。"""
    try:
        from .nodes import my_styles

        for node in prompt.values():
            if isinstance(node, dict) and node.get("class_type") == "MyStylesLibrary":
                inputs = node.get("inputs", {}) or {}
                positive = _resolve_text(prompt, inputs.get("positive"))
                negative = _resolve_text(prompt, inputs.get("negative"))
                final_pos, final_neg = my_styles.MyStylesLibrary().run(
                    inputs.get("style"), positive, negative)
                return (
                    f"[MY出图][风格·{inputs.get('style')}]\n"
                    f"[MY出图][风格终词·正向]\n{final_pos}\n"
                    f"[MY出图][风格终词·负向]\n{final_neg}\n"
                )
    except Exception:
        pass  # 终词渲染失败不挡日志其余段
    return ""


def _render(item) -> str | None:
    if not isinstance(item, (tuple, list)) or len(item) < 3:
        return None
    prompt_id, prompt = item[1], item[2]
    if not isinstance(prompt, dict):
        return None
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    return (
        f"[MY出图][入队][{stamp}] number={item[0]} prompt_id={prompt_id}\n"
        f"[MY出图][摘要] {_summary(prompt)}\n"
        f"{_style_final(prompt)}"
        f"[MY出图][全量JSON] {json.dumps(prompt, ensure_ascii=False, separators=(',', ':'))}\n"
    )


def _log_prompt(item) -> None:
    text = _render(item)
    if not text:
        return
    print(text, end="", flush=True)  # 引擎 stdout(comfyui_<port>.log 同步可见)
    try:
        from pathlib import Path
        d = _resolve_logs_dir()
        Path(d).mkdir(parents=True, exist_ok=True)
        path = Path(d) / f"image-prompts-{time.strftime('%Y%m%d')}.log"
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)
    except Exception:
        pass  # 文件落盘失败不挡出图(stdout 已留一份)


def install() -> None:
    """包一层 PromptQueue.put:入队即全量落日志(幂等,失败静默)。

    模块路径三档(09-16 深审实弹定谳):本引擎=ComfyUI 根层顶层模块
    `import execution`(源码 execution.py:1251 PromptQueue.put(self,item)
    同步单参;comfy 与 comfy_execution 两包均无 execution——两次想当然
    各错一次,正解=实读引擎源码+venv 实测 import);旧版=from comfy
    import execution;过渡版=comfy_execution.execution。包装器
    *args/**kwargs 全透传,上游签名漂移不炸。item=6 元组
    (number,prompt_id,prompt,extra_data,outputs_to_execute,sensitive),
    prompt 恒在 [2] 位(server.py:1131 实读)。"""
    global _installed
    if _installed:
        return
    try:
        try:
            import execution as _ex  # 本引擎实形态(根层顶层模块)
        except ImportError:
            try:
                from comfy import execution as _ex  # 旧版
            except ImportError:
                from comfy_execution import execution as _ex  # 过渡版

        _orig_put = _ex.PromptQueue.put

        def _put(self, *args, **kwargs):
            try:
                if args:
                    _log_prompt(args[0])
            except Exception:
                pass  # 日志失败绝不挡出图
            return _orig_put(self, *args, **kwargs)

        _ex.PromptQueue.put = _put
        _installed = True
        print("[MY出图] 全参数队列日志已挂载(PromptQueue.put;文件=<comfy-home>/logs/)", flush=True)
    except Exception as error:
        print(f"[MY出图] 全参数日志挂载失败(不影响出图): {error}", flush=True)
