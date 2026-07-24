import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_generator():
    path = Path(__file__).resolve().parents[1] / "build_daojie_chapter001_workflow.py"
    spec = importlib.util.spec_from_file_location("chapter001_approved_reuse", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Chapter001ApprovedStoryboardReuseTest(unittest.TestCase):
    def test_image_edit_provider_config_is_explicit_and_synchronous(self):
        module = load_generator()
        config = module.normalize_storyboard_image_provider_config({
            "providerName": "toonflow-local-ai",
            "baseUrl": "http://127.0.0.1:8317/v1",
            "apiKey": "placeholder",
            "model": "gpt-image-2",
            "requestMode": "openai-image-edits",
            "asyncMode": False,
        }, 30)

        self.assertEqual(config["requestMode"], "openai-image-edits")
        self.assertFalse(config["asyncMode"])
        with self.assertRaisesRegex(RuntimeError, "asyncMode=false"):
            module.normalize_storyboard_image_provider_config({
                **config,
                "asyncMode": True,
            }, 30)

    def test_cli_requires_explicit_run_before_entering_mutating_workflow(self):
        module = load_generator()
        with patch.object(module, "main") as main:
            with self.assertRaises(SystemExit) as exit_info:
                module.run_cli([])
            self.assertEqual(exit_info.exception.code, 2)
            main.assert_not_called()

            module.run_cli(["--run"])
            main.assert_called_once_with()

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
                "continuityState": {
                    "inputFingerprint": "continuity-current",
                    "styleContractVersion": "daojie-gongbi-v2",
                },
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
            self.assertEqual(resolved["styleContractVersion"], "daojie-gongbi-v2")
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

    def test_shot_001_runtime_continuity_uses_storyboard_semantics(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            def image(name: str, color: tuple[int, int, int]) -> str:
                path = root / name
                Image.new("RGB", (64, 36), color).save(path)
                return str(path)

            zhao_views = [
                {"viewType": view_type, "imageUrl": image(f"zhao-{view_type}.png", (110, 110, 105))}
                for view_type in ("front", "side", "back")
            ]
            laborer_views = [
                {"viewType": view_type, "imageUrl": image(f"laborer-{view_type}.png", (90, 130, 145))}
                for view_type in ("front", "side", "back")
            ]
            catalog = {
                "金水河码头": {
                    "kind": "场景", "id": "scene-dock", "imagePath": image("dock.png", (80, 120, 130)),
                },
                "监工赵四": {
                    "kind": "角色", "id": "char-zhao", "imagePath": zhao_views[0]["imageUrl"], "views": zhao_views,
                },
                "小杂役": {
                    "kind": "角色", "id": "char-laborer", "imagePath": laborer_views[0]["imageUrl"], "views": laborer_views,
                },
                "赤练蛇皮鞭": {
                    "kind": "道具", "id": "prop-whip", "imagePath": image("whip.png", (145, 70, 65)),
                },
                "灵矿藤筐": {
                    "kind": "道具", "id": "prop-basket", "imagePath": image("basket.png", (95, 125, 80)),
                },
            }

            shot = {
                "index": 1,
                "scene": "金水河码头",
                "assets": ["监工赵四", "小杂役", "赤练蛇皮鞭", "灵矿藤筐"],
                "shotSemantics": {
                    "sceneViewpointId": "dock-main-axis",
                    "personFree": False,
                    "visibleCharacters": [
                        {
                            "name": "监工赵四",
                            "position": "左中格",
                            "orientation": "正面三分之四朝画面右下",
                            "actionIn": "高举赤练蛇皮鞭，鞭臂停在肩侧。",
                            "actionOut": "鞭臂停在劈落前的顶点。",
                        },
                        {
                            "name": "小杂役",
                            "position": "右下格",
                            "orientation": "正面三分之四朝画面左上",
                            "actionIn": "缩肩护住头脸。",
                            "actionOut": "仍在右下格护住头脸。",
                        },
                    ],
                    "visibleProps": [
                        {"name": "赤练蛇皮鞭", "position": "左前景", "state": "鞭梢扬起"},
                        {"name": "灵矿藤筐", "position": "右前景", "state": "半满并侧翻"},
                    ],
                    "actionIn": "赵四抬鞭，小杂役在右下格护头；独孤剑尘不入画。",
                    "actionOut": "赵四的鞭臂停在顶点，小杂役保持护头；独孤剑尘不入画。",
                },
            }
            module.attach_storyboard_continuity_groups([shot])
            assets = module.resolve_continuity_image_assets(shot, catalog)
            manifest, _versions, state = module.build_storyboard_continuity_payload(
                1,
                "赤练蛇皮鞭撕开河雾，朱红火印压在藤筐侧面。",
                assets,
                shot_semantics=shot["shotSemantics"],
                continuity_group=shot["_continuityGroup"],
            )
            references = module.collect_storyboard_reference_images(
                module.apply_continuity_manifest_to_image_assets(assets, manifest)
            )
            self.assertEqual([item["name"] for item in assets], ["金水河码头", "监工赵四", "小杂役", "赤练蛇皮鞭", "灵矿藤筐"])
            self.assertEqual([item["referenceRole"] for item in manifest], ["scene-viewpoint", "canonical", "canonical", "prop-state", "prop-state"])
            self.assertEqual([item["characterId"] for item in state["characters"]], ["char-zhao", "char-laborer"])
            self.assertEqual([item["referenceRole"] for item in references], ["scene-viewpoint", "canonical", "canonical", "canonical", "canonical", "canonical", "canonical", "prop-state", "prop-state"])
            with self.assertRaisesRegex(RuntimeError, "dock-ragged.*不兼容"):
                module.build_storyboard_image_prompt(
                    {
                        "id": "sb-chapter-001-001",
                        "index": 1,
                        "sceneNo": 1,
                        "prompt": "赤练蛇皮鞭撕开河雾，朱红火印压在藤筐侧面。",
                        "shotSemantics": shot["shotSemantics"],
                        "continuityState": state,
                    },
                    references,
                )

    def test_visible_props_only_select_the_props_declared_by_the_shot(self):
        module = load_generator()
        catalog = {
            "金水河码头": {"kind": "场景", "id": "scene-dock", "imagePath": "/dock.png"},
            "赤练蛇皮鞭": {"kind": "道具", "id": "prop-whip", "imagePath": "/whip.png"},
            "灵矿藤筐": {"kind": "道具", "id": "prop-basket", "imagePath": "/basket.png"},
        }
        shot = {
            "index": 1,
            "scene": "金水河码头",
            "assets": ["赤练蛇皮鞭", "灵矿藤筐"],
            "shotSemantics": {
                "sceneViewpointId": "dock-main-axis",
                "personFree": True,
                "visibleCharacters": [],
                "visibleProps": [{"name": "赤练蛇皮鞭", "position": "左前景", "state": "鞭梢扬起"}],
                "actionIn": "鞭梢扬起。",
                "actionOut": "鞭梢停在空中。",
            },
        }

        self.assertEqual(
            [item["name"] for item in module.resolve_continuity_image_assets(shot, catalog)],
            ["金水河码头", "赤练蛇皮鞭"],
        )

    def test_approved_reuse_requires_the_current_semantic_fingerprint(self):
        module = load_generator()
        approved = {"continuityState": {"inputFingerprint": "current"}}

        self.assertTrue(module.approved_storyboard_reuse_matches_current(approved, "current"))
        self.assertFalse(module.approved_storyboard_reuse_matches_current(approved, "changed"))

    def test_continuity_groups_follow_current_scene_and_viewpoint_semantics(self):
        module = load_generator()
        shots = [
            {
                "index": 1,
                "scene": "码头甲",
                "shotSemantics": {
                    "sceneViewpointId": "dock-east",
                    "personFree": True,
                    "visibleCharacters": [],
                    "visibleProps": [],
                    "actionIn": "雾从东侧压来。",
                    "actionOut": "雾停在木桩前。",
                },
            },
            {
                "index": 2,
                "scene": "码头甲",
                "shotSemantics": {
                    "sceneViewpointId": "dock-east",
                    "personFree": True,
                    "visibleCharacters": [],
                    "visibleProps": [],
                    "actionIn": "木桩留在前景。",
                    "actionOut": "河面向右延伸。",
                },
            },
            {
                "index": 3,
                "scene": "客栈后门",
                "shotSemantics": {
                    "sceneViewpointId": "inn-back-door",
                    "personFree": True,
                    "visibleCharacters": [],
                    "visibleProps": [],
                    "actionIn": "后门半掩。",
                    "actionOut": "门缝映出街面。",
                },
            },
        ]

        module.attach_storyboard_continuity_groups(shots)

        self.assertEqual(
            [shot["_continuityGroup"]["groupId"] for shot in shots],
            ["chapter-001:source:001-002", "chapter-001:source:001-002", "chapter-001:source:003-003"],
        )
        self.assertEqual(shots[2]["_continuityGroup"]["sceneName"], "客栈后门")
        self.assertEqual(shots[2]["_continuityGroup"]["viewpointId"], "inn-back-door")

    def test_missing_storyboard_semantics_blocks_character_inference(self):
        module = load_generator()
        shot = {
            "index": 1,
            "scene": "金水河码头",
            "assets": ["赤练蛇皮鞭", "灵矿藤筐"],
        }

        with self.assertRaisesRegex(RuntimeError, "缺少出镜语义JSON"):
            module.resolve_continuity_image_assets(shot, {})

    def test_prompt_audit_uses_declared_empty_frame_not_offscreen_dialogue(self):
        module = load_generator()
        raw_prompt = "楼下掌柜的声音穿过木板，窗外油灯亮起。"
        references = [{
            "assetId": "scene:inn-room",
            "assetType": "scene",
            "title": "悦来客栈斗室",
            "referenceRole": "scene-viewpoint",
        }]
        final_prompt = module.build_storyboard_image_prompt(
            {"id": "sb-chapter-001-023", "index": 23, "sceneNo": 2, "prompt": raw_prompt},
            references,
        )
        audit = module.build_storyboard_prompt_audit(
            {
                "id": "sb-chapter-001-023",
                "index": 23,
                "shotSemantics": {
                    "sceneViewpointId": "inn-room-window-axis",
                    "personFree": True,
                    "visibleCharacters": [],
                    "visibleProps": [],
                    "actionIn": "掌柜的声音从楼下传来",
                    "actionOut": "窗外油灯亮起",
                },
            },
            final_prompt,
            references,
            raw_prompt,
        )

        self.assertEqual(audit["visibleRoleSource"], "shotSemantics")
        self.assertEqual(audit["visibleRoleNames"], [])
        self.assertEqual(audit["missingVisibleRoleReferences"], [])

    def test_prompt_audit_requires_reference_for_declared_visible_character(self):
        module = load_generator()
        references = [{
            "assetId": "scene:inn-hall",
            "assetType": "scene",
            "title": "悦来客栈",
            "referenceRole": "scene-viewpoint",
        }]
        audit = module.build_storyboard_prompt_audit(
            {
                "id": "sb-chapter-001-013",
                "index": 13,
                "shotSemantics": {
                    "sceneViewpointId": "inn-hall-counter-axis",
                    "personFree": False,
                    "visibleCharacters": [{
                        "name": "掌柜",
                        "position": "柜台后",
                        "orientation": "朝前",
                        "actionIn": "拨算盘",
                        "actionOut": "抬眼",
                    }],
                    "visibleProps": [],
                    "actionIn": "算珠声响起",
                    "actionOut": "门轴响起",
                },
            },
            "【画面】@图1内，掌柜拨算盘。",
            references,
            "掌柜拨算盘。",
        )

        self.assertEqual(audit["visibleRoleSource"], "shotSemantics")
        self.assertEqual(audit["missingVisibleRoleReferences"], ["掌柜"])

    def test_non_gpt_async_provider_uses_mikoto_async_endpoints(self):
        module = load_generator()
        calls = []
        responses = [
            {"task_id": "img-task-1"},
            {"status": "completed", "data": [{"url": "https://cdn.example/image.png"}]},
        ]

        def fake_fetch(url, api_key, payload=None, timeout_seconds=180):
            calls.append((url, payload))
            return responses.pop(0)

        config = {
            "baseUrl": "https://api.mikoto.vip/v1",
            "apiKey": "test-key",
            "model": "mikoto-image-1",
            "aspectRatio": "16:9",
            "resolution": "1K",
            "timeoutSeconds": 1,
            "asyncMode": True,
        }
        with patch.object(module, "fetch_json", side_effect=fake_fetch), patch.object(module.time, "sleep"):
            result = module.request_storyboard_image_generation("prompt", [], config)

        self.assertEqual(result, "https://cdn.example/image.png")
        self.assertEqual(calls[0][0], "https://api.mikoto.vip/v1/images/generations/async")
        self.assertEqual(calls[1][0], "https://api.mikoto.vip/v1/images/tasks/img-task-1")

    def test_non_gpt_paid_ledger_blocks_same_fingerprint(self):
        module = load_generator()
        calls = []
        responses = [{"data": [{"url": "https://cdn.example/image.png"}]}]

        def fake_fetch(url, api_key, payload=None, timeout_seconds=180):
            calls.append(url)
            return responses.pop(0)

        with tempfile.TemporaryDirectory() as temp:
            ledger_path = Path(temp) / "paid-ledger.jsonl"
            config = {
                "baseUrl": "https://api.mikoto.vip/v1",
                "apiKey": "test-key",
                "apiKeys": ["test-key"],
                "providers": [{"apiKey": "test-key", "apiKeys": ["test-key"]}],
                "model": "mikoto-image-1",
                "aspectRatio": "16:9",
                "resolution": "1K",
                "timeoutSeconds": 1,
                "asyncMode": True,
                "singleAttempt": True,
                "paidAuthorization": True,
                "paidRequestLedgerPath": str(ledger_path),
                "attemptId": "attempt-1",
                "logicalJob": "test-job",
                "logicalShot": "sb-test-001",
            }
            with patch.object(module, "fetch_json", side_effect=fake_fetch):
                self.assertEqual(
                    module.request_storyboard_image_generation("prompt", [], config),
                    "https://cdn.example/image.png",
                )
                config["attemptId"] = "attempt-2"
                with self.assertRaisesRegex(RuntimeError, "同一指纹"):
                    module.request_storyboard_image_generation("prompt", [], config)

            events = [json.loads(line) for line in ledger_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual([event["status"] for event in events], ["POST_SENT", "COMPLETED"])
            self.assertEqual(calls, ["https://api.mikoto.vip/v1/images/generations/async"])

    def test_v2_rejects_legacy_ragged_reference_instead_of_renaming_it(self):
        module = load_generator()
        references = [
            {
                "assetId": "scene-school",
                "assetType": "scene",
                "title": "金水塾馆",
                "referenceRole": "scene-viewpoint",
                "sceneViewpointId": "school-main",
            },
            {
                "assetId": "child-helper",
                "assetType": "character",
                "title": "小杂役",
                "referenceRole": "canonical",
                "wardrobeVersion": "dock-ragged",
                "identityAnchors": {
                    "hairStyle": "凌乱及肩黑发",
                    "uniqueMarks": ["十二三岁瘦弱少年体态、褴褛短褐与破旧裤装且赤足"],
                },
                "negativePrompt": {"avoid": ["成年女性脸"]},
            },
        ]
        raw_prompt = "小杂役挤坐长凳，破衣湿鞋收在凳下。"
        with self.assertRaisesRegex(RuntimeError, "dock-ragged.*不兼容"):
            module.build_storyboard_image_prompt(
                {
                    "id": "sb-chapter-001-025",
                    "index": 25,
                    "sceneNo": 3,
                    "prompt": raw_prompt,
                    "shotSemantics": {
                        "sceneViewpointId": "school-lamp-desk-axis",
                        "personFree": False,
                        "visibleCharacters": [{
                            "name": "小杂役",
                            "position": "右中格",
                            "orientation": "朝左",
                            "actionIn": "收起湿鞋",
                            "actionOut": "抬头",
                        }],
                        "visibleProps": [],
                        "actionIn": "收起湿鞋",
                        "actionOut": "抬头",
                    },
                },
                references,
            )

    def test_blocked_manifest_prompt_projects_legacy_bible_facts_without_internal_conflicts(self):
        module = load_generator()
        references = [
            {
                "assetId": "scene:dock",
                "versionId": "scene:dock-main-axis:v1",
                "assetType": "scene",
                "title": "金水河码头",
                "referenceRole": "scene-viewpoint",
                "sceneViewpointId": "dock-main-axis",
                "spatialLayout": "湿石阶在左，系船柱与木船在右",
            },
            {
                "assetId": "char:helper",
                "versionId": "char:helper:dock-ragged:v1",
                "assetType": "character",
                "title": "小杂役",
                "referenceRole": "canonical",
                "wardrobeVersion": "dock-ragged",
                "identityAnchors": {
                    "hairStyle": "十二三岁少年",
                    "uniqueMarks": ["瘦小体型", "褴褛短褐与破旧裤装"],
                },
            },
        ]
        semantics = {
            "sceneViewpointId": "dock-main-axis",
            "personFree": False,
            "visibleCharacters": [{
                "name": "小杂役",
                "position": "右下前景",
                "orientation": "蜷身朝左",
                "actionIn": "抱矿跪倒",
                "actionOut": "护住头脸",
            }],
            "visibleProps": [],
            "actionIn": "河雾压住码头，小杂役抱矿跪倒",
            "actionOut": "镜头转入受伤的手指",
        }
        storyboard = {
            "id": "sb-chapter-001-001",
            "index": 1,
            "prompt": "小杂役抱矿跪倒，河雾从左侧漫入。",
            "shotSemantics": semantics,
            "continuityState": {
                "groupId": "chapter-001:source:001-012",
                "previousStoryboardId": None,
                "sceneVersionId": "scene:dock-main-axis:v1",
                "sceneViewpointId": "dock-main-axis",
                "palette": "墨青、灰蓝、湿石深灰、藤筐赭褐、苔绿，旧金与朱砂仅作小面积叙事焦点。",
                "characters": [{"characterId": "char:helper", "versionId": "char:helper:dock-ragged:v1"}],
            },
        }

        final_prompt = module.build_storyboard_image_prompt(
            storyboard,
            references,
            enforce_v2_reference_compatibility=False,
        )
        audit = module.build_storyboard_prompt_audit(
            storyboard,
            final_prompt,
            references,
            storyboard["prompt"],
        )

        self.assertNotIn("dock-ragged", final_prompt)
        self.assertNotIn("褴褛", final_prompt)
        self.assertNotIn("灰蓝", module.extract_prompt_section(final_prompt, "场景锁"))
        self.assertNotIn("深灰", module.extract_prompt_section(final_prompt, "场景锁"))
        self.assertNotIn("仅作小面积", module.extract_prompt_section(final_prompt, "场景锁"))
        self.assertNotIn("保持所有@图N造型、结构与参考图一致", final_prompt)
        self.assertIn("仅继承身份、面容、体态和发型识别点", final_prompt)
        self.assertIn("【参考继承边界】", final_prompt)
        self.assertIn("V2媒介、综合色彩、完整衣物、当前分镜动作与构图优先", final_prompt)
        self.assertEqual(audit["v2"]["status"], "pass")

    def test_prompt_leads_with_every_visible_character_and_source_time(self):
        module = load_generator()
        references = [
            {"assetId": "scene:dock", "assetType": "scene", "title": "金水河码头", "referenceRole": "scene-viewpoint"},
            {"assetId": "char:zhao", "assetType": "character", "title": "监工赵四", "referenceRole": "canonical", "wardrobeVersion": "dock-overseer"},
            {"assetId": "char:helper", "assetType": "character", "title": "小杂役", "referenceRole": "canonical", "wardrobeVersion": "dock-workwear-v2"},
        ]
        semantics = {
            "sceneViewpointId": "dock-main-axis",
            "personFree": False,
            "visibleCharacters": [
                {"name": "监工赵四", "position": "左中景", "orientation": "朝右", "actionIn": "抬臂蓄鞭", "actionOut": "挥鞭"},
                {"name": "小杂役", "position": "右前景", "orientation": "朝左", "actionIn": "抱矿跪倒", "actionOut": "护住头脸"},
            ],
            "visibleProps": [],
            "actionIn": "赵四举鞭，小杂役跪倒",
            "actionOut": "鞭影落下",
        }

        final_prompt = module.build_storyboard_image_prompt(
            {"id": "sb-chapter-001-001", "index": 1, "prompt": "鞭梢撕开河雾。", "shotSemantics": semantics},
            references,
        )
        audit = module.build_storyboard_prompt_audit(
            {"id": "sb-chapter-001-001", "index": 1, "shotSemantics": semantics},
            final_prompt,
            references,
            "鞭梢撕开河雾。",
        )

        subject = module.extract_prompt_section(final_prompt, "主体动作")
        self.assertIn("@图2", subject)
        self.assertIn("@图3", subject)
        self.assertIn("傍晚", subject)
        self.assertNotIn("晨雾", final_prompt)
        self.assertEqual(audit["missingLeadingVisualCharacters"], [])
        self.assertLess(final_prompt.index("【主体动作】"), final_prompt.index("【画面】"))

    def test_cross_asset_alias_ownership_is_rejected_before_replacement(self):
        module = load_generator()
        references = [
            {"assetId": "whip", "assetType": "prop", "title": "赤练蛇皮鞭", "referenceRole": "prop-state", "aliases": ["灵矿"]},
            {"assetId": "basket", "assetType": "prop", "title": "灵矿藤筐", "referenceRole": "prop-state", "aliases": ["灵矿"]},
        ]

        audit = module.audit_storyboard_reference_alias_ownership(references)

        self.assertEqual(audit["status"], "fail")
        self.assertEqual(audit["collisions"][0]["alias"], "灵矿")
        with self.assertRaisesRegex(RuntimeError, "别名所有权冲突"):
            module.apply_reference_bindings_to_visual_prompt("灵矿落地", references)

    def test_reference_visual_preflight_rejects_ragged_gray_reference_and_time_conflict(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            scene_path = root / "scene.png"
            helper_path = root / "helper.png"
            Image.new("RGB", (100, 100), "#8d8a83").save(scene_path)
            Image.new("RGB", (100, 100), "#77736f").save(helper_path)
            audit = module.build_storyboard_reference_visual_audit([
                {
                    "assetId": "scene:dock",
                    "versionId": "scene:dock-main-axis:v1",
                    "assetType": "scene",
                    "title": "金水河码头",
                    "referenceRole": "scene-viewpoint",
                    "imageUrl": str(scene_path),
                    "referenceImageSha256": [sha256_file(scene_path)],
                    "lightingDesign": "阴天晨雾",
                },
                {
                    "assetId": "char:helper",
                    "versionId": "char:helper:dock-ragged:v1",
                    "assetType": "character",
                    "title": "小杂役",
                    "referenceRole": "canonical",
                    "imageUrl": str(helper_path),
                    "referenceImageSha256": [sha256_file(helper_path)],
                    "wardrobeVersion": "dock-ragged",
                },
            ], expected_time_of_day="傍晚")

            self.assertEqual(audit["status"], "fail")
            self.assertIn("scene_time_conflict", audit["failedGates"])
            self.assertIn("incompatible_wardrobe_version", audit["failedGates"])
            self.assertIn("reference_color", audit["failedGates"])
            self.assertEqual(audit["references"][0]["sourceSha256"], sha256_file(scene_path))
            self.assertEqual(audit["references"][1]["sourceSha256"], sha256_file(helper_path))
            self.assertEqual(audit["references"][0]["declaredSourceSha256"], sha256_file(scene_path))

    def test_reference_visual_preflight_uses_prop_diagnostic_color_policy(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "prop.png"
            image = Image.new("RGB", (100, 100), "#ece6dc")
            draw = ImageDraw.Draw(image)
            draw.rectangle((30, 10, 69, 89), fill="#55504b")
            draw.rectangle((30, 10, 33, 89), fill="#bd3b2c")
            image.save(source)

            audit = module.build_storyboard_reference_visual_audit([{
                "assetId": "prop:test",
                "versionId": "prop:test:base:v1",
                "assetType": "prop",
                "title": "测试道具",
                "referenceRole": "prop-state",
                "imageUrl": str(source),
                "referenceImageSha256": [sha256_file(source)],
            }])

            self.assertEqual(audit["status"], "pass")
            color_audit = audit["references"][0]["colorAudit"]
            self.assertEqual(color_audit["measurementBasis"], "subject-content")
            self.assertEqual(color_audit["colorGatePolicy"], "diagnostic-only")

    def test_reference_visual_preflight_rejects_selected_source_hash_mismatch(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "reference.png"
            image = Image.new("RGB", (100, 100), "#ece6dc")
            for x in range(60):
                for y in range(100):
                    image.putpixel((x, y), (40, 90, 150) if x < 40 else (180, 70, 40))
            image.save(source)

            audit = module.build_storyboard_reference_visual_audit([{
                "assetId": "scene:dock",
                "versionId": "scene:dock-main-axis:v2",
                "assetType": "scene",
                "title": "金水河码头",
                "referenceRole": "scene-viewpoint",
                "imageUrl": str(source),
                "referenceImageSha256": ["0" * 64],
            }], expected_time_of_day="傍晚")

            self.assertEqual(audit["status"], "fail")
            self.assertIn("reference_hash_mismatch", audit["failedGates"])
            self.assertEqual(audit["references"][0]["sourceSha256"], sha256_file(source))
            self.assertEqual(audit["references"][0]["declaredSourceSha256"], "0" * 64)

    def test_prompt_does_not_repeat_semantic_actions_or_scene_light(self):
        module = load_generator()
        references = [
            {"assetId": "scene:dock", "assetType": "scene", "title": "金水河码头", "referenceRole": "scene-viewpoint"},
            {"assetId": "char:zhao", "assetType": "character", "title": "监工赵四", "referenceRole": "canonical", "wardrobeVersion": "dock-overseer"},
            {"assetId": "char:helper", "assetType": "character", "title": "小杂役", "referenceRole": "canonical", "wardrobeVersion": "dock-workwear-v2"},
        ]
        semantics = {
            "sceneViewpointId": "dock-main-axis",
            "personFree": False,
            "visibleCharacters": [
                {"name": "监工赵四", "position": "左中景", "orientation": "朝右", "actionIn": "抬臂蓄鞭", "actionOut": "挥鞭落下"},
                {"name": "小杂役", "position": "右前景", "orientation": "朝左", "actionIn": "抱矿跪倒", "actionOut": "护住头脸"},
            ],
            "visibleProps": [],
            "actionIn": "赵四举鞭，小杂役跪倒",
            "actionOut": "鞭影越过两人",
        }
        state = {
            "groupId": "chapter-001:source:001-012",
            "previousStoryboardId": None,
            "sceneVersionId": "scene:dock-main-axis:v1",
            "sceneViewpointId": "dock-main-axis",
            "palette": "石青、赭石、朱砂",
            "actionIn": semantics["actionIn"],
            "actionOut": semantics["actionOut"],
            "characters": [
                {
                    "characterId": "char:zhao",
                    "versionId": "char:zhao:dock-overseer:v1",
                    "position": "左中景",
                    "orientation": "朝右",
                    "actionIn": "抬臂蓄鞭",
                    "actionOut": "挥鞭落下",
                },
                {
                    "characterId": "char:helper",
                    "versionId": "char:helper:dock-workwear-v2:v1",
                    "position": "右前景",
                    "orientation": "朝左",
                    "actionIn": "抱矿跪倒",
                    "actionOut": "护住头脸",
                },
            ],
        }

        prompt = module.build_storyboard_image_prompt({
            "id": "sb-chapter-001-001",
            "index": 1,
            "prompt": "鞭梢撕开河雾。",
            "shotSemantics": semantics,
            "continuityState": state,
        }, references)

        self.assertEqual(prompt.count("抬臂蓄鞭"), 1)
        self.assertEqual(prompt.count("赵四举鞭，小杂役跪倒"), 1)
        self.assertEqual(prompt.count("金水河傍晚河雾"), 1)
        self.assertNotIn("【动作承接】", prompt)
        self.assertNotIn("【人物状态】", prompt)
        self.assertIn("【连续镜头组】chapter-001:source:001-012", prompt)
        self.assertIn("【出镜人数锁】本镜出镜角色总数：2", prompt)

    def test_v2_light_uses_continuity_viewpoint_over_legacy_scene_number(self):
        module = load_generator()
        final_prompt = module.build_storyboard_image_prompt(
            {
                "id": "sb-chapter-001-041",
                "index": 41,
                "sceneNo": 3,
                "prompt": "独孤在斗室内合上残卷。",
                "continuityState": {
                    "groupId": "chapter-001:inn-room-return:41-42",
                    "sceneVersionId": "scene:inn-room-night-return:v1",
                    "sceneViewpointId": "inn-room-night-return",
                    "lighting": "塾馆油灯与窗外冷雾交叠，孩童面部半明半暗。",
                    "palette": "石青、赭石与旧金",
                    "actionIn": "独孤在斗室内合上残卷。",
                    "actionOut": "独孤在斗室内合上残卷。",
                    "characters": [],
                },
            },
            [],
        )

        self.assertIn("深夜斗室中枯灯与窗外月色", final_prompt)
        self.assertIn("不出现塾馆人物", final_prompt)
        self.assertNotIn("塾馆油灯", final_prompt)

    def test_reference_transport_bundles_only_the_views_needed_to_fit_capacity(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            def write_image(name: str, color: tuple[int, int, int]) -> Path:
                path = root / f"{name}.png"
                Image.new("RGB", (320, 480), color).save(path)
                return path

            scene = write_image("scene", (80, 100, 120))
            zhao_views = [
                write_image("zhao-front", (120, 80, 60)),
                write_image("zhao-side", (130, 90, 70)),
                write_image("zhao-back", (140, 100, 80)),
            ]
            laborer_views = [
                write_image("laborer-front", (60, 100, 120)),
                write_image("laborer-side", (70, 110, 130)),
                write_image("laborer-back", (80, 120, 140)),
            ]
            prop = write_image("prop", (100, 80, 120))
            source_hashes = {path: sha256_file(path) for path in [scene, *zhao_views, *laborer_views, prop]}
            references = [
                {
                    "assetId": "scene-dock",
                    "assetType": "scene",
                    "title": "金水河码头",
                    "imageUrl": str(scene),
                    "referenceRole": "scene-viewpoint",
                },
                *[
                    {
                        "assetId": "char-zhao",
                        "assetType": "character",
                        "title": "监工赵四",
                        "imageUrl": str(path),
                        "referenceRole": "canonical",
                        "versionId": "char-zhao:dock-overseer:v1",
                        "characterViewType": view,
                    }
                    for path, view in zip(zhao_views, ["front", "side", "back"])
                ],
                *[
                    {
                        "assetId": "char-laborer",
                        "assetType": "character",
                        "title": "小杂役",
                        "imageUrl": str(path),
                        "referenceRole": "canonical",
                        "versionId": "char-laborer:dock-workwear:v1",
                        "characterViewType": view,
                    }
                    for path, view in zip(laborer_views, ["front", "side", "back"])
                ],
                {
                    "assetId": "prop-whip",
                    "assetType": "prop",
                    "title": "赤练蛇皮鞭",
                    "imageUrl": str(prop),
                    "referenceRole": "prop-state",
                },
            ]
            capability = {
                "schemaVersion": module.daojie_gongbi_v2.REFERENCE_CAPABILITY_SCHEMA_VERSION,
                "status": "verified",
                "providerName": "mikoto",
                "model": "gpt-image-2",
                "supportedReferenceCount": 6,
                "referenceRoleOrder": list(module.daojie_gongbi_v2.REFERENCE_ROLE_ORDER),
                "evidence": {"kind": "test", "checkedAt": "2026-07-20", "detail": "fixture"},
                "styleReference": {"enabled": False, "sha256": None},
            }

            transported, transport = module.build_storyboard_reference_transport(
                references,
                capability,
                root / "reference-bundles",
            )
            repeated, repeated_transport = module.build_storyboard_reference_transport(
                references,
                capability,
                root / "reference-bundles",
            )

            self.assertEqual(transport["sourceReferenceCount"], 8)
            self.assertEqual(transport["providerReferenceCount"], 6)
            self.assertEqual(transport["bundleCount"], 1)
            self.assertEqual(transport["remainingReduction"], 0)
            self.assertEqual(len(transported), 6)
            self.assertEqual(transported[1]["referenceTransport"]["kind"], "character-three-view-bundle")
            self.assertEqual(transported[1]["referenceTransport"]["sourceViewTypes"], ["front", "side", "back"])
            self.assertEqual(len(transported[1]["referenceTransport"]["sourceReferences"]), 3)
            with Image.open(transported[1]["imageUrl"]) as bundle_image:
                self.assertEqual(bundle_image.size, (768, 768))
            self.assertEqual([item["imageUrl"] for item in repeated], [item["imageUrl"] for item in transported])
            self.assertEqual(repeated_transport["fingerprint"], transport["fingerprint"])
            self.assertEqual({path: sha256_file(path) for path in source_hashes}, source_hashes)

            near_capacity, near_capacity_transport = module.build_storyboard_reference_transport(
                references,
                {**capability, "supportedReferenceCount": 7},
                root / "reference-bundles",
            )
            self.assertEqual(near_capacity_transport["requiredReduction"], 1)
            self.assertEqual(near_capacity_transport["providerReferenceCount"], 6)
            self.assertEqual(near_capacity_transport["remainingReduction"], 0)
            self.assertEqual(near_capacity_transport["bundleCount"], 1)
            self.assertEqual(len(near_capacity), 6)

            final_prompt = module.build_storyboard_image_prompt(
                {"id": "sb-chapter-001-001", "index": 1, "sceneNo": 1, "prompt": "监工赵四举鞭，小杂役抱矿跪倒。"},
                transported,
            )
            self.assertIn("三视图束", final_prompt)
            self.assertIn("不是三个人", final_prompt)

    def test_primary_per_asset_transport_keeps_all_logical_assets_and_prefers_front(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            def reference(asset_id, role, name, view=None):
                path = root / f"{name}.png"
                Image.new("RGB", (96, 128), (90 + len(name), 110, 130)).save(path)
                return {
                    "assetId": asset_id,
                    "versionId": f"{asset_id}:v1",
                    "assetType": "character" if role == "canonical" else "scene" if role == "scene-viewpoint" else "prop",
                    "title": name,
                    "imageUrl": str(path),
                    "referenceRole": role,
                    "characterViewType": view,
                }

            references = [
                reference("scene-dock", "scene-viewpoint", "scene"),
                reference("char-zhao", "canonical", "zhao-side", "side"),
                reference("char-zhao", "canonical", "zhao-front", "front"),
                reference("char-zhao", "canonical", "zhao-back", "back"),
                reference("prop-whip", "prop-state", "whip"),
                reference("prop-basket", "prop-state", "basket"),
            ]
            capability = {
                "status": "verified",
                "supportedReferenceCount": 4,
                "referenceTransportStrategy": "primary-per-asset",
            }

            transported, report = module.build_storyboard_reference_transport(
                references,
                capability,
                root / "unused-bundles",
            )
            repeated, repeated_report = module.build_storyboard_reference_transport(
                references,
                capability,
                root / "unused-bundles",
            )

            self.assertEqual(
                [(item["assetId"], item["referenceRole"]) for item in transported],
                [
                    ("scene-dock", "scene-viewpoint"),
                    ("char-zhao", "canonical"),
                    ("prop-whip", "prop-state"),
                    ("prop-basket", "prop-state"),
                ],
            )
            self.assertEqual(transported[1]["characterViewType"], "front")
            self.assertTrue(transported[1]["imageUrl"].endswith("zhao-front.png"))
            self.assertEqual(transported[1]["referenceTransport"]["sourceReferenceCount"], 3)
            self.assertEqual(transported[1]["referenceTransport"]["sourceViewTypes"], ["side", "front", "back"])
            self.assertEqual(sum(item["referenceTransport"]["sourceReferenceCount"] for item in transported), 6)
            self.assertEqual(report["strategy"], "primary-per-asset")
            self.assertEqual(report["sourceReferenceCount"], 6)
            self.assertEqual(report["providerReferenceCount"], 4)
            self.assertEqual(report["sourceReductionCount"], 2)
            self.assertEqual(repeated_report["fingerprint"], report["fingerprint"])
            self.assertEqual([item["imageUrl"] for item in repeated], [item["imageUrl"] for item in transported])

            with self.assertRaisesRegex(RuntimeError, "逻辑资产数量 4 超过已验证容量 3"):
                module.build_storyboard_reference_transport(
                    references,
                    {**capability, "supportedReferenceCount": 3},
                    root / "unused-bundles",
                )

    def test_main_storyboard_entrypoint_uses_primary_assets_with_existing_provider(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "project"
            project.mkdir()
            module.PROJECT = project

            def asset(asset_id, kind, name, role, view=None):
                path = root / f"{name}.png"
                Image.new("RGB", (96, 128), (110, 90 + len(name), 120)).save(path)
                return {
                    "assetId": asset_id,
                    "versionId": f"{asset_id}:v1",
                    "kind": kind,
                    "name": name,
                    "imagePath": str(path),
                    "referenceRole": role,
                    "characterViewType": view,
                }

            assets = [
                asset("scene-dock", "场景", "金水河码头", "scene-viewpoint"),
                asset("char-zhao", "角色", "监工赵四", "canonical", "side"),
                asset("char-zhao", "角色", "监工赵四", "canonical", "front"),
                asset("char-zhao", "角色", "监工赵四", "canonical", "back"),
                asset("prop-whip", "道具", "赤练蛇皮鞭", "prop-state"),
                asset("prop-basket", "道具", "灵矿藤筐", "prop-state"),
            ]
            approved = project / "approved-shot-001.png"
            Image.new("RGB", (320, 180), (90, 125, 150)).save(approved)
            approved_input = {
                "absolutePath": str(approved),
                "projectUrl": module.project_file_url(approved.relative_to(project)),
                "styleContractVersion": module.daojie_gongbi_v2.STYLE_CONTRACT_VERSION,
            }
            config = {
                "providerName": "mikoto",
                "model": "gpt-image-2",
                "requestMode": "openai-image-generations-json",
                "aspectRatio": "16:9",
                "resolution": "1K",
                "styleContractVersion": module.daojie_gongbi_v2.STYLE_CONTRACT_VERSION,
                "styleContractFingerprint": module.daojie_gongbi_v2.style_contract_fingerprint(),
                "promptAuditVersion": module.daojie_gongbi_v2.PROMPT_AUDIT_VERSION,
            }

            with patch.object(module, "audit_daojie_gongbi_v2_output", return_value={"status": "pass"}):
                result = module.generate_storyboard_frame_with_references(
                    root / "frame.png",
                    {
                        "id": "sb-chapter-001-001",
                        "index": 1,
                        "sceneNo": 1,
                        "prompt": "监工赵四在金水河码头举起赤练蛇皮鞭，灵矿藤筐在旁。",
                    },
                    "监工赵四在金水河码头举起赤练蛇皮鞭，灵矿藤筐在旁。",
                    assets,
                    config,
                    approved_storyboard_image=approved_input,
                )

            self.assertEqual(len(result["sourceReferenceImages"]), 6)
            self.assertEqual(len(result["referenceImages"]), 4)
            self.assertEqual(result["referenceTransport"]["strategy"], "primary-per-asset")
            self.assertEqual(result["referenceImages"][1]["characterViewType"], "front")
            self.assertEqual(result["providerRequestEvidence"]["requestMode"], "openai-image-generations-json")
            self.assertEqual(result["providerRequestEvidence"]["referenceTransport"]["providerReferenceCount"], 4)

    def test_model_reference_preflight_is_uri_free_and_reuses_compressed_payloads(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "reference.png"
            Image.new("RGB", (1200, 900), (76, 128, 164)).save(source)
            prepared, report = module.prepare_storyboard_model_reference_images([
                {"imageUrl": str(source)},
                {"imageUrl": str(source)},
            ])

            self.assertEqual(len(prepared), 2)
            self.assertTrue(all(value.startswith("data:image/jpeg;base64,") for value in prepared))
            self.assertEqual(report["schemaVersion"], module.MODEL_REFERENCE_PREFLIGHT_SCHEMA_VERSION)
            self.assertEqual(report["referenceCount"], 2)
            self.assertEqual(report["totalBytes"], sum(item["bytes"] for item in report["references"]))
            self.assertNotIn("data:image", json.dumps(report, ensure_ascii=False))
            self.assertNotIn(str(source), json.dumps(report, ensure_ascii=False))
            for item in report["references"]:
                self.assertEqual(item["mimeType"], "image/jpeg")
                self.assertLessEqual(max(item["width"], item["height"]), 768)
                self.assertLess(item["bytes"], 1_000_000)
                self.assertRegex(item["sha256"], r"^[a-f0-9]{64}$")

            repeated, repeated_report = module.prepare_storyboard_model_reference_images([
                {"imageUrl": str(source)},
                {"imageUrl": str(source)},
            ])
            self.assertEqual(repeated, prepared)
            self.assertEqual(repeated_report, report)


if __name__ == "__main__":
    unittest.main()
