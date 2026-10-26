# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""sidecar pytest 专用 comfy_api.latest 最小桩(引擎不在场时垫 sys.modules)。

服务对象:my_nodes v3 io 节点(comfy_api.latest io.ComfyNode 形,首件
my_qi21_fast_encode)的源码位契约测试——v3 类定义期必须顶层 import
comfy_api.latest(官方 comfy_extras/nodes_qwen.py 同款),sidecar venv 无
引擎包,由本桩垫。真实引擎在场(importlib 能找到 comfy_api)时 install()
恒零操作,引擎行为永远走真身;桩只回放作者面记录(Schema/输入输出构造器/
Autogrow/NodeOutput/CATEGORY·DESCRIPTION·RETURN_* 派生面),不承担引擎
序列化与执行语义(那些由引擎 object_info/execution 与对齐器兑底)。

安放位约定:必须在 comfyui 包外(comfyui/tests 与 comfyui/my_nodes/tests
两个 conftest 先把 apps/backend 上 sys.path 再 import 本件装桩,桩须先于
任何 comfyui.my_nodes 导入生效);不随 my_nodes 拷贝进引擎。
"""

from __future__ import annotations

import importlib.util
import sys
import types


def _build_io() -> types.ModuleType:
    """构建桩 io 模块(记录式:存作者面实参,不实现引擎语义)。"""
    io = types.ModuleType("comfy_api.latest.io")

    class _BaseInput:
        def __init__(self, id, *, display_name=None, optional=False, tooltip=None,
                     lazy=None, extra_dict=None, **opts):
            self.id = id
            self.display_name = display_name
            self.optional = optional
            self.tooltip = tooltip
            self.lazy = lazy
            self.opts = opts
            for key, value in opts.items():  # 常用实参直挂属性(multiline/default/min…)
                setattr(self, key, value)

    class _BaseOutput:
        def __init__(self, id=None, *, display_name=None, tooltip=None,
                     is_output_list=False):
            self.id = id
            self.display_name = display_name
            self.tooltip = tooltip
            self.is_output_list = is_output_list

    class _WidgetInput(_BaseInput):
        is_widget = True

    class _TypedInput(_BaseInput):
        is_widget = False

    def _type_pair(io_type: str, widget: bool):
        base = _WidgetInput if widget else _TypedInput

        class _Input(base):
            pass

        class _Output(_BaseOutput):
            pass

        _Input.io_type = io_type
        _Input.__name__ = f"{io_type}Input"
        _Output.io_type = io_type
        _Output.__name__ = f"{io_type}Output"
        return types.SimpleNamespace(Input=_Input, Output=_Output)

    class _TemplateNames:
        def __init__(self, input, names, min=1):
            self.input = input
            self.names = list(names)
            self.min = min

    class _AutogrowInput(_BaseInput):
        io_type = "COMFY_AUTOGROW_V3"

        def __init__(self, id, template, **kwargs):
            super().__init__(id, **kwargs)
            self.template = template

    class Autogrow:
        Type = dict  # 真身=dict[str, Any](execute 签名注解位)
        Input = _AutogrowInput
        TemplateNames = _TemplateNames

    class Schema:
        def __init__(self, node_id, display_name=None, category="sd", description="",
                     inputs=None, outputs=None, hidden=None, **flags):
            self.node_id = node_id
            self.display_name = display_name
            self.category = category
            self.description = description
            self.inputs = list(inputs or [])
            self.outputs = list(outputs or [])
            self.hidden = list(hidden or [])
            self.flags = flags

    class NodeOutput:
        def __init__(self, *args, ui=None, expand=None, block_execution=None):
            self.args = args
            self.ui = ui
            self.expand = expand
            self.block_execution = block_execution

        @property
        def result(self):
            return self.args if self.args else None

    class _ClassProperty:
        """描述符:类位直读(回放引擎 _io.py classproperty 形——cls.X 得值非方法)。"""

        def __init__(self, fget):
            self.fget = fget

        def __get__(self, _obj, owner):
            return self.fget(owner)

    class ComfyNode:
        """桩基类:回放 v3 派生面(CATEGORY/DESCRIPTION/RETURN_* 自 schema)。"""

        @classmethod
        def define_schema(cls):
            raise NotImplementedError

        @classmethod
        def execute(cls, **kwargs):
            raise NotImplementedError

        @_ClassProperty
        def CATEGORY(cls):
            return cls.define_schema().category

        @_ClassProperty
        def DESCRIPTION(cls):
            return cls.define_schema().description

        @_ClassProperty
        def RETURN_TYPES(cls):
            return tuple(o.io_type for o in cls.define_schema().outputs)

        @_ClassProperty
        def RETURN_NAMES(cls):
            return tuple(o.display_name for o in cls.define_schema().outputs)

    for name, pair in {
        "Clip": _type_pair("CLIP", widget=False),
        "String": _type_pair("STRING", widget=True),
        "Int": _type_pair("INT", widget=True),
        "Image": _type_pair("IMAGE", widget=False),
        "Vae": _type_pair("VAE", widget=False),
        "Conditioning": _type_pair("CONDITIONING", widget=False),
        "Latent": _type_pair("LATENT", widget=False),
    }.items():
        setattr(io, name, pair)
    io.Autogrow = Autogrow
    io.Schema = Schema
    io.NodeOutput = NodeOutput
    io.ComfyNode = ComfyNode
    return io


_INSTALLED = False


def install() -> bool:
    """装桩(幂等);真 comfy_api 可导入(引擎在场环境)时恒零操作。"""
    global _INSTALLED
    if _INSTALLED or "comfy_api" in sys.modules:
        return False
    if importlib.util.find_spec("comfy_api") is not None:
        return False
    io_mod = _build_io()
    latest = types.ModuleType("comfy_api.latest")
    latest.io = io_mod
    pkg = types.ModuleType("comfy_api")
    pkg.latest = latest
    sys.modules["comfy_api"] = pkg
    sys.modules["comfy_api.latest"] = latest
    sys.modules["comfy_api.latest.io"] = io_mod
    _INSTALLED = True
    return True
