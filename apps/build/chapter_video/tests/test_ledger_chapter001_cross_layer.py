"""提案五②:跨层依赖账本(ledger_chapter001_cross_layer)四字段测试。

四字段=当前草稿/最新确认版本/直接依据版本/下游影响清单;按成果记(frame:*/
asset:*/tts-audio:*/tts-job:*/prompt:*/h3-clip:*),对任意成果可查;JSONL/JSON
落盘 apps/output/automation/(paid ledger 先例
generate_chapter001_continuity_sample.py:33)。
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from apps.build.chapter_video import ledger_chapter001_cross_layer as ledger


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = REPOSITORY_ROOT / "apps/build/chapter_video/ledger_chapter001_cross_layer.py"


def make_shot(
    shot_id: str,
    *,
    output_version: int,
    media_path: str,
    stale: bool = False,
    audio_path: str | None = None,
    prompt: str | None = None,
    expiry: dict | None = None,
    manifest: list[dict] | None = None,
    continuity: dict | None = None,
) -> dict:
    shot: dict = {
        "id": shot_id,
        "episodeId": "chapter-001",
        "index": int(shot_id.rsplit("-", 1)[-1]),
        "mediaRef": {"kind": "image", "path": media_path, "contentSha256": f"sha-{shot_id}"},
        "outputVersion": output_version,
        "stale": stale,
        "visualReview": {"status": "pending"},
    }
    if audio_path:
        shot["audioRef"] = {"kind": "audio", "path": audio_path}
    if prompt:
        shot["prompt"] = prompt
        shot["videoDesc"] = f"{shot_id}-运镜"
    if expiry:
        shot["downstreamExpiry"] = expiry
    if manifest:
        shot["orderedReferenceManifest"] = manifest
    if continuity:
        shot["continuityState"] = continuity
    return shot


def expiry_marking(based_on: int, superseded_by: int, kinds: list[str]) -> dict:
    return {
        "status": "已过期-禁止使用",
        "reason": "分镜已人工确认新版本,依赖旧版的下游产物已过期-禁止使用",
        "since": 1730000000000,
        "basedOnOutputVersion": based_on,
        "supersededByOutputVersion": superseded_by,
        "artifacts": [
            ({"kind": "tts-audio", "audioRef": {"kind": "audio", "path": "/tts/old.wav"}}
             if kind == "tts-audio" else
             {"kind": "prompt", "promptSha256": "a" * 64})
            for kind in kinds
        ],
        "clearPolicy": "human-confirmed-repromotion-only",
    }


class LedgerChapter001CrossLayerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store_path = self.root / "studio-workflow-store.json"
        self.store_path.write_text(json.dumps(self.build_store()), encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def build_store(self) -> dict:
        """三镜+两资产夹具:镜1=已确认帧+过期标记;镜2=草稿帧无标记;镜3=零下游产物。"""
        confirmed_path = (
            "project-file://p1/workflow-images/storyboards/chapter-001/"
            "approved-revisions/shot-001-abc123def456.png"
        )
        shot1 = make_shot(
            "sb-chapter-001-001",
            output_version=2,
            media_path=confirmed_path,
            audio_path="/exports/chapter-001/voice-audio/shot-001.wav",
            prompt="旧提示词-1",
            expiry=expiry_marking(1, 2, ["tts-audio", "prompt"]),
            manifest=[{
                "order": 1, "assetId": "prop:test", "versionId": "prop:test:base:v1",
                "approved": True,
            }],
            continuity={
                "groupId": "chapter-001:dock",
                "sceneVersionId": "scene:dock:main:v1",
                "sceneViewpointId": "dock-main-axis",
                "previousStoryboardId": None,
            },
        )
        shot2 = make_shot(
            "sb-chapter-001-002",
            output_version=0,
            media_path="/old-2.png",
            audio_path="/exports/chapter-001/voice-audio/shot-002.wav",
            manifest=[{
                "order": 1, "assetId": "prop:other", "versionId": "prop:other:base:v1",
                "approved": False,
            }],
            continuity={"sceneVersionId": "scene:dock:main:v1"},
        )
        shot3 = make_shot("sb-chapter-001-003", output_version=0, media_path="/old-3.png")
        approved_asset = {
            "assetId": "prop:test",
            "versionId": "prop:test:base:v1",
            "assetKind": "prop",
            "approved": True,
            "contentFingerprint": "fp-test",
            "approvalFingerprint": "afp-test",
            "approval": {"reviewer": "human", "reviewedAt": 10},
            "referenceImageSha256": ["b" * 64],
            "source": "test-bible",
        }
        pending_asset = {
            "assetId": "prop:other",
            "versionId": "prop:other:base:v1",
            "assetKind": "prop",
            "approved": False,
            "approval": None,
            "contentFingerprint": "fp-other",
            "referenceImageSha256": ["c" * 64],
            "source": "test-bible",
        }
        return {
            "state": {
                "storyboards": [shot1, shot2, shot3],
                "continuityAssetVersions": [approved_asset, pending_asset],
            },
        }

    def load_store(self) -> dict:
        return json.loads(self.store_path.read_text(encoding="utf-8"))

    def test_every_artifact_record_carries_exactly_the_four_fields(self):
        records = ledger.build_ledger(self.load_store())["records"]
        self.assertTrue(records)
        for record in records:
            for field in ledger.FOUR_FIELDS:
                self.assertIn(field, record, f"{record.get('artifactId')} 缺 {field}")
            # 四字段对任意成果可查
            self.assertEqual(ledger.query_artifact(records, record["artifactId"]), record)

    def test_frame_record_fields(self):
        records = ledger.build_ledger(self.load_store())["records"]
        confirmed = ledger.query_artifact(records, "frame:sb-chapter-001-001")
        self.assertEqual(confirmed["currentDraft"]["outputVersion"], 2)
        self.assertEqual(
            confirmed["latestConfirmedVersion"],
            {"outputVersion": 2, "evidence": "mediaRef 位于 approved-revisions(人工批准推广写入)"},
        )
        self.assertEqual(
            confirmed["directBasisVersion"]["referenceVersions"],
            [{"assetId": "prop:test", "versionId": "prop:test:base:v1", "approved": True}],
        )
        self.assertEqual(
            confirmed["directBasisVersion"]["sceneVersionId"], "scene:dock:main:v1"
        )
        impact_kinds = {
            (item["kind"], item["status"]) for item in confirmed["downstreamImpact"]
        }
        self.assertEqual(
            impact_kinds,
            {("tts-audio", "已过期-禁止使用"), ("prompt", "已过期-禁止使用")},
        )
        draft = ledger.query_artifact(records, "frame:sb-chapter-001-002")
        self.assertIsNone(draft["latestConfirmedVersion"])
        self.assertEqual(draft["currentDraft"]["outputVersion"], 0)
        live_kinds = {
            (item["kind"], item["status"]) for item in draft["downstreamImpact"]
        }
        self.assertEqual(live_kinds, {("tts-audio", "in-use")})

    def test_asset_record_fields(self):
        records = ledger.build_ledger(self.load_store())["records"]
        confirmed = ledger.query_artifact(records, "asset:prop:test")
        self.assertIsNone(confirmed["currentDraft"])
        self.assertEqual(
            confirmed["latestConfirmedVersion"],
            {
                "versionId": "prop:test:base:v1",
                "approvalFingerprint": "afp-test",
                "reviewedAt": 10,
            },
        )
        self.assertEqual(confirmed["directBasisVersion"]["referenceImageSha256"], ["b" * 64])
        self.assertEqual(
            confirmed["downstreamImpact"],
            [{
                "storyboardId": "sb-chapter-001-001",
                "referenceVersionId": "prop:test:base:v1",
                "approved": True,
            }],
        )
        pending = ledger.query_artifact(records, "asset:prop:other")
        self.assertEqual(
            pending["currentDraft"],
            {"versionId": "prop:other:base:v1", "contentFingerprint": "fp-other"},
        )
        self.assertIsNone(pending["latestConfirmedVersion"])
        self.assertEqual(
            pending["downstreamImpact"][0]["storyboardId"], "sb-chapter-001-002"
        )

    def test_downstream_record_basis_follows_expiry_marking(self):
        records = ledger.build_ledger(self.load_store())["records"]
        expired = ledger.query_artifact(records, "tts-audio:sb-chapter-001-001")
        self.assertEqual(expired["status"], "已过期-禁止使用")
        self.assertEqual(
            expired["directBasisVersion"],
            {
                "storyboardId": "sb-chapter-001-001",
                "outputVersion": 1,
                "basis": "downstreamExpiry.basedOnOutputVersion",
            },
        )
        self.assertIsNone(expired["latestConfirmedVersion"])
        self.assertEqual(expired["downstreamImpact"], [])
        live = ledger.query_artifact(records, "tts-audio:sb-chapter-001-002")
        self.assertEqual(live["status"], "in-use")
        self.assertEqual(
            live["directBasisVersion"],
            {
                "storyboardId": "sb-chapter-001-002",
                "outputVersion": 0,
                "basis": "当前分镜版本(无过期标记)",
            },
        )

    def test_ledger_reads_real_promotion_marking(self):
        """①→② 接线:真实 apply_promotion 写入的 downstreamExpiry,账本可直接机检
        列出并给四字段(用推广测试夹具构造真链路,防止两模块形状漂移)。"""
        from apps.build.chapter_video.pipeline import (
            promote_chapter001_storyboard_continuity as promotion,
        )
        from apps.build.chapter_video.tests import (
            test_promote_chapter001_storyboard_continuity as promote_tests,
        )

        case = promote_tests.PromoteChapter001StoryboardContinuityTest(
            "test_dry_run_validates_all_frames_without_mutating_project"
        )
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = case.build_fixture(Path(temp))
            case.select_shot_fixture(report_path)
            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=1
            )
            promotion.apply_promotion(plan, True)
            store = json.loads(store_path.read_text(encoding="utf-8"))

            expired = ledger.list_expired_downstream(store)
            self.assertEqual(
                {item["kind"] for item in expired},
                {"tts-audio", "tts-job", "prompt"},
            )
            self.assertTrue(all(item["basedOnOutputVersion"] == 0 for item in expired))
            records = ledger.build_ledger(store)["records"]
            frame = ledger.query_artifact(records, "frame:sb-chapter-001-001")
            self.assertEqual(frame["latestConfirmedVersion"]["outputVersion"], 1)
            self.assertEqual(
                {item["kind"] for item in frame["downstreamImpact"]},
                {"tts-audio", "tts-job", "prompt"},
            )

    def test_query_unknown_artifact_raises(self):
        records = ledger.build_ledger(self.load_store())["records"]
        with self.assertRaisesRegex(RuntimeError, "账本查无此成果"):
            ledger.query_artifact(records, "frame:sb-chapter-001-999")

    def test_list_expired_downstream_is_machine_checkable_and_zero_false_positive(self):
        expired = ledger.list_expired_downstream(self.load_store())
        self.assertEqual(
            [(item["storyboardId"], item["kind"]) for item in expired],
            [("sb-chapter-001-001", "tts-audio"), ("sb-chapter-001-001", "prompt")],
        )
        for item in expired:
            self.assertEqual(item["status"], "已过期-禁止使用")
            self.assertEqual(item["basedOnOutputVersion"], 1)
            self.assertEqual(item["supersededByOutputVersion"], 2)
        # 零误伤:镜2 的 TTS 音频未依赖旧版(无标记),绝不列入;镜3 无下游产物
        self.assertNotIn("sb-chapter-001-002", {item["storyboardId"] for item in expired})
        self.assertNotIn("sb-chapter-001-003", {item["storyboardId"] for item in expired})

    def test_write_ledger_jsonl_and_json_snapshot(self):
        store = self.load_store()
        built = ledger.build_ledger(store)
        jsonl_path = self.root / "out" / "cross-layer-ledger.jsonl"
        json_path = self.root / "out" / "cross-layer-ledger.json"

        summary = ledger.write_ledger(built, jsonl_path, json_path)

        self.assertTrue(jsonl_path.is_file() and json_path.is_file())
        self.assertEqual(summary["records"], len(built["records"]))
        lines = jsonl_path.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), len(built["records"]))
        self.assertEqual(
            [json.loads(line) for line in lines], built["records"]
        )
        self.assertEqual(json.loads(json_path.read_text(encoding="utf-8")), built)
        # 快照确定性:重建重写逐字节一致
        rebuilt = ledger.build_ledger(json.loads(self.store_path.read_text(encoding="utf-8")))
        before = jsonl_path.read_bytes()
        ledger.write_ledger(rebuilt, jsonl_path, json_path)
        self.assertEqual(jsonl_path.read_bytes(), before)

    def test_default_ledger_paths_live_under_output_automation(self):
        self.assertIn("apps/output/automation", str(ledger.DEFAULT_LEDGER_JSONL))
        self.assertIn("apps/output/automation", str(ledger.DEFAULT_LEDGER_JSON))
        self.assertTrue(str(ledger.DEFAULT_LEDGER_JSONL).endswith(".jsonl"))

    def test_cli_writes_ledger_and_supports_queries(self):
        jsonl_path = self.root / "cli-ledger.jsonl"
        json_path = self.root / "cli-ledger.json"
        environment = {"PYTHONPATH": str(REPOSITORY_ROOT), "PATH": "/usr/bin:/bin"}
        completed = subprocess.run(
            [
                sys.executable, str(SCRIPT_PATH),
                "--store", str(self.store_path),
                "--jsonl", str(jsonl_path),
                "--json", str(json_path),
            ],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )
        summary = json.loads(completed.stdout)
        self.assertGreater(summary["records"], 0)
        self.assertEqual(summary["expiredDownstream"], 2)
        self.assertTrue(jsonl_path.is_file() and json_path.is_file())

        query = subprocess.run(
            [
                sys.executable, str(SCRIPT_PATH),
                "--store", str(self.store_path),
                "--artifact", "tts-audio:sb-chapter-001-001",
            ],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )
        record = json.loads(query.stdout)
        self.assertEqual(record["status"], "已过期-禁止使用")

        listed = subprocess.run(
            [
                sys.executable, str(SCRIPT_PATH),
                "--store", str(self.store_path),
                "--list-expired",
            ],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(len(json.loads(listed.stdout)), 2)


if __name__ == "__main__":
    unittest.main()
