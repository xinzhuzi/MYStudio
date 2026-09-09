"""ComfyUI 任意工作流执行(09-08 二期收官/三期收官共用的后端执行端)。

契约(POST /comfy/execute,job 化):
    {"graph": {nodeId: {"class_type": str, "inputs": {...}}},
     "inputs": {"strings": {"nodeId.inputKey": "文本"},
                "images": [{"key": "nodeId.inputKey", "name": "x.png", "b64": "..."}]}}

流程:图校验 → 图片 b64 上传引擎(/upload/image)→ 字符串注入对应 widget →
引擎 /prompt 提交 → /history 轮询(超时 300s)→ 输出图 /view 取回 b64 数组。
job 进度:上传 → 排队 → 执行中 → 收图(照 engine_manager 的 job 范式)。

License 边界(父任务裁定 3):与 ComfyUI 的全部交互面 = HTTP API 客户端,
HTTP 细节风格照既有 comfyui_bridge(urllib + multipart 上传 + history 轮询),
代码零拷贝;引擎无鉴权(Bearer 无需),端口经 comfyui_bridge.bridge_url()
的发现顺序(环境变量覆写 → comfy_manifest 实际端口 → 17598 回落)。
"""
from __future__ import annotations

import base64
import json
import time
import uuid
from typing import Any
from urllib import error, parse, request

from engines.comfyui.engine_manager import EngineOpError, jobs

# 执行总超时(排队+执行+收图;本地大图工作流可达分钟级,照桥 600s 收紧到 300s)
EXECUTE_TIMEOUT_S = 300.0
HISTORY_POLL_INTERVAL_S = 1.0
# object_info 单类详情的 COMBO 选项截断上限(模型清单等长列表防几 MB 载荷)
OBJECT_INFO_MAX_OPTIONS = 500


def _engine_url() -> str:
    # 引擎地址发现单源:comfyui_bridge.bridge_url(env 覆写 → manifest 端口 → 17598)
    from image_gen.providers.comfyui_bridge import bridge_url

    return bridge_url().rstrip("/")


