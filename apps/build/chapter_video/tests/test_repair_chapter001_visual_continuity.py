from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from apps.build.chapter_video.repair_chapter001_visual_continuity import (
    apply_available_versions_to_references,
    repair_storyboards,
    sync_pending_asset_manifest,
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

    def test_repair_synthesizes_missing_semantic_character_reference(self) -> None:
        helper_id = "char-current-helper"
        (self.project_dir / "characters.json").write_text(
            json.dumps(
                {
                    "state": {
                        "characters": [
                            {"id": self.current_dugu_id, "name": "独孤剑尘"},
                            {"id": helper_id, "name": "小杂役"},
                        ]
                    }
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        dugu_version = self.version(
            self.current_dugu_id,
            f"{self.current_dugu_id}:grey-town:v1",
            "character",
        )
        helper_version = self.version(
            helper_id,
            f"{helper_id}:dock-ragged:v1",
            "character",
        )
        helper_version["label"] = "dock-ragged"
        helper_version["wardrobeVersion"] = "dock-ragged"
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
            "prompt": "独孤与小杂役在码头",
            "speakerId": "character:char-legacy-dugu",
            "assetIds": ["char-legacy-dugu", "char-legacy-helper", "scene-legacy-dock"],
            "mediaRef": {"kind": "image", "path": "/frames/shot-001.png"},
        }
        semantics = (
            '{"sceneViewpointId":"dock-main-axis","personFree":false,'
            '"visibleCharacters":[{"name":"独孤剑尘","position":"左中景",'
            '"orientation":"朝前","actionIn":"走入码头","actionOut":"停下"},'
            '{"name":"小杂役","position":"右下前景",'
            '"orientation":"蜷身朝左","actionIn":"跪倒","actionOut":"护住头脸"}],'
            '"visibleProps":[],"actionIn":"两人进入码头","actionOut":"两人停下"}'
        )
        state = {
            "continuityAssetVersions": [dugu_version, helper_version, dock_version],
            "storyboards": [storyboard],
            "agentWorkData": [{
                "id": "work-storyboard-table-current",
                "key": "storyboardTable",
                "episodeId": "chapter-001",
                "updatedAt": 1,
                "data": "\n".join((
                    "<storyboardTable>",
                    "## 场 1：金水河码头",
                    "**引用资产名称**：金水河码头，独孤剑尘，小杂役",
                    "**引用资产ID**：scene-legacy-dock，char-legacy-dugu，char-legacy-helper",
                    "| 1 | 独孤与小杂役在码头 | 3秒 | 全景 | 固定 | — | 环境声 | " + semantics + " |",
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
        self.assertEqual([reference["assetName"] for reference in references[:3]], [
            "金水河码头", "独孤剑尘", "小杂役",
        ])
        self.assertEqual(references[2]["assetId"], helper_id)
        self.assertEqual(references[2]["versionId"], helper_version["versionId"])
        self.assertEqual(references[2]["referenceRole"], "canonical")
        self.assertEqual(storyboard["continuityState"]["characters"][1]["characterId"], helper_id)
        self.assertTrue(storyboard["stale"])
        self.assertEqual(storyboard["visualReview"]["status"], "pending")
        self.assertEqual(storyboard["visualReview"]["evidencePaths"], [])
        self.assertEqual(storyboard["speakerId"], "character:char-legacy-dugu")
        first_snapshot = json.dumps(state, ensure_ascii=False, sort_keys=True)
        repair_storyboards(state, "pending", None, self.project_dir)
        self.assertEqual(json.dumps(state, ensure_ascii=False, sort_keys=True), first_snapshot)

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


    def build_interval_state(
        self,
        *,
        shot4_chained: bool,
        shot4_legacy_keyframe: bool,
    ) -> tuple[dict, Path]:
        """§六受影响区间夹具:镜2 直接改(资产引用更新),1-4 同组,5 异组。

        - 3 经 previousStoryboardId 链依赖 2;4 断链(无 prev)或携带回接关键帧;
        - 4/5 预置 approved visualReview,用于断言「区间外 stale/重审零变化」。
        """
        lantern = self.project_dir / "lantern-v2.png"
        lantern.write_bytes(b"lantern-v2")
        manifest = {
            "projectDir": str(self.project_dir),
            "continuityAssetVersions": [{
                "assetId": "prop-lantern",
                "versionId": "prop-lantern:dock-lit:v2",
                "assetKind": "prop",
                "label": "dock-lit",
                "referenceImagePaths": [str(lantern)],
                "source": "test-bible",
                "reviewStatus": "pending",
                "approval": None,
                "approved": False,
            }],
        }
        manifest_path = self.project_dir / "asset-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

        def shot(index: int, group: str, previous: str | None) -> dict:
            item = {
                "id": f"sb-chapter-001-{index:03d}",
                "episodeId": "chapter-001",
                "index": index,
                "orderedReferenceManifest": [
                    {
                        "order": 1,
                        "assetId": "prop-lantern" if index == 2 else "scene-dock",
                        "assetName": "灯笼" if index == 2 else "金水河码头",
                        "assetKind": "prop" if index == 2 else "scene",
                        "versionId": "prop-lantern:dock-lit:v1" if index == 2 else "scene-dock:main:v1",
                        "imagePath": "/old/lantern.png" if index == 2 else "/old/dock.png",
                        "referenceRole": "prop-state" if index == 2 else "scene-viewpoint",
                        "approved": True,
                    }
                ],
                "continuityState": {"groupId": group},
            }
            if previous is not None:
                item["continuityState"]["previousStoryboardId"] = previous
            return item

        storyboards = [
            shot(1, "chapter-001:dock", None),
            shot(2, "chapter-001:dock", "sb-chapter-001-001"),
            shot(3, "chapter-001:dock", "sb-chapter-001-002"),
        ]
        shot4 = shot(4, "chapter-001:dock", "sb-chapter-001-003" if shot4_chained else None)
        if shot4_legacy_keyframe:
            shot4["keyframes"] = [{
                "frameId": "sb-chapter-001-004-kf-1",
                "mediaRef": {"kind": "image", "path": "/frames/002-tail.png"},
                "inUs": 0,
                "origin": {"kind": "legacy-shot", "legacyIndex": 2},
            }]
        shot4["visualReview"] = {"status": "approved", "reviewedAt": 123}
        shot5 = shot(5, "chapter-001:inn", None)
        shot5["visualReview"] = {"status": "approved", "reviewedAt": 456}
        storyboards.extend([shot4, shot5])
        # 镜3 的回接关键帧:依赖被改镜 2(legacyIndex=2)
        storyboards[2]["keyframes"] = [{
            "frameId": "sb-chapter-001-003-kf-1",
            "mediaRef": {"kind": "image", "path": "/frames/002-tail.png"},
            "inUs": 0,
            "origin": {"kind": "legacy-shot", "legacyIndex": 2},
        }]
        state = {"storyboards": storyboards, "continuityAssetVersions": []}
        return state, manifest_path

    def test_asset_sync_stale_propagation_stops_at_stable_upper_bound(self) -> None:
        """P5 验收:改中段一镜(镜2),区间=[2,3];断链镜4 与异组镜5 stale/重审零变化;
        区间内镜3 的回接旧帧关键帧标「已过期-禁止使用」(与 A3 下游标记同词表)。"""
        state, manifest_path = self.build_interval_state(
            shot4_chained=False,
            shot4_legacy_keyframe=False,
        )
        shot4_before = json.dumps(state["storyboards"][3], ensure_ascii=False, sort_keys=True)
        shot5_before = json.dumps(state["storyboards"][4], ensure_ascii=False, sort_keys=True)

        report = sync_pending_asset_manifest(state, manifest_path)

        self.assertEqual(report["directlyChangedStoryboards"], ["sb-chapter-001-002"])
        self.assertEqual(report["propagatedStoryboards"], ["sb-chapter-001-003"])
        self.assertEqual(
            report["intervals"],
            [{
                "groupId": "chapter-001:dock",
                "changedStoryboardId": "sb-chapter-001-002",
                "affectedShotIds": ["sb-chapter-001-002", "sb-chapter-001-003"],
                "upperShotId": "sb-chapter-001-004",
            }],
        )
        self.assertTrue(state["storyboards"][1]["stale"])
        self.assertTrue(state["storyboards"][2]["stale"])
        self.assertEqual(
            state["storyboards"][2]["staleReason"], "上游连续镜头引用的资产 Bible 已更新"
        )
        # 区间外零变化(§七P5:SH08 起不重算、不重审——此处=断链镜4/异组镜5)
        self.assertEqual(
            json.dumps(state["storyboards"][3], ensure_ascii=False, sort_keys=True),
            shot4_before,
        )
        self.assertEqual(
            json.dumps(state["storyboards"][4], ensure_ascii=False, sort_keys=True),
            shot5_before,
        )
        # 区间内回接旧帧关键帧被标已过期-禁止使用;区间外镜4 无关键帧不涉及
        kf = state["storyboards"][2]["keyframes"][0]
        self.assertEqual(kf["status"], "已过期-禁止使用")
        self.assertIn("旧图配新镜清单", kf["expiredReason"])
        self.assertGreater(kf["expiredSince"], 0)
        self.assertEqual(
            report["expiredKeyframes"],
            [{
                "storyboardId": "sb-chapter-001-003",
                "frameId": "sb-chapter-001-003-kf-1",
                "targetsLegacyIndex": 2,
            }],
        )

    def test_asset_sync_legacy_keyframe_extends_interval(self) -> None:
        """第二依赖判据:镜4 断链但关键帧回接被改镜(legacyIndex=2)→ 依赖成立,
        区间延至镜4(其关键帧同样标过期);异组镜5 仍零变化。"""
        state, manifest_path = self.build_interval_state(
            shot4_chained=False,
            shot4_legacy_keyframe=True,
        )
        shot5_before = json.dumps(state["storyboards"][4], ensure_ascii=False, sort_keys=True)

        report = sync_pending_asset_manifest(state, manifest_path)

        self.assertEqual(
            report["propagatedStoryboards"],
            ["sb-chapter-001-003", "sb-chapter-001-004"],
        )
        self.assertEqual(
            report["intervals"][0]["affectedShotIds"],
            ["sb-chapter-001-002", "sb-chapter-001-003", "sb-chapter-001-004"],
        )
        self.assertEqual(report["intervals"][0]["upperShotId"], "sb-chapter-001-005")
        self.assertTrue(state["storyboards"][3]["stale"])
        self.assertEqual(
            state["storyboards"][3]["keyframes"][0]["status"], "已过期-禁止使用"
        )
        self.assertEqual(
            json.dumps(state["storyboards"][4], ensure_ascii=False, sort_keys=True),
            shot5_before,
        )
        self.assertEqual(
            {item["storyboardId"] for item in report["expiredKeyframes"]},
            {"sb-chapter-001-003", "sb-chapter-001-004"},
        )


if __name__ == "__main__":
    unittest.main()
