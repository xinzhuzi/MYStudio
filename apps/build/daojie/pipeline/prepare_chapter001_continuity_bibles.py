#!/usr/bin/env python3
"""Prepare versioned chapter-001 dock pilot bibles without destructive writes.

Dry-run is the default. ``--apply`` requires explicit character/scene boards,
backs up project JSON files, writes a non-overwriting asset set, and leaves
every new asset version pending human approval.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


DEFAULT_PROJECT_DIR = Path(
    "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/"
    "49dce4c1-64b1-42de-85c2-9f266698aec0"
)
TARGET_CHARACTERS = ("独孤剑尘", "监工赵四", "小杂役")
VIEW_TYPES = ("front", "side", "back")
BIBLE_VERSION = "v5"
ART_DIRECTION_VERSION = "daojie-gongbi-v2"
PILOT_PROPS = {
    "油布剑包": "oilcloth-sword-wrap",
    "赤练蛇皮鞭": "red-snake-whip",
    "灵矿藤筐": "spirit-ore-basket",
    "灵矿": "spirit-ore",
    "残卷": "torn-scroll",
}

CHARACTER_DESCRIPTIONS = {
    "独孤剑尘": (
        "清瘦冷峻的银白长发剑修，身穿洗到发白、右肩有加固缝线的完整旧灰袍，"
        "第一章入镇阶段背负三层油布剑包；不得腰悬或裸露完整长剑。"
    ),
    "小杂役": (
        "十二三岁的瘦弱少年，凌乱及肩黑发，身穿完整朴素短褐与长裤，赤足；"
        "不得出现及踝长袍、裙装或成年女性脸。"
    ),
}


CHARACTER_BIBLES: dict[str, dict[str, Any]] = {
    "独孤剑尘": {
        "identityAnchors": {
            "faceShape": "清瘦长脸",
            "jawline": "锐利窄下颌",
            "cheekbones": "高而清晰的颧骨",
            "eyeShape": "狭长深色眼",
            "uniqueMarks": ["银白长发半束高髻", "右肩加固缝线的完整灰袍", "背负三层油布剑包"],
            "hairStyle": "及腰银白长发，半束高髻",
        },
        "negativePrompt": {
            "avoid": ["黑发", "短发", "圆脸", "壮硕体型", "崭新华服", "腰悬完整剑", "裸露完整长剑", "现代服饰"],
            "styleExclusions": ["写实摄影", "3D塑料质感", "赛璐璐平涂"],
        },
        "cropProfile": "three-view",
    },
    "监工赵四": {
        "identityAnchors": {
            "faceShape": "宽方厚重脸",
            "jawline": "宽阔方下颌",
            "cheekbones": "宽平颧骨",
            "eyeShape": "浓眉下的狭窄严厉眼形",
            "noseShape": "宽直鼻梁",
            "uniqueMarks": ["浓重眉骨与宽方下颌组合", "黑色长发向后披散", "粗壮体格与灰腰带白袍"],
            "hairStyle": "黑色长发向后梳拢并披至肩背",
        },
        "negativePrompt": {
            "avoid": ["瘦弱体型", "少年脸", "白发", "短发", "圆润笑脸", "华贵锦袍", "现代服饰"],
            "styleExclusions": ["写实摄影", "3D塑料质感", "赛璐璐平涂"],
        },
        "cropProfile": "portrait-plus-three-view",
    },
    "小杂役": {
        "identityAnchors": {
            "faceShape": "窄小的少年脸",
            "jawline": "柔和窄下颌",
            "cheekbones": "不突出的少年颧骨",
            "eyeShape": "偏大的深色怯生眼睛",
            "uniqueMarks": ["十二三岁瘦弱少年体态", "凌乱及肩黑发", "完整朴素短褐与长裤且赤足"],
            "hairStyle": "凌乱及肩黑发，碎发垂在额前与耳侧",
        },
        "negativePrompt": {
            "avoid": ["成年男子", "成年女性脸", "壮硕体型", "及踝长袍", "裙装", "华贵锦袍", "束冠高髻", "鞋靴", "现代服饰"],
            "styleExclusions": ["写实摄影", "3D塑料质感", "赛璐璐平涂"],
        },
        "cropProfile": "portrait-plus-three-view",
    },
}


DOCK_BIBLE = {
    "spatialLayout": (
        "画面前景为由左下向中部递进的湿石台阶与装卸平台；左侧固定堆放藤筐和散落矿石；"
        "右前景为系缆木桩与粗绳，右侧沿河停靠木船；河道从画面中部向远景延伸，群山与雾气构成背景轴。"
    ),
    "lightingDesign": "阴天晨雾中的均匀平光宣纸照明，湿石与河面保留轻薄有彩色层次的反光，人物脸手清晰可读。",
    "colorPalette": "石青、石绿、靛青、苔绿、藤筐赭褐与旧木褐形成30%-70%可辨色区，朱砂与旧金作为克制叙事焦点。",
    "keyProps": ["湿石台阶", "藤筐", "散落矿石", "系缆木桩", "粗麻绳", "木船"],
}


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def continuity_content_fingerprint(version: dict[str, Any]) -> str:
    fields = (
        "assetId", "versionId", "assetKind", "label", "referenceImagePaths", "referenceImageSha256",
        "referenceViewTypes", "identityAnchors", "negativePrompt", "wardrobeVersion",
        "sceneViewpointId", "spatialLayout", "lightingDesign", "colorPalette",
        "validFromStoryboardIndex", "validToStoryboardIndex", "source", "artDirectionVersion",
    )
    value = {key: version.get(key) for key in fields if version.get(key) is not None}
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def pending_version(version: dict[str, Any]) -> dict[str, Any]:
    return {
        **version,
        "structurallyComplete": True,
        "contentFingerprint": continuity_content_fingerprint(version),
        "reviewStatus": "pending",
        "approval": None,
        "approvalFingerprint": None,
        "approved": False,
    }


def validate_bible_version(value: str) -> str:
    bible_version = str(value).strip()
    if re.fullmatch(r"v[1-9][0-9]*", bible_version) is None:
        raise RuntimeError(f"Bible 版本必须是 vN 格式: {value}")
    return bible_version


def parse_prop_source_overrides(values: list[str]) -> dict[str, Path]:
    overrides: dict[str, Path] = {}
    for value in values:
        name, separator, raw_path = value.partition("=")
        name = name.strip()
        raw_path = raw_path.strip()
        if not separator or not name or not raw_path:
            raise RuntimeError(f"--prop-source 必须使用 道具名=图片路径 格式: {value}")
        if name not in PILOT_PROPS:
            raise RuntimeError(f"--prop-source 不支持未知道具: {name}")
        if name in overrides:
            raise RuntimeError(f"--prop-source 重复指定道具: {name}")
        overrides[name] = Path(raw_path)
    return overrides


def load_continuity_helpers():
    import importlib.util

    generator_path = Path(__file__).resolve().parents[1] / "build_daojie_chapter001_workflow.py"
    spec = importlib.util.spec_from_file_location("chapter001_transfer_helper", generator_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载缩略图 helper: {generator_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_transfer_thumbnail_helper():
    return load_continuity_helpers().create_storyboard_transfer_thumbnail


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("state"), dict):
        raise RuntimeError(f"项目 JSON 结构无效: {path}")
    return value


def load_continuity_versions_document(path: Path) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    raw_versions = document.get("continuityAssetVersions") if isinstance(document, dict) else None
    if not isinstance(raw_versions, list) and isinstance(document, dict):
        raw_versions = (document.get("state") or {}).get("continuityAssetVersions")
    if not isinstance(raw_versions, list):
        raise RuntimeError(f"连续性资产来源缺少 continuityAssetVersions 数组: {path}")
    return raw_versions


def continuity_version_key(version: dict[str, Any]) -> tuple[str, str]:
    return str(version.get("assetId") or ""), str(version.get("versionId") or "")


def safe_path_segment(value: str) -> str:
    readable = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._") or "asset"
    return f"{readable[:48]}-{hashlib.sha256(value.encode('utf-8')).hexdigest()[:10]}"


def planned_reference_paths(bible_root: Path, version: dict[str, Any]) -> list[Path]:
    source_paths = version.get("referenceImagePaths") or []
    asset_kind = str(version.get("assetKind") or "asset")
    asset_segment = safe_path_segment(str(version.get("assetId") or "asset"))
    version_segment = safe_path_segment(str(version.get("versionId") or "version"))
    view_types = version.get("referenceViewTypes") or []
    output_dir = bible_root / "assets" / asset_kind / asset_segment / version_segment
    return [
        output_dir / f"{safe_path_segment(str(view_types[index])) if index < len(view_types) else f'reference-{index + 1}'}.png"
        for index in range(len(source_paths))
    ]


def attach_review_evidence(
    versions: list[dict[str, Any]],
    thumbnails: list[dict[str, Any]],
) -> None:
    for version in versions:
        matches = [
            item for item in thumbnails
            if item.get("assetId") == version.get("assetId")
            and item.get("versionId") == version.get("versionId")
        ]
        version["reviewEvidencePaths"] = [str(item["path"]) for item in matches]
        version["reviewEvidenceSha256"] = [str(item["sha256"]) for item in matches]


def exact_record(records: list[dict[str, Any]], name: str, source: Path) -> dict[str, Any]:
    matches = [item for item in records if item.get("name") == name]
    if len(matches) != 1:
        raise RuntimeError(f"{source} 中 {name} 精确记录数量应为 1，实际为 {len(matches)}")
    return matches[0]


def crop_boxes(profile: str, width: int, height: int) -> dict[str, tuple[int, int, int, int]]:
    if profile == "three-view":
        ratios = {"front": (0.08, 0.38), "side": (0.39, 0.65), "back": (0.68, 0.94)}
    elif profile == "portrait-plus-three-view":
        ratios = {"front": (0.325, 0.57), "side": (0.58, 0.735), "back": (0.74, 1.00)}
    else:
        raise RuntimeError(f"未知角色设定板裁切配置: {profile}")
    return {
        view_type: (round(left * width), 0, round(right * width), height)
        for view_type, (left, right) in ratios.items()
    }


def normalized_view_bytes(source: Path, box: tuple[int, int, int, int]) -> bytes:
    with Image.open(source) as image:
        crop = image.convert("RGB").crop(box)
        fitted = ImageOps.contain(crop, (640, 960), method=Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (640, 960), (244, 240, 232))
        canvas.paste(fitted, ((canvas.width - fitted.width) // 2, (canvas.height - fitted.height) // 2))
        output = io.BytesIO()
        canvas.save(output, format="PNG", optimize=True)
        return output.getvalue()


def png_bytes(source: Path) -> bytes:
    with Image.open(source) as image:
        output = io.BytesIO()
        image.convert("RGB").save(output, format="PNG", optimize=True)
        return output.getvalue()


def write_new_or_identical(path: Path, content: bytes) -> None:
    if path.exists():
        if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(content).digest():
            raise RuntimeError(f"拒绝覆盖已有不同资产: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.continuity.tmp")
    temporary.write_bytes(json_bytes(value))
    temporary.replace(path)


def prepare_bibles(
    project_dir: Path,
    dugu_board: Path,
    zhao_board: Path,
    helper_board: Path,
    dock_board: Path,
    apply: bool = False,
    bible_version: str = BIBLE_VERSION,
    prop_source_overrides: dict[str, Path] | None = None,
) -> dict[str, Any]:
    bible_version = validate_bible_version(bible_version)
    project_dir = project_dir.resolve()
    dugu_board = dugu_board.resolve()
    zhao_board = zhao_board.resolve()
    helper_board = helper_board.resolve()
    dock_board = dock_board.resolve()
    characters_path = project_dir / "characters.json"
    scenes_path = project_dir / "scenes.json"
    props_path = project_dir / "props.json"
    for path in (characters_path, scenes_path, props_path, dugu_board, zhao_board, helper_board, dock_board):
        if not path.is_file():
            raise RuntimeError(f"必要输入不存在: {path}")

    characters_doc = load_json(characters_path)
    scenes_doc = load_json(scenes_path)
    props_doc = load_json(props_path)
    characters = characters_doc["state"].get("characters")
    scenes = scenes_doc["state"].get("scenes")
    props = props_doc["state"].get("items")
    if not isinstance(characters, list) or not isinstance(scenes, list) or not isinstance(props, list):
        raise RuntimeError("characters.json、scenes.json 或 props.json 缺少数组 state")

    character_records = {name: exact_record(characters, name, characters_path) for name in TARGET_CHARACTERS}
    dock = exact_record(scenes, "金水河码头", scenes_path)
    prop_records = {name: exact_record(props, name, props_path) for name in PILOT_PROPS}
    sources = {
        "独孤剑尘": dugu_board,
        "监工赵四": zhao_board,
        "小杂役": helper_board,
    }
    dock_source = dock_board
    overrides = prop_source_overrides or {}
    unknown_overrides = sorted(set(overrides) - set(PILOT_PROPS))
    if unknown_overrides:
        raise RuntimeError(f"不支持未知道具覆盖: {', '.join(unknown_overrides)}")
    prop_sources = {
        name: Path(overrides.get(name) or str(record.get("imageUrl") or "")).resolve()
        for name, record in prop_records.items()
    }
    for path in (*sources.values(), dock_source, *prop_sources.values()):
        if not path.is_file():
            raise RuntimeError(f"基准图不存在: {path}")

    bible_root = project_dir / "continuity-bibles/chapter-001" / bible_version
    planned_assets: dict[str, dict[str, Any]] = {}
    for name, source in sources.items():
        with Image.open(source) as image:
            boxes = crop_boxes(CHARACTER_BIBLES[name]["cropProfile"], image.width, image.height)
        slug = {"独孤剑尘": "dugu-jianchen", "监工赵四": "zhao-si", "小杂役": "dock-helper"}[name]
        view_paths = {
            view_type: bible_root / "characters" / slug / f"{view_type}.png"
            for view_type in VIEW_TYPES
        }
        planned_assets[name] = {
            "source": source,
            "sourceSha256": sha256_path(source),
            "boxes": boxes,
            "viewPaths": view_paths,
            "viewSha256": {
                view_type: hashlib.sha256(normalized_view_bytes(source, boxes[view_type])).hexdigest()
                for view_type in VIEW_TYPES
            },
        }
    dock_view_path = bible_root / "scenes/jinshui-dock/dock-main-axis.png"
    planned_props = {
        name: {
            "source": source,
            "sourceSha256": sha256_path(source),
            "outputPath": bible_root / "props" / PILOT_PROPS[name] / "reference.png",
        }
        for name, source in prop_sources.items()
    }
    continuity_versions = []
    wardrobe_versions = {"独孤剑尘": "grey-town", "监工赵四": "dock-overseer", "小杂役": "dock-ragged"}
    for name, item in planned_assets.items():
        record = character_records[name]
        wardrobe = wardrobe_versions[name]
        continuity_versions.append(pending_version({
            "assetId": record["id"],
            "versionId": f"{record['id']}:{wardrobe}:v1",
            "assetKind": "character",
            "label": wardrobe,
            "referenceImagePaths": [str(item["viewPaths"][view]) for view in VIEW_TYPES],
            "referenceImageSha256": [item["viewSha256"][view] for view in VIEW_TYPES],
            "referenceViewTypes": list(VIEW_TYPES),
            "identityAnchors": CHARACTER_BIBLES[name]["identityAnchors"],
            "negativePrompt": CHARACTER_BIBLES[name]["negativePrompt"],
            "wardrobeVersion": wardrobe,
            "source": "project-character-bible",
            "artDirectionVersion": ART_DIRECTION_VERSION,
        }))
    continuity_versions.append(pending_version({
        "assetId": dock["id"],
        "versionId": f"{dock['id']}:dock-main-axis:v1",
        "assetKind": "scene",
        "label": "dock-main-axis",
        "referenceImagePaths": [str(dock_view_path)],
        "referenceImageSha256": [hashlib.sha256(png_bytes(dock_source)).hexdigest()],
        "sceneViewpointId": "dock-main-axis",
        "spatialLayout": DOCK_BIBLE["spatialLayout"],
        "lightingDesign": DOCK_BIBLE["lightingDesign"],
        "colorPalette": DOCK_BIBLE["colorPalette"],
        "source": "project-scene-bible",
        "artDirectionVersion": ART_DIRECTION_VERSION,
    }))
    for name, item in planned_props.items():
        record = prop_records[name]
        continuity_versions.append(pending_version({
            "assetId": record["id"],
            "versionId": f"{record['id']}:base:v1",
            "assetKind": "prop",
            "label": "chapter-001-base",
            "referenceImagePaths": [str(item["outputPath"])],
            "referenceImageSha256": [hashlib.sha256(png_bytes(item["source"])).hexdigest()],
            "source": "project-prop-library",
            "artDirectionVersion": ART_DIRECTION_VERSION,
        }))

    report: dict[str, Any] = {
        "dryRun": not apply,
        "bibleVersion": bible_version,
        "artDirectionVersion": ART_DIRECTION_VERSION,
        "projectDir": str(project_dir),
        "changedCharacters": list(TARGET_CHARACTERS),
        "changedScenes": ["金水河码头"],
        "changedProps": list(PILOT_PROPS),
        "backups": [],
        "manifestPath": str(bible_root / "manifest.json"),
        "assetPlan": {
            name: {
                "source": str(item["source"]),
                "sourceSha256": item["sourceSha256"],
                "views": {key: str(value) for key, value in item["viewPaths"].items()},
            }
            for name, item in planned_assets.items()
        },
        "scenePlan": {"source": str(dock_source), "view": str(dock_view_path)},
        "propPlan": {
            name: {
                "source": str(item["source"]),
                "sourceSha256": item["sourceSha256"],
                "outputPath": str(item["outputPath"]),
            }
            for name, item in planned_props.items()
        },
        "continuityAssetVersions": continuity_versions,
        "approvalSummary": {"approved": 0, "pending": len(continuity_versions), "rejected": 0},
    }
    if not apply:
        return report
    if bible_root.exists():
        raise RuntimeError(f"拒绝覆盖已有 {bible_version} Bible 目录: {bible_root}")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    backup_dir = project_dir / "backups/chapter-001-continuity-bible" / timestamp
    backup_dir.mkdir(parents=True, exist_ok=False)
    for source in (characters_path, scenes_path, props_path):
        destination = backup_dir / source.name
        shutil.copy2(source, destination)
        report["backups"].append({
            "path": str(destination),
            "sha256": sha256_path(destination),
        })

    output_assets = []
    review_thumbnails = []
    create_transfer_thumbnail = load_transfer_thumbnail_helper()
    for name, item in planned_assets.items():
        views = []
        record = character_records[name]
        wardrobe = wardrobe_versions[name]
        version_id = f"{record['id']}:{wardrobe}:v1"
        for view_type in VIEW_TYPES:
            output_path = item["viewPaths"][view_type]
            write_new_or_identical(output_path, normalized_view_bytes(item["source"], item["boxes"][view_type]))
            views.append({"viewType": view_type, "imageUrl": str(output_path), "generatedAt": now_ms})
            output_assets.append({
                "assetId": record["id"],
                "versionId": version_id,
                "viewType": view_type,
                "path": str(output_path),
                "sha256": sha256_path(output_path),
            })
            review_thumbnails.append({
                "assetId": record["id"],
                "versionId": version_id,
                "viewType": view_type,
                **create_transfer_thumbnail(output_path),
            })
        record["identityAnchors"] = CHARACTER_BIBLES[name]["identityAnchors"]
        record["negativePrompt"] = CHARACTER_BIBLES[name]["negativePrompt"]
        record["views"] = views
        if name in CHARACTER_DESCRIPTIONS:
            record["description"] = CHARACTER_DESCRIPTIONS[name]
        record["updatedAt"] = now_ms

    write_new_or_identical(dock_view_path, png_bytes(dock_source))
    dock_version_id = f"{dock['id']}:dock-main-axis:v1"
    output_assets.append({
        "assetId": dock["id"],
        "versionId": dock_version_id,
        "path": str(dock_view_path),
        "sha256": sha256_path(dock_view_path),
    })
    review_thumbnails.append({
        "assetId": dock["id"],
        "versionId": dock_version_id,
        **create_transfer_thumbnail(dock_view_path),
    })
    dock.update(DOCK_BIBLE)
    dock["contactSheetImage"] = str(dock_view_path)
    dock["viewpoints"] = [{
        "id": "dock-main-axis",
        "name": "码头装卸主轴",
        "nameEn": "dock main loading axis",
        "shotIds": [f"sb-chapter-001-{index:03d}" for index in range(1, 13)],
        "keyProps": DOCK_BIBLE["keyProps"],
        "gridIndex": 0,
    }]
    dock["viewpointImages"] = {
        "dock-main-axis": {"imageUrl": str(dock_view_path), "gridIndex": 0},
    }
    dock["updatedAt"] = now_ms

    for name, item in planned_props.items():
        record = prop_records[name]
        output_path = item["outputPath"]
        version_id = f"{record['id']}:base:v1"
        write_new_or_identical(output_path, png_bytes(item["source"]))
        output_assets.append({
            "assetId": record["id"],
            "versionId": version_id,
            "path": str(output_path),
            "sha256": sha256_path(output_path),
        })
        review_thumbnails.append({
            "assetId": record["id"],
            "versionId": version_id,
            **create_transfer_thumbnail(output_path),
        })
        record["imageUrl"] = str(output_path)
        record["updatedAt"] = now_ms

    before_hashes = {
        "characters.json": sha256_path(characters_path),
        "scenes.json": sha256_path(scenes_path),
        "props.json": sha256_path(props_path),
    }
    atomic_write_json(characters_path, characters_doc)
    atomic_write_json(scenes_path, scenes_doc)
    atomic_write_json(props_path, props_doc)
    after_hashes = {
        "characters.json": sha256_path(characters_path),
        "scenes.json": sha256_path(scenes_path),
        "props.json": sha256_path(props_path),
    }
    attach_review_evidence(continuity_versions, review_thumbnails)
    report.update({
        "appliedAt": datetime.now(timezone.utc).isoformat(),
        "beforeSha256": before_hashes,
        "afterSha256": after_hashes,
        "outputAssets": output_assets,
        "reviewThumbnails": review_thumbnails,
    })
    manifest_path = Path(report["manifestPath"])
    write_new_or_identical(manifest_path, json_bytes(report))
    report["manifestSha256"] = sha256_path(manifest_path)
    return report


def prepare_full_chapter_manifest(
    project_dir: Path,
    source_document: Path,
    apply: bool = False,
    bible_version: str = "v5",
) -> dict[str, Any]:
    """Copy a complete, exact-key asset-version set into a pending Bible."""
    project_dir = project_dir.resolve()
    source_document = source_document.resolve()
    bible_version = validate_bible_version(bible_version)
    if not project_dir.is_dir() or not source_document.is_file():
        raise RuntimeError(f"完整 Bible 输入不存在: {project_dir} / {source_document}")

    source_versions = load_continuity_versions_document(source_document)
    keys = [continuity_version_key(version) for version in source_versions]
    if any(not asset_id or not version_id for asset_id, version_id in keys):
        raise RuntimeError("完整 Bible 存在空 assetId/versionId")
    if len(keys) != len(set(keys)):
        raise RuntimeError("完整 Bible 存在重复 assetId/versionId")

    helpers = load_continuity_helpers()
    bible_root = project_dir / "continuity-bibles/chapter-001" / bible_version
    asset_plans: list[dict[str, Any]] = []
    pending_versions: list[dict[str, Any]] = []
    all_output_paths: list[Path] = []
    for source_version in source_versions:
        source_paths = [Path(str(path)).resolve() for path in source_version.get("referenceImagePaths") or []]
        if not source_paths or any(not path.is_file() for path in source_paths):
            raise RuntimeError(
                f"完整 Bible 参考图不存在: {source_version.get('assetId')}/{source_version.get('versionId')}"
            )
        output_paths = planned_reference_paths(bible_root, source_version)
        if len(output_paths) != len(set(output_paths)):
            raise RuntimeError(
                f"完整 Bible 输出路径冲突: {source_version.get('assetId')}/{source_version.get('versionId')}"
            )
        output_bytes = [png_bytes(path) for path in source_paths]
        version = json.loads(json.dumps(source_version))
        version["referenceImagePaths"] = [str(path) for path in output_paths]
        version["referenceImageSha256"] = [hashlib.sha256(content).hexdigest() for content in output_bytes]
        version["reviewStatus"] = "pending"
        version["approval"] = None
        version["approvalFingerprint"] = None
        version["approved"] = False
        version = helpers.normalize_continuity_asset_version(version)
        version["reviewStatus"] = "pending"
        version["approval"] = None
        version["approvalFingerprint"] = None
        version["approved"] = False
        pending_versions.append(version)
        all_output_paths.extend(output_paths)
        asset_plans.append({
            "assetId": version["assetId"],
            "versionId": version["versionId"],
            "assetKind": version["assetKind"],
            "sourcePaths": [str(path) for path in source_paths],
            "outputPaths": [str(path) for path in output_paths],
            "outputSha256": [hashlib.sha256(content).hexdigest() for content in output_bytes],
        })
    if len(all_output_paths) != len(set(all_output_paths)):
        raise RuntimeError("完整 Bible 不同版本映射到了同一输出路径")

    report: dict[str, Any] = {
        "dryRun": not apply,
        "bibleVersion": bible_version,
        "projectDir": str(project_dir),
        "sourceDocument": str(source_document),
        "manifestPath": str(bible_root / "manifest.json"),
        "assetCount": len({version["assetId"] for version in pending_versions}),
        "versionCount": len(pending_versions),
        "structurallyCompleteCount": sum(version.get("structurallyComplete") is True for version in pending_versions),
        "structurallyIncomplete": [
            {"assetId": version["assetId"], "versionId": version["versionId"], "missingFields": version.get("missingFields") or []}
            for version in pending_versions
            if version.get("structurallyComplete") is not True
        ],
        "approvalSummary": {"approved": 0, "pending": len(pending_versions), "rejected": 0},
        "continuityAssetVersions": pending_versions,
        "assetPlan": asset_plans,
    }
    if not apply:
        return report

    output_assets: list[dict[str, Any]] = []
    review_thumbnails: list[dict[str, Any]] = []
    create_transfer_thumbnail = helpers.create_storyboard_transfer_thumbnail
    for plan in asset_plans:
        for index, (source_path, output_path) in enumerate(zip(plan["sourcePaths"], plan["outputPaths"])):
            destination = Path(output_path)
            write_new_or_identical(destination, png_bytes(Path(source_path)))
            output_assets.append({
                "assetId": plan["assetId"],
                "versionId": plan["versionId"],
                "referenceIndex": index,
                "path": str(destination),
                "sha256": sha256_path(destination),
            })
            review_thumbnails.append({
                "assetId": plan["assetId"],
                "versionId": plan["versionId"],
                "referenceIndex": index,
                **create_transfer_thumbnail(destination),
            })
    attach_review_evidence(pending_versions, review_thumbnails)
    report["outputAssets"] = output_assets
    report["reviewThumbnails"] = review_thumbnails
    manifest_path = Path(report["manifestPath"])
    write_new_or_identical(manifest_path, json_bytes(report))
    report["manifestSha256"] = sha256_path(manifest_path)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", type=Path, default=DEFAULT_PROJECT_DIR)
    parser.add_argument("--dugu-board", type=Path)
    parser.add_argument("--zhao-board", type=Path)
    parser.add_argument("--helper-board", type=Path)
    parser.add_argument("--dock-board", type=Path)
    parser.add_argument("--full-chapter-source", type=Path)
    parser.add_argument("--bible-version", default=BIBLE_VERSION)
    parser.add_argument("--prop-source", action="append", default=[])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.full_chapter_source:
        print(json.dumps(prepare_full_chapter_manifest(
            args.project_dir,
            args.full_chapter_source,
            args.apply,
            args.bible_version,
        ), ensure_ascii=False, indent=2))
        return
    if not all((args.dugu_board, args.zhao_board, args.helper_board, args.dock_board)):
        parser.error("pilot 模式必须同时提供 --dugu-board/--zhao-board/--helper-board/--dock-board")
    prop_source_overrides = parse_prop_source_overrides(args.prop_source)
    print(json.dumps(prepare_bibles(
        args.project_dir,
        args.dugu_board,
        args.zhao_board,
        args.helper_board,
        args.dock_board,
        args.apply,
        args.bible_version,
        prop_source_overrides,
    ), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
