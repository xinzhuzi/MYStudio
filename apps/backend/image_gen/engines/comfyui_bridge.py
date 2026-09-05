"""ComfyUI REST bridge for versioned, repository-owned image workflows.

The bridge deliberately has no local model loading.  It only talks to an
already-running ComfyUI instance and fails closed when its template contract
or response contract is not met.
"""
from __future__ import annotations

import base64
import copy
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib import error, parse, request

MODEL_NAME = "comfyui-bridge"
LAYOUT = "comfyui-bridge"
SUPPORTS_REFERENCE = True
SUPPORTS_MULTI_REFERENCE = True

SPEC = {
    "label": "ComfyUI 桥接（多参考编辑）",
    "repo_id": "ComfyUI 服务(本机)",
    "repo_ids": ("ComfyUI 服务(本机)",),
    "size_mb": 0,
    "license": "本机 ComfyUI 配置",
    "steps": 8,
    "description": "连接已运行的 ComfyUI，支持仓内白名单工作流和最多四张参考图",
    "layout": LAYOUT,
}

ASPECT_RATIOS = {
    "1:1": (1024, 1024), "16:9": (1152, 640), "9:16": (640, 1152),
    "4:3": (1072, 808), "3:4": (808, 1072),
}
_WORKFLOWS_DIR = Path(__file__).resolve().parent.parent / "workflows"
_REQUIRED_TEMPLATES = ("krea2_t2i", "krea2_edit_ref", "krea2_nsfw_pro", "krea2_uncloth_instruct")


def _version_tuple(value: Any) -> tuple[int, ...]:
    numbers = re.findall(r"\d+", str(value))
    return tuple(int(number) for number in numbers[:3]) or (0,)


def _warn_if_version_below_min(stats: dict[str, Any], template: dict[str, Any]) -> None:
    minimum = template.get("comfyuiVersionMin")
    actual = stats.get("comfyui_version")
    if minimum and actual and _version_tuple(actual) < _version_tuple(minimum):
        print(
            f"[image-sidecar] comfyui-bridge: ComfyUI {actual} is below template minimum {minimum}; continuing for compatibility",
            flush=True,
        )


def bridge_url() -> str:
    # 17598 is the current local ComfyUI service port; deployments may override
    # it without changing the bundled bridge contract.
    return os.environ.get("MYSTUDIO_COMFYUI_BRIDGE_URL", "http://127.0.0.1:17598").rstrip("/")


def _pipeline_error(code: str, message: str) -> Exception:
    # Deferred import prevents an engines -> pipeline import cycle at startup.
    from ..pipeline import PipelineError
    return PipelineError(code, message)


