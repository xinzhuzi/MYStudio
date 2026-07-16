import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from Library.ai import build_chapter001_full_bible_source as builder


class BuildChapter001FullBibleSourceTest(unittest.TestCase):
    def test_laborer_revisions_are_non_overwriting_and_lock_intact_clothing(self):
        jobs = {job["jobId"]: job for job in builder.generation_jobs()}

        self.assertIn("old-laborer-turnaround-r4", jobs)
        self.assertIn("young-laborer-turnaround-r2", jobs)
        self.assertIn("girl-turnaround-r2", jobs)
        expected_revisions = {
            "old-laborer-turnaround-r4": "-r4.png",
            "young-laborer-turnaround-r2": "-r2.png",
            "girl-turnaround-r2": "-r2.png",
        }
        for job_id, output_suffix in expected_revisions.items():
            job = jobs[job_id]
            self.assertTrue(job["outputPath"].endswith(output_suffix))

        for job_id in ("old-laborer-turnaround-r4", "young-laborer-turnaround-r2"):
            job = jobs[job_id]
            self.assertIn("完整无补丁", job["prompt"])
            self.assertIn("连续闭合", job["prompt"])
            self.assertIn("禁止破洞", job["prompt"])

    def test_assembly_preflight_fails_before_any_source_write(self):
        with (
            patch.object(builder, "read_store_versions", return_value=([], {})),
            patch.object(builder, "preflight_assembly_sources", side_effect=RuntimeError("missing job")),
            patch.object(builder, "build_character_sources") as build_characters,
            patch.object(builder, "build_scene_sources") as build_scenes,
        ):
            with self.assertRaisesRegex(RuntimeError, "missing job"):
                builder.assemble_source_document()
            build_characters.assert_not_called()
            build_scenes.assert_not_called()

    def test_generation_result_requires_disk_hashes_and_single_provider_key(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "asset.png"
            thumbnail = root / "asset_thumb.png"
            report_path = root / "asset-probe-report.json"
            Image.new("RGB", (1280, 720), (80, 90, 100)).save(output)
            Image.new("RGB", (768, 432), (80, 90, 100)).save(thumbnail)
            prompt = "single paid request"
            job = {
                "jobId": "asset",
                "outputPath": str(output),
                "referenceThumbnail": str(root / "reference_thumb.png"),
                "prompt": prompt,
                "aspectRatio": "16:9",
                "resolution": "1K",
            }
            transfer = builder.validate_transfer_thumbnail(thumbnail)
            report_path.write_text(json.dumps({
                "ok": True,
                "generationEndpointCalled": True,
                "generatedImages": 1,
                "outputPath": str(output),
                "outputSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "outputSizeBytes": output.stat().st_size,
                "referencePath": job["referenceThumbnail"],
                "promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "aspectRatio": "16:9",
                "resolution": "1K",
                "transferThumbnail": transfer,
                "providers": [{"providerName": "test", "keyCount": 1}],
            }), encoding="utf-8")

            self.assertEqual(builder.validate_generation_result(job)["jobId"], "asset")
            Image.new("RGB", (1280, 720), (120, 90, 60)).save(output)
            with self.assertRaisesRegex(RuntimeError, "outputSha256"):
                builder.validate_generation_result(job)

    def test_character_crops_are_content_addressed_across_source_revisions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            board_v1 = root / "board-v1.png"
            board_v2 = root / "board-v2.png"
            Image.new("RGB", (900, 600), (80, 90, 100)).save(board_v1)
            Image.new("RGB", (900, 600), (120, 90, 60)).save(board_v2)
            spec = {
                "board": board_v1,
                "profile": "three-view",
                "wardrobe": "base",
                "anchors": ["hair"],
                "avoid": ["drift"],
            }
            with (
                patch.object(builder, "SOURCE_ROOT", root / "source"),
                patch.object(builder, "CHARACTER_SPECS", {"char-1": spec}),
            ):
                first = builder.build_character_sources()["char-1"]
                spec["board"] = board_v2
                second = builder.build_character_sources()["char-1"]

            self.assertNotEqual(first, second)
            self.assertTrue(all(Path(path).is_file() for path in [*first, *second]))


if __name__ == "__main__":
    unittest.main()
