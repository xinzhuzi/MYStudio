"""ComfyUI 任意工作流执行(09-08 二期收官/三期收官共用的后端执行端)。

契约(POST /comfy/execute,job 化):
    {"graph": {nodeId: {"class_type": str, "inputs": {...}}},
     "inputs": {"strings": {"nodeId.inputKey": "文本"},
                "images": [{"key": "nodeId.inputKey", "name": "x.png", "b64": "..."}]},
     "timeoutS": 300.0,        # 可选;长任务可放宽,上限 MAX_EXECUTE_TIMEOUT_S
     "extraPngInfo": {...}}    # 可选;UI 格式工作流附件,在场时并入 /prompt 的 extra_data.extra_pnginfo

流程:图校验 → 图片 b64 上传引擎(/upload/image)→ 字符串注入对应 widget →
引擎 /prompt 提交 → /history 轮询(超时默认 300s,payload.timeoutS 可放宽)→
输出图/音频 /view 取回 b64 数组(images+audios;纯音频工作流不再报"没有输出图片"),
PreviewAny 类 ui 文本原样内联回带(texts;纯记谱工作流同守卫放行)。
job 进度:上传 → 排队 → 执行中 → 收图(照 engine_manager 的 job 范式)。

License 边界(父任务裁定 3):与 ComfyUI 的全部交互面 = HTTP API 客户端,
HTTP 细节风格照既有 comfyui_bridge(urllib + multipart 上传 + history 轮询),
代码零拷贝;引擎无鉴权(Bearer 无需),端口经 comfyui_bridge.bridge_url()
的发现顺序(环境变量覆写 → comfy_manifest 实际端口 → 17598 回落)。
"""
from __future__ import annotations

import base64
import copy
import json
import math
import time
import uuid
from typing import Any
from urllib import error, parse, request

from comfyui.engine_manager import EngineOpError, jobs

# 执行总超时(排队+执行+收图;本地大图工作流可达分钟级,照桥 600s 收紧到 300s)
EXECUTE_TIMEOUT_S = 300.0
# 长任务经 payload.timeoutS 放宽的上限:14400s 罩住 multiseg 长镜档
# (40s 960P multiseg≈12600s+冷启+余量,10-27 §14.1.5 M2 裁定=2700→14400;
# 单段 H3 视频档 960P 21min+冷启 4min 仍在罩内;YuE2 音频整曲同罩内)
MAX_EXECUTE_TIMEOUT_S = 14400.0
HISTORY_POLL_INTERVAL_S = 1.0
# object_info 单类详情的 COMBO 选项截断上限(模型清单等长列表防几 MB 载荷)
OBJECT_INFO_MAX_OPTIONS = 500
# 输入图上传超时档位(10-29 T10②/G10):本机快超时保持存量 30s;远端引擎经
# LAN 传 MB 级参考图放宽到 90s(_upload_image 缺省=远端档;_execute_target
# 按解析出的 base 定档,本地链路显式传本机档)
UPLOAD_TIMEOUT_LOCAL_S = 30.0
UPLOAD_TIMEOUT_REMOTE_S = 90.0


def _engine_url() -> str:
    # 引擎地址发现单源:comfyui_bridge.bridge_url(env 覆写 → manifest 端口 → 17598)
    from engines.image_engine.comfyui_bridge import bridge_url

    return bridge_url().rstrip("/")


