from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from Library.ai import build_chapter001_reference_replacement_manifests as builder
from Library.ai import chapter001_continuity_asset_candidate as contract
from Library.ai import daojie_gongbi_v2 as v2


class Chapter001ContinuityAssetCandidateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.plan = builder.build_review_plan()
        self.plan_path = self.root / "plan.json"
        self.plan_path.write_text(
            json.dumps(self.plan, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        self.plan_sha256 = contract.sha256_file(self.plan_path)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def manifest_for(self, index: int) -> dict:
        return builder.build_candidate_manifest(
            self.plan["jobs"][index],
            plan_path=self.plan_path,
            plan_sha256=self.plan_sha256,
        )

    def validate(self, manifest: dict, *, dry_run: bool) -> dict:
        path = self.root / f"{manifest['candidateId']}.json"
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return contract.load_and_validate_manifest(path, dry_run=dry_run)

    def test_builds_three_unique_compact_jobs_without_paid_authorization(self) -> None:
        self.assertEqual(len(self.plan["jobs"]), 3)
        self.assertEqual(len({job["outputPath"] for job in self.plan["jobs"]}), 3)
        self.assertEqual(
            self.plan["promptContractRevision"],
            "daojie-gongbi-v2-reference-replacement-v2",
        )
        self.assertEqual(
            {job["assetKind"] for job in self.plan["jobs"]},
            {"scene", "character"},
        )
        for job in self.plan["jobs"]:
            self.assertTrue(job["jobId"].endswith("-r02"))
            self.assertEqual(job["promptAudit"]["status"], "pass")
            self.assertEqual(job["promptAudit"]["violations"], [])
            self.assertEqual(job["referenceReplacementPromptAudit"]["status"], "pass")
            self.assertEqual(job["referenceReplacementPromptAudit"]["violations"], [])
            self.assertLessEqual(job["referenceReplacementPromptAudit"]["promptChars"], 900)
            self.assertEqual(job["prompt"].count("均匀平光宣纸照明"), 1)
            self.assertEqual(job["prompt"].count("禁止写实摄影"), 1)
            self.assertEqual(job["prompt"].count("30%-40%"), 1)
            self.assertEqual(job["prompt"].count("【反向约束】"), 1)
            self.assertEqual(job["prompt"].rfind("【反向约束】"), job["prompt"].find("【反向约束】"))
            self.assertNotIn("【参考继承边界】", job["prompt"])
            self.assertNotIn("【光影】", job["prompt"])
            self.assertIn("【光源】", job["prompt"])
            self.assertTrue(job["prompt"].startswith("【主体事实】输入旧图仅"))
            self.assertFalse(job["paidAuthorization"])
            self.assertFalse(job["requestAllowed"])

    def test_scene_prompt_removes_character_noise_and_spatializes_color_balance(self) -> None:
        scene = self.plan["jobs"][0]
        prompt = scene["prompt"]

        self.assertEqual(scene["assetKind"], "scene")
        self.assertNotIn("人物的脸、手", prompt)
        self.assertNotIn("衣物完整可穿", prompt)
        self.assertNotIn("矿物颜料颗粒", prompt)
        self.assertIn("冷色连续可见区", prompt)
        self.assertIn("暖色连续可见区", prompt)
        self.assertIn("石阶与地面保持淡墨、纸白", prompt)
        self.assertIn("密集碎线", v2.extract_prompt_section(prompt, "反向约束"))
        self.assertNotIn("密集碎线", v2.extract_prompt_section(prompt, "媒介层级"))

    def test_character_prompts_keep_identity_specific_clothing_once(self) -> None:
        for job in self.plan["jobs"][1:]:
            prompt = job["prompt"]
            negative = v2.extract_prompt_section(prompt, "反向约束")
            self.assertEqual(job["assetKind"], "character")
            self.assertEqual(prompt.count("衣物完整可穿"), 1)
            self.assertEqual(prompt.count("连续白描和铁线描"), 1)
            self.assertEqual(prompt.count("整袖口"), 1)
            self.assertEqual(prompt.count("整下摆"), 1)
            self.assertEqual(prompt.count("闭合缝线"), 1)
            self.assertEqual(prompt.count("完整裤脚"), 1)
            self.assertEqual(negative.count("衣物不完整"), 1)
            self.assertEqual(negative.count("破洞"), 1)
            self.assertEqual(negative.count("断裂衣摆"), 1)
            self.assertNotIn("浅灰暖白", prompt)
            self.assertIn("背景为均匀暖白宣纸", prompt)
            self.assertLessEqual(prompt.count("朴素且干净"), 1)

    def test_replacement_prompt_audit_rejects_the_consumed_bloated_prompt(self) -> None:
        prior_plan = json.loads(
            (
                builder.TASK_DIR
                / "research/daojie-gongbi-v2-shot001-reference-replacement-plan-20260723-r02.json"
            ).read_text(encoding="utf-8")
        )

        audit = v2.reference_replacement_prompt_audit(prior_plan["jobs"][0]["prompt"], "scene")

        self.assertEqual(audit["status"], "fail")
        self.assertIn("prompt_too_long", audit["violations"])
        self.assertIn("duplicate_prompt_directives", audit["violations"])
        self.assertIn("unexpected_prompt_sections", audit["violations"])
        self.assertIn("irrelevant_scene_character_rules", audit["violations"])

    def test_accepts_scene_and_character_manifests_for_dry_run(self) -> None:
        for index in range(3):
            result = self.validate(self.manifest_for(index), dry_run=True)
            self.assertFalse(result["paidAuthorizationVerified"])
            self.assertFalse(result["requestAllowed"])
            self.assertRegex(result["requestBindingSha256"], r"^[a-f0-9]{64}$")

    def test_rejects_real_request_without_bound_authorization(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "单次付费授权"):
            self.validate(self.manifest_for(0), dry_run=False)

    def test_accepts_real_request_only_after_exact_binding_is_authorized(self) -> None:
        manifest = self.manifest_for(0)
        manifest["requestAllowed"] = True
        manifest["paidAuthorization"] = {
            "authorized": True,
            "userStatement": "授权一次金水河傍晚码头 V2 资产付费生成",
            "scope": "Exactly one bound asset request. No retry, fallback, store write, or approval.",
            "bindingSha256": manifest["requestBindingSha256"],
        }
        result = self.validate(manifest, dry_run=False)
        self.assertTrue(result["paidAuthorizationVerified"])
        self.assertTrue(result["requestAllowed"])

    def test_rejects_prompt_reference_and_binding_drift(self) -> None:
        prompt_drift = self.manifest_for(0)
        prompt_drift["prompt"] += " drift"
        with self.assertRaisesRegex(RuntimeError, "promptSha256"):
            self.validate(prompt_drift, dry_run=True)

        reference_drift = self.manifest_for(1)
        reference_drift["referenceImageSha256"] = ["0" * 64]
        reference_drift["requestBindingSha256"] = contract.request_binding_sha256(reference_drift)
        with self.assertRaisesRegex(RuntimeError, "参考图 1 SHA-256"):
            self.validate(reference_drift, dry_run=True)

        binding_drift = self.manifest_for(2)
        binding_drift["requestBindingSha256"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "requestBindingSha256"):
            self.validate(binding_drift, dry_run=True)

    def test_rejects_forged_prompt_audit_and_unsupported_asset_kind(self) -> None:
        forged_audit = self.manifest_for(0)
        forged_audit["promptAudit"] = copy.deepcopy(forged_audit["promptAudit"])
        forged_audit["promptAudit"]["status"] = "pass"
        forged_audit["promptAudit"]["violations"] = ["forged"]
        with self.assertRaisesRegex(RuntimeError, "promptAudit"):
            self.validate(forged_audit, dry_run=True)

        unsupported = self.manifest_for(0)
        unsupported["assetKind"] = "video"
        unsupported["requestBindingSha256"] = contract.request_binding_sha256(unsupported)
        with self.assertRaisesRegex(RuntimeError, "assetKind"):
            self.validate(unsupported, dry_run=True)

    def test_rejects_forged_replacement_audit_and_contract_revision_drift(self) -> None:
        forged_audit = self.manifest_for(0)
        forged_audit["referenceReplacementPromptAudit"] = copy.deepcopy(
            forged_audit["referenceReplacementPromptAudit"]
        )
        forged_audit["referenceReplacementPromptAudit"]["violations"] = ["forged"]
        with self.assertRaisesRegex(RuntimeError, "referenceReplacementPromptAudit"):
            self.validate(forged_audit, dry_run=True)

        revision_drift = self.manifest_for(1)
        revision_drift["promptContractRevision"] = "daojie-gongbi-v2-reference-replacement-v1"
        with self.assertRaisesRegex(RuntimeError, "promptContractRevision"):
            self.validate(revision_drift, dry_run=True)

    def test_writes_non_overwriting_plan_and_manifests(self) -> None:
        output_plan = self.root / "r02.json"
        manifest_dir = self.root / "manifests"
        report = builder.write_artifacts(output_plan=output_plan, manifest_dir=manifest_dir)
        self.assertEqual(report["manifestCount"], 3)
        self.assertFalse(report["generationEndpointCalled"])
        self.assertFalse(report["paidAuthorization"])
        self.assertFalse(report["requestAllowed"])
        with self.assertRaisesRegex(RuntimeError, "拒绝覆盖"):
            builder.write_artifacts(output_plan=output_plan, manifest_dir=manifest_dir)


if __name__ == "__main__":
    unittest.main()
