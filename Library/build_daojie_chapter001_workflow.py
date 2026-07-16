#!/usr/bin/env python3
import json
import base64
import hashlib
import io
import math
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

DEFAULT_PROJECT = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0")
PROJECT = Path(os.environ.get("MYSTUDIO_DAOJIE_PROJECT_DIR", str(DEFAULT_PROJECT)))
STORE = PROJECT / "studio-workflow-store.json"
SCRIPT_JSON = PROJECT / "script.json"
TTS_JSON = PROJECT / "tts.json"
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
ALLOW_STORYBOARD_BOOTSTRAP = os.environ.get("MYSTUDIO_DAOJIE_ALLOW_STORYBOARD_BOOTSTRAP") == "1"
USE_APPROVED_STORYBOARD_IMAGES = os.environ.get("MYSTUDIO_DAOJIE_USE_APPROVED_STORYBOARDS") == "1"
REAL_STORYBOARD_IMAGE_MODE = "real-ai-reference-image-workflow"
ASSET_COMPOSITE_IMAGE_MODE = "asset-composite"
STORYBOARD_IMAGE_GENERATION_MODE = (
    os.environ.get("MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE", ASSET_COMPOSITE_IMAGE_MODE).strip()
    or ASSET_COMPOSITE_IMAGE_MODE
)
MODEL_REFERENCE_MAX_EDGE = int(os.environ.get("MYSTUDIO_IMAGE_REFERENCE_MAX_EDGE", "768"))
MODEL_REFERENCE_JPEG_QUALITY = int(os.environ.get("MYSTUDIO_IMAGE_REFERENCE_JPEG_QUALITY", "82"))
IMAGE_TRANSFER_MAX_BYTES = 1_000_000
IMAGE_TRANSFER_TARGET_MAX_EDGE = 768
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

CHAPTER_CONTINUITY_GROUPS = (
    {"groupId": "chapter-001:dock:01-12", "start": 1, "end": 12, "sceneName": "金水河码头", "viewpointId": "dock-main-axis"},
    {"groupId": "chapter-001:inn-hall:13-19", "start": 13, "end": 19, "sceneName": "悦来客栈", "viewpointId": "inn-hall-counter-axis"},
    {"groupId": "chapter-001:inn-room:20-24", "start": 20, "end": 24, "sceneName": "悦来客栈斗室", "viewpointId": "inn-room-window-axis"},
    {"groupId": "chapter-001:school:25-40", "start": 25, "end": 40, "sceneName": "金水塾馆", "viewpointId": "school-lamp-desk-axis"},
    {"groupId": "chapter-001:inn-room-return:41-42", "start": 41, "end": 42, "sceneName": "悦来客栈斗室", "viewpointId": "inn-room-night-return"},
    {"groupId": "chapter-001:river:43", "start": 43, "end": 43, "sceneName": "金水河", "viewpointId": "river-night-long-axis"},
)

