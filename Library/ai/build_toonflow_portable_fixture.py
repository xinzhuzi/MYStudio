#!/usr/bin/env python3
"""Build a content-addressed, read-only Toonflow chapter-001 fixture.

The Toonflow database stores paths relative to ``data/oss``.  This utility
resolves those paths, verifies every storyboard/reference/golden image, and
copies immutable evidence into the active Trellis task directory.  No
production project data is changed and no image provider is contacted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path
from typing import Any

from PIL import Image


DEFAULT_DATABASE = Path("/Users/zhengbingjin/Library/Application Support/toonflow/data/db2.sqlite")
DEFAULT_OUTPUT = Path(
    ".trellis/tasks/07-12-mystudio-chapter001-visual-continuity/research/toonflow-chapter001-portable-fixture.json"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pixel_sha256(path: Path) -> tuple[str, int, int]:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        return hashlib.sha256(rgba.tobytes()).hexdigest(), rgba.width, rgba.height


def resolve_oss_path(data_root: Path, raw_path: str) -> Path | None:
    value = str(raw_path or "").strip()
    if not value:
        return None
    resolved_data_root = data_root.resolve()
    direct = Path(value)
    candidates = [
        direct if direct.is_absolute() else None,
        data_root / "oss" / value.lstrip("/"),
        data_root / value.lstrip("/"),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        resolved = candidate.resolve()
        if not direct.is_absolute() and not resolved.is_relative_to(resolved_data_root):
            continue
        if resolved.is_file():
            return resolved
    return None


def content_addressed_copy(source: Path, destination_dir: Path) -> dict[str, Any]:
    file_sha = sha256_file(source)
    suffix = source.suffix.lower() or ".bin"
    destination = destination_dir / f"{file_sha}{suffix}"
    destination_dir.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if sha256_file(destination) != file_sha:
            raise RuntimeError(f"fixture destination hash collision: {destination}")
    else:
        shutil.copy2(source, destination)
    pixel_sha, width, height = pixel_sha256(destination)
    return {
        "relativePath": destination.name,
        "sha256": file_sha,
        "pixelSha256": pixel_sha,
        "bytes": destination.stat().st_size,
        "width": width,
        "height": height,
    }


def resolve_image(data_root: Path, raw_path: str, label: str) -> Path:
    resolved = resolve_oss_path(data_root, raw_path)
    if resolved is None:
        raise RuntimeError(f"{label} image path is missing: {raw_path}")
    return resolved


def build_fixture(database: Path, output_manifest: Path) -> dict[str, Any]:
    database = database.resolve()
    output_manifest = output_manifest.resolve()
    data_root = database.parent
    fixture_root = output_manifest.parent / output_manifest.stem
    golden_dir = fixture_root / "golden"
    references_dir = fixture_root / "references"
    fixture_root.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        storyboards = list(
            connection.execute(
                'select id, "index", prompt, videoDesc, filePath, shouldGenerateImage '
                'from o_storyboard order by cast("index" as integer)'
            )
        )
        links = list(
            connection.execute(
                'select l.rowid as linkOrder, s.id as storyboardId, a.id as assetId, '
                'a.imageId as imageId, i.filePath as imagePath '
                'from o_assets2Storyboard l '
                'join o_storyboard s on s.id = l.storyboardId '
                'join o_assets a on a.id = l.assetId '
                'left join o_image i on i.id = a.imageId '
                'order by cast(s."index" as integer), l.rowid'
            )
        )

    if len(storyboards) != 43:
        raise RuntimeError(f"expected 43 Toonflow storyboards, found {len(storyboards)}")

    links_by_storyboard: dict[int, list[sqlite3.Row]] = {}
    for link in links:
        links_by_storyboard.setdefault(int(link["storyboardId"]), []).append(link)

    rows: list[dict[str, Any]] = []
    missing = 0
    for raw in storyboards:
        index = int(raw["index"]) + 1
        golden_source = resolve_image(data_root, raw["filePath"], f"storyboard {index:03d}")
        golden = {**content_addressed_copy(golden_source, golden_dir), "verified": True}
        references: list[dict[str, Any]] = []
        for order, link in enumerate(links_by_storyboard.get(int(raw["id"]), []), start=1):
            raw_reference_path = str(link["imagePath"] or "")
            reference_source = resolve_image(
                data_root,
                raw_reference_path,
                f"storyboard {index:03d} reference {order}",
            )
            reference = content_addressed_copy(reference_source, references_dir)
            references.append(
                {
                    "order": order,
                    "assetId": str(link["assetId"]),
                    "imageId": str(link["imageId"]) if link["imageId"] is not None else None,
                    "sourcePath": raw_reference_path,
                    **reference,
                }
            )
        rows.append(
            {
                "id": str(raw["id"]),
                "index": index,
                "prompt": str(raw["prompt"] or ""),
                "videoDesc": str(raw["videoDesc"] or ""),
                "shouldGenerateImage": bool(raw["shouldGenerateImage"]),
                "goldenImage": {
                    "sourcePath": str(raw["filePath"]),
                    **golden,
                },
                "referenceAssetIds": [item["assetId"] for item in references],
                "referenceImagePaths": [f"references/{item['relativePath']}" for item in references],
                "referenceImageSha256": [item["sha256"] for item in references],
                "references": references,
            }
        )

    manifest = {
        "schemaVersion": 1,
        "kind": "toonflow-chapter001-portable-fixture",
        "readOnly": True,
        "database": {
            "sourcePath": str(database),
            "sha256": sha256_file(database),
            "storyboardCount": len(rows),
        },
        "fixtureRoot": os.path.relpath(fixture_root, output_manifest.parent),
        "storyboardRows": rows,
        "verification": {
            "storyboardCount": len(rows),
            "goldenImageCount": sum(bool(row.get("goldenImage")) for row in rows),
            "missingImageCount": missing,
            "referenceCount": sum(len(row["references"]) for row in rows),
            "goldenPixelSha256Verified": True,
            "contentAddressed": True,
        },
    }
    output_manifest.parent.mkdir(parents=True, exist_ok=True)
    output_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def verify_fixture(manifest_path: Path) -> dict[str, Any]:
    manifest_path = manifest_path.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    fixture_root_value = Path(str(manifest["fixtureRoot"]))
    fixture_root = (
        fixture_root_value
        if fixture_root_value.is_absolute()
        else manifest_path.parent / fixture_root_value
    ).resolve()
    rows = manifest.get("storyboardRows") or []
    if len(rows) != 43:
        raise RuntimeError(f"fixture storyboard count is not 43: {len(rows)}")
    reference_count = 0
    for row in rows:
        golden = row.get("goldenImage") or {}
        golden_path = fixture_root / "golden" / str(golden.get("relativePath") or "")
        if not golden_path.is_file() or sha256_file(golden_path) != golden.get("sha256"):
            raise RuntimeError(f"golden image digest mismatch for storyboard {row.get('index')}")
        actual_pixel_sha, width, height = pixel_sha256(golden_path)
        if actual_pixel_sha != golden.get("pixelSha256") or width != golden.get("width") or height != golden.get("height"):
            raise RuntimeError(f"golden image pixel digest mismatch for storyboard {row.get('index')}")
        if golden.get("verified") is not True:
            raise RuntimeError(f"golden image is not marked verified for storyboard {row.get('index')}")
        references = row.get("references") or []
        for reference in references:
            reference_count += 1
            reference_path = fixture_root / "references" / str(reference.get("relativePath") or "")
            if not reference_path.is_file() or sha256_file(reference_path) != reference.get("sha256"):
                raise RuntimeError(f"reference digest mismatch for storyboard {row.get('index')}")
    return {
        "storyboardCount": len(rows),
        "goldenImageCount": len(rows),
        "referenceCount": reference_count,
        "goldenPixelSha256Verified": True,
        "contentAddressed": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    manifest = build_fixture(args.database, args.output)
    verified = verify_fixture(args.output)
    print(json.dumps({**manifest["verification"], "verified": verified}, ensure_ascii=False, sort_keys=True))
    print(f"manifest={args.output.resolve()}")


if __name__ == "__main__":
    main()
