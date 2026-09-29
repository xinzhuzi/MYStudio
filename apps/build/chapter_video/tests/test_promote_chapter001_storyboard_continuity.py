import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from apps.build.chapter_video.pipeline import promote_chapter001_storyboard_continuity as promotion


class ReportCommitFailureOsShim:
    """promotion 模块级 os 隔离 shim(2026-09-29 评审发现④)。

    只对 os.replace 在目标=推广报告路径时注入失败,其余属性经 __getattr__ 透传真
    os。替代旧写法 mock.patch.object(promotion.os, "replace", ...)——那打的是
    stdlib os 单例=进程级全局 patch(测试窗口内一切 os.replace 调用方都被误伤);
    本 shim 只替换 promotion 模块命名空间的 os 绑定,stdlib 不受扰动。被测路径
    (atomic_write/stage_payload/apply_promotion 提交链)另用 os.fdopen/fsync/
    exists/unlink,均由透传覆盖。
    """

    def __init__(self, real_os, fail_destination: Path):
        self._real_os = real_os
        self._fail_destination = fail_destination

    def replace(self, source, destination):
        if Path(destination) == self._fail_destination:
            raise OSError("injected report commit failure")
        return self._real_os.replace(source, destination)

    def __getattr__(self, name):
        return getattr(self._real_os, name)


