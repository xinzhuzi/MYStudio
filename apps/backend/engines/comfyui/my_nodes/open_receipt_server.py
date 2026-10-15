# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""opener mode 收据路由(LF21,1015)。

POST /my_bridge/open_receipt ←漫影画布 web JS(open-receipt.mjs
emitOpenReceipt,fire-and-forget 同源 fetch)发来 opener 结果收据
{ts,name,mode,ok}。为什么:opener(open-workflow.js 单实例协议 v3)的
mode 分支结果只在 webview guest 内被消费,宿主/main 全程拿不到;console
不落盘、webview→宿主桥缺面——收据经引擎侧路由落盘是唯一零前端改、
零本体重改的持久通道(过 webview 重载/引擎重启/App 重启全存活)。

落点(双层,仿 prompt_log_server 范式):
  1) 文件:<comfy-home>/logs/open-receipts-YYYYMMDD.log(按日一档,JSONL
     追加;路径=folder_paths.base_path.parent/logs 运行时相对解析)
  2) 引擎 stdout(engine.log 同步可见;搜「[MY开单]」即取)

暴露面取舍(同 bridge_settings_server.py:13-16 既有论证):挂在引擎自身
监听口上,环回零鉴权既有面;本路由只收收据写本地日志,不回读任何状态,
不下探攻击面。

工程约束:全程 try/except,收据任何失败绝不影响节点装载与出图;
install 幂等守卫,挂载失败静默打印。
"""

from __future__ import annotations

import json
import time

_installed = False
_logs_dir = None

RECEIPT_TAG = "[MY开单]"
ROUTE_PATH = "/my_bridge/open_receipt"

# 洪水闸:单字段截断上限(收据字段本就该短;防同源脚本灌日志)
_MAX_MODE = 64
_MAX_NAME = 512
_MAX_TS = 64


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


def _clean_str(value, cap: int):
    """字符串化+去换行+截断(mode 亦外部可控,进料闸去 \\n/\\r 与 stdout 行同治,
    复核员 finding1 1015;JSONL 与 stdout 同源单行)。缺失/None→None;非串标量 str() 兜底。"""
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    return text.replace("\n", " ").replace("\r", " ")[:cap]


def sanitize_receipt(body) -> dict | None:
    """请求体 dict → 收据 dict{ts,name,mode,ok};非法(非 dict/无 mode)→ None。"""
    if not isinstance(body, dict):
        return None
    mode = _clean_str(body.get("mode"), _MAX_MODE)
    if not mode:
        return None  # mode 是收据的定性字段,缺它=废票
    return {
        "ts": _clean_str(body.get("ts"), _MAX_TS),
        "name": _clean_str(body.get("name"), _MAX_NAME),
        "mode": mode,
        "ok": body.get("ok") if isinstance(body.get("ok"), bool) else None,
    }


def receipt_print_line(payload: dict) -> str:
    """stdout/engine.log 行:[MY开单] mode=… name=… ts=…。mode/name/ts 三字段
    同闸去换行防伪造行(mode 亦外部可控,复核员 finding1 1015 补钉);JSONL
    文件侧 json.dumps 转义无恙,不受此闸。"""
    def _oneline(value) -> str:
        return str(value or "").replace("\n", " ").replace("\r", " ")
    return (
        f"{RECEIPT_TAG} mode={_oneline(payload.get('mode'))}"
        f" name={_oneline(payload.get('name'))} ts={_oneline(payload.get('ts'))}"
    )


def append_receipt(payload: dict, logs_dir=None):
    """收据落盘:stdout 行 + JSONL 追加(<logs>/open-receipts-YYYYMMDD.log)。
    返回写入路径;任何失败静默 None(stdout 已留一份,绝不向上抛)。"""
    try:
        print(receipt_print_line(payload), flush=True)
        from pathlib import Path
        d = Path(logs_dir) if logs_dir is not None else Path(_resolve_logs_dir())
        d.mkdir(parents=True, exist_ok=True)
        path = d / f"open-receipts-{time.strftime('%Y%m%d')}.log"
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        return path
    except Exception:
        return None  # 文件落盘失败不挡响应(stdout 已留一份)


async def handle_open_receipt(request, logs_dir=None):
    """POST handler:bad json/缺 mode→400;合法→落盘+200 {"ok": true}。"""
    from aiohttp import web
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json body"}, status=400)
    payload = sanitize_receipt(body)
    if payload is None:
        return web.json_response({"error": "mode required"}, status=400)
    try:
        append_receipt(payload, logs_dir=logs_dir)
    except Exception:
        pass  # append_receipt 自守卫;此层再兜一道
    return web.json_response({"ok": True})


def install() -> None:
    """挂一条收据路由(幂等守卫;失败静默打印,不影响节点与出图)。"""
    global _installed
    if _installed:
        return
    try:
        from aiohttp import web
        from server import PromptServer

        @PromptServer.instance.routes.post(ROUTE_PATH)
        async def _open_receipt(request):
            return await handle_open_receipt(request)

        _installed = True
        print(f"{RECEIPT_TAG} 路由已挂载:{ROUTE_PATH}(POST)", flush=True)
    except Exception as error:  # noqa: BLE001 - 引擎侧任何失败不挡装载
        print(f"{RECEIPT_TAG} 路由挂载失败(不影响节点与出图): {error}", flush=True)
