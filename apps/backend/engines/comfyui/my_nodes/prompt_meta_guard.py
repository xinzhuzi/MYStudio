# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""PNG 元数据脱敏闸(1007 晚泄密事故·乙案后端兜底)。

事故与分工(甲乙两案,2026-10-07 用户令「根修甲 根修乙 都做」):
  SaveImage 的原生行为=把整张执行图逐字写进 PNG tEXt「prompt」块(复现用,
  本体零改纪律下不可绕开);凡带密值的节点输入一旦进执行图即落盘明文
  (00010/00011 两张云端实弹图实泄 MyQi21ApiPE.api_key)。两案分层:
  - 甲案(web/my-qi21-prompt-preview.js):api_key 控件双闸
    (options.serialize=false + w.serialize=false,官方 uploadAudio.ts 同款)
    ——控件现值既不进执行图也不进工作流文件,封住「UI 控件」这条路;
  - 乙案(本件):运行时包装 SaveImage.save_images,元数据落盘前把自研
    命名空间(My*)节点 inputs 里的 api_key 一律替换 "***"——兜住将来
    任何路子(新控件/桥接注入/旧版工作流)再把密值带进执行图的情形。

边界如实注:
  - 只动「写进 PNG 的那一份」:包装层以脱敏副本替换 prompt 实参,不原地
    改执行图对象——引擎 history 里仍是原件(GET /history 有 token 门,
    0928 桥 403 自愈役定谳),本闸只保盘面文件;
  - workflow 块(widgets_values 位置数组)不在此闸:无法按名定位,且甲案
    的 w.serialize=false 已封该路;两案合围后执行图+工作流双路皆无明文;
  - 脱敏失败不挡出图:任何异常打印中文警告后按原样落盘(产线不炸队列)。

官方扩展点口径:零改 ComfyUI 本体(git 恒 0)——本件=custom_nodes 侧运行
时包装,本体磁盘零字节改动;引擎升级若移位 SaveImage.save_images,安装器
静默跳过并打印一条中文警告,不炸启动。
"""

from __future__ import annotations

import functools
from typing import Any

# 脱敏后占位(保字段存在性,元数据schema稳定可debug,只杀密值)
REDACTED = "***"
# 唯一在册密值输入名(首例 MyQi21ApiPE.api_key;新密值输入入册时在此追加)
GUARDED_INPUTS = ("api_key",)
# 自研命名空间(MyQi21ApiPE/MyImageSave/…);三方节点的同名输入不属本库
# 职责,不碰(他们的元数据契约不由我们担保)
NAMESPACE_PREFIX = "My"

_INSTALL_MARKER = "_my_prompt_meta_guard"


def sanitize_prompt_meta(prompt: Any) -> Any:
    """返回脱敏后的 prompt(纯函数):自研节点 inputs 里 GUARDED_INPUTS
    命中的值替换为 REDACTED;无命中/形状不符时原样返回(零拷贝churn)。
    永不原地改入参——引擎 history 仍持原件。"""
    if not isinstance(prompt, dict):
        return prompt
    out: dict | None = None  # 惰性建副本:无命中时原样返回
    for nid, node in prompt.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        class_type = node.get("class_type")
        if (not isinstance(inputs, dict)
                or not (isinstance(class_type, str)
                        and class_type.startswith(NAMESPACE_PREFIX))):
            continue
        hits = [k for k in GUARDED_INPUTS
                if isinstance(inputs.get(k), str) and inputs[k] != REDACTED]
        if not hits:
            continue
        if out is None:
            out = dict(prompt)
        new_inputs = dict(inputs)
        for k in hits:
            new_inputs[k] = REDACTED
        out[nid] = {**node, "inputs": new_inputs}
    return prompt if out is None else out


def install_saveimage_metadata_guard() -> bool:
    """运行时包装引擎根层 SaveImage.save_images(幂等);my_nodes 包导入
    即装。引擎根层 nodes 只准函数内懒加载+try 守卫(包纪律,同
    my_image_save);任何失败中文警告后返回 False,不影响启动。"""
    try:
        import nodes as comfy_nodes

        cls = getattr(comfy_nodes, "SaveImage", None)
        original = getattr(cls, "save_images", None) if cls else None
        if original is None or getattr(original, _INSTALL_MARKER, False):
            return False

        @functools.wraps(original)
        def guarded(self, images: Any, filename_prefix: str = "ComfyUI",
                    prompt: Any = None, extra_pnginfo: Any = None,
                    **kwargs: Any) -> Any:
            try:
                prompt = sanitize_prompt_meta(prompt)
            except Exception as exc:  # 脱敏失败不挡出图
                print(f"[漫影 元数据闸] 脱敏异常({exc!r}),按原图元数据落盘")
            return original(self, images, filename_prefix=filename_prefix,
                            prompt=prompt, extra_pnginfo=extra_pnginfo,
                            **kwargs)

        guarded._my_prompt_meta_guard = True  # noqa: SLF001(幂等标记)
        cls.save_images = guarded
        print("[漫影 元数据闸] SaveImage 落盘脱敏已挂(api_key→***,"
              "乙案兜底;甲案=api_key 控件不进执行图)")
        return True
    except Exception as exc:
        print(f"[漫影 元数据闸] 安装失败({exc!r})——跳过,不影响启动")
        return False
