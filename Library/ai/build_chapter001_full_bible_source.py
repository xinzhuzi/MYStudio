#!/usr/bin/env python3
"""Plan and assemble the exact 32-version chapter-001 v5 Bible source.

The planner writes only task research artifacts. Assembly is non-overwriting and
requires all eight reviewed generation outputs to exist before it can build the
complete source document consumed by prepare_chapter001_continuity_bibles.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

try:
    from Library.ai import daojie_gongbi_v2
except ModuleNotFoundError:
    from ai import daojie_gongbi_v2


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PROJECT_DIR = Path.home() / "Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0"
STORE_PATH = PROJECT_DIR / "studio-workflow-store.json"
TASK_RESEARCH = REPOSITORY_ROOT / ".trellis/tasks/07-12-mystudio-chapter001-visual-continuity/research"
AUTOMATION_ROOT = REPOSITORY_ROOT / "apps/output/automation"
ASSET_FILES = Path.home() / "Library/Application Support/漫影工作室/assets/files"
GENERATED_ROOT = AUTOMATION_ROOT / "chapter001-v5-full-bible-generated"
SOURCE_ROOT = AUTOMATION_ROOT / "chapter001-v5-full-bible-source"
ART_DIRECTION_VERSION = daojie_gongbi_v2.STYLE_CONTRACT_VERSION
EXPECTED_VERSION_COUNT = 32
SOURCE_MATRIX_STEM = "chapter001-daojie-gongbi-v2-32-version-source-matrix"


CHARACTER_SPECS: dict[str, dict[str, Any]] = {
    "char_1780296482373_nh4qana": {
        "board": AUTOMATION_ROOT / "chapter001-v5-bible-inputs/dugu-grey-town-v5-r2.png",
        "profile": "three-view", "wardrobe": "grey-town",
        "anchors": ["银白长发半束", "清瘦冷峻长脸", "背负三层油布剑包"],
        "avoid": ["黑发", "腰悬完整剑", "露出剑刃", "更换油布剑包绑绳结构"],
    },
    "char_1780296482373_lagh81z": {
        "board": AUTOMATION_ROOT / "chapter001-v4-bible-inputs/zhao-si-v4.png",
        "profile": "portrait-plus-three-view", "wardrobe": "dock-overseer",
        "anchors": ["宽方脸", "严厉眼神", "粗壮监工体型", "黑色长发"],
        "avoid": ["换脸", "消瘦书生", "年轻白袍侠客", "成年女性脸"],
    },
    "char_1780296482373_ja3rc3v": {
        "board": AUTOMATION_ROOT / "chapter001-v4-bible-inputs/dock-helper-v4.png",
        "profile": "portrait-plus-three-view", "wardrobe": "dock-ragged",
        "anchors": ["十二三岁少年", "瘦小体型", "短褐与旧裤", "赤足"],
        "avoid": ["成年女性脸", "及踝长袍", "成年体型", "精致宗门服"],
    },
    "char_1780296482373_kuuv99u": {
        "board": GENERATED_ROOT / "old-laborer-turnaround-r4.png",
        "profile": "three-view", "wardrobe": "laborer-old",
        "anchors": ["五十五至六十五岁男性", "风霜皱纹", "长期劳作的结实体型"],
        "avoid": ["年轻脸", "女性脸", "衣物不完整", "白袍书生"],
    },
    "char_1780296482373_kj9fb89": {
        "board": GENERATED_ROOT / "young-laborer-turnaround-r2.png",
        "profile": "three-view", "wardrobe": "laborer-young",
        "anchors": ["二十至三十岁成年男性", "码头力工体型", "晒黑朴实面容"],
        "avoid": ["白袍清秀书生", "女性脸", "少年体型", "宗门华服"],
    },
    "char_1780296482373_m22ju4b": {
        "board": ASSET_FILES / "role/223c75ae-67c5-49a3-9227-b60f0da2f99f.jpg",
        "profile": "portrait-plus-three-view", "wardrobe": "innkeeper-base",
        "anchors": ["宽胖中年男性", "下垂眼角", "黑色散发", "客栈掌柜体型"],
        "avoid": ["消瘦", "年轻侠客", "女性脸", "更换脸型"],
    },
    "char_1780296482373_yqb67hk": {
        "board": ASSET_FILES / "role/宗门弟子甲_1783082914449.png",
        "profile": "portrait-plus-three-view", "wardrobe": "sect-disciple-a",
        "anchors": ["年轻男性", "散落黑长发", "清瘦脸", "白色宗门长袍"],
        "avoid": ["女性脸", "短发", "深色粗布", "更换发型"],
    },
    "char_1780296482373_xw0c1k0": {
        "board": ASSET_FILES / "role/宗门弟子乙_1783084880930.png",
        "profile": "four-view", "wardrobe": "sect-disciple-b",
        "anchors": ["年轻男性", "高束发髻", "冷静窄脸", "白色宗门长袍与灰蓝腰带"],
        "avoid": ["女性脸", "散发", "粗布短褐", "更换腰带配饰"],
    },
    "char_1780296482373_rrq7twm": {
        "board": GENERATED_ROOT / "child-a-turnaround.png",
        "profile": "three-view", "wardrobe": "school-child-a",
        "anchors": ["十二至十四岁男孩", "少年脸和少年体态", "朴素短衣长裤"],
        "avoid": ["女孩脸", "成年脸", "成年身高", "女式发饰"],
    },
    "char_1780296482373_j62ynb9": {
        "board": GENERATED_ROOT / "girl-turnaround-r2.png",
        "profile": "three-view", "wardrobe": "school-girl",
        "anchors": ["八至十岁女孩", "儿童脸和儿童体态", "朴素完整衣裤"],
        "avoid": ["成年女武者", "成年身高", "兵器", "华丽战甲"],
    },
    "char_1780296482373_cufh7x1": {
        "board": ASSET_FILES / "role/b71e58ab-3f0b-4029-96fd-f0bfedc47417.jpg",
        "profile": "portrait-plus-three-view", "wardrobe": "teacher-li-base",
        "anchors": ["清瘦中年男性", "疲惫长脸", "黑色半束长发", "素白旧长袍"],
        "avoid": ["少年脸", "女性脸", "壮硕体型", "华丽宗门服"],
    },
    "char_1780296482373_vogzbgl": {
        "board": AUTOMATION_ROOT / "chapter001-bible-assets-v4/yan-liao-turnaround.png",
        "profile": "three-view", "wardrobe": "yan-liao-base",
        "anchors": ["年轻男性", "高束黑发", "冷峻脸", "白蓝完整宗门衣袍"],
        "avoid": ["女性脸", "散发", "衣物不完整", "更换白蓝衣袍层次"],
    },
}


SCENE_SPECS: dict[str, dict[str, Any]] = {
    "scene_1780296482373_avuxou2:dock-main-axis:v1": {
        "board": AUTOMATION_ROOT / "chapter001-v4-bible-inputs/dock-main-axis-v4.png", "profile": "full",
        "viewpoint": "dock-main-axis", "layout": "湿石阶与装卸平台在左，藤筐和灵矿靠左前景，系船柱、缆绳与船只在右，河道透视居中通向雾山",
        "light": "清晨均匀平光宣纸照明，雾气轻薄", "palette": "石青、石绿、靛青、湿石赭褐、旧木褐与朱砂旧金焦点",
    },
    "scene_1780296482373_h8geu0d:inn-hall-counter-axis:v1": {
        "board": GENERATED_ROOT / "inn-contact-sheet.png", "profile": "left",
        "viewpoint": "inn-hall-counter-axis", "layout": "柜台与算盘固定在左前景，朽木楼梯在后侧，客栈入口和桌凳保持固定轴线",
        "light": "油灯赭石薄染与均匀纸面平光并置", "palette": "赭石、旧木褐、石青阴影、朱砂与旧金焦点",
    },
    "scene_1780296482373_h8geu0d:inn-room-window-axis:v1": {
        "board": GENERATED_ROOT / "inn-contact-sheet.png", "profile": "right",
        "viewpoint": "inn-room-window-axis", "layout": "从客栈大堂通往斗室的受控次级视角，窗与楼梯方位固定，不替代斗室主场景",
        "light": "大堂油灯向斗室保持轻薄层次", "palette": "旧木褐、赭石、石青、石绿与窗外靛青",
    },
    "scene_1780296482373_ndts8if:inn-room-window-axis:v1": {
        "board": GENERATED_ROOT / "inn-room-contact-sheet.png", "profile": "left",
        "viewpoint": "inn-room-window-axis", "layout": "狭窄斗室，床榻靠右墙，木桌与枯灯靠左，窗固定在北墙并可见塾馆灯火",
        "light": "枯灯赭石薄染与窗外石青薄染并置，均匀纸面光保持线描可读", "palette": "旧木褐、赭石、石青、石绿、靛青与宣纸白",
    },
    "scene_1780296482373_ndts8if:inn-room-night-return:v1": {
        "board": GENERATED_ROOT / "inn-room-contact-sheet.png", "profile": "right",
        "viewpoint": "inn-room-night-return", "layout": "与斗室窗轴完全同一布局，床榻、木桌、枯灯和北窗位置不变，仅表现深夜归来状态",
        "light": "深夜枯灯与窗外月色只以轻薄石青和赭石薄染保持平光纸面层次", "palette": "靛青、旧木褐、赭石、石青与少量朱砂",
    },
    "scene_1780296482374_jew094y:school-lamp-desk-axis:v1": {
        "board": GENERATED_ROOT / "school-contact-sheet.png", "profile": "left",
        "viewpoint": "school-lamp-desk-axis", "layout": "长凳与书案纵向排列，油灯居于先生书案，入口处保留湿鞋位置，窗在面向客栈的一侧",
        "light": "油灯赭石薄染为暖色焦点，室内保持可读纸面层次", "palette": "旧木褐、油灯赭石、石青阴影、石绿与朱砂焦点",
    },
    "scene_1780296482374_jew094y:inn-room-window-axis:v1": {
        "board": GENERATED_ROOT / "school-contact-sheet.png", "profile": "right",
        "viewpoint": "inn-room-window-axis", "layout": "从悦来客栈斗室北窗望向塾馆的外部次级视角，仅见塾馆窗灯与轮廓，不替代斗室主场景",
        "light": "夜色中的塾馆窗灯以克制赭石薄染为暖色焦点，纸面平光保留淡墨雾层", "palette": "靛青、石青、雾白、赭石窗光与少量旧金",
    },
    "scene_1780296482374_koqmk1b:river-night-long-axis:v1": {
        "board": GENERATED_ROOT / "river-night-long-axis.png", "profile": "full",
        "viewpoint": "river-night-long-axis", "layout": "深夜金水河长轴，河面与远山之间以淡墨雾层和留白退远，宗门灵舟沿河道主轴出现，低亮朱砂火印位于可读焦点",
        "light": "深夜雾层以淡墨留白与局部石青薄染展开，灵舟轮廓保持纸面平光层次，低亮朱砂火印成为局部焦点", "palette": "靛青、石青、石绿、旧金与朱砂红",
    },
}


PROP_SOURCE_OVERRIDES = {
    "prop-chapter-001-2": AUTOMATION_ROOT / "chapter001-v5-bible-inputs/spirit-ore-v5.png",
    "prop-chapter-001-3": AUTOMATION_ROOT / "chapter001-v5-bible-inputs/spirit-ore-basket-v5-r3.png",
    "prop-chapter-001-5": AUTOMATION_ROOT / "chapter001-v5-bible-inputs/oilcloth-sword-wrap-v5.png",
    "prop-chapter-001-7": AUTOMATION_ROOT / "chapter001-v5-bible-inputs/torn-scroll-v5.png",
}


def generation_jobs() -> list[dict[str, Any]]:
    style = (
        f"{daojie_gongbi_v2.DERIVED_ASSET_STYLE_LOCK}"
        "无文字、无标签、无边框、无水印、无额外人物。"
    )
    character_layout = "同一人物从左到右严格正面、左侧面、背面三格全身正交视图，同一脸、发型、身高、体型和服装，浅色纯净背景，脚部完整。"
    jobs = [
        {
            "jobId": "old-laborer-turnaround-r4", "assetId": "char_1780296482373_kuuv99u",
            "outputPath": str(GENERATED_ROOT / "old-laborer-turnaround-r4.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/old-laborer_thumb.png"),
            "aspectRatio": "3:2", "resolution": "1K",
            "prompt": f"{style}{character_layout} 五十五至六十五岁男性码头老苦力，风霜皱纹，长期劳动形成的结实体型。参考图只继承脸、年龄、体型和服装层次；重制为朴素完整的粗布短袍和长裤，袖口、衣摆、裤脚都是连续闭合的整齐布边。不得年轻化，不得白袍书生。",
        },
        {
            "jobId": "young-laborer-turnaround-r2", "assetId": "char_1780296482373_kj9fb89",
            "outputPath": str(GENERATED_ROOT / "young-laborer-turnaround-r2.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/young-laborer_thumb.png"),
            "aspectRatio": "3:2", "resolution": "1K",
            "prompt": f"{style}{character_layout} 二十至三十岁成年男性码头力工，晒黑朴实面容，肩背和手臂有劳动肌肉。参考图只继承脸、年龄、体型和服装层次；重制为朴素完整的粗布短袍和长裤，袖口、衣摆、裤脚都是连续闭合的整齐布边。不得清秀白袍书生，不得女性脸，不得少年体型。",
        },
        {
            "jobId": "child-a-turnaround", "assetId": "char_1780296482373_rrq7twm",
            "outputPath": str(GENERATED_ROOT / "child-a-turnaround.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/child-a_thumb.png"),
            "aspectRatio": "3:2", "resolution": "1K",
            "prompt": f"{style}{character_layout} 十二至十四岁男孩，明确少年脸、少年身高和未成年体态，朴素完整短衣长裤；不得女孩脸、成年脸、成年身高、女式发饰。",
        },
        {
            "jobId": "girl-turnaround-r2", "assetId": "char_1780296482373_j62ynb9",
            "outputPath": str(GENERATED_ROOT / "girl-turnaround-r2.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/girl_thumb.png"),
            "aspectRatio": "3:2", "resolution": "1K",
            "prompt": f"{style}{character_layout} 八至十岁女孩，明确儿童脸、儿童身高和儿童体态，朴素完整衣裤；不得成年女武者、成年身高、兵器、战甲或性感化。",
        },
        {
            "jobId": "inn-contact-sheet", "assetId": "scene_1780296482373_h8geu0d",
            "outputPath": str(GENERATED_ROOT / "inn-contact-sheet.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/inn-hall_thumb.png"),
            "aspectRatio": "16:9", "resolution": "1K",
            "prompt": f"{style} 同一悦来客栈的两格固定空间设定：左格为赭黄夜灯下的大堂柜台主轴，柜台与算盘在左前景、朽木楼梯在后侧、入口与桌凳位置固定；右格为从大堂通向斗室窗轴的次级视角。空场景，无人物，两格建筑结构必须一致。",
        },
        {
            "jobId": "inn-room-contact-sheet", "assetId": "scene_1780296482373_ndts8if",
            "outputPath": str(GENERATED_ROOT / "inn-room-contact-sheet.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/inn-room_thumb.png"),
            "aspectRatio": "16:9", "resolution": "1K",
            "prompt": f"{style} 同一狭窄悦来客栈斗室的两格固定布局：床榻靠右墙、木桌与枯灯靠左、北窗外可见塾馆灯火；左格枯灯赭石薄染与窗外石青薄染并置，右格保持所有位置不变只表现深夜归来、枯灯将熄。空场景，无人物。",
        },
        {
            "jobId": "school-contact-sheet", "assetId": "scene_1780296482374_jew094y",
            "outputPath": str(GENERATED_ROOT / "school-contact-sheet.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/school_thumb.png"),
            "aspectRatio": "16:9", "resolution": "1K",
            "prompt": f"{style} 同一金水塾馆的两格固定空间设定：左格为长凳、书案、先生油灯、入口湿鞋的室内主轴；右格为从悦来客栈斗室北窗望见塾馆窗灯和建筑轮廓的外部次级视角。空场景，无人物，两格方位关系一致。",
        },
        {
            "jobId": "river-night-long-axis", "assetId": "scene_1780296482374_koqmk1b",
            "outputPath": str(GENERATED_ROOT / "river-night-long-axis.png"),
            "referenceThumbnail": str(AUTOMATION_ROOT / "chapter001-full-bible-source-thumbnails/river_thumb.png"),
            "aspectRatio": "16:9", "resolution": "1K",
            "prompt": f"{style} 深夜金水河长轴空场景，河面与远山之间以淡墨雾层和留白退远，宗门灵舟沿河道主轴出现，低亮朱砂火印成为克制焦点；靛青、石青、石绿、旧金与朱砂红形成冷暖层次，空间清楚，无可辨文字。",
        },
    ]
    for job in jobs:
        job["artDirectionVersion"] = ART_DIRECTION_VERSION
    return jobs


def read_store_versions() -> tuple[list[dict[str, Any]], dict[str, str]]:
    document = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    state = document.get("state") or {}
    versions = state.get("continuityAssetVersions") or []
    if len(versions) != EXPECTED_VERSION_COUNT:
        raise RuntimeError(
            f"live continuityAssetVersions 必须是 {EXPECTED_VERSION_COUNT}，实际 {len(versions)}"
        )
    keys = [(item.get("assetId"), item.get("versionId")) for item in versions]
    if len(set(keys)) != EXPECTED_VERSION_COUNT or any(not all(key) for key in keys):
        raise RuntimeError(
            f"live {EXPECTED_VERSION_COUNT}-version matrix 存在空键或重复键"
        )
    names: dict[str, str] = {}
    for storyboard in state.get("storyboards") or []:
        for reference in storyboard.get("orderedReferenceManifest") or []:
            asset_id = str(reference.get("assetId") or "")
            asset_name = str(reference.get("assetName") or "")
            if asset_id and asset_name:
                if asset_id in names and names[asset_id] != asset_name:
                    raise RuntimeError(f"同一 assetId 出现不同名称: {asset_id}")
                names[asset_id] = asset_name
    return versions, names


def write_new_or_identical(path: Path, payload: bytes) -> None:
    if path.exists():
        if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(payload).digest():
            raise RuntimeError(f"拒绝覆盖已有不同文件: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def write_versioned_research_artifact(stem: str, preferred_revision: int, payload: bytes) -> Path:
    """Keep prior research snapshots and allocate a new revision on content drift."""
    revision = preferred_revision
    while True:
        path = TASK_RESEARCH / f"{stem}-r{revision}.json"
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            return path
        if hashlib.sha256(path.read_bytes()).digest() == hashlib.sha256(payload).digest():
            return path
        revision += 1


def json_payload(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def crop_ratios(profile: str) -> list[tuple[float, float]]:
    profiles = {
        "three-view": [(0.0, 1 / 3), (1 / 3, 2 / 3), (2 / 3, 1.0)],
        "portrait-plus-three-view": [(0.325, 0.57), (0.58, 0.735), (0.74, 1.0)],
        "four-view": [(0.0, 0.25), (0.25, 0.5), (0.5, 0.75)],
    }
    if profile not in profiles:
        raise RuntimeError(f"未知角色裁切布局: {profile}")
    return profiles[profile]


def character_crop_bytes(source: Path, left: float, right: float) -> bytes:
    import io

    with Image.open(source) as image:
        rgb = ImageOps.exif_transpose(image).convert("RGB")
        crop = rgb.crop((round(rgb.width * left), 0, round(rgb.width * right), rgb.height))
        fitted = ImageOps.contain(crop, (640, 960), method=Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (640, 960), (244, 240, 232))
        canvas.paste(fitted, ((canvas.width - fitted.width) // 2, (canvas.height - fitted.height) // 2))
        output = io.BytesIO()
        canvas.save(output, format="PNG", optimize=True)
        return output.getvalue()


def scene_crop_bytes(source: Path, profile: str) -> bytes:
    import io

    with Image.open(source) as image:
        rgb = ImageOps.exif_transpose(image).convert("RGB")
        if profile == "left":
            rgb = rgb.crop((0, 0, rgb.width // 2, rgb.height))
        elif profile == "right":
            rgb = rgb.crop((rgb.width // 2, 0, rgb.width, rgb.height))
        elif profile != "full":
            raise RuntimeError(f"未知场景裁切布局: {profile}")
        fitted = ImageOps.contain(rgb, (1280, 720), method=Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (1280, 720), (235, 231, 221))
        canvas.paste(fitted, ((canvas.width - fitted.width) // 2, (canvas.height - fitted.height) // 2))
        output = io.BytesIO()
        canvas.save(output, format="PNG", optimize=True)
        return output.getvalue()


def validate_transfer_thumbnail(path: Path) -> dict[str, Any]:
    if not path.is_file() or not path.name.endswith("_thumb.png"):
        raise RuntimeError(f"生成参考必须是已存在的 *_thumb.png: {path}")
    byte_count = path.stat().st_size
    if byte_count <= 0 or byte_count >= 1_000_000:
        raise RuntimeError(f"生成参考必须严格小于 1,000,000 bytes: {path} / {byte_count}")
    with Image.open(path) as image:
        image.load()
        if image.format != "PNG" or max(image.size) > 768:
            raise RuntimeError(f"生成参考不是最长边 <=768 的 PNG: {path}")
        width, height = image.size
    return {
        "path": str(path), "width": width, "height": height, "bytes": byte_count,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def generation_result_paths(output_path: Path) -> tuple[Path, Path]:
    return (
        output_path.with_name(f"{output_path.stem}_thumb.png"),
        output_path.with_name(f"{output_path.stem}-probe-report.json"),
    )


def validate_generation_result(job: dict[str, Any]) -> dict[str, Any]:
    output_path = Path(job["outputPath"])
    thumbnail_path, report_path = generation_result_paths(output_path)
    if not output_path.is_file():
        raise RuntimeError(f"生成原图不存在: {job['jobId']} / {output_path}")
    if not report_path.is_file():
        raise RuntimeError(f"生成报告不存在: {job['jobId']} / {report_path}")
    with Image.open(output_path) as image:
        image.load()
    thumbnail = validate_transfer_thumbnail(thumbnail_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    output_sha256 = hashlib.sha256(output_path.read_bytes()).hexdigest()
    expected_prompt_sha256 = hashlib.sha256(str(job["prompt"]).encode("utf-8")).hexdigest()
    reported_thumbnail = report.get("transferThumbnail") or {}
    checks = {
        "ok": report.get("ok") is True,
        "generationEndpointCalled": report.get("generationEndpointCalled") is True,
        "generatedImages": report.get("generatedImages") == 1,
        "outputPath": report.get("outputPath") == str(output_path),
        "outputSha256": report.get("outputSha256") == output_sha256,
        "outputSizeBytes": report.get("outputSizeBytes") == output_path.stat().st_size,
        "referencePath": report.get("referencePath") == str(job["referenceThumbnail"]),
        "promptSha256": report.get("promptSha256") == expected_prompt_sha256,
        "aspectRatio": report.get("aspectRatio") == job["aspectRatio"],
        "resolution": report.get("resolution") == job["resolution"],
        "thumbnail": reported_thumbnail == thumbnail,
        "singleProviderKey": len(report.get("providers") or []) == 1
        and (report.get("providers") or [{}])[0].get("keyCount") == 1,
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise RuntimeError(f"生成证据与磁盘不一致: {job['jobId']} / {failed}")
    return {
        "jobId": job["jobId"],
        "outputPath": str(output_path),
        "outputSha256": output_sha256,
        "transferThumbnail": thumbnail,
        "reportPath": str(report_path),
    }


def preflight_assembly_sources(versions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs = generation_jobs()
    generated_boards = {
        Path(spec["board"])
        for spec in [*CHARACTER_SPECS.values(), *SCENE_SPECS.values()]
        if Path(spec["board"]).parent == GENERATED_ROOT
    }
    job_outputs = {Path(job["outputPath"]) for job in jobs}
    if generated_boards != job_outputs:
        raise RuntimeError("组装生成板与 8-job 计划不一致")
    evidence = [validate_generation_result(job) for job in jobs]
    for spec in [*CHARACTER_SPECS.values(), *SCENE_SPECS.values()]:
        board = Path(spec["board"])
        if not board.is_file():
            raise RuntimeError(f"组装 source 不存在: {board}")
        with Image.open(board) as image:
            image.load()
    for version in versions:
        if version.get("assetKind") != "prop":
            continue
        asset_id = str(version.get("assetId") or "")
        reference_paths = version.get("referenceImagePaths") or []
        source = PROP_SOURCE_OVERRIDES.get(asset_id, Path(reference_paths[0]) if reference_paths else Path())
        if not source.is_file():
            raise RuntimeError(f"组装道具 source 不存在: {asset_id} / {source}")
        with Image.open(source) as image:
            image.load()
    return evidence


def write_plan() -> dict[str, Any]:
    versions, names = read_store_versions()
    jobs = generation_jobs()
    for job in jobs:
        job["referenceEvidence"] = validate_transfer_thumbnail(Path(job["referenceThumbnail"]))
    matrix = []
    for version in versions:
        asset_id = str(version["assetId"])
        version_id = str(version["versionId"])
        if version.get("assetKind") == "character":
            spec = CHARACTER_SPECS.get(asset_id)
            if not spec:
                raise RuntimeError(f"缺少角色 source spec: {asset_id}")
            operation = "generate-and-crop" if Path(spec["board"]).parent == GENERATED_ROOT else "reuse-and-crop"
            target = spec["board"]
        elif version.get("assetKind") == "scene":
            spec = SCENE_SPECS.get(version_id)
            if not spec:
                raise RuntimeError(f"缺少场景 source spec: {version_id}")
            operation = "generate-and-crop" if Path(spec["board"]).parent == GENERATED_ROOT else "reuse-scene-board"
            target = spec["board"]
        else:
            operation = "reuse-prop-candidate" if asset_id in PROP_SOURCE_OVERRIDES else "reuse-live-prop"
            target = PROP_SOURCE_OVERRIDES.get(asset_id, Path(version["referenceImagePaths"][0]))
        matrix.append({
            "assetKind": version["assetKind"], "assetId": asset_id, "assetName": names.get(asset_id),
            "versionId": version_id, "currentStructurallyComplete": version.get("structurallyComplete") is True,
            "currentMissingFields": version.get("missingFields") or [], "operation": operation,
            "sourceBoardOrImage": str(target), "sourceExists": Path(target).is_file(),
        })
    if (
        len(matrix) != EXPECTED_VERSION_COUNT
        or len(CHARACTER_SPECS) != 12
        or len(SCENE_SPECS) != 8
    ):
        raise RuntimeError(
            f"{EXPECTED_VERSION_COUNT}-version source mapping count invariant failed"
        )
    TASK_RESEARCH.mkdir(parents=True, exist_ok=True)
    matrix_path = write_versioned_research_artifact(
        SOURCE_MATRIX_STEM, 1,
        json_payload({
            "artDirectionVersion": ART_DIRECTION_VERSION,
            "versionCount": EXPECTED_VERSION_COUNT,
            "versions": matrix,
        }),
    )
    prompts_path = write_versioned_research_artifact(
        "chapter001-daojie-gongbi-v2-generation-prompts", 1,
        json_payload({"artDirectionVersion": ART_DIRECTION_VERSION, "jobCount": 8, "jobs": jobs}),
    )
    return {
        "ok": True, "artDirectionVersion": ART_DIRECTION_VERSION, "versionCount": len(matrix), "generationJobCount": len(jobs),
        "existingSources": sum(item["sourceExists"] for item in matrix),
        "missingSources": [item["sourceBoardOrImage"] for item in matrix if not item["sourceExists"]],
        "matrixPath": str(matrix_path), "promptsPath": str(prompts_path),
    }


def continuity_helpers():
    import importlib.util

    path = REPOSITORY_ROOT / "Library/build_daojie_chapter001_workflow.py"
    spec = importlib.util.spec_from_file_location("chapter001_bible_source_helpers", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载连续性 helper: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_character_sources() -> dict[str, list[str]]:
    outputs: dict[str, list[str]] = {}
    for asset_id, spec in CHARACTER_SPECS.items():
        board = Path(spec["board"])
        if not board.is_file():
            raise RuntimeError(f"角色设定板不存在: {asset_id} / {board}")
        board_fingerprint = hashlib.sha256(board.read_bytes()).hexdigest()[:12]
        paths = []
        for view_type, ratios in zip(("front", "side", "back"), crop_ratios(str(spec["profile"])), strict=True):
            path = SOURCE_ROOT / "characters" / asset_id / f"{view_type}-{board_fingerprint}.png"
            write_new_or_identical(path, character_crop_bytes(board, *ratios))
            paths.append(str(path))
        outputs[asset_id] = paths
    return outputs


def build_scene_sources() -> dict[str, str]:
    outputs: dict[str, str] = {}
    for version_id, spec in SCENE_SPECS.items():
        board = Path(spec["board"])
        if not board.is_file():
            raise RuntimeError(f"场景设定板不存在: {version_id} / {board}")
        safe_name = hashlib.sha256(version_id.encode("utf-8")).hexdigest()[:12]
        board_fingerprint = hashlib.sha256(board.read_bytes()).hexdigest()[:12]
        path = SOURCE_ROOT / "scenes" / f"{safe_name}-{board_fingerprint}.png"
        write_new_or_identical(path, scene_crop_bytes(board, str(spec["profile"])))
        outputs[version_id] = str(path)
    return outputs


def assemble_source_document() -> dict[str, Any]:
    versions, names = read_store_versions()
    generation_evidence = preflight_assembly_sources(versions)
    character_paths = build_character_sources()
    scene_paths = build_scene_sources()
    helpers = continuity_helpers()
    assembled: list[dict[str, Any]] = []
    for raw_version in versions:
        version = json.loads(json.dumps(raw_version))
        asset_id = str(version["assetId"])
        version_id = str(version["versionId"])
        for field in (
            "approval", "approvalFingerprint", "approved", "contentFingerprint", "missingFields",
            "reviewEvidencePaths", "reviewEvidenceSha256", "reviewEvidenceVerifiedAt", "reviewStatus",
            "structurallyComplete",
        ):
            version.pop(field, None)
        version["label"] = names.get(asset_id) or str(version.get("label") or version_id)
        version["source"] = "chapter001-v5-full-bible-source"
        if version["assetKind"] == "character":
            spec = CHARACTER_SPECS[asset_id]
            version.update({
                "referenceImagePaths": character_paths[asset_id],
                "referenceImageSha256": [hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in character_paths[asset_id]],
                "referenceViewTypes": ["front", "side", "back"],
                "identityAnchors": {
                    "hairStyle": spec["anchors"][0],
                    "uniqueMarks": list(spec["anchors"]),
                },
                "negativePrompt": {"avoid": list(spec["avoid"])},
                "wardrobeVersion": spec["wardrobe"],
            })
        elif version["assetKind"] == "scene":
            spec = SCENE_SPECS[version_id]
            version.update({
                "referenceImagePaths": [scene_paths[version_id]],
                "referenceImageSha256": [hashlib.sha256(Path(scene_paths[version_id]).read_bytes()).hexdigest()],
                "sceneViewpointId": spec["viewpoint"],
                "spatialLayout": spec["layout"],
                "lightingDesign": spec["light"],
                "colorPalette": spec["palette"],
            })
        else:
            source = PROP_SOURCE_OVERRIDES.get(asset_id, Path(version["referenceImagePaths"][0]))
            if not source.is_file():
                raise RuntimeError(f"道具 source 不存在: {asset_id} / {source}")
            version["referenceImagePaths"] = [str(source)]
            version["referenceImageSha256"] = [hashlib.sha256(source.read_bytes()).hexdigest()]
        normalized = helpers.normalize_continuity_asset_version(version)
        normalized["reviewStatus"] = "pending"
        normalized["approval"] = None
        normalized["approvalFingerprint"] = None
        normalized["approved"] = False
        if normalized.get("structurallyComplete") is not True:
            raise RuntimeError(
                f"组装后仍结构不完整: {asset_id}/{version_id} / {normalized.get('missingFields')}"
            )
        assembled.append(normalized)
    keys = {(item["assetId"], item["versionId"]) for item in assembled}
    if len(assembled) != EXPECTED_VERSION_COUNT or len(keys) != EXPECTED_VERSION_COUNT:
        raise RuntimeError(
            f"组装后的 v5 source 不是 {EXPECTED_VERSION_COUNT} 个唯一版本"
        )
    source_document = {
        "sourceVersion": "v5",
        "versionCount": EXPECTED_VERSION_COUNT,
        "approvalPolicy": "pending-human-only",
        "continuityAssetVersions": assembled,
    }
    source_payload = json_payload(source_document)
    source_sha256 = hashlib.sha256(source_payload).hexdigest()
    source_document_path = SOURCE_ROOT / f"continuity-asset-versions-{source_sha256[:12]}.json"
    write_new_or_identical(source_document_path, source_payload)
    return {
        "ok": True, "versionCount": len(assembled), "structurallyComplete": len(assembled),
        "approved": sum(item.get("approved") is True for item in assembled),
        "sourceDocument": str(source_document_path),
        "sourceSha256": source_sha256,
        "characterReferenceImages": sum(len(paths) for paths in character_paths.values()),
        "sceneReferenceImages": len(scene_paths),
        "generationEvidence": generation_evidence,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--assemble", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = write_plan() if args.plan else assemble_source_document()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
