import base64
import importlib.util
from io import BytesIO
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image


def load_pilot_module():
    path = Path(__file__).resolve().parents[1] / "generate_chapter001_continuity_sample.py"
    spec = importlib.util.spec_from_file_location("chapter001_continuity_pilot", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 pilot 模块: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ContinuityPilotAttemptLedgerTest(unittest.TestCase):
    def write_review_fixture(self, root: Path) -> Path:
        output = root / "pilot-output"
        output.mkdir()
        image_path = output / "shot-008-r03.png"
        thumbnail_path = output / "shot-008-r03_thumb.png"
        image_path.write_bytes(b"original-image-bytes")
        thumbnail_path.write_bytes(b"review-thumbnail-bytes")
        module = load_pilot_module()
        entry = {
            "index": 8,
            "storyboardId": "sb-chapter-001-008",
            "outputPath": str(image_path),
            "outputSha256": module.stable_sha256(image_path),
            "transferThumbnail": {
                "path": str(thumbnail_path),
                "bytes": thumbnail_path.stat().st_size,
                "sha256": module.stable_sha256(thumbnail_path),
            },
        }
        (output / "report.json").write_text(json.dumps({
            "status": "awaiting-human-approval",
            "awaitingApprovalShot": 8,
            "shots": [8],
            "entries": [entry],
            "groups": [{"groupId": "test-group", "shots": [8]}],
        }), encoding="utf-8")
        return output

    def test_non_gpt_async_transport_uses_task_creation_and_poll_endpoints(self):
        module = load_pilot_module()
        generator = module.load_generator()
        calls = []

        def fake_fetch_json(url, api_key, payload=None, timeout_seconds=180):
            calls.append((url, payload))
            if payload is not None:
                return {"task_id": "async-task-1", "status": "running"}
            return {
                "task_id": "async-task-1",
                "status": "success",
                "data": [],
                "result": {"data": [{"url": "https://example.invalid/generated.png"}]},
            }

        config = {
            "baseUrl": "https://api.mikoto.vip/v1",
            "apiKey": "test-key",
            "model": "seedream-4",
            "aspectRatio": "16:9",
            "resolution": "1K",
            "timeoutSeconds": 5,
            "asyncMode": True,
        }
        with patch.object(generator, "fetch_json", side_effect=fake_fetch_json), patch.object(generator.time, "sleep"):
            result = generator.request_storyboard_image_generation("异步运输回归", [], config)

        self.assertEqual(result, "https://example.invalid/generated.png")
        self.assertEqual(
            [url for url, _payload in calls],
            [
                "https://api.mikoto.vip/v1/images/generations/async",
                "https://api.mikoto.vip/v1/images/tasks/async-task-1",
            ],
        )

    def test_dry_run_selects_the_only_verified_capability_without_credentials(self):
        module = load_pilot_module()
        generator = module.load_generator()

        config = module.dry_run_provider_config(generator)

        self.assertEqual(config["providerName"], "mikoto")
        self.assertEqual(config["model"], "gpt-image-2")
        self.assertEqual(config["requestMode"], "openai-image-generations-json")
        self.assertTrue(config["dryRunCapabilityOnly"])
        self.assertNotIn("apiKey", config)
        self.assertNotIn("baseUrl", config)

    def test_parse_shots_accepts_ranges_and_rejects_invalid_bounds(self):
        module = load_pilot_module()

        self.assertEqual(module.parse_shots(" 1,3-4,3 "), [1, 3, 4])
        self.assertEqual(module.parse_shots("6-8,10"), [6, 7, 8, 10])

        with self.assertRaisesRegex(module.argparse.ArgumentTypeError, "镜头范围倒置"):
            module.parse_shots("4-2")
        for value in ("", "0", "44"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(module.argparse.ArgumentTypeError, "镜头范围必须位于 1..43"):
                    module.parse_shots(value)

    def test_selected_continuity_groups_require_current_contiguous_source_groups(self):
        module = load_pilot_module()
        group_a = {"groupId": "dock-front", "start": 1, "end": 3, "sceneName": "渡口", "viewpointId": "front"}
        group_b = {"groupId": "dock-side", "start": 5, "end": 6, "sceneName": "渡口", "viewpointId": "side"}
        source_shots = [
            {"index": 1, "_continuityGroup": group_a},
            {"index": 2, "_continuityGroup": group_a},
            {"index": 3, "_continuityGroup": group_a},
            {"index": 5, "_continuityGroup": group_b},
            {"index": 6},
        ]

        self.assertEqual(module.selected_continuity_groups(source_shots, [1, 2, 5]), [
            {"groupId": "dock-front", "start": 1, "end": 3, "sceneName": "渡口", "viewpointId": "front", "shots": [1, 2]},
            {"groupId": "dock-side", "start": 5, "end": 6, "sceneName": "渡口", "viewpointId": "side", "shots": [5]},
        ])
        with self.assertRaisesRegex(RuntimeError, "必须按升序且不能重复"):
            module.selected_continuity_groups(source_shots, [2, 1])
        with self.assertRaisesRegex(RuntimeError, "只能选择连续镜头"):
            module.selected_continuity_groups(source_shots, [1, 3])
        with self.assertRaisesRegex(RuntimeError, "不在当前分镜源中"):
            module.selected_continuity_groups(source_shots, [9])
        with self.assertRaisesRegex(RuntimeError, "缺少由当前分镜源推导的连续镜头组"):
            module.selected_continuity_groups(source_shots, [6])

    def test_invalidate_restart_state_removes_only_restart_tail_and_preserves_inputs(self):
        module = load_pilot_module()
        group = {"groupId": "dock-front", "start": 1, "end": 3, "sceneName": "渡口", "viewpointId": "front"}
        source_shots = [{"index": index, "_continuityGroup": group} for index in (1, 2, 3)]
        entries = {
            1: {"index": 1, "outputPath": "shot-001.png"},
            2: {"index": 2, "outputPath": "shot-002.png"},
            3: {"index": 3, "outputPath": "shot-003.png"},
            5: {"index": 5, "outputPath": "shot-005.png"},
        }
        approvals = {
            "approvals": {
                "1": {"status": "approved"},
                "2": {"status": "approved"},
                "3": {"status": "rejected"},
                "5": {"status": "approved"},
            }
        }

        next_entries, next_approvals, superseded = module.invalidate_restart_state(
            source_shots,
            [1, 2, 3, 5],
            entries,
            approvals,
            2,
        )

        self.assertEqual(sorted(next_entries), [1, 5])
        self.assertEqual(sorted(next_approvals["approvals"]), ["1", "5"])
        self.assertEqual([item["index"] for item in superseded], [2, 3])
        self.assertEqual(superseded[0]["approval"], {"status": "approved"})
        self.assertEqual(superseded[1]["approval"], {"status": "rejected"})
        self.assertIn(2, entries)
        self.assertIn("2", approvals["approvals"])

        with self.assertRaisesRegex(RuntimeError, "不在本次连续性范围内"):
            module.invalidate_restart_state(source_shots, [1, 2, 3], entries, approvals, 5)

    def test_required_previous_selected_shot_validates_exact_storyboard_link(self):
        module = load_pilot_module()

        self.assertIsNone(module.required_previous_selected_shot({}, [1, 2], 2))
        self.assertIsNone(module.required_previous_selected_shot(
            {"previousStoryboardId": "sb-chapter-001-001"},
            [2],
            2,
        ))
        self.assertEqual(module.required_previous_selected_shot(
            {"previousStoryboardId": "sb-chapter-001-001"},
            [1, 2],
            2,
        ), 1)
        with self.assertRaisesRegex(RuntimeError, "连续关系应承接 sb-chapter-001-001"):
            module.required_previous_selected_shot(
                {"previousStoryboardId": "sb-chapter-001-999"},
                [1, 2],
                2,
            )

    def test_merge_planned_continuity_versions_rejects_fingerprint_conflicts(self):
        module = load_pilot_module()
        planned = {}

        module.merge_planned_continuity_versions(planned, [{
            "assetId": "asset-1",
            "versionId": "asset-1:base:v1",
            "contentFingerprint": "fingerprint-a",
            "label": "first",
        }])
        module.merge_planned_continuity_versions(planned, [{
            "assetId": "asset-1",
            "versionId": "asset-1:base:v1",
            "contentFingerprint": "fingerprint-a",
            "label": "updated",
        }])
        self.assertEqual(planned["asset-1:asset-1:base:v1"]["label"], "updated")

        with self.assertRaisesRegex(RuntimeError, "内容指纹冲突"):
            module.merge_planned_continuity_versions(planned, [{
                "assetId": "asset-1",
                "versionId": "asset-1:base:v1",
                "contentFingerprint": "fingerprint-b",
            }])

    def test_restart_requires_explicit_paid_retry_confirmation(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(
                sys,
                "argv",
                [
                    "generate_chapter001_continuity_sample.py",
                    "--shots",
                    "8",
                    "--output-dir",
                    temp,
                    "--restart-from-shot",
                    "8",
                ],
            ):
                with self.assertRaisesRegex(RuntimeError, "--confirm-paid-retry"):
                    module.main()

    def test_watermark_test_variant_requires_an_explicit_restart(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(
                sys,
                "argv",
                [
                    "generate_chapter001_continuity_sample.py",
                    "--shots",
                    "8",
                    "--output-dir",
                    temp,
                    "--watermark-test-variant",
                    "--confirm-paid-request",
                ],
            ):
                with self.assertRaisesRegex(RuntimeError, "--restart-from-shot"):
                    module.main()

    def test_watermark_test_variant_is_recorded_in_the_prompt(self):
        module = load_pilot_module()

        unchanged = module.apply_watermark_test_variant("原始分镜提示词", False)
        strengthened = module.apply_watermark_test_variant("原始分镜提示词", True)

        self.assertEqual(unchanged, "原始分镜提示词")
        self.assertIn("原始分镜提示词", strengthened)
        self.assertIn("水印复测硬约束", strengthened)
        self.assertIn("不得包含平台标识", strengthened)

    def test_counts_unique_attempts_and_latest_terminal_status(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "generation-attempts.jsonl"
            module.append_generation_attempt(path, {"attemptId": "shot-008:shot-008", "status": "started"})
            module.append_generation_attempt(
                path,
                {"attemptId": "shot-008:shot-008", "status": "failed-or-ambiguous"},
            )
            module.append_generation_attempt(path, {"attemptId": "shot-009:shot-009", "status": "started"})

            summary = module.summarize_generation_attempts(path)

            self.assertEqual(summary["attemptCount"], 2)
            self.assertEqual(summary["statusCounts"], {"failed-or-ambiguous": 1, "started": 1})
            self.assertEqual(summary["openAttemptIds"], ["shot-009:shot-009"])
            self.assertEqual(len(summary["events"]), 3)

    def test_rejects_corrupt_or_incomplete_event_lines(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "generation-attempts.jsonl"
            path.write_text('{"status":"started"}\n', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "缺少 attemptId"):
                module.summarize_generation_attempts(path)

    def test_human_rejection_requires_reason_and_is_immutable(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            output = self.write_review_fixture(Path(temp))
            image_path = output / "shot-008-r03.png"
            thumbnail_path = output / "shot-008-r03_thumb.png"
            before_image = image_path.read_bytes()
            before_thumbnail = thumbnail_path.read_bytes()

            with self.assertRaisesRegex(RuntimeError, "非空审核原因"):
                module.reject_generated_shot(output, 8, True, "")
            self.assertFalse((output / "human-approvals.json").exists())

            result = module.reject_generated_shot(output, 8, True, "右上与右下有可见水印")

            self.assertEqual(result["status"], "rejected")
            approval_path = output / "human-approvals.json"
            approvals = json.loads(approval_path.read_text(encoding="utf-8"))
            record = approvals["approvals"]["8"]
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(record["status"], "rejected")
            self.assertTrue(module.valid_human_rejection(approvals, 8, report["entries"][0]))
            self.assertFalse(module.valid_human_approval(approvals, 8, report["entries"][0]))
            self.assertEqual(report["status"], "rejected")
            self.assertIsNone(report["awaitingApprovalShot"])
            self.assertEqual(report["rejectedShots"], [8])
            self.assertEqual(report["groups"][0]["rejectedShots"], [8])
            self.assertEqual(image_path.read_bytes(), before_image)
            self.assertEqual(thumbnail_path.read_bytes(), before_thumbnail)
            with self.assertRaisesRegex(RuntimeError, "已有人工审核结论"):
                module.reject_generated_shot(output, 8, True, "重复拒绝")

    def test_human_approval_clears_derived_awaiting_shot(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            output = self.write_review_fixture(Path(temp))

            receipt = module.approve_generated_shot(output, 8, True, "用户批准")
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))

            self.assertEqual(receipt["status"], "completed")
            self.assertEqual(report["awaitingApprovalShot"], None)
            self.assertEqual(report["approvedShots"], [8])
            self.assertEqual(report["groups"][0]["approvedShots"], [8])

    def test_v2_human_approval_requires_the_complete_visual_checklist(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            output = self.write_review_fixture(Path(temp))
            report_path = output / "report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["entries"][0]["styleContractVersion"] = "daojie-gongbi-v2"
            report["entries"][0]["styleContractFingerprint"] = "v2-test"
            report["entries"][0]["colorAudit"] = {"status": "pass"}
            report_path.write_text(json.dumps(report), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "必须确认"):
                module.approve_generated_shot(output, 8, True, "用户批准")

            checklist = {
                field: True
                for field in module.daojie_gongbi_v2.HUMAN_REVIEW_CHECKLIST_FIELDS
            }
            receipt = module.approve_generated_shot(output, 8, True, "用户批准", checklist)
            self.assertEqual(receipt["approval"]["reviewChecklist"], checklist)

    def test_v2_rejects_a_legacy_approved_frame_as_the_next_shot_reference(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            image_path = Path(temp) / "legacy.png"
            image_path.write_bytes(b"legacy-image")
            with self.assertRaisesRegex(RuntimeError, "旧风格镜头"):
                module.previous_approved_frame_manifest(
                    type("Generator", (), {"EPISODE_ID": "chapter-001"})(),
                    9,
                    {
                        "outputPath": str(image_path),
                        "styleContractVersion": "daojie-gongbi-v1",
                    },
                    {"approvalFingerprint": "human"},
                    1,
                )

    def test_v2_capability_summary_stays_blocked_without_provider_evidence(self):
        module = load_pilot_module()
        report = module.summarize_reference_capabilities([{
            "index": 8,
            "referenceRoles": ["scene-viewpoint", "canonical"],
            "referenceCapability": {
                "schemaVersion": module.daojie_gongbi_v2.REFERENCE_CAPABILITY_SCHEMA_VERSION,
                "status": "unverified",
                "providerName": "no-network-unconfigured",
                "model": "unconfigured",
                "reason": "no provider evidence",
                "styleReference": {"enabled": False, "sha256": None},
            },
        }])

        self.assertEqual(report["status"], "blocked")
        self.assertFalse(report["requestAllowed"])
        self.assertEqual(report["blockedShotIndexes"], [8])
        self.assertEqual(report["providerModels"][0]["providerName"], "no-network-unconfigured")

    def test_v2_capability_summary_blocks_verified_model_over_its_reference_limit(self):
        module = load_pilot_module()
        capability = {
            "schemaVersion": module.daojie_gongbi_v2.REFERENCE_CAPABILITY_SCHEMA_VERSION,
            "status": "verified",
            "providerName": "mikoto",
            "model": "gpt-image-2",
            "supportedReferenceCount": 9,
            "referenceRoleOrder": list(module.daojie_gongbi_v2.REFERENCE_ROLE_ORDER),
            "evidence": {
                "kind": "test",
                "checkedAt": "2026-07-20",
                "detail": "verified capacity fixture",
            },
            "styleReference": {"enabled": False, "sha256": None},
        }
        report = module.summarize_reference_capabilities([{
            "index": 1,
            "referenceRoles": ["scene-viewpoint", *(["canonical"] * 9)],
            "referenceCapability": capability,
        }])

        self.assertEqual(report["status"], "blocked")
        self.assertFalse(report["requestAllowed"])
        self.assertEqual(report["blockedShotIndexes"], [1])
        self.assertIn("超过已验证容量 9", next(iter(report["blockingReasons"])))

    def test_v2_capability_summary_keeps_source_and_transport_counts_distinct(self):
        module = load_pilot_module()
        capability = {
            "schemaVersion": module.daojie_gongbi_v2.REFERENCE_CAPABILITY_SCHEMA_VERSION,
            "status": "verified",
            "providerName": "mikoto",
            "model": "gpt-image-2",
            "supportedReferenceCount": 9,
            "referenceRoleOrder": list(module.daojie_gongbi_v2.REFERENCE_ROLE_ORDER),
            "evidence": {"kind": "test", "checkedAt": "2026-07-20", "detail": "transport fixture"},
            "styleReference": {"enabled": False, "sha256": None},
        }
        report = module.summarize_reference_capabilities([{
            "index": 28,
            "referenceRoles": ["scene-viewpoint", *( ["canonical"] * 7), "prop-state"],
            "referenceCapability": capability,
            "referenceTransport": {
                "sourceReferenceCount": 13,
                "providerReferenceCount": 9,
            },
        }])

        self.assertEqual(report["status"], "ready")
        self.assertTrue(report["requestAllowed"])
        model_report = report["providerModels"][0]
        self.assertEqual(model_report["requestedSourceReferenceCounts"], [13])
        self.assertEqual(model_report["requestedProviderReferenceCounts"], [9])

    def test_paid_attempt_metadata_reaches_the_gpt_request_config(self):
        module = load_pilot_module()
        generator = module.load_generator()
        observed = {}
        postprocess_order = []
        png_buffer = BytesIO()
        Image.new("RGB", (2, 2), (40, 90, 120)).save(png_buffer, format="PNG")
        output_png = base64.b64encode(png_buffer.getvalue()).decode("ascii")
        original_save = generator.save_generated_image_url
        original_thumbnail = generator.create_storyboard_transfer_thumbnail

        def fake_request(_prompt, _references, request_config):
            observed.update(request_config)
            observed["requestReferences"] = list(_references)
            return f"data:image/png;base64,{output_png}"

        def fake_preflight(references):
            prepared = [f"prepared-reference-{index}" for index, _item in enumerate(references, 1)]
            observed["preflightReferences"] = prepared
            return prepared, {
                "schemaVersion": "test-model-reference-preflight",
                "referenceCount": len(prepared),
                "totalBytes": 0,
                "references": [],
                "fingerprint": "test-preflight-fingerprint",
            }

        def tracked_save(image_url, output_path):
            postprocess_order.append("save")
            return original_save(image_url, output_path)

        def tracked_color_audit(_output_path):
            postprocess_order.append("color-audit")
            return {"status": "pass"}

        def tracked_thumbnail(output_path):
            postprocess_order.append("thumbnail")
            return original_thumbnail(output_path)

        source_shot = {
            "index": 1,
            "sceneNo": 1,
            "scene": "金水河码头",
            "desc": "赤练蛇皮鞭撕开河雾，朱红火印压在藤筐侧面。",
            "speaker": "旁白",
            "text": "鞭梢划过河雾。",
            "sound": "鞭梢破风声",
            "assets": ["赤练蛇皮鞭", "灵矿藤筐"],
            "assetIds": [],
            "duration": 3.0,
            "trackKey": "chapter-001-scene-1",
            "shotSemantics": {
                "sceneViewpointId": "dock-main-axis",
                "personFree": True,
                "visibleCharacters": [],
                "visibleProps": [
                    {"name": "赤练蛇皮鞭", "position": "左前景", "state": "掠过河雾"},
                    {"name": "灵矿藤筐", "position": "右前景", "state": "停在火印旁"},
                ],
                "actionIn": "鞭梢掠过藤筐上方的河雾。",
                "actionOut": "朱红火印停在藤筐侧面。",
            },
        }
        generator.attach_storyboard_continuity_groups([source_shot])

        with tempfile.TemporaryDirectory() as temp:
            with patch.dict(os.environ, {
                "MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE": "real-ai-reference-image-workflow",
                "MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON": json.dumps([{
                    "providerName": "mikoto",
                    "baseUrl": "https://api.mikoto.vip/v1",
                    "apiKey": "test-key",
                    "model": "gpt-image-2",
                    "aspectRatio": "16:9",
                    "resolution": "1K",
                    "asyncMode": True,
                }]),
            }), patch.object(module, "load_generator", return_value=generator), patch.object(
                generator,
                "storyboard_image_provider_config",
                return_value=generator.with_daojie_gongbi_v2_contract({
                    "providerName": "mikoto",
                    "baseUrl": "https://api.mikoto.vip/v1",
                    "apiKey": "test-key",
                    "apiKeys": ["test-key"],
                    "model": "gpt-image-2",
                    "aspectRatio": "16:9",
                    "resolution": "1K",
                    "timeoutSeconds": 360,
                    "asyncMode": True,
                }),
            ), patch.object(
                generator,
                "resolve_storyboard_source",
                return_value={"kind": "test", "workId": "", "updatedAt": 0, "data": "", "shots": [source_shot]},
            ), patch.object(
                generator,
                "request_storyboard_image_generation",
                side_effect=fake_request,
            ), patch.object(
                generator,
                "prepare_storyboard_model_reference_images",
                side_effect=fake_preflight,
            ), patch.object(
                generator,
                "build_storyboard_reference_visual_audit",
                return_value={
                    "schemaVersion": "daojie-reference-visual-audit-v1",
                    "status": "pass",
                    "failedGates": [],
                    "references": [],
                },
            ), patch.object(
                generator,
                "save_generated_image_url",
                side_effect=tracked_save,
            ), patch.object(
                generator,
                "audit_daojie_gongbi_v2_output",
                side_effect=tracked_color_audit,
            ), patch.object(
                generator,
                "create_storyboard_transfer_thumbnail",
                side_effect=tracked_thumbnail,
            ), patch.object(
                sys,
                "argv",
                [
                    "generate_chapter001_continuity_sample.py",
                    "--shots",
                    "1",
                    "--output-dir",
                    temp,
                    "--confirm-paid-request",
                ],
            ):
                module.main()
            entry = json.loads((Path(temp) / "report.json").read_text(encoding="utf-8"))["entries"][0]
            observed["reportPreflight"] = entry["modelReferencePreflight"]
            observed["transferThumbnail"] = entry["transferThumbnail"]
            observed["prompt"] = entry["prompt"]
            observed["promptSha256"] = entry["promptSha256"]
            observed["providerPromptPolicy"] = entry["providerPromptPolicy"]

        self.assertTrue(observed["singleAttempt"])
        self.assertTrue(observed["paidAuthorization"])
        self.assertEqual(
            observed["attemptId"],
            module.generation_attempt_id(Path(temp), 1, Path(temp) / "shot-001.png"),
        )
        self.assertEqual(observed["logicalJob"], "daojie-chapter001-continuity-pilot")
        self.assertEqual(observed["logicalShot"], "sb-chapter-001-001")
        self.assertEqual(observed["requestReferences"], observed["preflightReferences"])
        self.assertEqual(observed["reportPreflight"]["fingerprint"], "test-preflight-fingerprint")
        self.assertEqual(
            observed["promptSha256"],
            module.hashlib.sha256(observed["prompt"].encode("utf-8")).hexdigest(),
        )
        self.assertEqual(observed["providerPromptPolicy"], "exact-reviewed-v2")
        self.assertEqual(postprocess_order, ["save", "color-audit", "thumbnail"])
        self.assertLessEqual(max(observed["transferThumbnail"]["width"], observed["transferThumbnail"]["height"]), 768)
        self.assertLess(observed["transferThumbnail"]["bytes"], 1_000_000)

    def test_transfer_thumbnail_has_a_strict_edge_and_byte_cap(self):
        module = load_pilot_module()
        generator = module.load_generator()
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "large-source.png"
            Image.new("RGB", (1600, 1000), (72, 105, 138)).save(source, format="PNG")

            report = generator.create_storyboard_transfer_thumbnail(source)

            self.assertLessEqual(max(report["width"], report["height"]), 768)
            self.assertLess(report["bytes"], 1_000_000)
            self.assertTrue(Path(report["path"]).is_file())
            self.assertEqual(module.stable_sha256(Path(report["path"])), report["sha256"])

    def test_attempt_id_is_scoped_to_the_non_overwriting_output_directory(self):
        module = load_pilot_module()
        first_dir = Path("/tmp/pilot-a04")
        second_dir = Path("/tmp/pilot-a05")

        first = module.generation_attempt_id(first_dir, 1, first_dir / "shot-001.png")
        second = module.generation_attempt_id(second_dir, 1, second_dir / "shot-001.png")

        self.assertNotEqual(first, second)
        self.assertTrue(first.endswith(":shot-001:shot-001"))
        self.assertTrue(second.endswith(":shot-001:shot-001"))

    def test_provider_completed_local_failure_is_not_labeled_ambiguous(self):
        module = load_pilot_module()

        self.assertEqual(
            module.generation_failure_status({"status": "COMPLETED", "taskId": "task-1"}),
            "provider-completed-local-failure",
        )
        self.assertEqual(
            module.generation_failure_status({"status": "TASK_ACCEPTED", "taskId": "task-1"}),
            "failed-or-ambiguous",
        )
        self.assertEqual(module.generation_failure_status(None), "failed-or-ambiguous")

    def test_human_rejection_blocks_paid_execution_before_generator_setup(self):
        module = load_pilot_module()
        with tempfile.TemporaryDirectory() as temp:
            output = self.write_review_fixture(Path(temp))
            module.reject_generated_shot(output, 8, True, "右上与右下有可见水印")

            with patch.object(
                sys,
                "argv",
                [
                    "generate_chapter001_continuity_sample.py",
                    "--shots",
                    "8",
                    "--output-dir",
                    str(output),
                    "--confirm-paid-request",
                ],
            ), patch.object(module, "load_generator", side_effect=AssertionError("must not load generator")):
                with self.assertRaisesRegex(RuntimeError, "已人工拒绝"):
                    module.main()

    def test_cli_dispatches_rejection_without_entering_paid_path(self):
        module = load_pilot_module()
        expected = {"ok": True, "status": "rejected", "rejectedShot": 8}
        with patch.object(
            sys,
            "argv",
            [
                "generate_chapter001_continuity_sample.py",
                "--output-dir",
                "/tmp/pilot-output",
                "--reject-shot",
                "8",
                "--human-confirmed",
                "--rejection-reason",
                "可见水印",
            ],
        ), patch.object(module, "reject_generated_shot", return_value=expected) as reject, patch("builtins.print"):
            module.main()

        reject.assert_called_once_with(Path("/tmp/pilot-output").resolve(), 8, True, "可见水印", {})

    def test_full_chapter_dry_run_reports_all_43_blocked_without_network(self):
        script = Path(__file__).resolve().parents[1] / "generate_chapter001_continuity_sample.py"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "dry-run"
            ledger = root / "paid-ledger.jsonl"
            env = {
                **os.environ,
                "MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE": "real-ai-reference-image-workflow",
                "MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON": json.dumps([{
                    "providerName": "mikoto",
                    "baseUrl": "https://dry-run.invalid/v1",
                    "apiKey": "dry-run-no-network",
                    "model": "gpt-image-2",
                }]),
                "MYSTUDIO_IMAGE_ASYNC_MODE": "1",
                "MYSTUDIO_IMAGE_PAID_REQUEST_LEDGER": str(ledger),
            }

            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--full-chapter",
                    "--dry-run",
                    "--output-dir",
                    str(output),
                ],
                cwd=Path(__file__).resolve().parents[2],
                env=env,
                text=True,
                capture_output=True,
                timeout=60,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "blocked")
            self.assertEqual(report["blockedShotIndexes"], list(range(1, 44)))
            self.assertEqual(len(report["entries"]), 43)
            self.assertFalse(report["generationEndpointCalled"])
            self.assertEqual(report["generationAttemptCount"], 0)
            self.assertFalse(report["paidAuthorization"])
            self.assertFalse(report["mutatedProductionProject"])
            self.assertFalse(ledger.exists())


if __name__ == "__main__":
    unittest.main()
