#!/usr/bin/env python3
import json
import base64
import hashlib
import io
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

PROJECT = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0")
STORE = PROJECT / "studio-workflow-store.json"
SCRIPT_JSON = PROJECT / "script.json"
CHARACTERS_JSON = PROJECT / "characters.json"
SCENES_JSON = PROJECT / "scenes.json"
PROPS_JSON = PROJECT / "props.json"
EXPORTS = PROJECT / "exports" / "chapter-001"
EXPORTS = Path(os.environ.get("MYSTUDIO_DAOJIE_EXPORTS_DIR", str(EXPORTS)))
FRAMES = EXPORTS / "toonflow_frames"
AUDIO = EXPORTS / "toonflow_audio"
SEGMENTS = EXPORTS / "toonflow_segments"
APP_SUPPORT = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室")
ASSET_DB = APP_SUPPORT / "assets" / "assets.db"
ASSET_FILES = APP_SUPPORT / "assets" / "files"

EPISODE_ID = "chapter-001"
FINAL_NAME = "道劫_EP01_断剑夜访道口镇_toonflow_workflow.mp4"
VOICE_REFERENCE_NAME = "中年男声（45岁±）"
VOICE_REFERENCE_ENGINE = "qwen"
VOICE_REFERENCE_MODEL_SIZE = "1.7B"
VOICE_REFERENCE_TEXT_FALLBACK = "我早已警告过你，宗门戒律不容挑衅，你竟为私利对同门下手。今日我必须废你武功，清理门户。"
MIN_SHOT_DURATION = 3.0
MAX_SHOT_DURATION = 5.0
MIN_DIALOGUE_COVERAGE_RATIO = 0.92
MIN_AUDIO_MEAN_VOLUME_DB = -55.0
LONG_LINE_SPLIT_CHARS = 20
TTS_HOST = "127.0.0.1"
TTS_PORT = 17593
TTS_BASE_URL = f"http://{TTS_HOST}:{TTS_PORT}"
TTS_TOKEN = os.environ.get("MANYING_TTS_CONTROL_TOKEN") or f"daojie-{uuid.uuid4().hex}"
REQUIRE_REAL_TTS = os.environ.get("MANYING_REQUIRE_REAL_TTS", "1") != "0"
ALLOW_TTS_FALLBACK = os.environ.get("MYSTUDIO_ALLOW_TTS_FALLBACK") == "1"
USE_HTTP_TTS = os.environ.get("MANYING_TTS_USE_HTTP") == "1"
SILENT_PREVIEW = os.environ.get("MYSTUDIO_DAOJIE_SILENT_PREVIEW") == "1"
REUSE_AUDIO_DIR = os.environ.get("MYSTUDIO_DAOJIE_REUSE_AUDIO_DIR")
REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "apps" / "backend"
NODE_STORYBOARD_IMAGE_HELPER = REPO_ROOT / "apps" / "build" / "generate-storyboard-image.mjs"
APP_PYTHON = APP_SUPPORT / "python" / "bin" / "python3.12"
SKIP_PROJECT_WRITE = os.environ.get("MYSTUDIO_DAOJIE_SKIP_PROJECT_WRITE") == "1"
SKIP_SCENE_EXPORTS = os.environ.get("MYSTUDIO_DAOJIE_SKIP_SCENE_EXPORTS") == "1"
REAL_STORYBOARD_IMAGE_MODE = "real-ai-reference-image-workflow"
ASSET_COMPOSITE_IMAGE_MODE = "asset-composite"
STORYBOARD_IMAGE_GENERATION_MODE = (
    os.environ.get("MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE", ASSET_COMPOSITE_IMAGE_MODE).strip()
    or ASSET_COMPOSITE_IMAGE_MODE
)
MODEL_REFERENCE_MAX_EDGE = int(os.environ.get("MYSTUDIO_IMAGE_REFERENCE_MAX_EDGE", "1024"))
MODEL_REFERENCE_JPEG_QUALITY = int(os.environ.get("MYSTUDIO_IMAGE_REFERENCE_JPEG_QUALITY", "82"))
GPT_IMAGE_SIZE_MAP = {
    "1:1": {"1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880"},
    "16:9": {"1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160"},
    "9:16": {"1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840"},
    "4:3": {"1K": "1152x864", "2K": "2048x1536", "4K": "3264x2448"},
    "3:4": {"1K": "864x1152", "2K": "1536x2048", "4K": "2448x3264"},
    "3:2": {"1K": "1248x832", "2K": "2016x1344", "4K": "3520x2352"},
    "2:3": {"1K": "832x1248", "2K": "1344x2016", "4K": "2352x3520"},
    "21:9": {"1K": "1280x544", "2K": "2048x880", "4K": "3840x1648"},
    "9:21": {"1K": "544x1280", "2K": "880x2048", "4K": "1648x3840"},
}


def is_real_storyboard_image_mode():
    return STORYBOARD_IMAGE_GENERATION_MODE == REAL_STORYBOARD_IMAGE_MODE


def storyboard_image_generation_provider():
    if is_real_storyboard_image_mode():
        return os.environ.get("MYSTUDIO_IMAGE_PROVIDER_NAME", "freedom-image").strip() or "freedom-image"
    return "local-pillow-ffmpeg"


def storyboard_image_provider_config():
    if not is_real_storyboard_image_mode():
        return {}
    provider_configs = storyboard_image_provider_configs_from_env()
    if provider_configs:
        first = provider_configs[0]
        return {
            **first,
            "providers": provider_configs,
        }
    api_keys = parse_storyboard_image_api_keys(os.environ.get("MYSTUDIO_IMAGE_API_KEY", ""))
    config = {
        "baseUrl": os.environ.get("MYSTUDIO_IMAGE_API_BASE_URL", "").strip(),
        "apiKey": api_keys[0] if api_keys else "",
        "apiKeys": api_keys,
        "model": os.environ.get("MYSTUDIO_IMAGE_MODEL", "").strip(),
        "aspectRatio": os.environ.get("MYSTUDIO_IMAGE_ASPECT_RATIO", "16:9").strip() or "16:9",
        "resolution": os.environ.get("MYSTUDIO_IMAGE_RESOLUTION", "1K").strip() or "1K",
        "timeoutSeconds": float(os.environ.get("MYSTUDIO_IMAGE_TIMEOUT_SECONDS", "180")),
    }
    missing = [key for key in ("baseUrl", "apiKey", "model") if not config[key]]
    if missing:
        raise RuntimeError(
            "真实分镜图生成缺少配置: "
            + ", ".join(f"MYSTUDIO_IMAGE_{'API_BASE_URL' if key == 'baseUrl' else 'API_KEY' if key == 'apiKey' else 'MODEL'}" for key in missing)
        )
    return config


def parse_storyboard_image_api_keys(value):
    return [part.strip() for part in re.split(r"[,\n]", value or "") if part.strip()]


def parse_storyboard_image_api_key_list(value):
    if isinstance(value, list):
        keys = []
        for item in value:
            keys.extend(parse_storyboard_image_api_keys(str(item or "")))
        return keys
    return parse_storyboard_image_api_keys(str(value or ""))


def normalize_storyboard_image_provider_config(item, default_timeout):
    api_keys = parse_storyboard_image_api_key_list(item.get("apiKeys"))
    api_keys.extend(parse_storyboard_image_api_keys(item.get("apiKey", "")))
    seen = set()
    api_keys = [key for key in api_keys if not (key in seen or seen.add(key))]
    config = {
        "providerName": str(item.get("providerName") or item.get("name") or storyboard_image_generation_provider()).strip() or "freedom-image",
        "baseUrl": str(item.get("baseUrl") or item.get("baseURL") or "").strip(),
        "apiKey": api_keys[0] if api_keys else "",
        "apiKeys": api_keys,
        "model": str(item.get("model") or "").strip(),
        "aspectRatio": str(item.get("aspectRatio") or os.environ.get("MYSTUDIO_IMAGE_ASPECT_RATIO", "16:9")).strip() or "16:9",
        "resolution": str(item.get("resolution") or os.environ.get("MYSTUDIO_IMAGE_RESOLUTION", "1K")).strip() or "1K",
        "timeoutSeconds": float(item.get("timeoutSeconds") or default_timeout),
    }
    missing = [key for key in ("baseUrl", "apiKey", "model") if not config[key]]
    if missing:
        raise RuntimeError(f"真实分镜图 provider 配置不完整: {config['providerName']} missing={','.join(missing)}")
    return config


def storyboard_image_provider_configs_from_env():
    raw = os.environ.get("MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON", "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON 不是有效 JSON: {error}") from error
    if not isinstance(data, list):
        raise RuntimeError("MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON 必须是 provider 数组")
    default_timeout = float(os.environ.get("MYSTUDIO_IMAGE_TIMEOUT_SECONDS", "180"))
    return [normalize_storyboard_image_provider_config(item, default_timeout) for item in data]


def normalize_image_base_url(base_url):
    return re.sub(r"/v\d+/?$", "", base_url.rstrip("/"))


def image_generation_endpoint(base_url):
    return f"{normalize_image_base_url(base_url)}/v1/images/generations"


def image_task_poll_endpoint(base_url, task_id):
    template = os.environ.get("MYSTUDIO_IMAGE_POLL_URL_TEMPLATE", "").strip()
    if template:
        return template.replace("{task_id}", urllib.parse.quote(str(task_id)))
    return f"{image_generation_endpoint(base_url)}/{urllib.parse.quote(str(task_id))}"


def first_string(value):
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list) and value:
        return first_string(value[0])
    if isinstance(value, dict):
        return first_string(value.get("url")) or first_string(value.get("image_url")) or first_string(value.get("output_url"))
    return ""


def data_image_url(raw_base64, image_format="png"):
    if not isinstance(raw_base64, str) or not raw_base64.strip():
        return ""
    if raw_base64.startswith("data:image/"):
        return raw_base64
    safe_format = re.sub(r"[^a-zA-Z0-9.+-]", "", str(image_format or "png").lower()) or "png"
    if safe_format == "jpg":
        safe_format = "jpeg"
    return f"data:image/{safe_format};base64,{raw_base64}"


def is_gpt_image_model(model):
    return bool(re.search(r"(^|[-_:/])gpt[-_]?image", str(model or ""), re.IGNORECASE))


def gpt_image_size(aspect_ratio, resolution):
    ratio = aspect_ratio if aspect_ratio in GPT_IMAGE_SIZE_MAP else "16:9"
    normalized_resolution = str(resolution or "2K").upper()
    if normalized_resolution not in GPT_IMAGE_SIZE_MAP[ratio]:
        normalized_resolution = "2K"
    return GPT_IMAGE_SIZE_MAP[ratio][normalized_resolution]


DAOJIE_STORYBOARD_STYLE_PROMPT = (
    "水墨国风修仙，工笔线描，写意泼墨，写意晕染，青绿淡彩，宣纸质感，"
    "宣纸淡彩工笔，细密白描线描，低饱和青绿山水，墨色层次丰富，"
    "传统水墨技法，工笔写意融合，连环画叙事感，水墨国风电影质感，"
    "电影构图，水墨国风高清渲染，高细节，画面无字幕、无水印、无标题叠字"
)
DAOJIE_STORYBOARD_NEGATIVE_CONSTRAINTS = (
    "禁止写实摄影，禁止3D写实渲染，禁止照片级真实感，禁止赛璐璐平涂，"
    "禁止现代/科幻/西方奇幻元素，禁止文字水印、logo、乱码题字"
)
STORYBOARD_REFERENCE_TYPE_LABELS = {
    "scene": "场景",
    "character": "角色",
    "role": "角色",
    "prop": "道具",
    "tool": "道具",
    "场景": "场景",
    "角色": "角色",
    "道具": "道具",
}


def storyboard_reference_type_label(reference):
    raw_type = reference.get("assetType") or reference.get("kind") or ""
    return STORYBOARD_REFERENCE_TYPE_LABELS.get(raw_type, "资产")


def build_storyboard_reference_intro(reference_images):
    labels = []
    for index, reference in enumerate(reference_images or [], 1):
        name = reference.get("name") or reference.get("title") or reference.get("assetId") or f"参考资产{index}"
        labels.append(f"@图{index} 为{name}{storyboard_reference_type_label(reference)}")
    return "；".join(labels)


def build_storyboard_image_prompt(storyboard, reference_images):
    visual_prompt = str((storyboard or {}).get("prompt") or "").strip()
    reference_intro = build_storyboard_reference_intro(reference_images)
    parts = []
    if reference_intro:
        parts.append(reference_intro)
    if visual_prompt:
        parts.append(f"【画面】{visual_prompt}")
    parts.append("【镜头】16:9横版国风漫剧关键帧，前中远景层次清楚，主体动作、角色位置和道具关系可读。")
    parts.append(f"【风格】{DAOJIE_STORYBOARD_STYLE_PROMPT}。")
    parts.append(f"【反向约束】{DAOJIE_STORYBOARD_NEGATIVE_CONSTRAINTS}。")
    if reference_intro:
        parts.append("保持所有@图N造型、结构与参考图一致。")
    return " ".join(part for part in parts if part).strip()


def build_derived_asset_image_prompt(parent_name, state_name, reason, asset_type):
    type_label = STORYBOARD_REFERENCE_TYPE_LABELS.get(asset_type, "资产")
    reference_intro = f"@图1 为{parent_name}{type_label}基准图"
    parts = [
        reference_intro,
        f"【衍生目标】{state_name}：{reason}",
        (
            "【画面】以@图1为底图，保持父资产主体轮廓、身份识别、比例结构与核心特征不变，"
            f"只强化{state_name}所需的服饰、光影、磨损、姿态或局部状态变化。"
        ),
        "【镜头】16:9横版国风漫剧资产设定图，主体完整清晰，可供后续分镜连续复用。",
        f"【风格】{DAOJIE_STORYBOARD_STYLE_PROMPT}。",
        f"【反向约束】{DAOJIE_STORYBOARD_NEGATIVE_CONSTRAINTS}。",
        "保持所有@图N造型、结构与参考图一致。",
    ]
    return " ".join(part for part in parts if part).strip()


def parse_storyboard_image_reuse_after_timestamp(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        return datetime.fromisoformat(normalized).timestamp()
    except ValueError as error:
        raise RuntimeError(f"MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES_AFTER 不是有效 ISO 时间: {raw}") from error


def can_reuse_storyboard_image(image_path):
    if os.environ.get("MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES") != "1":
        return False
    threshold = parse_storyboard_image_reuse_after_timestamp(
        os.environ.get("MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES_AFTER", "")
    )
    if threshold is None or not image_path.exists():
        return False
    return image_path.stat().st_mtime >= threshold


def extract_generated_image_url(data):
    if not isinstance(data, dict):
        return ""
    data_field = data.get("data")
    first_item = data_field[0] if isinstance(data_field, list) and data_field else data_field
    first_record = first_item if isinstance(first_item, dict) else {}
    image_url = (
        first_string(first_record.get("url"))
        or first_string(first_record.get("image_url"))
        or first_string(first_record.get("output_url"))
        or data_image_url(first_record.get("b64_json"), first_record.get("output_format") or data.get("output_format"))
        or first_string(data.get("url"))
        or first_string(data.get("image_url"))
        or first_string(data.get("output_url"))
        or data_image_url(data.get("b64_json"), data.get("output_format"))
        or first_string(data.get("output"))
        or first_string(data.get("outputs"))
    )
    if image_url:
        return image_url
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        content = ((choices[0] or {}).get("message") or {}).get("content")
        if isinstance(content, str):
            match = re.search(r"!\[.*?\]\((https?://[^)]+)\)", content)
            if match:
                return match.group(1)
            match = re.search(r"(data:image/[^;]+;base64,[A-Za-z0-9+/=]+)", content)
            if match:
                return match.group(1)
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                direct = first_string(part.get("image_url")) or first_string(part.get("image")) or first_string(part.get("url"))
                if direct:
                    return direct
                image_value = part.get("image") if isinstance(part.get("image"), dict) else {}
                encoded = data_image_url(part.get("data") or image_value.get("data"))
                if encoded:
                    return encoded
    return ""


def extract_image_task_id(data):
    if not isinstance(data, dict):
        return ""
    data_field = data.get("data")
    first_item = data_field[0] if isinstance(data_field, list) and data_field else data_field
    first_record = first_item if isinstance(first_item, dict) else {}
    return (
        first_string(first_record.get("task_id"))
        or first_string(first_record.get("id"))
        or first_string(data.get("task_id"))
        or first_string(data.get("taskId"))
        or first_string(data.get("id"))
    )


def fetch_json(url, api_key, payload=None, timeout_seconds=180):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_text = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"图片生成 API 错误: {error.code} {error_text}") from error