def _unreachable_error(url: str) -> EngineOpError:
    """引擎不可达大白话(10-29 T8 补尾/复核 gap1):含生效引擎 origin 与
    「任务或仍在原引擎执行」语义——已提交任务不因本机失联而消失,去原引擎查。
    origin 复用桥层 comfyui_bridge._url_origin 单源(懒 import 同 _engine_url
    的 bridge_url 先例,防 engines→comfyui 模块级环)。
    """
    from engines.image_engine.comfyui_bridge import _url_origin

    return EngineOpError(
        f"ComfyUI 引擎不可达({_url_origin(url)})——任务或仍在原引擎执行,"
        "远程地址请检查对端引擎/网络,本机请到 设置→本地配置 启动引擎"
    )


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
        raise _unreachable_error(url) from exc
    except (error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise _unreachable_error(url) from exc


def forward_engine_job_cancel(prompt_id: str, base: str | None = None) -> dict[str, Any]:
    """转发引擎原生按 ID 取消(幂等;终态/未知 prompt_id 引擎返 cancelled=False)。

    10-27 H3 双通道硬取消(Q2):与超时路径同款调用形态,供 sidecar 取消路由
    (image_gen/server.py POST /comfy/jobs/{id}/cancel)复用;连接异常原样上抛
    (EngineOpError),由路由层兜成 engine-unreachable 降级应答。

    base(10-29 T8/G7):显式引擎根地址(在跑任务入口解析一次后全程传入);
    None 回退逐次解析(存量外部调用零破坏)。
    """
    engine_base = base if base is not None else _engine_url()
    return _http_json("POST", f"{engine_base}/api/jobs/{parse.quote(prompt_id, safe='')}/cancel", {}, timeout=5)


def _decode_b64(value: str) -> bytes:
    raw = value.split(",", 1)[-1] if value.startswith("data:") else value
    try:
        return base64.b64decode(raw, validate=True)
    except (ValueError, TypeError) as exc:
        raise EngineOpError("注入图片数据无效(base64 解码失败)") from exc


def _upload_image(
    image_b64: str, filename: str, timeout: float = UPLOAD_TIMEOUT_REMOTE_S, base: str | None = None
) -> str:
    """图上传引擎 input 目录,返回 ComfyUI 可引用的文件名(含子目录)。

    timeout 缺省=远端档 90s(10-29 T10②/G10:LAN 传 MB 级参考图);本机链路
    由 _execute_target 按 base 定档显式传 30s(存量行为)。base=None 回退
    逐次解析(T8 参数化前存量)。
    """
    engine_base = base if base is not None else _engine_url()
    boundary = f"----mystudio-{uuid.uuid4().hex}"
    image = _decode_b64(image_b64)
    body = b"".join((
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n", image, b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    req = request.Request(
        f"{engine_base}/upload/image",
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


def _fetch_view(filename: str, subfolder: str, file_type: str, timeout: float = 30, base: str | None = None) -> str:
    """取回引擎输出文件 b64;base=None 回退逐次解析(T8 参数化前存量)。"""
    engine_base = base if base is not None else _engine_url()
    query = parse.urlencode({"filename": filename, "subfolder": subfolder, "type": file_type})
    try:
        with request.urlopen(f"{engine_base}/view?{query}", timeout=timeout) as response:
            return base64.b64encode(response.read()).decode("ascii")
    except (error.URLError, error.HTTPError, TimeoutError) as exc:
        raise EngineOpError("引擎输出文件读取失败(图片/音频)") from exc


def _history_collect(
    history: dict[str, Any], prompt_id: str
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """history 状态判定:pending / success(带输出图+音频+文本清单)/ error(抛大白话)。

    音频条目来自 SaveAudioAdvanced/SaveAudio 类节点的 ui["audio"](引擎核心
    comfy_api/_ui.py SavedAudios.as_dict → {"audio": [{filename, subfolder, type}]},
    与 images 同形状)。文本条目来自 PreviewAny 类节点的 ui["text"](纯 JSON 内联,
    history 原样带回,无需 /view;09-20 YuE2 出谱流接线)。视频条目来自 SaveVideo/
    VHS_VideoCombine 类节点的 ui["videos"](10-29 D1:远端引擎模式下产物回流;
    与 images 同形状 [{filename, subfolder, type}],/view 取回)。
    """
    entry = history.get(prompt_id)
    if not isinstance(entry, dict):
        return "pending", [], [], [], []
    status = entry.get("status", {})
    state = status.get("status_str")
    if state == "error":
        detail = str(status.get("messages", "ComfyUI 执行失败"))[:500]
        raise EngineOpError(f"ComfyUI 执行失败: {detail}")
    if state != "success":
        return "pending", [], [], [], []
    images: list[dict[str, Any]] = []
    audios: list[dict[str, Any]] = []
    texts: list[dict[str, Any]] = []
    videos: list[dict[str, Any]] = []
    for node_id, output in entry.get("outputs", {}).items():
        if not isinstance(output, dict):
            continue
        for image in output.get("images", []):
            if isinstance(image, dict) and isinstance(image.get("filename"), str):
                # 10-29 D1 修正:核心 SaveVideo 的 history 键=images 且带
                # metadata.kind=video(mp4 落在 images 里!);VHS_VideoCombine 才用
                # "videos" 键。按 kind/视频后缀分流进 videos 通道,回拉语义才正。
                meta = image.get("metadata")
                kind = meta.get("kind") if isinstance(meta, dict) else None
                fname = str(image["filename"]).lower()
                is_video = kind == "video" or fname.endswith((".mp4", ".webm", ".mov", ".mkv", ".avi"))
                bucket = videos if is_video else images
                bucket.append({
                    "nodeId": str(node_id),
                    "filename": image["filename"],
                    "subfolder": str(image.get("subfolder", "") or ""),
                    "type": str(image.get("type", "output") or "output"),
                })
        for audio in output.get("audio", []):
            if isinstance(audio, dict) and isinstance(audio.get("filename"), str):
                audios.append({
                    "nodeId": str(node_id),
                    "filename": audio["filename"],
                    "subfolder": str(audio.get("subfolder", "") or ""),
                    "type": str(audio.get("type", "output") or "output"),
                })
        for video in output.get("videos", []):
            if isinstance(video, dict) and isinstance(video.get("filename"), str):
                videos.append({
                    "nodeId": str(node_id),
                    "filename": video["filename"],
                    "subfolder": str(video.get("subfolder", "") or ""),
                    "type": str(video.get("type", "output") or "output"),
                })
        for text in output.get("text", []):
            if isinstance(text, str):
                texts.append({"nodeId": str(node_id), "text": text})
    return "success", images, audios, texts, videos


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
    for item in raw_images:
        # 注入图名会直写引擎 input 目录的文件名,禁止路径段(与
        # image_gen/server.py 的 /comfy/bridge/reference 同款拒绝)。
        if "/" in item["name"] or "\\" in item["name"] or ".." in item["name"]:
            raise ValueError("注入图片文件名不合法(禁止路径段)")
    return graph, strings, raw_images


def validate_extra_png_info(payload: dict[str, Any]) -> dict[str, Any] | None:
    """payload.extraPngInfo → UI 格式工作流附件(缺省 None;在场必须非空 dict)。

    附件透传引擎 /prompt 的 extra_data.extra_pnginfo(10-27 H3 双通道 D1 裁定):
    MyShot.run 读 extra_pnginfo["workflow"]["nodes"] 里本节点 properties 定回写
    归属项目,纯 API 直发不带附件=收不回;引擎自家前端 queuePrompt 即此通道。
    """
    raw = payload.get("extraPngInfo")
    if raw is None:
        return None
    if not isinstance(raw, dict) or not raw:
        raise ValueError("extraPngInfo 必须是非空对象")
    return raw


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
        if "/" in safe_name or "\\" in safe_name or ".." in safe_name:
            raise ValueError("注入图片文件名不合法(禁止路径段)")
        inputs[field] = uploader(item["b64"], safe_name)
        if on_progress:
            on_progress(index + 1, len(images))


def resolve_execute_timeout_s(payload: dict[str, Any]) -> float:
    """payload.timeoutS → 生效超时秒数(纯函数,单测覆盖)。

    缺省/非法/非正数 → EXECUTE_TIMEOUT_S;超过 MAX_EXECUTE_TIMEOUT_S 钳到上限
    (防调用方笔误把轮询挂成半天)。
    """
    raw = payload.get("timeoutS")
    if raw is None or isinstance(raw, bool):
        return EXECUTE_TIMEOUT_S
    try:
        value = float(raw)
    except (TypeError, ValueError, OverflowError):
        return EXECUTE_TIMEOUT_S
    if not math.isfinite(value) or value <= 0:
        return EXECUTE_TIMEOUT_S
    return min(value, MAX_EXECUTE_TIMEOUT_S)


def resolve_upload_timeout_s(base: str) -> float:
    """上传超时按引擎 base 定档(纯函数,单测覆盖;10-29 T10②/G10)。

    本机(127.0.0.1/localhost/::1)=30s 保持存量快超时;其余(远端 LAN)
    =90s。base 由调用方解析传入(与 T8 的 base 固定化同源)。
    """
    host = (parse.urlparse(base).hostname or "").lower()
    return UPLOAD_TIMEOUT_LOCAL_S if host in ("127.0.0.1", "localhost", "::1") else UPLOAD_TIMEOUT_REMOTE_S


# ── job 化执行入口 ─────────────────────────────────────────────────

def execute_job(payload: dict[str, Any]) -> str:
    """提交执行 job(进度:上传/排队/执行中/收图);返回 jobId。"""
    graph, strings, images = validate_execute_request(payload)
    timeout_s = resolve_execute_timeout_s(payload)
    extra_png_info = validate_extra_png_info(payload)
    # 按需启动(09-08 补口):工作流节点/子图运行前,引擎装了没跑→先拉起
    from comfyui import engine_manager as _em
    _em.engine_manager().ensure_engine_ready()
    job_id = jobs.create("comfy-execute", "准备执行 ComfyUI 工作流")
    jobs.start(job_id, lambda jid: _execute_target(jid, graph, strings, images, timeout_s, extra_png_info))
    return job_id


def _execute_target(
    job_id: str,
    graph: dict[str, Any],
    strings: dict[str, str],
    images: list[dict[str, Any]],
    timeout_s: float = EXECUTE_TIMEOUT_S,
    extra_png_info: dict[str, Any] | None = None,
) -> None:
    # T8/G7 竞态拆雷:base 入口一次解析,上传/提交/轮询/取消/取产物全程同一
    # 引擎——执行中改设置(切换引擎地址)不再让在跑任务逐次重解析打到新引擎
    # 变孤儿(旧任务的结果/取消仍回旧引擎)。
    base = _engine_url()
    upload_timeout = resolve_upload_timeout_s(base)
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

        def _uploader(image_b64: str, filename: str) -> str:
            # base/timeout 逐 job 固定(T8+T10②):本机 30s 存量档,远端 90s
            return _upload_image(image_b64, filename, timeout=upload_timeout, base=base)

        apply_image_injections(graph, images, _uploader, _on_upload)

        # 2. 字符串注入
        apply_string_injections(graph, strings)

        # 3. 提交(/prompt;400 体带 node_errors 翻译成大白话)
        jobs.update(job_id, progress=30, step="queue", message="提交工作流到引擎…")
        client_id = uuid.uuid4().hex
        prompt_body: dict[str, Any] = {"prompt": graph, "client_id": client_id}
        if extra_png_info is not None:
            prompt_body["extra_data"] = {"extra_pnginfo": extra_png_info}
        submitted = _http_json("POST", f"{base}/prompt", prompt_body, timeout=30)
        node_errors = submitted.get("node_errors")
        prompt_id = submitted.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id.strip():
            if node_errors:
                raise EngineOpError(f"引擎拒绝工作流: {str(node_errors)[:500]}")
            raise EngineOpError("引擎未返回任务编号")
        warnings = []
        if node_errors:
            warning = f"任务 {prompt_id} 部分输出校验失败,继续跟踪已接受输出: {str(node_errors)[:500]}"
            warnings.append(warning)
            jobs.update(job_id, tail_line=warning)
        accepted = {"promptId": prompt_id, "nodeErrors": node_errors or {}, "warnings": warnings}
        jobs.update(job_id, result=accepted, complete=False)

        # 4. 轮询 history(执行中;进度按耗时线性爬到 90)
        jobs.update(job_id, progress=35, step="running", message="引擎执行中…")
        deadline = time.monotonic() + timeout_s
        outputs: list[dict[str, Any]] = []
        audio_outputs: list[dict[str, Any]] = []
        text_outputs: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            state, outputs, audio_outputs, text_outputs, video_outputs = _history_collect(
                _http_json("GET", f"{base}/history/{prompt_id}", timeout=10), prompt_id
            )
            if state == "success":
                break
            elapsed_ratio = min(0.55, (time.monotonic() - (deadline - timeout_s)) / timeout_s)
            jobs.update(job_id, progress=int(35 + elapsed_ratio * 100), message="引擎执行中…")
            time.sleep(HISTORY_POLL_INTERVAL_S)
        else:
            try:
                # 原生按 ID 取消同时覆盖等待/运行态,避免全局 interrupt 误伤其他任务。
                # base 固定传参(T8):超时清理打回提交时的同一引擎。
                forward_engine_job_cancel(prompt_id, base=base)
            except Exception:
                pass  # 中断是清理性的,超时契约对调用方才是权威
            raise EngineOpError(
                f"ComfyUI 执行超时({math.ceil(timeout_s)} 秒),请检查引擎队列后重试"
            )

        # 5. 收图/收音频/收视频(/view 取 b64)+ 收文本(纯 JSON 内联,PreviewAny 类产物)
        if not outputs and not audio_outputs and not text_outputs and not video_outputs:
            raise EngineOpError("工作流已完成但没有输出图片/音频/视频(缺 SaveImage/SaveAudio/SaveVideo 类输出节点?)")
        collected: list[dict[str, Any]] = []
        for index, item in enumerate(outputs):
            jobs.update(job_id, progress=int(90 + index / max(1, len(outputs)) * 8), step="collect", message=f"取回输出图 {index + 1}/{len(outputs)}…")
            collected.append({
                "nodeId": item["nodeId"],
                "filename": item["filename"],
                "subfolder": item["subfolder"],
                "type": item["type"],
                "b64": _fetch_view(item["filename"], item["subfolder"], item["type"], base=base),
            })
        audio_collected: list[dict[str, Any]] = []
        for index, item in enumerate(audio_outputs):
            jobs.update(job_id, progress=int(94 + index / max(1, len(audio_outputs)) * 4), step="collect", message=f"取回输出音频 {index + 1}/{len(audio_outputs)}…")
            audio_collected.append({
                "nodeId": item["nodeId"],
                "filename": item["filename"],
                "subfolder": item["subfolder"],
                "type": item["type"],
                "b64": _fetch_view(item["filename"], item["subfolder"], item["type"], base=base),
            })
        # 视频产物(10-29 D1:SaveVideo/VHS 类;远端引擎模式产物回流主通道)。
        # 视频体积 MB 级,fetch timeout 放宽到 120s(b64 在 JSON 结果内回传,
        # 与 images 同机制;超大文件产线直投走文件位属后续优化)。
        video_collected: list[dict[str, Any]] = []
        for index, item in enumerate(video_outputs):
            jobs.update(job_id, progress=98, step="collect", message=f"取回输出视频 {index + 1}/{len(video_outputs)}…")
            video_collected.append({
                "nodeId": item["nodeId"],
                "filename": item["filename"],
                "subfolder": item["subfolder"],
                "type": item["type"],
                "b64": _fetch_view(item["filename"], item["subfolder"], item["type"], timeout=120, base=base),
            })
        jobs.update(
            job_id,
            result={**accepted, "images": collected, "audios": audio_collected, "texts": text_outputs, "videos": video_collected},
        )
    except (EngineOpError, ValueError) as exc:
        jobs.update(job_id, error=str(exc))
    except Exception as exc:  # noqa: BLE001 — 面向前端的大白话兜底
        jobs.update(job_id, error=f"执行失败: {exc}")


# ── object_info 单类详情(三期B 通用节点直放的 schema 拉取) ──────────

def _trim_options(spec: Any, default: Any = None) -> Any:
    """COMBO 选项截断(模型清单可达数千项;截断保载荷有界,缺省值永不截掉)。"""
    if not isinstance(spec, list):
        return spec
    if len(spec) <= OBJECT_INFO_MAX_OPTIONS:
        return spec
    trimmed = spec[:OBJECT_INFO_MAX_OPTIONS]
    if default in spec and default not in trimmed:
        trimmed[-1] = default
    return trimmed


def trim_object_info_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """object_info 单类条目瘦身:保留 input/output/name/category/description,COMBO 截断。"""
    trimmed: dict[str, Any] = {}
    for field in (
        "input", "input_order", "output", "output_name", "output_is_list",
        "output_node", "name", "display_name", "category", "description",
    ):
        if field in entry:
            trimmed[field] = copy.deepcopy(entry[field])
    raw_input = trimmed.get("input")
    if isinstance(raw_input, dict):
        # 原生 schema 用 required/optional/hidden 分组;兼容既有扁平格式。
        groups = [raw_input] + [
            raw_input[group] for group in ("required", "optional", "hidden")
            if isinstance(raw_input.get(group), dict)
        ]
        for group in groups:
            for value in group.values():
                if isinstance(value, list) and value and isinstance(value[0], list):
                    metadata = value[1] if len(value) > 1 and isinstance(value[1], dict) else {}
                    value[0] = _trim_options(value[0], metadata.get("default"))
    return trimmed


def object_info_detail(class_type: str) -> dict[str, Any]:
    """引擎 /object_info 单类条目(通用节点直放:端口/widget 配方数据源)。"""
    info = _http_json("GET", f"{_engine_url()}/object_info/{parse.quote(class_type)}", timeout=30)
    entry = info.get(class_type) if isinstance(info, dict) else None
    if not isinstance(entry, dict):
        raise EngineOpError(f"引擎没有名为 {class_type} 的节点(插件可能被卸载或改名)")
    return trim_object_info_entry(entry)
