import importlib.util
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_generator():
    path = Path(__file__).resolve().parents[1] / "build_daojie_chapter001_workflow.py"
    spec = importlib.util.spec_from_file_location("chapter001_approved_reuse", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Chapter001ApprovedStoryboardReuseTest(unittest.TestCase):
    @staticmethod
    def write_content_addressed_image(project: Path, index: int = 1) -> tuple[Path, str]:
        root = project / "workflow-images/storyboards/chapter-001/approved-revisions"
        root.mkdir(parents=True, exist_ok=True)
        provisional = root / f"shot-{index:03d}-provisional.png"
        Image.new("RGB", (64, 36), (20, 80, 120)).save(provisional)
        content_sha256 = sha256_file(provisional)
        addressed = root / f"shot-{index:03d}-{content_sha256[:12]}.png"
        provisional.rename(addressed)
        return addressed, content_sha256

    def test_resolves_only_current_human_approved_project_image(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp) / "project-1"
            approved_path, content_sha256 = self.write_content_addressed_image(project)
            module.PROJECT = project
            module.USE_APPROVED_STORYBOARD_IMAGES = True
            project_url = module.project_file_url(approved_path.relative_to(project))
            storyboard = {
                "id": "sb-chapter-001-001",
                "stale": False,
                "mediaRef": {"kind": "image", "path": project_url, "contentSha256": content_sha256},
                "orderedReferenceManifest": [{"order": 1, "assetId": "scene", "versionId": "scene:v1"}],
                "continuityState": {"inputFingerprint": "continuity-current"},
                "visualReview": {
                    "status": "approved",
                    "reviewer": "human",
                    "reviewedAt": 1,
                    "evidencePaths": [project_url],
                    "inputFingerprint": "review-current",
                },
            }

            resolved = module.approved_storyboard_reuse_input(storyboard)

            self.assertEqual(resolved["absolutePath"], str(approved_path.resolve()))
            storyboard["visualReview"]["reviewer"] = "automated"
            with self.assertRaisesRegex(RuntimeError, "当前人工视觉批准"):
                module.approved_storyboard_reuse_input(storyboard)

    def test_rejects_mutated_approved_image_and_outside_revision_path(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp) / "project-1"
            approved_path, content_sha256 = self.write_content_addressed_image(project)
            module.PROJECT = project
            module.USE_APPROVED_STORYBOARD_IMAGES = True
            project_url = module.project_file_url(approved_path.relative_to(project))
            storyboard = {
                "id": "sb-chapter-001-001",
                "stale": False,
                "mediaRef": {"kind": "image", "path": project_url, "contentSha256": content_sha256},
                "orderedReferenceManifest": [{"order": 1, "assetId": "scene", "versionId": "scene:v1"}],
                "continuityState": {"inputFingerprint": "continuity-current"},
                "visualReview": {
                    "status": "approved",
                    "reviewer": "human",
                    "reviewedAt": 1,
                    "evidencePaths": [project_url],
                    "inputFingerprint": "review-current",
                },
            }
            approved_path.write_bytes(approved_path.read_bytes() + b"tamper")
            with self.assertRaisesRegex(RuntimeError, "内容指纹"):
                module.approved_storyboard_reuse_input(storyboard)

            outside = project / "workflow-images/storyboards/chapter-001/other/shot-001-aaaaaaaaaaaa.png"
            outside.parent.mkdir(parents=True, exist_ok=True)
            outside.write_bytes(b"not-a-valid-approved-image")
            outside_url = module.project_file_url(outside.relative_to(project))
            storyboard["mediaRef"] = {
                "kind": "image",
                "path": outside_url,
                "contentSha256": "a" * 64,
            }
            storyboard["visualReview"]["evidencePaths"] = [outside_url]
            with self.assertRaisesRegex(RuntimeError, "人工批准图无效"):
                module.approved_storyboard_reuse_input(storyboard)

    def test_explicit_approved_image_reuse_performs_zero_provider_requests(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "project-1"
            project.mkdir()
            approved_path, content_sha256 = self.write_content_addressed_image(project)
            reference_path = root / "scene.png"
            frame_path = root / "frame.png"
            Image.new("RGB", (64, 36), (120, 80, 20)).save(reference_path)
            module.PROJECT = project
            project_url = module.project_file_url(approved_path.relative_to(project))
            manifest = [{
                "order": 1,
                "assetId": "scene:dock",
                "assetName": "金水河码头",
                "assetKind": "scene",
                "imagePath": str(reference_path),
                "referenceImagePaths": [str(reference_path)],
                "versionId": "scene:dock:main:v1",
                "referenceRole": "scene-viewpoint",
                "sceneViewpointId": "dock-main-axis",
                "approved": True,
            }]
            state = {
                "groupId": "dock",
                "sceneVersionId": "scene:dock:main:v1",
                "sceneViewpointId": "dock-main-axis",
                "lighting": "冷青晨雾",
                "palette": "墨青灰蓝",
                "actionIn": "建立场景",
                "actionOut": "继续向右",
                "characters": [],
                "inputFingerprint": "current",
            }
            approved_input = {
                "absolutePath": str(approved_path),
                "projectUrl": project_url,
                "contentSha256": content_sha256,
            }
            with patch.object(
                module,
                "request_storyboard_image_generation",
                side_effect=AssertionError("approved reuse must not call provider"),
            ) as provider:
                result = module.generate_storyboard_frame_with_references(
                    frame_path,
                    {"id": "sb-chapter-001-001", "index": 1, "sceneNo": 1, "prompt": "码头晨雾建立镜头"},
                    "码头晨雾建立镜头",
                    [{
                        "name": "金水河码头",
                        "kind": "场景",
                        "assetId": "scene:dock",
                        "imagePath": str(reference_path),
                    }],
                    {
                        "model": "gpt-image-2",
                        "aspectRatio": "16:9",
                        "resolution": "1K",
                    },
                    manifest,
                    state,
                    approved_input,
                )

            provider.assert_not_called()
            self.assertTrue(result["reusedExistingImage"])
            self.assertEqual(result["absoluteImagePath"], str(approved_path))
            self.assertEqual(result["projectImageUrl"], project_url)
            self.assertTrue(frame_path.is_file())


if __name__ == "__main__":
    unittest.main()
