from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from Library.repair_chapter001_visual_continuity import (
    apply_available_versions_to_references,
    repair_storyboards,
    sync_script_shot_asset_ids,
)


class RepairChapter001VisualContinuityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.temporary.name)
        self.current_dugu_id = "char-current-dugu"
        self.current_dock_id = "scene-current-dock"
        self.write_project_entities()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_project_entities(self) -> None:
        documents = {
            "characters.json": {"state": {"characters": [{"id": self.current_dugu_id, "name": "独孤剑尘"}]}},
            "scenes.json": {"state": {"scenes": [{"id": self.current_dock_id, "name": "金水河码头"}]}},
            "props.json": {"state": {"items": []}},
        }
        for name, value in documents.items():
            (self.project_dir / name).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    @staticmethod
    def version(
        asset_id: str,
        version_id: str,
        asset_kind: str,
        *,
        viewpoint_id: str | None = None,
    ) -> dict[str, object]:
        value: dict[str, object] = {
            "assetId": asset_id,
            "versionId": version_id,
            "assetKind": asset_kind,
            "label": viewpoint_id or "grey-town",
            "referenceImagePaths": [f"/bible/{version_id}.png"],
            "referenceImageSha256": ["a" * 64],
            "referenceViewTypes": ["front", "side", "back"] if asset_kind == "character" else [],
            "source": "test-bible",
            "contentFingerprint": f"fingerprint:{version_id}",
            "approvalFingerprint": None,
            "approved": False,
        }
        if viewpoint_id:
            value["sceneViewpointId"] = viewpoint_id
        if asset_kind == "character":
            value["referenceImagePaths"] = [f"/bible/{version_id}-{view}.png" for view in ("front", "side", "back")]
            value["wardrobeVersion"] = "grey-town"
        return value

    def test_repair_reapplies_existing_bible_versions_without_manifest(self) -> None:
        dugu_version = self.version(
            self.current_dugu_id,
            f"{self.current_dugu_id}:grey-town:v1",
            "character",
        )
        dock_version = self.version(
            self.current_dock_id,
            f"{self.current_dock_id}:dock-main-axis:v1",
            "scene",
            viewpoint_id="dock-main-axis",
        )
        storyboard = {
            "id": "sb-chapter-001-001",
            "episodeId": "chapter-001",
            "index": 1,
            "prompt": "独孤从码头走来",
            "speakerId": "character:char-legacy-dugu",
            "assetIds": ["char-legacy-dugu", "scene-legacy-dock"],
            "mediaRef": {"kind": "image", "path": "/frames/shot-001.png"},
        }
        state = {
            "continuityAssetVersions": [dugu_version, dock_version],
            "storyboards": [storyboard],
            "agentWorkData": [{
                "id": "work-storyboard-table-current",
                "key": "storyboardTable",
                "episodeId": "chapter-001",
                "updatedAt": 1,
                "data": "\n".join((
                    "<storyboardTable>",
                    "## 场 1：金水河码头",
                    "**引用资产名称**：金水河码头，独孤剑尘",
                    "**引用资产ID**：scene-legacy-dock，char-legacy-dugu",
                    "| 1 | 独孤从码头走来 | 3秒 | 全景 | 固定 | — | 环境声 | "
                    '{"sceneViewpointId":"dock-main-axis","personFree":false,'
                    '"visibleCharacters":[{"name":"独孤剑尘","position":"中景",'
                    '"orientation":"朝前","actionIn":"走入码头","actionOut":"停在石阶"}],'
                    '"visibleProps":[],"actionIn":"独孤走入码头","actionOut":"独孤停在石阶"} |',
                    "</storyboardTable>",
                )),
            }],
            "imageWorkflows": [{
                "target": {"kind": "storyboard", "id": storyboard["id"]},
                "nodes": [
                    {
                        "type": "reference",
                        "title": "金水河码头",
                        "imageUrl": "/legacy/dock.png",
                        "source": {"id": "scene-legacy-dock", "assetType": "scene"},
                        "sceneViewpointId": "dock-main-axis",
                    },
                    {
                        "type": "reference",
                        "title": "独孤剑尘",
                        "imageUrl": "/legacy/dugu.png",
                        "source": {"id": "char-legacy-dugu", "assetType": "character"},
                    },
                ],
            }],
        }

        report = repair_storyboards(state, "pending", None, self.project_dir)

        self.assertEqual(report["repaired"], 1)
        references = storyboard["orderedReferenceManifest"]
        self.assertEqual(references[0]["assetId"], self.current_dock_id)
        self.assertEqual(references[0]["versionId"], dock_version["versionId"])
        self.assertEqual(references[1]["assetId"], self.current_dugu_id)
        self.assertEqual(references[1]["versionId"], dugu_version["versionId"])
        continuity = storyboard["continuityState"]
        self.assertEqual(continuity["sceneVersionId"], dock_version["versionId"])
        self.assertEqual(continuity["characters"][0]["characterId"], self.current_dugu_id)
        self.assertTrue(storyboard["stale"])
        self.assertEqual(storyboard["staleReason"], "连续性结构已更新，必须重新生成并审核")
        self.assertEqual(storyboard["speakerId"], "character:char-legacy-dugu")
        self.assertEqual(storyboard["assetIds"], [self.current_dock_id, self.current_dugu_id])
        self.assertNotIn("reviewedAt", storyboard["visualReview"])
        self.assertEqual(storyboard["visualReview"]["evidencePaths"], [])
        first_snapshot = json.dumps(state, ensure_ascii=False, sort_keys=True)
        repair_storyboards(state, "pending", None, self.project_dir)
        self.assertEqual(json.dumps(state, ensure_ascii=False, sort_keys=True), first_snapshot)

    def test_scene_version_selection_requires_matching_viewpoint(self) -> None:
        hall = self.version("scene-inn", "scene-inn:hall:v1", "scene", viewpoint_id="inn-hall-counter-axis")
        room = self.version("scene-inn", "scene-inn:room:v1", "scene", viewpoint_id="inn-room-window-axis")
        entities = {"悦来客栈": ("scene-inn", "scene")}
        reference = {
            "assetId": "scene-legacy-inn",
            "assetName": "悦来客栈",
            "assetKind": "scene",
            "versionId": "scene:legacy:viewpoint-base",
            "imagePath": "/legacy/inn.png",
            "sceneViewpointId": "inn-room-window-axis",
        }

        updated, _mapping = apply_available_versions_to_references([reference], [hall, room], entities)
        self.assertEqual(updated[0]["versionId"], room["versionId"])

        ambiguous = dict(reference)
        ambiguous.pop("sceneViewpointId")
        unchanged, _mapping = apply_available_versions_to_references([ambiguous], [hall, room], entities)
        self.assertEqual(unchanged[0], ambiguous)

    def test_projects_approved_asset_fingerprint_into_repaired_reference(self) -> None:
        version = self.version(
            self.current_dugu_id,
            f"{self.current_dugu_id}:grey-town:v1",
            "character",
        )
        version["approved"] = True
        version["approvalFingerprint"] = "approval:human"
        reference = {
            "assetId": "char-legacy-dugu",
            "assetName": "独孤剑尘",
            "assetKind": "character",
            "versionId": "char-legacy-dugu:grey-town:v1",
            "imagePath": "/legacy/dugu.png",
        }

        updated, _mapping = apply_available_versions_to_references(
            [reference],
            [version],
            {"独孤剑尘": (self.current_dugu_id, "character")},
        )

        self.assertEqual(updated[0]["assetId"], self.current_dugu_id)
        self.assertTrue(updated[0]["approved"])
        self.assertEqual(updated[0]["approvalFingerprint"], "approval:human")
        self.assertEqual(updated[0]["contentFingerprint"], version["contentFingerprint"])

    def test_syncs_script_asset_ids_from_canonical_reference_order_without_touching_voice_fields(self) -> None:
        storyboards = [{
            "id": "sb-chapter-001-023",
            "episodeId": "chapter-001",
            "index": 23,
            "assetIds": ["scene-room", "char-innkeeper", "scene-school"],
            "orderedReferenceManifest": [
                {"order": 1, "assetId": "scene-room", "referenceRole": "scene-viewpoint"},
                {"order": 2, "assetId": "char-innkeeper", "referenceRole": "canonical"},
                {"order": 3, "assetId": "scene-school", "referenceRole": "secondary-scene"},
            ],
        }]
        script = {"shots": [{
            "id": "sb-chapter-001-023",
            "episodeId": "chapter-001",
            "index": 23,
            "assetIds": ["scene-legacy", "char-innkeeper"],
            "speaker": "掌柜",
            "speakerId": "character:innkeeper",
            "voiceProfileId": "voice-innkeeper",
        }]}

        first = sync_script_shot_asset_ids(script, storyboards)
        self.assertEqual(first["changedShots"], ["sb-chapter-001-023"])
        self.assertEqual(script["shots"][0]["assetIds"], ["scene-room", "char-innkeeper", "scene-school"])
        self.assertEqual(script["shots"][0]["speaker"], "掌柜")
        self.assertEqual(script["shots"][0]["speakerId"], "character:innkeeper")
        self.assertEqual(script["shots"][0]["voiceProfileId"], "voice-innkeeper")

        second = sync_script_shot_asset_ids(script, storyboards)
        self.assertEqual(second["changedShots"], [])


if __name__ == "__main__":
    unittest.main()
