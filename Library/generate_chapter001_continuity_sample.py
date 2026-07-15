#!/usr/bin/env python3
"""Generate a non-destructive chapter-001 continuity sample.

The runner reuses the production Daojie prompt/reference builders, writes only
to apps/output/automation, and never mutates the real project store or images.
Provider credentials are read from the existing MYSTUDIO_IMAGE_* environment
contract and are never written to the report.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = REPO_ROOT / "Library/build_daojie_chapter001_workflow.py"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "apps/output/automation/daojie-chapter001-continuity-sample"


def load_generator():
    spec = importlib.util.spec_from_file_location("daojie_chapter001_workflow", GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载生成器: {GENERATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_shots(value: str) -> list[int]:
    indexes: set[int] = set()
    for part in value.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            start_text, end_text = token.split("-", 1)
            start, end = int(start_text), int(end_text)
            if start > end:
                raise argparse.ArgumentTypeError(f"镜头范围倒置: {token}")
            indexes.update(range(start, end + 1))
        else:
            indexes.add(int(token))
    if not indexes or min(indexes) < 1 or max(indexes) > 43:
        raise argparse.ArgumentTypeError("镜头范围必须位于 1..43")
    return sorted(indexes)


def stable_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def existing_storyboards(state: dict[str, Any], episode_id: str) -> dict[int, dict[str, Any]]:
    return {
        int(item.get("index") or 0): item
        for item in state.get("storyboards") or []
        if item.get("episodeId") == episode_id and int(item.get("index") or 0) > 0
    }


def continuity_payload(generator, index: int, prompt: str, image_assets: list[dict[str, Any]], existing: dict[str, Any]):
    return generator.build_storyboard_continuity_payload(index, prompt, image_assets, existing)


def continuity_references(generator, image_assets: list[dict[str, Any]], manifest: list[dict[str, Any]]):
    assets = generator.apply_continuity_manifest_to_image_assets(image_assets, manifest)
    return generator.collect_storyboard_reference_images(assets)


def build_contact_sheet(image_paths: list[Path], output_path: Path) -> None:
    thumb_size = (480, 270)
    label_height = 38
    columns = 2
    rows = (len(image_paths) + columns - 1) // columns
    sheet = Image.new("RGB", (thumb_size[0] * columns, (thumb_size[1] + label_height) * rows), "#eee9df")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for offset, path in enumerate(image_paths):
        image = Image.open(path).convert("RGB")
        image = ImageOps.fit(image, thumb_size, method=Image.Resampling.LANCZOS)
        x = (offset % columns) * thumb_size[0]
        y = (offset // columns) * (thumb_size[1] + label_height)
        sheet.paste(image, (x, y))
        draw.text((x + 12, y + thumb_size[1] + 10), path.stem, fill="#171717", font=font)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, quality=92)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shots", type=parse_shots, default=parse_shots("6-12"))
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    generator = load_generator()
    store = generator.load_json(generator.STORE)
    state = store.setdefault("state", {})
    source = generator.resolve_storyboard_source(state, generator.EPISODE_ID)
    shots = source["shots"]
    catalog = generator.build_asset_catalog(state)
    existing = existing_storyboards(state, generator.EPISODE_ID)
    config = generator.storyboard_image_provider_config()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    generated_paths: list[Path] = []
    entries: list[dict[str, Any]] = []

    for index in args.shots:
        shot = shots[index - 1]
        scene, prompt, _speaker, _text, _sound, assets, _duration = generator.shot_tuple(shot)
        image_assets = generator.resolve_image_assets(scene, assets, catalog)
        manifest, versions, continuity_state = continuity_payload(
            generator,
            index,
            prompt,
            image_assets,
            existing.get(index, {}),
        )
        unapproved_versions = [item for item in versions if item.get("approved") is not True]
        if unapproved_versions and not args.dry_run:
            details = "、".join(
                f"{item.get('assetId')}({','.join(item.get('missingFields') or ['未批准'])})"
                for item in unapproved_versions
            )
            raise RuntimeError(f"分镜 {index:03d} 连续性资产版本未批准: {details}")
        references = continuity_references(generator, image_assets, manifest)
        final_prompt = generator.build_storyboard_image_prompt(
            {
                "id": f"sb-{generator.EPISODE_ID}-{index:03d}",
                "index": index,
                "sceneNo": shot.get("sceneNo", 1),
                "prompt": prompt,
                "continuityState": continuity_state,
            },
            references,
        )
        audit = generator.build_storyboard_prompt_audit(
            {"id": f"sb-{generator.EPISODE_ID}-{index:03d}", "index": index},
            final_prompt,
            references,
            prompt,
        )
        generator.assert_storyboard_prompt_audit(audit)
        output_path = output_dir / f"shot-{index:03d}.png"
        if not args.dry_run:
            prepared = [generator.prepare_storyboard_model_reference_image(item["imageUrl"]) for item in references]
            result_url = generator.request_storyboard_image_generation(final_prompt, prepared, config)
            generator.save_generated_image_url(result_url, output_path)
            generated_paths.append(output_path)
        entries.append({
            "index": index,
            "storyboardId": f"sb-{generator.EPISODE_ID}-{index:03d}",
            "outputPath": str(output_path),
            "outputSha256": stable_sha256(output_path) if output_path.exists() else None,
            "prompt": final_prompt,
            "referenceManifest": manifest,
            "continuityState": continuity_state,
            "assetVersionsApproved": all(item.get("approved") is True for item in versions),
            "promptAudit": audit,
        })

    contact_sheet = output_dir / "contact-sheet.jpg"
    if generated_paths:
        build_contact_sheet(generated_paths, contact_sheet)
    report = {
        "ok": True,
        "dryRun": args.dry_run,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": str(generator.PROJECT),
        "sourceKind": source["kind"],
        "provider": {
            "name": config.get("providerName") or generator.storyboard_image_generation_provider(),
            "baseUrl": config.get("baseUrl"),
            "model": config.get("model"),
            "aspectRatio": config.get("aspectRatio"),
            "resolution": config.get("resolution"),
        },
        "shots": args.shots,
        "generatedImages": len(generated_paths),
        "contactSheet": str(contact_sheet) if generated_paths else None,
        "mutatedProductionProject": False,
        "entries": entries,
    }
    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "dryRun": args.dry_run,
        "generatedImages": len(generated_paths),
        "report": str(report_path),
        "contactSheet": str(contact_sheet) if generated_paths else None,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise
