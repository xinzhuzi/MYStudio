# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 配置下发路由(0924 令牌随机化配套)。

GET /my_bridge/config → {"bridgeUrl": …, "bridgeToken": …}

为什么需要:漫影侧栏 web JS(浏览器上下文)直连 sidecar 17595 需要装机
随机令牌,而令牌不再可能以固定字面量内嵌在公开仓库的 JS 里。令牌经
engine_manager launch_env 注入引擎进程(my_nodes/bridge/settings.py 读
MYSTUDIO_BRIDGE_TOKEN),web JS 从本同源路由取。

暴露面取舍:本路由挂在引擎自身监听口上——引擎本来就零鉴权(engine_manager
--listen 白名单恒环回),本地进程早已能经 /prompt 执行任意工作流,令牌在此
不下探本地攻击面;远程网页读不走本响应(引擎不加 ACAO,跨源读被浏览器
拦)。装机随机令牌的目标(挡远程网页 drive-by 打 17595)不受影响。
"""

from __future__ import annotations

from .bridge import settings

_installed = False


def config_payload() -> dict:
    """bridge URL/令牌快照(env 缺失时 token 为空串=fail-closed,web 侧调用全 403)。"""
    return {"bridgeUrl": settings.bridge_url(), "bridgeToken": settings.bridge_token()}


def install() -> None:
    """挂一条只读路由(幂等守卫;失败静默打印,不影响节点与出图)。"""
    global _installed
    if _installed:
        return
    try:
        from aiohttp import web
        from server import PromptServer

        @PromptServer.instance.routes.get("/my_bridge/config")
        async def _config(_request):
            try:
                return web.json_response(config_payload())
            except Exception as error:  # noqa: BLE001 - 只读路由,失败给出可读错误
                return web.json_response({"error": str(error)}, status=500)

        _installed = True
        print("[MYbridge] 路由已挂载:/my_bridge/config", flush=True)
    except Exception as error:  # noqa: BLE001 - 引擎侧任何失败不挡装载
        print(f"[MYbridge] 路由挂载失败(不影响节点与出图): {error}", flush=True)
