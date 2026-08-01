from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from collections.abc import Iterator
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

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

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
            "project_id": "ALTER TABLE generations ADD COLUMN project_id TEXT",
            "chapter_id": "ALTER TABLE generations ADD COLUMN chapter_id TEXT",
            "shot_id": "ALTER TABLE generations ADD COLUMN shot_id TEXT",
            "shot_revision": "ALTER TABLE generations ADD COLUMN shot_revision INTEGER",
            "input_fingerprint": "ALTER TABLE generations ADD COLUMN input_fingerprint TEXT",
            "reference_audio_sha256": "ALTER TABLE generations ADD COLUMN reference_audio_sha256 TEXT",
            "seed": "ALTER TABLE generations ADD COLUMN seed INTEGER",
            "attempt": "ALTER TABLE generations ADD COLUMN attempt INTEGER DEFAULT 1",
            "retryable": "ALTER TABLE generations ADD COLUMN retryable INTEGER DEFAULT 0",
            "error_code": "ALTER TABLE generations ADD COLUMN error_code TEXT",
            "generation_kind": "ALTER TABLE generations ADD COLUMN generation_kind TEXT",
        }
        for column, statement in migrations.items():
            if column not in columns:
                conn.execute(statement)
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS generations_input_fingerprint_unique
            ON generations(input_fingerprint)
            WHERE input_fingerprint IS NOT NULL AND input_fingerprint != ''
            """
        )

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
        generation, _action = self.create_or_reuse_generation(
            profile_id=profile_id,
            text=text,
            engine=engine,
            model_size=model_size,
            language=language,
        )
        return generation

    def create_or_reuse_generation(
        self,
        *,
        profile_id: str,
        text: str,
        engine: str,
        model_size: str | None,
        language: str = "zh",
        project_id: str | None = None,
        chapter_id: str | None = None,
        shot_id: str | None = None,
        shot_revision: int | None = None,
        input_fingerprint: str | None = None,
        reference_audio_sha256: str | None = None,
        generation_kind: str | None = None,
        seed: int | None = None,
        retry_failed: bool = False,
    ) -> tuple[dict, str]:
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
            "project_id": project_id,
            "chapter_id": chapter_id,
            "shot_id": shot_id,
            "shot_revision": shot_revision,
            "input_fingerprint": input_fingerprint,
            "reference_audio_sha256": reference_audio_sha256,
            "generation_kind": generation_kind,
            "seed": seed,
            "attempt": 1,
            "retryable": 0,
            "error_code": None,
            "created_at": now,
            "updated_at": now,
        }
        with self._connect() as conn:
            # Serialize the fingerprint lookup and insert. Without an immediate
            # transaction, two renderer workers can both miss the row and one
            # then fails the unique index instead of reusing the logical job.
            conn.execute("BEGIN IMMEDIATE")
            if input_fingerprint:
                existing_row = conn.execute(
                    "SELECT * FROM generations WHERE input_fingerprint = ?",
                    (input_fingerprint,),
                ).fetchone()
                if existing_row is not None:
                    existing = dict(existing_row)
                    self._assert_same_generation_input(existing, generation)
                    if existing["status"] not in {"failed", "canceled"} or not retry_failed:
                        return existing, "reused"
                    next_attempt = max(1, int(existing.get("attempt") or 1)) + 1
                    conn.execute(
                        """
                        UPDATE generations
                        SET status = 'generating', audio_path = '', duration = 0,
                            backend = '', mocked = 0, warning = NULL, error = NULL,
                            retryable = 0, error_code = NULL, attempt = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (next_attempt, now, existing["id"]),
                    )
                    restarted_row = conn.execute(
                        "SELECT * FROM generations WHERE id = ?",
                        (existing["id"],),
                    ).fetchone()
                    return dict(restarted_row), "restarted"
            conn.execute(
                """
                INSERT INTO generations (
                    id, profile_id, text, language, engine, model_size, status,
                    audio_path, duration, backend, mocked, warning, error,
                    created_at, updated_at, project_id, chapter_id, shot_id,
                    shot_revision, input_fingerprint, reference_audio_sha256,
                    generation_kind, seed, attempt, retryable, error_code
                ) VALUES (
                    :id, :profile_id, :text, :language, :engine, :model_size, :status,
                    :audio_path, :duration, :backend, :mocked, :warning, :error,
                    :created_at, :updated_at, :project_id, :chapter_id, :shot_id,
                    :shot_revision, :input_fingerprint, :reference_audio_sha256,
                    :generation_kind, :seed, :attempt, :retryable, :error_code
                )
                """,
                generation,
            )
        return generation, "created"

    @staticmethod
    def _assert_same_generation_input(existing: dict, requested: dict):
        keys = (
            "profile_id",
            "text",
            "language",
            "engine",
            "model_size",
            "project_id",
            "chapter_id",
            "shot_id",
            "shot_revision",
            "reference_audio_sha256",
            "generation_kind",
            "seed",
        )
        if any(existing.get(key) != requested.get(key) for key in keys):
            raise ValueError("fingerprint_collision")

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
            try:
                conn.execute(f"UPDATE generations SET {assignments} WHERE id = ?", values)
            except sqlite3.Error as e:
                logger.error(f"update_generation failed for id={generation_id}: {e}")
                raise
        return self.get_generation(generation_id)

    def export_debug(self) -> str:
        return json.dumps(
            {
                "profiles": self.list_profiles(),
            },
            ensure_ascii=False,
            indent=2,
        )