def build_storyboard_image_request_body(prompt, reference_images, config):
    body = {
        "model": config["model"],
        "prompt": prompt,
        "n": 1,
    }
    if is_gpt_image_model(config["model"]):
        body["size"] = gpt_image_size(config["aspectRatio"], config["resolution"])
    else:
        body["stream"] = False
        body["aspect_ratio"] = config["aspectRatio"]
        body["resolution"] = config["resolution"]
    if reference_images:
        body["image_urls"] = reference_images
    return body


def generate_storyboard_image_via_node_helper(prompt, reference_images, config):
    if not NODE_STORYBOARD_IMAGE_HELPER.exists():
        raise RuntimeError(f"Node 分镜图生成 helper 不存在: {NODE_STORYBOARD_IMAGE_HELPER}")
    payload = {
        "baseUrl": config["baseUrl"],
        "apiKey": config["apiKey"],
        "apiKeys": config.get("apiKeys") or [config["apiKey"]],
        "providers": config.get("providers"),
        "model": config["model"],
        "providerName": config.get("providerName") or storyboard_image_generation_provider(),
        "prompt": prompt,
        "referenceImages": reference_images,
        "aspectRatio": config["aspectRatio"],
        "resolution": config["resolution"],
        "timeoutSeconds": config["timeoutSeconds"],
    }
    provider_timeout = 0
    for provider in payload.get("providers") or []:
        provider_timeout += float(provider.get("timeoutSeconds") or config["timeoutSeconds"]) * max(1, len(provider.get("apiKeys") or [provider.get("apiKey")]))
    helper_timeout = (provider_timeout or config["timeoutSeconds"] * max(1, len(payload["apiKeys"]))) + 30
    result = subprocess.run(
        ["node", str(NODE_STORYBOARD_IMAGE_HELPER)],
        cwd=str(REPO_ROOT / "apps"),
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=helper_timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Node 分镜图生成失败: {(result.stderr or result.stdout).strip()[:500]}")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Node 分镜图生成输出无法解析: {result.stdout[:500]}") from error
    image_url = first_string(data.get("url")) or first_string(data.get("imageUrl"))
    if not image_url:
        raise RuntimeError(f"Node 分镜图生成缺少结果图: {result.stdout[:500]}")
    return image_url


def request_storyboard_image_generation(prompt, reference_images, config):
    if is_gpt_image_model(config["model"]):
        return generate_storyboard_image_via_node_helper(prompt, reference_images, config)
    endpoint = image_generation_endpoint(config["baseUrl"])
    payload = build_storyboard_image_request_body(prompt, reference_images, config)
    data = fetch_json(endpoint, config["apiKey"], payload, config["timeoutSeconds"])
    image_url = extract_generated_image_url(data)
    if image_url:
        return image_url
    task_id = extract_image_task_id(data)
    if not task_id:
        raise RuntimeError(f"图片生成响应缺少结果图或任务 ID: {json.dumps(data, ensure_ascii=False)[:500]}")
    poll_interval = float(os.environ.get("MYSTUDIO_IMAGE_POLL_INTERVAL_SECONDS", "3"))
    poll_attempts = int(os.environ.get("MYSTUDIO_IMAGE_POLL_ATTEMPTS", "60"))
    for _ in range(poll_attempts):
        time.sleep(poll_interval)
        poll_data = fetch_json(image_task_poll_endpoint(config["baseUrl"], task_id), config["apiKey"], None, config["timeoutSeconds"])
        image_url = extract_generated_image_url(poll_data)
        if image_url:
            return image_url
        status = str(poll_data.get("status") or poll_data.get("state") or "").lower()
        if status in {"failed", "error", "canceled", "cancelled"}:
            raise RuntimeError(f"图片生成任务失败: {json.dumps(poll_data, ensure_ascii=False)[:500]}")
    raise RuntimeError(f"图片生成任务超时: {task_id}")


def image_workflow_asset_type(kind):
    return {
        "角色": "character",
        "场景": "scene",
        "道具": "prop",
    }.get(kind, "prop")


def collect_storyboard_reference_images(image_assets):
    references = []
    for index, asset in enumerate(image_assets, 1):
        image_url = asset.get("imagePath", "")
        if not image_url:
            continue
        references.append({
            "assetId": asset.get("assetId") or asset.get("name") or f"asset-{index}",
            "assetType": image_workflow_asset_type(asset.get("kind", "")),
            "title": asset.get("name") or f"参考资产 {index}",
            "imageUrl": image_url,
            "evidence": f"{asset.get('kind', '资产')}参考图：{asset.get('sourceName') or asset.get('name')}",
        })
    return references


def create_storyboard_image_workflow_graph(storyboard, prompt, result_image_path, reference_images, config, created_at):
    flow_id = f"storyboard-flow-{EPISODE_ID}-{storyboard['index']:03d}"
    generated_node_id = f"gen-{flow_id}"
    nodes = []
    edges = []
    for index, reference in enumerate(reference_images, 1):
        reference_node_id = f"ref-{index}-{flow_id}"
        nodes.append({
            "id": reference_node_id,
            "type": "reference",
            "title": reference.get("title") or f"参考资产 {index}",
            "imageUrl": reference["imageUrl"],
            "source": {
                "kind": "asset",
                "assetType": reference["assetType"],
                "id": reference["assetId"],
            },
            "notes": reference.get("evidence", ""),
            "position": {"x": 80, "y": 80 + (index - 1) * 180},
            "createdAt": created_at,
            "updatedAt": created_at,
        })
        edges.append({
            "id": f"{reference_node_id}->{generated_node_id}",
            "source": reference_node_id,
            "target": generated_node_id,
        })
    nodes.append({
        "id": generated_node_id,
        "type": "generated",
        "title": f"分镜 {storyboard['index']} 成图",
        "prompt": prompt or storyboard.get("prompt", ""),
        "model": config["model"],
        "aspectRatio": config["aspectRatio"],
        "quality": "standard",
        "resolution": config["resolution"],
        "position": {"x": 620 if reference_images else 160, "y": 120},
        "resultUrl": result_image_path,
        "status": "ready",
        "generatedAt": created_at,
        "createdAt": created_at,
        "updatedAt": created_at,
    })
    return {
        "id": flow_id,
        "name": f"道劫 · 分镜 {storyboard['index']} 图片工作流",
        "target": {"kind": "storyboard", "id": storyboard["id"]},
        "nodes": nodes,
        "edges": edges,
        "createdAt": created_at,
        "updatedAt": created_at,
    }


def generate_storyboard_frame_with_references(frame, storyboard, prompt, image_assets, config):
    references = collect_storyboard_reference_images(image_assets)
    if not references:
        raise RuntimeError(f"分镜 {storyboard['index']:02d} 缺少参考资产图片")
    final_prompt = build_storyboard_image_prompt(
        {**storyboard, "prompt": prompt or storyboard.get("prompt", "")},
        references,
    )
    relative_path = f"workflow-images/storyboards/{EPISODE_ID}/shot-{storyboard['index']:03d}.png"
    result_file = PROJECT / relative_path
    reused_existing_image = can_reuse_storyboard_image(result_file)
    if not reused_existing_image:
        prepared_reference_images = [prepare_storyboard_model_reference_image(reference["imageUrl"]) for reference in references]
        generated_image_url = request_storyboard_image_generation(final_prompt, prepared_reference_images, config)
        save_generated_image_url(generated_image_url, result_file)
    Image.open(result_file).convert("RGB").resize((1920, 1080), Image.Resampling.LANCZOS).save(frame)
    project_url = project_file_url(relative_path)
    graph = create_storyboard_image_workflow_graph(
        storyboard,
        final_prompt,
        project_url,
        references,
        config,
        1780301000000 + storyboard["index"],
    )
    return {
        "framePath": str(frame),
        "projectImageUrl": project_url,
        "absoluteImagePath": str(result_file),
        "workflowGraph": graph,
        "generatedNodeId": f"gen-{graph['id']}",
        "referenceImages": references,
        "reusedExistingImage": reused_existing_image,
    }


def project_file_url(relative_path):
    encoded_project = urllib.parse.quote(PROJECT.name, safe="")
    encoded_relative = "/".join(urllib.parse.quote(part, safe="") for part in str(relative_path).replace("\\", "/").split("/"))
    return f"project-file://{encoded_project}/{encoded_relative}"


def resolve_project_file_url(value):
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "project-file":
        raise RuntimeError(f"不是项目文件 URL: {value}")
    project_id = urllib.parse.unquote(parsed.netloc)
    if project_id != PROJECT.name:
        raise RuntimeError(f"项目文件不属于当前项目: {project_id}")
    parts = [urllib.parse.unquote(part) for part in parsed.path.lstrip("/").split("/") if part]
    if not parts or any(part == ".." for part in parts):
        raise RuntimeError(f"项目文件路径非法: {value}")
    return PROJECT.joinpath(*parts)


