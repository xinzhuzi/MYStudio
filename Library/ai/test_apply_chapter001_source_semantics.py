import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
RENDERER_PATH = (
    REPO_ROOT
    / ".trellis/tasks/07-12-mystudio-chapter001-visual-continuity/research"
    / "render_chapter001_semantic_storyboard_draft.py"
)
SPEC = importlib.util.spec_from_file_location("chapter001_semantic_renderer", RENDERER_PATH)
assert SPEC and SPEC.loader
renderer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(renderer)


class ApplyChapter001SourceSemanticsTest(unittest.TestCase):
    def build_fixture(self, root: Path) -> tuple[Path, Path, str]:
        source_table = "<storyboardTable>\\n| old |\\n</storyboardTable>\\n"
        store_path = root / "studio-workflow-store.json"
        store_path.write_text(json.dumps({
            "state": {
                "agentWorkData": [{
                    "id": "work-chapter-001-storyboard-table",
                    "key": "storyboardTable",
                    "episodeId": "chapter-001",
                    "updatedAt": 1,
                    "data": source_table,
                }],
                "unrelated": {"keep": True},
            },
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        draft_path = root / "draft.json"
        draft_path.write_text(json.dumps({
            "episodeId": "chapter-001",
            "storyboardWorkId": "work-chapter-001-storyboard-table",
            "sourceTableSha256": hashlib.sha256(source_table.encode("utf-8")).hexdigest(),
        }), encoding="utf-8")
        return store_path, draft_path, source_table

    def rendered_result(self) -> tuple[str, dict]:
        return (
            "<storyboardTable>\\n| new |\\n</storyboardTable>\\n",
            {"sourceRowCount": 43, "storeMutated": False},
        )

    def test_dry_run_only_changes_the_current_storyboard_table(self):
        with tempfile.TemporaryDirectory() as temp:
            store_path, draft_path, source_table = self.build_fixture(Path(temp))
            before = store_path.read_bytes()
            with mock.patch.object(renderer, "render", return_value=self.rendered_result()):
                plan, updated = renderer.build_application_plan(store_path, draft_path)

            self.assertTrue(plan["dryRun"])
            self.assertTrue(plan["changed"])
            self.assertEqual(store_path.read_bytes(), before)
            self.assertEqual(
                updated["state"]["agentWorkData"][0]["data"],
                self.rendered_result()[0],
            )
            self.assertEqual(updated["state"]["unrelated"], {"keep": True})
            self.assertEqual(
                hashlib.sha256(source_table.encode("utf-8")).hexdigest(),
                plan["sourceTableSha256"],
            )
            self.assertEqual(plan["changedFields"], ["state.agentWorkData[0].data"])

    def test_apply_requires_confirmation_and_preserves_verified_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            store_path, draft_path, _ = self.build_fixture(Path(temp))
            before = store_path.read_bytes()
            with mock.patch.object(renderer, "render", return_value=self.rendered_result()):
                plan, updated = renderer.build_application_plan(store_path, draft_path)

            with self.assertRaisesRegex(RuntimeError, "--human-confirmed"):
                renderer.apply_application_plan(plan, updated, False)
            self.assertEqual(store_path.read_bytes(), before)

            result = renderer.apply_application_plan(plan, updated, True)

            self.assertFalse(result["dryRun"])
            self.assertTrue(result["storeMutated"])
            backup = Path(result["backup"])
            self.assertEqual(backup.read_bytes(), before)
            self.assertEqual(result["backupSha256"], hashlib.sha256(before).hexdigest())
            stored = json.loads(store_path.read_text(encoding="utf-8"))
            self.assertEqual(stored["state"]["agentWorkData"][0]["data"], self.rendered_result()[0])

    def test_apply_rejects_source_change_after_dry_run(self):
        with tempfile.TemporaryDirectory() as temp:
            store_path, draft_path, _ = self.build_fixture(Path(temp))
            with mock.patch.object(renderer, "render", return_value=self.rendered_result()):
                plan, updated = renderer.build_application_plan(store_path, draft_path)
            changed_store = json.loads(store_path.read_text(encoding="utf-8"))
            changed_store["state"]["agentWorkData"][0]["data"] = "externally changed"
            store_path.write_text(json.dumps(changed_store), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "dry-run 后已变化"):
                renderer.apply_application_plan(plan, updated, True)


if __name__ == "__main__":
    unittest.main()
