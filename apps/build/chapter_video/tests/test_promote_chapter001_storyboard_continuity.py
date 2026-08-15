import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from apps.build.chapter_video.pipeline import promote_chapter001_storyboard_continuity as promotion


class PromoteChapter001StoryboardContinuityTest(unittest.TestCase):
    def build_fixture(self, root: Path):
        project = root / "project-1"
        project.mkdir()
        output = root / "full-output"
        output.mkdir()
        sample = promotion.load_sample_module()
        entries = []
        approval_records = {}
        storyboards = []
        for index in promotion.EXPECTED_SHOTS:
            storyboard_id = f"sb-chapter-001-{index:03d}"
            image_path = output / f"shot-{index:03d}.png"
            thumbnail_path = output / f"shot-{index:03d}_thumb.png"
            Image.new("RGB", (32, 18), (index % 255, 80, 120)).save(image_path)
            Image.new("RGB", (32, 18), (index % 255, 80, 120)).save(thumbnail_path)
            output_sha256 = promotion.sha256_file(image_path)
            thumbnail_sha256 = promotion.sha256_file(thumbnail_path)
            entry = {
                "index": index,
                "storyboardId": storyboard_id,
                "outputPath": str(image_path),
                "outputSha256": output_sha256,
                "transferThumbnail": {
                    "path": str(thumbnail_path),
                    "width": 32,
                    "height": 18,
                    "bytes": thumbnail_path.stat().st_size,
                    "sha256": thumbnail_sha256,
                },
                "referenceManifest": [{
                    "order": 1,
                    "assetId": "scene:dock",
                    "assetName": "码头",
                    "assetKind": "scene",
                    "imagePath": "/dock.png",
                    "versionId": "scene:dock:main:v1",
                    "referenceRole": "scene-viewpoint",
                    "sceneViewpointId": "dock-main-axis",
                    "approved": True,
                }],
                "continuityState": {
                    "groupId": "chapter-001:dock",
                    "sceneVersionId": "scene:dock:main:v1",
                    "sceneViewpointId": "dock-main-axis",
                    "lighting": "冷青晨雾",
                    "palette": "墨青灰蓝",
                    "actionIn": "承接",
                    "actionOut": "继续",
                    "characters": [],
                    "inputFingerprint": f"fingerprint-{index}",
                },
            }
            entries.append(entry)
            approval = {
                "storyboardId": storyboard_id,
                "index": index,
                "status": "approved",
                "reviewer": "human",
                "reviewedAt": index,
                "reason": "人工确认身份、场景与动作连续",
                "evidencePath": str(thumbnail_path),
                "outputPath": str(image_path),
                "outputSha256": output_sha256,
            }
            approval["approvalFingerprint"] = sample.human_approval_fingerprint(approval)
            approval_records[str(index)] = approval
            storyboards.append({
                "id": storyboard_id,
                "episodeId": "chapter-001",
                "index": index,
                "mediaRef": {"kind": "image", "path": f"/old-{index}.png"},
                "outputVersion": 0,
                "stale": True,
                "staleReason": "旧图",
                "visualReview": {"status": "pending"},
            })
        report_path = output / "report.json"
        report_path.write_text(json.dumps({
            "mode": "full-chapter",
            "status": "completed",
            "shots": promotion.EXPECTED_SHOTS,
            "generatedImages": 43,
            "reusedImages": 0,
            "mutatedProductionProject": False,
            "entries": entries,
        }), encoding="utf-8")
        (output / "human-approvals.json").write_text(json.dumps({
            "approvals": approval_records,
        }), encoding="utf-8")
        store_path = project / "studio-workflow-store.json"
        store_path.write_text(json.dumps({
            "state": {
                "storyboards": storyboards,
                "continuityAssetVersions": [],
            },
        }), encoding="utf-8")
        return project, store_path, report_path

    def select_shot_fixture(self, report_path: Path, shot: int = 1):
        report = promotion.load_json(report_path)
        entry = next(item for item in report["entries"] if item["index"] == shot)
        entry["styleContractVersion"] = "gongbi-v2"
        report.update({
            "ok": True,
            "mode": "selected-shots",
            "shots": [shot],
            "generatedImages": 1,
            "approvedShots": [shot],
            "awaitingApprovalShot": None,
            "entries": [entry],
        })
        report_path.write_text(json.dumps(report), encoding="utf-8")

        approvals_path = report_path.parent / "human-approvals.json"
        approvals = promotion.load_json(approvals_path)
        approval = approvals["approvals"][str(shot)]
        approval["reviewChecklist"] = {
            "linework": True,
            "colorBalance": True,
            "clothingIntegrity": True,
            "cleanliness": True,
            "continuity": True,
            "text": True,
            "watermark": True,
        }
        sample = promotion.load_sample_module()
        approval["approvalFingerprint"] = sample.human_approval_fingerprint(approval)
        approvals_path.write_text(json.dumps(approvals), encoding="utf-8")

    def test_dry_run_validates_all_frames_without_mutating_project(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            before = store_path.read_bytes()

            plan = promotion.build_promotion_plan(report_path, store_path, project)

            self.assertTrue(plan["dryRun"])
            self.assertEqual(plan["shots"], 43)
            self.assertEqual(store_path.read_bytes(), before)
            self.assertTrue(all(not Path(item["destination"]).exists() for item in plan["updates"]))

    def test_selected_shot_report_requires_explicit_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)

            with self.assertRaisesRegex(RuntimeError, "full-chapter"):
                promotion.build_promotion_plan(report_path, store_path, project)

    def test_selected_shot_dry_run_builds_one_update(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)
            before = store_path.read_bytes()

            plan = promotion.build_promotion_plan(
                report_path,
                store_path,
                project,
                selected_shot=1,
            )

            self.assertEqual(plan["shots"], 1)
            self.assertEqual(plan["updates"][0]["index"], 1)
            self.assertEqual(plan["updates"][0]["storyboardId"], "sb-chapter-001-001")
            self.assertEqual(plan["backupRoot"], str(project / "visual-continuity-backups"))
            self.assertEqual(plan["backupStoreFilename"], "studio-workflow-store.json")
            self.assertEqual(store_path.read_bytes(), before)

    def test_selected_shot_rejects_incomplete_report_approval_state(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)
            report = promotion.load_json(report_path)
            report["approvedShots"] = []
            report_path.write_text(json.dumps(report), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "approvedShots"):
                promotion.build_promotion_plan(
                    report_path,
                    store_path,
                    project,
                    selected_shot=1,
                )

    def test_selected_shot_rejects_a_different_explicit_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)

            with self.assertRaisesRegex(RuntimeError, r"shots 必须精确等于 \[2\]"):
                promotion.build_promotion_plan(
                    report_path,
                    store_path,
                    project,
                    selected_shot=2,
                )

    def test_selected_shot_apply_only_mutates_target_storyboard(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)
            before = promotion.load_json(store_path)["state"]["storyboards"]
            plan = promotion.build_promotion_plan(
                report_path,
                store_path,
                project,
                selected_shot=1,
            )

            result = promotion.apply_promotion(plan, True)

            after = promotion.load_json(store_path)["state"]["storyboards"]
            self.assertEqual(result["promotedImages"], 1)
            self.assertEqual(after[1:], before[1:])
            self.assertFalse(after[0]["stale"])
            self.assertEqual(after[0]["visualReview"]["status"], "pending")
            self.assertEqual(after[0]["visualReview"]["reviewer"], "automated")
            self.assertEqual(len(list(project.glob(
                "workflow-images/storyboards/chapter-001/approved-revisions/*.png"
            ))), 1)

    def test_apply_requires_human_confirmation(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            plan = promotion.build_promotion_plan(report_path, store_path, project)
            with self.assertRaisesRegex(RuntimeError, "--human-confirmed"):
                promotion.apply_promotion(plan, False)

    def test_apply_preserves_old_media_and_sets_product_review_pending(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            plan = promotion.build_promotion_plan(report_path, store_path, project)

            result = promotion.apply_promotion(plan, True)

            self.assertEqual(result["promotedImages"], 43)
            self.assertEqual(result["approvedStoryboards"], 0)
            self.assertTrue(Path(result["backupDir"], "studio-workflow-store.json").is_file())
            self.assertTrue(Path(result["promotionReport"]).is_file())
            state = promotion.load_json(store_path)["state"]
            for storyboard in state["storyboards"]:
                self.assertFalse(storyboard["stale"])
                self.assertEqual(storyboard["outputVersion"], 1)
                self.assertIn("/approved-revisions/", storyboard["mediaRef"]["path"])
                self.assertEqual(storyboard["visualReview"]["status"], "pending")
                self.assertEqual(storyboard["visualReview"]["reviewer"], "automated")
                self.assertEqual(storyboard["visualReview"]["inputFingerprint"], "")
            self.assertEqual(len(list(project.glob(
                "workflow-images/storyboards/chapter-001/approved-revisions/*.png"
            ))), 43)

    def test_rejects_changed_output_hash_before_any_project_write(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            report = promotion.load_json(report_path)
            first_output = Path(report["entries"][0]["outputPath"])
            Image.new("RGB", (32, 18), (255, 0, 0)).save(first_output)

            with self.assertRaisesRegex(RuntimeError, "outputSha256"):
                promotion.build_promotion_plan(report_path, store_path, project)
            self.assertFalse((project / "workflow-images").exists())

    def test_rejects_approval_for_a_different_output_or_thumbnail(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            approvals_path = report_path.parent / "human-approvals.json"
            approvals = promotion.load_json(approvals_path)
            first = approvals["approvals"]["1"]
            first["outputPath"] = approvals["approvals"]["2"]["outputPath"]
            sample = promotion.load_sample_module()
            first["approvalFingerprint"] = sample.human_approval_fingerprint(first)
            approvals_path.write_text(json.dumps(approvals), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "有效人工批准"):
                promotion.build_promotion_plan(report_path, store_path, project)

            first["outputPath"] = promotion.load_json(report_path)["entries"][0]["outputPath"]
            first["evidencePath"] = approvals["approvals"]["2"]["evidencePath"]
            first["approvalFingerprint"] = sample.human_approval_fingerprint(first)
            approvals_path.write_text(json.dumps(approvals), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "有效人工批准"):
                promotion.build_promotion_plan(report_path, store_path, project)

    def test_repeated_apply_is_a_noop_for_same_and_rebuilt_plan(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            plan = promotion.build_promotion_plan(report_path, store_path, project)
            first = promotion.apply_promotion(plan, True)
            first_store = store_path.read_bytes()
            first_backups = sorted((project / "visual-continuity-backups").glob("*"))

            same_plan = promotion.apply_promotion(plan, True)
            rebuilt_plan = promotion.build_promotion_plan(report_path, store_path, project)
            rebuilt = promotion.apply_promotion(rebuilt_plan, True)

            self.assertTrue(same_plan["alreadyApplied"])
            self.assertTrue(rebuilt_plan["alreadyApplied"])
            self.assertTrue(rebuilt["alreadyApplied"])
            self.assertEqual(store_path.read_bytes(), first_store)
            self.assertEqual(
                sorted((project / "visual-continuity-backups").glob("*")),
                first_backups,
            )
            self.assertEqual(first["resultStoreSha256"], same_plan["resultStoreSha256"])
            state = promotion.load_json(store_path)["state"]
            self.assertTrue(all(item["outputVersion"] == 1 for item in state["storyboards"]))

    def test_commit_failure_rolls_back_images_report_and_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            plan = promotion.build_promotion_plan(report_path, store_path, project)
            before_store = store_path.read_bytes()
            expected_report = promotion.promotion_report_path(plan)
            real_replace = promotion.os.replace

            def fail_on_report(source, destination):
                if Path(destination) == expected_report:
                    raise OSError("injected report commit failure")
                return real_replace(source, destination)

            with mock.patch.object(promotion.os, "replace", side_effect=fail_on_report):
                with self.assertRaisesRegex(OSError, "injected report"):
                    promotion.apply_promotion(plan, True)

            self.assertEqual(store_path.read_bytes(), before_store)
            self.assertFalse(expected_report.exists())
            self.assertEqual(list(project.glob(
                "workflow-images/storyboards/chapter-001/approved-revisions/*.png"
            )), [])
            backups_root = project / "visual-continuity-backups"
            self.assertFalse(backups_root.exists())

    def test_store_drift_before_commit_leaves_no_partial_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            plan = promotion.build_promotion_plan(report_path, store_path, project)
            original_stage = promotion.stage_payload

            def stage_then_drift(target, payload, created_directories):
                staged = original_stage(target, payload, created_directories)
                if Path(target) == store_path:
                    store_path.write_text('{"state":{"storyboards":[]}}', encoding="utf-8")
                return staged

            with mock.patch.object(promotion, "stage_payload", side_effect=stage_then_drift):
                with self.assertRaisesRegex(RuntimeError, "提交前已变化"):
                    promotion.apply_promotion(plan, True)

            self.assertFalse(promotion.promotion_report_path(plan).exists())
            self.assertEqual(list(project.glob(
                "workflow-images/storyboards/chapter-001/approved-revisions/*.png"
            )), [])
            self.assertFalse((project / "visual-continuity-backups").exists())


if __name__ == "__main__":
    unittest.main()