def _http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: float = 2) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        if exc.code == 404 and method.upper() == "GET" and "/history/" in url:
            # A prompt can be submitted before ComfyUI has materialized its
            # history entry.  Treat that short window as queued, not offline.
            return {}
        # ComfyUI reports workflow/node validation failures as HTTP 400 with
        # a JSON body; preserve it so generate() can map node_errors to the
        # bridge-execution-failed contract instead of hiding it as unreachable.
        if method.upper() == "POST" and url.rstrip("/").endswith("/prompt"):
            try:
                return json.loads(exc.read().decode("utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                pass
        raise _pipeline_error("bridge-unreachable", "ComfyUI 没在运行，请先打开它再试") from exc
    except (error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise _pipeline_error("bridge-unreachable", "ComfyUI 没在运行，请先打开它再试") from exc


def _decode_reference(reference_b64: str) -> bytes:
    raw = reference_b64.split(",", 1)[-1] if reference_b64.startswith("data:") else reference_b64
    try:
        return base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise _pipeline_error("bridge-execution-failed", "参考图数据无效") from exc


def _upload_image(url: str, reference_b64: str, filename: str, timeout: float = 20) -> dict[str, Any]:
    boundary = f"----mystudio-{uuid.uuid4().hex}"
    image = _decode_reference(reference_b64)
    body = b"".join((
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n", image, b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    req = request.Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        raise _pipeline_error("bridge-unreachable", "ComfyUI 没在运行，请先打开它再试") from exc


def _fetch_bytes(url: str, timeout: float = 30) -> bytes:
    try:
        with request.urlopen(url, timeout=timeout) as response:
            return response.read()
    except (error.URLError, error.HTTPError, TimeoutError) as exc:
        raise _pipeline_error("bridge-execution-failed", "ComfyUI 输出图片读取失败") from exc


def _template_path(name: str) -> Path:
    return _WORKFLOWS_DIR / f"{name}.json"


def load_template(name: str) -> dict[str, Any]:
    try:
        template = json.loads(_template_path(name).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise _pipeline_error("bridge-template-missing", f"ComfyUI 工作流模板不可用: {name}") from exc
    if template.get("schemaVersion") != 1 or not isinstance(template.get("graph"), dict) or not isinstance(template.get("inputs"), dict):
        raise _pipeline_error("bridge-template-missing", f"ComfyUI 工作流模板格式无效: {name}")
    for key, binding in template["inputs"].items():
        bindings = binding if key == "references" else [binding]
        if not isinstance(bindings, list):
            bindings = [bindings]
        for item in bindings:
            node = template["graph"].get(str(item.get("node"))) if isinstance(item, dict) else None
            expected_class = item.get("class_type") if isinstance(item, dict) else None
            if (
                not isinstance(node, dict)
                or not node.get("class_type")
                or not isinstance(node.get("inputs"), dict)
                or not item.get("field")
                or not isinstance(expected_class, str)
                or node.get("class_type") != expected_class
            ):
                raise _pipeline_error("bridge-template-missing", f"ComfyUI 工作流节点缺失: {name}:{key}")
    if not any(node.get("class_type") == "SaveImage" for node in template["graph"].values() if isinstance(node, dict)):
        raise _pipeline_error("bridge-template-missing", f"ComfyUI 工作流缺少 SaveImage: {name}")
    return template


def _set_input(graph: dict[str, Any], binding: dict[str, str], value: Any) -> None:
    graph[str(binding["node"])]["inputs"][binding["field"]] = value


def instantiate_template(template: dict[str, Any], prompt: str, negative_prompt: str | None, steps: int, seed: int | None, aspect_ratio: str, reference_names: list[str]) -> dict[str, Any]:
    graph = copy.deepcopy(template["graph"])
    bindings = template["inputs"]
    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])
    values = {"prompt": prompt, "negative_prompt": negative_prompt or "", "steps": steps, "width": width, "height": height}
    if seed is not None:
        values["seed"] = seed
    for name, value in values.items():
        if name in bindings:
            _set_input(graph, bindings[name], value)
    for index, binding in enumerate(bindings.get("references", [])):
        slot = binding.get("slot", index)
        if isinstance(slot, int) and 0 <= slot < len(reference_names):
            _set_input(graph, binding, reference_names[slot])
    if len(reference_names) < 2 and template.get("name") == "krea2_edit_ref":
        # The second Krea2 reference path is optional.  Remove its whole
        # LoadImage → scale → VAE chain for single-reference requests so an
        # empty LoadImage widget can never reach ComfyUI validation.
        for node_id in ("46", "52", "53"):
            graph.pop(node_id, None)
        for node_id in ("34", "36"):
            graph.get(node_id, {}).get("inputs", {}).pop("image_b", None)
        graph.get("35", {}).get("inputs", {}).pop("source_latent_b", None)
        graph.get("35", {}).get("inputs", {}).pop("source_image_b", None)
    return graph


def _template_status() -> dict[str, Any]:
    missing: list[str] = []
    for name in _REQUIRED_TEMPLATES:
        try:
            load_template(name)
        except Exception:
            missing.append(name)
    return {"ready": not missing, "missing": missing, "snapshot_dirs": {}}


def resolve_big_files(models_dir: Path | None = None, cache_dir: Path | None = None) -> dict[str, Any] | None:
    try:
        stats = _http_json("GET", f"{bridge_url()}/system_stats")
    except Exception:
        return None
    version = stats.get("comfyui_version") or stats.get("system", {}).get("comfyui_version")
    return {"source": "comfyui-service", "cache_dir": bridge_url(), "size_mb": 0, "comfyui_version": str(version or "unknown")}


def find_cached(models_dir: Path | None = None, cache_dir: Path | None = None) -> dict[str, Any] | None:
    resolved = resolve_big_files(models_dir, cache_dir)
    if not resolved:
        return None
    host = parse.urlparse(bridge_url()).netloc
    return {"repo_id": f"comfyui-service:{host}", "cache_dir": resolved["cache_dir"], "repo_cache_dir": resolved["cache_dir"], "size_mb": 0}


def small_pieces_status(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return _template_status()


def fetch_small_pieces(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return _template_status()


def _history_output(history: dict[str, Any], prompt_id: str) -> tuple[str, dict[str, Any] | None]:
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
    for output in entry.get("outputs", {}).values():
        images = output.get("images", []) if isinstance(output, dict) else []
        if images:
            return "success", images[0]
    return "success", None


def generate(prompt: str, aspect_ratio: str, negative_prompt: str | None, steps: int, seed: int | None, reference_b64: str | None = None, **ctx: Any) -> str:
    stats = resolve_big_files()
    if not stats:
        raise _pipeline_error("bridge-unreachable", "ComfyUI 没在运行，请先打开它再试")
    references = list(ctx.get("reference_images_b64") or ([] if not reference_b64 else [reference_b64]))[:4]
    # 模板路由(design §5,优先级从上到下):有参考图→编辑流(use_lora 忽略,
    # 分镜一致性优先);无参考且 use_lora→NSFW 专业流(D5 开关,默认关);其余→文生图
    use_lora = bool(ctx.get("use_lora"))
    # 指定模板(09-05 无衣物·指令编辑节点):调用方显式点名时优先于自动路由
    forced_template = ctx.get("template") if isinstance(ctx.get("template"), str) else None
    if forced_template:
        template_name = forced_template
    elif references:
        template_name = "krea2_edit_ref"
        if use_lora:
            print("[image-sidecar] comfyui-bridge: use_lora 在编辑流中被忽略(参考图优先)", flush=True)
    elif use_lora:
        template_name = "krea2_nsfw_pro"
    else:
        template_name = "krea2_t2i"
    if template_name != "krea2_t2i" and not references and template_name != "krea2_nsfw_pro":
        raise _pipeline_error("bridge-template-missing", f"模板需要参考图: {template_name}")
    template = load_template(template_name)
    _warn_if_version_below_min(stats, template)
    uploaded = []
    for image in references:
        response = _upload_image(
            f"{bridge_url()}/upload/image",
            image,
            f"mystudio-bridge-{uuid.uuid4().hex[:8]}.png",
        )
        name = response.get("name")
        if not isinstance(name, str) or not name:
            raise _pipeline_error("bridge-execution-failed", "ComfyUI 未返回参考图文件名")
        subfolder = response.get("subfolder") or ""
        uploaded.append(f"{subfolder}/{name}" if subfolder else name)
    graph = instantiate_template(template, prompt, negative_prompt, steps, seed, aspect_ratio, uploaded)
    client_id = str(uuid.uuid4())
    submitted = _http_json("POST", f"{bridge_url()}/prompt", {"prompt": graph, "client_id": client_id}, timeout=20)
    if submitted.get("node_errors"):
        raise _pipeline_error("bridge-execution-failed", f"ComfyUI 拒绝工作流: {str(submitted['node_errors'])[:500]}")
    prompt_id = submitted.get("prompt_id")
    if not isinstance(prompt_id, str) or not prompt_id:
        raise _pipeline_error("bridge-execution-failed", "ComfyUI 未返回任务编号")
    timeout_s = float(os.environ.get("MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S", "600"))
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        state, image = _history_output(_http_json("GET", f"{bridge_url()}/history/{prompt_id}", timeout=5), prompt_id)
        if state == "success":
            if not image:
                raise _pipeline_error("bridge-no-output", "ComfyUI 已完成但没有输出图片")
            query = parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": image.get("type", "output")})
            return base64.b64encode(_fetch_bytes(f"{bridge_url()}/view?{query}")).decode("ascii")
        time.sleep(1)
    try:
        _http_json("POST", f"{bridge_url()}/interrupt", {"client_id": client_id}, timeout=5)
    except Exception:
        # Interrupt is cleanup-only.  A ComfyUI instance may reject it after
        # the job has already left the queue; the timeout contract remains
        # authoritative for the caller.
        pass
    raise _pipeline_error("bridge-timeout", "ComfyUI 生成超时，请检查队列后重试")
