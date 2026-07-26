"""Build a read-only, self-contained visual review packet from existing evidence.

This tool never reads provider credentials, calls a generation endpoint, or
mutates the production project store. It copies already-generated media review
thumbnails into a new packet directory, verifies hashes, and creates labelled
contact sheets for human review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageOps


CONTACT_SHEET_GROUP_SIZE = 4
THUMBNAIL_MAX_BYTES = 1_000_000


def stable_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON 根节点必须是对象: {path}")
    return value


def ensure_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"{label} 不存在: {path}")


def validate_image(path: Path, label: str) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            return image.size
    except Exception as error:  # pragma: no cover - Pillow supplies the detail
        raise ValueError(f"{label} 不是有效图片: {path}: {error}") from error


def validate_store_alignment(store_path: Path, source_manifest: dict[str, Any]) -> None:
    store = load_json(store_path)
    state = store.get("state") if isinstance(store.get("state"), dict) else store
    storyboards = state.get("storyboards") if isinstance(state, dict) else None
    if not isinstance(storyboards, list):
        raise ValueError(f"store 缺少 storyboards: {store_path}")
    by_id = {
        str(item.get("id")): item
        for item in storyboards
        if isinstance(item, dict) and item.get("id")
    }
    source_shots = source_manifest.get("shots")
    if not isinstance(source_shots, list) or not source_shots:
        raise ValueError("审核包 manifest 缺少 shots")
    for shot in source_shots:
        if not isinstance(shot, dict):
            raise ValueError("审核包 manifest 含无效 shot")
        storyboard_id = str(shot.get("storyboardId") or "")
        storyboard = by_id.get(storyboard_id)
        if storyboard is None:
            raise ValueError(f"store 缺少审核包分镜: {storyboard_id}")
        if storyboard.get("mediaRef", {}).get("path") != shot.get("mediaPath"):
            raise ValueError(f"store 与审核包画面路径不一致: {storyboard_id}")
        if storyboard.get("visualReview") != shot.get("visualReview"):
            raise ValueError(f"store 与审核包审核状态不一致: {storyboard_id}")
        if storyboard.get("stale") != shot.get("stale"):
            raise ValueError(f"store 与审核包 stale 状态不一致: {storyboard_id}")


def draw_contact_sheet(image_paths: list[Path], labels: list[str], output_path: Path) -> None:
    if len(image_paths) != len(labels):
        raise ValueError("contact sheet 图片与标签数量不一致")
    cell_width, cell_height, label_height = 480, 270, 38
    columns = 2
    rows = (len(image_paths) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows * (cell_height + label_height)), "#101014")
    draw = ImageDraw.Draw(sheet)
    for index, (image_path, label) in enumerate(zip(image_paths, labels)):
        with Image.open(image_path).convert("RGB") as image:
            fitted = ImageOps.fit(image, (cell_width, cell_height), method=Image.Resampling.LANCZOS)
            x = (index % columns) * cell_width
            y = (index // columns) * (cell_height + label_height)
            sheet.paste(fitted, (x, y))
            draw.text((x + 8, y + cell_height + 8), label, fill="#f4f4f5")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="JPEG", quality=92, optimize=True)


def build_packet(source_manifest_path: Path, output_dir: Path, store_path: Path | None = None) -> dict[str, Any]:
    source_manifest_path = source_manifest_path.resolve()
    output_dir = output_dir.resolve()
    ensure_file(source_manifest_path, "源审核包 manifest")
    if output_dir == source_manifest_path.parent:
        raise ValueError("输出目录不能覆盖源审核包目录")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(f"输出目录必须为空: {output_dir}")
    source_manifest = load_json(source_manifest_path)
    source_shots = source_manifest.get("shots")
    if not isinstance(source_shots, list) or not source_shots:
        raise ValueError("源审核包 manifest 缺少 shots")
    if store_path is not None:
        validate_store_alignment(store_path.resolve(), source_manifest)

    thumbs_dir = output_dir / "thumbs"
    sheets_dir = output_dir / "contact-sheets"
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    sheets_dir.mkdir(parents=True, exist_ok=True)
    packet_shots: list[dict[str, Any]] = []
    copied_thumbs: list[Path] = []
    for shot in sorted(source_shots, key=lambda item: int(item.get("index") or 0)):
        if not isinstance(shot, dict):
            raise ValueError("源审核包 manifest 含无效 shot")
        index = int(shot.get("index") or 0)
        storyboard_id = str(shot.get("storyboardId") or "")
        if index <= 0 or not storyboard_id:
            raise ValueError("shot 缺少 index/storyboardId")
        media_path = Path(str(shot.get("mediaPath") or ""))
        thumb_path = Path(str(shot.get("thumbnailPath") or ""))
        ensure_file(media_path, f"分镜 {index:03d} 原图")
        ensure_file(thumb_path, f"分镜 {index:03d} 审核缩略图")
        media_sha256 = stable_sha256(media_path)
        expected_media_sha256 = str(shot.get("mediaSha256") or "")
        if expected_media_sha256 and media_sha256 != expected_media_sha256:
            raise ValueError(f"分镜 {index:03d} 原图 SHA-256 不匹配")
        thumb_bytes = thumb_path.stat().st_size
        if thumb_bytes >= THUMBNAIL_MAX_BYTES or not thumb_path.name.endswith("_thumb.png"):
            raise ValueError(f"分镜 {index:03d} 审核缩略图未通过安全门")
        thumb_width, thumb_height = validate_image(thumb_path, f"分镜 {index:03d} 审核缩略图")
        copied_thumb = thumbs_dir / f"shot-{index:03d}_thumb.png"
        shutil.copy2(thumb_path, copied_thumb)
        copied_thumbs.append(copied_thumb)
        packet_shots.append({
            "index": index,
            "storyboardId": storyboard_id,
            "mediaPath": str(media_path),
            "mediaSha256": media_sha256,
            "visualReview": shot.get("visualReview"),
            "stale": shot.get("stale") is True,
            "staleReason": shot.get("staleReason"),
            "prompt": shot.get("prompt"),
            "thumbnailPath": str(copied_thumb),
            "thumbnailBytes": copied_thumb.stat().st_size,
            "thumbnailSha256": stable_sha256(copied_thumb),
            "thumbnailWidth": thumb_width,
            "thumbnailHeight": thumb_height,
        })

    contact_sheets: list[str] = []
    for start in range(0, len(copied_thumbs), CONTACT_SHEET_GROUP_SIZE):
        group = copied_thumbs[start:start + CONTACT_SHEET_GROUP_SIZE]
        labels = [f"第 {index:03d} 镜" for index in range(start + 1, start + len(group) + 1)]
        sheet_path = sheets_dir / f"shots-{start + 1:03d}-{start + len(group):03d}.jpg"
        draw_contact_sheet(group, labels, sheet_path)
        contact_sheets.append(str(sheet_path))

    packet = {
        "schemaVersion": 1,
        "generatedFrom": str(source_manifest_path),
        "storePath": str(store_path.resolve()) if store_path else None,
        "shotCount": len(packet_shots),
        "contactSheets": contact_sheets,
        "shots": packet_shots,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "ok": True,
        "outputDir": str(output_dir),
        "shotCount": len(packet_shots),
        "contactSheetCount": len(contact_sheets),
        "thumbnailCount": len(copied_thumbs),
        "productionStoreMutated": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="从现有 43 镜证据生成只读人工审核包")
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--store", type=Path)
    args = parser.parse_args()
    print(json.dumps(build_packet(args.source_manifest, args.output_dir, args.store), ensure_ascii=False))


if __name__ == "__main__":
    main()
