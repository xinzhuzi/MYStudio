# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md for details.
"""落盘元数据脱敏闸(1007 晚泄密事故·乙案;1010 v2 扩面)。

事故与分工(甲乙两案,2026-10-07 用户令「根修甲 根修乙 都做」):
  SaveImage 的原生行为=把整张执行图逐字写进产物元数据(复现用,本体零改
  纪律下不可绕开);凡带密值的节点输入一旦进执行图即落盘明文(00010/00011
  两张云端实弹图实泄 MyQi21ApiPE.api_key)。两案分层:
  - 甲案(web/my-qi21-prompt-preview.js):api_key 控件双闸
    (options.serialize=false + w.serialize=false,官方 uploadAudio.ts 同款)
    ——控件现值既不进执行图也不进工作流文件,封住「UI 控件」这条路;
  - 乙案(本件):运行时包装保存器,元数据落盘前把自研命名空间(My*)
    节点 inputs 里的 api_key 一律替换 "***"——兜住将来任何路子(新控件/
    桥接注入/旧版工作流)再把密值带进执行图的情形。

v2 扩面(1010 审计:只包 nodes.SaveImage 一类,防线漏洞见下):
  本引擎保存器分三形态,乙案各配一路包装,全部只动「写进文件的那一份」:
  - 旧式节点(方法签名带 prompt=None,执行器按名绑定实参,f(**inputs)):
    nodes.SaveImage(已有)+ 三方 kjnodes SaveImageWithAlpha.save_images_alpha
    + VHS VideoCombine.combine_video —— 按名捕获 prompt 脱敏后转发;
  - 新式官方统一写盘点(comfy_api/latest/_ui.py 的 ImageSaveHelper/
    AudioSaveHelper 静态方法,读 cls.hidden.prompt 写 PNG/APNG/WEBP-EXIF/
    音频元数据):以脱敏代理 cls 转发,零接触真 hidden;
  - 新式三方内联(was SaveVideo.execute 直读 cls.hidden):执行窗口内
    临时替换 cls.hidden.prompt,finally 必还原(节点串行执行,无并发窗口)。
  三方节点的「保存动作会落盘我们 My* 域的密值」=本库职责(与「三方自己的
  密值输入不属本库职责」两句并存:不碰三方行为,只换喂给元数据的副本)。
  三方目标按注册名从 NODE_CLASS_MAPPINGS 扫描,靠链式包装 load_custom_node
  在每个后续包加载后重扫补齐(不赌 custom_nodes 加载顺序);未装的包自然
  扫不到=零副作用。banzhangVideoCombine/SaveSVG 引擎未装、
  MiniMaxH3EasyOutput 为解包节点不落盘,均不入册。

边界如实注(与 v1 一致):
  - 只动「写进产物文件的那一份」:包装层以脱敏副本替换实参,不原地改
    执行图对象——引擎 history 里仍是原件(GET /history 有 token 门,
    0928 桥 403 自愈役定谳),本闸只保盘面文件;
  - workflow 块(widgets_values 位置数组)不在此闸:无法按名定位,且甲案
    的 w.serialize=false 已封该路;两案合围后执行图+工作流双路皆无明文;
  - 脱敏失败不挡出图:任何异常打印中文警告后按原样落盘(产线不炸队列)。

官方扩展点口径:零改 ComfyUI 本体(git 恒 0)——本件=custom_nodes 侧运行
时包装,本体磁盘零字节改动;引擎升级若移位任一包装点,安装器静默跳过并
打印一条中文警告,不炸启动。
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
_CLASS_GUARDED_ATTR = "_my_guarded_methods"
_MISSING = object()  # 「调用方没传 prompt」与「显式 prompt=None」分界哨兵

# 三方在册保存器(注册名 → 保存方法名);新三方保存器入册时在此追加。
# 事实核查(1010):三者引擎在装、确实把执行图写进产物元数据。
THIRD_PARTY_SAVERS: dict[str, str] = {
    "SaveImageWithAlpha": "save_images_alpha",   # kjnodes,PNG prompt 块
    "VHS_VideoCombine": "combine_video",          # VHS,ffmpeg 容器 metadata
    "SaveVideo": "execute",                       # was,新式内联 cls.hidden
}


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


# ── 模式A:按名捕获 prompt(旧式节点,执行器 f(**inputs) 按名绑定)─────

def _wrap_keyword_prompt(cls: type, method_name: str) -> bool:
    """包装 cls.method_name:prompt 实参按名拦截脱敏;未传 prompt 时原样
    直通。幂等失败返回 False。"""
    original = getattr(cls, method_name, None)
    if original is None or getattr(original, _INSTALL_MARKER, False):
        return False

    @functools.wraps(original)
    def guarded(*args: Any, prompt: Any = _MISSING, **kwargs: Any) -> Any:
        try:
            if prompt is not _MISSING:
                prompt = sanitize_prompt_meta(prompt)
        except Exception as exc:  # 脱敏失败不挡出图
            print(f"[漫影 元数据闸] 脱敏异常({method_name}:{exc!r}),按原样落盘")
        if prompt is _MISSING:  # 调用方未传 prompt:原样直通
            return original(*args, **kwargs)
        return original(*args, prompt=prompt, **kwargs)

    guarded._my_prompt_meta_guard = True  # noqa: SLF001(幂等标记)
    setattr(cls, method_name, guarded)
    return True


# ── 模式B:helper 静态方法,cls 形参换脱敏代理(comfy_api 统一写盘点)──

def _wrap_helper_cls_arg(helper_cls: type, method_name: str) -> bool:
    """包装 helper_cls.method_name(staticmethod):定位 cls 形参(位置或
    按名),以仅替换 hidden.prompt 的代理对象转发——零接触节点真 hidden。"""
    import inspect

    original = getattr(helper_cls, method_name, None)
    if original is None or getattr(original, _INSTALL_MARKER, False):
        return False
    params = list(inspect.signature(original).parameters)
    cls_index = params.index("cls") if "cls" in params else None

    def _proxy(cls: Any) -> Any:
        import types as _types

        holder = getattr(cls, "hidden", None)
        prompt = getattr(holder, "prompt", None)
        if prompt is None:
            return cls  # 无执行图可脱,原样
        redacted = _types.SimpleNamespace(
            hidden=_types.SimpleNamespace(
                prompt=sanitize_prompt_meta(prompt),
                extra_pnginfo=getattr(holder, "extra_pnginfo", None)))
        return redacted

    @functools.wraps(original)
    def guarded(*args: Any, **kwargs: Any) -> Any:
        try:
            if "cls" in kwargs:
                kwargs["cls"] = _proxy(kwargs["cls"])
            elif cls_index is not None and cls_index < len(args):
                args = (*args[:cls_index], _proxy(args[cls_index]),
                        *args[cls_index + 1:])
        except Exception as exc:  # 脱敏失败不挡出图
            print(f"[漫影 元数据闸] 脱敏异常({method_name}:{exc!r}),按原样落盘")
        return original(*args, **kwargs)

    guarded._my_prompt_meta_guard = True  # noqa: SLF001(幂等标记)
    setattr(helper_cls, method_name, staticmethod(guarded))
    return True


# ── 模式C:新式节点 execute 内联读 cls.hidden(临时替换+必还原)────────

def _wrap_execute_hidden_swap(cls: type) -> bool:
    """包装 cls.execute(classmethod/staticmethod/plain 三形态分派):执行
    窗口内把 cls.hidden.prompt 换为脱敏副本,finally 必还原。节点串行执行,
    无并发窗口;execute 可能读 cls 其他属性,故不走代理只换 hidden.prompt。"""
    raw = vars(cls).get("execute", None)
    if raw is None:
        return False
    if isinstance(raw, classmethod):
        original, rebuilder = raw.__func__, classmethod
    elif isinstance(raw, staticmethod):
        original, rebuilder = raw.__func__, staticmethod
    else:
        original, rebuilder = raw, (lambda f: f)
    if getattr(original, _INSTALL_MARKER, False):
        return False

    def _core(target: Any, *args: Any, **kwargs: Any) -> Any:
        holder = getattr(target, "hidden", None)
        original_prompt = getattr(holder, "prompt", None)
        if original_prompt is None:
            return original(target, *args, **kwargs)
        try:
            holder.prompt = sanitize_prompt_meta(original_prompt)
        except Exception as exc:  # 脱敏失败不挡出图
            print(f"[漫影 元数据闸] 脱敏异常(execute:{exc!r}),按原样落盘")
        try:
            return original(target, *args, **kwargs)
        finally:
            holder.prompt = original_prompt  # 必还原,节点间不串脱敏态

    @functools.wraps(original)
    def guarded(*args: Any, **kwargs: Any) -> Any:
        return _core(*args, **kwargs)

    guarded._my_prompt_meta_guard = True  # noqa: SLF001(幂等标记)
    try:
        setattr(cls, "execute", rebuilder(guarded))
    except Exception as exc:
        print(f"[漫影 元数据闸] 包装失败({getattr(cls, '__name__', cls)}:{exc!r})")
        return False
    return True


# ── 三方在册扫描(链式补齐,不赌 custom_nodes 加载顺序)────────────────

def _class_method_guarded(cls: Any, method_name: str) -> bool:
    guarded: set = set(getattr(cls, _CLASS_GUARDED_ATTR, set()))
    if not guarded.isdisjoint({method_name}):
        return True
    bound = getattr(cls, method_name, None)
    return bool(getattr(bound, _INSTALL_MARKER, False))


def _mark_class_guarded(cls: Any, method_name: str) -> None:
    guarded = set(getattr(cls, _CLASS_GUARDED_ATTR, set()))
    guarded.add(method_name)
    setattr(cls, _CLASS_GUARDED_ATTR, guarded)


def _wrap_newstyle_inline(cls: Any) -> bool:
    """was SaveVideo 形态(execute 直读 cls.hidden):模式C。"""
    return _wrap_execute_hidden_swap(cls)


def wrap_third_party_savers() -> list[str]:
    """扫 NODE_CLASS_MAPPINGS 给在册三方保存器补包装;返回本次新包的
    「注册名.方法」清单(空=无事发生)。幂等,永不抛(异常打印后吞)。"""
    try:
        import nodes as comfy_nodes

        mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", None)
        if not isinstance(mappings, dict):
            return []
    except Exception:
        return []

    wrapped: list[str] = []
    for reg_name, method_name in THIRD_PARTY_SAVERS.items():
        cls = mappings.get(reg_name)
        if cls is None or _class_method_guarded(cls, method_name):
            continue
        try:
            ok = (_wrap_newstyle_inline(cls) if method_name == "execute"
                  else _wrap_keyword_prompt(cls, method_name))
        except Exception as exc:
            print(f"[漫影 元数据闸] 三方包装异常({reg_name}:{exc!r}),跳过")
            continue
        if ok:
            _mark_class_guarded(cls, method_name)
            wrapped.append(f"{reg_name}.{method_name}")
    if wrapped:
        print(f"[漫影 元数据闸] 三方保存器已包:{','.join(wrapped)}(乙案扩面)")
    return wrapped


def _install_loader_chain() -> bool:
    """链式包装 nodes.load_custom_node:每个后续 custom_nodes 包加载完即
    重扫在册三方保存器。2389 行加载循环每轮从模块命名空间重查本函数名,
    patch 属性即对后续轮次生效;幂等,任何失败中文警告后放弃(不炸加载)。"""
    try:
        import nodes as comfy_nodes

        original = getattr(comfy_nodes, "load_custom_node", None)
        if original is None or getattr(original, _INSTALL_MARKER, False):
            return False

        @functools.wraps(original)
        async def guarded(*args: Any, **kwargs: Any) -> Any:
            result = await original(*args, **kwargs)
            try:
                wrap_third_party_savers()
            except Exception as exc:  # 重扫失败不影响加载
                print(f"[漫影 元数据闸] 链式重扫异常({exc!r}),跳过本轮")
            return result

        guarded._my_prompt_meta_guard = True  # noqa: SLF001(幂等标记)
        comfy_nodes.load_custom_node = guarded
        return True
    except Exception as exc:
        print(f"[漫影 元数据闸] 链式挂钩失败({exc!r})——三方补包退化为"
              f"「已加载即扫」一次")
        return False


# ── 安装入口(my_nodes 包导入即装;__init__.py 调用,签名 v1 兼容)─────

def install_saveimage_metadata_guard() -> bool:
    """运行时包装各形态保存器(幂等,总入口):
    ①旧式官方 nodes.SaveImage(v1 行为,含 PreviewImage 继承面);
    ②新式官方统一写盘点 comfy_api/latest/_ui 的 ImageSaveHelper×3 +
    AudioSaveHelper(覆盖官方 PNG/APNG/WEBP-EXIF/音频全家);
    ③三方在册(当下已加载的立刻包;后续包靠链式重扫补齐)。
    引擎根层模块只准函数内懒加载+try 守卫(包纪律,同 my_image_save);
    任何失败中文警告后返回 False,不影响启动。"""
    installed = False
    try:
        import nodes as comfy_nodes

        cls = getattr(comfy_nodes, "SaveImage", None)
        if cls is not None and _wrap_keyword_prompt(cls, "save_images"):
            installed = True
            print("[漫影 元数据闸] SaveImage 落盘脱敏已挂(api_key→***,"
                  "乙案兜底;甲案=api_key 控件不进执行图)")
    except Exception as exc:
        print(f"[漫影 元数据闸] 官方旧式包装失败({exc!r})——跳过,不影响启动")

    try:
        from comfy_api.latest import _ui

        for helper, methods in (
                (_ui.ImageSaveHelper, ("_create_png_metadata",
                                       "_create_animated_png_metadata",
                                       "_create_webp_metadata")),
                (_ui.AudioSaveHelper, ("save_audio",))):
            for method_name in methods:
                if _wrap_helper_cls_arg(helper, method_name):
                    installed = True
                    print(f"[漫影 元数据闸] {helper.__name__}.{method_name} "
                          f"落盘脱敏已挂(新式统一写盘点,乙案扩面)")
    except Exception as exc:
        print(f"[漫影 元数据闸] 新式 helper 包装失败({exc!r})——跳过,不影响启动")

    try:
        if wrap_third_party_savers():
            installed = True
        if _install_loader_chain():
            installed = True
    except Exception as exc:
        print(f"[漫影 元数据闸] 三方扫描/链式挂钩失败({exc!r})——跳过,不影响启动")

    return installed