def _http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: float = 10) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        if method.upper() == "POST" and url.rstrip("/").endswith("/prompt"):
            # /prompt 400 = 节点校验失败(JSON 体带 node_errors),透传给上层翻译
            try:
                return json.loads(exc.read().decode("utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                pass
        if exc.code == 404 and "/object_info/" in url:
            # 单类详情 404 = 引擎没有该节点(插件被卸载/改名),交上层给大白话
            return {}
        raise EngineOpError("ComfyUI 引擎没在运行,请到 设置→本地配置 启动引擎") from exc
    except (error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise EngineOpError("ComfyUI 引擎没在运行,请到 设置→本地配置 启动引擎") from exc


def _decode_b64(value: str) -> bytes:
    raw = value.split(",", 1)[-1] if value.startswith("data:") else value
    try:
        return base64.b64decode(raw, validate=True)
    except (ValueError, TypeError) as exc:
        raise EngineOpError("注入图片数据无效(base64 解码失败)") from exc


def _upload_image(image_b64: str, filename: str, timeout: float = 30) -> str:
    """图上传引擎 input 目录,返回 ComfyUI 可引用的文件名(含子目录)。"""
    boundary = f"----mystudio-{uuid.uuid4().hex}"
    image = _decode_b64(image_b64)
    body = b"".join((
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n", image, b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    req = request.Request(
        f"{_engine_url()}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            reply = json.loads(response.read().decode("utf-8"))
    except (error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        raise EngineOpError("参考图上传引擎失败(引擎可能没在运行)") from exc
    name = reply.get("name") if isinstance(reply, dict) else None
    if not isinstance(name, str) or not name:
        raise EngineOpError("引擎未返回上传文件名")
    subfolder = reply.get("subfolder") or ""
    return f"{subfolder}/{name}" if subfolder else name


def _fetch_view(filename: str, subfolder: str, file_type: str, timeout: float = 30) -> str:
    query = parse.urlencode({"filename": filename, "subfolder": subfolder, "type": file_type})
    try:
        with request.urlopen(f"{_engine_url()}/view?{query}", timeout=timeout) as response:
            return base64.b64encode(response.read()).decode("ascii")
    except (error.URLError, error.HTTPError, TimeoutError) as exc:
        raise EngineOpError("引擎输出图片读取失败") from exc


def _history_collect(history: dict[str, Any], prompt_id: str) -> tuple[str, list[dict[str, Any]]]:
    """history 状态判定:pending / success(带输出图清单)/ error(抛大白话)。"""
    entry = history.get(prompt_id)
    if not isinstance(entry, dict):
        return "pending", []
    status = entry.get("status", {})
    state = status.get("status_str")
    if state == "error":
        detail = str(status.get("messages", "ComfyUI 执行失败"))[:500]
        raise EngineOpError(f"ComfyUI 执行失败: {detail}")
    if state != "success":
        return "pending", []
    images: list[dict[str, Any]] = []
    for node_id, output in entry.get("outputs", {}).items():
        if not isinstance(output, dict):
            continue
        for image in output.get("images", []):
            if isinstance(image, dict) and isinstance(image.get("filename"), str):
                images.append({
                    "nodeId": str(node_id),
                    "filename": image["filename"],
                    "subfolder": str(image.get("subfolder", "") or ""),
                    "type": str(image.get("type", "output") or "output"),
                })
    return "success", images


# ── 纯函数(单测覆盖):请求体校验与注入 ─────────────────────────────

def validate_execute_request(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """校验并拆出 (graph, strings, images)。非法形状给大白话 ValueError。"""
    graph = payload.get("graph")
    if not isinstance(graph, dict) or not graph:
        raise ValueError("graph 必须是非空对象(API 格式工作流)")
    for node_id, node in graph.items():
        if not isinstance(node, dict) or not isinstance(node.get("class_type"), str) or not node.get("class_type"):
            raise ValueError(f"工作流节点 {node_id} 缺少 class_type")
        if not isinstance(node.get("inputs", {}), dict):
            raise ValueError(f"工作流节点 {node_id} 的 inputs 必须是对象")
    raw_inputs = payload.get("inputs") or {}
    if not isinstance(raw_inputs, dict):
        raise ValueError("inputs 必须是对象")
    strings = raw_inputs.get("strings") or {}
    if not isinstance(strings, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in strings.items()
    ):
        raise ValueError("inputs.strings 必须是 {注入点: 文本} 对象")
    raw_images = raw_inputs.get("images") or []
    if not isinstance(raw_images, list) or not all(
        isinstance(item, dict)
        and isinstance(item.get("key"), str)
        and isinstance(item.get("name"), str)
        and isinstance(item.get("b64"), str)
        for item in raw_images
    ):
        raise ValueError("inputs.images 必须是 [{key, name, b64}] 数组")
    return graph, strings, raw_images


def _split_injection_key(key: str) -> tuple[str, str]:
    parts = key.split(".", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f"注入点格式不对(应为 节点号.字段名): {key}")
    return parts[0], parts[1]


def apply_string_injections(graph: dict[str, Any], strings: dict[str, str]) -> None:
    """字符串注入:节点必须存在且字段必须在工作流里(防 descriptor 漂移静默加参)。"""
    for key, value in strings.items():
        node_id, field = _split_injection_key(key)
        node = graph.get(node_id)
        if not isinstance(node, dict):
            raise ValueError(f"注入点 {key} 不在工作流里(节点 {node_id} 不存在)")
        inputs = node.setdefault("inputs", {})
        if field not in inputs:
            raise ValueError(f"注入点 {key} 不在工作流里(节点 {node_id} 没有 {field} 字段)")
        inputs[field] = value


def apply_image_injections(
    graph: dict[str, Any],
    images: list[dict[str, Any]],
    uploader,
    on_progress=None,
) -> None:
    """图片注入:逐张上传引擎并写回文件名;on_progress(已完成数, 总数) 供进度。"""
    for index, item in enumerate(images):
        node_id, field = _split_injection_key(item["key"])
        node = graph.get(node_id)
        if not isinstance(node, dict):
            raise ValueError(f"注入点 {item['key']} 不在工作流里(节点 {node_id} 不存在)")
        inputs = node.setdefault("inputs", {})
        if field not in inputs:
            raise ValueError(f"注入点 {item['key']} 不在工作流里(节点 {node_id} 没有 {field} 字段)")
        safe_name = item["name"] or f"mystudio-input-{index}.png"
        inputs[field] = uploader(item["b64"], safe_name)
        if on_progress:
            on_progress(index + 1, len(images))


# ── job 化执行入口 ─────────────────────────────────────────────────

def execute_job(payload: dict[str, Any]) -> str:
    """提交执行 job(进度:上传/排队/执行中/收图);返回 jobId。"""
    graph, strings, images = validate_execute_request(payload)
    # 按需启动(09-08 补口):工作流节点/子图运行前,引擎装了没跑→先拉起
    from engines.comfyui import engine_manager as _em
    _em.engine_manager().ensure_engine_ready()
    job_id = jobs.create("comfy-execute", "准备执行 ComfyUI 工作流")
    jobs.start(job_id, lambda jid: _execute_target(jid, graph, strings, images))
    return job_id


def _execute_target(job_id: str, graph: dict[str, Any], strings: dict[str, str], images: list[dict[str, Any]]) -> None:
    try:
        # 1. 上传(逐张推进度;无图直过)
        jobs.update(
            job_id,
            progress=5,
            step="upload",
            message=f"上传 {len(images)} 张输入图…" if images else "无输入图,直接提交",
        )

        def _on_upload(done: int, total: int) -> None:
            jobs.update(job_id, progress=5 + int(done / max(1, total) * 20), message=f"上传输入图 {done}/{total}…")

        apply_image_injections(graph, images, _upload_image, _on_upload)

        # 2. 字符串注入
        apply_string_injections(graph, strings)

        # 3. 提交(/prompt;400 体带 node_errors 翻译成大白话)
        jobs.update(job_id, progress=30, step="queue", message="提交工作流到引擎…")
        client_id = uuid.uuid4().hex
        submitted = _http_json("POST", f"{_engine_url()}/prompt", {"prompt": graph, "client_id": client_id}, timeout=30)
        node_errors = submitted.get("node_errors")
        if node_errors:
            raise EngineOpError(f"引擎拒绝工作流: {str(node_errors)[:500]}")
        prompt_id = submitted.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise EngineOpError("引擎未返回任务编号")

        # 4. 轮询 history(执行中;进度按耗时线性爬到 90)
        jobs.update(job_id, progress=35, step="running", message="引擎执行中…")
        deadline = time.monotonic() + EXECUTE_TIMEOUT_S
        outputs: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            state, outputs = _history_collect(
                _http_json("GET", f"{_engine_url()}/history/{prompt_id}", timeout=10), prompt_id
            )
            if state == "success":
                break
            elapsed_ratio = min(0.55, (time.monotonic() - (deadline - EXECUTE_TIMEOUT_S)) / EXECUTE_TIMEOUT_S)
            jobs.update(job_id, progress=int(35 + elapsed_ratio * 100), message="引擎执行中…")
            time.sleep(HISTORY_POLL_INTERVAL_S)
        else:
            try:
                _http_json("POST", f"{_engine_url()}/interrupt", {"client_id": client_id}, timeout=5)
            except Exception:
                pass  # 中断是清理性的,超时契约对调用方才是权威
            raise EngineOpError("ComfyUI 执行超时(300 秒),请检查引擎队列后重试")

        # 5. 收图(/view 取 b64)
        if not outputs:
            raise EngineOpError("工作流已完成但没有输出图片(缺 SaveImage 类输出节点?)")
        collected: list[dict[str, Any]] = []
        for index, item in enumerate(outputs):
            jobs.update(job_id, progress=int(90 + index / max(1, len(outputs)) * 8), step="collect", message=f"取回输出图 {index + 1}/{len(outputs)}…")
            collected.append({
                "nodeId": item["nodeId"],
                "filename": item["filename"],
                "subfolder": item["subfolder"],
                "type": item["type"],
                "b64": _fetch_view(item["filename"], item["subfolder"], item["type"]),
            })
        jobs.update(job_id, result={"promptId": prompt_id, "images": collected})
    except (EngineOpError, ValueError) as exc:
        jobs.update(job_id, error=str(exc))
    except Exception as exc:  # noqa: BLE001 — 面向前端的大白话兜底
        jobs.update(job_id, error=f"执行失败: {exc}")


# ── object_info 单类详情(三期B 通用节点直放的 schema 拉取) ──────────

def _trim_options(spec: Any) -> Any:
    """COMBO 选项截断(模型清单可达数千项;截断保载荷有界,缺省值永不截掉)。"""
    if not isinstance(spec, list) or not spec or not all(isinstance(x, str) for x in spec):
        return spec
    if len(spec) <= OBJECT_INFO_MAX_OPTIONS:
        return spec
    default_marker = [x for x in spec[:1]]
    trimmed = spec[:OBJECT_INFO_MAX_OPTIONS]
    for marker in default_marker:
        if marker not in trimmed:
            trimmed.append(marker)
    return trimmed


def trim_object_info_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """object_info 单类条目瘦身:保留 input/output/name/category/description,COMBO 截断。"""
    trimmed: dict[str, Any] = {}
    for field in ("input", "output", "output_name", "name", "category", "description"):
        if field in entry:
            trimmed[field] = entry[field]
    raw_input = entry.get("input")
    if isinstance(raw_input, dict):
        safe_input: dict[str, Any] = {}
        for key, value in raw_input.items():
            if isinstance(value, list) and value:
                first = value[0]
                if isinstance(first, list) and first and all(isinstance(x, str) for x in first) and len(value) == 1:
                    # [[...]] 形状的 COMBO:选项列表本身截断
                    safe_input[key] = [_trim_options(first)] + list(value[1:])
                else:
                    safe_input[key] = list(value)
            else:
                safe_input[key] = value
        trimmed["input"] = safe_input
    return trimmed


def object_info_detail(class_type: str) -> dict[str, Any]:
    """引擎 /object_info 单类条目(通用节点直放:端口/widget 配方数据源)。"""
    info = _http_json("GET", f"{_engine_url()}/object_info/{parse.quote(class_type)}", timeout=30)
    entry = info.get(class_type) if isinstance(info, dict) else None
    if not isinstance(entry, dict):
        raise EngineOpError(f"引擎没有名为 {class_type} 的节点(插件可能被卸载或改名)")
    return trim_object_info_entry(entry)
