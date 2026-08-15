from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from apps.build.chapter_video.build_chapter001_visual_review_packet import build_packet, stable_sha256


class BuildChapter001VisualReviewPacketTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.media_dir = self.root / "media"
        self.thumb_dir = self.root / "thumbs"
        self.media_dir.mkdir()
        self.thumb_dir.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_image(self, path: Path, color: tuple[int, int, int]) -> None:
        Image.new("RGB", (32, 18), color).save(path, format="PNG")

    def write_source_manifest(self, count: int = 5) -> Path:
        shots = []
        for index in range(1, count + 1):
            media = self.media_dir / f"shot-{index:03d}.png"
            thumb = self.thumb_dir / f"shot-{index:03d}_thumb.png"
            self.write_image(media, (index * 20, 20, 20))
            self.write_image(thumb, (20, index * 20, 20))
            shots.append({
                "index": index,
                "storyboardId": f"sb-chapter-001-{index:03d}",
                "mediaPath": str(media),
                "mediaSha256": stable_sha256(media),
                "visualReview": {"status": "pending", "reviewer": "automated", "evidencePaths": []},
                "stale": True,
                "staleReason": "连续性结构已更新，必须重新生成并审核",
                "prompt": f"镜头 {index}",
                "thumbnailPath": str(thumb),
                "thumbnailBytes": thumb.stat().st_size,
            })
        manifest = self.source / "manifest.json"
        manifest.write_text(json.dumps({"shotCount": count, "shots": shots}, ensure_ascii=False), encoding="utf-8")
        return manifest

    def write_store(self, manifest: Path) -> Path:
        source = json.loads(manifest.read_text(encoding="utf-8"))
        storyboards = [
            {
                "id": shot["storyboardId"],
                "mediaRef": {"path": shot["mediaPath"]},
                "visualReview": shot["visualReview"],
                "stale": shot["stale"],
            }
            for shot in source["shots"]
        ]
        store = self.root / "studio-workflow-store.json"
        store.write_text(json.dumps({"state": {"storyboards": storyboards}}), encoding="utf-8")
        return store

    def test_builds_hash_verified_thumbnails_and_contact_sheets_without_mutating_store(self) -> None:
        manifest = self.write_source_manifest()
        store = self.write_store(manifest)
        output = self.root / "review-packet"

        result = build_packet(manifest, output, store)

        self.assertEqual(result["shotCount"], 5)
        self.assertEqual(result["thumbnailCount"], 5)
        self.assertEqual(result["contactSheetCount"], 2)
        self.assertFalse(result["productionStoreMutated"])
        packet = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(packet["shotCount"], 5)
        self.assertEqual(len(packet["shots"]), 5)
        self.assertEqual(len(packet["contactSheets"]), 2)
        for shot in packet["shots"]:
            thumbnail = Path(shot["thumbnailPath"])
            self.assertTrue(thumbnail.is_file())
            self.assertEqual(shot["thumbnailSha256"], stable_sha256(thumbnail))
            self.assertEqual(shot["thumbnailWidth"], 32)
            self.assertEqual(shot["thumbnailHeight"], 18)
        self.assertEqual(json.loads(store.read_text(encoding="utf-8")), {
            "state": {
                "storyboards": [
                    {
                        "id": f"sb-chapter-001-{index:03d}",
                        "mediaRef": {"path": str(self.media_dir / f"shot-{index:03d}.png")},
                        "visualReview": {"status": "pending", "reviewer": "automated", "evidencePaths": []},
                        "stale": True,
                    }
                    for index in range(1, 6)
                ],
            },
        })

    def test_rejects_non_empty_output_directory(self) -> None:
        manifest = self.write_source_manifest(1)
        output = self.root / "review-packet"
        output.mkdir()
        (output / "existing.txt").write_text("keep", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            build_packet(manifest, output)

    def test_rejects_media_hash_mismatch(self) -> None:
        manifest = self.write_source_manifest(1)
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["shots"][0]["mediaSha256"] = "0" * 64
        manifest.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError, msg="原图 SHA-256"):
            build_packet(manifest, self.root / "review-packet")


if __name__ == "__main__":
    unittest.main()