class PromoteChapter001StoryboardContinuityTest(unittest.TestCase):
    def build_fixture(self, root: Path, *, downstream: bool = True):
        """构造 43 镜推广夹具。

        downstream=True 时逐镜携带下游产物引用(镜像真实生产 store 形态:
        audioRef/prompt/videoDesc 43/43、ttsJob 任务记录;真源=道劫项目 store
        备份快照字段普查),且 TTS 音频用真实落盘文件——供「不删除、不自动重写」
        的文件级断言使用。
        """
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
            if downstream:
                tts_path = output / f"shot-{index:03d}-tts.wav"
                tts_path.write_bytes(f"tts-bytes-{index}".encode("utf-8"))
                storyboards[-1]["audioRef"] = {"kind": "audio", "path": str(tts_path)}
                storyboards[-1]["ttsJob"] = {
                    "schemaVersion": 1,
                    "shotRevision": 0,
                    "inputFingerprint": f"tts-fp-{index}",
                    "status": "completed",
                    "attempt": 1,
                    "createdAt": 1,
                    "updatedAt": 2,
                }
                storyboards[-1]["prompt"] = f"旧提示词-{index}"
                storyboards[-1]["videoDesc"] = f"旧运镜描述-{index}"
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
            self.assertEqual(
                plan["backupRoot"], str(project / "backups" / "visual-continuity")
            )
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
            first_backups = sorted((project / "backups" / "visual-continuity").glob("*"))

            same_plan = promotion.apply_promotion(plan, True)
            rebuilt_plan = promotion.build_promotion_plan(report_path, store_path, project)
            rebuilt = promotion.apply_promotion(rebuilt_plan, True)

            self.assertTrue(same_plan["alreadyApplied"])
            self.assertTrue(rebuilt_plan["alreadyApplied"])
            self.assertTrue(rebuilt["alreadyApplied"])
            self.assertEqual(store_path.read_bytes(), first_store)
            self.assertEqual(
                sorted((project / "backups" / "visual-continuity").glob("*")),
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

            # 模块级隔离(评审发现④):patch promotion 模块的 os 绑定为受控 shim,
            # 不再打 stdlib os 单例;stdlib os.replace 在窗口内保持原样。
            shim = ReportCommitFailureOsShim(promotion.os, expected_report)
            with mock.patch.object(promotion, "os", shim):
                with self.assertRaisesRegex(OSError, "injected report"):
                    promotion.apply_promotion(plan, True)

            self.assertEqual(store_path.read_bytes(), before_store)
            self.assertFalse(expected_report.exists())
            self.assertEqual(list(project.glob(
                "workflow-images/storyboards/chapter-001/approved-revisions/*.png"
            )), [])
            backups_root = project / "backups" / "visual-continuity"
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
            self.assertFalse((project / "backups" / "visual-continuity").exists())


    def test_apply_marks_downstream_artifacts_expired_forbidden(self):
        """提案五①:推广提交时,依赖旧版的下游产物(该镜 TTS 音频/任务/提示词引用)
        显式标「已过期-禁止使用」——不删除(audioRef 原引用保留+旧音频文件原样)、
        不自动重写(文件字节不变),语义照 stale 三件套「显式标记+人工确认」形态。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)
            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=1
            )

            result = promotion.apply_promotion(plan, True)

            shot = promotion.load_json(store_path)["state"]["storyboards"][0]
            expiry = shot["downstreamExpiry"]
            self.assertEqual(expiry["status"], "已过期-禁止使用")
            self.assertEqual(expiry["basedOnOutputVersion"], 0)
            self.assertEqual(expiry["supersededByOutputVersion"], 1)
            self.assertIsInstance(expiry["since"], int)
            self.assertGreater(expiry["since"], 0)
            self.assertEqual(expiry["clearPolicy"], "human-confirmed-repromotion-only")
            kinds = {item["kind"] for item in expiry["artifacts"]}
            self.assertEqual(kinds, {"tts-audio", "tts-job", "prompt"})
            for item in expiry["artifacts"]:
                self.assertIn("已过期-禁止使用", expiry["reason"])
            tts_entry = next(a for a in expiry["artifacts"] if a["kind"] == "tts-audio")
            self.assertIn("shot-001-tts.wav", tts_entry["audioRef"]["path"])
            prompt_entry = next(a for a in expiry["artifacts"] if a["kind"] == "prompt")
            self.assertEqual(
                prompt_entry["promptSha256"],
                promotion.sha256_bytes("旧提示词-1".encode("utf-8")),
            )
            # 不删除:原下游引用字段原样保留
            self.assertEqual(
                shot["audioRef"]["path"],
                str(Path(report_path).parent / "shot-001-tts.wav"),
            )
            self.assertEqual(shot["ttsJob"]["inputFingerprint"], "tts-fp-1")
            self.assertEqual(shot["prompt"], "旧提示词-1")
            # 不自动重写:旧音频文件仍存在且字节不变
            old_file = Path(shot["audioRef"]["path"])
            self.assertTrue(old_file.is_file())
            self.assertEqual(old_file.read_bytes(), b"tts-bytes-1")
            # 推广报告可机检列出过期项
            report = promotion.load_json(Path(result["promotionReport"]))
            self.assertEqual(len(report["downstreamExpiry"]), 1)
            self.assertEqual(report["downstreamExpiry"][0]["storyboardId"], "sb-chapter-001-001")
            self.assertEqual(
                set(report["downstreamExpiry"][0]["artifactKinds"]),
                {"tts-audio", "tts-job", "prompt"},
            )

    def test_dry_run_plan_previews_downstream_artifacts(self):
        """dry-run 即显式预览将过期的下游清单(人工确认前可见,显式标记+人工确认)。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)

            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=1
            )

            kinds = {item["kind"] for item in plan["updates"][0]["downstreamArtifacts"]}
            self.assertEqual(kinds, {"tts-audio", "tts-job", "prompt"})
            self.assertEqual(plan["updates"][0]["currentOutputVersion"], 0)

    def test_apply_preserves_old_h3_clip_reference_in_expiry(self):
        """该镜旧 H3 片(mediaRef kind=video)在推广替换首帧后,旧片引用被过期标记
        完整留存(引用换位到标记内,文件与内容均不删不重写)。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)
            store = promotion.load_json(store_path)
            store["state"]["storyboards"][0]["mediaRef"] = {
                "kind": "video",
                "path": "/old/h3-shot-001.mov",
                "contentSha256": "h3-old-sha",
            }
            store_path.write_text(json.dumps(store), encoding="utf-8")

            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=1
            )
            promotion.apply_promotion(plan, True)

            shot = promotion.load_json(store_path)["state"]["storyboards"][0]
            h3_entry = next(
                a for a in shot["downstreamExpiry"]["artifacts"] if a["kind"] == "h3-clip"
            )
            self.assertEqual(h3_entry["mediaRef"]["path"], "/old/h3-shot-001.mov")
            self.assertEqual(h3_entry["mediaRef"]["contentSha256"], "h3-old-sha")
            # 推广后首帧按既有合同换成新确认图,旧 H3 片引用只在标记里留存
            self.assertEqual(shot["mediaRef"]["kind"], "image")
            self.assertIn("/approved-revisions/", shot["mediaRef"]["path"])

    def test_apply_without_downstream_artifacts_adds_no_expiry(self):
        """零误伤:没有任何下游产物记录的镜,推广后不产生过期标记字段。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(
                Path(temp), downstream=False
            )

            plan = promotion.build_promotion_plan(report_path, store_path, project)
            result = promotion.apply_promotion(plan, True)

            state = promotion.load_json(store_path)["state"]
            self.assertTrue(all("downstreamExpiry" not in s for s in state["storyboards"]))
            self.assertEqual(
                promotion.load_json(Path(result["promotionReport"]))["downstreamExpiry"],
                [],
            )

    def test_selected_shot_marks_only_target_shot_zero_recompute(self):
        """③只重做受影响镜:单镜提升(selected_shot 先例)只给目标镜标下游过期;
        未改镜头(含其下游产物与 TTS 文件)零重算=逐字节不变。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)
            before = promotion.load_json(store_path)["state"]["storyboards"]
            before_shot2_tts = Path(before[1]["audioRef"]["path"]).read_bytes()
            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=1
            )

            promotion.apply_promotion(plan, True)

            after = promotion.load_json(store_path)["state"]["storyboards"]
            self.assertEqual(after[1:], before[1:])
            self.assertIn("downstreamExpiry", after[0])
            self.assertNotIn("downstreamExpiry", after[1])
            # 未改镜的下游产物文件零重算(字节不变)
            self.assertEqual(Path(after[1]["audioRef"]["path"]).read_bytes(), before_shot2_tts)

    def test_repeated_apply_keeps_single_expiry_marking(self):
        """幂等重放不重复标记:同计划/重建计划重放走 already-applied 早退,store 不动。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path)
            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=1
            )
            promotion.apply_promotion(plan, True)
            first = store_path.read_bytes()

            same = promotion.apply_promotion(plan, True)
            rebuilt_plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=1
            )
            rebuilt = promotion.apply_promotion(rebuilt_plan, True)

            self.assertTrue(same["alreadyApplied"])
            self.assertTrue(rebuilt["alreadyApplied"])
            self.assertEqual(store_path.read_bytes(), first)

    @staticmethod
    def interval_shot(index: int, group: str, previous: str | None, **extra) -> dict:
        shot = {
            "id": f"sb-chapter-001-{index:03d}",
            "episodeId": "chapter-001",
            "index": index,
            "continuityState": {"groupId": group},
        }
        if previous is not None:
            shot["continuityState"]["previousStoryboardId"] = previous
        shot.update(extra)
        return shot

    def test_interval_pure_function_pins_spec_example(self):
        """§六示例锚定:SH05(改)~SH07 同组链=区间;SH08 换场(异组/断链)=稳定上界。"""
        storyboards = [
            self.interval_shot(5, "chapter-001:dock", None),
            self.interval_shot(6, "chapter-001:dock", "sb-chapter-001-005"),
            self.interval_shot(7, "chapter-001:dock", "sb-chapter-001-006"),
            self.interval_shot(8, "chapter-001:inn", None),
        ]
        interval = promotion.affected_continuity_interval(
            storyboards, "sb-chapter-001-005"
        )
        self.assertEqual(interval["changedStoryboardId"], "sb-chapter-001-005")
        self.assertEqual(interval["lowerShotId"], "sb-chapter-001-005")
        self.assertEqual(
            interval["affectedShotIds"],
            ["sb-chapter-001-005", "sb-chapter-001-006", "sb-chapter-001-007"],
        )
        self.assertEqual(interval["upperShotId"], "sb-chapter-001-008")
        self.assertEqual(
            [item["via"] for item in interval["dependencyEvidence"]],
            ["changed-shot", "previousStoryboardId", "previousStoryboardId"],
        )

        # 断链=上界:007 无 previousStoryboardId → 区间止于 006
        broken = [
            self.interval_shot(5, "chapter-001:dock", None),
            self.interval_shot(6, "chapter-001:dock", "sb-chapter-001-005"),
            self.interval_shot(7, "chapter-001:dock", None),
        ]
        interval = promotion.affected_continuity_interval(
            broken, "sb-chapter-001-005"
        )
        self.assertEqual(
            interval["affectedShotIds"],
            ["sb-chapter-001-005", "sb-chapter-001-006"],
        )
        self.assertEqual(interval["upperShotId"], "sb-chapter-001-007")

        # legacy 回接关键帧=第二依赖判据:008 断链但 keyframe 回接区间内旧镜 → 区间延至 008
        legacy = [
            self.interval_shot(5, "chapter-001:dock", None),
            self.interval_shot(6, "chapter-001:dock", "sb-chapter-001-005"),
            self.interval_shot(7, "chapter-001:inn", None, keyframes=[{
                "frameId": "sb-chapter-001-007-kf-2",
                "mediaRef": {"kind": "image", "path": "/frames/006-tail.png"},
                "inUs": 1_000_000,
                "origin": {"kind": "legacy-shot", "legacyIndex": 6},
            }]),
        ]
        interval = promotion.affected_continuity_interval(
            legacy, "sb-chapter-001-005"
        )
        self.assertEqual(
            interval["affectedShotIds"],
            ["sb-chapter-001-005", "sb-chapter-001-006", "sb-chapter-001-007"],
        )
        self.assertEqual(interval["dependencyEvidence"][-1]["via"], "legacy-keyframe")

    def test_promotion_blocked_by_unexpired_legacy_keyframe(self):
        """P5 验收:依赖旧帧(回接被改镜)的关键帧未标「已过期-禁止使用」→ 计划被拦,
        明确报错(不得旧图配新镜清单);已标记者放行。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path, shot=5)
            store = promotion.load_json(store_path)
            store["state"]["storyboards"][5]["keyframes"] = [{
                "frameId": "sb-chapter-001-006-kf-1",
                "mediaRef": {"kind": "image", "path": "/frames/005-tail.png"},
                "inUs": 0,
                "origin": {"kind": "legacy-shot", "legacyIndex": 5},
            }]
            store_path.write_text(json.dumps(store), encoding="utf-8")

            with self.assertRaisesRegex(
                RuntimeError, r"已过期-禁止使用.*旧图配新镜清单.*sb-chapter-001-006-kf-1"
            ):
                promotion.build_promotion_plan(
                    report_path, store_path, project, selected_shot=5
                )

            store["state"]["storyboards"][5]["keyframes"][0]["status"] = (
                promotion.EXPIRED_FORBIDDEN_USE
            )
            store_path.write_text(json.dumps(store), encoding="utf-8")
            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=5
            )
            self.assertTrue(plan["ok"])
            self.assertEqual(
                plan["affectedIntervals"][0]["changedStoryboardId"],
                "sb-chapter-001-005",
            )

    def test_apply_marks_own_old_frame_keyframes_expired(self):
        """推广提交时自身旧帧依赖关键帧(首帧镜像/回接被改镜)标「已过期-禁止使用」:
        引用保留不删除;回接未改镜的帧与新帧不标;新帧另存版本(既有 sha 命名)。"""
        with tempfile.TemporaryDirectory() as temp:
            project, store_path, report_path = self.build_fixture(Path(temp))
            self.select_shot_fixture(report_path, shot=5)
            store = promotion.load_json(store_path)
            store["state"]["storyboards"][4]["keyframes"] = [
                {
                    "frameId": "sb-chapter-001-005-kf-1",
                    "mediaRef": {"kind": "image", "path": "/old-5.png"},
                    "inUs": 0,
                },
                {
                    "frameId": "sb-chapter-001-005-kf-2",
                    "mediaRef": {"kind": "image", "path": "/frames/002-tail.png"},
                    "inUs": 1_000_000,
                    "origin": {"kind": "legacy-shot", "legacyIndex": 2},
                },
                {
                    "frameId": "sb-chapter-001-005-kf-3",
                    "mediaRef": {"kind": "image", "path": "/frames/005-kf3.png"},
                    "inUs": 2_000_000,
                    "origin": {"kind": "generated"},
                },
            ]
            store_path.write_text(json.dumps(store), encoding="utf-8")

            plan = promotion.build_promotion_plan(
                report_path, store_path, project, selected_shot=5
            )
            promotion.apply_promotion(plan, True)

            shot = promotion.load_json(store_path)["state"]["storyboards"][4]
            keyframes = {kf["frameId"]: kf for kf in shot["keyframes"]}
            self.assertEqual(
                keyframes["sb-chapter-001-005-kf-1"]["status"],
                "已过期-禁止使用",
            )
            self.assertIn(
                "旧图配新镜清单",
                keyframes["sb-chapter-001-005-kf-1"]["expiredReason"],
            )
            self.assertGreater(keyframes["sb-chapter-001-005-kf-1"]["expiredSince"], 0)
            # 回接未改镜(legacyIndex=2 未在本次推广集)与新生成帧:不标
            self.assertNotIn("status", keyframes["sb-chapter-001-005-kf-2"])
            self.assertNotIn("status", keyframes["sb-chapter-001-005-kf-3"])
            # 不删除:三个旧帧引用原样保留
            self.assertEqual(
                keyframes["sb-chapter-001-005-kf-1"]["mediaRef"]["path"], "/old-5.png"
            )
            self.assertEqual(len(keyframes), 3)
            # 新帧另存版本:推广新图 sha 命名落盘(既有合同)
            self.assertIn("/approved-revisions/", shot["mediaRef"]["path"])


if __name__ == "__main__":
    unittest.main()
