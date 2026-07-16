from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from Library.ai.promote_chapter001_continuity_approvals import (
    MAX_EVIDENCE_BYTES,
    continuity_asset_approval_fingerprint,
    continuity_asset_content_fingerprint,
    normalize_continuity_asset_version,
    promote_human_approval,
    validate_review_evidence,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPOSITORY_ROOT / "Library/ai/promote_chapter001_continuity_approvals.py"


class PromoteChapter001ContinuityApprovalsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.reference = self.root / "canonical.png"
        Image.new("RGB", (16, 16), (20, 40, 60)).save(self.reference, format="PNG")
        self.other_reference = self.root / "other.png"
        Image.new("RGB", (16, 16), (60, 40, 20)).save(self.other_reference, format="PNG")
        self.evidence = self.root / "review_thumb.png"
        Image.new("RGB", (768, 512), (80, 100, 120)).save(self.evidence, format="PNG")
        self.asset_id = "prop:test"
        self.version_id = "prop:test:base:v1"
        self.other_asset_id = "prop:other"
        self.other_version_id = "prop:other:base:v1"
        self.version = self.make_version(
            self.asset_id,
            self.version_id,
            self.reference,
        )
        self.version["reviewEvidencePaths"] = [str(self.evidence.resolve())]
        self.version["reviewEvidenceSha256"] = [self.sha256_path(self.evidence)]
        self.other_version = self.make_version(
            self.other_asset_id,
            self.other_version_id,
            self.other_reference,
        )
        self.manifest_path = self.root / "manifest.json"
        self.store_path = self.root / "studio-workflow-store.json"
        self.write_fixture()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def sha256_path(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def make_version(
        self,
        asset_id: str,
        version_id: str,
        reference: Path,
    ) -> dict[str, object]:
        version: dict[str, object] = {
            "assetId": asset_id,
            "versionId": version_id,
            "assetKind": "prop",
            "label": "chapter-001-base",
            "referenceImagePaths": [str(reference.resolve())],
            "referenceImageSha256": [self.sha256_path(reference)],
            "source": "test-bible",
            "structurallyComplete": True,
            "reviewStatus": "pending",
            "approval": None,
            "approvalFingerprint": None,
            "approved": False,
        }
        version["contentFingerprint"] = continuity_asset_content_fingerprint(version)
        return version

    def write_fixture(self) -> None:
        manifest = {
            "projectDir": str(self.root),
            "continuityAssetVersions": [copy.deepcopy(self.version)],
        }
        storyboard = {
            "id": "sb-001",
            "stale": True,
            "staleReason": "等待重新生成",
            "staleSince": 5,
            "visualReview": {"status": "pending", "reasons": ["等待人工审核"]},
            "orderedReferenceManifest": [
                {
                    "order": 1,
                    "assetId": self.asset_id,
                    "versionId": self.version_id,
                    "contentFingerprint": self.version["contentFingerprint"],
                    "approvalFingerprint": None,
                    "approved": False,
                },
                {
                    "order": 2,
                    "assetId": self.other_asset_id,
                    "versionId": self.other_version_id,
                    "contentFingerprint": self.other_version["contentFingerprint"],
                    "approvalFingerprint": None,
                    "approved": False,
                },
            ],
        }
        store = {
            "version": 0,
            "state": {
                "continuityAssetVersions": [
                    copy.deepcopy(self.version),
                    copy.deepcopy(self.other_version),
                ],
                "storyboards": [storyboard],
            },
        }
        self.manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        self.store_path.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")

    def promote(self, **overrides: object) -> dict[str, object]:
        arguments: dict[str, object] = {
            "store_path": self.store_path,
            "manifest_path": self.manifest_path,
            "asset_id": self.asset_id,
            "version_id": self.version_id,
            "evidence_paths": [self.evidence],
            "reviewed_at": 10,
        }
        arguments.update(overrides)
        return promote_human_approval(**arguments)

    def test_dry_run_reports_change_without_writing(self) -> None:
        before = self.store_path.read_bytes()
        report = self.promote()

        self.assertTrue(report["dryRun"])
        self.assertTrue(report["changed"])
        self.assertEqual(report["orderedReferenceUpdates"], 1)
        self.assertEqual(report["storyboardReviewsChanged"], 0)
        self.assertEqual(report["staleFlagsCleared"], 0)
        self.assertEqual(self.store_path.read_bytes(), before)
        self.assertEqual(list(self.root.glob("*.bak-continuity-approval-*")), [])

    def test_cli_dry_run_emits_json_without_writing(self) -> None:
        before = self.store_path.read_bytes()
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--store",
                str(self.store_path),
                "--manifest",
                str(self.manifest_path),
                "--asset-id",
                self.asset_id,
                "--version-id",
                self.version_id,
                "--evidence",
                str(self.evidence),
            ],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)

        self.assertTrue(report["dryRun"])
        self.assertEqual(report["assetId"], self.asset_id)
        self.assertEqual(self.store_path.read_bytes(), before)

    def test_apply_requires_explicit_human_confirmation(self) -> None:
        before = self.store_path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "--apply 与 --human-confirmed"):
            self.promote(apply=True, human_confirmed=False)
        self.assertEqual(self.store_path.read_bytes(), before)

    def test_apply_updates_only_selected_asset_and_matching_references(self) -> None:
        before_store = json.loads(self.store_path.read_text(encoding="utf-8"))
        before_storyboard = copy.deepcopy(before_store["state"]["storyboards"][0])
        report = self.promote(apply=True, human_confirmed=True, reason="人工逐图确认")
        after_store = json.loads(self.store_path.read_text(encoding="utf-8"))
        selected, other = after_store["state"]["continuityAssetVersions"]
        storyboard = after_store["state"]["storyboards"][0]

        self.assertFalse(report["dryRun"])
        self.assertTrue(Path(str(report["backup"])).is_file())
        self.assertEqual(report["backupSha256"], self.sha256_path(Path(str(report["backup"]))))
        self.assertEqual(report["writtenSha256"], self.sha256_path(self.store_path))
        self.assertTrue(selected["approved"])
        self.assertEqual(selected["reviewStatus"], "approved")
        self.assertEqual(selected["approval"]["reviewer"], "human")
        self.assertEqual(selected["approval"]["reason"], "人工逐图确认")
        self.assertEqual(
            selected["approvalFingerprint"],
            continuity_asset_approval_fingerprint(selected, selected["approval"]),
        )
        self.assertEqual(other, before_store["state"]["continuityAssetVersions"][1])
        self.assertTrue(storyboard["orderedReferenceManifest"][0]["approved"])
        self.assertFalse(storyboard["orderedReferenceManifest"][1]["approved"])
        for field in ("visualReview", "stale", "staleReason", "staleSince"):
            self.assertEqual(storyboard[field], before_storyboard[field])

    def test_rejects_manifest_store_fingerprint_mismatch(self) -> None:
        store = json.loads(self.store_path.read_text(encoding="utf-8"))
        store["state"]["continuityAssetVersions"][0]["contentFingerprint"] = "stale"
        self.store_path.write_text(json.dumps(store), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "contentFingerprint"):
            self.promote()

    def test_rejects_canonical_reference_hash_mismatch(self) -> None:
        self.reference.write_bytes(self.reference.read_bytes() + b"changed")
        with self.assertRaisesRegex(RuntimeError, "SHA-256 不匹配"):
            self.promote()

    def test_rejects_unregistered_review_evidence_and_forged_persisted_approval(self) -> None:
        unregistered = self.root / "unregistered_thumb.png"
        Image.new("RGB", (16, 16), (10, 20, 30)).save(unregistered, format="PNG")
        with self.assertRaisesRegex(RuntimeError, "登记的逐图安全缩略图"):
            self.promote(evidence_paths=[unregistered])

        approval = {
            "status": "approved",
            "reviewer": "human",
            "reviewedAt": 10,
            "evidencePaths": [str(unregistered.resolve())],
            "contentFingerprint": self.version["contentFingerprint"],
        }
        forged = copy.deepcopy(self.version)
        forged["approval"] = approval
        forged["approvalFingerprint"] = continuity_asset_approval_fingerprint(forged, approval)
        self.assertFalse(normalize_continuity_asset_version(forged)["approved"])

        missing = self.root / "missing_thumb.png"
        forged_registered = copy.deepcopy(self.version)
        forged_registered["reviewEvidencePaths"] = [str(missing.resolve())]
        forged_registered["reviewEvidenceSha256"] = ["a" * 64]
        forged_registered["reviewEvidenceVerifiedAt"] = 10
        forged_approval = {
            "status": "approved",
            "reviewer": "human",
            "reviewedAt": 10,
            "evidencePaths": [str(missing.resolve())],
            "contentFingerprint": forged_registered["contentFingerprint"],
        }
        forged_registered["approval"] = forged_approval
        forged_registered["approvalFingerprint"] = continuity_asset_approval_fingerprint(
            forged_registered,
            forged_approval,
        )
        self.assertFalse(normalize_continuity_asset_version(forged_registered)["approved"])

    def test_evidence_requires_valid_transfer_safe_thumbnail(self) -> None:
        wrong_suffix = self.root / "review.png"
        Image.new("RGB", (8, 8)).save(wrong_suffix, format="PNG")
        with self.assertRaisesRegex(RuntimeError, r"\*_thumb\.png"):
            validate_review_evidence([wrong_suffix])

        invalid = self.root / "invalid_thumb.png"
        invalid.write_bytes(b"not a png")
        with self.assertRaisesRegex(RuntimeError, "内容不是 PNG"):
            validate_review_evidence([invalid])

        oversized_dimensions = self.root / "oversized_thumb.png"
        Image.new("RGB", (769, 1)).save(oversized_dimensions, format="PNG")
        with self.assertRaisesRegex(RuntimeError, "最长边必须不超过 768px"):
            validate_review_evidence([oversized_dimensions])

        boundary = self.root / "boundary_thumb.png"
        Image.new("RGB", (1, 1)).save(boundary, format="PNG")
        boundary.write_bytes(boundary.read_bytes() + b"\0" * (MAX_EVIDENCE_BYTES - boundary.stat().st_size))
        self.assertEqual(boundary.stat().st_size, MAX_EVIDENCE_BYTES)
        with self.assertRaisesRegex(RuntimeError, "严格小于"):
            validate_review_evidence([boundary])

        accepted = self.root / "accepted_thumb.png"
        Image.new("RGB", (1, 1)).save(accepted, format="PNG")
        accepted.write_bytes(accepted.read_bytes() + b"\0" * (MAX_EVIDENCE_BYTES - 1 - accepted.stat().st_size))
        result = validate_review_evidence([accepted])
        self.assertEqual(result[0]["bytes"], MAX_EVIDENCE_BYTES - 1)


if __name__ == "__main__":
    unittest.main()
