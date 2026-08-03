#!/usr/bin/env python3
"""Import the reviewed Mucheng voice references into MYStudio's local stores.

The external voice-library directory remains the source of truth. This script
only creates or verifies the managed asset files and the matching TTS profiles.
It is deliberately fail-closed: an existing name/id or managed file with a
different source is never silently overwritten.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


IMPORTS = {
    "平静": {
        "code": "calm",
        "asset_id": "voice-asset-mucheng-calm",
        "profile_id": "voice-profile-mucheng-calm",
        "name": "木成·平静｜高潮·战斗·诗歌",
        "usage": "高潮、战斗、诗歌/念白",
        "tags": ["木成", "平静", "高潮", "战斗", "诗歌"],
    },
    "悲伤": {
        "code": "sad",
        "asset_id": "voice-asset-mucheng-sad",
        "profile_id": "voice-profile-mucheng-sad",
        "name": "木成·悲伤｜平铺直叙·旁白·次要角色",
        "usage": "平铺直叙、旁白、次要角色",
        "tags": ["木成", "悲伤", "旁白", "平铺直叙", "次要角色"],
    },
    "兴奋": {
        "code": "excited",
        "asset_id": "voice-asset-mucheng-excited",
        "profile_id": "voice-profile-mucheng-excited",
        "name": "木成·兴奋｜平铺直叙·旁白·次要角色",
        "usage": "平铺直叙、旁白、次要角色",
        "tags": ["木成", "兴奋", "旁白", "平铺直叙", "次要角色"],
    },
    "愤怒": {
        "code": "angry",
        "asset_id": "voice-asset-mucheng-angry",
        "profile_id": "voice-profile-mucheng-angry",
        "name": "木成·愤怒｜高潮·战斗·诗歌",
        "usage": "高潮、战斗、诗歌/念白",
        "tags": ["木成", "愤怒", "高潮", "战斗", "诗歌"],
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library-root", type=Path, required=True)
    parser.add_argument("--assets-db", type=Path, required=True)
    parser.add_argument("--tts-db", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def load_manifest(root: Path) -> dict[str, Any]:
    manifest = json.loads((root / "library-manifest.json").read_text(encoding="utf-8"))
    refs = {
        item["emotion"]: item
        for item in manifest.get("references", [])
        if item.get("reviewStatus") == "approved"
    }
    missing = sorted(set(IMPORTS) - set(refs))
    if missing:
        raise RuntimeError(f"approved refs missing from manifest: {', '.join(missing)}")
    return {"manifest": manifest, "refs": refs}


def ensure_db(path: Path, schema: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(schema)


ASSET_SCHEMA = """
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  setting TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  filePath TEXT,
  images TEXT DEFAULT '[]',
  source TEXT DEFAULT 'manying-local',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
"""

TTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  voice_type TEXT NOT NULL,
  language TEXT NOT NULL,
  default_engine TEXT,
  default_model_size TEXT,
  reference_audio_path TEXT,
  reference_text TEXT,
  preset_voice_id TEXT,
  instruct TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
"""