def image_source_to_data_url(source):
    if source.startswith("data:image/") or source.startswith("http://") or source.startswith("https://"):
        return source
    if source.startswith("project-file://"):
        path = resolve_project_file_url(source)
    elif source.startswith("file://"):
        path = Path(urllib.parse.urlparse(source).path)
    else:
        path = Path(source)
    if not path.exists():
        raise RuntimeError(f"参考图不存在: {source}")
    mime_type = mimetypes.guess_type(str(path))[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def image_source_to_path(source):
    if source.startswith("project-file://"):
        return resolve_project_file_url(source)
    if source.startswith("file://"):
        return Path(urllib.parse.urlparse(source).path)
    return Path(source)


def prepare_storyboard_model_reference_image(source):
    if source.startswith("data:image/") or source.startswith("http://") or source.startswith("https://"):
        return source
    path = image_source_to_path(source)
    if not path.exists():
        raise RuntimeError(f"参考图不存在: {source}")
    with Image.open(path) as image:
        normalized = ImageOps.exif_transpose(image)
        if normalized.mode == "RGBA":
            background = Image.new("RGB", normalized.size, (255, 255, 255))
            background.paste(normalized, mask=normalized.getchannel("A"))
            normalized = background
        elif normalized.mode != "RGB":
            normalized = normalized.convert("RGB")
        max_edge = max(256, MODEL_REFERENCE_MAX_EDGE)
        normalized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        quality = max(40, min(95, MODEL_REFERENCE_JPEG_QUALITY))
        normalized.save(buffer, format="JPEG", quality=quality, optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def save_generated_image_url(image_url, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if image_url.startswith("data:image/"):
        header, encoded = image_url.split(",", 1)
        output_path.write_bytes(base64.b64decode(encoded))
        return
    request = urllib.request.Request(image_url, headers={"User-Agent": "MYStudio/DaojieStoryboardImage"})
    with urllib.request.urlopen(request, timeout=180) as response:
        output_path.write_bytes(response.read())

ASSET_IMAGE_ALIASES = {
    "归元断剑": ["归元断剑", "斩魂剑", "归元古剑"],
    "油布剑包": ["油布剑包", "背负旧剑"],
    "宗门灵舟": ["宗门灵舟", "金水河"],
    "灵矿藤筐": ["灵矿藤筐", "灵矿", "赤练蛇皮鞭"],
    "灵矿": ["灵矿", "灵矿藤筐", "赤练蛇皮鞭"],
    "绿锈铜钱": ["绿锈铜钱", "铜钱", "残卷"],
    "灵矿账册": ["灵矿账册", "残卷"],
    "缚神索": ["缚神索", "归元断剑", "斩魂剑"],
    "玄天符": ["玄天符", "残卷"],
    "悦来客栈斗室": ["悦来客栈斗室", "悦来客栈"],
    "老苦力": ["老苦力", "道口镇凡人"],
    "年轻苦力": ["年轻苦力", "道口镇凡人"],
    "孩童甲": ["孩童甲", "道口镇凡人"],
    "丫头": ["丫头", "道口镇凡人"],
    "赵四": ["赵四", "监工赵四"],
    "宗门弟子甲": ["宗门弟子甲", "中小宗门", "监工赵四"],
    "宗门弟子乙": ["宗门弟子乙", "中小宗门", "监工赵四"],
}

DERIVED_ASSET_PLAN = [
    {
        "parentAssetId": "独孤剑尘",
        "state": "灰衫入镇态",
        "reason": "Sc1-Sc2 持续出镜：灰衫沾矿尘、背负油布剑包，作为第一章默认出镜状态。",
    },
    {
        "parentAssetId": "悦来客栈",
        "state": "斗室夜谈态",
        "reason": "Sc2-Sc4 使用：从客栈大堂转入斗室，承载断剑显露与归元认人的室内状态。",
    },
    {
        "parentAssetId": "归元断剑",
        "state": "半截出鞘态",
        "reason": "Sc2-Sc4 使用：油布解开后露出半截断剑，是后续图像工作流的衍生道具锚点。",
    },
]

DERIVED_ASSET_IDS = {
    ("独孤剑尘", "灰衫入镇态"): {
        "id": "var-chapter-001-dugu-grey-town",
        "flowId": "asset-flow-chapter-001-dugu-grey-town",
        "assetType": "character",
    },
    ("悦来客栈", "斗室夜谈态"): {
        "id": "scene-derived-chapter-001-yuelai-room-talk",
        "flowId": "asset-flow-chapter-001-yuelai-room-talk",
        "assetType": "scene",
    },
    ("归元断剑", "半截出鞘态"): {
        "id": "prop-derived-chapter-001-guiyuan-half-drawn",
        "flowId": "asset-flow-chapter-001-guiyuan-half-drawn",
        "assetType": "prop",
    },
}

ROLE_VOICE_PREFERENCES = {
    "旁白": ["男-专题 纪录 旁白", "纪录片宣传片高质男音", "老年人旁白（男）", "磁性男声", "短视频电影解说男青年"],
    "独孤剑尘": ["男-清冷、正派", "低沉 磁性 醇厚  男", "中年男声（45岁±）", "磁性男声", "男——悲伤"],
    "赵四": ["男-青年、谄媚、活泼", "军士-男-低音、厚实、强壮", "大当家试听", "男-高音、快速、油滑", "中年男烟酒嗓独白"],
    "李先生": ["男-和蔼、温暖、中年", "君阳-悠扬-男教师", "中年男声（45岁±）", "老者男", "中老年农民男-低音、老实醇厚"],
    "掌柜": ["客栈老板-热情", "中年男叫卖试听", "男小贩叫卖-热情", "男-高音、快速、油滑", "中年男声（45岁±）"],
    "晏燎": ["男-沉着冷静、皇子", "阳光少年", "街头玩耍小男孩", "青春男大", "青年才俊"],
    "孩童甲": ["男-十二到十四岁的男孩", "街头玩耍小男孩", "阳光少年", "男-高音、快速、油滑"],
    "小杂役": ["小龄男书童试听", "街头玩耍小男孩", "阳光少年", "男-高音、快速、油滑"],
    "丫头": ["女-8-10岁女孩", "萌小音（11岁 女）", "蛋黄（8岁 女孩）", "女-10-12岁孩"],
    "老苦力": ["中老年农民男-低音、老实醇厚", "老者男", "虚弱老年男性独白"],
    "年轻苦力": ["阳光少年", "青年才俊", "青春男大"],
    "宗门弟子甲": ["男-清冷刻薄、傲慢自大", "男-高音、快速、油滑", "军士-男-低音、厚实、强壮", "青年才俊"],
    "宗门弟子乙": ["男-中音、清冷、木楞", "男-高音、快速、油滑", "军士-男-低音、厚实、强壮", "青年才俊"],
}

ROLE_VOICE_INSTRUCTIONS = {
    "旁白": "电影级中文旁白，厚重、克制、留白明显，叙事有压迫感。",
    "独孤剑尘": "低沉疲惫，隐忍克制，旧伤未愈，短句要稳。",
    "赵四": "粗粝、压迫、带威胁感，句尾短促，像码头恶监工。",
    "李先生": "严肃克制，像老教师压住不忍，判词要重。",
    "掌柜": "市井谨慎，压低声音，冷淡精明。",
    "晏燎": "少年倔强，先怯后硬，紧张但不服输。",
    "孩童甲": "孩子气，怯生生，好奇中带怕。",
    "小杂役": "年幼惊惧，求饶发抖，气息短。",
    "丫头": "女孩童声，怯而认真，问题要轻。",
    "老苦力": "疲惫沧桑，低哑，像被榨干力气。",
    "年轻苦力": "年轻紧张，压低声音提醒同伴。",
    "宗门弟子甲": "冷漠轻慢，像在谈账目。",
    "宗门弟子乙": "冷漠轻慢，声音更低，毫无同情。",
}


CHAPTER_001_SHOTS = [
    ("金水河码头", "赤练蛇皮鞭撕开河雾，青盐水挂在鞭梢，朱红火印压在藤筐侧面。", "旁白", "傍晚，金水河码头被太一宗火印压醒。", "河雾低涌、鞭梢破风", ["赤练蛇皮鞭", "灵矿藤筐"], 4.2),
    ("金水河码头", "抱矿跪倒的小杂役缩肩护头，灵矿倒刺扎破指缝。", "赵四", "偷懒？找死！", "矿石摩擦、孩童抽气", ["监工赵四", "小杂役", "灵矿藤筐"], 3.8),
    ("金水河码头", "血珠落在湿黑木栈上，小杂役把求饶吞成发抖的气音。", "小杂役", "监工老爷，饶命！", "血滴落木、铁链拖石", ["小杂役", "灵矿藤筐"], 3.8),
    ("金水河码头", "苦力弯腰拖筐，年轻苦力压低声音让众人低头避鞭。", "老苦力", "骨头都榨干了。", "粗重喘息、麻绳绷紧", ["老苦力", "年轻苦力", "灵矿"], 4.0),
    ("金水河码头", "赵四靴底碾碎灵矿，青盐水顺着鞭梢滴进裂开的木纹。", "赵四", "误了宗门灵舟！", "矿石碎裂、盐水滴落", ["监工赵四", "赤练蛇皮鞭", "灵矿"], 3.8),
    ("金水河码头", "独孤剑尘从河雾边走来，灰衫发白，油布剑包压在背后。", "旁白", "灰衫客入镇，无声得像一笔淡墨。", "河雾风声、木栈轻响", ["独孤剑尘", "油布剑包"], 4.2),
    ("金水河码头", "背后油布剑包轻轻一颤，袖中残卷露出一角，古字只剩一个等。", "旁白", "残卷古字微亮，只剩一个等字。", "布料摩擦、纸页轻响", ["独孤剑尘", "油布剑包", "残卷"], 4.2),
    ("金水河码头", "赵四冷笑抬臂，鞭梢飞白般斜劈向小杂役。", "赵四", "全填江眼！", "鞭声炸开", ["监工赵四", "小杂役", "赤练蛇皮鞭"], 3.8),
    ("金水河码头", "独孤没有抬眼，只在错身一瞬用鞋尖轻拨半截朽木。", "旁白", "他只动了一寸，救下一条命。", "朽木轻响、脚步擦过", ["独孤剑尘", "小杂役"], 4.2),
    ("金水河码头", "赵四一脚踩偏，鞭子抽碎空筐，藤条碎屑炸开。", "赵四", "谁绊老子？", "空筐炸裂、矿渣滚落", ["监工赵四", "灵矿藤筐"], 3.8),
    ("金水河码头", "小杂役抱着矿渣滚进船影，活下来的人连谢字都不敢出口。", "旁白", "活下来的人，连道谢都不敢出声。", "船板晃动、压抑呼吸", ["小杂役", "灵矿"], 4.0),
    ("金水河码头", "独孤指尖压住袖口残卷，河雾吞掉他半边身影。", "旁白", "火印暗红如血，他继续向镇中走去。", "河风、远处钟声", ["独孤剑尘", "残卷"], 4.0),
    ("悦来客栈", "悦来客栈灯影赭黄，掌柜拨算盘，算珠声像冷雨落木。", "旁白", "悦来客栈里，算盘比人情更响。", "算盘声、油烟声", ["悦来客栈", "掌柜"], 4.0),
    ("悦来客栈", "独孤推门入内，灰衫沾着矿尘，油布剑包压弯衣褶。", "掌柜", "住店，还是打尖？", "门轴轻响、脚步入堂", ["独孤剑尘", "掌柜", "油布剑包"], 3.8),
    ("悦来客栈", "独孤把两枚绿锈铜钱放到柜台边，铜锈在灯下发暗。", "独孤剑尘", "住店，下房。", "铜钱轻落", ["独孤剑尘", "绿锈铜钱"], 3.6),
    ("悦来客栈", "掌柜压住铜钱，眼神在剑包上停了一息。", "掌柜", "剑包别惹事。", "算盘停顿、布包轻响", ["掌柜", "油布剑包"], 3.8),
    ("悦来客栈", "独孤沿朽木楼梯上行，脚步避开每一道会响的裂缝。", "独孤剑尘", "它比我安静。", "楼板轻响、风穿门缝", ["独孤剑尘", "悦来客栈"], 3.8),
    ("悦来客栈", "虚掩房门内，两名宗门弟子衣袖干净，灵矿账册压着旧金镇纸。", "宗门弟子甲", "矿账又涨了。", "纸页翻动、低声交谈", ["宗门弟子甲", "宗门弟子乙", "灵矿账册"], 4.0),
    ("悦来客栈", "账册边写着苦力扣损耗，独孤袖中指节骤紧又慢慢松开。", "宗门弟子乙", "苦力账上扣。", "指节收紧、木门轻晃", ["独孤剑尘", "灵矿账册"], 4.0),
    ("悦来客栈斗室", "斗室狭窄，枯灯豆大，独孤合门坐下。", "旁白", "一间下房，藏不住十年的旧伤。", "门闩落下、灯火噼啪", ["独孤剑尘", "悦来客栈"], 4.0),
    ("悦来客栈斗室", "三层油布一圈圈解开，半截归元断剑露出寒光。", "独孤剑尘", "十年了。", "油布摩擦、断剑轻鸣", ["独孤剑尘", "归元断剑", "油布剑包"], 4.2),
    ("悦来客栈斗室", "缚神索、玄天符、归元折断和太一宗火印在宣纸白光中闪过。", "旁白", "旧日一闪而过，伤口从未合上。", "闪回尖响、符纸震动", ["缚神索", "玄天符", "归元断剑"], 4.0),
    ("悦来客栈", "楼下掌柜的声音穿过木板，窗外金水塾馆一盏油灯亮起。", "掌柜", "客官，会讲引气吗？", "木板传声、远处读书声", ["掌柜", "金水塾馆"], 3.8),
    ("悦来客栈", "枯灯被风吹得一歪，独孤抬眼看向塾馆。", "独孤剑尘", "半堂，换粥。", "灯火摇晃、夜风", ["独孤剑尘", "金水塾馆"], 3.8),
    ("金水塾馆", "断口冷光化作塾馆油灯，孩童挤坐长凳，破衣湿鞋收在凳下。", "旁白", "夜课开始，穷孩子把呼吸都放轻了。", "叠化、孩童呼吸", ["金水塾馆", "孩童甲", "丫头"], 4.0),
    ("金水塾馆", "李先生收起书箱，将一根枯枝递给独孤。", "李先生", "掌柜说你会讲？", "书箱合上、枯枝递出", ["李先生", "独孤剑尘"], 3.6),
    ("金水塾馆", "独孤握住枯枝，窗外铁链拖动声远远压来。", "独孤剑尘", "半堂引气。", "铁链远响、窗纸震动", ["独孤剑尘", "金水塾馆"], 3.6),
    ("金水塾馆", "李先生目光扫过孩童，提醒独孤不要给他们妄念。", "李先生", "只讲气，别惹事。", "衣袖摩擦、低声警告", ["李先生", "孩童甲", "丫头"], 3.8),
    ("金水塾馆", "独孤站到灯下，枯枝轻点桌面，满堂呼吸随之一停。", "独孤剑尘", "闭眼，守一息。", "枯枝点桌、油灯轻晃", ["独孤剑尘"], 3.8),
    ("金水塾馆", "孩童甲怯怯抬头，问凡根是否也有气。", "孩童甲", "凡根也有气吗？", "孩童低语", ["孩童甲", "独孤剑尘"], 3.6),
    ("金水塾馆", "独孤看着一屋破衣湿鞋，声音压得很低。", "独孤剑尘", "喘着，就有。", "呼吸声、窗缝风", ["独孤剑尘", "金水塾馆"], 3.8),
    ("金水塾馆", "丫头攥住衣角，问穷人能不能修，孩童们屏住气等答案。", "丫头", "穷人也能修？", "衣角摩擦、孩童屏息", ["丫头", "独孤剑尘"], 3.8),
    ("金水塾馆", "独孤让众人听心跳、听掌心，油灯照出一排瘦小影子。", "独孤剑尘", "气在，命就在。", "心跳低鼓、油灯噼啪", ["独孤剑尘", "孩童甲", "丫头"], 4.0),
    ("金水塾馆", "最后一排，晏燎闭眼，双手叠在膝前，呼吸慢得像在数河水。", "旁白", "最后一排的少年，把一口气守到掌心里。", "呼吸放慢、灯火摇晃", ["晏燎", "金水塾馆"], 4.2),
    ("金水塾馆", "晏燎掌心皮肉下浮起一点暗红炭光，满堂骤静。", "晏燎", "先生，我手心发烫。", "炭火微鸣、满堂骤静", ["晏燎", "独孤剑尘"], 4.2),
    ("金水塾馆", "独孤握着枯枝的手骤然收紧，枝皮裂开露出白茬。", "旁白", "那一点暗红，撞进了独孤的眼里。", "枯枝裂声、心跳加重", ["独孤剑尘", "晏燎"], 4.0),
    ("金水塾馆", "李先生快步走近，抓起晏燎的手，暗红余温藏入皮下。", "李先生", "摊开。", "急促脚步、衣袖摩擦", ["李先生", "晏燎"], 3.6),
    ("金水塾馆", "晏燎盯着自己掌心，不肯退，五指慢慢蜷起。", "晏燎", "刚才真有火。", "满堂静默", ["晏燎", "李先生"], 3.8),
    ("金水塾馆", "李先生眼底掠过一丝哀色，又被严厉压住。", "李先生", "灵根驳杂，此生无缘大道。", "判词落下、油灯一暗", ["李先生", "晏燎"], 4.2),
    ("金水塾馆", "晏燎把那点余温护进掌心，瘦削的脸被独孤牢牢记住。", "晏燎", "我不怕疼。", "指节收紧、孩童避目", ["晏燎", "独孤剑尘"], 4.0),
    ("悦来客栈斗室", "深夜斗室内，晏燎掌心余红化成残卷边缘裂痕，末页古字渗出旧金冷光。", "独孤剑尘", "归元认人。", "纸页轻震、断剑低鸣", ["独孤剑尘", "残卷", "归元断剑"], 4.2),
    ("悦来客栈斗室", "桌上绿锈铜钱忽然立起不倒，断剑剑格一震。", "独孤剑尘", "晏燎。不是错觉。", "铜钱旋立、寒铁震动", ["绿锈铜钱", "归元断剑"], 4.0),
    ("金水河", "宗门灵舟在雾中显形，朱红火印穿破夜色；独孤反手按住归元。", "独孤剑尘", "归元，忍住。明日之前，我必须见晏燎。", "灵舟破水、断剑低鸣被压住", ["独孤剑尘", "归元断剑", "宗门灵舟", "金水河", "晏燎"], 5.0),
]

EPISODE_STORYBOARD_SPECS = {
    "chapter-001": {
        "shots": CHAPTER_001_SHOTS,
        "targetDurationSeconds": 180.0,
    },
}


def load_json(path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def latest_script(state):
    drafts = [w for w in state.get("agentWorkData", []) if w.get("key") == "scriptDraft" and w.get("episodeId") == EPISODE_ID]
    if not drafts:
        raise RuntimeError("未找到 chapter-001 scriptDraft")
    return sorted(drafts, key=lambda x: x.get("createdAt", 0))[-1]["data"]


def clean_script_text(value):
    return re.sub(r"\s+", "", value or "")


def normalize_dialogue_text(value):
    return re.sub(r"[\s，,。.!！?？：:；;、…—\-「」『』“”\"'（）()\[\]【】#*_`]+", "", value or "")


def split_long_line(text, limit=LONG_LINE_SPLIT_CHARS):
    text = re.sub(r"\s+", "", text.strip())
    if len(text) <= limit:
        return [text] if text else []
    parts = [part for part in re.split(r"(?<=[。！？；，、])", text) if part]
    chunks = []
    current = ""
    for part in parts:
        if current and len(current) + len(part) > limit:
            chunks.append(current)
            current = part
        else:
            current += part
        while len(current) > limit * 1.5:
            chunks.append(current[:limit])
            current = current[limit:]
    if current:
        chunks.append(current)
    return chunks


def source_script_body(script_text):
    marker = "1-1 "
    start = script_text.find(marker)
    return script_text[start:] if start >= 0 else script_text


def episode_storyboard_spec(episode_id=EPISODE_ID):
    spec = EPISODE_STORYBOARD_SPECS.get(episode_id)
    if not spec:
        raise RuntimeError(f"未配置 {episode_id} 的分镜规格")
    shots = spec.get("shots") or []
    if not shots:
        raise RuntimeError(f"{episode_id} 的分镜规格为空")
    return spec


def target_chapter_duration_seconds(episode_id=EPISODE_ID):
    return float(episode_storyboard_spec(episode_id).get("targetDurationSeconds", 180.0))


def source_segment_units(script_text, episode_id=EPISODE_ID):
    return [shot[3] for shot in episode_storyboard_spec(episode_id)["shots"]]


def source_dialogue_units(script_text, episode_id=EPISODE_ID):
    return source_segment_units(script_text, episode_id)


def scene_assets_for(scene_no):
    if scene_no == 1:
        return ["赤练蛇皮鞭", "灵矿藤筐", "灵矿", "独孤剑尘", "监工赵四", "小杂役", "老苦力", "年轻苦力", "油布剑包", "残卷"]
    if scene_no == 2:
        return ["悦来客栈", "独孤剑尘", "掌柜", "绿锈铜钱", "油布剑包", "归元断剑", "灵矿账册", "宗门弟子甲", "宗门弟子乙"]
    if scene_no == 3:
        return ["金水塾馆", "独孤剑尘", "李先生", "晏燎", "孩童甲", "丫头"]
    return ["悦来客栈斗室", "独孤剑尘", "残卷", "归元断剑", "绿锈铜钱", "宗门灵舟", "金水河", "晏燎"]


def scene_sound_for(scene_no):
    if scene_no == 1:
        return "河雾低涌、鞭梢破风、铁链拖石"
    if scene_no == 2:
        return "算盘声、楼板轻响、油布摩擦、断剑低鸣"
    if scene_no == 3:
        return "窗缝风、油灯噼啪、孩童呼吸、枯枝裂声"
    return "纸页颤动、断剑低鸣、船桨破水、灵舟压雾"


def canonical_shot_scene_no(index):
    if index <= 12:
        return 1
    if index <= 24:
        return 2
    if index <= 40:
        return 3
    return 4


def canonical_storyboard_shots(episode_id=EPISODE_ID):
    shots = episode_storyboard_spec(episode_id)["shots"]
    return [
        {
            "sceneNo": canonical_shot_scene_no(index),
            "scene": scene,
            "desc": desc,
            "speaker": speaker,
            "text": text,
            "sound": sound,
            "assets": assets,
            "duration": duration,
            "characters": [],
        }
        for index, (scene, desc, speaker, text, sound, assets, duration) in enumerate(shots, 1)
    ]


def build_shots_from_script(script_text, episode_id=EPISODE_ID):
    return canonical_storyboard_shots(episode_id)


def shot_tuple(shot):
    if isinstance(shot, dict):
        return shot["scene"], shot["desc"], shot["speaker"], shot["text"], shot["sound"], shot["assets"], shot["duration"]
    return shot


def build_script_plan(shots=None):
    shots = shots or canonical_storyboard_shots()
    scene_stats = {}
    for shot in shots:
        scene_no = shot.get("sceneNo") or (1 if len(scene_stats) < 1 else 1)
        stat = scene_stats.setdefault(scene_no, {"lines": 0, "chars": 0})
        stat["lines"] += 1
        stat["chars"] += len(clean_script_text(shot.get("text", "")))
    return "\n".join([
        "<scriptPlan>",
        "### 分场汇总表（核心）",
        "| 场次 | 场景名 | 台词条数 | 台词字数 | 情绪浓度 | 情绪基调（含 X→Y） |",
        "|---|---|---|---|---|---|",
        f"| Sc1 | 金水河码头·鞭下入镇 | {scene_stats.get(1, {}).get('lines', 0)} | {scene_stats.get(1, {}).get('chars', 0)} | 8 | 压迫→隐忍救人 |",
        f"| Sc2 | 悦来客栈·断剑显露 | {scene_stats.get(2, {}).get('lines', 0)} | {scene_stats.get(2, {}).get('chars', 0)} | 6 | 冷眼旁观→旧痛翻涌 |",
        f"| Sc3 | 金水塾馆·晏燎燃气 | {scene_stats.get(3, {}).get('lines', 0)} | {scene_stats.get(3, {}).get('chars', 0)} | 7 | 试探引气→命数被压 |",
        f"| Sc4 | 悦来斗室与金水河·归元认人 | {scene_stats.get(4, {}).get('lines', 0)} | {scene_stats.get(4, {}).get('chars', 0)} | 9 | 确认传承→危机逼近 |",
        "",
        "### 逐场注意事项",
        "- **Sc1**：",
        "  - 情感砸点：鞭梢将落、小杂役护头、独孤只用鞋尖拨木救人。",
        "  - 一致性锚点：油布剑包和残卷只露一角，独孤始终低调隐忍。",
        "  - 环境音：鞭梢破风、铁链拖石、藤筐炸裂。",
        "- **Sc2**：",
        "  - 情感砸点：两枚绿锈铜钱落柜，断剑露出后旧仇闪回。",
        "  - 一致性锚点：绿锈铜钱、油布剑包、归元断剑贯穿本场。",
        "  - 环境音：算盘、楼板、油布摩擦、断剑低鸣。",
        "- **Sc3**：",
        "  - 情感砸点：晏燎掌心暗红一息，随后被李先生否定。",
        "  - 空间距离：晏燎在最后一排，独孤在讲台前，李先生横插压住。",
        "  - 环境音：窗缝风、油灯、孩童呼吸、枯枝裂声。",
        "- **Sc4**：",
        "  - 情感砸点：归元确认晏燎，宗门灵舟压雾逼近。",
        "  - 环境音：断剑低鸣、纸页颤动、船桨破水。",
        "",
        "### 场间过渡",
        "| 场间 | 过渡方式 | 说明 |",
        "|---|---|---|",
        "| Sc1 → Sc2 | 叠化 | 鞭痕墨色在空筐裂口晕开，化作顺风街灰雾 |",
        "| Sc2 → Sc3 | 叠化 | 断口寒光化作塾馆油灯 |",
        "| Sc3 → Sc4 | 叠化 | 晏燎掌心余红熄灭，化成残卷边缘裂痕 |",
        "",
        "### ⑦ 衍生资产预划清单",
        "| 资产名 | 衍生状态 | 原因/出现段落 |",
        "|---|---|---|",
        *[
            f"| {item['parentAssetId']} | {item['state']} | {item['reason']} |"
            for item in DERIVED_ASSET_PLAN
        ],
        "</scriptPlan>",
    ])


def state_items(data, key):
    if not data:
        return []
    if isinstance(data, dict):
        return data.get("state", data).get(key, [])
    return []


def build_asset_index(state):
    characters = state_items(load_json(CHARACTERS_JSON), "characters") if CHARACTERS_JSON.exists() else []
    scenes = state_items(load_json(SCENES_JSON), "scenes") if SCENES_JSON.exists() else []
    extractions = [item for item in state.get("entityExtractions", []) if item.get("episodeId") == EPISODE_ID]
    extraction = extractions[-1] if extractions else {}
    props = []
    if extraction:
        props = extraction.get("props", [])

    index = {}
    for item in characters:
        name = item.get("name")
        if name and item.get("id"):
            index[name] = item["id"]
    for item in scenes:
        name = item.get("name")
        if name and item.get("id"):
            index[name] = item["id"]
    for item in extraction.get("characters", []):
        name = item.get("name")
        if name and item.get("characterId"):
            index[name] = item["characterId"]
    for item in extraction.get("scenes", []):
        name = item.get("name")
        if name and item.get("sceneId"):
            index[name] = item["sceneId"]
    for item in props:
        name = item.get("name")
        if name and item.get("assetId"):
            index[name] = item["assetId"]
    return index


def build_asset_catalog(state):
    characters = state_items(load_json(CHARACTERS_JSON), "characters") if CHARACTERS_JSON.exists() else []
    scenes = state_items(load_json(SCENES_JSON), "scenes") if SCENES_JSON.exists() else []
    extractions = [item for item in state.get("entityExtractions", []) if item.get("episodeId") == EPISODE_ID]
    extraction = extractions[-1] if extractions else {}
    by_name = {}
    for item in characters:
        name = item.get("name")
        if name:
            by_name[name] = {
                "kind": "角色",
                "id": item.get("id", ""),
                "desc": item.get("description") or item.get("notes") or "剧本策划已抽取角色。",
            }
    for item in scenes:
        name = item.get("name")
        if name:
            by_name[name] = {
                "kind": "场景",
                "id": item.get("id", ""),
                "desc": item.get("notes") or item.get("atmosphere") or item.get("location") or "剧本策划已抽取场景。",
            }
    for item in extraction.get("characters", []):
        name = item.get("name")
        if name:
            previous = by_name.get(name, {})
            by_name[name] = {
                "kind": "角色",
                "id": item.get("characterId", previous.get("id", "")),
                "desc": item.get("note") or previous.get("desc") or "剧本策划已抽取角色。",
            }
    for item in extraction.get("scenes", []):
        name = item.get("name")
        if name:
            previous = by_name.get(name, {})
            by_name[name] = {
                "kind": "场景",
                "id": item.get("sceneId", previous.get("id", "")),
                "desc": item.get("note") or previous.get("desc") or "剧本策划已抽取场景。",
            }
    for item in extraction.get("props", []):
        name = item.get("name")
        if name:
            by_name[name] = {
                "kind": "道具",
                "id": item.get("assetId", ""),
                "desc": item.get("note") or "剧本策划已抽取道具。",
            }
    attach_asset_images(by_name)
    attach_asset_alias_catalog_entries(by_name)
    return by_name


def normalize_name(value):
    return re.sub(r"[\s·《》「」『』“”\"'，,。.!！?？：:；;、()\[\]【】_-]+", "", value or "").lower()


def load_asset_image_rows():
    if not ASSET_DB.exists():
        return []
    with sqlite3.connect(str(ASSET_DB)) as conn:
        conn.row_factory = sqlite3.Row
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(assets)")}
        selected = [name for name in ["id", "type", "name", "filePath", "description", "note", "prompt", "images"] if name in columns]
        rows = conn.execute(f"SELECT {', '.join(selected)} FROM assets").fetchall()
    image_rows = []
    for row in rows:
        item = {key: row[key] for key in row.keys()}
        if item.get("type") not in {"role", "scene", "tool"}:
            continue
        file_path = item.get("filePath")
        if not file_path:
            continue
        original = ASSET_FILES / file_path
        if original.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        if not original.exists():
            continue
        item["imagePath"] = str(original)
        item["searchText"] = " ".join(str(item.get(key) or "") for key in ("name", "description", "note", "prompt"))
        image_rows.append(item)
    return image_rows


def find_voice_reference_audio():
    if not ASSET_DB.exists():
        raise RuntimeError(f"资产库不存在，无法绑定音色参考: {ASSET_DB}")
    with sqlite3.connect(str(ASSET_DB)) as conn:
        conn.row_factory = sqlite3.Row
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(assets)")}
        selected = [name for name in ["id", "type", "name", "filePath", "description", "prompt", "remark"] if name in columns]
        rows = conn.execute(f"SELECT {', '.join(selected)} FROM assets").fetchall()
    preferred = [
        VOICE_REFERENCE_NAME,
        "男-中年、正直、清爽",
        "文学旁白解说（男声）",
        "男-低沉 厚重 历历在目",
    ]
    audio_rows = []
    for row in rows:
        item = {key: row[key] for key in row.keys()}
        file_path = item.get("filePath") or ""
        original = ASSET_FILES / file_path
        if item.get("type") != "audio" or original.suffix.lower() not in {".wav", ".mp3", ".m4a", ".aac", ".aiff", ".aif"}:
            continue
        if original.exists():
            item["audioPath"] = str(original)
            item["voice_reference_text"] = (
                item.get("description")
                or item.get("prompt")
                or item.get("remark")
                or VOICE_REFERENCE_TEXT_FALLBACK
            ).strip()
            audio_rows.append(item)
    for name in preferred:
        for row in audio_rows:
            if row.get("name") == name:
                return row
    for row in audio_rows:
        haystack = normalize_name(" ".join(str(row.get(key) or "") for key in ("name", "description", "note")))
        if "中年男" in haystack or ("男" in haystack and "中年" in haystack):
            return row
    raise RuntimeError(f"资产库没有找到男中年音色参考: {VOICE_REFERENCE_NAME}")


def load_audio_rows():
    if not ASSET_DB.exists():
        raise RuntimeError(f"资产库不存在，无法绑定音色参考: {ASSET_DB}")
    with sqlite3.connect(str(ASSET_DB)) as conn:
        conn.row_factory = sqlite3.Row
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(assets)")}
        selected = [name for name in ["id", "type", "name", "filePath", "description", "prompt", "remark", "tags", "source"] if name in columns]
        rows = conn.execute(f"SELECT {', '.join(selected)} FROM assets WHERE type = 'audio'").fetchall()
    audio_rows = []
    for row in rows:
        item = {key: row[key] for key in row.keys()}
        file_path = item.get("filePath") or ""
        original = ASSET_FILES / file_path
        if original.suffix.lower() not in {".wav", ".mp3", ".m4a", ".aac", ".aiff", ".aif"}:
            continue
        if not original.exists():
            continue
        item["audioPath"] = str(original)
        item["voice_reference_text"] = (
            item.get("description")
            or item.get("prompt")
            or item.get("remark")
            or VOICE_REFERENCE_TEXT_FALLBACK
        ).strip()
        audio_rows.append(item)
    return audio_rows


def resolve_voice_profile_for_speaker(speaker, audio_rows):
    preferences = ROLE_VOICE_PREFERENCES.get(speaker, ROLE_VOICE_PREFERENCES["旁白"])
    for preferred_name in preferences:
        for row in audio_rows:
            if row.get("name") == preferred_name:
                return {
                    "profileId": f"daojie-{asset_key(speaker)}-voice-reference",
                    "speaker": speaker,
                    "name": row.get("name") or preferred_name,
                    "audioPath": row["audioPath"],
                    "referenceText": row.get("voice_reference_text") or VOICE_REFERENCE_TEXT_FALLBACK,
                    "instruct": f"{ROLE_VOICE_INSTRUCTIONS.get(speaker, ROLE_VOICE_INSTRUCTIONS['旁白'])} 使用中文普通话，情绪贴合角色，不要机械朗读。",
                    "matched": "exact",
                }
    normalized_preferences = [normalize_name(name) for name in preferences]
    for row in audio_rows:
        haystack = normalize_name(" ".join(str(row.get(key) or "") for key in ("name", "description", "prompt", "remark")))
        if any(name and name in haystack for name in normalized_preferences):
            return {
                "profileId": f"daojie-{asset_key(speaker)}-voice-reference",
                "speaker": speaker,
                "name": row.get("name") or speaker,
                "audioPath": row["audioPath"],
                "referenceText": row.get("voice_reference_text") or VOICE_REFERENCE_TEXT_FALLBACK,
                "instruct": f"{ROLE_VOICE_INSTRUCTIONS.get(speaker, ROLE_VOICE_INSTRUCTIONS['旁白'])} 使用中文普通话，情绪贴合角色，不要机械朗读。",
                "matched": "fuzzy",
            }
    raise RuntimeError(f"资产库没有找到角色音色参考: {speaker} / {', '.join(preferences)}")


def build_voice_profile_map(speakers):
    audio_rows = load_audio_rows()
    return {speaker: resolve_voice_profile_for_speaker(speaker, audio_rows) for speaker in sorted(speakers)}


def find_asset_image(name, image_rows):
    candidates = ASSET_IMAGE_ALIASES.get(name, [name])
    normalized_candidates = [normalize_name(candidate) for candidate in candidates]
    for candidate in normalized_candidates:
        for row in image_rows:
            if normalize_name(row.get("name")) == candidate:
                return row
    for candidate in normalized_candidates:
        for row in image_rows:
            haystack = normalize_name(row.get("searchText"))
            if candidate and (candidate in haystack or haystack in candidate):
                return row
    return None


def attach_asset_images(asset_catalog):
    image_rows = load_asset_image_rows()
    for name, item in asset_catalog.items():
        match = find_asset_image(name, image_rows)
        if not match:
            continue
        item["imagePath"] = match["imagePath"]
        item["imageAssetName"] = match.get("name") or name
        item["imageAssetType"] = match.get("type") or ""


def attach_asset_alias_catalog_entries(asset_catalog):
    for alias_name, candidates in ASSET_IMAGE_ALIASES.items():
        current = asset_catalog.get(alias_name)
        if current and current.get("imagePath"):
            continue
        source_name = next(
            (
                candidate
                for candidate in candidates
                if candidate != alias_name and asset_catalog.get(candidate, {}).get("imagePath")
            ),
            "",
        )
        if not source_name:
            continue
        source = asset_catalog[source_name]
        item = dict(current or source)
        item["kind"] = item.get("kind") or source.get("kind") or "提取物"
        item["id"] = item.get("id") or source.get("id", "")
        item["desc"] = item.get("desc") or source.get("desc") or f"{alias_name} 使用 {source_name} 的资产图。"
        item["imagePath"] = source["imagePath"]
        item["imageAssetName"] = source.get("imageAssetName") or source_name
        item["imageAssetType"] = source.get("imageAssetType") or ""
        item["imageAliasOf"] = source_name
        asset_catalog[alias_name] = item


def resolve_asset_ids(scene, names, asset_index):
    ids = []
    for name in [scene, *names]:
        asset_id = asset_index.get(name)
        if asset_id and asset_id not in ids:
            ids.append(asset_id)
    return ids


def find_episode_extraction(state):
    extractions = [item for item in state.get("entityExtractions", []) if item.get("episodeId") == EPISODE_ID]
    return extractions[-1] if extractions else {}


def load_project_collection(path, key, default_state):
    data = load_json(path) if path.exists() else {"state": default_state, "version": 0}
    state = data.setdefault("state", {})
    state.setdefault(key, [])
    return data, state[key]


def find_by_id_or_name(items, asset_id, name):
    return next(
        (
            item
            for item in items
            if item.get("id") == asset_id or (name and item.get("name") == name)
        ),
        None,
    )


def create_derived_asset_image(parent_image_path, output_path, parent_name, state_name, reason):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (1280, 720), (24, 25, 23))
    if parent_image_path and Path(parent_image_path).exists():
        parent = Image.open(parent_image_path).convert("RGB")
        parent.thumbnail((760, 620), Image.Resampling.LANCZOS)
        x = 70 + (760 - parent.width) // 2
        y = 50 + (620 - parent.height) // 2
        canvas.paste(parent, (x, y))
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((820, 0, 1280, 720), fill=(12, 13, 12, 218))
    draw.rectangle((840, 52, 1240, 668), outline=(222, 188, 112, 180), width=3)
    title_font = font(42, True)
    state_font = font(34, True)
    body_font = font(24)
    draw_wrapped(draw, (868, 94), parent_name, title_font, (248, 239, 207, 255), 340, 8, 2)
    draw_wrapped(draw, (868, 190), state_name, state_font, (255, 209, 116, 255), 340, 8, 2)
    draw_wrapped(draw, (868, 302), reason, body_font, (218, 213, 198, 235), 330, 10, 7)
    draw.text((868, 614), "MYStudio derived asset", font=font(18), fill=(139, 134, 120, 220))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")
    canvas.save(output_path, quality=92)
    return str(output_path)


def image_workflow_graph(flow_id, target, title, prompt, source_image_path, result_image_path, created_at):
    ref_id = f"ref-{flow_id}"
    gen_id = f"gen-{flow_id}"
    return {
        "id": flow_id,
        "name": f"道劫 · {title} 图片工作流",
        "target": target,
        "nodes": [
            {
                "id": ref_id,
                "type": "reference",
                "title": "父资产参考图",
                "imageUrl": source_image_path,
                "source": {
                    "kind": "asset",
                    "assetType": target["assetType"],
                    "id": target.get("parentId"),
                },
                "position": {"x": 80, "y": 100},
                "createdAt": created_at,
                "updatedAt": created_at,
            },
            {
                "id": gen_id,
                "type": "generated",
                "title": f"{title} 成图",
                "prompt": prompt,
                "aspectRatio": "16:9",
                "quality": "standard",
                "position": {"x": 620, "y": 120},
                "resultUrl": result_image_path,
                "status": "ready",
                "generatedAt": created_at,
                "createdAt": created_at,
                "updatedAt": created_at,
            },
        ],
        "edges": [
            {
                "id": f"{ref_id}->{gen_id}",
                "source": ref_id,
                "target": gen_id,
            }
        ],
        "createdAt": created_at,
        "updatedAt": created_at,
    }


def sync_project_derived_assets(state, asset_catalog):
    extraction = find_episode_extraction(state)
    character_data, characters = load_project_collection(
        CHARACTERS_JSON,
        "characters",
        {"folders": [], "characters": [], "currentFolderId": None},
    )
    scene_data, scenes = load_project_collection(
        SCENES_JSON,
        "scenes",
        {"scenes": [], "folders": [], "generationPrefs": {}},
    )
    prop_data, props = load_project_collection(
        PROPS_JSON,
        "items",
        {"items": [], "folders": [], "selectedFolderId": "all"},
    )

    for character in characters:
        image_path = asset_catalog.get(character.get("name", ""), {}).get("imagePath")
        if image_path:
            character["thumbnailUrl"] = image_path
    for scene in scenes:
        image_path = asset_catalog.get(scene.get("name", ""), {}).get("imagePath")
        if image_path:
            scene["referenceImage"] = image_path
    for item in extraction.get("props", []):
        name = item.get("name", "")
        prop_id = item.get("assetId") or f"prop-{normalize_name(name)}"
        prop = find_by_id_or_name(props, prop_id, name)
        image_path = asset_catalog.get(name, {}).get("imagePath", "")
        if not prop:
            prop = {
                "id": prop_id,
                "name": name,
                "projectId": PROJECT.name,
                "description": item.get("note") or f"{name} 剧本资产",
                "visualPrompt": item.get("note") or f"{name} 剧本资产",
                "imageUrl": image_path,
                "folderId": None,
                "createdAt": 1780298212339,
                "updatedAt": 1780298212339,
            }
            props.append(prop)
        elif image_path:
            prop["imageUrl"] = image_path

    manifest = []
    derived_dir = EXPORTS / "toonflow_derived_assets"
    image_workflows = [
        graph
        for graph in state.get("imageWorkflows", [])
        if graph.get("id") not in {item["flowId"] for item in DERIVED_ASSET_IDS.values()}
    ]
    for index, item in enumerate(DERIVED_ASSET_PLAN, 1):
        ids = DERIVED_ASSET_IDS[(item["parentAssetId"], item["state"])]
        now = 1780300100000 + index
        prompt = build_derived_asset_image_prompt(
            item["parentAssetId"],
            item["state"],
            item["reason"],
            ids["assetType"],
        )
        if ids["assetType"] == "character":
            parent = find_by_id_or_name(characters, "", item["parentAssetId"])
            if not parent:
                raise RuntimeError(f"衍生资产父角色缺失: {item['parentAssetId']}")
            parent_id = parent["id"]
            source_image = parent.get("thumbnailUrl") or asset_catalog.get(item["parentAssetId"], {}).get("imagePath", "")
            result_image = create_derived_asset_image(source_image, derived_dir / f"{ids['id']}.jpg", item["parentAssetId"], item["state"], item["reason"])
            variations = parent.setdefault("variations", [])
            variation = find_by_id_or_name(variations, ids["id"], item["state"])
            patch = {
                "id": ids["id"],
                "name": item["state"],
                "visualPrompt": prompt,
                "visualPromptZh": prompt,
                "referenceImage": result_image,
                "imageWorkflowId": ids["flowId"],
                "imageWorkflowNodeId": f"gen-{ids['flowId']}",
                "generatedAt": now,
                "isStageVariation": True,
                "stageDescription": item["reason"],
            }
            if variation:
                variation.update(patch)
            else:
                variations.append(patch)
        elif ids["assetType"] == "scene":
            parent = find_by_id_or_name(scenes, "", item["parentAssetId"])
            if not parent:
                raise RuntimeError(f"衍生资产父场景缺失: {item['parentAssetId']}")
            parent_id = parent["id"]
            source_image = parent.get("referenceImage") or asset_catalog.get(item["parentAssetId"], {}).get("imagePath", "")
            result_image = create_derived_asset_image(source_image, derived_dir / f"{ids['id']}.jpg", item["parentAssetId"], item["state"], item["reason"])
            derived = find_by_id_or_name(scenes, ids["id"], f"{item['parentAssetId']}·{item['state']}")
            patch = {
                "id": ids["id"],
                "name": f"{item['parentAssetId']}·{item['state']}",
                "location": item["parentAssetId"],
                "time": "",
                "atmosphere": "",
                "visualPrompt": prompt,
                "visualPromptZh": prompt,
                "projectId": PROJECT.name,
                "parentSceneId": parent_id,
                "isViewpointVariant": True,
                "viewpointName": item["state"],
                "notes": item["reason"],
                "status": "linked",
                "referenceImage": result_image,
                "imageWorkflowId": ids["flowId"],
                "imageWorkflowNodeId": f"gen-{ids['flowId']}",
                "createdAt": now,
                "updatedAt": now,
            }
            if derived:
                derived.update(patch)
            else:
                scenes.append(patch)
        else:
            parent = find_by_id_or_name(props, "", item["parentAssetId"])
            if not parent:
                raise RuntimeError(f"衍生资产父道具缺失: {item['parentAssetId']}")
            parent_id = parent["id"]
            source_image = parent.get("imageUrl") or asset_catalog.get(item["parentAssetId"], {}).get("imagePath", "")
            result_image = create_derived_asset_image(source_image, derived_dir / f"{ids['id']}.jpg", item["parentAssetId"], item["state"], item["reason"])
            derived = find_by_id_or_name(props, ids["id"], f"{item['parentAssetId']}·{item['state']}")
            patch = {
                "id": ids["id"],
                "name": f"{item['parentAssetId']}·{item['state']}",
                "projectId": PROJECT.name,
                "description": item["reason"],
                "visualPrompt": prompt,
                "imageUrl": result_image,
                "isDerivative": True,
                "parentId": parent_id,
                "category": item["state"],
                "folderId": None,
                "imageWorkflowId": ids["flowId"],
                "imageWorkflowNodeId": f"gen-{ids['flowId']}",
                "createdAt": now,
                "updatedAt": now,
            }
            if derived:
                derived.update(patch)
            else:
                props.append(patch)

        target = {
            "kind": "asset",
            "assetType": ids["assetType"],
            "parentId": parent_id,
            "id": ids["id"],
        }
        image_workflows.append(image_workflow_graph(ids["flowId"], target, item["state"], prompt, source_image, result_image, now))
        manifest.append({
            "parentAssetId": parent_id,
            "parentAssetName": item["parentAssetId"],
            "derivedAssetId": ids["id"],
            "state": item["state"],
            "assetType": ids["assetType"],
            "sourceImagePath": source_image,
            "resultImagePath": result_image,
            "imageWorkflowId": ids["flowId"],
            "imageWorkflowNodeId": f"gen-{ids['flowId']}",
        })

    state["imageWorkflows"] = image_workflows
    return {
        "manifest": manifest,
        "stores": {
            "characters": character_data,
            "scenes": scene_data,
            "props": prop_data,
        },
    }


def build_storyboard_table(asset_index, shots=None):
    shots = shots or canonical_storyboard_shots()
    lines = [
        "<storyboardTable>",
        "## 场1：金水河码头·鞭下入镇 ｜ 参演角色：独孤剑尘、监工赵四、小杂役、老苦力、年轻苦力",
        "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    previous_scene_no = 1
    for index, shot in enumerate(shots, 1):
        scene, desc, speaker, text, sound, assets, duration = shot_tuple(shot)
        scene_no = shot.get("sceneNo", previous_scene_no) if isinstance(shot, dict) else previous_scene_no
        if scene_no != previous_scene_no and scene_no == 2:
            lines.append("## 场2：悦来客栈·断剑显露 ｜ 参演角色：独孤剑尘、掌柜、宗门弟子甲、宗门弟子乙")
        if scene_no != previous_scene_no and scene_no == 3:
            lines.append("## 场3：金水塾馆·晏燎燃气 ｜ 参演角色：独孤剑尘、李先生、晏燎、孩童甲、丫头")
        if scene_no != previous_scene_no and scene_no == 4:
            lines.append("## 场4：悦来斗室与金水河·归元认人 ｜ 参演角色：独孤剑尘、晏燎、宗门灵舟")
        previous_scene_no = scene_no
        dialogue = f"{speaker}：{text}" if speaker != "旁白" else f"旁白：{text}"
        asset_ids = resolve_asset_ids(scene, assets, asset_index)
        lines.append(
            f"| {index} | {desc} | {scene} | [{', '.join(assets)}] | {duration} | 中景 | 缓推 | {desc} | — | — | {emotion_for(index)} | {dialogue} | {sound} | [{', '.join(asset_ids)}] |"
        )
    lines.append("</storyboardTable>")
    return "\n".join(lines)


def asset_key(name):
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", name).strip("-")


def emotion_for(index, scene_no=None):
    if scene_no == 1 or (scene_no is None and index <= 12):
        return "压迫紧张"
    if scene_no == 2 or (scene_no is None and index <= 24):
        return "克制旧痛"
    if scene_no == 3 or (scene_no is None and index <= 40):
        return "试探震动"
    return "命运逼近"


def voice_emotion_for(index, speaker):
    base = "中年男声，低沉克制，电影级旁白质感，语速偏慢，停顿自然，避免机械朗读。"
    if speaker == "赵四":
        return f"{base} 压迫、粗粝、带威胁感，句尾短促。"
    if speaker in {"小杂役", "孩童甲", "丫头", "晏燎"}:
        return f"{base} 保持男中年克隆音色，但表演出紧张、怯意或少年倔强，音量压低。"
    if speaker == "李先生":
        return f"{base} 严厉、克制、带一丝不忍，判词要重。"
    if speaker == "掌柜":
        return f"{base} 市井、谨慎、压低声音，算盘般冷淡。"
    if speaker.startswith("宗门弟子"):
        return f"{base} 冷漠、轻慢、像在谈账目。"
    if speaker == "独孤剑尘":
        if index <= 24:
            return f"{base} 隐忍、疲惫、旧伤未愈，台词短而稳。"
        return f"{base} 震动后压住情绪，坚定、低声、有旧仇的重量。"
    return f"{base} 叙事要有压迫感和留白，关键字前后有停顿。"


def line_speaker(speaker):
    return "narrator" if speaker == "旁白" else f"character:{speaker}"


def run(cmd):
    if cmd and cmd[0] == "ffmpeg":
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", *cmd[1:]]
    subprocess.run(cmd, check=True)


def http_json(method, path, payload=None, token=TTS_TOKEN, timeout=30):
    data = None
    headers = {"X-Manying-TTS-Token": token}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(f"{TTS_BASE_URL}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def http_bytes(method, path, token=TTS_TOKEN, timeout=60):
    request = urllib.request.Request(f"{TTS_BASE_URL}{path}", method=method, headers={"X-Manying-TTS-Token": token})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def health_check(timeout=1):
    try:
        request = urllib.request.Request(f"{TTS_BASE_URL}/health", method="GET")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload.get("ok") is True and payload.get("service") == "manying-voicebox-tts"
    except Exception:
        return False


def start_tts_backend():
    if health_check():
        return None
    python_bin = APP_PYTHON if APP_PYTHON.exists() else BACKEND_ROOT / "python" / "bin" / "python3.12"
    if not python_bin.exists():
        raise RuntimeError(f"未找到可用 Python3.12: {python_bin}")
    env = {
        **os.environ,
        "PYTHONPATH": str(BACKEND_ROOT),
        "MANYING_TTS_DATA_DIR": str(APP_SUPPORT / "tts-runtime"),
        "MANYING_TTS_MODELS_DIR": str(APP_SUPPORT / "tts-models"),
        "VOICEBOX_MODELS_DIR": str(APP_SUPPORT / "tts-models"),
        "HF_HUB_CACHE": str(Path.home() / ".cache" / "huggingface" / "hub"),
        "MANYING_TTS_CONTROL_TOKEN": TTS_TOKEN,
        "MANYING_TTS_ENGINE_MODE": os.environ.get("MANYING_TTS_ENGINE_MODE", "real"),
        "MANYING_TTS_QWEN_BACKEND": os.environ.get("MANYING_TTS_QWEN_BACKEND", "mlx"),
    }
    process = subprocess.Popen(
        [
            str(python_bin),
            "-m",
            "manying_voicebox_tts.main",
            "--host",
            TTS_HOST,
            "--port",
            str(TTS_PORT),
            "--data-dir",
            str(APP_SUPPORT / "tts-runtime"),
        ],
        cwd=str(BACKEND_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    for _ in range(60):
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            if "PermissionError" in stderr and "Operation not permitted" in stderr:
                raise RuntimeError("本地端口绑定被当前环境阻止，无法启动 TTS 后端；请在允许 127.0.0.1 监听的桌面/终端环境重新运行")
            raise RuntimeError(f"TTS 后端启动失败: {stdout.strip()} {stderr.strip()}".strip())
        if health_check():
            return process
        time.sleep(0.5)
    process.terminate()
    raise RuntimeError("TTS 后端启动超时")


def stop_tts_backend(process):
    if process is None:
        return
    try:
        http_json("POST", "/shutdown", {})
    except Exception:
        pass
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def ensure_tts_profile(profile):
    return http_json("POST", "/profiles", {
        "id": profile["profileId"],
        "name": f"道劫-{profile['speaker']}-{profile['name']}",
        "voice_type": "reference",
        "language": "zh",
        "default_engine": VOICE_REFERENCE_ENGINE,
        "default_model_size": VOICE_REFERENCE_MODEL_SIZE,
        "reference_audio_path": profile["audioPath"],
        "reference_text": profile["referenceText"],
        "instruct": profile["instruct"],
    })


def create_tts_audio(path, text, profile, seed):
    if not USE_HTTP_TTS:
        return create_direct_tts_audio(path, text, profile, seed)
    ensure_tts_profile(profile)
    generation = http_json("POST", "/generate", {
        "profile_id": profile["profileId"],
        "text": text,
        "engine": VOICE_REFERENCE_ENGINE,
        "model_size": VOICE_REFERENCE_MODEL_SIZE,
        "language": "zh",
        "seed": seed,
    }, timeout=60)
    generation_id = generation["id"]
    status = generation
    for _ in range(240):
        status = http_json("GET", f"/generate/{generation_id}/status", timeout=30)
        if status.get("status") in {"completed", "failed"}:
            break
        time.sleep(0.5)
    if status.get("status") != "completed":
        raise RuntimeError(f"TTS 生成失败: {status.get('error') or status}")
    audio_bytes = http_bytes("GET", f"/audio/{generation_id}", timeout=60)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio_bytes)
    return {
        "mode": "local-tts",
        "backend": status.get("backend") or "",
        "mocked": bool(status.get("mocked")),
        "warning": status.get("warning"),
        "generationId": generation_id,
    }


def create_direct_tts_audio(path, text, voice_profile, seed):
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))
    os.environ.setdefault("MANYING_TTS_ENGINE_MODE", "real")
    os.environ.setdefault("MANYING_TTS_QWEN_BACKEND", "mlx")
    os.environ.setdefault("MANYING_TTS_MODELS_DIR", str(APP_SUPPORT / "tts-models"))
    os.environ.setdefault("VOICEBOX_MODELS_DIR", str(APP_SUPPORT / "tts-models"))
    os.environ.setdefault("HF_HUB_CACHE", str(Path.home() / ".cache" / "huggingface" / "hub"))
    from manying_voicebox_tts.engine import synthesize_to_wav

    profile = {
        "id": voice_profile["profileId"],
        "name": f"道劫-{voice_profile['speaker']}-{voice_profile['name']}",
        "voice_type": "reference",
        "language": "zh",
        "default_engine": VOICE_REFERENCE_ENGINE,
        "default_model_size": VOICE_REFERENCE_MODEL_SIZE,
        "reference_audio_path": voice_profile["audioPath"],
        "reference_text": voice_profile["referenceText"],
        "instruct": voice_profile["instruct"],
    }
    result = synthesize_to_wav(
        output=path,
        text=text,
        profile=profile,
        engine=VOICE_REFERENCE_ENGINE,
        model_size=VOICE_REFERENCE_MODEL_SIZE,
        language="zh",
        seed=seed,
    )
    return {
        "mode": "local-tts-direct",
        "backend": result.backend,
        "mocked": result.mocked,
        "warning": result.warning,
        "generationId": "",
    }


def spoken_text_for(speaker, text):
    cleaned = text.strip()
    if not cleaned:
        return cleaned
    if not cleaned.endswith(("。", "！", "？", "……")):
        cleaned = f"{cleaned}。"
    if len(cleaned) <= 8:
        return f"{cleaned}……"
    if speaker == "旁白":
        return cleaned
    return cleaned


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/STHeiti Medium.ttc" if bold else "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def wrap_text(draw, text, font_obj, max_width, max_lines=None):
    lines = []
    current = ""
    for char in text:
        candidate = current + char
        if draw.textbbox((0, 0), candidate, font=font_obj)[2] <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = char
        if max_lines and len(lines) >= max_lines:
            break
    if current and (not max_lines or len(lines) < max_lines):
        lines.append(current)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
    return lines


def draw_wrapped(draw, xy, text, font_obj, fill, max_width, line_gap=10, max_lines=None):
    x, y = xy
    lines = wrap_text(draw, text, font_obj, max_width, max_lines)
    for line in lines:
        draw.text((x, y), line, font=font_obj, fill=fill)
        bbox = draw.textbbox((x, y), line, font=font_obj)
        y += (bbox[3] - bbox[1]) + line_gap
    return y


def scene_plan_for(index, scene_no=None):
    if scene_no == 1 or (scene_no is None and index <= 12):
        return "Sc1 鞭下入镇：鞭梢将落、小杂役护头，独孤以极小动作救人；压迫转隐忍。"
    if scene_no == 2 or (scene_no is None and index <= 24):
        return "Sc2 断剑显露：铜钱、账册、油布剑包、归元断剑串联旧痛；冷眼旁观转旧伤翻涌。"
    if scene_no == 3 or (scene_no is None and index <= 40):
        return "Sc3 晏燎燃气：塾馆试探引气，掌心暗红一息后被李先生压住；希望转震动。"
    return "Sc4 归元认人：残卷与断剑确认晏燎，宗门灵舟压雾逼近；传承确认转危机。"


def track_key_for(index, scene_no=None):
    if scene_no == 1 or (scene_no is None and index <= 12):
        return "chapter-001-scene-1"
    if scene_no == 2 or (scene_no is None and index <= 24):
        return "chapter-001-scene-2"
    if scene_no == 3 or (scene_no is None and index <= 40):
        return "chapter-001-scene-3"
    return "chapter-001-scene-4"


def resolve_image_assets(scene, assets, asset_catalog):
    image_assets = []
    seen_paths = set()
    for asset_name in [scene, *assets]:
        item = asset_catalog.get(asset_name, {})
        image_path = item.get("imagePath")
        if not image_path or image_path in seen_paths:
            continue
        seen_paths.add(image_path)
        image_assets.append({
            "name": asset_name,
            "kind": item.get("kind", "提取物"),
            "assetId": item.get("id", ""),
            "imagePath": image_path,
            "sourceName": item.get("imageAssetName", asset_name),
        })
    return image_assets


def select_primary_visual(scene, image_assets):
    focused = [asset for asset in image_assets if asset["name"] != scene]
    return focused[0] if focused else next((asset for asset in image_assets if asset["name"] == scene), image_assets[0] if image_assets else None)


def select_scene_visual(scene, image_assets):
    return next((asset for asset in image_assets if asset["name"] == scene), image_assets[0] if image_assets else None)


def load_cover_image(image_path, size):
    image = Image.open(image_path).convert("RGB")
    background = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    background = background.filter(ImageFilter.GaussianBlur(24))
    overlay = Image.new("RGB", size, "#0f1714")
    background = Image.blend(background, overlay, 0.34)
    foreground = ImageOps.contain(image, (size[0] - 120, size[1] - 120), method=Image.Resampling.LANCZOS)
    x = (size[0] - foreground.width) // 2
    y = (size[1] - foreground.height) // 2
    background.paste(foreground, (x, y))
    return background


def foreground_subject_with_shadow(source_path, target_size, kind=""):
    source = Image.open(source_path).convert("RGBA")
    if kind in {"角色", "role"} and source.width > source.height * 0.55:
        source = source.crop((0, 0, max(1, source.width // 2), source.height))
    pixels = source.load()
    mask = Image.new("L", source.size, 0)
    mask_pixels = mask.load()
    for y in range(source.height):
        for x in range(source.width):
            r, g, b, a = pixels[x, y]
            near_white = r > 218 and g > 218 and b > 218 and (max(r, g, b) - min(r, g, b)) < 42
            near_black = r < 28 and g < 28 and b < 28
            if a and not near_white and not near_black:
                mask_pixels[x, y] = 255
    mask = mask.filter(ImageFilter.MedianFilter(7))
    mask_array = np.array(mask) > 0
    labels, count = ndimage.label(mask_array)
    if count:
        sizes = ndimage.sum(mask_array, labels, range(1, count + 1))
        largest_label = int(np.argmax(sizes) + 1)
        mask = Image.fromarray(((labels == largest_label) * 255).astype(np.uint8), "L")
        mask = mask.filter(ImageFilter.MaxFilter(11))
    bbox = mask.getbbox()
    if bbox:
        source = source.crop(bbox)
        mask = mask.crop(bbox)
    source = ImageOps.contain(source, target_size, method=Image.Resampling.LANCZOS)
    mask = ImageOps.contain(mask, target_size, method=Image.Resampling.LANCZOS)
    alpha = mask.filter(ImageFilter.GaussianBlur(0.8))
    alpha_limit = 210 if kind in {"角色", "role"} else 185
    source.putalpha(alpha.point(lambda value: min(alpha_limit, value)))
    layer = Image.new("RGBA", (source.width + 46, source.height + 46), (0, 0, 0, 0))
    shadow = Image.new("RGBA", source.size, (0, 0, 0, 125))
    shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(18)))
    layer.paste(shadow, (30, 30), shadow)
    layer.alpha_composite(source, (0, 0))
    return layer


def compose_frame_image_assets(scene, image_assets, size):
    scene_visual = select_scene_visual(scene, image_assets)
    primary_visual = select_primary_visual(scene, image_assets)
    if not scene_visual:
        raise RuntimeError(f"缺少可用于组合的画面资产: {scene}")
    canvas = load_cover_image(scene_visual["imagePath"], size).convert("RGBA")
    foreground_assets = [asset for asset in image_assets if asset["imagePath"] != scene_visual["imagePath"]]
    foreground_assets.sort(key=lambda asset: 0 if asset.get("kind") in {"角色", "role"} else 1)
    foreground_assets = foreground_assets[:2]
    if not foreground_assets:
        return canvas.convert("RGB")

    width, height = size
    if len(foreground_assets) == 1:
        boxes = [(1330, 210, 1680, 610)]
    else:
        boxes = [(170, 330, 450, 705), (1370, 230, 1680, 610)]

    for asset, box in zip(foreground_assets, boxes):
        x1, y1, x2, y2 = box
        layer = foreground_subject_with_shadow(asset["imagePath"], (x2 - x1, y2 - y1), asset.get("kind", ""))
        x = x1 + ((x2 - x1) - layer.width) // 2
        y = y1 + ((y2 - y1) - layer.height) // 2
        canvas.alpha_composite(layer, (x, y))
    return canvas.convert("RGB")


def load_contained_image(image_path, size):
    canvas = Image.new("RGB", size, "#151d1a")
    image = Image.open(image_path).convert("RGB")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    x = (size[0] - image.width) // 2
    y = (size[1] - image.height) // 2
    canvas.paste(image, (x, y))
    return canvas


def paste_rounded_image(base, image, box, radius=22):
    x1, y1, x2, y2 = box
    mask = Image.new("L", (x2 - x1, y2 - y1), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((0, 0, x2 - x1, y2 - y1), radius=radius, fill=255)
    base.paste(image, (x1, y1), mask)


def draw_glass_panel(draw, box, fill="#111916", outline="#6f7b68", width=2):
    draw.rounded_rectangle(box, radius=22, fill=fill, outline=outline, width=width)


def create_frame(path, index, scene, desc, speaker, text, sound, assets, asset_ids, asset_catalog, image_assets):
    width, height = 1920, 1080
    if not image_assets:
        raise RuntimeError(f"分镜 {index:02d} 缺少可用于成片的主视觉图: {scene}")

    img = compose_frame_image_assets(scene, image_assets, (width, height))
    draw = ImageDraw.Draw(img)
    subtitle_font = font(44, True)
    subtitle_text = f"{speaker}：{text}" if speaker != "旁白" else text
    subtitle_lines = wrap_text(draw, subtitle_text, subtitle_font, 1500, 2)
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rectangle((0, 812, width, height), fill=(0, 0, 0, 112))
    line_height = 58
    total_height = len(subtitle_lines) * line_height
    y = 906 - total_height // 2
    for line in subtitle_lines:
        bbox = overlay_draw.textbbox((0, 0), line, font=subtitle_font)
        x = (width - (bbox[2] - bbox[0])) // 2
        overlay_draw.text((x + 3, y + 3), line, font=subtitle_font, fill=(0, 0, 0, 210))
        overlay_draw.text((x, y), line, font=subtitle_font, fill=(248, 241, 216, 255))
        y += line_height
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def create_audio(path, speaker, text, voice_profile, seed):
    spoken_text = spoken_text_for(speaker, text)
    reuse_audio_warning = ""
    if REUSE_AUDIO_DIR:
        reused = Path(REUSE_AUDIO_DIR) / path.name
        if reused.exists() and reused.stat().st_size > 0:
            path.parent.mkdir(parents=True, exist_ok=True)
            if reused.resolve() != path.resolve():
                shutil.copy2(reused, path)
            return {
                "mode": "reused-local-tts-audio",
                "backend": "qwen-mlx",
                "mocked": False,
                "warning": "",
                "generationId": "",
            }
        reuse_audio_warning = f"复用音频缺失，改走真实 TTS: {reused}"
    if SILENT_PREVIEW:
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1.0", str(path)])
        return {
            "mode": "silent-visual-preview",
            "backend": "ffmpeg-anullsrc",
            "mocked": False,
            "warning": "; ".join(filter(None, [reuse_audio_warning, "视觉验证用静音音轨，不是最终配音"])),
            "generationId": "",
        }
    generation_error = None
    try:
        result = create_tts_audio(path, spoken_text, voice_profile, seed)
        if reuse_audio_warning:
            result["warning"] = "; ".join(filter(None, [reuse_audio_warning, result.get("warning")]))
        if REQUIRE_REAL_TTS and result.get("mocked"):
            raise RuntimeError(f"TTS 返回 mock 音频: {result.get('warning') or result.get('backend')}")
        return result
    except Exception as exc:
        generation_error = exc
        if REQUIRE_REAL_TTS and not ALLOW_TTS_FALLBACK:
            raise RuntimeError(f"真实 TTS 生成失败，已阻止系统朗读 fallback: {exc}") from exc
    voice = "Reed (中文（中国大陆）)"
    temp_aiff = path.with_suffix(".aiff")
    run(["say", "-v", voice, "-o", str(temp_aiff), spoken_text])
    run(["ffmpeg", "-y", "-i", str(temp_aiff), "-ar", "24000", "-ac", "1", str(path)])
    temp_aiff.unlink(missing_ok=True)
    return {
        "mode": "fallback-system-voice",
        "backend": "macos-say",
        "mocked": False,
        "warning": "; ".join(filter(None, [reuse_audio_warning, str(generation_error or "")])),
        "generationId": "",
    }


def audio_duration(path):
    output = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)
    ], text=True).strip()
    return float(output or 0)


def audio_mean_volume_db(path):
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"
    ], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    match = re.search(r"mean_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB", result.stderr)
    if not match or match.group(1) == "-inf":
        return None
    return float(match.group(1))


def audio_sample_info(path):
    duration = audio_duration(path)
    mean_volume = audio_mean_volume_db(path)
    return {
        "path": str(path),
        "duration": round(duration, 3),
        "meanVolumeDb": None if mean_volume is None else round(mean_volume, 2),
    }


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def final_video_evidence(path):
    ffprobe_command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,size:stream=codec_type,duration,width,height",
        "-of",
        "json",
        str(path),
    ]
    ffprobe_raw = subprocess.check_output(ffprobe_command, text=True)
    stat = path.stat()
    return {
        "path": str(path),
        "sizeBytes": stat.st_size,
        "sha256": file_sha256(path),
        "mtime": int(stat.st_mtime),
        "ffprobeCommand": ffprobe_command,
        "ffprobe": json.loads(ffprobe_raw),
    }


def motion_filter_for(index, duration):
    safe_duration = max(0.1, duration)
    progress = f"min(t/{safe_duration:.3f},1)"
    if index % 4 == 0:
        x_expr = "(iw-ow)/2"
        y_expr = f"(ih-oh)*{progress}"
    elif index % 4 == 1:
        x_expr = f"(iw-ow)*{progress}"
        y_expr = "(ih-oh)/2"
    elif index % 4 == 2:
        x_expr = f"(iw-ow)*(1-{progress})"
        y_expr = "(ih-oh)/2"
    else:
        x_expr = "(iw-ow)/2"
        y_expr = f"(ih-oh)*(1-{progress})"
    return (
        "scale=2112:1188:force_original_aspect_ratio=increase,"
        f"crop=w=1920:h=1080:x='{x_expr}':y='{y_expr}',"
        "fps=24,"
        "format=yuv420p"
    )


def render_segment(index, frame, audio, output, duration):
    run([
        "ffmpeg", "-y",
        "-loop", "1", "-t", str(duration), "-i", str(frame),
        "-i", str(audio),
        "-vf", motion_filter_for(index, duration),
        "-af", "volume=12dB,alimiter=limit=0.96,apad,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", "-shortest", str(output),
    ])


def concat_segments(segments, output):
    concat = EXPORTS / "toonflow_concat.txt"
    concat.write_text("\n".join(f"file '{p}'" for p in segments), encoding="utf-8")
    temp_output = output.with_suffix(f".tmp{output.suffix}")
    temp_output.unlink(missing_ok=True)
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
        "-fflags", "+genpts", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-af", "volume=6dB,alimiter=limit=0.98,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-movflags", "+faststart", str(temp_output),
    ])
    temp_output.replace(output)


