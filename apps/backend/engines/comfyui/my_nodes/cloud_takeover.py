# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影云端收编钩子(09-10 二轮纠偏):凭据换漫影令牌,零 ComfyUI 源码改动。

用户裁定:云端节点(OpenAI/Anthropic/LTX…)全量保留,只封 comfy.org 登录;
漫影云=同一批节点「换 URL+换 API key」。URL 侧=官方 `--comfy-api-base`
启动参数(engine_manager 按 MYSTUDIO_COMFY_API_BASE 注入,把 comfy.org
代理整体改指漫影网关);本模块只做凭据侧——comfy_api_nodes 全部请求经
util/client.py 收口,get_comfy_api_headers 调用期经模块全局查
get_auth_header(不吃 import 缓存),故替身一处生效全域(含 nodes_sonilo
按名引 get_comfy_api_headers 的路径:其内部仍查本函数)。

防更新漂移:上游若改名/改构(引擎跟随最新),补丁静默不贴、节点回落
上游行为,绝不炸引擎;MYSTUDIO_COMFY_API_TOKEN 未配置=零干预。
"""

from __future__ import annotations

import os

TOKEN_ENV = "MYSTUDIO_COMFY_API_TOKEN"


def takeover_token() -> str:
    return (os.environ.get(TOKEN_ENV) or "").strip()


def apply_cloud_takeover() -> bool:
    """导入期调用(custom_nodes 晚于 comfy_api_nodes 加载)。贴上=凭据改道。"""
    token = takeover_token()
    if not token:
        return False
    try:
        from comfy_api_nodes.util import _helpers
    except Exception:
        return False
    original = getattr(_helpers, "get_auth_header", None)
    if original is None or getattr(original, "_my_takeover", False):
        return False

    def _my_get_auth_header(node_cls):  # noqa: ANN001 — 与上游签名对齐
        # 漫影网关单钥:无论前端有没有 comfy.org 会话,凭据恒=漫影令牌
        # (登录入口由此在功能层失效:杂散 comfy.org token 永不被采用)。
        return {"Authorization": f"Bearer {token}"}

    _my_get_auth_header._my_takeover = True
    _helpers.get_auth_header = _my_get_auth_header
    return True