def import_one(
    *,
    emotion: str,
    spec: dict[str, Any],
    ref: dict[str, Any],
    root: Path,
    assets_conn: sqlite3.Connection,
    tts_conn: sqlite3.Connection,
    apply: bool,
) -> dict[str, Any]:
    source = root / ref["path"]
    expected_sha = ref["sha256"]
    if not source.is_file():
        raise RuntimeError(f"missing reference: {source}")
    actual_sha = sha256(source)
    if actual_sha != expected_sha:
        raise RuntimeError(f"source SHA mismatch for {emotion}: {actual_sha} != {expected_sha}")

    asset_db_dir = Path(assets_conn.execute("PRAGMA database_list").fetchone()[2]).parent
    managed = asset_db_dir / "files" / "audio" / f"{spec['asset_id']}.wav"
    rel_path = f"audio/{spec['asset_id']}.wav"
    if managed.exists() and sha256(managed) != expected_sha:
        raise RuntimeError(f"managed asset SHA mismatch; refusing overwrite: {managed}")

    source_record = {
        "sourceLibrary": str(root),
        "sourceReference": ref["path"],
        "sourceSha256": expected_sha,
        "emotion": emotion,
        "usage": spec["usage"],
        "referenceText": ref["referenceText"],
        "profileId": spec["profile_id"],
    }
    description = ref["referenceText"]
    setting = f"用途：{spec['usage']}；外部音色库真源：{root}；来源SHA-256：{expected_sha}"
    remark = json.dumps(source_record, ensure_ascii=False, sort_keys=True)
    tags = json.dumps(spec["tags"], ensure_ascii=False)
    now = datetime.now(timezone.utc).isoformat()

    asset_row = assets_conn.execute("SELECT * FROM assets WHERE id = ?", (spec["asset_id"],)).fetchone()
    if asset_row is None:
        conflict = assets_conn.execute("SELECT id FROM assets WHERE type = 'audio' AND name = ?", (spec["name"],)).fetchone()
        if conflict:
            raise RuntimeError(f"asset name already belongs to another row: {spec['name']}")
        action = "create"
        if apply:
            managed.parent.mkdir(parents=True, exist_ok=True)
            if not managed.exists():
                shutil.copy2(source, managed)
            assets_conn.execute(
                """INSERT INTO assets
                (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (spec["asset_id"], "audio", spec["name"], description, "", setting, remark, tags,
                 rel_path, "[]", "manying-local", now, now),
            )
    else:
        action = "verify"
        if asset_row["type"] != "audio":
            raise RuntimeError(f"asset id collision: {spec['asset_id']}")
        existing_metadata = json.loads(asset_row["remark"] or "{}")
        if existing_metadata.get("sourceSha256") != expected_sha:
            raise RuntimeError(f"asset id has a different source: {spec['asset_id']}")
        if apply and asset_row["name"] != spec["name"]:
            assets_conn.execute(
                """UPDATE assets SET name = ?, description = ?, setting = ?, remark = ?, tags = ?, updatedAt = ?
                   WHERE id = ?""",
                (spec["name"], description, setting, remark, tags, now, spec["asset_id"]),
            )
        if apply and not managed.exists():
            managed.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, managed)
            assets_conn.execute("UPDATE assets SET filePath = ?, updatedAt = ? WHERE id = ?", (rel_path, now, spec["asset_id"]))

    profile_row = tts_conn.execute("SELECT * FROM profiles WHERE id = ?", (spec["profile_id"],)).fetchone()
    managed_path = str(managed)
    profile_values = (spec["profile_id"], spec["name"], "reference", "zh", "qwen", "1.7B", managed_path, ref["referenceText"], None, None)
    if profile_row is None:
        conflict = tts_conn.execute("SELECT id FROM profiles WHERE name = ?", (spec["name"],)).fetchone()
        if conflict:
            raise RuntimeError(f"profile name already belongs to another row: {spec['name']}")
        if apply:
            created = int(datetime.now(timezone.utc).timestamp() * 1000)
            tts_conn.execute(
                """INSERT INTO profiles
                (id,name,voice_type,language,default_engine,default_model_size,reference_audio_path,reference_text,preset_voice_id,instruct,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (*profile_values, created, created),
            )
        profile_action = "create"
    else:
        profile_action = "verify"
        if tuple(profile_row[key] for key in ("voice_type", "language", "default_engine", "default_model_size", "reference_audio_path", "reference_text")) != profile_values[2:8]:
            raise RuntimeError(f"profile id collision or changed contract: {spec['profile_id']}")
        if apply and profile_row["name"] != spec["name"]:
            tts_conn.execute("UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?", (spec["name"], int(datetime.now(timezone.utc).timestamp() * 1000), spec["profile_id"]))

    return {
        "emotion": emotion,
        "name": spec["name"],
        "assetId": spec["asset_id"],
        "profileId": spec["profile_id"],
        "sourcePath": str(source),
        "sourceSha256": expected_sha,
        "managedAssetPath": managed_path,
        "managedAssetSha256": expected_sha,
        "referenceText": ref["referenceText"],
        "usage": spec["usage"],
        "assetAction": action,
        "profileAction": profile_action,
    }


def main() -> int:
    args = parse_args()
    loaded = load_manifest(args.library_root)
    if not args.apply:
        print(json.dumps({"dryRun": True, "emotions": sorted(IMPORTS), "source": str(args.library_root)}, ensure_ascii=False, indent=2))
        return 0

    ensure_db(args.assets_db, ASSET_SCHEMA)
    ensure_db(args.tts_db, TTS_SCHEMA)
    with sqlite3.connect(args.assets_db) as assets_conn, sqlite3.connect(args.tts_db) as tts_conn:
        assets_conn.row_factory = sqlite3.Row
        tts_conn.row_factory = sqlite3.Row
        rows = [import_one(emotion=emotion, spec=IMPORTS[emotion], ref=loaded["refs"][emotion], root=args.library_root,
                           assets_conn=assets_conn, tts_conn=tts_conn, apply=True) for emotion in IMPORTS]

    for row in rows:
        managed = Path(row["managedAssetPath"])
        row["managedAssetSha256"] = sha256(managed)
        if row["managedAssetSha256"] != row["sourceSha256"]:
            raise RuntimeError(f"post-import SHA mismatch: {managed}")
    evidence = {
        "schemaVersion": 1,
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "sourceLibrary": str(args.library_root),
        "assetsDb": str(args.assets_db),
        "ttsDb": str(args.tts_db),
        "sourceOfTruth": "external-library",
        "rows": rows,
    }
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
