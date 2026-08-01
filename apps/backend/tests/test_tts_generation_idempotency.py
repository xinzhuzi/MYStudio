from __future__ import annotations

import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from pathlib import Path
from queue import Queue
from unittest.mock import patch

from tts.generation_routes import GenerationRoutesMixin
from tts.storage import RuntimeStore


class _RouteState:
    def __init__(self, store: RuntimeStore):
        self.store = store
        self.inference_queue = Queue()
        self.active: set[str] = set()

    def start_generation(self, generation_id: str, _profile_id: str, _text: str):
        self.active.add(generation_id)

    def finish_generation(self, generation_id: str, _error: str | None = None):
        self.active.discard(generation_id)

    def is_generation_active(self, generation_id: str) -> bool:
        return generation_id in self.active


class _GenerationRouteHarness(GenerationRoutesMixin):
    def __init__(self, store: RuntimeStore):
        self.state = _RouteState(store)
        self.responses: list[tuple[dict, HTTPStatus]] = []
        self.errors: list[tuple[HTTPStatus, str]] = []

    def send_json(self, payload: dict, status=HTTPStatus.OK):
        self.responses.append((payload, status))

    def send_error_json(self, status: HTTPStatus, message: str):
        self.errors.append((status, message))


class TtsGenerationIdempotencyTest(unittest.TestCase):
    @staticmethod
    def _shot_request(profile_id: str) -> dict:
        return {
            "profile_id": profile_id,
            "text": "逐镜对白",
            "engine": "qwen",
            "model_size": "0.6B",
            "language": "zh",
            "project_id": "project-a",
            "chapter_id": "chapter-001",
            "shot_id": "shot-001",
            "shot_revision": 1,
            "input_fingerprint": "a" * 64,
            "generation_kind": "storyboard-shot",
            "seed": 41001,
        }

    def test_additive_migration_preserves_legacy_rows_and_adds_shot_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            database = data_dir / "tts.sqlite"
            with sqlite3.connect(database) as conn:
                conn.execute(
                    """
                    CREATE TABLE generations (
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
                conn.execute(
                    "INSERT INTO generations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    ("legacy-1", "profile-1", "旧对白", "zh", "qwen", "0.6B", "failed", "", 0, "", 0, None, "old", 1, 1),
                )

            store = RuntimeStore(data_dir)
            legacy = store.get_generation("legacy-1")
            self.assertIsNotNone(legacy)
            self.assertEqual(legacy["text"], "旧对白")
            with sqlite3.connect(database) as conn:
                columns = {row[1] for row in conn.execute("PRAGMA table_info(generations)")}
            self.assertTrue({
                "project_id",
                "chapter_id",
                "shot_id",
                "shot_revision",
                "input_fingerprint",
                "reference_audio_sha256",
                "seed",
                "attempt",
                "retryable",
                "error_code",
                "generation_kind",
            }.issubset(columns))

    def test_exact_fingerprint_reuses_active_or_completed_and_retry_is_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            profile = store.create_profile({"id": "profile-1", "name": "旁白"})
            request = dict(
                profile_id=profile["id"],
                text="逐镜对白",
                engine="qwen",
                model_size="0.6B",
                language="zh",
                project_id="project-a",
                chapter_id="chapter-001",
                shot_id="shot-001",
                shot_revision=1,
                input_fingerprint="a" * 64,
                reference_audio_sha256="b" * 64,
                generation_kind="storyboard-shot",
                seed=41001,
            )
            created, action = store.create_or_reuse_generation(**request)
            self.assertEqual(action, "created")
            self.assertEqual(created["generation_kind"], "storyboard-shot")
            reused, action = store.create_or_reuse_generation(**request)
            self.assertEqual(action, "reused")
            self.assertEqual(reused["id"], created["id"])

            store.update_generation(created["id"], status="completed", audio_path="audio.wav")
            completed, action = store.create_or_reuse_generation(**request)
            self.assertEqual(action, "reused")
            self.assertEqual(completed["id"], created["id"])

            store.update_generation(created["id"], status="failed", error="timeout", retryable=1)
            failed, action = store.create_or_reuse_generation(**request)
            self.assertEqual(action, "reused")
            self.assertEqual(failed["status"], "failed")
            restarted, action = store.create_or_reuse_generation(**request, retry_failed=True)
            self.assertEqual(action, "restarted")
            self.assertEqual(restarted["id"], created["id"])
            self.assertEqual(restarted["status"], "generating")
            self.assertEqual(restarted["attempt"], 2)

    def test_revision_isolation_and_fingerprint_collision_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            profile = store.create_profile({"id": "profile-1", "name": "旁白"})
            base = dict(
                profile_id=profile["id"],
                text="逐镜对白",
                engine="qwen",
                model_size="0.6B",
                language="zh",
                project_id="project-a",
                chapter_id="chapter-001",
                shot_id="shot-001",
                shot_revision=1,
                input_fingerprint="a" * 64,
                reference_audio_sha256="b" * 64,
                generation_kind="storyboard-shot",
                seed=41001,
            )
            first, _ = store.create_or_reuse_generation(**base)
            second, _ = store.create_or_reuse_generation(
                **{**base, "shot_revision": 2, "input_fingerprint": "c" * 64}
            )
            self.assertNotEqual(first["id"], second["id"])
            with self.assertRaisesRegex(ValueError, "fingerprint_collision"):
                store.create_or_reuse_generation(**{**base, "text": "不同对白"})
            with self.assertRaisesRegex(ValueError, "fingerprint_collision"):
                store.create_or_reuse_generation(**{**base, "reference_audio_sha256": "d" * 64})
            with self.assertRaisesRegex(ValueError, "fingerprint_collision"):
                store.create_or_reuse_generation(**{**base, "generation_kind": None})

    def test_concurrent_exact_fingerprint_creates_one_logical_generation(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            profile = store.create_profile({"id": "profile-1", "name": "旁白"})
            request = self._shot_request(profile["id"])

            with ThreadPoolExecutor(max_workers=4) as executor:
                results = list(executor.map(
                    lambda _index: store.create_or_reuse_generation(**request),
                    range(8),
                ))

            generation_ids = {generation["id"] for generation, _action in results}
            actions = [action for _generation, action in results]
            self.assertEqual(len(generation_ids), 1)
            self.assertEqual(actions.count("created"), 1)
            self.assertEqual(actions.count("reused"), 7)

    def test_generate_route_reuses_resumes_and_explicitly_restarts_same_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            profile = store.create_profile({"id": "profile-1", "name": "旁白"})
            payload = self._shot_request(profile["id"])

            first = _GenerationRouteHarness(store)
            first.handle_generate(payload)
            created, status = first.responses[-1]
            self.assertEqual(status, HTTPStatus.CREATED)
            self.assertFalse(created["reused"])
            self.assertEqual(first.state.inference_queue.qsize(), 1)

            first.handle_generate(payload)
            reused, status = first.responses[-1]
            self.assertEqual(status, HTTPStatus.OK)
            self.assertTrue(reused["reused"])
            self.assertFalse(reused["resumed"])
            self.assertEqual(first.state.inference_queue.qsize(), 1)

            restarted_process = _GenerationRouteHarness(store)
            restarted_process.handle_generate(payload)
            resumed, status = restarted_process.responses[-1]
            self.assertEqual(status, HTTPStatus.OK)
            self.assertEqual(resumed["id"], created["id"])
            self.assertTrue(resumed["resumed"])
            self.assertEqual(restarted_process.state.inference_queue.qsize(), 1)

            store.update_generation(created["id"], status="failed", error="terminal")
            without_retry = _GenerationRouteHarness(store)
            without_retry.handle_generate(payload)
            failed, status = without_retry.responses[-1]
            self.assertEqual(status, HTTPStatus.OK)
            self.assertEqual(failed["status"], "failed")
            self.assertEqual(without_retry.state.inference_queue.qsize(), 0)

            explicit_retry = _GenerationRouteHarness(store)
            explicit_retry.handle_generate({**payload, "retry": True})
            retried, status = explicit_retry.responses[-1]
            self.assertEqual(status, HTTPStatus.CREATED)
            self.assertEqual(retried["id"], created["id"])
            self.assertEqual(retried["attempt"], 2)
            self.assertEqual(explicit_retry.state.inference_queue.qsize(), 1)

    def test_generate_route_rejects_partial_shot_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            profile = store.create_profile({"id": "profile-1", "name": "旁白"})
            handler = _GenerationRouteHarness(store)
            handler.handle_generate({
                "profile_id": profile["id"],
                "text": "逐镜对白",
                "project_id": "project-a",
            })
            self.assertEqual(handler.errors, [
                (HTTPStatus.BAD_REQUEST, "input_fingerprint_invalid"),
            ])
            self.assertEqual(handler.state.inference_queue.qsize(), 0)

    def test_storyboard_generation_kind_requires_complete_shot_scope_but_generic_is_unscoped_compatible(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            profile = store.create_profile({"id": "profile-1", "name": "旁白"})

            storyboard = _GenerationRouteHarness(store)
            storyboard.handle_generate({
                "profile_id": profile["id"],
                "text": "逐镜对白",
                "generation_kind": "storyboard-shot",
            })
            self.assertEqual(storyboard.errors, [
                (HTTPStatus.BAD_REQUEST, "storyboard_scope_required"),
            ])
            self.assertEqual(storyboard.state.inference_queue.qsize(), 0)

            invalid = _GenerationRouteHarness(store)
            invalid.handle_generate({
                "profile_id": profile["id"],
                "text": "未知类型",
                "generation_kind": "chapter-dialogue",
            })
            self.assertEqual(invalid.errors, [
                (HTTPStatus.BAD_REQUEST, "generation_kind_invalid"),
            ])

            generic = _GenerationRouteHarness(store)
            generic.handle_generate({
                "profile_id": profile["id"],
                "text": "通用试听",
            })
            generated, status = generic.responses[-1]
            self.assertEqual(status, HTTPStatus.CREATED)
            self.assertIsNone(generated["generation_kind"])
            self.assertIsNone(generated["project_id"])

    def test_generation_failure_metadata_distinguishes_transient_and_terminal_errors(self):
        class HttpFailure(RuntimeError):
            def __init__(self, status: int):
                super().__init__(f"http {status}")
                self.status = status

        cases = [
            (TimeoutError("timeout"), 1, "transient_transport"),
            (ConnectionError("network"), 1, "transient_transport"),
            (HttpFailure(408), 1, "transient_http"),
            (HttpFailure(429), 1, "transient_http"),
            (HttpFailure(503), 1, "transient_http"),
            (HttpFailure(400), 0, "synthesis_failed"),
            (RuntimeError("contract"), 0, "synthesis_failed"),
        ]
        for index, (failure, retryable, error_code) in enumerate(cases):
            with self.subTest(error=type(failure).__name__, code=error_code):
                with tempfile.TemporaryDirectory() as tmp:
                    store = RuntimeStore(Path(tmp))
                    profile = store.create_profile({"id": "profile-1", "name": "旁白"})
                    generation = store.create_generation(
                        profile["id"], f"逐镜对白 {index}", "qwen", "0.6B",
                    )
                    handler = _GenerationRouteHarness(store)
                    with patch("tts.generation_routes.synthesize_to_wav", side_effect=failure):
                        handler.generate_audio(
                            generation["id"], generation["text"], profile,
                            "qwen", "0.6B", "zh", 41001,
                        )
                    failed = store.get_generation(generation["id"])
                    self.assertEqual(failed["status"], "failed")
                    self.assertEqual(failed["retryable"], retryable)
                    self.assertEqual(failed["error_code"], error_code)


if __name__ == "__main__":
    unittest.main()
