import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from Library.ai.build_toonflow_portable_fixture import (
    build_fixture,
    resolve_oss_path,
    verify_fixture,
)


class ToonflowPortableFixtureTest(unittest.TestCase):
    def _build_fixture(self, root: Path) -> Path:
        data_root = root / "data"
        oss_root = data_root / "oss"
        database = data_root / "db2.sqlite"
        oss_root.mkdir(parents=True)
        with sqlite3.connect(database) as connection:
            connection.executescript(
                """
                create table o_storyboard (
                    id integer primary key, "index" integer, prompt text,
                    videoDesc text, filePath text, shouldGenerateImage integer
                );
                create table o_assets2Storyboard (storyboardId integer, assetId integer);
                create table o_assets (id integer primary key, imageId integer);
                create table o_image (id integer primary key, filePath text);
                """
            )
            for raw_index in range(43):
                shot_path = oss_root / "storyboards" / f"shot-{raw_index + 1:03d}.png"
                reference_path = oss_root / "references" / f"ref-{raw_index + 1:03d}.png"
                shot_path.parent.mkdir(parents=True, exist_ok=True)
                reference_path.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGBA", (16, 9), (raw_index, 80, 120, 255)).save(shot_path)
                Image.new("RGBA", (8, 8), (120, raw_index, 80, 255)).save(reference_path)
                connection.execute(
                    "insert into o_storyboard values (?, ?, ?, ?, ?, ?)",
                    (raw_index + 1, raw_index, f"prompt-{raw_index}", f"desc-{raw_index}",
                     f"storyboards/shot-{raw_index + 1:03d}.png", 1),
                )
                connection.execute("insert into o_assets values (?, ?)", (raw_index + 1, raw_index + 1))
                connection.execute(
                    "insert into o_image values (?, ?)",
                    (raw_index + 1, f"references/ref-{raw_index + 1:03d}.png"),
                )
                connection.execute(
                    "insert into o_assets2Storyboard values (?, ?)",
                    (raw_index + 1, raw_index + 1),
                )
            connection.commit()

        manifest_path = root / "fixture.json"
        build_fixture(database, manifest_path)
        return manifest_path

    def test_builds_and_reuses_content_addressed_golden_images(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = self._build_fixture(root)
            database = root / "data" / "db2.sqlite"
            first = build_fixture(database, manifest_path)
            second = build_fixture(database, manifest_path)
            verified = verify_fixture(manifest_path)
            self.assertEqual(first["verification"], second["verification"])
            self.assertEqual(verified["storyboardCount"], 43)
            self.assertEqual(first["verification"]["storyboardCount"], 43)
            self.assertEqual(first["verification"]["goldenImageCount"], 43)
            self.assertEqual(first["verification"]["referenceCount"], 43)
            self.assertTrue(first["verification"]["goldenPixelSha256Verified"])
            self.assertTrue(first["verification"]["contentAddressed"])
            self.assertEqual(first["fixtureRoot"], "fixture")
            rows = json.loads(manifest_path.read_text(encoding="utf-8"))["storyboardRows"]
            self.assertEqual(rows[0]["goldenImage"]["verified"], True)
            self.assertEqual(len(list((root / "fixture").glob("golden/*"))), 43)
            self.assertEqual(len(list((root / "fixture").glob("references/*"))), 43)

    def test_resolve_oss_path_rejects_relative_paths_outside_data_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_root = root / "data"
            data_root.mkdir()
            outside = root / "outside.png"
            outside.write_bytes(b"outside")

            self.assertIsNone(resolve_oss_path(data_root, "../outside.png"))

    def test_verify_fixture_rejects_tampered_golden_digest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = self._build_fixture(root)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            golden_name = manifest["storyboardRows"][0]["goldenImage"]["relativePath"]
            (root / "fixture" / "golden" / golden_name).write_bytes(b"tampered")

            with self.assertRaisesRegex(RuntimeError, "golden image digest mismatch"):
                verify_fixture(manifest_path)

    def test_verify_fixture_rejects_wrong_storyboard_count(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = self._build_fixture(root)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["storyboardRows"] = manifest["storyboardRows"][:-1]
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "fixture storyboard count is not 43"):
                verify_fixture(manifest_path)


if __name__ == "__main__":
    unittest.main()
