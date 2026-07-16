import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from Library.ai.prepare_chapter001_continuity_bibles import prepare_full_chapter_manifest


class PrepareFullChapterContinuityBiblesTest(unittest.TestCase):
    def test_preserves_exact_version_keys_and_writes_safe_independent_thumbnails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "project"
            project.mkdir()
            sources = root / "sources"
            sources.mkdir()

            def image(name: str, color: tuple[int, int, int]) -> str:
                path = sources / f"{name}.png"
                Image.new("RGB", (1200, 800), color).save(path)
                return str(path)

            character_paths = [
                image("character-front", (210, 200, 190)),
                image("character-side", (200, 190, 180)),
                image("character-back", (190, 180, 170)),
            ]
            scene_hall = image("scene-hall", (60, 70, 80))
            scene_window = image("scene-window", (70, 80, 90))
            prop_path = image("prop", (90, 100, 110))
            source_document = root / "versions.json"
            source_document.write_text(json.dumps({
                "continuityAssetVersions": [
                    {
                        "assetId": "char-1",
                        "versionId": "char-1:base:v1",
                        "assetKind": "character",
                        "label": "base",
                        "referenceImagePaths": character_paths,
                        "referenceViewTypes": ["front", "side", "back"],
                        "identityAnchors": {"uniqueMarks": ["固定眉骨"], "hairStyle": "束发"},
                        "negativePrompt": {"avoid": ["换脸"]},
                        "wardrobeVersion": "base",
                        "source": "test-character-bible",
                    },
                    {
                        "assetId": "scene-1",
                        "versionId": "scene-1:hall:v1",
                        "assetKind": "scene",
                        "label": "hall",
                        "referenceImagePaths": [scene_hall],
                        "sceneViewpointId": "hall",
                        "spatialLayout": "柜台在左，门在右",
                        "lightingDesign": "夜间油灯",
                        "colorPalette": "墨褐与暗金",
                        "source": "test-scene-bible",
                    },
                    {
                        "assetId": "scene-1",
                        "versionId": "scene-1:window:v1",
                        "assetKind": "scene",
                        "label": "window",
                        "referenceImagePaths": [scene_window],
                        "sceneViewpointId": "window",
                        "spatialLayout": "窗在北墙，床在右",
                        "lightingDesign": "夜间月光",
                        "colorPalette": "冷蓝与旧木褐",
                        "source": "test-scene-bible",
                    },
                    {
                        "assetId": "prop-1",
                        "versionId": "prop-1:base:v1",
                        "assetKind": "prop",
                        "label": "base",
                        "referenceImagePaths": [prop_path],
                        "source": "test-prop-bible",
                    },
                ],
            }, ensure_ascii=False), encoding="utf-8")

            dry_run = prepare_full_chapter_manifest(project, source_document, apply=False, bible_version="v8")
            self.assertEqual(dry_run["assetCount"], 3)
            self.assertEqual(dry_run["versionCount"], 4)
            self.assertEqual(dry_run["structurallyCompleteCount"], 4)
            self.assertEqual(dry_run["approvalSummary"], {"approved": 0, "pending": 4, "rejected": 0})
            self.assertEqual(len({
                (item["assetId"], item["versionId"])
                for item in dry_run["continuityAssetVersions"]
            }), 4)
            scene_outputs = [
                item["outputPaths"][0]
                for item in dry_run["assetPlan"]
                if item["assetId"] == "scene-1"
            ]
            self.assertEqual(len(set(scene_outputs)), 2)
            self.assertTrue(all(item["approved"] is False for item in dry_run["continuityAssetVersions"]))

            applied = prepare_full_chapter_manifest(project, source_document, apply=True, bible_version="v8")
            self.assertEqual(len(applied["outputAssets"]), 6)
            self.assertEqual(len(applied["reviewThumbnails"]), 6)
            for item in applied["reviewThumbnails"]:
                thumbnail = Path(item["path"])
                self.assertTrue(thumbnail.name.endswith("_thumb.png"))
                self.assertTrue(thumbnail.is_file())
                self.assertLess(item["bytes"], 1_000_000)
                self.assertLessEqual(max(item["width"], item["height"]), 768)
            rerun = prepare_full_chapter_manifest(project, source_document, apply=True, bible_version="v8")
            self.assertEqual(rerun["manifestSha256"], applied["manifestSha256"])


if __name__ == "__main__":
    unittest.main()