def workflow_step(step_id, label, ok, evidence):
    return {
        "id": step_id,
        "label": label,
        "ok": bool(ok),
        "evidence": evidence,
    }


def build_workflow_steps(
    state,
    script_text,
    shots,
    asset_catalog,
    script_plan_xml,
    storyboard_table,
    storyboards,
    frame_paths,
    audio_paths,
    segment_paths,
    production_tracks,
    video_candidates,
    final_path,
    missing_image_assets,
    speaker_audio_stats,
    tts_modes,
    tts_mocked_values,
    streams,
    final_audio_mean_volume_db,
):
    episode_chapter = next((item for item in state.get("novelChapters", []) if item.get("id") == EPISODE_ID), None)
    episode_extraction = next(
        (item for item in state.get("entityExtractions", []) if item.get("episodeId") == EPISODE_ID),
        None,
    )
    extracted_count = 0
    if episode_extraction:
        extracted_count = (
            len(episode_extraction.get("characters", []))
            + len(episode_extraction.get("scenes", []))
            + len(episode_extraction.get("props", []))
        )
    image_asset_count = sum(1 for item in asset_catalog.values() if item.get("imagePath"))
    frame_count = sum(1 for path in frame_paths if Path(path).exists())
    audio_count = sum(1 for path in audio_paths if Path(path).exists())
    segment_count = sum(1 for path in segment_paths if Path(path).exists())
    return [
        workflow_step(
            "novel_import",
            "小说导入",
            bool(episode_chapter and episode_chapter.get("sourceText")),
            f"chapter={EPISODE_ID}, chars={len(episode_chapter.get('sourceText', '')) if episode_chapter else 0}",
        ),
        workflow_step(
            "script_generation",
            "剧本生成",
            bool(script_text and shots),
            f"scriptChars={len(script_text or '')}, shots={len(shots)}",
        ),
        workflow_step(
            "asset_extraction",
            "剧本资产提取",
            bool(extracted_count > 0),
            f"extractedAssets={extracted_count}",
        ),
        workflow_step(
            "asset_catalog",
            "资产库匹配",
            image_asset_count > 0 and not missing_image_assets,
            f"imageAssets={image_asset_count}, missing={len(missing_image_assets)}",
        ),
        workflow_step(
            "script_plan",
            "导演计划",
            "<scriptPlan>" in script_plan_xml,
            f"chars={len(script_plan_xml)}",
        ),
        workflow_step(
            "storyboard_table",
            "分镜表",
            "<storyboardTable>" in storyboard_table,
            f"chars={len(storyboard_table)}",
        ),
        workflow_step(
            "frame_generation",
            "分镜画面",
            frame_count == len(storyboards) and len(storyboards) > 0,
            f"frames={frame_count}/{len(storyboards)}",
        ),
        workflow_step(
            "tts_generation",
            "本地 TTS 音频",
            audio_count == len(storyboards) and len(speaker_audio_stats) > 0 and not any(tts_mocked_values),
            f"audio={audio_count}/{len(storyboards)}, speakers={len(speaker_audio_stats)}, modes={'+'.join(sorted(tts_modes))}",
        ),
        workflow_step(
            "segment_render",
            "分段视频渲染",
            segment_count == len(storyboards) and len(storyboards) > 0,
            f"segments={segment_count}/{len(storyboards)}",
        ),
        workflow_step(
            "track_candidates",
            "生产轨道候选",
            len(production_tracks) >= 4 and len(video_candidates) >= 5,
            f"tracks={len(production_tracks)}, candidates={len(video_candidates)}",
        ),
        workflow_step(
            "final_merge",
            "整集合成",
            Path(final_path).exists() and {"video", "audio"}.issubset(streams) and final_audio_mean_volume_db is not None,
            f"final={final_path}, streams={','.join(sorted(streams))}, meanVolume={final_audio_mean_volume_db}",
        ),
        workflow_step(
            "project_writeback",
            "工作流写回",
            not SKIP_PROJECT_WRITE and STORE.exists() and SCRIPT_JSON.exists(),
            f"skipProjectWrite={SKIP_PROJECT_WRITE}",
        ),
    ]