SAMPLE_SHOT_CONTINUITY = {
    6: {
        "actionIn": "独孤剑尘从画面左上河雾外沿湿木栈道入画。",
        "actionOut": "独孤剑尘停在左中格，右脚落地、左脚待迈，油布剑包纵向压在背后。",
        "characters": {
            "独孤剑尘": {
                "position": "左中格",
                "orientation": "背部三分之四朝画面右侧",
            },
        },
    },
    7: {
        "actionIn": "独孤剑尘停在左中格，右脚落地、左脚待迈，油布剑包纵向压在背后。",
        "actionOut": "独孤剑尘不跨轴继续向右行，剑包刚颤，左袖残卷只露一角。",
        "characters": {
            "独孤剑尘": {
                "position": "左中格",
                "orientation": "背部三分之四朝画面右侧",
            },
        },
    },
    8: {
        "actionIn": "赵四恢复镜头5左中格持鞭状态，小杂役恢复镜头3右下格缩肩护头状态；独孤剑尘不入画。",
        "actionOut": "赵四持鞭臂越过顶点，鞭势从左上向右下开始斜劈；小杂役原位缩肩护头。",
        "characters": {
            "监工赵四": {
                "position": "左中格",
                "orientation": "正面三分之四朝画面右下",
            },
            "小杂役": {
                "position": "右下格",
                "orientation": "正面三分之四朝画面左上",
            },
        },
    },
    9: {
        "actionIn": "承接镜头8鞭势从左上向右下斜劈，小杂役仍在右下格缩肩，独孤剑尘从左中格与赵四错身。",
        "actionOut": "独孤剑尘鞋尖把朽木拨到赵四左脚前，小杂役仍在右下格，独孤剑尘不抬眼继续向右。",
        "characters": {
            "独孤剑尘": {
                "position": "左中格",
                "orientation": "侧背朝画面右侧",
            },
            "小杂役": {
                "position": "右下格",
                "orientation": "蜷缩朝画面左上",
            },
        },
    },
    10: {
        "actionIn": "赵四左脚踩上镜头9拨来的朽木，身体向右前方失衡，持鞭臂尚未收回。",
        "actionOut": "赵四踩偏后鞭梢抽碎右下格空筐，藤条碎屑向右侧炸开。",
        "characters": {
            "监工赵四": {
                "position": "左中格",
                "orientation": "正面三分之四朝画面右下",
            },
        },
    },
    11: {
        "actionIn": "承接空筐碎屑落下，小杂役从右下格贴地滚向右后方船影。",
        "actionOut": "小杂役抱紧矿渣缩进右后方船影，头仍低垂，不与独孤剑尘对视。",
        "characters": {
            "小杂役": {
                "position": "右后格",
                "orientation": "背部三分之四朝画面右侧",
            },
        },
    },
    12: {
        "actionIn": "独孤剑尘承接镜头9继续向右，已到右中格，河雾从左后方吞来。",
        "actionOut": "独孤剑尘右手压住袖口残卷，半边身影进入右侧河雾，保持向镇中离场方向。",
        "characters": {
            "独孤剑尘": {
                "position": "右中格",
                "orientation": "背部三分之四朝画面右侧",
            },
        },
    },
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
        "asyncMode": os.environ.get("MYSTUDIO_IMAGE_ASYNC_MODE") == "1",
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
        "asyncMode": (
            item.get("asyncMode") is True
            or str(item.get("asyncMode") or "").strip().lower() in {"1", "true"}
            or os.environ.get("MYSTUDIO_IMAGE_ASYNC_MODE") == "1"
        ),
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
    value = str(model or "")
    return bool(
        re.search(r"(^|[-_:/])gpt[-_]?image", value, re.IGNORECASE)
        or re.search(r"(^|[-_:/])agnes[-_]?image", value, re.IGNORECASE)
    )


def gpt_image_size(aspect_ratio, resolution):
    ratio = aspect_ratio if aspect_ratio in GPT_IMAGE_SIZE_MAP else "16:9"
    normalized_resolution = str(resolution or "2K").upper()
    if normalized_resolution not in GPT_IMAGE_SIZE_MAP[ratio]:
        normalized_resolution = "2K"
    return GPT_IMAGE_SIZE_MAP[ratio][normalized_resolution]


DAOJIE_STORYBOARD_STYLE_PROMPT = (
    "《道劫》默认主风格，宣纸质感，宣纸淡彩工笔，工笔线描，细密白描线描，低饱和青绿山水，"
    "米白、墨青、灰蓝、青绿、浅褐为底，旧金只用于衣纹、发饰、卷轴轴头和器物边缘，"
    "竹窗卷轴人物质感，淡墨山体、瀑布、竹影、木窗、画案、卷轴和纸面肌理，"
    "水墨国风修仙，写意泼墨，写意晕染，墨色层次丰富，传统水墨技法，"
    "工笔写意融合，连环画叙事感，水墨国风电影质感，高完成度国风漫剧关键帧，清雅、细腻、透气、贵而不艳、旧而不脏，"
    "电影构图，水墨国风高清渲染，高细节，画面无字幕、无水印、无标题叠字"
)
DAOJIE_DERIVED_ASSET_STYLE_PROMPT = (
    "水墨国风修仙，工笔线描，写意泼墨，写意晕染，青绿淡彩，宣纸质感，"
    "宣纸淡彩工笔，细密白描线描，低饱和青绿山水，墨色层次丰富，"
    "传统水墨技法，工笔写意融合，连环画叙事感，水墨国风电影质感，"
    "电影构图，水墨国风高清渲染，高细节，画面无字幕、无水印、无标题叠字"
)
DAOJIE_STORYBOARD_NEGATIVE_CONSTRAINTS = (
    "禁止写实摄影，禁止3D写实渲染，禁止照片级真实感，禁止赛璐璐平涂，"
    "禁止现代/科幻/西方奇幻元素，禁止文字水印、logo、乱码题字"
)
DAOJIE_STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS = (
    f"{DAOJIE_STORYBOARD_NEGATIVE_CONSTRAINTS}，禁止偏离宣纸淡彩工笔主风格的高对比漫画动作稿，"
    "禁止欧美厚涂奇幻，禁止高饱和荧光色，禁止大面积暗黑脏污，禁止现代摄影感，"
    "禁止白底设定图/三视图/四视图/资料卡，禁止把剧情分镜画成角色设定页或资产设定页"
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
DAOJIE_REFERENCE_BINDING_ALIASES = {
    "独孤剑尘": ["独孤剑尘", "独孤", "灰衫客"],
    "监工赵四": ["监工赵四", "赵四"],
    "赵四": ["赵四", "监工赵四"],
    "小杂役": ["小杂役"],
    "李先生": ["李先生"],
    "晏燎": ["晏燎"],
    "孩童甲": ["孩童甲"],
    "丫头": ["丫头"],
    "掌柜": ["掌柜"],
    "宗门弟子甲": ["宗门弟子甲"],
    "宗门弟子乙": ["宗门弟子乙"],
    "老苦力": ["老苦力"],
    "年轻苦力": ["年轻苦力"],
    "金水河码头": ["金水河码头"],
    "悦来客栈": ["悦来客栈"],
    "悦来客栈斗室": ["悦来客栈斗室", "斗室"],
    "金水塾馆": ["金水塾馆", "塾馆"],
    "金水河": ["金水河"],
    "赤练蛇皮鞭": ["赤练蛇皮鞭", "鞭梢", "鞭子"],
    "灵矿藤筐": ["灵矿藤筐", "藤筐", "空筐"],
    "灵矿": ["灵矿"],
    "油布剑包": ["油布剑包", "剑包"],
    "残卷": ["残卷"],
    "归元断剑": ["归元断剑", "归元", "断剑"],
    "绿锈铜钱": ["绿锈铜钱", "铜钱"],
    "灵矿账册": ["灵矿账册", "账册"],
    "缚神索": ["缚神索"],
    "玄天符": ["玄天符"],
    "宗门灵舟": ["宗门灵舟", "灵舟"],
}
DAOJIE_VISIBLE_ROLE_ALIASES = {
    key: value
    for key, value in DAOJIE_REFERENCE_BINDING_ALIASES.items()
    if key in {
        "独孤剑尘",
        "监工赵四",
        "赵四",
        "小杂役",
        "李先生",
        "晏燎",
        "孩童甲",
        "丫头",
        "掌柜",
        "宗门弟子甲",
        "宗门弟子乙",
        "老苦力",
        "年轻苦力",
    }
}


def storyboard_reference_type_label(reference):
    raw_type = reference.get("assetType") or reference.get("kind") or ""
    return STORYBOARD_REFERENCE_TYPE_LABELS.get(raw_type, "资产")


def storyboard_reference_name(reference, index):
    return reference.get("name") or reference.get("title") or reference.get("assetId") or f"参考资产{index}"


def unique_nonempty(values):
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def storyboard_reference_aliases(reference, index):
    name = storyboard_reference_name(reference, index)
    aliases = [name, reference.get("sourceName"), reference.get("title")]
    aliases.extend(reference.get("aliases") or [])
    for alias_name, candidates in ASSET_IMAGE_ALIASES.items():
        if name == alias_name or name in candidates:
            aliases.append(alias_name)
            aliases.extend(candidates)
    for alias_name, candidates in DAOJIE_REFERENCE_BINDING_ALIASES.items():
        if name == alias_name or name in candidates:
            aliases.append(alias_name)
            aliases.extend(candidates)
    return unique_nonempty(aliases)


def build_storyboard_reference_intro(reference_images):
    labels = []
    for index, reference in enumerate(reference_images or [], 1):
        name = storyboard_reference_name(reference, index)
        labels.append(f"@图{index} 为{name}{storyboard_reference_type_label(reference)}")
    return "；".join(labels)


def build_storyboard_reference_continuity_rules(reference_images):
    grouped = {"角色": [], "场景": [], "道具": [], "资产": []}
    character_groups = {}
    for index, reference in enumerate(reference_images or [], 1):
        label = storyboard_reference_type_label(reference)
        name = storyboard_reference_name(reference, index)
        grouped.setdefault(label, []).append(f"@图{index}({name})")
        if label == "角色":
            stable_key = (
                str(reference.get("assetId") or name),
                str(reference.get("versionId") or "base"),
            )
            group = character_groups.setdefault(stable_key, {
                "name": name,
                "markers": [],
                "views": [],
            })
            group["markers"].append(f"@图{index}")
            if reference.get("characterViewType"):
                group["views"].append(str(reference["characterViewType"]))

    parts = []
    if grouped.get("角色"):
        parts.append(
            "角色一致性："
            + "、".join(grouped["角色"])
            + "只继承身份、面容、体态、发型识别点、服饰层次和主色比例；只允许镜头、动作、表情按当前分镜变化。"
        )
    if grouped.get("场景"):
        parts.append(
            "场景一致性："
            + "、".join(grouped["场景"])
            + "只继承空间结构、建筑/地貌材质、前中远景层次和光影基调；不要换成其他时代、其他地域或西幻空间。"
        )
    if grouped.get("道具"):
        parts.append(
            "道具一致性："
            + "、".join(grouped["道具"])
            + "只继承轮廓、材质、符号、火印、断口或核心识别点；不要改成现代器物或西式装备。"
        )
    if grouped.get("资产"):
        parts.append(
            "资产一致性："
            + "、".join(grouped["资产"])
            + "继承主体轮廓、比例结构和核心识别点；只按当前分镜调整角度和光影。"
        )
    if not parts:
        return ""
    parts.append("所有参考图只服务当前剧情分镜，不生成设定页、拼贴图、海报站姿或无关新增角色。")
    multi_view_rules = [
        (
            f"{'/'.join(group['markers'])} 为{group['name']}同一角色、同一版本的 "
            f"{'/'.join(group['views'])} 参考视图，不是三个人；该角色在本镜只允许出现一个实例。"
        )
        for group in character_groups.values()
        if len(group["markers"]) > 1 and len(group["views"]) == len(group["markers"])
    ]
    multi_view_contract = "【多视图身份锁】" + " ".join(multi_view_rules) if multi_view_rules else ""
    return " ".join(part for part in [multi_view_contract, "【参考图规则】" + " ".join(parts)] if part)


def build_storyboard_bible_rules(reference_images):
    rules = []
    for index, reference in enumerate(reference_images or [], 1):
        label = storyboard_reference_type_label(reference)
        if label == "角色":
            anchors = reference.get("identityAnchors") or {}
            negative = reference.get("negativePrompt") or {}
            anchor_parts = [
                anchors.get("faceShape"),
                anchors.get("jawline"),
                anchors.get("cheekbones"),
                anchors.get("eyeShape"),
                anchors.get("eyeDetails"),
                anchors.get("noseShape"),
                anchors.get("lipShape"),
                "、".join(anchors.get("uniqueMarks") or []),
                anchors.get("skinTexture"),
                anchors.get("hairStyle"),
                anchors.get("hairlineDetails"),
            ]
            colors = anchors.get("colorAnchors") or {}
            color_text = "、".join(f"{key}:{value}" for key, value in colors.items() if value)
            avoid_text = "、".join([*(negative.get("avoid") or []), *(negative.get("styleExclusions") or [])])
            rules.append(
                f"@图{index}身份锚点：{'；'.join(str(value) for value in anchor_parts if value)}"
                + (f"；色彩锚点：{color_text}" if color_text else "")
                + (f"；服装版本：{reference.get('wardrobeVersion')}" if reference.get("wardrobeVersion") else "")
                + (f"；禁止：{avoid_text}" if avoid_text else "")
            )
        elif label == "场景":
            scene_parts = [
                f"布局：{reference.get('spatialLayout')}" if reference.get("spatialLayout") else "",
                f"视角：{reference.get('sceneViewpointId')}" if reference.get("sceneViewpointId") else "",
                f"光线：{reference.get('lightingDesign')}" if reference.get("lightingDesign") else "",
                f"色板：{reference.get('colorPalette')}" if reference.get("colorPalette") else "",
                f"关键物件：{'、'.join(reference.get('keyProps') or [])}" if reference.get("keyProps") else "",
            ]
            rules.append(f"@图{index}场景圣经：{'；'.join(part for part in scene_parts if part)}")
    return "【资产圣经】" + " ".join(rule for rule in rules if rule) if rules else ""


def build_storyboard_reference_bindings(reference_images):
    bindings = []
    for index, reference in enumerate(reference_images or [], 1):
        marker = f"@图{index}"
        bindings.append({
            "marker": marker,
            "name": storyboard_reference_name(reference, index),
            "typeLabel": storyboard_reference_type_label(reference),
            "aliases": storyboard_reference_aliases(reference, index),
        })
    return bindings


def apply_reference_bindings_to_visual_prompt(visual_prompt, reference_images):
    text = str(visual_prompt or "").strip()
    for binding in build_storyboard_reference_bindings(reference_images):
        aliases = sorted(binding["aliases"], key=len, reverse=True)
        for alias in aliases:
            if len(alias) < 2 or alias.startswith("@"):
                continue
            text = text.replace(alias, binding["marker"])
    scene_marker = next(
        (binding["marker"] for binding in build_storyboard_reference_bindings(reference_images) if binding["typeLabel"] == "场景"),
        "",
    )
    if scene_marker and scene_marker not in text:
        text = f"{scene_marker}内，{text}"
    return text


def storyboard_light_prompt(storyboard):
    index = int((storyboard or {}).get("index") or 0)
    scene_no = (storyboard or {}).get("sceneNo")
    if scene_no == 1 or (scene_no is None and index <= 12):
        return "金水河雾冷青漫射，湿木栈反出低亮，人物脸和手保留清晰侧光，背景山水淡墨退远。"
    if scene_no == 2 or (scene_no is None and index <= 24):
        return "客栈枯灯偏暖，门缝夜风压暗四角，铜钱、账册、油布和断剑以局部旧金冷光提亮。"
    if scene_no == 3 or (scene_no is None and index <= 40):
        return "塾馆油灯与窗外冷雾交叠，孩童面部半明半暗，掌心暗红只作克制焦点光。"
    return "深夜雾气吞没远景，断剑与残卷带旧金冷光，宗门灵舟火印穿雾但不破坏低饱和水墨基调。"


def extract_prompt_section(prompt, section_name):
    pattern = rf"【{re.escape(section_name)}】(.*?)(?=【[^】]+】|$)"
    match = re.search(pattern, prompt or "", re.S)
    return match.group(1).strip() if match else ""


def find_visible_role_mentions(visual_prompt):
    visible = []
    for role_name, aliases in DAOJIE_VISIBLE_ROLE_ALIASES.items():
        if any(alias and alias in visual_prompt for alias in aliases):
            visible.append(role_name)
    return unique_nonempty(visible)


def build_storyboard_prompt_audit(storyboard, final_prompt, reference_images, raw_visual_prompt):
    bindings = build_storyboard_reference_bindings(reference_images)
    visual_section = extract_prompt_section(final_prompt, "画面")
    role_reference_aliases = set()
    raw_asset_name_leaks = []
    for binding in bindings:
        if binding["typeLabel"] == "角色":
            role_reference_aliases.update(binding["aliases"])
        for alias in binding["aliases"]:
            if len(alias) < 2 or alias.startswith("@"):
                continue
            if alias in visual_section:
                raw_asset_name_leaks.append({
                    "marker": binding["marker"],
                    "assetName": binding["name"],
                    "alias": alias,
                })
    visible_roles = find_visible_role_mentions(str(raw_visual_prompt or ""))
    missing_visible_role_refs = [
        role_name
        for role_name in visible_roles
        if not any(alias in role_reference_aliases for alias in DAOJIE_VISIBLE_ROLE_ALIASES.get(role_name, [role_name]))
    ]
    reference_labels = [
        {
            "marker": binding["marker"],
            "assetName": binding["name"],
            "typeLabel": binding["typeLabel"],
            "aliases": binding["aliases"],
        }
        for binding in bindings
    ]
    return {
        "storyboardId": (storyboard or {}).get("id", ""),
        "index": (storyboard or {}).get("index", 0),
        "referenceLabels": reference_labels,
        "visibleRoleNames": visible_roles,
        "missingVisibleRoleReferences": missing_visible_role_refs,
        "rawAssetNameLeaks": raw_asset_name_leaks,
        "hasReferencePrefix": bool(reference_labels) and final_prompt.strip().startswith("@图1"),
        "hasVisualReferenceBinding": "@图" in visual_section,
        "hasLightSection": bool(extract_prompt_section(final_prompt, "光影")),
        "hasDaojieStyleLock": "【风格锁】" in final_prompt and "《道劫》默认主风格" in final_prompt,
        "hasReferenceRules": "【参考图规则】" in final_prompt and any(
            label in final_prompt
            for label in ("角色一致性", "场景一致性", "道具一致性", "资产一致性")
        ),
        "hasNegativeConstraints": "【反向约束】" in final_prompt and "禁止写实摄影" in final_prompt and "禁止3D写实渲染" in final_prompt,
        "finalPrompt": final_prompt,
    }


def assert_storyboard_prompt_audit(audit):
    errors = []
    if not audit.get("hasReferencePrefix"):
        errors.append("缺少@图N参考前缀")
    if not audit.get("hasVisualReferenceBinding"):
        errors.append("【画面】未绑定@图N")
    if not audit.get("hasLightSection"):
        errors.append("缺少【光影】段")
    if not audit.get("hasDaojieStyleLock"):
        errors.append("缺少道劫风格锁")
    if not audit.get("hasReferenceRules"):
        errors.append("缺少参考图一致性规则")
    if not audit.get("hasNegativeConstraints"):
        errors.append("缺少反向约束")
    if audit.get("missingVisibleRoleReferences"):
        errors.append("可见角色缺少参考图: " + "、".join(audit["missingVisibleRoleReferences"]))
    if audit.get("rawAssetNameLeaks"):
        leaks = [f"{item['assetName']}:{item['alias']}" for item in audit["rawAssetNameLeaks"]]
        errors.append("【画面】仍有原始资产名: " + "、".join(leaks))
    if errors:
        raise RuntimeError(f"分镜 {int(audit.get('index') or 0):03d} 图片提示词绑定失败: " + "；".join(errors))


def summarize_storyboard_prompt_manifest(manifest):
    return {
        "storyboardPromptsWithReferenceBindings": sum(
            1
            for item in manifest
            if item.get("hasReferencePrefix")
            and item.get("hasVisualReferenceBinding")
            and not item.get("missingVisibleRoleReferences")
            and not item.get("rawAssetNameLeaks")
        ),
        "storyboardPromptsWithDaojieStyleLock": sum(1 for item in manifest if item.get("hasDaojieStyleLock")),
        "storyboardPromptsWithLightSection": sum(1 for item in manifest if item.get("hasLightSection")),
        "storyboardPromptsWithMissingVisibleCharacterRefs": sum(1 for item in manifest if item.get("missingVisibleRoleReferences")),
        "storyboardPromptsWithRawAssetNameLeaks": sum(1 for item in manifest if item.get("rawAssetNameLeaks")),
        "storyboardPromptMissingVisibleCharacterRefs": [
            {
                "storyboardId": item.get("storyboardId", ""),
                "index": item.get("index", 0),
                "missingVisibleRoleReferences": item.get("missingVisibleRoleReferences", []),
            }
            for item in manifest
            if item.get("missingVisibleRoleReferences")
        ],
        "storyboardPromptRawAssetNameLeaks": [
            {
                "storyboardId": item.get("storyboardId", ""),
                "index": item.get("index", 0),
                "rawAssetNameLeaks": item.get("rawAssetNameLeaks", []),
            }
            for item in manifest
            if item.get("rawAssetNameLeaks")
        ],
    }


def build_storyboard_image_prompt(storyboard, reference_images):
    visual_prompt = str((storyboard or {}).get("prompt") or "").strip()
    visual_prompt = apply_reference_bindings_to_visual_prompt(visual_prompt, reference_images)
    reference_intro = build_storyboard_reference_intro(reference_images)
    continuity_rules = build_storyboard_reference_continuity_rules(reference_images)
    bible_rules = build_storyboard_bible_rules(reference_images)
    shot_continuity = build_shot_continuity_prompt(storyboard["continuityState"]) if storyboard.get("continuityState") else ""
    parts = []
    if reference_intro:
        parts.append(reference_intro)
    if visual_prompt:
        parts.append(f"【画面】{visual_prompt}")
    parts.append(f"【光影】{storyboard_light_prompt(storyboard)}")
    if continuity_rules:
        parts.append(continuity_rules)
    if bible_rules:
        parts.append(bible_rules)
    if shot_continuity:
        parts.append(shot_continuity)
    parts.append("【镜头】16:9横版国风漫剧剧情关键帧，前中远景层次清楚，主体动作、角色位置和道具关系可读，不要画成资产设定页。")
    parts.append(f"【风格锁】{DAOJIE_STORYBOARD_STYLE_PROMPT}。")
    parts.append("【可变化项】只变化当前分镜需要的景别、动作、表情、局部光影、雾气和前景遮挡；不要改变参考图身份、场景结构、道具核心特征或道劫主风格。")
    parts.append(f"【反向约束】{DAOJIE_STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}。")
    if reference_intro:
        parts.append("保持所有@图N造型、结构与参考图一致。")
    return " ".join(part for part in parts if part).strip()


def build_derived_asset_image_prompt(parent_name, state_name, reason, asset_type):
    type_label = STORYBOARD_REFERENCE_TYPE_LABELS.get(asset_type, "资产")
    reference_intro = f"@图1 为{parent_name}{type_label}基准图"
    if asset_type == "character":
        parts = [
            reference_intro,
            f"【衍生目标】{state_name}：{reason}",
            (
                "【画面】以@图1为底图，保持父角色身份识别、面容、体态、发型识别点与比例结构不变，"
                f"只叠加{state_name}所需的服化妆造、衣料磨损、光影和局部状态变化。"
            ),
            "【输出】必须输出角色四视图设定图/三视图参考图，不要生成单张全身插画或说明卡。",
            "【布局】同一画面左至右并排：人像特写+正视图+侧视图+后视图；portrait closeup, front view, side view, back view, character reference sheet, character turnaround。",
            "【站姿】自然站立，宣纸白底色背景，均匀散光，无硬阴影，四视图服化妆造一致，图中不要有任何文字。",
            f"【风格】{DAOJIE_DERIVED_ASSET_STYLE_PROMPT}。",
            f"【反向约束】{DAOJIE_STORYBOARD_NEGATIVE_CONSTRAINTS}，face drift，identity changed，different person，pose changed，added scene，added handheld prop，inconsistent costume between views，cropped body。",
            "保持所有@图N造型、结构与参考图一致。",
        ]
        return " ".join(part for part in parts if part).strip()

    parts = [
        reference_intro,
        f"【衍生目标】{state_name}：{reason}",
        (
            "【画面】以@图1为底图，保持父资产主体轮廓、身份识别、比例结构与核心特征不变，"
            f"只强化{state_name}所需的服饰、光影、磨损、姿态或局部状态变化。"
        ),
        "【镜头】16:9横版国风漫剧资产设定图，主体完整清晰，可供后续分镜连续复用。",
        f"【风格】{DAOJIE_DERIVED_ASSET_STYLE_PROMPT}。",
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
        "asyncMode": config.get("asyncMode") is True,
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
            "sourceName": asset.get("sourceName") or asset.get("name") or "",
            "aliases": asset.get("aliases") or [],
            "versionId": asset.get("versionId"),
            "referenceRole": asset.get("referenceRole"),
            "identityAnchors": asset.get("identityAnchors"),
            "negativePrompt": asset.get("negativePrompt"),
            "wardrobeVersion": asset.get("wardrobeVersion"),
            "characterViewType": asset.get("characterViewType"),
            "sceneViewpointId": asset.get("sceneViewpointId"),
            "spatialLayout": asset.get("spatialLayout") or "",
            "lightingDesign": asset.get("lightingDesign") or "",
            "colorPalette": asset.get("colorPalette") or "",
            "keyProps": asset.get("keyProps") or [],
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
            "continuityOrder": index,
            "continuityVersionId": reference.get("versionId"),
            "referenceRole": reference.get("referenceRole"),
            "identityAnchors": reference.get("identityAnchors"),
            "negativePrompt": reference.get("negativePrompt"),
            "wardrobeVersion": reference.get("wardrobeVersion"),
            "characterViewType": reference.get("characterViewType"),
            "sceneViewpointId": reference.get("sceneViewpointId"),
            "contentFingerprint": reference.get("contentFingerprint"),
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


def generate_storyboard_frame_with_references(
    frame,
    storyboard,
    prompt,
    image_assets,
    config,
    continuity_manifest=None,
    continuity_state=None,
    approved_storyboard_image=None,
):
    continuity_assets = (
        apply_continuity_manifest_to_image_assets(image_assets, continuity_manifest)
        if continuity_manifest
        else image_assets
    )
    references = collect_storyboard_reference_images(continuity_assets)
    if not references:
        raise RuntimeError(f"分镜 {storyboard['index']:02d} 缺少参考资产图片")
    final_prompt = build_storyboard_image_prompt(
        {
            **storyboard,
            "prompt": prompt or storyboard.get("prompt", ""),
            "continuityState": continuity_state,
        },
        references,
    )
    prompt_audit = build_storyboard_prompt_audit(
        storyboard,
        final_prompt,
        references,
        prompt or storyboard.get("prompt", ""),
    )
    assert_storyboard_prompt_audit(prompt_audit)
    relative_path = f"workflow-images/storyboards/{EPISODE_ID}/shot-{storyboard['index']:03d}.png"
    result_file = (
        Path(approved_storyboard_image["absolutePath"])
        if approved_storyboard_image
        else PROJECT / relative_path
    )
    reused_existing_image = bool(approved_storyboard_image) or can_reuse_storyboard_image(result_file)
    if not reused_existing_image:
        prepared_reference_images = []
        for reference in references:
            prepared_reference_images.append(
                prepare_storyboard_model_reference_image(reference["imageUrl"])
            )
        generated_image_url = request_storyboard_image_generation(final_prompt, prepared_reference_images, config)
        save_generated_image_url(generated_image_url, result_file)
    transfer_thumbnail = create_storyboard_transfer_thumbnail(result_file)
    Image.open(result_file).convert("RGB").resize((1920, 1080), Image.Resampling.LANCZOS).save(frame)
    project_url = (
        str(approved_storyboard_image["projectUrl"])
        if approved_storyboard_image
        else project_file_url(relative_path)
    )
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
        "orderedReferenceManifest": continuity_manifest or [],
        "continuityState": continuity_state,
        "providerRequestEvidence": {
            "model": config.get("model", ""),
            "aspectRatio": config.get("aspectRatio", ""),
            "resolution": config.get("resolution", ""),
            "referenceOrder": [
                f"{item.get('assetId', '')}:{item.get('characterViewType') or item.get('sceneViewpointId') or 'base'}"
                for item in references
            ],
            "previousApprovedFrameIncluded": any(
                item.get("referenceRole") == "previous-approved-frame"
                for item in continuity_manifest or []
            ),
        },
        "transferThumbnail": transfer_thumbnail,
        "reusedExistingImage": reused_existing_image,
        "promptAudit": prompt_audit,
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


def resolve_approved_storyboard_path(value):
    """Resolve a current product-approved storyboard revision inside its immutable root."""
    path = resolve_project_file_url(value).resolve(strict=True)
    approved_root = (PROJECT / "workflow-images/storyboards" / EPISODE_ID / "approved-revisions").resolve()
    try:
        path.relative_to(approved_root)
    except ValueError as error:
        raise RuntimeError(f"人工批准图不在当前 approved-revisions 目录: {value}") from error
    if not path.is_file() or not re.fullmatch(r"shot-\d{3}-[a-f0-9]{12}\.png", path.name, re.IGNORECASE):
        raise RuntimeError(f"人工批准图不是内容寻址 PNG revision: {value}")
    return path


def approved_storyboard_reuse_input(existing_storyboard):
    if not USE_APPROVED_STORYBOARD_IMAGES:
        return None
    review = existing_storyboard.get("visualReview") or {}
    media_ref = existing_storyboard.get("mediaRef") or {}
    manifest = json.loads(json.dumps(existing_storyboard.get("orderedReferenceManifest") or []))
    continuity_state = json.loads(json.dumps(existing_storyboard.get("continuityState") or {}))
    project_url = str(media_ref.get("path") or "")
    if (
        existing_storyboard.get("stale")
        or review.get("status") != "approved"
        or review.get("reviewer") != "human"
        or int(review.get("reviewedAt") or 0) <= 0
        or review.get("evidencePaths") != [project_url]
        or not str(review.get("inputFingerprint") or "")
        or not manifest
        or not continuity_state.get("inputFingerprint")
        or not project_url.startswith("project-file://")
        or media_ref.get("kind") != "image"
    ):
        raise RuntimeError(f"分镜 {existing_storyboard.get('id')} 缺少可复用的当前人工视觉批准")
    try:
        absolute_path = resolve_approved_storyboard_path(project_url)
    except (OSError, RuntimeError) as error:
        raise RuntimeError(f"分镜 {existing_storyboard.get('id')} 人工批准图无效: {project_url}") from error
    expected_sha256 = str(media_ref.get("contentSha256") or "").lower()
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256) or file_sha256(absolute_path) != expected_sha256:
        raise RuntimeError(f"分镜 {existing_storyboard.get('id')} 人工批准图内容指纹已失效: {absolute_path}")
    return {
        "absolutePath": str(absolute_path),
        "projectUrl": project_url,
        "contentSha256": expected_sha256,
        "referenceManifest": manifest,
        "continuityState": continuity_state,
        "visualReview": json.loads(json.dumps(review)),
    }


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


def assert_image_transfer_size(payload, label="图片传输负载"):
    byte_count = len(payload)
    if byte_count >= IMAGE_TRANSFER_MAX_BYTES:
        raise RuntimeError(
            f"{label}必须严格小于 {IMAGE_TRANSFER_MAX_BYTES} bytes，实际 {byte_count} bytes"
        )
    return byte_count


def decode_reference_image(source):
    if source.startswith("data:image/"):
        match = re.fullmatch(r"data:image/[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)", source)
        if not match:
            raise RuntimeError("参考图 data URI 格式无效")
        try:
            payload = base64.b64decode(re.sub(r"\s+", "", match.group(1)), validate=True)
        except (ValueError, TypeError) as error:
            raise RuntimeError("参考图 data URI base64 解码失败") from error
        if not payload:
            raise RuntimeError("参考图 data URI 内容为空")
        image_source = io.BytesIO(payload)
        label = "data URI 参考图"
    else:
        path = image_source_to_path(source)
        if not path.exists():
            raise RuntimeError(f"参考图不存在: {source}")
        image_source = path
        label = str(path)
    try:
        with Image.open(image_source) as image:
            image.load()
            normalized = ImageOps.exif_transpose(image)
            if "A" in normalized.getbands():
                rgba = normalized.convert("RGBA")
                background = Image.new("RGB", rgba.size, (255, 255, 255))
                background.paste(rgba, mask=rgba.getchannel("A"))
                return background
            return normalized.convert("RGB")
    except (OSError, ValueError) as error:
        raise RuntimeError(f"参考图无法解码: {label}") from error


def reference_transfer_max_edges():
    target = min(IMAGE_TRANSFER_TARGET_MAX_EDGE, max(256, MODEL_REFERENCE_MAX_EDGE))
    return list(dict.fromkeys(max(256, min(target, edge)) for edge in (target, 672, 576, 512, 448, 384, 320, 256)))


def reference_transfer_qualities():
    configured = max(40, min(92, MODEL_REFERENCE_JPEG_QUALITY))
    return list(dict.fromkeys(max(40, min(configured, quality)) for quality in (configured, 76, 70, 64, 58, 52, 46, 40)))


def prepare_storyboard_model_reference_image(source):
    if source.startswith("http://") or source.startswith("https://"):
        return source
    normalized = decode_reference_image(source)
    for max_edge in reference_transfer_max_edges():
        resized = normalized.copy()
        resized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        for quality in reference_transfer_qualities():
            buffer = io.BytesIO()
            resized.save(buffer, format="JPEG", quality=quality, optimize=True)
            payload = buffer.getvalue()
            if len(payload) < IMAGE_TRANSFER_MAX_BYTES:
                encoded = base64.b64encode(payload).decode("ascii")
                return f"data:image/jpeg;base64,{encoded}"
    raise RuntimeError(
        f"参考图压缩失败：无法生成严格小于 {IMAGE_TRANSFER_MAX_BYTES} bytes 的缩略图"
    )


def create_storyboard_transfer_thumbnail(source_path):
    source_path = Path(source_path)
    thumbnail_path = source_path.with_name(f"{source_path.stem}_thumb.png")
    normalized = decode_reference_image(str(source_path))
    for max_edge in reference_transfer_max_edges():
        resized = normalized.copy()
        resized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        for colors in (256, 192, 128, 96, 64, 48, 32):
            quantized = resized.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
            buffer = io.BytesIO()
            quantized.save(buffer, format="PNG", optimize=True)
            payload = buffer.getvalue()
            if len(payload) < IMAGE_TRANSFER_MAX_BYTES:
                thumbnail_path.write_bytes(payload)
                return {
                    "path": str(thumbnail_path),
                    "width": quantized.width,
                    "height": quantized.height,
                    "bytes": assert_image_transfer_size(payload, str(thumbnail_path)),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
    raise RuntimeError(
        f"分镜缩略图压缩失败：{source_path} 无法严格小于 {IMAGE_TRANSFER_MAX_BYTES} bytes"
    )


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

DIRECTOR_PLAN_REQUIRED_SECTIONS = [
    "## ① 主题立意与叙事核心",
    "## ② 视觉风格与画面基调",
    "## ③ 叙事结构与节奏规划",
    "## ④ 分场景情绪与画面意图",
    "## ⑤ 声音方向",
    "## ⑥ 转场与视觉连续性",
]

DIRECTOR_PLAN_REQUIRED_SCENES = [
    "Sc 1-1",
    "Sc 1-2",
    "Sc 1-3",
    "Sc 1-4",
    "Sc 1-5",
]

CHAPTER_001_DIRECTOR_SCENES = [
    {
        "sceneId": "Sc 1-1",
        "title": "金水河码头 傍晚/外",
        "shotStart": 1,
        "shotEnd": 12,
        "paragraph": "P1 苦力码头",
        "coreEvent": "太一宗火印压住码头，赵四挥鞭逼矿，独孤剑尘以极小动作救下小杂役但不暴露实力。",
        "emotionLevel": 8,
        "rhythm": "沉缓压迫，动作点短促，救人瞬间只给观众半拍线索。",
        "emotion": "压迫窒息→隐忍救人",
        "atmosphere": "河雾低垂、湿木发黑、矿筐沉重，所有人都在低头避鞭。",
        "emotionTarget": "观众先看见人被制度压扁，再看见灰衫客只动一寸便改变鞭落方向；英雄感必须藏在沉默里。",
        "shotIntents": [
            "开场先用码头全貌和苦力队列定压迫，不急着亮独孤正脸。",
            "赵四、鞭梢、朱红火印和灵矿倒刺组成暴力链条，镜头让观众明白苦力为什么不敢反抗。",
            "小杂役护头时镜头贴近手指和矿刺，疼痛要具体，不用抽象苦难。",
            "独孤入场只给灰衫、草鞋、油布剑包和袖口残卷，避免把他拍成主动挑衅的侠客。",
            "救人动作以鞋尖拨木、鞭落偏移、空筐炸裂三步完成，不给夸张打斗。",
            "结尾让河雾吞掉独孤半边身影，把旧锋藏回镇中。",
        ],
        "spatial": "前景为朽木栈道和藤筐，中景是赵四、小杂役、苦力队列，背景是火印船影与金水河雾；独孤始终从边缘进入。",
        "distance": "独孤多用中远景和背影，赵四用近景压迫，小杂役用低位近景显得更小；距离差就是阶层差。",
        "sound": "鞭梢破风、铁链拖石、矿筐炸裂、压低的喘息。",
        "continuity": [
            "油布剑包第一次出现时必须压住独孤背脊，后续客栈斗室揭布才有重量。",
            "残卷只露一角，不能提前展示完整内容。",
            "朱红火印作为太一宗压迫符号，从码头延续到结尾灵舟。",
        ],
    },
    {
        "sceneId": "Sc 1-2",
        "title": "悦来客栈 夜/内",
        "shotStart": 13,
        "shotEnd": 24,
        "paragraph": "P2 客栈蓄压",
        "coreEvent": "独孤以绿锈铜钱落脚，掌柜与宗门账册暴露旧案线索，归元断剑在斗室显露。",
        "emotionLevel": 6,
        "rhythm": "市井冷眼转入密室旧痛，算盘和楼板声让节奏从外部压迫变成内部翻涌。",
        "emotion": "冷眼旁观→旧痛翻涌",
        "atmosphere": "客栈灯火窄小，柜台、楼梯、斗室层层收紧，像把独孤一步步推回旧案。",
        "emotionTarget": "让观众感到独孤不是单纯贫穷，而是背着一桩不能说的断剑旧案进入镇中。",
        "shotIntents": [
            "绿锈铜钱落柜要拍成物证，不只是付款动作。",
            "掌柜看剑包的一息停顿是信息钩子，不能剪得太快。",
            "宗门弟子和账册只表现冷漠算账，不让他们抢主线。",
            "独孤上楼避开会响的裂缝，延续码头的克制身体语言。",
            "斗室揭油布要一圈圈打开，让归元断剑出现成为本场最重要的视觉砸点。",
            "旧案闪回只给缚神索、玄天符、太一宗火印等碎片，不展开完整往事。",
        ],
        "spatial": "大堂横向拥挤，楼梯纵向逼仄，斗室收成一盏枯灯和一张桌；空间越往后越窄，旧痛越近。",
        "distance": "客栈众人与独孤保持柜台、楼板、门缝的隔断；斗室内才允许镜头靠近断剑与手指。",
        "sound": "算盘珠、铜钱轻响、楼板吱呀、油布摩擦、断剑低鸣。",
        "continuity": [
            "绿锈铜钱在本场落柜，尾段再次立起不倒，形成因果回环。",
            "账册与旧金镇纸只作线索，不替代人物行动。",
            "归元断剑露出后，后续所有斗室镜头都要承认它的位置和压迫感。",
        ],
    },
    {
        "sceneId": "Sc 1-3",
        "title": "金水塾馆 夜/内",
        "shotStart": 25,
        "shotEnd": 40,
        "paragraph": "P3 烛火微光",
        "coreEvent": "独孤借夜课讲气与命，孩童恐惧中追问凡根，晏燎掌心燃起暗红灵气又被李先生压下。",
        "emotionLevel": 7,
        "rhythm": "前半以课堂停顿和孩童问题蓄势，晏燎燃气瞬间收紧，随后压回寂静。",
        "emotion": "试探引气→命数被压",
        "atmosphere": "塾馆破旧但有人气，油灯、长凳、湿鞋、书箱把凡人求道的窄路摆在画面里。",
        "emotionTarget": "晏燎的微光不是爽点，而是被现实立即按住的希望；独孤的震动必须靠手和枯枝表现。",
        "shotIntents": [
            "从断剑冷光切到塾馆油灯，完成从死物到活人的过渡。",
            "独孤递枯枝、孩童听心跳、丫头攥衣角都要保留动作链。",
            "李先生不能像反派，他的严厉里要有保护意味。",
            "晏燎在最后一排出现，先用沉默和呼吸建立孤立感，再给掌心暗红。",
            "暗红灵气只燃一息，不能画成大范围法术爆发。",
            "独孤握裂枯枝是情绪爆点，替代所有内心独白。",
            "李先生抓手压火后，晏燎不退，五指蜷起要成为少年倔强的视觉结尾。",
        ],
        "spatial": "讲台与长凳形成前后距离，晏燎在最后一排，李先生从侧面切入，独孤站在灯下看见全场。",
        "distance": "孩童问题用中近景，晏燎燃气用特写，独孤反应用近景，李先生压手用双人中景；镜头距离跟随希望从远到近再被推远。",
        "sound": "油灯噼啪、孩童屏息、窗外铁链远响、枯枝裂声、掌心余温被压灭的轻微嗤声。",
        "continuity": [
            "枯枝从李先生递出到独孤握裂必须同一根，不能变成新道具。",
            "晏燎掌心暗红是尾段归元认人的视觉锚点。",
            "孩童破衣湿鞋要贯穿课堂，强调凡根求道的处境。",
        ],
    },
    {
        "sceneId": "Sc 1-4",
        "title": "悦来客栈斗室 深夜/内",
        "shotStart": 41,
        "shotEnd": 42,
        "paragraph": "P4 十年首震",
        "coreEvent": "独孤回到斗室，残卷裂痕与归元断剑确认晏燎，绿锈铜钱立起不倒。",
        "emotionLevel": 9,
        "rhythm": "极静的室内确认，少台词、多物证，让断剑、残卷、铜钱替人物说话。",
        "emotion": "确认传承→旧誓苏醒",
        "atmosphere": "斗室像被夜色压住的剑匣，所有物件都在轻微震动前保持克制。",
        "emotionTarget": "让观众知道独孤等了十年的答案终于出现，但这个答案不会带来安全，只会带来更快的追杀。",
        "shotIntents": [
            "晏燎掌心余红转成残卷裂痕，用图像逻辑连接塾馆与斗室。",
            "残卷古字只露关键字，不解释完整设定。",
            "归元断剑低鸣要克制，像沉睡多年的物件第一次认人。",
            "绿锈铜钱立起不倒是命数指针，必须拍得清楚。",
            "独孤不需要大段表情，手指按剑格和喉结停顿即可。",
        ],
        "spatial": "斗室桌面为中心，残卷、断剑、铜钱形成三角关系；独孤坐在三角之外，像被物证审问。",
        "distance": "本场以特写和静止近景为主，人物退到物件之后，强调不是人在决定命数，而是旧誓被唤醒。",
        "sound": "纸页颤动、寒铁极轻嗡鸣、铜钱立起的细响、更鼓远声。",
        "continuity": [
            "断剑位置承接 Sc 1-2 斗室揭布后的摆放。",
            "残卷裂痕承接 Sc 1-1 袖中残卷和 Sc 1-3 晏燎余红。",
            "铜钱从客栈付款物件升级为命数物证。",
        ],
    },
    {
        "sceneId": "Sc 1-5",
        "title": "悦来客栈窗前/金水河 深夜/外",
        "shotStart": 43,
        "shotEnd": 43,
        "paragraph": "P5 灵舟逼近",
        "coreEvent": "宗门灵舟在雾中显形，朱红火印穿破夜色，独孤按住归元，第一章以追杀逼近收钩。",
        "emotionLevel": 9,
        "rhythm": "从斗室极静切到河雾大远景，压迫突然放大，尾镜保留悬念。",
        "emotion": "旧誓苏醒→危机逼近",
        "atmosphere": "室内一盏灯和室外整条河形成悬殊尺度，宗门秩序像雾中巨影压向小镇。",
        "emotionTarget": "希望刚被确认，危险就抵达门口；观众离场时应感到紧迫而不是阶段性胜利。",
        "shotIntents": [
            "窗前先给独孤按剑的手，再切金水河雾，完成内外压力转换。",
            "灵舟不要拍成华丽仙舟，要像宗门刑具一样沉重、冷峻。",
            "朱红火印必须与码头火印同源，形成首尾闭环。",
            "晏燎可以作为远处命数锚点被提及或弱化出现，不能抢独孤和灵舟的收束关系。",
            "最后一镜不解释追兵，只让观众看见雾被船影推开。",
        ],
        "spatial": "前景窗棂和独孤手，远景金水河与灵舟，二者用雾连接；室内小空间被室外巨物反向包围。",
        "distance": "先极近后大远，镜头距离骤然拉开，表现个人旧誓面对宗门秩序的悬殊。",
        "sound": "船桨破水、缆绳绷紧、远处更鼓、断剑被按住后的余震。",
        "continuity": [
            "朱红火印从码头压迫回到灵舟压迫，形成一章首尾闭环。",
            "归元断剑从斗室物证变成下一章行动触发器。",
            "金水河雾延续开场河雾，但意义从遮蔽苦力变成遮蔽追兵。",
        ],
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
    ("金水河码头", "抱矿跪倒的小杂役缩肩护头，灵矿倒刺扎破指缝。", "赵四", "偷懒？找死！再慢半步抽断你。", "矿石摩擦、孩童抽气", ["监工赵四", "小杂役", "灵矿藤筐"], 3.8),
    ("金水河码头", "血珠落在湿黑木栈上，小杂役把求饶吞成发抖的气音。", "小杂役", "监工老爷，饶命！我再不敢了。", "血滴落木、铁链拖石", ["小杂役", "灵矿藤筐"], 3.8),
    ("金水河码头", "苦力弯腰拖筐，年轻苦力压低声音让众人低头避鞭。", "老苦力", "骨头都榨干了，连哭都欠债。", "粗重喘息、麻绳绷紧", ["老苦力", "年轻苦力", "灵矿"], 4.0),
    ("金水河码头", "赵四靴底碾碎灵矿，青盐水顺着鞭梢滴进裂开的木纹。", "赵四", "误了宗门灵舟，谁都别想活！", "矿石碎裂、盐水滴落", ["监工赵四", "赤练蛇皮鞭", "灵矿"], 3.8),
    ("金水河码头", "独孤剑尘从河雾边走来，灰衫发白，油布剑包压在背后。", "旁白", "灰衫客入镇，无声得像一笔淡墨。", "河雾风声、木栈轻响", ["独孤剑尘", "油布剑包"], 4.2),
    ("金水河码头", "背后油布剑包轻轻一颤，袖中残卷露出一角，古字只剩一个等。", "旁白", "残卷古字微亮，只剩一个等字。", "布料摩擦、纸页轻响", ["独孤剑尘", "油布剑包", "残卷"], 4.2),
    ("金水河码头", "赵四冷笑抬臂，鞭梢飞白般斜劈向小杂役。", "赵四", "全填江眼，一个也别留！", "鞭声炸开", ["监工赵四", "小杂役", "赤练蛇皮鞭"], 3.8),
    ("金水河码头", "独孤没有抬眼，只在错身一瞬用鞋尖轻拨半截朽木。", "旁白", "他只动了一寸，救下一条命，也藏住旧锋。", "朽木轻响、脚步擦过", ["独孤剑尘", "小杂役"], 4.2),
    ("金水河码头", "赵四一脚踩偏，鞭子抽碎空筐，藤条碎屑炸开。", "赵四", "谁绊老子？站出来！", "空筐炸裂、矿渣滚落", ["监工赵四", "灵矿藤筐"], 3.8),
    ("金水河码头", "小杂役抱着矿渣滚进船影，活下来的人连谢字都不敢出口。", "旁白", "活下来的人，连道谢都不敢出声。", "船板晃动、压抑呼吸", ["小杂役", "灵矿"], 4.0),
    ("金水河码头", "独孤指尖压住袖口残卷，河雾吞掉他半边身影。", "旁白", "火印暗红如血，他继续向镇中走去。", "河风、远处钟声", ["独孤剑尘", "残卷"], 4.0),
    ("悦来客栈", "悦来客栈灯影赭黄，掌柜拨算盘，算珠声像冷雨落木。", "旁白", "悦来客栈里，算盘比人情更响。", "算盘声、油烟声", ["悦来客栈", "掌柜"], 4.0),
    ("悦来客栈", "独孤推门入内，灰衫沾着矿尘，油布剑包压弯衣褶。", "掌柜", "住店，还是打尖？", "门轴轻响、脚步入堂", ["独孤剑尘", "掌柜", "油布剑包"], 3.8),
    ("悦来客栈", "独孤把两枚绿锈铜钱放到柜台边，铜锈在灯下发暗。", "独孤剑尘", "住店，下房。", "铜钱轻落", ["独孤剑尘", "绿锈铜钱"], 3.6),
    ("悦来客栈", "掌柜压住铜钱，眼神在剑包上停了一息。", "掌柜", "剑包别惹事，本店不担命。", "算盘停顿、布包轻响", ["掌柜", "油布剑包"], 3.8),
    ("悦来客栈", "独孤沿朽木楼梯上行，脚步避开每一道会响的裂缝。", "独孤剑尘", "它比我安静，也比你守规矩。", "楼板轻响、风穿门缝", ["独孤剑尘", "悦来客栈"], 3.8),
    ("悦来客栈", "虚掩房门内，两名宗门弟子衣袖干净，灵矿账册压着旧金镇纸。", "宗门弟子甲", "矿账又涨了，今夜要补齐，不够就抓人。", "纸页翻动、低声交谈", ["宗门弟子甲", "宗门弟子乙", "灵矿账册"], 4.0),
    ("悦来客栈", "账册边写着苦力扣损耗，独孤袖中指节骤紧又慢慢松开。", "宗门弟子乙", "苦力账上扣，死人也算损耗。", "指节收紧、木门轻晃", ["独孤剑尘", "灵矿账册"], 4.0),
    ("悦来客栈斗室", "斗室狭窄，枯灯豆大，独孤合门坐下。", "旁白", "一间下房，藏不住十年的旧伤。", "门闩落下、灯火噼啪", ["独孤剑尘", "悦来客栈"], 4.0),
    ("悦来客栈斗室", "三层油布一圈圈解开，半截归元断剑露出寒光。", "独孤剑尘", "十年了，归元还没忘疼。", "油布摩擦、断剑轻鸣", ["独孤剑尘", "归元断剑", "油布剑包"], 4.2),
    ("悦来客栈斗室", "缚神索、玄天符、归元折断和太一宗火印在宣纸白光中闪过。", "旁白", "旧日一闪而过，伤口从未合上。", "闪回尖响、符纸震动", ["缚神索", "玄天符", "归元断剑"], 4.0),
    ("悦来客栈斗室", "楼下掌柜的声音穿过木板，窗外金水塾馆一盏油灯亮起。", "掌柜", "客官，会讲引气吗？", "木板传声、远处读书声", ["掌柜", "金水塾馆"], 3.8),
    ("悦来客栈斗室", "枯灯被风吹得一歪，独孤抬眼看向塾馆。", "独孤剑尘", "半堂，换粥。", "灯火摇晃、夜风", ["独孤剑尘", "金水塾馆"], 3.8),
    ("金水塾馆", "断口冷光化作塾馆油灯，孩童挤坐长凳，破衣湿鞋收在凳下。", "旁白", "夜课开始，穷孩子把呼吸都放轻了。", "叠化、孩童呼吸", ["金水塾馆", "孩童甲", "丫头"], 4.0),
    ("金水塾馆", "李先生收起书箱，将一根枯枝递给独孤。", "李先生", "掌柜说你会讲？", "书箱合上、枯枝递出", ["李先生", "独孤剑尘"], 3.6),
    ("金水塾馆", "独孤握住枯枝，窗外铁链拖动声远远压来。", "独孤剑尘", "半堂引气，只教活命，别问仙途。", "铁链远响、窗纸震动", ["独孤剑尘", "金水塾馆"], 3.6),
    ("金水塾馆", "李先生目光扫过孩童，提醒独孤不要给他们妄念。", "李先生", "只讲气，别惹事。", "衣袖摩擦、低声警告", ["李先生", "独孤剑尘", "孩童甲", "丫头"], 3.8),
    ("金水塾馆", "独孤站到灯下，枯枝轻点桌面，满堂呼吸随之一停。", "独孤剑尘", "闭眼，守一息。", "枯枝点桌、油灯轻晃", ["独孤剑尘"], 3.8),
    ("金水塾馆", "孩童甲怯怯抬头，问凡根是否也有气。", "孩童甲", "凡根也有气吗？我们也有吗。", "孩童低语", ["孩童甲", "独孤剑尘"], 3.6),
    ("金水塾馆", "独孤看着一屋破衣湿鞋，声音压得很低。", "独孤剑尘", "喘着，就有。", "呼吸声、窗缝风", ["独孤剑尘", "金水塾馆"], 3.8),
    ("金水塾馆", "丫头攥住衣角，问穷人能不能修，孩童们屏住气等答案。", "丫头", "穷人也能修？", "衣角摩擦、孩童屏息", ["丫头", "独孤剑尘"], 3.8),
    ("金水塾馆", "独孤让众人听心跳、听掌心，油灯照出一排瘦小影子。", "独孤剑尘", "气在，命就在。", "心跳低鼓、油灯噼啪", ["独孤剑尘", "孩童甲", "丫头"], 4.0),
    ("金水塾馆", "最后一排，晏燎闭眼，双手叠在膝前，呼吸慢得像在数河水。", "旁白", "最后一排的少年，把一口气守到掌心里。", "呼吸放慢、灯火摇晃", ["晏燎", "金水塾馆"], 4.2),
    ("金水塾馆", "晏燎掌心皮肉下浮起一点暗红炭光，满堂骤静。", "晏燎", "先生，我手心发烫。", "炭火微鸣、满堂骤静", ["晏燎", "独孤剑尘"], 4.2),
    ("金水塾馆", "独孤握着枯枝的手骤然收紧，枝皮裂开露出白茬。", "旁白", "那一点暗红，撞进了独孤的眼里。", "枯枝裂声、心跳加重", ["独孤剑尘", "晏燎"], 4.0),
    ("金水塾馆", "李先生快步走近，抓起晏燎的手，暗红余温藏入皮下。", "李先生", "摊开，别藏，别怕。", "急促脚步、衣袖摩擦", ["李先生", "晏燎"], 3.6),
    ("金水塾馆", "晏燎盯着自己掌心，不肯退，五指慢慢蜷起。", "晏燎", "刚才真有火。", "满堂静默", ["晏燎", "李先生"], 3.8),
    ("金水塾馆", "李先生眼底掠过一丝哀色，又被严厉压住。", "李先生", "灵根驳杂，此生无缘大道。", "判词落下、油灯一暗", ["李先生", "晏燎"], 4.2),
    ("金水塾馆", "晏燎把那点余温护进掌心，瘦削的脸被独孤牢牢记住。", "晏燎", "我不怕疼，我只怕一辈子跪着。", "指节收紧、孩童避目", ["晏燎", "独孤剑尘"], 4.0),
    ("悦来客栈斗室", "深夜斗室内，晏燎掌心余红化成残卷边缘裂痕，末页古字渗出旧金冷光。", "独孤剑尘", "归元认人，残卷没有骗我。", "纸页轻震、断剑低鸣", ["独孤剑尘", "晏燎", "残卷", "归元断剑"], 4.2),
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


EMPTY_STORYBOARD_SPEECH = {"", "—", "-", "无", "无台词", "无对白"}
NARRATOR_LABELS = {"旁白", "vo", "画外音", "解说"}


def latest_storyboard_work(state, episode_id=EPISODE_ID):
    works = [
        work
        for work in state.get("agentWorkData", [])
        if work.get("key") == "storyboardTable"
        and work.get("episodeId") == episode_id
        and isinstance(work.get("data"), str)
        and work.get("data", "").strip()
    ]
    if not works:
        return None
    return sorted(
        works,
        key=lambda work: (
            work.get("updatedAt", 0) or 0,
            work.get("createdAt", 0) or 0,
            str(work.get("id") or ""),
        ),
    )[-1]


def parse_storyboard_list(value):
    text = (value or "").strip().strip("[]【】")
    if not text or text in {"—", "-"}:
        return []
    return [item.strip() for item in re.split(r"[,，、]", text) if item.strip()]


def parse_storyboard_duration(value):
    match = re.search(r"\d+(?:\.\d+)?", str(value or ""))
    if not match:
        return 0.0
    return float(match.group(0))


def parse_storyboard_speech(lines, description):
    raw = (lines or "").strip()
    if raw in EMPTY_STORYBOARD_SPEECH:
        compact = re.sub(r"\s+", " ", description or "").strip()
        if not compact:
            raise RuntimeError("无对白分镜缺少可生成旁白的画面描述")
        match = re.match(r"^.{1,48}?[。！？]", compact)
        sentence = match.group(0) if match else compact[:48]
        if not sentence.endswith(("。", "！", "？")):
            sentence = f"{sentence}。"
        return "旁白", sentence
    colon = re.search(r"[:：]", raw)
    if not colon:
        return "旁白", raw
    speaker = raw[:colon.start()].strip()
    line = raw[colon.end():].strip()
    if not speaker or line in EMPTY_STORYBOARD_SPEECH:
        return parse_storyboard_speech("", description)
    return speaker, line


def parse_storyboard_table(markdown, episode_id=EPISODE_ID):
    blocks = re.findall(r"<storyboardTable>([\s\S]*?)</storyboardTable>", markdown or "")
    body = "\n".join(block.strip() for block in blocks) if blocks else (markdown or "").strip()
    rows = []
    errors = []
    current_scene = ""
    current_scene_no = None
    current_asset_names = []
    current_asset_ids = []
    scene_numbers = {}

    for raw_line in body.splitlines():
        line = raw_line.strip().strip("`").strip()
        scene_match = re.match(r"^##\s*场\s*(\d+)[：:]\s*(.+)$", line)
        if scene_match:
            current_scene_no = int(scene_match.group(1))
            current_scene = re.split(r"\s*[｜|]\s*参演角色", scene_match.group(2), maxsplit=1)[0].strip()
            current_asset_names = []
            current_asset_ids = []
            continue
        asset_name_match = re.match(r"^\*\*引用资产名称\*\*[：:]\s*(.+)$", line)
        if asset_name_match:
            current_asset_names = parse_storyboard_list(asset_name_match.group(1))
            continue
        asset_id_match = re.match(r"^\*\*引用资产ID\*\*[：:]\s*(.+)$", line)
        if asset_id_match:
            current_asset_ids = parse_storyboard_list(asset_id_match.group(1))
            continue
        if not (line.startswith("|") and line.endswith("|")):
            continue
        fields = [field.strip() for field in line[1:-1].split("|")]
        if not fields or fields[0] in {"序号", "---", "------"} or set(fields[0]) <= {"-", ":"}:
            continue
        try:
            index = int(fields[0])
        except (TypeError, ValueError):
            errors.append(f"序号非法: {line}")
            continue

        if len(fields) == 14:
            scene = fields[2]
            asset_names = parse_storyboard_list(fields[3])
            asset_ids = parse_storyboard_list(fields[13])
            row = {
                "index": index,
                "desc": fields[1],
                "scene": scene,
                "assets": [name for name in asset_names if name != scene],
                "assetIds": asset_ids,
                "duration": parse_storyboard_duration(fields[4]),
                "shotSize": fields[5],
                "cameraMove": fields[6],
                "action": fields[7],
                "orientation": fields[8],
                "spatialRelation": fields[9],
                "emotion": fields[10],
                "lines": fields[11],
                "sound": fields[12],
            }
        elif len(fields) == 7:
            scene = current_scene
            row = {
                "index": index,
                "desc": fields[1],
                "scene": scene,
                "assets": [name for name in current_asset_names if name != scene],
                "assetIds": list(current_asset_ids),
                "duration": parse_storyboard_duration(fields[2]),
                "shotSize": fields[3],
                "cameraMove": fields[4],
                "action": fields[1],
                "orientation": "—",
                "spatialRelation": "—",
                "emotion": "克制自然",
                "lines": fields[5],
                "sound": fields[6],
            }
        else:
            errors.append(f"列数不符（应为14列或7列，实为{len(fields)}）: {line}")
            continue

        if not row["scene"]:
            errors.append(f"分镜 {index} 缺少场景")
            continue
        if current_scene_no is not None and row["scene"] == current_scene:
            scene_no = current_scene_no
        else:
            scene_no = scene_numbers.setdefault(row["scene"], len(scene_numbers) + 1)
        speaker, spoken_line = parse_storyboard_speech(row.pop("lines"), row["desc"])
        row.update({
            "sceneNo": scene_no,
            "speaker": speaker,
            "text": spoken_line,
            "trackKey": f"{episode_id}-scene-{scene_no}",
            "characters": [],
        })
        rows.append(row)

    if errors:
        raise RuntimeError("分镜表解析失败: " + "；".join(errors))
    if not rows:
        raise RuntimeError(f"{episode_id} 的导演分镜表没有可用分镜")
    expected_indexes = list(range(1, len(rows) + 1))
    actual_indexes = [row["index"] for row in rows]
    if actual_indexes != expected_indexes:
        raise RuntimeError(f"分镜序号必须连续为 1..N: {actual_indexes}")
    return rows


def resolve_storyboard_source(state, episode_id=EPISODE_ID, allow_bootstrap=None):
    work = latest_storyboard_work(state, episode_id)
    if work:
        shots = parse_storyboard_table(work["data"], episode_id)
        if episode_id == EPISODE_ID and len(shots) == len(CHAPTER_001_SHOTS):
            for index, shot in enumerate(shots, 1):
                group = continuity_group_for_index(index)
                if group:
                    shot["scene"] = group["sceneName"]
        return {
            "kind": "project-storyboard-table",
            "workId": work.get("id") or "",
            "updatedAt": work.get("updatedAt") or work.get("createdAt") or 0,
            "data": work["data"],
            "shots": shots,
        }
    use_bootstrap = ALLOW_STORYBOARD_BOOTSTRAP if allow_bootstrap is None else bool(allow_bootstrap)
    if not use_bootstrap:
        raise RuntimeError(f"未找到 {episode_id} 最新 storyboardTable；生产运行禁止静态 fixture 回退")
    shots = canonical_storyboard_shots(episode_id)
    return {
        "kind": "bootstrap-fixture",
        "workId": "",
        "updatedAt": 0,
        "data": "",
        "shots": shots,
    }


def episode_character_identities(state, episode_id=EPISODE_ID):
    by_id = {}
    for batch in state.get("entityExtractions", []):
        if batch.get("episodeId") != episode_id:
            continue
        for character in batch.get("characters", []):
            character_id = str(character.get("characterId") or "").strip()
            name = str(character.get("name") or "").strip()
            if not character_id or not name:
                continue
            existing = by_id.get(character_id)
            aliases = [str(alias).strip() for alias in character.get("aliases", []) if str(alias).strip()]
            if existing:
                existing["aliases"] = sorted(set(existing["aliases"] + aliases + ([name] if name != existing["name"] else [])))
            else:
                by_id[character_id] = {
                    "characterId": character_id,
                    "name": name,
                    "aliases": aliases,
                }
    identities = list(by_id.values())
    if not identities:
        raise RuntimeError(f"{episode_id} 缺少角色实体，无法解析 canonical speakerId")
    return identities


def resolve_canonical_speaker_id(speaker, identities):
    value = str(speaker or "").strip()
    if value.lower() in NARRATOR_LABELS:
        return "narrator"
    if value.startswith("character:"):
        character_id = value[len("character:"):]
        matches = [item for item in identities if item["characterId"] == character_id]
    else:
        matches = [item for item in identities if item["name"] == value]
        if not matches:
            matches = [item for item in identities if value in item.get("aliases", [])]
    if not matches:
        raise RuntimeError(f"speaker 无法解析到角色实体: {value}")
    if len(matches) > 1:
        ids = ", ".join(item["characterId"] for item in matches)
        raise RuntimeError(f"speaker 对应多个角色实体: {value} -> {ids}")
    return f"character:{matches[0]['characterId']}"


def normalize_tts_spoken_text(value):
    text = re.sub(r"[`*_#]", "", str(value or ""))
    text = re.sub(r"[\[【][^\]】]*(?:动作|画面|音效|字幕|提示)[^\]】]*[\]】]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def build_storyboard_voiceover(shot, identities, episode_id=EPISODE_ID):
    storyboard_id = f"sb-{episode_id}-{shot['index']:03d}"
    try:
        speaker_id = resolve_canonical_speaker_id(shot.get("speaker"), identities)
    except RuntimeError as error:
        raise RuntimeError(f"分镜 {storyboard_id} speaker 解析失败: {error}") from error
    spoken_text = spoken_text_for(
        shot.get("speaker") or "旁白",
        normalize_tts_spoken_text(shot.get("text")),
    )
    if not spoken_text:
        raise RuntimeError(f"分镜 {storyboard_id} 的口播文本为空")
    source_duration = float(shot.get("duration") or 0)
    duration_target = (
        source_duration
        if source_duration > 0
        else max(math.ceil(len(spoken_text) / 4) + 0.4, 1.0)
    )
    emotion = str(shot.get("emotion") or "克制自然").strip()
    voice_style = (
        f"电影级中文旁白，{emotion}，厚重克制，停顿自然。"
        if speaker_id == "narrator"
        else f"中文角色对白，{emotion}，贴合人物身份，停顿自然。"
    )
    return {
        "storyboardId": storyboard_id,
        "index": shot["index"],
        "speaker": shot["speaker"],
        "speakerId": speaker_id,
        "line": shot["text"],
        "ttsSpokenText": spoken_text,
        "durationTarget": duration_target,
        "voiceStyle": voice_style,
        "requiresFixedVoice": True,
    }


def build_storyboard_voiceovers(shots, identities, episode_id=EPISODE_ID):
    voiceovers = [build_storyboard_voiceover(shot, identities, episode_id) for shot in shots]
    if not voiceovers or len(voiceovers) != len(shots):
        raise RuntimeError(f"逐镜口播数量与源分镜不一致: {len(voiceovers)}/{len(shots)}")
    return voiceovers


def shot_tuple(shot):
    if isinstance(shot, dict):
        return shot["scene"], shot["desc"], shot["speaker"], shot["text"], shot["sound"], shot["assets"], shot["duration"]
    return shot


def director_scene_stats(shots):
    stats = {}
    for scene in CHAPTER_001_DIRECTOR_SCENES:
        selected = shots[scene["shotStart"] - 1:scene["shotEnd"]]
        stats[scene["sceneId"]] = {
            "lines": sum(1 for shot in selected if clean_script_text(shot.get("text", ""))),
            "chars": sum(len(clean_script_text(shot.get("text", ""))) for shot in selected),
            "shots": len(selected),
        }
    return stats


def director_scene_block(scene, stats):
    stat = stats.get(scene["sceneId"], {})
    lines = [
        f"### {scene['sceneId']} {scene['title']}",
        "",
        f"- **所属段落**：{scene['paragraph']}；分镜范围 {scene['shotStart']:02d}-{scene['shotEnd']:02d}；台词条数 {stat.get('lines', 0)}；台词字数 {stat.get('chars', 0)}；情绪浓度 {scene['emotionLevel']}。",
        f"- **核心事件**：{scene['coreEvent']}",
        f"- **情绪目标**：{scene['emotionTarget']}",
        f"- **氛围方向**：{scene['atmosphere']}",
        f"- **节奏策略**：{scene['rhythm']}",
        "- **镜头意图**：",
        *[f"  - {item}" for item in scene["shotIntents"]],
        f"- **空间叙事**：{scene['spatial']}",
        f"- **距离感设计**：{scene['distance']}",
        f"- **声音锚点**：{scene['sound']}",
        "- **连续性锚点**：",
        *[f"  - {item}" for item in scene["continuity"]],
        "",
    ]
    return lines


def build_script_plan(shots=None):
    shots = shots or canonical_storyboard_shots()
    scene_stats = director_scene_stats(shots)
    scene_rows = [
        f"| {scene['sceneId']} | {scene['title']} | {scene_stats.get(scene['sceneId'], {}).get('lines', 0)} | {scene_stats.get(scene['sceneId'], {}).get('chars', 0)} | {scene['emotionLevel']} | {scene['emotion']} | {scene['paragraph']} |"
        for scene in CHAPTER_001_DIRECTOR_SCENES
    ]
    scene_blocks = []
    for scene in CHAPTER_001_DIRECTOR_SCENES:
        scene_blocks.extend(director_scene_block(scene, scene_stats))
    return "\n".join([
        "<scriptPlan>",
        "## ① 主题立意与叙事核心",
        "",
        "**核心主题**：一个在旧誓里沉默十年的剑修，进入被宗门火印碾压的小镇，终于在凡人孩子掌心看见值得等待的微光。",
        "",
        "**情感主线（三层递进）**：",
        "- **压**：码头苦力、矿筐、火印、赤练鞭把金水河镇压成一座活着的牢笼，独孤剑尘先以旁观者姿态进入。",
        "- **藏**：绿锈铜钱、账册、油布剑包、归元断剑逐层揭出旧案，但独孤始终不把力量暴露给镇中人。",
        "- **燃**：塾馆夜课里，晏燎掌心暗红灵气只亮一息，却让残卷和断剑在深夜同时回应。",
        "- **迫**：希望刚被确认，宗门灵舟便压雾而来；第一章离场感是紧迫、苍凉、意难平。",
        "",
        "**表达策略**：以能拍到的身体微动作替代内心独白。独孤的鞋尖、指节、袖口、喉结和按剑的手承担心理变化；晏燎的闭眼、攥拳、护住掌心承担少年命数。",
        "",
        "## ② 视觉风格与画面基调",
        "",
        "- **主风格锁定**：宣纸淡彩工笔、青绿山水底色、低饱和蓝灰、旧金细纹、细密线描；画面是国风漫剧关键帧，不是写实摄影、3D 写实渲染或赛璐璐动画。",
        "- **构图基调**：大量侧偏留白和前中后景层次，独孤常被放在画面边缘，留白代表他背负的十年旧誓。",
        "- **码头段**：藤筐、鞭梢、苦力队列形成斜线压迫，前景朽木遮挡让小人物像被空间挤住。",
        "- **客栈段**：柜台、门缝、楼梯、斗室构成层层框架，把断剑旧案从公共空间推入私人空间。",
        "- **塾馆段**：门框、长凳、油灯和最后一排晏燎形成纵深，凡人求道的窄路要在空间里看出来。",
        "- **尾段**：室内物证特写切向室外金水河大远景，个人旧誓与宗门巨影形成尺度悬殊。",
        "- **反向约束**：不烧录字幕，不画标题叠字，不把分镜画成白底设定页、三视图、资料卡或海报站姿。",
        "",
        "## ③ 叙事结构与节奏规划",
        "",
        "| 段落 | 覆盖场次 | 核心事件 | 情绪浓度 | 节奏 |",
        "|---|---|---|---|---|",
        "| P1 苦力码头 | Sc 1-1 | 鞭下入镇，独孤暗救小杂役 | 8 | 沉缓压迫，动作砸点短促 |",
        "| P2 客栈蓄压 | Sc 1-2 | 铜钱落柜、账册旧案、断剑显露 | 6 | 市井冷眼转入密室旧痛 |",
        "| P3 烛火微光 | Sc 1-3 | 夜课引气、孩童追问、晏燎燃气 | 7 | 问答蓄势，燃气瞬间收紧 |",
        "| P4 十年首震 | Sc 1-4 | 残卷裂痕、归元认人、铜钱立起 | 9 | 极静确认，以物证替台词 |",
        "| P5 灵舟逼近 | Sc 1-5 | 金水河雾中灵舟显形 | 9 | 尺度骤放大，悬念收钩 |",
        "",
        "**关键转折点**：",
        "- 码头救人：独孤只动一寸，观众意识到他有力量，但镇中人没有看懂。",
        "- 断剑显露：油布被解开，第一章从外部压迫进入旧案内核。",
        "- 晏燎燃气：凡根问题被暗红灵气回答，随后又被李先生压回现实。",
        "- 归元认人：残卷、断剑、铜钱同时回应，证明晏燎不是错觉。",
        "- 灵舟逼近：宗门秩序抵达，把希望直接推入逃亡倒计时。",
        "",
        "## ④ 分场景情绪与画面意图",
        "",
        "| 场次 | 场景名 | 台词条数 | 台词字数 | 情绪浓度 | 情绪基调（含 X→Y） | 段落 |",
        "|---|---|---|---|---|---|---|",
        *scene_rows,
        "",
        *scene_blocks,
        "## ⑤ 声音方向",
        "",
        "**逐场环境音设计**：",
        "- Sc 1-1：鞭梢破风、铁链拖石、矿筐炸裂和压低的苦力喘息，声音要让码头像一台榨人的机器。",
        "- Sc 1-2：算盘、铜钱、楼板、油布摩擦和断剑低鸣，声音从市井算账过渡到旧案苏醒。",
        "- Sc 1-3：油灯噼啪、孩童屏息、窗外铁链远响、枯枝裂声，塾馆的静要比喧闹更紧。",
        "- Sc 1-4：纸页颤动、寒铁极轻嗡鸣、铜钱立起的细响、更鼓远声，所有声音都要克制。",
        "- Sc 1-5：船桨破水、缆绳绷紧、远处更鼓、断剑余震，远声压近但不解释追兵身份。",
        "",
        "**沉默运用**：",
        "- 独孤鞋尖拨木救人前后留半拍静默，让观众自己发现动作因果。",
        "- 晏燎掌心暗红出现时，全场先停一瞬，再让李先生的脚步切入。",
        "- 归元低鸣时不加旁白，用纸页和寒铁声让物证说话。",
        "- 灵舟显形前先压低所有环境音，再让船桨声破雾。",
        "",
        "## ⑥ 转场与视觉连续性",
        "",
        "**场间转场策略**：",
        "- Sc 1-1 → Sc 1-2：码头空筐裂口的墨色晕开，接客栈柜台上的绿锈铜钱；同样是被压迫者的价码。",
        "- Sc 1-2 → Sc 1-3：归元断口的冷白化成塾馆油灯，死物旧案切入活人微光。",
        "- Sc 1-3 → Sc 1-4：晏燎掌心余红熄下，化成残卷边缘裂痕。",
        "- Sc 1-4 → Sc 1-5：铜钱立起的细响延续到窗外缆绳绷紧，室内命数接上室外追兵。",
        "",
        "**视觉连续性锚点**：",
        "- 独孤剑尘：灰衫、草鞋、油布剑包、克制身体语言贯穿；力量只能通过细节泄露。",
        "- 晏燎：最后一排、闭眼、掌心暗红、护住余温，构成少年命数线。",
        "- 归元断剑：油布包裹、半截寒铁、低鸣、被按住，构成旧誓线。",
        "- 绿锈铜钱：客栈付款物件在尾段升级为命数指针。",
        "- 朱红火印：码头矿筐和结尾灵舟同源，首尾压迫闭环。",
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


def build_structured_script_plan():
    return {
        "id": "script-plan-chapter-001-toonflow",
        "episodeId": EPISODE_ID,
        "theme": "灰衫剑修在被宗门火印碾压的小镇里守住旧誓，码头暗救不露锋芒，客栈断剑揭出旧案，塾馆晏燎燃起一息暗红，尾声以灵舟逼近把希望推进倒计时。",
        "visualStyle": "宣纸淡彩工笔、青绿山水底色、低饱和蓝灰、旧金细纹、细密线描；侧偏留白、前中后景层次、框中框空间压迫；禁止写实摄影、3D写实渲染、赛璐璐色块和白底设定页。",
        "narrativeRhythm": "P1 码头压迫沉缓推进；P2 客栈从市井冷眼转入密室旧痛；P3 塾馆夜课用问答蓄势，晏燎燃气瞬间收紧；P4 斗室极静确认，用残卷、断剑、铜钱替台词；P5 金水河灵舟以大远景放大危机。",
        "sceneIntents": [
            {
                "sceneId": scene["sceneId"],
                "emotion": scene["emotion"],
                "shotIntent": "；".join(scene["shotIntents"][:3]),
                "spatial": f"{scene['spatial']}；{scene['distance']}",
            }
            for scene in CHAPTER_001_DIRECTOR_SCENES
        ],
        "soundDirection": "Sc 1-1 鞭梢破风/铁链拖石/矿筐炸裂；Sc 1-2 算盘/铜钱/楼板/油布摩擦/断剑低鸣；Sc 1-3 油灯/孩童屏息/枯枝裂声；Sc 1-4 纸页颤动/寒铁嗡鸣/铜钱细响；Sc 1-5 船桨破水/缆绳绷紧/更鼓远声。",
        "transitions": "Sc 1-1→Sc 1-2 空筐裂口墨色晕开接绿锈铜钱；Sc 1-2→Sc 1-3 断口冷白化作塾馆油灯；Sc 1-3→Sc 1-4 掌心余红化作残卷裂痕；Sc 1-4→Sc 1-5 铜钱细响接窗外缆绳绷紧。",
        "derivedAssetPlan": DERIVED_ASSET_PLAN,
    }


def chinese_char_count(text):
    return len(re.findall(r"[\u4e00-\u9fff]", text or ""))


def audit_director_plan(script_plan_xml, structured_plan=None):
    structured_plan = structured_plan or {}
    scene_intents = structured_plan.get("sceneIntents", [])
    required_sections = {
        section: section in script_plan_xml
        for section in DIRECTOR_PLAN_REQUIRED_SECTIONS
    }
    required_scenes = {
        scene_id: re.search(rf"(?m)^###\s+{re.escape(scene_id)}\b", script_plan_xml) is not None
        for scene_id in DIRECTOR_PLAN_REQUIRED_SCENES
    }
    complete_scene_intents = [
        item for item in scene_intents
        if item.get("sceneId") and item.get("emotion") and item.get("shotIntent") and item.get("spatial")
    ]
    return {
        "directorPlanChars": len(script_plan_xml or ""),
        "directorPlanChineseChars": chinese_char_count(script_plan_xml),
        "directorPlanH2Sections": len(re.findall(r"(?m)^##\s+[①②③④⑤⑥]", script_plan_xml or "")),
        "directorPlanSceneSections": len(re.findall(r"(?m)^###\s+Sc\s+1-\d\b", script_plan_xml or "")),
        "directorPlanBulletCount": len(re.findall(r"(?m)^\s*-\s+", script_plan_xml or "")),
        "directorPlanRequiredSectionsPresent": required_sections,
        "directorPlanRequiredSceneSectionsPresent": required_scenes,
        "directorPlanStructuredSceneIntents": len(scene_intents),
        "directorPlanStructuredSceneIntentsComplete": len(complete_scene_intents),
        "directorPlanHasDerivedAssetSection": "衍生资产预划清单" in (script_plan_xml or ""),
    }


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
            index.setdefault(name, item["characterId"])
    for item in extraction.get("scenes", []):
        name = item.get("name")
        if name and item.get("sceneId"):
            index.setdefault(name, item["sceneId"])
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
                "identityAnchors": item.get("identityAnchors"),
                "negativePrompt": item.get("negativePrompt"),
                "views": list(item.get("views") or []),
                "variations": list(item.get("variations") or []),
                "thumbnailUrl": item.get("thumbnailUrl") or "",
            }
    for item in scenes:
        name = item.get("name")
        if name:
            by_name[name] = {
                "kind": "场景",
                "id": item.get("id", ""),
                "desc": item.get("notes") or item.get("atmosphere") or item.get("location") or "剧本策划已抽取场景。",
                "spatialLayout": item.get("spatialLayout") or "",
                "lightingDesign": item.get("lightingDesign") or "",
                "colorPalette": item.get("colorPalette") or "",
                "keyProps": list(item.get("keyProps") or []),
                "viewpoints": list(item.get("viewpoints") or []),
                "viewpointImages": dict(item.get("viewpointImages") or {}),
                "contactSheetImage": item.get("contactSheetImage") or item.get("contactSheetImageUrl") or "",
                "referenceImage": item.get("referenceImage") or "",
            }
    for item in extraction.get("characters", []):
        name = item.get("name")
        if name:
            previous = by_name.get(name, {})
            by_name[name] = {
                **previous,
                "kind": "角色",
                "id": previous.get("id") or item.get("characterId", ""),
                "desc": item.get("note") or previous.get("desc") or "剧本策划已抽取角色。",
                "aliases": unique_nonempty([*(previous.get("aliases") or []), *(item.get("aliases") or [])]),
            }
    for item in extraction.get("scenes", []):
        name = item.get("name")
        if name:
            previous = by_name.get(name, {})
            by_name[name] = {
                **previous,
                "kind": "场景",
                "id": previous.get("id") or item.get("sceneId", ""),
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


def load_project_tts_state(path=TTS_JSON, project_id=None):
    project_id = project_id or PROJECT.name
    document = load_json(path) if Path(path).exists() else {"state": {}, "version": 0}
    if not isinstance(document, dict):
        raise RuntimeError(f"TTS 状态格式非法: {path}")
    state = document.setdefault("state", {})
    if not isinstance(state, dict):
        raise RuntimeError(f"TTS state 格式非法: {path}")
    state["activeProjectId"] = project_id
    projects = state.setdefault("projects", {})
    if not isinstance(projects, dict):
        raise RuntimeError(f"TTS projects 格式非法: {path}")
    project = projects.setdefault(project_id, {"voiceLines": {}, "bindings": {}})
    if not isinstance(project, dict):
        raise RuntimeError(f"TTS project 格式非法: {project_id}")
    project.setdefault("voiceLines", {})
    project.setdefault("bindings", {})
    profiles = state.setdefault("voiceProfiles", {})
    if not isinstance(profiles, dict):
        raise RuntimeError(f"TTS voiceProfiles 格式非法: {path}")
    return document


def resolve_reference_audio_file(audio_path):
    value = str(audio_path or "").strip()
    if not value:
        return None
    if value.startswith("file://"):
        value = urllib.parse.unquote(urllib.parse.urlparse(value).path)
    path = Path(value)
    if not path.is_absolute() or not path.exists() or not path.is_file():
        return None
    try:
        if path.stat().st_size <= 0 or not os.access(path, os.R_OK):
            return None
    except OSError:
        return None
    return str(path)


def validate_fixed_voice_profile(speaker_id, binding, profiles):
    profile_id = str((binding or {}).get("profileId") or "").strip()
    if not profile_id:
        raise RuntimeError(f"固定音色 {speaker_id} 缺少 profileId")
    profile = profiles.get(profile_id)
    if not isinstance(profile, dict):
        raise RuntimeError(f"固定音色 {speaker_id} 缺少 profile {profile_id}")
    reference_audio_path = str(profile.get("referenceAudioPath") or "").strip()
    if not reference_audio_path:
        raise RuntimeError(f"固定音色 {speaker_id} 缺少参考音频路径")
    resolved_audio_path = resolve_reference_audio_file(reference_audio_path)
    if not resolved_audio_path:
        raise RuntimeError(f"固定音色 {speaker_id} 的参考音频不可读: {reference_audio_path}")
    reference_text = str(profile.get("referenceText") or "").strip()
    if not reference_text:
        raise RuntimeError(f"固定音色 {speaker_id} 缺少参考文本")
    return profile_id, profile, resolved_audio_path


def legacy_storyboard_voice_profiles(storyboards, voiceovers):
    voiceover_by_id = {item["storyboardId"]: item for item in voiceovers}
    voiceover_by_index = {item["index"]: item for item in voiceovers}
    imported = {}
    for storyboard in storyboards or []:
        voiceover = voiceover_by_id.get(storyboard.get("id")) or voiceover_by_index.get(storyboard.get("index"))
        if not voiceover:
            continue
        legacy_profile = storyboard.get("voiceProfile")
        has_voice_evidence = bool(
            legacy_profile
            or storyboard.get("voiceProfileId")
            or storyboard.get("voiceReferenceAudioPath")
        )
        if not has_voice_evidence:
            continue
        legacy_profile = legacy_profile if isinstance(legacy_profile, dict) else {}
        profile_id = str(
            legacy_profile.get("id")
            or storyboard.get("voiceProfileId")
            or ""
        ).strip()
        reference_audio_path = str(
            legacy_profile.get("referenceAudioPath")
            or storyboard.get("voiceReferenceAudioPath")
            or ""
        ).strip()
        reference_text = str(
            legacy_profile.get("referenceText")
            or storyboard.get("voiceReferenceText")
            or ""
        ).strip()
        if not profile_id or not reference_audio_path or not reference_text:
            raise RuntimeError(
                f"旧分镜固定音色证据不完整: {voiceover['storyboardId']} / {voiceover['speakerId']}"
            )
        speaker_id = voiceover["speakerId"]
        candidate = {
            "id": profile_id,
            "name": str(legacy_profile.get("name") or storyboard.get("voiceReferenceName") or voiceover["speaker"]),
            "type": "reference",
            "language": "zh",
            "defaultEngine": VOICE_REFERENCE_ENGINE,
            "defaultModelSize": VOICE_REFERENCE_MODEL_SIZE,
            "referenceAudioPath": reference_audio_path,
            "referenceText": reference_text,
            "instruct": str(legacy_profile.get("instruct") or storyboard.get("voiceEmotionProfile") or ""),
            "createdAt": legacy_profile.get("createdAt", 0),
            "updatedAt": legacy_profile.get("updatedAt", 0),
        }
        existing = imported.get(speaker_id)
        if existing and (
            existing["id"] != candidate["id"]
            or existing["referenceAudioPath"] != candidate["referenceAudioPath"]
        ):
            raise RuntimeError(f"旧分镜同一 speaker 存在冲突固定音色: {speaker_id}")
        imported[speaker_id] = candidate
    return imported


def voice_binding_fingerprint(speaker_voice_map):
    rows = [
        {
            "speakerId": speaker_id,
            "profileId": item["profileId"],
            "referenceAudioPath": item["voiceReferenceAudioPath"],
        }
        for speaker_id, item in sorted(speaker_voice_map.items())
    ]
    payload = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def resolve_fixed_voice_bindings(
    tts_document,
    project_id,
    speaker_descriptors,
    audio_rows=None,
    legacy_storyboards=None,
    voiceovers=None,
):
    working = json.loads(json.dumps(tts_document, ensure_ascii=False))
    working = load_project_tts_state_from_document(working, project_id)
    state = working["state"]
    project = state["projects"][project_id]
    bindings = project["bindings"]
    profiles = state["voiceProfiles"]
    imported_profiles = legacy_storyboard_voice_profiles(
        legacy_storyboards or [],
        voiceovers or [],
    )
    now = int(time.time() * 1000)
    fixed = []
    ai_selected = []

    for speaker_id, descriptor in sorted(speaker_descriptors.items()):
        binding = bindings.get(speaker_id)
        if not binding and speaker_id in imported_profiles:
            imported = imported_profiles[speaker_id]
            existing_profile = profiles.get(imported["id"])
            if existing_profile and (
                existing_profile.get("referenceAudioPath") != imported["referenceAudioPath"]
                or existing_profile.get("referenceText") != imported["referenceText"]
            ):
                raise RuntimeError(f"导入旧分镜音色时 profile 冲突: {imported['id']}")
            profiles.setdefault(imported["id"], imported)
            binding = {
                "speakerId": speaker_id,
                "profileId": imported["id"],
                "defaultEngine": VOICE_REFERENCE_ENGINE,
                "defaultModelSize": VOICE_REFERENCE_MODEL_SIZE,
            }
            bindings[speaker_id] = binding

        if binding:
            profile_id, profile, resolved_audio_path = validate_fixed_voice_profile(speaker_id, binding, profiles)
            fixed.append(speaker_id)
            continue

        if audio_rows is None:
            audio_rows = load_audio_rows()
        selected = resolve_voice_profile_for_speaker(descriptor["speaker"], audio_rows)
        resolved_audio_path = resolve_reference_audio_file(selected.get("audioPath"))
        if not resolved_audio_path:
            raise RuntimeError(f"speaker {speaker_id} 选中的参考音频不可读: {selected.get('audioPath')}")
        reference_text = str(selected.get("referenceText") or "").strip()
        if not reference_text:
            raise RuntimeError(f"speaker {speaker_id} 选中的音色缺少参考文本")
        profile_id = f"daojie-{asset_key(speaker_id)}-voice-reference"
        existing_profile = profiles.get(profile_id)
        if existing_profile:
            raise RuntimeError(f"未绑定 speaker {speaker_id} 的目标 profileId 已存在: {profile_id}")
        profile = {
            "id": profile_id,
            "name": selected.get("name") or descriptor["speaker"],
            "type": "reference",
            "language": "zh",
            "defaultEngine": VOICE_REFERENCE_ENGINE,
            "defaultModelSize": VOICE_REFERENCE_MODEL_SIZE,
            "referenceAudioPath": resolved_audio_path,
            "referenceText": reference_text,
            "instruct": selected.get("instruct") or ROLE_VOICE_INSTRUCTIONS.get(descriptor["speaker"], ROLE_VOICE_INSTRUCTIONS["旁白"]),
            "createdAt": now,
            "updatedAt": now,
        }
        profiles[profile_id] = profile
        binding = {
            "speakerId": speaker_id,
            "profileId": profile_id,
            "defaultEngine": VOICE_REFERENCE_ENGINE,
            "defaultModelSize": VOICE_REFERENCE_MODEL_SIZE,
        }
        bindings[speaker_id] = binding
        ai_selected.append(speaker_id)

    speaker_voice_map = {}
    for speaker_id, descriptor in sorted(speaker_descriptors.items()):
        binding = bindings.get(speaker_id)
        profile_id, profile, resolved_audio_path = validate_fixed_voice_profile(speaker_id, binding, profiles)
        match = "ai-selected" if speaker_id in ai_selected else "fixed"
        speaker_voice_map[speaker_id] = {
            "speaker": descriptor["speaker"],
            "profileId": profile_id,
            "voiceReferenceName": profile.get("name") or descriptor["speaker"],
            "voiceReferenceAudioPath": profile["referenceAudioPath"],
            "resolvedVoiceReferenceAudioPath": resolved_audio_path,
            "referenceText": profile["referenceText"],
            "instruct": profile.get("instruct") or "",
            "match": match,
        }

    return {
        "document": working,
        "speakerVoiceMap": speaker_voice_map,
        "voiceBindingFingerprint": voice_binding_fingerprint(speaker_voice_map),
        "fixedVoiceBindings": sorted(fixed),
        "aiSelectedVoiceBindings": sorted(ai_selected),
        "changed": bool(ai_selected or imported_profiles),
    }


def load_project_tts_state_from_document(document, project_id):
    if not isinstance(document, dict):
        raise RuntimeError("TTS 状态格式非法")
    state = document.setdefault("state", {})
    if not isinstance(state, dict):
        raise RuntimeError("TTS state 格式非法")
    state["activeProjectId"] = project_id
    projects = state.setdefault("projects", {})
    if not isinstance(projects, dict):
        raise RuntimeError("TTS projects 格式非法")
    project = projects.setdefault(project_id, {"voiceLines": {}, "bindings": {}})
    project.setdefault("voiceLines", {})
    project.setdefault("bindings", {})
    state.setdefault("voiceProfiles", {})
    return document


def runtime_voice_profile(speaker_id, speaker_voice_map, voice_style=""):
    item = speaker_voice_map[speaker_id]
    return {
        "profileId": item["profileId"],
        "speaker": item["speaker"],
        "name": item["voiceReferenceName"],
        "audioPath": item["resolvedVoiceReferenceAudioPath"],
        "referenceText": item["referenceText"],
        "instruct": " ".join(part for part in [item.get("instruct", ""), voice_style] if part).strip(),
        "matched": item["match"],
    }


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


def paste_centered(canvas, image, box, fill=(245, 240, 232)):
    x0, y0, x1, y1 = box
    width = x1 - x0
    height = y1 - y0
    layer = Image.new("RGB", (width, height), fill)
    item = image.copy().convert("RGB")
    item.thumbnail((width, height), Image.Resampling.LANCZOS)
    layer.paste(item, ((width - item.width) // 2, (height - item.height) // 2))
    canvas.paste(layer, (x0, y0))


def create_character_derived_asset_sheet(parent_image_path, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (1600, 900), (245, 240, 232))
    if parent_image_path and Path(parent_image_path).exists():
        parent = Image.open(parent_image_path).convert("RGB")
    else:
        parent = Image.new("RGB", (320, 760), (224, 218, 206))

    portrait_crop = parent.crop((0, 0, parent.width, max(1, int(parent.height * 0.46))))
    side_view = ImageOps.mirror(parent)
    back_view = ImageOps.grayscale(parent).convert("RGB").filter(ImageFilter.SMOOTH_MORE)
    views = [portrait_crop, parent, side_view, back_view]
    margin = 38
    gap = 24
    panel_width = (1600 - margin * 2 - gap * 3) // 4
    for index, view in enumerate(views):
        x0 = margin + index * (panel_width + gap)
        box = (x0, margin, x0 + panel_width, 900 - margin)
        paste_centered(canvas, view, box)
        draw = ImageDraw.Draw(canvas)
        draw.rectangle(box, outline=(204, 195, 175), width=2)
    canvas.save(output_path, quality=92)
    return str(output_path)


def create_derived_asset_image(parent_image_path, output_path, parent_name, state_name, reason, asset_type="asset"):
    if asset_type == "character":
        return create_character_derived_asset_sheet(parent_image_path, output_path)

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
            result_image = create_derived_asset_image(source_image, derived_dir / f"{ids['id']}.jpg", item["parentAssetId"], item["state"], item["reason"], ids["assetType"])
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
            result_image = create_derived_asset_image(source_image, derived_dir / f"{ids['id']}.jpg", item["parentAssetId"], item["state"], item["reason"], ids["assetType"])
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
            result_image = create_derived_asset_image(source_image, derived_dir / f"{ids['id']}.jpg", item["parentAssetId"], item["state"], item["reason"], ids["assetType"])
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
            "aliases": unique_nonempty([
                asset_name,
                item.get("imageAssetName"),
                item.get("imageAliasOf"),
                *ASSET_IMAGE_ALIASES.get(asset_name, []),
                *DAOJIE_REFERENCE_BINDING_ALIASES.get(asset_name, []),
            ]),
            "identityAnchors": item.get("identityAnchors"),
            "negativePrompt": item.get("negativePrompt"),
            "views": list(item.get("views") or []),
            "variations": list(item.get("variations") or []),
            "spatialLayout": item.get("spatialLayout") or "",
            "lightingDesign": item.get("lightingDesign") or "",
            "colorPalette": item.get("colorPalette") or "",
            "keyProps": list(item.get("keyProps") or []),
            "viewpoints": list(item.get("viewpoints") or []),
            "viewpointImages": dict(item.get("viewpointImages") or {}),
            "contactSheetImage": item.get("contactSheetImage") or "",
        })
    return image_assets


def continuity_group_for_index(index):
    return next(
        (group for group in CHAPTER_CONTINUITY_GROUPS if group["start"] <= index <= group["end"]),
        None,
    )


def character_bible_missing_fields(asset):
    anchors = asset.get("identityAnchors") or {}
    negative = asset.get("negativePrompt") or {}
    view_types = {str(view.get("viewType") or "") for view in asset.get("views") or [] if view.get("imageUrl") or view.get("imageBase64")}
    missing = []
    if not anchors or not isinstance(anchors.get("uniqueMarks"), list):
        missing.append("identityAnchors")
    if not isinstance(negative.get("avoid"), list) or not negative.get("avoid"):
        missing.append("negativePrompt")
    if len(view_types) < 3:
        missing.append("views>=3")
    return missing


def scene_bible_missing_fields(asset, viewpoint_id):
    missing = []
    for field in ("spatialLayout", "lightingDesign", "colorPalette"):
        if not str(asset.get(field) or "").strip():
            missing.append(field)
    viewpoint = next(
        (item for item in asset.get("viewpoints") or [] if item.get("id") == viewpoint_id),
        None,
    )
    if not viewpoint:
        missing.append(f"viewpoint:{viewpoint_id}")
    return missing


def continuity_asset_content_fingerprint(version):
    fields = (
        "assetId", "versionId", "assetKind", "label", "referenceImagePaths", "referenceImageSha256",
        "referenceViewTypes", "identityAnchors", "negativePrompt", "wardrobeVersion",
        "sceneViewpointId", "spatialLayout", "lightingDesign", "colorPalette",
        "validFromStoryboardIndex", "validToStoryboardIndex", "source",
    )
    return stable_json({key: version.get(key) for key in fields if version.get(key) is not None})


def continuity_asset_approval_fingerprint(version, approval):
    fields = (
        "assetId", "versionId", "contentFingerprint", "status", "reviewer",
        "reviewedAt", "reason", "evidencePaths", "reviewEvidenceSha256",
        "reviewEvidenceVerifiedAt",
    )
    values = {
        "assetId": version.get("assetId"),
        "versionId": version.get("versionId"),
        "reviewEvidenceSha256": version.get("reviewEvidenceSha256"),
        "reviewEvidenceVerifiedAt": version.get("reviewEvidenceVerifiedAt"),
        **approval,
    }
    return stable_json({key: values.get(key) for key in fields if values.get(key) is not None})


def continuity_asset_structurally_complete(version):
    reference_paths = [str(path).strip() for path in version.get("referenceImagePaths") or [] if str(path).strip()]
    reference_hashes = [str(value).strip().lower() for value in version.get("referenceImageSha256") or [] if str(value).strip()]
    if not all(str(version.get(field) or "").strip() for field in ("assetId", "versionId", "label", "source")):
        return False
    if not reference_paths or version.get("missingFields"):
        return False
    if reference_hashes and (
        len(reference_hashes) != len(reference_paths)
        or any(not re.fullmatch(r"[a-f0-9]{64}", value) for value in reference_hashes)
    ):
        return False
    if version.get("assetKind") == "character":
        anchors = version.get("identityAnchors") or {}
        negative = version.get("negativePrompt") or {}
        view_types = version.get("referenceViewTypes") or []
        return bool(
            str(version.get("wardrobeVersion") or "").strip()
            and isinstance(anchors.get("uniqueMarks"), list)
            and negative.get("avoid")
            and len(view_types) >= 3
            and len(view_types) == len(reference_paths)
        )
    if version.get("assetKind") == "scene":
        return all(
            str(version.get(field) or "").strip()
            for field in ("sceneViewpointId", "spatialLayout", "lightingDesign", "colorPalette")
        )
    return True


def continuity_asset_review_evidence_is_verified(version):
    verified_at = version.get("reviewEvidenceVerifiedAt")
    paths = [str(path).strip() for path in version.get("reviewEvidencePaths") or [] if str(path).strip()]
    hashes = [str(value).strip().lower() for value in version.get("reviewEvidenceSha256") or [] if str(value).strip()]
    if not isinstance(verified_at, int) or isinstance(verified_at, bool) or verified_at <= 0:
        return False
    if len(paths) != len(version.get("referenceImagePaths") or []) or len(hashes) != len(paths):
        return False
    for raw_path, expected_hash in zip(paths, hashes, strict=True):
        path = Path(raw_path).expanduser()
        if (
            not path.is_absolute()
            or not path.is_file()
            or not path.name.lower().endswith("_thumb.png")
            or path.stat().st_size <= 0
            or path.stat().st_size >= IMAGE_TRANSFER_MAX_BYTES
            or not re.fullmatch(r"[a-f0-9]{64}", expected_hash)
            or file_sha256(path) != expected_hash
        ):
            return False
        try:
            with Image.open(path) as image:
                image.load()
                if image.format != "PNG" or min(image.size) <= 0 or max(image.size) > IMAGE_TRANSFER_TARGET_MAX_EDGE:
                    return False
        except (OSError, ValueError):
            return False
    return True


def normalize_continuity_asset_version(version):
    normalized = json.loads(json.dumps(version))
    normalized["referenceImagePaths"] = [
        str(path).strip() for path in normalized.get("referenceImagePaths") or [] if str(path).strip()
    ]
    normalized["referenceImageSha256"] = [
        str(value).strip().lower()
        for value in normalized.get("referenceImageSha256") or []
        if str(value).strip()
    ] or None
    normalized["reviewEvidencePaths"] = [
        str(path).strip() for path in normalized.get("reviewEvidencePaths") or [] if str(path).strip()
    ] or None
    normalized["reviewEvidenceSha256"] = [
        str(value).strip().lower()
        for value in normalized.get("reviewEvidenceSha256") or []
        if str(value).strip()
    ] or None
    normalized["structurallyComplete"] = continuity_asset_structurally_complete(normalized)
    normalized["contentFingerprint"] = continuity_asset_content_fingerprint(normalized)
    approval = normalized.get("approval") or {}
    approval_evidence_paths = [
        str(path).strip() for path in approval.get("evidencePaths") or [] if str(path).strip()
    ]
    registered_evidence_paths = normalized.get("reviewEvidencePaths") or []
    registered_evidence_hashes = normalized.get("reviewEvidenceSha256") or []
    evidence_is_registered_and_safe = bool(
        len(registered_evidence_paths) == len(normalized["referenceImagePaths"])
        and all(path.lower().endswith("_thumb.png") for path in registered_evidence_paths)
        and approval_evidence_paths == registered_evidence_paths
        and len(registered_evidence_hashes) == len(registered_evidence_paths)
        and all(re.fullmatch(r"[a-f0-9]{64}", value) for value in registered_evidence_hashes)
        and continuity_asset_review_evidence_is_verified(normalized)
    )
    normalized["approved"] = bool(
        normalized["structurallyComplete"]
        and approval.get("status") == "approved"
        and approval.get("reviewer") == "human"
        and int(approval.get("reviewedAt") or 0) > 0
        and evidence_is_registered_and_safe
        and approval.get("contentFingerprint") == normalized["contentFingerprint"]
        and normalized.get("approvalFingerprint") == continuity_asset_approval_fingerprint(normalized, approval)
    )
    return normalized


def preserve_valid_continuity_asset_approval(version, existing_version):
    current = normalize_continuity_asset_version(version)
    existing = normalize_continuity_asset_version(existing_version or {}) if existing_version else None
    if not existing or not existing.get("approved"):
        return current
    if existing.get("contentFingerprint") != current.get("contentFingerprint"):
        return current
    current["approval"] = existing.get("approval")
    current["approvalFingerprint"] = existing.get("approvalFingerprint")
    return normalize_continuity_asset_version(current)


def reference_image_sha256(paths):
    resolved = [Path(str(path)) for path in paths]
    if not resolved or not all(path.is_file() for path in resolved):
        return None
    return [file_sha256(path) for path in resolved]


def build_continuity_asset_version(asset, viewpoint_id=""):
    asset_type = image_workflow_asset_type(asset.get("kind", ""))
    asset_id = asset.get("assetId") or asset.get("name") or ""
    if asset_type == "character":
        wardrobe = {
            "独孤剑尘": "grey-town",
            "监工赵四": "dock-overseer",
            "小杂役": "dock-ragged",
        }.get(asset.get("name"), "chapter-001-base")
        version_id = f"{asset_id}:{wardrobe}:v1"
        missing = character_bible_missing_fields(asset)
        view_order = {"front": 0, "three-quarter": 1, "side": 2, "back": 3}
        views = sorted(
            (
                {
                    "viewType": str(view.get("viewType") or ""),
                    "imagePath": view.get("imageUrl") or view.get("imageBase64") or "",
                }
                for view in asset.get("views") or []
                if (view.get("imageUrl") or view.get("imageBase64"))
                and str(view.get("viewType") or "") in view_order
            ),
            key=lambda item: view_order[item["viewType"]],
        )
        reference_paths = [item["imagePath"] for item in views] or [asset["imagePath"]]
        reference_view_types = [item["viewType"] for item in views]
        return normalize_continuity_asset_version({
            "assetId": asset_id,
            "versionId": version_id,
            "assetKind": asset_type,
            "label": wardrobe,
            "referenceImagePaths": reference_paths,
            "referenceImageSha256": reference_image_sha256(reference_paths),
            "referenceViewTypes": reference_view_types,
            "identityAnchors": asset.get("identityAnchors"),
            "negativePrompt": asset.get("negativePrompt"),
            "wardrobeVersion": wardrobe,
            "missingFields": missing,
            "source": "project-character-bible",
        })
    if asset_type == "scene":
        version_id = f"{asset_id}:{viewpoint_id}:v1"
        missing = scene_bible_missing_fields(asset, viewpoint_id)
        return normalize_continuity_asset_version({
            "assetId": asset_id,
            "versionId": version_id,
            "assetKind": asset_type,
            "label": viewpoint_id,
            "referenceImagePaths": [asset["imagePath"]],
            "referenceImageSha256": reference_image_sha256([asset["imagePath"]]),
            "sceneViewpointId": viewpoint_id,
            "spatialLayout": asset.get("spatialLayout") or "",
            "lightingDesign": asset.get("lightingDesign") or "",
            "colorPalette": asset.get("colorPalette") or "",
            "missingFields": missing,
            "source": "project-scene-bible",
        })
    return normalize_continuity_asset_version({
        "assetId": asset_id,
        "versionId": f"{asset_id}:base:v1",
        "assetKind": "prop",
        "label": "chapter-001-base",
        "referenceImagePaths": [asset["imagePath"]],
        "referenceImageSha256": reference_image_sha256([asset["imagePath"]]),
        "missingFields": [],
        "source": "project-prop-library",
    })


def build_ordered_continuity_manifest(image_assets, viewpoint_id, primary_scene_name=""):
    manifest = []
    versions = []
    for order, asset in enumerate(image_assets, 1):
        asset_kind = image_workflow_asset_type(asset.get("kind", ""))
        asset_viewpoint_id = ""
        if asset_kind == "scene":
            if not primary_scene_name or asset.get("name") == primary_scene_name:
                asset_viewpoint_id = viewpoint_id
            else:
                asset_viewpoint_id = str(next(
                    (item.get("id") for item in asset.get("viewpoints") or [] if item.get("id")),
                    viewpoint_id,
                ))
        version = build_continuity_asset_version(asset, asset_viewpoint_id)
        versions.append(version)
        is_primary_scene = version["assetKind"] == "scene" and (
            not primary_scene_name or asset.get("name") == primary_scene_name
        )
        manifest.append({
            "order": order,
            "assetId": version["assetId"],
            "assetName": asset.get("name") or "",
            "assetKind": version["assetKind"],
            "imagePath": asset.get("imagePath") or "",
            "referenceImagePaths": version.get("referenceImagePaths") or [],
            "referenceImageSha256": version.get("referenceImageSha256") or [],
            "referenceViewTypes": version.get("referenceViewTypes") or [],
            "source": version["source"],
            "versionId": version["versionId"],
            "referenceRole": "scene-viewpoint" if is_primary_scene else "secondary-scene" if version["assetKind"] == "scene" else "canonical" if version["assetKind"] == "character" else "prop-state",
            "identityAnchors": version.get("identityAnchors"),
            "negativePrompt": version.get("negativePrompt"),
            "wardrobeVersion": version.get("wardrobeVersion"),
            "sceneViewpointId": version.get("sceneViewpointId"),
            "contentFingerprint": version["contentFingerprint"],
            "approvalFingerprint": version.get("approvalFingerprint"),
            "approved": version["approved"],
        })
    return manifest, versions


def apply_continuity_manifest_to_image_assets(image_assets, manifest):
    """Expand one stable asset version into its ordered provider references."""
    manifest_by_order = {int(item["order"]): item for item in manifest}
    expanded = []
    for order, asset in enumerate(image_assets, 1):
        item = manifest_by_order.get(order)
        if item is None:
            raise RuntimeError(f"连续性清单缺少第 {order} 个资产: {asset.get('name') or asset.get('assetId')}")
        paths = list(item.get("referenceImagePaths") or [item.get("imagePath") or asset.get("imagePath") or ""])
        paths = [path for path in paths if path]
        view_types = list(item.get("referenceViewTypes") or [])
        if view_types and len(view_types) != len(paths):
            raise RuntimeError(f"连续性资产 {item.get('assetId')} 的参考图与角色视图数量不一致")
        for reference_index, path in enumerate(paths):
            expanded.append({
                **asset,
                "imagePath": path,
                "versionId": item.get("versionId"),
                "referenceRole": item.get("referenceRole"),
                "identityAnchors": item.get("identityAnchors"),
                "negativePrompt": item.get("negativePrompt"),
                "wardrobeVersion": item.get("wardrobeVersion"),
                "characterViewType": view_types[reference_index] if view_types else None,
                "sceneViewpointId": item.get("sceneViewpointId"),
            })
    for item in manifest:
        if item.get("referenceRole") != "previous-approved-frame":
            continue
        paths = list(item.get("referenceImagePaths") or [item.get("imagePath") or ""])
        for path in (value for value in paths if value):
            expanded.append({
                "name": item.get("assetName") or "上一镜人工批准成图",
                "kind": "asset",
                "assetId": item.get("assetId"),
                "imagePath": path,
                "versionId": item.get("versionId"),
                "referenceRole": "previous-approved-frame",
            })
    return expanded


def stable_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build_shot_continuity_prompt(state):
    character_parts = [
        (
            f"{item['characterId']}使用{item['versionId']}，位置{item['position']}，朝向{item['orientation']}，"
            f"承接动作{item['actionIn']}，镜尾动作{item['actionOut']}"
        )
        for item in state.get("characters") or []
    ]
    return " ".join(part for part in [
        f"【连续镜头组】{state['groupId']}",
        f"承接上一镜{state['previousStoryboardId']}" if state.get("previousStoryboardId") else "本组首镜",
        f"【场景锁】{state['sceneVersionId']}/{state['sceneViewpointId']}，{state['lighting']}，{state['palette']}",
        f"【动作承接】{state['actionIn']}；镜尾：{state['actionOut']}",
        f"【人物状态】{'；'.join(character_parts)}" if character_parts else "",
        (
            f"【出镜人数锁】本镜出镜角色总数：{len(character_parts)}；每个连续性角色版本各出现 1 次。"
            f"前景、中景、远景和背景合计只能出现上述 {len(character_parts)} 个角色实例；"
            "不得出现路人、工人、剪影、倒影或模糊人影。禁止重复、克隆或因多视图参考新增人物。"
        ),
    ] if part)


def build_visual_continuity_fingerprint(prompt, manifest, state):
    reference_rows = []
    for reference in sorted(manifest, key=lambda item: item["order"]):
        row = {
            "order": reference["order"],
            "assetId": reference["assetId"],
            "versionId": reference.get("versionId"),
            "imagePath": reference.get("imagePath"),
            "referenceImagePaths": reference.get("referenceImagePaths"),
            "referenceImageSha256": reference.get("referenceImageSha256"),
            "referenceViewTypes": reference.get("referenceViewTypes"),
            "referenceRole": reference.get("referenceRole"),
            "wardrobeVersion": reference.get("wardrobeVersion"),
            "sceneViewpointId": reference.get("sceneViewpointId"),
            "contentFingerprint": reference.get("contentFingerprint"),
        }
        reference_rows.append({key: value for key, value in row.items() if value is not None})
    continuity = {key: value for key, value in state.items() if key != "inputFingerprint" and value is not None}
    return stable_json({
        "prompt": prompt,
        "references": reference_rows,
        "continuity": continuity,
    })


def build_sample_shot_continuity_state(index, prompt, image_assets, manifest):
    group = continuity_group_for_index(index)
    override = SAMPLE_SHOT_CONTINUITY.get(index)
    if not group or not override:
        raise RuntimeError(f"分镜 {index:03d} 缺少显式连续性编排")
    versions_by_name = {
        asset.get("name"): build_continuity_asset_version(
            asset,
            group["viewpointId"] if image_workflow_asset_type(asset.get("kind", "")) == "scene" else "",
        )
        for asset in image_assets
    }
    scene_version = versions_by_name.get(group["sceneName"])
    if not scene_version:
        raise RuntimeError(f"分镜 {index:03d} 缺少主场景连续版本: {group['sceneName']}")
    characters = []
    for character_name, blocking in override["characters"].items():
        version = versions_by_name.get(character_name)
        if not version:
            raise RuntimeError(f"分镜 {index:03d} 缺少可见角色连续版本: {character_name}")
        characters.append({
            "characterId": version["assetId"],
            "versionId": version["versionId"],
            "position": blocking["position"],
            "orientation": blocking["orientation"],
            "actionIn": override["actionIn"],
            "actionOut": override["actionOut"],
        })
    state = {
        "groupId": group["groupId"],
        "previousStoryboardId": f"sb-{EPISODE_ID}-{index - 1:03d}" if index > group["start"] else None,
        "sceneVersionId": scene_version["versionId"],
        "sceneViewpointId": group["viewpointId"],
        "lighting": next((asset.get("lightingDesign") for asset in image_assets if asset.get("name") == group["sceneName"]), "") or storyboard_light_prompt({"index": index}),
        "palette": next((asset.get("colorPalette") for asset in image_assets if asset.get("name") == group["sceneName"]), "") or "墨青、灰蓝、米白、浅褐，旧金与朱红只作焦点",
        "actionIn": override["actionIn"],
        "actionOut": override["actionOut"],
        "characters": characters,
        "inputFingerprint": "",
    }
    state["inputFingerprint"] = build_visual_continuity_fingerprint(prompt, manifest, state)
    return state


def build_default_shot_continuity_state(index, prompt, image_assets, manifest):
    group = continuity_group_for_index(index)
    if not group:
        raise RuntimeError(f"分镜 {index:03d} 缺少连续镜头组")
    scene_reference = next(
        (item for item in manifest if item.get("referenceRole") == "scene-viewpoint"),
        manifest[0] if manifest else None,
    )
    if not scene_reference:
        raise RuntimeError(f"分镜 {index:03d} 缺少场景连续版本")
    scene_asset = next(
        (asset for asset in image_assets if asset.get("assetId") == scene_reference.get("assetId")),
        {},
    )
    characters = [
        {
            "characterId": item["assetId"],
            "versionId": item["versionId"],
            "position": "按本镜构图锁定",
            "orientation": "按本镜画面朝向锁定",
            "actionIn": prompt,
            "actionOut": prompt,
        }
        for item in manifest
        if item.get("assetKind") == "character"
    ]
    state = {
        "groupId": group["groupId"],
        "previousStoryboardId": f"sb-{EPISODE_ID}-{index - 1:03d}" if index > group["start"] else None,
        "sceneVersionId": scene_reference["versionId"],
        "sceneViewpointId": scene_reference.get("sceneViewpointId") or group["viewpointId"],
        "lighting": scene_asset.get("lightingDesign") or storyboard_light_prompt({"index": index}),
        "palette": scene_asset.get("colorPalette") or "墨青、灰蓝、米白、浅褐，旧金与朱红只作焦点",
        "actionIn": prompt,
        "actionOut": prompt,
        "characters": characters,
        "inputFingerprint": "",
    }
    if state["previousStoryboardId"] is None:
        state.pop("previousStoryboardId")
    state["inputFingerprint"] = build_visual_continuity_fingerprint(prompt, manifest, state)
    return state


def build_storyboard_continuity_payload(index, prompt, image_assets, existing_storyboard=None):
    group = continuity_group_for_index(index)
    if not group:
        raise RuntimeError(f"分镜 {index:03d} 缺少连续镜头组")
    manifest, versions = build_ordered_continuity_manifest(
        image_assets,
        group["viewpointId"],
        group["sceneName"],
    )
    if index in SAMPLE_SHOT_CONTINUITY:
        state = build_sample_shot_continuity_state(index, prompt, image_assets, manifest)
    else:
        existing_state = json.loads(json.dumps((existing_storyboard or {}).get("continuityState") or {}))
        if existing_state:
            scene_reference = next(
                (
                    item for item in manifest
                    if item.get("assetKind") == "scene" and item.get("assetName") == group["sceneName"]
                ),
                None,
            )
            if not scene_reference:
                raise RuntimeError(f"分镜 {index:03d} 缺少主场景连续版本: {group['sceneName']}")
            scene_asset = next(
                (asset for asset in image_assets if asset.get("assetId") == scene_reference.get("assetId")),
                {},
            )
            existing_state["groupId"] = group["groupId"]
            existing_state["sceneVersionId"] = scene_reference["versionId"]
            existing_state["sceneViewpointId"] = scene_reference.get("sceneViewpointId") or group["viewpointId"]
            existing_state["lighting"] = scene_asset.get("lightingDesign") or storyboard_light_prompt({"index": index})
            existing_state["palette"] = scene_asset.get("colorPalette") or "墨青、灰蓝、米白、浅褐，旧金与朱红只作焦点"
            if index > group["start"]:
                existing_state["previousStoryboardId"] = f"sb-{EPISODE_ID}-{index - 1:03d}"
            else:
                existing_state.pop("previousStoryboardId", None)
            existing_state["inputFingerprint"] = build_visual_continuity_fingerprint(prompt, manifest, existing_state)
            state = existing_state
        else:
            state = build_default_shot_continuity_state(index, prompt, image_assets, manifest)
    return manifest, versions, state


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
    director_plan_audit,
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
            "<scriptPlan>" in script_plan_xml
            and director_plan_audit.get("directorPlanChars", 0) >= 4500
            and director_plan_audit.get("directorPlanChineseChars", 0) >= 2500
            and director_plan_audit.get("directorPlanH2Sections", 0) >= 6
            and director_plan_audit.get("directorPlanSceneSections", 0) == 5
            and director_plan_audit.get("directorPlanStructuredSceneIntentsComplete", 0) == 5,
            (
                f"chars={director_plan_audit.get('directorPlanChars', len(script_plan_xml))}, "
                f"chinese={director_plan_audit.get('directorPlanChineseChars', 0)}, "
                f"h2={director_plan_audit.get('directorPlanH2Sections', 0)}, "
                f"scenes={director_plan_audit.get('directorPlanSceneSections', 0)}, "
                f"structuredScenes={director_plan_audit.get('directorPlanStructuredSceneIntentsComplete', 0)}"
            ),
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
            len(production_tracks) > 0
            and len(video_candidates) == len(production_tracks) + 1,
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
            not SKIP_PROJECT_WRITE and STORE.exists() and SCRIPT_JSON.exists() and TTS_JSON.exists(),
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
    existing_storyboards_by_id = {
        str(item.get("id")): item
        for item in state.get("storyboards", [])
        if item.get("episodeId") == EPISODE_ID and item.get("id")
    }
    existing_continuity_versions_by_key = {
        f"{item.get('assetId', '')}:{item.get('versionId', '')}": item
        for item in state.get("continuityAssetVersions", [])
        if item.get("assetId") and item.get("versionId")
    }
    asset_index = build_asset_index(state)
    asset_catalog = build_asset_catalog(state)
    script_text = latest_script(state)
    storyboard_source = resolve_storyboard_source(state, EPISODE_ID)
    shots = storyboard_source["shots"]
    identities = episode_character_identities(state, EPISODE_ID)
    voiceovers = build_storyboard_voiceovers(shots, identities, EPISODE_ID)
    source_units = [item["ttsSpokenText"] for item in voiceovers]
    source_segment_count = len(shots)
    source_dialogue_chars = sum(len(normalize_dialogue_text(unit)) for unit in source_units)
    spoken_text_chars = sum(len(normalize_dialogue_text(item["ttsSpokenText"])) for item in voiceovers)
    dialogue_coverage_ratio = min(1.0, spoken_text_chars / source_dialogue_chars) if source_dialogue_chars else 1.0
    if dialogue_coverage_ratio < MIN_DIALOGUE_COVERAGE_RATIO:
        raise RuntimeError(f"台词覆盖率过低: {dialogue_coverage_ratio:.3f} / {MIN_DIALOGUE_COVERAGE_RATIO}")
    speaker_descriptors = {
        item["speakerId"]: {"speaker": item["speaker"]}
        for item in voiceovers
    }
    tts_document = load_project_tts_state(TTS_JSON, PROJECT.name)
    fixed_voice_plan = resolve_fixed_voice_bindings(
        tts_document,
        PROJECT.name,
        speaker_descriptors,
        None,
        legacy_storyboards=[
            storyboard
            for storyboard in state.get("storyboards", [])
            if storyboard.get("episodeId") == EPISODE_ID
        ],
        voiceovers=voiceovers,
    )
    if not SKIP_PROJECT_WRITE:
        save_json(TTS_JSON, fixed_voice_plan["document"])
    speaker_voice_map = fixed_voice_plan["speakerVoiceMap"]
    script_plan_xml = build_script_plan(shots)
    structured_script_plan = build_structured_script_plan()
    director_plan_audit = audit_director_plan(script_plan_xml, structured_script_plan)
    storyboard_table = storyboard_source["data"] or build_storyboard_table(asset_index, shots)

    frame_paths = []
    audio_paths = []
    segment_paths = []
    storyboards = []
    tts_modes = set()
    tts_backends = set()
    tts_mocked_values = set()
    tts_warnings = []
    speaker_audio_stats = {
        speaker_id: {"lines": 0, "audioFiles": 0, "chars": 0}
        for speaker_id in speaker_descriptors
    }
    speaker_audio_samples = {}
    frame_path_by_storyboard = {}
    audio_path_by_storyboard = {}
    segment_path_by_storyboard = {}
    used_image_paths = set()
    missing_image_assets = set()
    storyboard_image_workflows = []
    storyboard_prompt_manifest = []
    storyboard_image_results = []
    continuity_versions_by_key = {}
    try:
        for index, shot in enumerate(shots, 1):
            scene, desc, speaker, text, sound, assets, duration = shot_tuple(shot)
            voiceover = voiceovers[index - 1]
            scene_no = shot.get("sceneNo", 1)
            frame = FRAMES / f"shot-{index:03d}.png"
            audio = AUDIO / f"shot-{index:03d}.wav"
            segment = SEGMENTS / f"shot-{index:03d}.mp4"
            storyboard_id = voiceover["storyboardId"]
            track_key = shot.get("trackKey") or track_key_for(index, scene_no)
            asset_ids = shot.get("assetIds") or resolve_asset_ids(scene, assets, asset_index)
            associate_assets = [scene, *assets]
            image_assets = resolve_image_assets(scene, assets, asset_catalog)
            if not image_assets:
                raise RuntimeError(f"分镜 {index:02d} 没有可用真实资产图片: {scene} / {', '.join(assets)}")
            existing_storyboard = existing_storyboards_by_id.get(storyboard_id, {})
            approved_reuse = approved_storyboard_reuse_input(existing_storyboard)
            if approved_reuse:
                continuity_manifest = approved_reuse["referenceManifest"]
                continuity_state = approved_reuse["continuityState"]
                _continuity_versions = []
                seen_version_keys = set()
                for reference in continuity_manifest:
                    if reference.get("referenceRole") == "previous-approved-frame":
                        continue
                    key = f"{reference.get('assetId', '')}:{reference.get('versionId', '')}"
                    version = existing_continuity_versions_by_key.get(key)
                    if not version:
                        raise RuntimeError(f"分镜 {index:03d} 人工批准清单缺少资产版本: {key}")
                    if key not in seen_version_keys:
                        _continuity_versions.append(version)
                        seen_version_keys.add(key)
            else:
                continuity_manifest, _continuity_versions, continuity_state = build_storyboard_continuity_payload(
                    index,
                    desc,
                    image_assets,
                    existing_storyboard,
                )
            for version in _continuity_versions:
                key = f"{version['assetId']}:{version['versionId']}"
                merged_version = preserve_valid_continuity_asset_approval(
                    version,
                    existing_continuity_versions_by_key.get(key),
                )
                previous_version = continuity_versions_by_key.get(key)
                if previous_version and previous_version["contentFingerprint"] != merged_version["contentFingerprint"]:
                    raise RuntimeError(f"连续性资产版本内容冲突: {key}")
                continuity_versions_by_key[key] = merged_version
            for reference in continuity_manifest:
                if reference.get("referenceRole") == "previous-approved-frame":
                    previous_path = Path(str(reference.get("imagePath") or ""))
                    previous_hashes = [
                        str(value).lower()
                        for value in reference.get("referenceImageSha256") or []
                        if str(value).strip()
                    ]
                    previous_resolved = None
                    if (
                        reference.get("approved") is not True
                        or not reference.get("approvalFingerprint")
                        or len(previous_hashes) != 1
                        or not re.fullmatch(r"[a-f0-9]{64}", previous_hashes[0])
                    ):
                        raise RuntimeError(f"分镜 {index:03d} 上一镜人工批准参考已失效")
                    try:
                        previous_resolved = previous_path.resolve(strict=True)
                        approved_root = (PROJECT / "workflow-images/storyboards" / EPISODE_ID / "approved-revisions").resolve()
                        previous_resolved.relative_to(approved_root)
                    except (OSError, ValueError):
                        raise RuntimeError(f"分镜 {index:03d} 上一镜人工批准参考路径越界: {previous_path}")
                    if (
                        previous_resolved is None
                        or not re.fullmatch(r"shot-\d{3}-[a-f0-9]{12}\.png", previous_resolved.name, re.IGNORECASE)
                        or file_sha256(previous_resolved) != previous_hashes[0]
                        or reference.get("contentFingerprint") != previous_hashes[0]
                    ):
                        raise RuntimeError(f"分镜 {index:03d} 上一镜人工批准参考内容指纹已失效")
                    continue
                key = f"{reference['assetId']}:{reference.get('versionId', '')}"
                version = continuity_versions_by_key[key]
                reference["contentFingerprint"] = version["contentFingerprint"]
                reference["approvalFingerprint"] = version.get("approvalFingerprint")
                reference["approved"] = version["approved"]
            continuity_fingerprint = build_visual_continuity_fingerprint(
                desc,
                continuity_manifest,
                continuity_state,
            )
            if approved_reuse and continuity_state.get("inputFingerprint") != continuity_fingerprint:
                raise RuntimeError(f"分镜 {index:03d} 人工批准连续性输入指纹已失效")
            continuity_state["inputFingerprint"] = continuity_fingerprint
            if is_real_storyboard_image_mode():
                unapproved = [
                    f"{item['assetId']}:{item.get('versionId', '')}"
                    for item in continuity_manifest
                    if item.get("referenceRole") != "previous-approved-frame" and item.get("approved") is not True
                ]
                if unapproved:
                    raise RuntimeError(
                        f"分镜 {index:03d} 引用资产尚未通过有效人工批准: {', '.join(unapproved)}"
                    )
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
                    {"id": storyboard_id, "index": index, "sceneNo": scene_no, "prompt": desc},
                    desc,
                    image_assets,
                    storyboard_image_config,
                    continuity_manifest,
                    continuity_state,
                    approved_reuse,
                )
                storyboard_image_workflows.append(storyboard_image_result["workflowGraph"])
                storyboard_prompt_manifest.append(storyboard_image_result["promptAudit"])
                storyboard_image_results.append(storyboard_image_result)
            else:
                storyboard_references = collect_storyboard_reference_images(image_assets)
                final_storyboard_prompt = build_storyboard_image_prompt(
                    {"id": storyboard_id, "index": index, "sceneNo": scene_no, "prompt": desc},
                    storyboard_references,
                )
                prompt_audit = build_storyboard_prompt_audit(
                    {"id": storyboard_id, "index": index},
                    final_storyboard_prompt,
                    storyboard_references,
                    desc,
                )
                assert_storyboard_prompt_audit(prompt_audit)
                storyboard_prompt_manifest.append(prompt_audit)
                create_frame(frame, index, scene, desc, speaker, text, sound, assets, asset_ids, asset_catalog, image_assets)
            voice_profile = runtime_voice_profile(
                voiceover["speakerId"],
                speaker_voice_map,
                voiceover["voiceStyle"],
            )
            tts_result = create_audio(
                audio,
                speaker,
                voiceover["ttsSpokenText"],
                voice_profile,
                41001 + index,
            )
            tts_modes.add(tts_result["mode"])
            tts_backends.add(tts_result.get("backend") or "")
            tts_mocked_values.add(bool(tts_result.get("mocked")))
            if tts_result.get("warning"):
                tts_warnings.append(f"{index:03d}: {tts_result['warning']}")
            spoken_text = spoken_text_for(speaker, voiceover["ttsSpokenText"])
            speaker_id = voiceover["speakerId"]
            speaker_audio_stats[speaker_id]["lines"] += 1
            speaker_audio_stats[speaker_id]["audioFiles"] += 1
            speaker_audio_stats[speaker_id]["chars"] += len(normalize_dialogue_text(spoken_text))
            if speaker_id not in speaker_audio_samples:
                sample = audio_sample_info(audio)
                if not SILENT_PREVIEW and (sample["meanVolumeDb"] is None or sample["meanVolumeDb"] < MIN_AUDIO_MEAN_VOLUME_DB):
                    raise RuntimeError(f"角色音频样本音量过低: {speaker_id} / {sample}")
                speaker_audio_samples[speaker_id] = sample
            actual_duration = max(
                MIN_SHOT_DURATION,
                voiceover["durationTarget"],
                audio_duration(audio) + 0.4,
            )
            render_segment(index, frame, audio, segment, actual_duration)
            frame_paths.append(frame)
            audio_paths.append(audio)
            segment_paths.append(segment)
            frame_path_by_storyboard[storyboard_id] = frame
            audio_path_by_storyboard[storyboard_id] = audio
            segment_path_by_storyboard[storyboard_id] = segment
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
                    "orderedReferenceManifest": storyboard_image_result["orderedReferenceManifest"],
                    "continuityState": storyboard_image_result["continuityState"],
                }
                existing_review = existing_storyboards_by_id.get(storyboard_id, {}).get("visualReview")
                if storyboard_image_result["reusedExistingImage"] and existing_review:
                    storyboard_patch["visualReview"] = existing_review
                else:
                    storyboard_patch["visualReview"] = {
                        "status": "pending",
                        "reasons": ["新分镜图等待逐镜视觉复核"],
                        "characterChecks": [
                            {"characterId": item["characterId"], "passed": False}
                            for item in continuity_state.get("characters", [])
                        ],
                        "sceneChecks": [
                            {"sceneVersionId": continuity_state["sceneVersionId"], "passed": False}
                        ],
                        "propChecks": [
                            {
                                "assetId": item["assetId"],
                                "versionId": item.get("versionId"),
                                "passed": False,
                            }
                            for item in continuity_manifest
                            if item.get("referenceRole") == "prop-state"
                        ],
                        "transitionChecks": [
                            {
                                "previousStoryboardId": continuity_state.get("previousStoryboardId"),
                                "passed": False,
                            }
                        ],
                        "textWatermarkCheck": {"passed": False},
                        "reviewer": "automated",
                        "reviewedAt": int(time.time() * 1000),
                        "evidencePaths": [media_ref["path"]],
                        "inputFingerprint": "",
                    }
            storyboards.append({
                "id": storyboard_id,
                "episodeId": EPISODE_ID,
                "index": index,
                "trackKey": track_key,
                "trackId": "",
                "duration": round(voiceover["durationTarget"], 2),
                "renderDuration": round(actual_duration, 2),
                "prompt": desc,
                "videoDesc": shot.get("action") or desc,
                "speaker": speaker,
                "speakerId": speaker_id,
                "line": voiceover["line"],
                "ttsSpokenText": spoken_text,
                "durationTarget": voiceover["durationTarget"],
                "voiceStyle": voiceover["voiceStyle"],
                "requiresFixedVoice": True,
                "assetIds": asset_ids,
                "mediaRef": media_ref,
                "audioRef": {"kind": "audio", "path": str(audio)},
                "voiceReferenceAudioPath": voice_profile["audioPath"],
                "voiceReferenceName": voice_profile["name"],
                "voiceReferenceText": voice_profile["referenceText"],
                "voiceEmotionProfile": voice_profile["instruct"],
                "voiceMatch": speaker_voice_map[speaker_id]["match"],
                "voiceProfile": {
                    "id": voice_profile["profileId"],
                    "name": voice_profile["name"],
                    "referenceAudioPath": voice_profile["audioPath"],
                    "referenceText": voice_profile["referenceText"],
                    "instruct": voice_profile["instruct"],
                },
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
                "emotion": shot.get("emotion") or emotion_for(index, scene_no),
                "orientation": shot.get("orientation") or "—",
                "spatialRelation": shot.get("spatialRelation") or "—",
                "associateAssetsNames": associate_assets,
                "lines": f"{speaker}：{text}" if speaker != "旁白" else f"旁白：{text}",
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
    track_keys = []
    for storyboard in storyboards:
        if storyboard["trackKey"] not in track_keys:
            track_keys.append(storyboard["trackKey"])
    for scene_no, track_key in enumerate(track_keys, 1):
        ids = [sb["id"] for sb in storyboards if sb["trackKey"] == track_key]
        duration = sum(sb["duration"] for sb in storyboards if sb["id"] in ids)
        track_id = f"track-chapter-001-scene-{scene_no}"
        candidate_id = f"video-chapter-001-scene-{scene_no}"
        scene_segments = [
            str(segment_path_by_storyboard[sb["id"]])
            for sb in storyboards
            if sb["trackKey"] == track_key
        ]
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
    state["scriptPlans"].append(structured_script_plan)

    now = 1780300001000
    state["agentWorkData"] = [
        w for w in state.get("agentWorkData", [])
        if not (
            w.get("episodeId") == EPISODE_ID
            and w.get("key") in {"directorPlan", "storyboardPanel", "storyboardImage", "productionPlan"}
        )
    ]
    generated_work = [
        {"id": "work-chapter-001-director-plan", "key": "directorPlan", "episodeId": EPISODE_ID, "data": script_plan_xml, "createdAt": now, "updatedAt": now},
        {"id": "work-chapter-001-storyboard-panel", "key": "storyboardPanel", "episodeId": EPISODE_ID, "data": f"已写入 {len(storyboards)} 条分镜面板，全部绑定资产静帧、完整台词音频和多角色资产库音色参考。", "createdAt": now + 2, "updatedAt": now + 2},
        {"id": "work-chapter-001-production-plan", "key": "productionPlan", "episodeId": EPISODE_ID, "data": f"本地成片输出: {final_path}", "createdAt": now + 3, "updatedAt": now + 3},
    ]
    if storyboard_source["kind"] == "bootstrap-fixture":
        generated_work.insert(1, {
            "id": "work-chapter-001-storyboard-table-bootstrap",
            "key": "storyboardTable",
            "episodeId": EPISODE_ID,
            "data": storyboard_table,
            "createdAt": now + 1,
            "updatedAt": now + 1,
        })
    state["agentWorkData"].extend(generated_work)
    state["storyboards"] = [sb for sb in state.get("storyboards", []) if sb.get("episodeId") != EPISODE_ID and sb.get("episodeId") != "episode-1"]
    state["storyboards"].extend(storyboards)
    rebuilt_continuity_keys = set(continuity_versions_by_key)
    state["continuityAssetVersions"] = [
        normalize_continuity_asset_version(item)
        for item in state.get("continuityAssetVersions", [])
        if f"{item.get('assetId', '')}:{item.get('versionId', '')}" not in rebuilt_continuity_keys
    ]
    state["continuityAssetVersions"].extend(continuity_versions_by_key.values())
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
            "framePath": str(frame_path_by_storyboard[sb["id"]]),
            "frameExists": Path(frame_path_by_storyboard[sb["id"]]).exists(),
            "audioPath": str(audio_path_by_storyboard[sb["id"]]),
            "audioExists": Path(audio_path_by_storyboard[sb["id"]]).exists(),
            "segmentPath": str(segment_path_by_storyboard[sb["id"]]),
            "segmentExists": Path(segment_path_by_storyboard[sb["id"]]).exists(),
            "assetIds": sb.get("assetIds", []),
            "assetNames": sb.get("associateAssetsNames", []),
            "imageAssetNames": sb.get("imageAssetNames", []),
            "imageAssetPaths": sb.get("imageAssetPaths", []),
            "mediaRef": sb.get("mediaRef", {}),
            "imageWorkflowId": sb.get("imageWorkflowId", ""),
            "imageWorkflowNodeId": sb.get("imageWorkflowNodeId", ""),
            "voiceReferenceName": sb.get("voiceReferenceName", ""),
            "voiceReferenceAudioPath": sb.get("voiceReferenceAudioPath", ""),
            "voiceProfileId": sb.get("voiceProfileId", ""),
            "voiceMatch": sb.get("voiceMatch", ""),
            "speaker": sb.get("speaker", ""),
            "speakerId": sb.get("speakerId", ""),
            "line": sb.get("line", ""),
            "ttsSpokenText": sb.get("ttsSpokenText", ""),
            "durationTarget": sb.get("durationTarget", 0),
            "voiceStyle": sb.get("voiceStyle", ""),
            "requiresFixedVoice": sb.get("requiresFixedVoice") is True,
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
            "prompt": next((node.get("prompt", "") for node in graph.get("nodes", []) if node.get("type") == "generated"), ""),
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
    storyboard_prompt_summary = summarize_storyboard_prompt_manifest(storyboard_prompt_manifest)
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
    missing_voice_profiles = sorted(
        speaker_id
        for speaker_id in speaker_descriptors
        if speaker_id not in speaker_voice_map
    )
    first_frame = Image.open(frame_paths[0])
    workflow_steps = build_workflow_steps(
        state,
        script_text,
        shots,
        asset_catalog,
        script_plan_xml,
        director_plan_audit,
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
        "storyboardSourceKind": storyboard_source["kind"],
        "storyboardSourceWorkId": storyboard_source["workId"],
        "storyboardSourceUpdatedAt": storyboard_source["updatedAt"],
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
        "generatedImages": sum(
            1 for item in storyboard_image_results if not item["reusedExistingImage"]
        ),
        "reusedImages": sum(
            1 for item in storyboard_image_results if item["reusedExistingImage"]
        ),
        "storyboardTransferThumbnails": [
            {
                "storyboardId": item["workflowGraph"]["target"]["id"],
                **item["transferThumbnail"],
            }
            for item in storyboard_image_results
        ],
        "matchedAssetImages": image_asset_count,
        "framesWithRealAssetImages": image_backed_storyboards,
        "assetImagePaths": sorted(used_image_paths),
        "storyboardPromptManifest": storyboard_prompt_manifest,
        **storyboard_prompt_summary,
        "storyboardMediaManifest": storyboard_media_manifest,
        "voiceoverManifest": [
            {
                **voiceover,
                "audioPath": str(audio_path_by_storyboard[voiceover["storyboardId"]]),
                "audioExists": Path(audio_path_by_storyboard[voiceover["storyboardId"]]).exists(),
                "profileId": speaker_voice_map[voiceover["speakerId"]]["profileId"],
                "voiceReferenceAudioPath": speaker_voice_map[voiceover["speakerId"]]["voiceReferenceAudioPath"],
                "match": speaker_voice_map[voiceover["speakerId"]]["match"],
            }
            for voiceover in voiceovers
        ],
        "storyboardImageWorkflowManifest": storyboard_image_workflow_manifest,
        "assetImageManifest": asset_image_manifest,
        "trackCandidateManifest": track_candidate_manifest,
        "derivedAssetPlan": DERIVED_ASSET_PLAN,
        "derivedAssetManifest": derived_asset_sync["manifest"],
        "missingImageAssets": sorted(missing_image_assets),
        "workflowSteps": workflow_steps,
        **director_plan_audit,
        "voiceReferenceName": speaker_voice_map.get("narrator", {}).get("voiceReferenceName", ""),
        "voiceReferenceAudioPath": speaker_voice_map.get("narrator", {}).get("voiceReferenceAudioPath", ""),
        "speakerVoiceMap": speaker_voice_map,
        "voiceBindingFingerprint": fixed_voice_plan["voiceBindingFingerprint"],
        "fixedVoiceBindings": fixed_voice_plan["fixedVoiceBindings"],
        "aiSelectedVoiceBindings": fixed_voice_plan["aiSelectedVoiceBindings"],
        "speakerAudioStats": speaker_audio_stats,
        "speakerAudioSamples": speaker_audio_samples,
        "missingVoiceProfiles": missing_voice_profiles,
        "audioCount": len(audio_paths),
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
