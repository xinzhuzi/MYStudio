from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any


class RuntimeStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.audio_dir = data_dir / "audio"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = data_dir / "tts.sqlite"
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.execute(
                """
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
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS generations (
                    id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    language TEXT,
                    engine TEXT NOT NULL,
                    model_size TEXT,
                    status TEXT NOT NULL,
                    audio_path TEXT,
                    duration REAL DEFAULT 0,
                    backend TEXT DEFAULT '',
                    mocked INTEGER DEFAULT 0,
                    warning TEXT,
                    error TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            self._ensure_profile_columns(conn)
            self._ensure_generation_columns(conn)

    def _ensure_profile_columns(self, conn: sqlite3.Connection):
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(profiles)").fetchall()}
        migrations = {
            "instruct": "ALTER TABLE profiles ADD COLUMN instruct TEXT",
        }
        for column, statement in migrations.items():
            if column not in columns:
                conn.execute(statement)

    def _ensure_generation_columns(self, conn: sqlite3.Connection):
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(generations)").fetchall()}
        migrations = {
            "backend": "ALTER TABLE generations ADD COLUMN backend TEXT DEFAULT ''",
            "mocked": "ALTER TABLE generations ADD COLUMN mocked INTEGER DEFAULT 0",
            "warning": "ALTER TABLE generations ADD COLUMN warning TEXT",
        }
        for column, statement in migrations.items():
            if column not in columns:
                conn.execute(statement)

    @staticmethod
    def _now_ms() -> int:
        import time

        return int(time.time() * 1000)

    @staticmethod
    def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
        return dict(row) if row is not None else None

    def list_profiles(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM profiles ORDER BY created_at ASC").fetchall()
        return [dict(row) for row in rows]

    def get_profile(self, profile_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
        return self._row_to_dict(row)

    def create_profile(self, payload: dict[str, Any]) -> dict:
        now = self._now_ms()
        profile = {
            "id": payload.get("id") or str(uuid.uuid4()),
            "name": payload.get("name") or "Voice Profile",
            "voice_type": payload.get("voice_type") or payload.get("type") or "reference",
            "language": payload.get("language") or "zh",
            "default_engine": payload.get("default_engine") or payload.get("defaultEngine") or "qwen",
            "default_model_size": payload.get("default_model_size") or payload.get("defaultModelSize") or "0.6B",
            "reference_audio_path": payload.get("reference_audio_path") or payload.get("referenceAudioPath"),
            "reference_text": payload.get("reference_text") or payload.get("referenceText"),
            "preset_voice_id": payload.get("preset_voice_id") or payload.get("presetVoiceId"),
            "instruct": payload.get("instruct") or payload.get("style_instruction") or payload.get("styleInstruction"),
            "created_at": now,
            "updated_at": now,
        }
        existing = self.get_profile(profile["id"])
        if existing:
            profile["created_at"] = existing["created_at"]
            with self._connect() as conn:
                conn.execute(
                    """
                    UPDATE profiles
                    SET name = :name,
                        voice_type = :voice_type,
                        language = :language,
                        default_engine = :default_engine,
                        default_model_size = :default_model_size,
                        reference_audio_path = :reference_audio_path,
                        reference_text = :reference_text,
                        preset_voice_id = :preset_voice_id,
                        instruct = :instruct,
                        updated_at = :updated_at
                    WHERE id = :id
                    """,
                    profile,
                )
            return self.get_profile(profile["id"]) or profile
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO profiles (
                    id, name, voice_type, language, default_engine, default_model_size,
                    reference_audio_path, reference_text, preset_voice_id, instruct, created_at, updated_at
                ) VALUES (
                    :id, :name, :voice_type, :language, :default_engine, :default_model_size,
                    :reference_audio_path, :reference_text, :preset_voice_id, :instruct, :created_at, :updated_at
                )
                """,
                profile,
            )
        return profile

    def create_generation(self, profile_id: str, text: str, engine: str, model_size: str | None, language: str = "zh") -> dict:
        now = self._now_ms()
        generation = {
            "id": str(uuid.uuid4()),
            "profile_id": profile_id,
            "text": text,
            "language": language,
            "engine": engine,
            "model_size": model_size,
            "status": "generating",
            "audio_path": "",
            "duration": 0,
            "backend": "",
            "mocked": 0,
            "warning": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO generations VALUES (
                    :id, :profile_id, :text, :language, :engine, :model_size, :status,
                    :audio_path, :duration, :backend, :mocked, :warning, :error, :created_at, :updated_at
                )
                """,
                generation,
            )
        return generation

    def get_generation(self, generation_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM generations WHERE id = ?", (generation_id,)).fetchone()
        return self._row_to_dict(row)

    def update_generation(self, generation_id: str, **updates: Any) -> dict | None:
        if not updates:
            return self.get_generation(generation_id)
        updates["updated_at"] = self._now_ms()
        assignments = ", ".join(f"{key} = ?" for key in updates)
        values = list(updates.values())
        values.append(generation_id)
        with self._connect() as conn:
            conn.execute(f"UPDATE generations SET {assignments} WHERE id = ?", values)
        return self.get_generation(generation_id)

    def export_debug(self) -> str:
        return json.dumps(
            {
                "profiles": self.list_profiles(),
            },
            ensure_ascii=False,
            indent=2,
        )