def main():
    required_tools = ["ffmpeg", "ffprobe"]
    if ALLOW_TTS_FALLBACK:
        required_tools.append("say")
    for tool in required_tools:
        if not shutil.which(tool):
            raise RuntimeError(f"缺少命令: {tool}")

    for path in (EXPORTS, FRAMES, AUDIO, SEGMENTS):
        path.mkdir(parents=True, exist_ok=True)

    storyboard_image_config = storyboard_image_provider_config()
    tts_process = start_tts_backend() if USE_HTTP_TTS else None
    store = load_json(STORE)
    state = store.setdefault("state", {})
    asset_index = build_asset_index(state)
    asset_catalog = build_asset_catalog(state)
    script_text = latest_script(state)
    shots = build_shots_from_script(script_text)
    source_units = source_dialogue_units(script_text)
    source_segment_count = len(source_segment_units(script_text))
    source_dialogue_chars = sum(len(normalize_dialogue_text(unit)) for unit in source_units)
    spoken_text_chars = sum(len(normalize_dialogue_text(shot["text"])) for shot in shots)
    dialogue_coverage_ratio = min(1.0, spoken_text_chars / source_dialogue_chars) if source_dialogue_chars else 1.0
    if dialogue_coverage_ratio < MIN_DIALOGUE_COVERAGE_RATIO:
        raise RuntimeError(f"台词覆盖率过低: {dialogue_coverage_ratio:.3f} / {MIN_DIALOGUE_COVERAGE_RATIO}")
    speakers = {shot["speaker"] for shot in shots}
    voice_profiles = build_voice_profile_map(speakers)
    script_plan_xml = build_script_plan(shots)
    storyboard_table = build_storyboard_table(asset_index, shots)

    frame_paths = []
    audio_paths = []
    segment_paths = []
    storyboards = []
    tts_modes = set()
    tts_backends = set()
    tts_mocked_values = set()
    tts_warnings = []
    speaker_audio_stats = {speaker: {"lines": 0, "audioFiles": 0, "chars": 0} for speaker in speakers}
    speaker_audio_samples = {}
    used_image_paths = set()
    missing_image_assets = set()
    storyboard_image_workflows = []
    try:
        for index, shot in enumerate(shots, 1):
            scene, desc, speaker, text, sound, assets, duration = shot_tuple(shot)
            scene_no = shot.get("sceneNo", 1)
            frame = FRAMES / f"shot-{index:03d}.png"
            audio = AUDIO / f"shot-{index:03d}.wav"
            segment = SEGMENTS / f"shot-{index:03d}.mp4"
            storyboard_id = f"sb-chapter-001-{index:03d}"
            track_key = track_key_for(index, scene_no)
            asset_ids = resolve_asset_ids(scene, assets, asset_index)
            associate_assets = [scene, *assets]
            image_assets = resolve_image_assets(scene, assets, asset_catalog)
            if not image_assets:
                raise RuntimeError(f"分镜 {index:02d} 没有可用真实资产图片: {scene} / {', '.join(assets)}")
            primary_visual = select_primary_visual(scene, image_assets)
            if not primary_visual:
                raise RuntimeError(f"分镜 {index:02d} 缺少可用于成片的主视觉图: {scene}")
            used_image_paths.add(primary_visual["imagePath"])
            for asset_name in associate_assets:
                if not asset_catalog.get(asset_name, {}).get("imagePath"):
                    missing_image_assets.add(asset_name)
            storyboard_image_result = None
            if is_real_storyboard_image_mode():
                storyboard_image_result = generate_storyboard_frame_with_references(
                    frame,
                    {"id": storyboard_id, "index": index, "prompt": desc},
                    desc,
                    image_assets,
                    storyboard_image_config,
                )
                storyboard_image_workflows.append(storyboard_image_result["workflowGraph"])
            else:
                create_frame(frame, index, scene, desc, speaker, text, sound, assets, asset_ids, asset_catalog, image_assets)
            voice_emotion_profile = voice_emotion_for(index, speaker)
            voice_profile = dict(voice_profiles[speaker])
            voice_profile["instruct"] = f"{voice_profile['instruct']} {voice_emotion_profile}"
            tts_result = create_audio(audio, speaker, text, voice_profile, 41001 + index)
            tts_modes.add(tts_result["mode"])
            tts_backends.add(tts_result.get("backend") or "")
            tts_mocked_values.add(bool(tts_result.get("mocked")))
            if tts_result.get("warning"):
                tts_warnings.append(f"{index:03d}: {tts_result['warning']}")
            spoken_text = spoken_text_for(speaker, text)
            speaker_audio_stats[speaker]["lines"] += 1
            speaker_audio_stats[speaker]["audioFiles"] += 1
            speaker_audio_stats[speaker]["chars"] += len(normalize_dialogue_text(spoken_text))
            if speaker not in speaker_audio_samples:
                sample = audio_sample_info(audio)
                if not SILENT_PREVIEW and (sample["meanVolumeDb"] is None or sample["meanVolumeDb"] < MIN_AUDIO_MEAN_VOLUME_DB):
                    raise RuntimeError(f"角色音频样本音量过低: {speaker} / {sample}")
                speaker_audio_samples[speaker] = sample
            actual_duration = max(MIN_SHOT_DURATION, min(MAX_SHOT_DURATION, max(duration, audio_duration(audio) + 0.4)))
            render_segment(index, frame, audio, segment, actual_duration)
            frame_paths.append(frame)
            audio_paths.append(audio)
            segment_paths.append(segment)
            media_ref = {
                "kind": "image",
                "path": storyboard_image_result["projectImageUrl"] if storyboard_image_result else str(frame),
            }
            storyboard_patch = {}
            if storyboard_image_result:
                media_ref["imageWorkflowId"] = storyboard_image_result["workflowGraph"]["id"]
                media_ref["imageWorkflowNodeId"] = storyboard_image_result["generatedNodeId"]
                storyboard_patch = {
                    "imageWorkflowId": storyboard_image_result["workflowGraph"]["id"],
                    "imageWorkflowNodeId": storyboard_image_result["generatedNodeId"],
                }
            storyboards.append({
                "id": storyboard_id,
                "episodeId": EPISODE_ID,
                "index": index,
                "trackKey": track_key,
                "trackId": "",
                "duration": round(actual_duration, 2),
                "prompt": desc,
                "videoDesc": f"{desc}；台词：{speaker}：{text}；音效：{sound}",
                "speaker": speaker,
                "assetIds": asset_ids,
                "mediaRef": media_ref,
                "audioRef": {"kind": "audio", "path": str(audio)},
                "voiceReferenceAudioPath": voice_profile["audioPath"],
                "voiceReferenceName": voice_profile["name"],
                "voiceReferenceText": voice_profile["referenceText"],
                "voiceEmotionProfile": voice_profile["instruct"],
                "voiceProfile": {
                    "id": voice_profile["profileId"],
                    "name": voice_profile["name"],
                    "referenceAudioPath": voice_profile["audioPath"],
                    "referenceText": voice_profile["referenceText"],
                    "instruct": voice_profile["instruct"],
                },
                "ttsSpokenText": spoken_text,
                "ttsMode": tts_result["mode"],
                "ttsBackend": tts_result.get("backend") or "",
                "ttsMocked": bool(tts_result.get("mocked")),
                "ttsWarning": tts_result.get("warning"),
                "ttsGenerationId": tts_result.get("generationId") or "",
                "voiceProfileId": voice_profile["profileId"],
                "frameImagePath": primary_visual["imagePath"],
                "imageAssetPaths": [asset["imagePath"] for asset in image_assets],
                "imageAssetNames": [asset["name"] for asset in image_assets],
                "state": "ready",
                "emotion": emotion_for(index, scene_no),
                "orientation": "—",
                "spatialRelation": "—",
                "associateAssetsNames": associate_assets,
                "lines": f"{speaker}：{text}" if speaker != "旁白" else f"旁白：{text}",
                "speakerId": line_speaker(speaker),
                "sound": sound,
                **storyboard_patch,
            })
    finally:
        stop_tts_backend(tts_process)

    total_storyboard_duration = sum(sb["duration"] for sb in storyboards)
    target_duration_seconds = target_chapter_duration_seconds(EPISODE_ID)
    if total_storyboard_duration > target_duration_seconds:
        raise RuntimeError(f"{EPISODE_ID} 成片时长超过目标规格: {total_storyboard_duration:.1f}s/{target_duration_seconds:.1f}s")

    final_path = EXPORTS / FINAL_NAME
    concat_segments(segment_paths, final_path)

    production_tracks = []
    video_candidates = []
    track_keys = ["chapter-001-scene-1", "chapter-001-scene-2", "chapter-001-scene-3", "chapter-001-scene-4"]
    for scene_no, track_key in enumerate(track_keys, 1):
        ids = [sb["id"] for sb in storyboards if sb["trackKey"] == track_key]
        duration = sum(sb["duration"] for sb in storyboards if sb["id"] in ids)
        track_id = f"track-chapter-001-scene-{scene_no}"
        candidate_id = f"video-chapter-001-scene-{scene_no}"
        scene_segments = [str(segment_paths[sb["index"] - 1]) for sb in storyboards if sb["trackKey"] == track_key]
        scene_output = EXPORTS / f"道劫_EP01_scene_{scene_no:02d}.mp4"
        if not SKIP_SCENE_EXPORTS:
            concat_segments([Path(p) for p in scene_segments], scene_output)
        production_tracks.append({
            "id": track_id,
            "episodeId": EPISODE_ID,
            "trackKey": track_key,
            "storyboardIds": ids,
            "prompt": "\n".join(sb["prompt"] for sb in storyboards if sb["id"] in ids),
            "duration": duration,
            "candidateVideoIds": [candidate_id],
            "selectedVideoId": candidate_id,
            "state": "ready",
        })
        video_candidates.append({
            "id": candidate_id,
            "trackId": track_id,
            "provider": "ffmpeg-local",
            "filePath": str(scene_output if not SKIP_SCENE_EXPORTS else final_path),
            "state": "ready",
            "createdAt": 1780299999000 + scene_no,
        })
    video_candidates.append({
        "id": "video-chapter-001-final",
        "trackId": "episode-chapter-001",
        "provider": "ffmpeg-local",
        "filePath": str(final_path),
        "state": "ready",
        "createdAt": 1780300000000,
    })

    state["scriptPlans"] = [p for p in state.get("scriptPlans", []) if p.get("episodeId") != EPISODE_ID]
    state["scriptPlans"].append({
        "id": "script-plan-chapter-001-toonflow",
        "episodeId": EPISODE_ID,
        "theme": "Sc1-Sc4 分场汇总表已按 Toonflow 导演规划生成",
        "visualStyle": "",
        "narrativeRhythm": "压迫入镇 -> 断剑显露 -> 晏燎燃气 -> 归元认人",
        "sceneIntents": [
            {"sceneId": "Sc1", "emotion": "压迫→隐忍救人", "shotIntent": "金水河码头·鞭下入镇", "spatial": ""},
            {"sceneId": "Sc2", "emotion": "冷眼旁观→旧痛翻涌", "shotIntent": "悦来客栈·断剑显露", "spatial": ""},
            {"sceneId": "Sc3", "emotion": "试探引气→命数被压", "shotIntent": "金水塾馆·晏燎燃气", "spatial": ""},
            {"sceneId": "Sc4", "emotion": "确认传承→危机逼近", "shotIntent": "悦来斗室与金水河·归元认人", "spatial": ""},
        ],
        "soundDirection": "鞭梢破风、算盘、油灯、断剑低鸣、船桨破水",
        "transitions": "Sc1→Sc2 叠化；Sc2→Sc3 叠化；Sc3→Sc4 叠化",
        "derivedAssetPlan": DERIVED_ASSET_PLAN,
    })

    now = 1780300001000
    state["agentWorkData"] = [
        w for w in state.get("agentWorkData", [])
        if not (w.get("episodeId") == EPISODE_ID and w.get("key") in {"directorPlan", "storyboardTable", "storyboardPanel", "storyboardImage", "productionPlan"})
    ]
    state["agentWorkData"].extend([
        {"id": "work-chapter-001-director-plan", "key": "directorPlan", "episodeId": EPISODE_ID, "data": script_plan_xml, "createdAt": now, "updatedAt": now},
        {"id": "work-chapter-001-storyboard-table", "key": "storyboardTable", "episodeId": EPISODE_ID, "data": storyboard_table, "createdAt": now + 1, "updatedAt": now + 1},
        {"id": "work-chapter-001-storyboard-panel", "key": "storyboardPanel", "episodeId": EPISODE_ID, "data": f"已写入 {len(storyboards)} 条分镜面板，全部绑定资产静帧、完整台词音频和多角色资产库音色参考。", "createdAt": now + 2, "updatedAt": now + 2},
        {"id": "work-chapter-001-production-plan", "key": "productionPlan", "episodeId": EPISODE_ID, "data": f"本地成片输出: {final_path}", "createdAt": now + 3, "updatedAt": now + 3},
    ])
    state["storyboards"] = [sb for sb in state.get("storyboards", []) if sb.get("episodeId") != EPISODE_ID and sb.get("episodeId") != "episode-1"]
    state["storyboards"].extend(storyboards)
    state["productionTracks"] = [t for t in state.get("productionTracks", []) if t.get("episodeId") != EPISODE_ID and t.get("episodeId") != "episode-1"]
    state["productionTracks"].extend(production_tracks)
    state["videoCandidates"] = [v for v in state.get("videoCandidates", []) if not str(v.get("id", "")).startswith("video-chapter-001")]
    state["videoCandidates"].extend(video_candidates)
    if storyboard_image_workflows:
        state["imageWorkflows"] = [
            graph
            for graph in state.get("imageWorkflows", [])
            if not str(graph.get("id", "")).startswith(f"storyboard-flow-{EPISODE_ID}-")
        ]
        state["imageWorkflows"].extend(storyboard_image_workflows)
    derived_asset_sync = sync_project_derived_assets(state, asset_catalog)

    if not SKIP_PROJECT_WRITE:
        save_json(STORE, store)
        save_json(CHARACTERS_JSON, derived_asset_sync["stores"]["characters"])
        save_json(SCENES_JSON, derived_asset_sync["stores"]["scenes"])
        save_json(PROPS_JSON, derived_asset_sync["stores"]["props"])
        save_json(SCRIPT_JSON, {
            "rawScript": script_text,
            "scriptData": {"episodeId": EPISODE_ID, "title": "道劫 EP01：断剑夜访道口镇", "source": "latest scriptDraft"},
            "shots": storyboards,
            "parseStatus": "success",
            "updatedAt": now,
        })

    probe = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(final_path)
    ], text=True)
    streams = {s["codec_type"] for s in json.loads(probe).get("streams", [])}
    if not {"video", "audio"}.issubset(streams):
        raise RuntimeError(f"最终视频缺少音视频流: {streams}")
    final_audio_mean_volume_db = audio_mean_volume_db(final_path)
    if not SILENT_PREVIEW and (final_audio_mean_volume_db is None or final_audio_mean_volume_db < MIN_AUDIO_MEAN_VOLUME_DB):
        raise RuntimeError(f"最终视频音量过低: {final_audio_mean_volume_db}")
    final_video_evidence_data = final_video_evidence(final_path)
    linked_storyboards = sum(1 for sb in storyboards if sb.get("assetIds"))
    total_asset_links = sum(len(sb.get("assetIds", [])) for sb in storyboards)
    image_backed_storyboards = sum(1 for sb in storyboards if sb.get("imageAssetPaths"))
    generated_frame_count = sum(1 for path in frame_paths if Path(path).exists())
    image_asset_count = sum(1 for item in asset_catalog.values() if item.get("imagePath"))
    storyboard_media_manifest = [
        {
            "storyboardId": sb["id"],
            "index": sb["index"],
            "trackKey": sb["trackKey"],
            "duration": sb["duration"],
            "framePath": str(frame_paths[sb["index"] - 1]),
            "frameExists": Path(frame_paths[sb["index"] - 1]).exists(),
            "audioPath": str(audio_paths[sb["index"] - 1]),
            "audioExists": Path(audio_paths[sb["index"] - 1]).exists(),
            "segmentPath": str(segment_paths[sb["index"] - 1]),
            "segmentExists": Path(segment_paths[sb["index"] - 1]).exists(),
            "assetIds": sb.get("assetIds", []),
            "assetNames": sb.get("associateAssetsNames", []),
            "imageAssetNames": sb.get("imageAssetNames", []),
            "imageAssetPaths": sb.get("imageAssetPaths", []),
            "mediaRef": sb.get("mediaRef", {}),
            "imageWorkflowId": sb.get("imageWorkflowId", ""),
            "imageWorkflowNodeId": sb.get("imageWorkflowNodeId", ""),
            "voiceReferenceName": sb.get("voiceReferenceName", ""),
            "voiceReferenceAudioPath": sb.get("voiceReferenceAudioPath", ""),
            "ttsMode": sb.get("ttsMode", ""),
            "ttsBackend": sb.get("ttsBackend", ""),
        }
        for sb in storyboards
    ]
    storyboard_image_workflow_manifest = [
        {
            "flowId": graph.get("id", ""),
            "targetStoryboardId": (graph.get("target") or {}).get("id", ""),
            "referenceNodes": [
                {
                    "id": node.get("id", ""),
                    "assetId": ((node.get("source") or {}).get("id") or ""),
                    "assetType": ((node.get("source") or {}).get("assetType") or ""),
                    "imageUrl": node.get("imageUrl", ""),
                    "notes": node.get("notes", ""),
                }
                for node in graph.get("nodes", [])
                if node.get("type") == "reference"
            ],
            "generatedNodeId": next((node.get("id", "") for node in graph.get("nodes", []) if node.get("type") == "generated"), ""),
            "resultUrl": next((node.get("resultUrl", "") for node in graph.get("nodes", []) if node.get("type") == "generated"), ""),
            "referenceToGeneratedEdges": [
                {
                    "id": edge.get("id", ""),
                    "source": edge.get("source", ""),
                    "target": edge.get("target", ""),
                }
                for edge in graph.get("edges", [])
            ],
        }
        for graph in storyboard_image_workflows
    ]
    used_image_path_set = set(used_image_paths)
    asset_image_manifest = [
        {
            "assetName": name,
            "assetId": item.get("id", ""),
            "kind": item.get("kind", ""),
            "imageAssetName": item.get("imageAssetName", ""),
            "imageAssetType": item.get("imageAssetType", ""),
            "imagePath": item.get("imagePath", ""),
            "exists": bool(item.get("imagePath") and Path(item["imagePath"]).exists()),
            "usedInFrames": item.get("imagePath", "") in used_image_path_set,
        }
        for name, item in sorted(asset_catalog.items())
        if item.get("imagePath")
    ]
    track_candidate_manifest = [
        {
            "trackId": track["id"],
            "trackKey": track.get("trackKey", ""),
            "storyboardIds": track.get("storyboardIds", []),
            "storyboardCount": len(track.get("storyboardIds", [])),
            "duration": track.get("duration", 0),
            "candidateVideoIds": track.get("candidateVideoIds", []),
            "selectedVideoId": track.get("selectedVideoId", ""),
            "candidateFiles": [
                candidate.get("filePath", "")
                for candidate in video_candidates
                if candidate.get("trackId") == track["id"]
            ],
        }
        for track in production_tracks
    ]
    missing_voice_profiles = sorted(speaker for speaker in speakers if speaker not in voice_profiles)
    speaker_voice_map = {
        speaker: {
            "profileId": profile["profileId"],
            "voiceReferenceName": profile["name"],
            "voiceReferenceAudioPath": profile["audioPath"],
            "match": profile["matched"],
        }
        for speaker, profile in sorted(voice_profiles.items())
    }
    first_frame = Image.open(frame_paths[0])
    workflow_steps = build_workflow_steps(
        state,
        script_text,
        shots,
        asset_catalog,
        script_plan_xml,
        storyboard_table,
        storyboards,
        frame_paths,
        audio_paths,
        segment_paths,
        production_tracks,
        video_candidates,
        final_path,
        missing_image_assets,
        speaker_audio_stats,
        tts_modes,
        tts_mocked_values,
        streams,
        final_audio_mean_volume_db,
    )
    report = {
        "storyboards": len(storyboards),
        "storyboardSourceSegments": source_segment_count,
        "totalStoryboardDuration": round(total_storyboard_duration, 2),
        "targetDurationSeconds": round(target_duration_seconds, 2),
        "scriptTextChars": source_dialogue_chars,
        "spokenTextChars": spoken_text_chars,
        "dialogueCoverageRatio": round(dialogue_coverage_ratio, 4),
        "coverage": round(dialogue_coverage_ratio, 4),
        "storyboardsWithAssetLinks": linked_storyboards,
        "assetLinks": total_asset_links,
        "storyboardImageGenerationMode": STORYBOARD_IMAGE_GENERATION_MODE,
        "imageGenerationMode": STORYBOARD_IMAGE_GENERATION_MODE,
        "imageGenerationProvider": storyboard_image_generation_provider(),
        "generatedFrameImages": generated_frame_count,
        "matchedAssetImages": image_asset_count,
        "framesWithRealAssetImages": image_backed_storyboards,
        "assetImagePaths": sorted(used_image_paths),
        "storyboardMediaManifest": storyboard_media_manifest,
        "storyboardImageWorkflowManifest": storyboard_image_workflow_manifest,
        "assetImageManifest": asset_image_manifest,
        "trackCandidateManifest": track_candidate_manifest,
        "derivedAssetPlan": DERIVED_ASSET_PLAN,
        "derivedAssetManifest": derived_asset_sync["manifest"],
        "missingImageAssets": sorted(missing_image_assets),
        "workflowSteps": workflow_steps,
        "voiceReferenceName": speaker_voice_map.get("旁白", {}).get("voiceReferenceName", ""),
        "voiceReferenceAudioPath": speaker_voice_map.get("旁白", {}).get("voiceReferenceAudioPath", ""),
        "speakerVoiceMap": speaker_voice_map,
        "speakerAudioStats": speaker_audio_stats,
        "speakerAudioSamples": speaker_audio_samples,
        "missingVoiceProfiles": missing_voice_profiles,
        "finalVideoEvidence": final_video_evidence_data,
        "finalAudioMeanVolumeDb": None if final_audio_mean_volume_db is None else round(final_audio_mean_volume_db, 2),
        "ttsMode": "+".join(sorted(tts_modes)) if tts_modes else "",
        "ttsBackend": "+".join(sorted(backend for backend in tts_backends if backend)),
        "ttsMocked": any(tts_mocked_values),
        "ttsWarnings": tts_warnings[:10],
        "voiceEmotionProfile": "per-shot cinematic emotion profile",
        "frameSize": {"width": first_frame.width, "height": first_frame.height},
        "tracks": len(production_tracks),
        "videoCandidates": len(video_candidates),
        "final": str(final_path),
        "streams": sorted(streams),
    }
    save_json(EXPORTS / "automation_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
