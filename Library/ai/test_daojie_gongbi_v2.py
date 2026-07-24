from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from Library.ai import daojie_gongbi_v2 as v2


class DaojieGongbiV2Test(unittest.TestCase):
    def verified_capability(self, *, supported_count: int = 2) -> dict[str, object]:
        return {
            "schemaVersion": v2.REFERENCE_CAPABILITY_SCHEMA_VERSION,
            "status": "verified",
            "providerName": "mikoto",
            "model": "gpt-image-2",
            "supportedReferenceCount": supported_count,
            "referenceRoleOrder": list(v2.REFERENCE_ROLE_ORDER),
            "evidence": {
                "kind": "no-network-contract-test",
                "checkedAt": "2026-07-19",
                "detail": "fixture only",
            },
            "semanticRoleEvidence": {
                "status": "unverified",
                "providerRoleMetadataSent": False,
                "bindingMechanism": "prompt-markers-plus-ordered-images",
                "detail": "The provider payload has no native reference-role fields.",
            },
            "styleReference": {"enabled": False, "sha256": None},
        }

    def test_prompt_audit_requires_v2_markers_and_rejects_legacy_art_direction(self) -> None:
        valid_prompt = f"【风格锁】{v2.STORYBOARD_STYLE_LOCK}【反向约束】{v2.STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}"
        passed = v2.prompt_quality_audit(valid_prompt, ["scene-viewpoint"], None)
        self.assertEqual(passed["status"], "pass")
        self.assertEqual(passed["styleContractVersion"], v2.STYLE_CONTRACT_VERSION)
        self.assertEqual(passed["version"], "daojie-gongbi-v2-prompt-audit-v6")
        self.assertIn("连续可见色区", valid_prompt)
        self.assertIn("不得继承参考图的灰白媒介", valid_prompt)
        self.assertIn("黑白画、灰白画、单色素描", valid_prompt)

        rejected = v2.prompt_quality_audit(
            f"【风格锁】{v2.STORYBOARD_STYLE_LOCK}竹窗卷轴 (best quality:1.2), dirty texture, 褴褛短褐"
            f"【反向约束】{v2.STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}",
            ["scene-viewpoint"],
            None,
        )
        self.assertEqual(rejected["status"], "fail")
        self.assertIn("sd_weight_syntax", rejected["violations"])
        self.assertIn("positive_dirty_texture", rejected["violations"])
        self.assertIn("ragged_clothing_language", rejected["violations"])
        self.assertIn("global_interior_style_leak", rejected["violations"])

        allowed_negative = v2.prompt_quality_audit(
            f"【风格锁】{v2.STORYBOARD_STYLE_LOCK}"
            "【反向约束】禁止 dirty texture、watermark"
            "【画面】矿物色洗染，拒绝单一灰蓝主色",
            ["scene-viewpoint"],
            None,
        )
        self.assertEqual(allowed_negative["status"], "fail")
        self.assertNotIn("positive_dirty_texture", allowed_negative["violations"])
        self.assertIn("monochrome_gray_blue_palette", allowed_negative["violations"])

        cinematic = v2.prompt_quality_audit(
            f"【风格锁】{v2.STORYBOARD_STYLE_LOCK}"
            "【画面】电影质感与镜面湿面反光"
            f"【反向约束】{v2.STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}",
            ["scene-viewpoint"],
            None,
        )
        self.assertIn("positive_cinematic_render_language", cinematic["violations"])
        self.assertIn("电影质感", cinematic["positiveCinematicRenderTerms"])

    def test_prompt_audit_only_requires_clothing_markers_for_character_references(self) -> None:
        scene_style = v2.STORYBOARD_STYLE_LOCK.replace(
            "全员衣物完整可穿，保留整袖口、整下摆和闭合缝线，材质可朴素但不可破损。",
            "",
        )
        scene_prompt = f"【媒介层级】{scene_style}【反向约束】{v2.STORYBOARD_NEGATIVE_CONSTRAINTS}"

        scene_audit = v2.prompt_quality_audit(scene_prompt, ["scene-viewpoint"], None)
        character_audit = v2.prompt_quality_audit(scene_prompt, ["canonical"], None)

        self.assertEqual(scene_audit["status"], "pass")
        self.assertEqual(character_audit["status"], "fail")
        self.assertIn("衣物完整可穿", character_audit["missingStyleMarkers"])

    def test_prompt_audit_reads_replacement_light_markers_from_light_source_section(self) -> None:
        replacement_prompt = (
            f"【媒介层级】{v2.STORYBOARD_MEDIUM_LOCK}"
            f"【色彩材质】{v2.STORYBOARD_COLOR_MATERIAL_LOCK}"
            f"【光源】{v2.STORYBOARD_LIGHT_LOCK}"
            f"【反向约束】{v2.STORYBOARD_NEGATIVE_CONSTRAINTS}"
        )

        audit = v2.prompt_quality_audit(replacement_prompt, ["scene-viewpoint"], None)

        self.assertEqual(audit["status"], "pass")
        self.assertEqual(audit["missingStyleMarkers"], [])

    def test_prompt_audit_rejects_internal_reference_wardrobe_and_palette_conflicts(self) -> None:
        conflicted = v2.prompt_quality_audit(
            f"【媒介层级】{v2.STORYBOARD_MEDIUM_LOCK}"
            "【资产圣经】@图2身份锚点：十二三岁少年；服装版本：dock-ragged"
            "【场景锁】scene:dock/v1，色板：墨青、灰蓝、湿石深灰，旧金与朱砂仅作小面积叙事焦点"
            f"【色彩材质】{v2.STORYBOARD_COLOR_MATERIAL_LOCK}"
            f"【光影】{v2.STORYBOARD_LIGHT_LOCK}"
            "保持所有@图N造型、结构与参考图一致。"
            f"【反向约束】{v2.STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}",
            ["scene-viewpoint", "canonical"],
            None,
        )

        self.assertEqual(conflicted["status"], "fail")
        self.assertIn("incompatible_wardrobe_identifier", conflicted["violations"])
        self.assertIn("legacy_scene_palette_conflict", conflicted["violations"])
        self.assertIn("unscoped_reference_inheritance", conflicted["violations"])
        self.assertEqual(conflicted["incompatibleWardrobeIdentifiers"], ["dock-ragged"])
        self.assertEqual(
            conflicted["legacyScenePaletteTerms"],
            ["灰蓝", "深灰", "仅作小面积"],
        )

    def test_scene_palette_projection_preserves_scene_facts_without_gray_blue_direction(self) -> None:
        raw = "墨青、灰蓝、湿石深灰、藤筐赭褐、旧木褐、苔绿，旧金与朱砂仅作小面积叙事焦点。"

        rendered = v2.render_prompt_safe_scene_palette(raw)

        self.assertEqual(raw, "墨青、灰蓝、湿石深灰、藤筐赭褐、旧木褐、苔绿，旧金与朱砂仅作小面积叙事焦点。")
        self.assertNotIn("灰蓝", rendered)
        self.assertNotIn("深灰", rendered)
        self.assertNotIn("仅作小面积", rendered)
        self.assertIn("石青", rendered)
        self.assertIn("湿石淡墨赭色", rendered)
        self.assertIn("藤筐赭褐", rendered)
        self.assertIn("苔绿", rendered)
        self.assertIn("连续可见的暖色薄染区", rendered)

    def test_prompt_safe_rendering_keeps_story_facts_out_of_ragged_clothing_terms(self) -> None:
        rendered = v2.render_prompt_safe_story_facts("一屋破衣湿鞋，孩童褴褛短褐")

        self.assertEqual(rendered, "一屋朴素完整短褐与湿鞋，孩童朴素完整短褐")
        self.assertEqual(v2.render_prompt_wardrobe_version("dock-ragged"), "dock-ragged")
        self.assertEqual(v2.render_prompt_safe_wardrobe_version("dock-ragged"), "")
        with self.assertRaisesRegex(RuntimeError, "dock-ragged.*不兼容"):
            v2.assert_v2_wardrobe_compatible("dock-ragged")
        self.assertEqual(v2.render_prompt_wardrobe_version("dock-overseer"), "dock-overseer")
        self.assertEqual(
            v2.render_prompt_safe_negative_constraints("极端破衣乞丐装、ragged hem"),
            "衣物不完整或断裂衣摆、incomplete clothing hem",
        )

    def test_prompt_safe_rendering_replaces_cinematic_dock_terms(self) -> None:
        rendered = v2.render_prompt_safe_story_facts(
            "金水河雾冷青漫射，湿木栈反出低亮；朱红火印压在藤筐侧面；青盐水挂在鞭梢。"
        )

        self.assertNotIn("冷青漫射", rendered)
        self.assertIn("不作镜面湿面反光", v2.STORYBOARD_LIGHT_LOCK)
        self.assertIn("淡墨留白", rendered)
        self.assertIn("低亮朱砂印记", rendered)
        self.assertIn("淡石青盐水", rendered)

    def test_prompt_safe_rendering_replaces_late_night_cinematic_shortcuts(self) -> None:
        rendered = v2.render_prompt_safe_story_facts(
            "深夜雾气吞没远景，断剑与残卷带旧金冷光，宗门灵舟火印穿雾但不破坏低饱和水墨基调。"
            "深夜斗室内，晏燎掌心余红化成残卷边缘裂痕，末页古字渗出旧金冷光。"
            "宗门灵舟在雾中显形，朱红火印穿破夜色。"
        )

        self.assertIn("淡墨留白退远", rendered)
        self.assertIn("局部旧金薄染", rendered)
        self.assertIn("低亮朱砂印记", rendered)
        self.assertNotIn("吞没远景", rendered)
        self.assertNotIn("旧金冷光", rendered)
        self.assertNotIn("古字", rendered)
        audit = v2.prompt_quality_audit(
            f"【画面】{rendered}【风格锁】{v2.STORYBOARD_STYLE_LOCK}"
            f"【反向约束】{v2.STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}",
            ["scene-viewpoint"],
            None,
        )
        self.assertEqual(audit["status"], "pass")

        cinematic = v2.prompt_quality_audit(
            f"【画面】浓雾覆盖河面，火印穿破夜色，门缝夜风压暗四角。"
            f"【风格锁】{v2.STORYBOARD_STYLE_LOCK}"
            f"【反向约束】{v2.STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}",
            ["scene-viewpoint"],
            None,
        )
        self.assertIn("positive_cinematic_render_language", cinematic["violations"])
        self.assertIn("浓雾覆盖", cinematic["positiveCinematicRenderTerms"])

    def test_prompt_safe_rendering_covers_continuity_action_terms(self) -> None:
        rendered = v2.render_prompt_safe_story_facts(
            "归元断口冷光叠化为塾馆油灯，掌心留下暗红微光，在暗红余光里抬眼。"
        )

        self.assertNotIn("断口冷光", rendered)
        self.assertNotIn("暗红微光", rendered)
        self.assertNotIn("暗红余光", rendered)
        audit = v2.prompt_quality_audit(
            f"【画面】{rendered}【风格锁】{v2.STORYBOARD_STYLE_LOCK}"
            f"【反向约束】{v2.STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS}",
            ["scene-viewpoint"],
            None,
        )
        self.assertNotIn("positive_cinematic_render_language", audit["violations"])

    def test_scene_lighting_contract_has_a_v2_safe_anchor_for_each_chapter_viewpoint(self) -> None:
        expected_viewpoints = {
            "dock-main-axis",
            "inn-hall-counter-axis",
            "inn-room-window-axis",
            "school-lamp-desk-axis",
            "inn-room-night-return",
            "river-night-long-axis",
        }

        self.assertEqual(set(v2.STORYBOARD_SCENE_LIGHTING), expected_viewpoints)
        self.assertIn("不出现塾馆人物", v2.storyboard_scene_lighting("inn-room-night-return"))
        self.assertIn("宗门灵舟轮廓", v2.storyboard_scene_lighting("river-night-long-axis"))

    def test_reference_capability_requires_exact_provider_record_and_preserves_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "capabilities.json"
            path.write_text(json.dumps({
                "schemaVersion": v2.REFERENCE_CAPABILITY_SCHEMA_VERSION,
                "capabilities": [self.verified_capability()],
            }, ensure_ascii=False), encoding="utf-8")
            capability = v2.resolve_reference_capability(
                "mikoto",
                "gpt-image-2",
                ["scene-viewpoint", "canonical"],
                manifest_path=path,
            )
            v2.assert_reference_capability(capability, ["scene-viewpoint", "canonical"])
            with self.assertRaisesRegex(RuntimeError, "超过已验证容量"):
                v2.assert_reference_capability(capability, ["scene-viewpoint", "canonical", "prop-state"])
            prop_capability = self.verified_capability(supported_count=3)
            v2.assert_reference_capability(
                prop_capability,
                ["scene-viewpoint", "canonical", "prop-state"],
            )
            unknown = v2.resolve_reference_capability(
                "other",
                "gpt-image-2",
                ["scene-viewpoint"],
                manifest_path=path,
            )
            with self.assertRaisesRegex(RuntimeError, "未验证"):
                v2.assert_reference_capability(unknown, ["scene-viewpoint"])

    def test_reference_capacity_does_not_claim_provider_native_semantic_roles(self) -> None:
        capability = self.verified_capability()

        v2.assert_reference_capability(capability, ["scene-viewpoint", "canonical"])

        evidence = v2.reference_semantic_role_evidence(capability)
        self.assertEqual(evidence["status"], "unverified")
        self.assertFalse(evidence["providerRoleMetadataSent"])
        self.assertEqual(evidence["bindingMechanism"], "prompt-markers-plus-ordered-images")

    def test_historical_toonflow_provider_cannot_authorize_a_request(self) -> None:
        capability = v2.resolve_reference_capability(
            "toonflow-local-ai",
            "gpt-image-2",
            ["scene-viewpoint"],
        )

        self.assertEqual(capability["status"], "historical-only")
        with self.assertRaisesRegex(RuntimeError, "未验证"):
            v2.assert_reference_capability(capability, ["scene-viewpoint"])

    def test_color_audit_accepts_balanced_mineral_washes_and_writes_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            image_path = Path(temp) / "balanced.png"
            image = Image.new("RGB", (100, 100), "#ece6dc")
            draw = ImageDraw.Draw(image)
            draw.rectangle((0, 0, 39, 99), fill="#22508d")
            draw.rectangle((40, 0, 59, 99), fill="#bd3b2c")
            image.save(image_path)

            report = v2.write_color_audit(image_path)

            self.assertEqual(report["status"], "pass")
            self.assertGreaterEqual(report["chromaticPixelRatio"], 0.30)
            self.assertLessEqual(report["chromaticPixelRatio"], 0.70)
            self.assertTrue(Path(str(report["reportPath"])).is_file())

    def test_color_audit_keeps_single_hue_diagnostics_soft_below_color_forward_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            image_path = Path(temp) / "single-hue.png"
            image = Image.new("RGB", (100, 100), "#ece6dc")
            ImageDraw.Draw(image).rectangle((0, 0, 33, 99), fill="#22508d")
            image.save(image_path)

            report = v2.audit_color(image_path)

            self.assertGreaterEqual(report["chromaticPixelRatio"], 0.30)
            self.assertLess(report["chromaticPixelRatio"], v2.COLOR_FORWARD_RATIO)
            self.assertFalse(report["warmCoolPresent"])
            self.assertNotIn("dominant_hue_ratio", report["failedGates"])
            self.assertNotIn("warm_cool_balance", report["failedGates"])
            self.assertEqual(report["status"], "pass")
            self.assertEqual(report["colorForwardRatio"], 0.45)
            self.assertIn("daojie_gongbi_restyle.py:audit_polychrome_image", report["sourceProvenance"])

    def test_color_audit_rejects_single_hue_at_color_forward_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            image_path = Path(temp) / "single-hue-forward.png"
            image = Image.new("RGB", (100, 100), "#ece6dc")
            ImageDraw.Draw(image).rectangle((0, 0, 49, 99), fill="#22508d")
            image.save(image_path)

            report = v2.audit_color(image_path)

            self.assertGreaterEqual(report["chromaticPixelRatio"], v2.COLOR_FORWARD_RATIO)
            self.assertFalse(report["warmCoolPresent"])
            self.assertIn("dominant_hue_ratio", report["failedGates"])
            self.assertIn("warm_cool_balance", report["failedGates"])
            self.assertEqual(report["status"], "fail")

    def test_reference_color_audit_excludes_paper_margin_for_asset_boards(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            image_path = Path(temp) / "character-board.png"
            image = Image.new("RGB", (100, 100), "#ece6dc")
            draw = ImageDraw.Draw(image)
            draw.rectangle((40, 10, 59, 89), fill="#55504b")
            draw.rectangle((40, 10, 47, 89), fill="#22508d")
            image.save(image_path)

            full_frame = v2.audit_color(image_path)
            reference = v2.audit_reference_color(image_path, "canonical")

            self.assertEqual(full_frame["status"], "fail")
            self.assertIn("chromatic_pixel_ratio_low", full_frame["failedGates"])
            self.assertEqual(reference["status"], "pass")
            self.assertEqual(reference["measurementBasis"], "subject-content")
            self.assertGreaterEqual(reference["contentAreaRatio"], 0.10)
            self.assertGreaterEqual(reference["chromaticPixelRatio"], 0.30)
            self.assertLess(reference["chromaticPixelRatio"], v2.COLOR_FORWARD_RATIO)
            self.assertEqual(reference["fullFrameAudit"]["status"], "fail")

    def test_reference_color_audit_keeps_scene_viewpoints_full_frame(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            image_path = Path(temp) / "scene-board.png"
            image = Image.new("RGB", (100, 100), "#ece6dc")
            draw = ImageDraw.Draw(image)
            draw.rectangle((40, 10, 59, 89), fill="#55504b")
            draw.rectangle((40, 10, 47, 89), fill="#22508d")
            image.save(image_path)

            reference = v2.audit_reference_color(image_path, "scene-viewpoint")

            self.assertEqual(reference["measurementBasis"], "full-frame")
            self.assertEqual(reference["status"], "fail")
            self.assertIn("chromatic_pixel_ratio_low", reference["failedGates"])

    def test_reference_color_audit_keeps_prop_color_diagnostic_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sparse_color_path = root / "sparse-color-prop.png"
            solid_color_path = root / "solid-color-prop.png"

            sparse = Image.new("RGB", (100, 100), "#ece6dc")
            sparse_draw = ImageDraw.Draw(sparse)
            sparse_draw.rectangle((30, 10, 69, 89), fill="#55504b")
            sparse_draw.rectangle((30, 10, 33, 89), fill="#bd3b2c")
            sparse.save(sparse_color_path)

            solid = Image.new("RGB", (100, 100), "#ece6dc")
            ImageDraw.Draw(solid).rectangle((30, 10, 69, 89), fill="#8a5b32")
            solid.save(solid_color_path)

            sparse_reference = v2.audit_reference_color(sparse_color_path, "prop-state")
            solid_reference = v2.audit_reference_color(solid_color_path, "prop-state")

            self.assertLess(sparse_reference["chromaticPixelRatio"], v2.MIN_CHROMATIC_RATIO)
            self.assertGreater(solid_reference["chromaticPixelRatio"], v2.MAX_CHROMATIC_RATIO)
            self.assertEqual(sparse_reference["status"], "pass")
            self.assertEqual(solid_reference["status"], "pass")
            self.assertEqual(sparse_reference["colorGatePolicy"], "diagnostic-only")
            self.assertNotIn("chromatic_pixel_ratio_low", sparse_reference["failedGates"])
            self.assertNotIn("chromatic_pixel_ratio_high", solid_reference["failedGates"])

    def test_v2_approval_checklist_requires_all_human_criteria(self) -> None:
        incomplete = {"linework": True}
        self.assertFalse(v2.is_complete_approved_review_checklist(incomplete))
        complete = {field: True for field in v2.HUMAN_REVIEW_CHECKLIST_FIELDS}
        self.assertTrue(v2.is_complete_approved_review_checklist(complete))


if __name__ == "__main__":
    unittest.main()
