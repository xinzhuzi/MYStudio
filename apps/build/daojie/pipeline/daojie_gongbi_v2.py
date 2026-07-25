"""Local Daojie gongbi-v2 prompt, capability, and review contracts.

The source art-direction lives in the MA ``ma-imagegen`` skill.  This module
is intentionally self-contained so MYStudio does not depend on that workspace
at runtime while retaining source provenance in every generated report.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from PIL import Image


STYLE_CONTRACT_VERSION = "daojie-gongbi-v2"
PROMPT_AUDIT_VERSION = "daojie-gongbi-v2-prompt-audit-v6"
COLOR_AUDIT_VERSION = "daojie-gongbi-v2-color-audit-v3"
REFERENCE_CAPABILITY_SCHEMA_VERSION = "daojie-reference-capability-v1"
SOURCE_PROVENANCE = (
    "MA/.claude/skills/ma-imagegen/references/"
    "mystudio-daojie-gongbi-style-contract.md"
)
COLOR_AUDIT_SOURCE_PROVENANCE = (
    "MA/.claude/skills/ma-imagegen/scripts/"
    "daojie_gongbi_restyle.py:audit_polychrome_image"
)
REFERENCE_CAPABILITY_MANIFEST = Path(__file__).with_name(
    "daojie_gongbi_v2_reference_capabilities.json"
)

STYLE_REFERENCE_ROLE = "style-reference"
REFERENCE_ROLE_ORDER = (
    "scene-viewpoint",
    "canonical",
    "prop-state",
    "previous-approved-frame",
    STYLE_REFERENCE_ROLE,
)
HUMAN_REVIEW_CHECKLIST_FIELDS = (
    "linework",
    "colorBalance",
    "clothingIntegrity",
    "cleanliness",
    "continuity",
    "text",
    "watermark",
)

# These strings are deliberately GPT-safe: no SD weights and no provider-only
# syntax.  They follow the MA ImageGen static order: medium, color/material,
# then light. Scene facts are added separately by the storyboard builder.
STORYBOARD_MEDIUM_LOCK = (
    "daojie-gongbi-v2：《道劫》2D彩色工笔水墨手绘剧情关键帧；媒介规则优先于参考图中的数字渲染、"
    "光影和材质，参考图只继承角色/场景/道具事实。人物的脸、手、发丝、衣缘、接缝、衣褶、"
    "配饰、器物与建筑边缘先以连续白描和铁线描建立结构，再用透明薄层矿物色分染与罩染；"
    "主体密、背景疏，写意只用于山水、雾气、灵气与远景，不用数字厚涂、宽大明暗块或材质高光塑形。"
    "全员衣物完整可穿，保留整袖口、整下摆和闭合缝线，材质可朴素但不可破损。"
)
STORYBOARD_COLOR_MATERIAL_LOCK = (
    "水墨墨线、淡墨和宣纸留白约占画面60%-70%，可辨彩色必须严格处于30%-70%硬范围内，"
    "本镜目标约30%-40%并形成连续可见色区；"
    "不得把彩色缩成单个小印记、零散像素或局部微光。只用2-3种低饱和矿物色，至少同时包含"
    "一组石青/石绿/靛青/玉青冷色薄染和一组赭石/朱砂/矿物朱/旧金暖色薄染，形成克制但清楚的冷暖关系。"
    "参考图若是灰白、黑白或低饱和，只继承身份、结构和空间事实，不得继承参考图的灰白媒介、综合色量或脏旧滤镜。"
    "天、水、雾与地面不得被单一冷青或灰蓝铺满，成片不得退化为黑白、灰白或单色素描；宣纸/绢本纤维、"
    "矿物颜料颗粒、旧木与藤编须靠线描和薄染区分，旧而不脏。"
)
STORYBOARD_LIGHT_LOCK = (
    "采用均匀平光宣纸照明与纸面散射光，白纸透过色层，阴影轻薄有彩色层次；"
    "雾与潮湿只以淡墨留白、细线和局部薄染表现，不作镜面湿面反光、HDR高光或电影级体积雾。"
    "画面干净、完成度高、无统一脏污滤镜。"
)
STORYBOARD_STYLE_LOCK = " ".join((
    STORYBOARD_MEDIUM_LOCK,
    STORYBOARD_COLOR_MATERIAL_LOCK,
    STORYBOARD_LIGHT_LOCK,
))
DERIVED_ASSET_STYLE_LOCK = (
    "daojie-gongbi-v2：《道劫》彩色工笔资产：先以连续白描和铁线描锁定脸、手、发丝、"
    "衣褶、接缝与器物结构，再以透明薄层矿物色分染与罩染；30%-70%可辨彩色与水墨纸白保持平衡，"
    "使用均匀平光宣纸照明和干净完成度。衣物必须完整可穿，保持整袖口、整下摆和闭合缝线。"
)
STORYBOARD_NEGATIVE_CONSTRAINTS = (
    "禁止写实摄影、3D/CGI、塑料磨皮、赛璐璐平涂、西方油画厚涂、霓虹色、"
    "大块灰面塑形、软体积光、照片级景深、HDR高光、电影级体积雾、镜面湿面反光、"
    "全幅冷青或灰蓝渲染、近黑大面积衣袍或地面、统一纸纹覆盖、脏污噪点、"
    "黑白画、灰白画、单色素描、衣物不完整、断裂衣摆、文字、水印、签名、logo、乱码题字。"
)
STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS = (
    f"{STORYBOARD_NEGATIVE_CONSTRAINTS}禁止高对比漫画动作稿、现代/科幻元素、"
    "白底设定图、三视图、资料卡，以及把剧情分镜画成资产设定页。"
)
STORYBOARD_SCENE_LIGHTING = {
    "dock-main-axis": (
        "金水河傍晚河雾以淡墨留白表现，石青只作局部薄染，赭石余光落在人物脸、手和旧木边缘；"
        "湿木栈以细墨线点出潮湿，不作镜面反光，背景山水以淡墨退远。"
    ),
    "inn-hall-counter-axis": (
        "客栈枯灯以赭石薄染为暖色焦点，门缝夜风使边缘留白收束；铜钱、账册与油布以局部旧金薄染辨识，"
        "室内保持线描可读。"
    ),
    "inn-room-window-axis": (
        "客栈斗室中枯灯赭石薄染与北窗石青薄染并置，床榻、木桌和窗轴以连续线描保持清晰，"
        "均匀纸面光不压暗边角。"
    ),
    "school-lamp-desk-axis": (
        "塾馆油灯的赭石薄染与窗外淡墨雾层并置，孩童面部以连续线描和轻薄阴影保持清晰，"
        "掌心低亮朱砂炭色只作克制焦点。"
    ),
    "inn-room-night-return": (
        "深夜斗室中枯灯与窗外月色只以轻薄石青和赭石薄染表现；床榻、木桌与北窗保持线描可读，"
        "室内以留白收束，不出现塾馆人物。"
    ),
    "river-night-long-axis": (
        "深夜河面与远山之间以淡墨雾层和留白退远，宗门灵舟轮廓保持纸面平光层次，"
        "低亮朱砂火印成为局部焦点。"
    ),
}

MIN_CHROMATIC_RATIO = 0.30
MAX_CHROMATIC_RATIO = 0.70
COLOR_FORWARD_RATIO = 0.45
MIN_HUE_FAMILIES = 1
WARM_XUAN_HUE_MIN = 8
WARM_XUAN_HUE_MAX = 38
WARM_XUAN_SATURATION_MAX = 80
WARM_XUAN_VALUE_MIN = 180
REFERENCE_COLOR_AUDIT_VERSION = "daojie-gongbi-v2-reference-color-audit-v2"
REFERENCE_SUBJECT_COLOR_ROLES = frozenset({"canonical", "prop-state"})
REFERENCE_DIAGNOSTIC_COLOR_ROLES = frozenset({"prop-state"})
MIN_REFERENCE_CONTENT_AREA_RATIO = 0.08
REFERENCE_BACKGROUND_DISTANCE = 24.0
REFERENCE_BACKGROUND_LUMA_DELTA = 20.0

REQUIRED_STYLE_MARKERS = (
    STYLE_CONTRACT_VERSION,
    "媒介规则优先于参考图中的数字渲染",
    "连续白描和铁线描",
    "主体密、背景疏",
    "薄层矿物色分染与罩染",
    "30%-70%",
    "目标约30%-40%",
    "连续可见色区",
    "不得继承参考图的灰白媒介",
    "均匀平光宣纸照明",
    "纸面散射光",
)
CHARACTER_REQUIRED_STYLE_MARKERS = ("衣物完整可穿",)
REFERENCE_REPLACEMENT_PROMPT_VERSION = "daojie-gongbi-v2-reference-replacement-v2"
REFERENCE_REPLACEMENT_MAX_CHARS = 900
REFERENCE_REPLACEMENT_SECTIONS = (
    "主体事实",
    "媒介层级",
    "构图空间",
    "色彩材质",
    "光源",
    "反向约束",
)
REFERENCE_REPLACEMENT_DUPLICATE_DIRECTIVES = (
    "均匀平光宣纸照明",
    "连续白描和铁线描",
    "30%-70%",
    "30%-40%",
    "禁止写实摄影",
    "脏污噪点",
    "镜面湿面反光",
    "衣物完整可穿",
)
STYLE_SECTION_INTERIOR_LEAKS = ("竹窗", "卷轴", "瀑布", "画案")
RAGGED_CLOTHING_PATTERN = re.compile(
    r"(?:褴褛|破衣|破洞衣|碎边衣|ragged|tattered|shredded)",
    re.IGNORECASE,
)
SD_WEIGHT_PATTERN = re.compile(r"\([^()]{1,200}:\s*\d+(?:\.\d+)?\)")
MONOCHROME_GRAY_BLUE_PATTERN = re.compile(
    r"(?:单一|单色|全幅|仅|只有|统一)[^。；，]{0,20}(?:灰蓝|蓝灰)"
    r"|(?:灰蓝|蓝灰)[^。；，]{0,20}(?:单一|单色|全幅|唯一|主色)",
)
UNSCOPED_REFERENCE_INHERITANCE_PATTERN = re.compile(
    r"(?:保持|确保)所有@图(?:N|\d+)[^。；]{0,40}(?:与参考图一致|参考图一致|一致)"
)
LEGACY_SCENE_PALETTE_TERMS = ("灰蓝", "蓝灰", "深灰", "冷青", "仅作小面积")
POSITIVE_CINEMATIC_RENDER_PATTERN = re.compile(
    r"(?:电影(?:级|感|式)?(?:光|雾|质感)?|HDR(?:高光)?|照片级(?:景深|材质)?|"
    r"镜面(?:湿面)?反光|体积雾|全幅(?:冷青|灰蓝|蓝灰)|浓雾(?:覆盖|吞没)|"
    r"(?:雾气|浓雾)吞没(?:远景|背景)|压暗四角|半明半暗|(?:旧金|断口)冷光|"
    r"(?:古字|题字)[^。；，]{0,12}(?:渗出|发光|闪烁)|"
    r"(?:火印|印记)[^。；，]{0,12}(?:穿破夜色|发光|点亮)|"
    r"暗红[^。；，]{0,12}(?:光|发亮))"
)
V2_PROMPT_FACT_REPLACEMENTS = (
    (
        "深夜雾气吞没远景，断剑与残卷带旧金冷光，宗门灵舟火印穿雾但不破坏低饱和水墨基调",
        "深夜远景以淡墨留白退远，断剑与残卷以局部旧金薄染呈现，宗门灵舟火印为低亮朱砂印记；保持水墨与纸白为主、冷暖色区克制清楚",
    ),
    (
        "深夜斗室内，晏燎掌心余红化成残卷边缘裂痕，末页古字渗出旧金冷光",
        "深夜斗室内，晏燎掌心朱砂余温化成残卷边缘裂痕，末页纹路以克制旧金薄染显出",
    ),
    (
        "宗门灵舟在雾中显形，朱红火印穿破夜色",
        "淡墨雾层中现出宗门灵舟轮廓，低亮朱砂火印成为夜色中的局部焦点",
    ),
    (
        "客栈枯灯偏暖，门缝夜风压暗四角，铜钱、账册、油布和断剑以局部旧金冷光提亮",
        "客栈枯灯以赭石薄染为暖色焦点，门缝夜风使边缘留白收束；铜钱、账册、油布和断剑以局部旧金薄染辨识，室内保持线描可读",
    ),
    (
        "塾馆油灯与窗外冷雾交叠，孩童面部半明半暗，掌心暗红只作克制焦点光",
        "塾馆油灯的赭石薄染与窗外淡墨雾层并置，孩童面部以连续线描和轻薄阴影保持清晰，掌心低亮朱砂炭色只作克制焦点",
    ),
    (
        "阴天晨雾中的冷青漫射光，湿石与河面有克制反光",
        "阴天晨雾以淡墨留白与局部石青薄染表现，湿石与河面只以细墨线和淡赭色点出潮湿，不作镜面反光",
    ),
    (
        "金水河雾冷青漫射，湿木栈反出低亮",
        "金水河晨雾以淡墨留白表现，冷青仅作局部薄染；湿木栈以细墨线和淡赭色点出潮湿，不作镜面反光",
    ),
    ("清晨冷色漫射雾光", "清晨淡墨留白雾光，冷青仅作局部薄染"),
    ("河雾从左后方吞来", "河雾以淡墨留白从左后方漫入"),
    ("湿黑木栈", "潮湿旧木栈，以墨线和淡赭薄染表现"),
    ("断口冷光化作塾馆油灯", "断口的旧金薄染在转场中呼应塾馆油灯"),
    ("断口冷光", "断口的旧金薄染"),
    ("油灯照出一排瘦小影子", "油灯下留下一排瘦小身影"),
    ("晏燎掌心皮肉下浮起一点暗红炭光", "晏燎掌心皮肉下浮起一点低亮朱砂炭色"),
    ("暗红微光", "低亮朱砂微色"),
    ("暗红余光", "低亮朱砂余色"),
    ("暗红余温", "朱砂余温"),
    ("朱红火印", "朱红火印仅作低亮朱砂印记，不发光、无霓虹边缘、无文字或logo"),
    ("青盐水", "淡石青盐水"),
    ("一屋破衣湿鞋", "一屋朴素完整短褐与湿鞋"),
    ("孩童破衣湿鞋", "孩童朴素完整短褐与湿鞋"),
    ("破衣湿鞋", "朴素完整短褐与湿鞋"),
    ("褴褛短褐与破旧裤装", "朴素完整短褐与完整旧式裤装"),
    ("褴褛短褐", "朴素完整短褐"),
    ("破旧裤装", "完整旧式裤装"),
    ("破衣", "朴素完整短褐"),
)
V2_NEGATIVE_CLOTHING_REPLACEMENTS = (
    ("极端破衣乞丐装", "衣物不完整或断裂衣摆"),
    ("破衣乞丐装", "衣物不完整或断裂衣摆"),
    ("破洞衣", "衣物不完整"),
    ("碎边衣", "断裂衣摆"),
    ("破衣", "衣物不完整"),
    ("褴褛", "衣物不完整"),
    ("ragged", "incomplete clothing"),
    ("tattered", "incomplete clothing"),
    ("shredded", "incomplete clothing"),
)
V2_SCENE_PALETTE_REPLACEMENTS = (
    ("湿石深灰", "湿石淡墨赭色"),
    ("灰蓝", "石青"),
    ("蓝灰", "玉青"),
    ("深灰", "淡墨赭色"),
    ("冷青", "石青"),
    ("仅作小面积叙事焦点", "形成连续可见的暖色薄染区"),
    ("仅作小面积焦点", "形成连续可见的暖色薄染区"),
    ("仅作小面积点缀", "形成连续可见的暖色薄染区"),
)
INCOMPATIBLE_WARDROBE_VERSIONS = {
    "dock-ragged": (
        "dock-ragged 与 daojie-gongbi-v2 完整衣物合同不兼容；"
        "必须创建非覆盖的完整工装 Bible 版本，禁止只改提示词名称继续复用原图"
    ),
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def style_contract_fingerprint(style_reference_sha256: str | None = None) -> str:
    """Fingerprint every art-direction input that changes V2 continuity."""
    return _sha256({
        "version": STYLE_CONTRACT_VERSION,
        "sourceProvenance": SOURCE_PROVENANCE,
        "storyboardStyleLock": STORYBOARD_STYLE_LOCK,
        "derivedAssetStyleLock": DERIVED_ASSET_STYLE_LOCK,
        "negativeConstraints": STORYBOARD_FRAME_NEGATIVE_CONSTRAINTS,
        "sceneLighting": STORYBOARD_SCENE_LIGHTING,
        "promptAuditVersion": PROMPT_AUDIT_VERSION,
        "promptFactReplacements": V2_PROMPT_FACT_REPLACEMENTS,
        "scenePaletteReplacements": V2_SCENE_PALETTE_REPLACEMENTS,
        "incompatibleWardrobeVersions": INCOMPATIBLE_WARDROBE_VERSIONS,
        "unscopedReferenceInheritancePattern": UNSCOPED_REFERENCE_INHERITANCE_PATTERN.pattern,
        "positiveCinematicRenderPattern": POSITIVE_CINEMATIC_RENDER_PATTERN.pattern,
        "colorAuditVersion": COLOR_AUDIT_VERSION,
        "styleReferenceSha256": style_reference_sha256 or None,
    })


def render_prompt_safe_story_facts(value: str) -> str:
    """Preserve story hardship while rendering V2-safe, intact clothing facts."""
    rendered = str(value or "")
    for legacy, replacement in V2_PROMPT_FACT_REPLACEMENTS:
        rendered = rendered.replace(legacy, replacement)
    return rendered


def render_prompt_wardrobe_version(value: str) -> str:
    return str(value or "").strip()


def render_prompt_safe_wardrobe_version(value: str) -> str:
    """Project an audit-only wardrobe identifier into provider-safe prompt text."""
    wardrobe_version = render_prompt_wardrobe_version(value)
    return "" if wardrobe_version in INCOMPATIBLE_WARDROBE_VERSIONS else wardrobe_version


def render_prompt_safe_scene_palette(value: str) -> str:
    """Keep scene material facts while removing legacy gray-blue art direction."""
    rendered = render_prompt_safe_story_facts(value)
    for legacy, replacement in V2_SCENE_PALETTE_REPLACEMENTS:
        rendered = rendered.replace(legacy, replacement)
    return rendered.strip(" 。；")


def render_prompt_version_identifier(value: str) -> str:
    return str(value or "")


def assert_v2_wardrobe_compatible(value: str) -> None:
    wardrobe_version = str(value or "").strip()
    reason = INCOMPATIBLE_WARDROBE_VERSIONS.get(wardrobe_version)
    if reason:
        raise RuntimeError(reason)


def is_v2_wardrobe_compatible(value: str) -> bool:
    return render_prompt_wardrobe_version(value) not in INCOMPATIBLE_WARDROBE_VERSIONS


def render_prompt_safe_negative_constraints(value: str) -> str:
    rendered = str(value or "")
    for legacy, replacement in V2_NEGATIVE_CLOTHING_REPLACEMENTS:
        rendered = re.sub(re.escape(legacy), replacement, rendered, flags=re.IGNORECASE)
    return rendered


def storyboard_scene_lighting(viewpoint_id: str) -> str:
    return STORYBOARD_SCENE_LIGHTING.get(str(viewpoint_id or "").strip(), "")


def normalize_reference_roles(reference_roles: list[str] | tuple[str, ...] | None) -> list[str]:
    return [str(role or "").strip() for role in reference_roles or []]


def _invalid_capability(reason: str, provider_name: str, model: str) -> dict[str, Any]:
    return {
        "schemaVersion": REFERENCE_CAPABILITY_SCHEMA_VERSION,
        "status": "unverified",
        "providerName": provider_name,
        "model": model,
        "reason": reason,
        "styleReference": {"enabled": False, "sha256": None},
    }


def load_reference_capability_manifest(path: Path | None = None) -> dict[str, Any]:
    manifest_path = path or REFERENCE_CAPABILITY_MANIFEST
    try:
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"分镜参考能力清单不存在: {manifest_path}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"分镜参考能力清单不是合法 JSON: {manifest_path}") from error
    if not isinstance(value, dict) or value.get("schemaVersion") != REFERENCE_CAPABILITY_SCHEMA_VERSION:
        raise RuntimeError(f"分镜参考能力清单 schema 不匹配: {manifest_path}")
    capabilities = value.get("capabilities")
    if not isinstance(capabilities, list):
        raise RuntimeError(f"分镜参考能力清单缺少 capabilities 数组: {manifest_path}")
    return value


def resolve_reference_capability(
    provider_name: str,
    model: str,
    reference_roles: list[str] | tuple[str, ...] | None,
    *,
    manifest_path: Path | None = None,
) -> dict[str, Any]:
    """Select an exact provider/model record; unknown capacity is never inferred."""
    normalized_provider = str(provider_name or "").strip()
    normalized_model = str(model or "").strip()
    roles = normalize_reference_roles(reference_roles)
    manifest = load_reference_capability_manifest(manifest_path)
    matching = [
        item for item in manifest["capabilities"]
        if isinstance(item, dict)
        and item.get("providerName") == normalized_provider
        and item.get("model") == normalized_model
    ]
    if len(matching) != 1:
        return _invalid_capability(
            "没有与当前 provider/model 精确匹配的已验证多参考能力记录",
            normalized_provider,
            normalized_model,
        )
    capability = {**matching[0]}
    capability["schemaVersion"] = REFERENCE_CAPABILITY_SCHEMA_VERSION
    capability["requestedReferenceRoles"] = roles
    capability["fingerprint"] = _sha256({
        key: value
        for key, value in capability.items()
        if key not in {"requestedReferenceRoles", "fingerprint"}
    })
    return capability


def assert_reference_capability(capability: dict[str, Any], reference_roles: list[str] | tuple[str, ...] | None) -> None:
    """Fail before request construction when ordered references lack proof."""
    roles = normalize_reference_roles(reference_roles)
    if capability.get("schemaVersion") != REFERENCE_CAPABILITY_SCHEMA_VERSION:
        raise RuntimeError("分镜参考能力 schema 不匹配")
    if capability.get("status") != "verified":
        raise RuntimeError(f"分镜参考能力未验证: {capability.get('reason') or 'missing evidence'}")
    supported_count = capability.get("supportedReferenceCount")
    if not isinstance(supported_count, int) or supported_count < 1:
        raise RuntimeError("分镜参考能力缺少有效 supportedReferenceCount")
    if len(roles) > supported_count:
        raise RuntimeError(
            f"分镜参考数量 {len(roles)} 超过已验证容量 {supported_count}；不得删除连续性参考以绕过"
        )
    expected_order = capability.get("referenceRoleOrder")
    if expected_order != list(REFERENCE_ROLE_ORDER):
        raise RuntimeError("分镜参考能力缺少受支持的角色顺序声明")
    rank_by_role = {role: index for index, role in enumerate(expected_order)}
    if any(role not in rank_by_role for role in roles):
        raise RuntimeError(f"分镜参考角色不受能力契约支持: {roles}")
    if any(rank_by_role[left] > rank_by_role[right] for left, right in zip(roles, roles[1:])):
        raise RuntimeError(f"分镜参考角色顺序不符合能力契约: {roles}")
    style_reference = capability.get("styleReference")
    has_style_reference = STYLE_REFERENCE_ROLE in roles
    if not isinstance(style_reference, dict):
        raise RuntimeError("分镜参考能力缺少 styleReference 来源记录")
    if has_style_reference:
        sha256 = str(style_reference.get("sha256") or "")
        if style_reference.get("enabled") is not True or re.fullmatch(r"[a-f0-9]{64}", sha256) is None:
            raise RuntimeError("style-reference 未提供经验证的容量与 SHA-256 来源")
        if roles[-1] != STYLE_REFERENCE_ROLE:
            raise RuntimeError("style-reference 必须位于全部连续性参考之后")
    elif style_reference.get("enabled") is True:
        raise RuntimeError("能力契约启用了 style-reference 但请求未提供对应参考")
    evidence = capability.get("evidence")
    if not isinstance(evidence, dict) or not all(str(evidence.get(key) or "").strip() for key in ("kind", "checkedAt", "detail")):
        raise RuntimeError("分镜参考能力缺少可审计 evidence")


def reference_capability_fingerprint(capability: dict[str, Any]) -> str:
    return _sha256({
        key: value
        for key, value in capability.items()
        if key not in {"requestedReferenceRoles", "fingerprint"}
    })


def reference_semantic_role_evidence(capability: dict[str, Any] | None) -> dict[str, Any]:
    evidence = (capability or {}).get("semanticRoleEvidence")
    if not isinstance(evidence, dict):
        return {
            "status": "unverified",
            "providerRoleMetadataSent": False,
            "bindingMechanism": "prompt-markers-plus-ordered-images",
            "detail": "Provider capacity evidence does not prove native reference-role interpretation.",
        }
    return {
        "status": str(evidence.get("status") or "unverified"),
        "providerRoleMetadataSent": evidence.get("providerRoleMetadataSent") is True,
        "bindingMechanism": str(evidence.get("bindingMechanism") or "").strip(),
        "detail": str(evidence.get("detail") or "").strip(),
    }


def extract_prompt_section(prompt: str, section_name: str) -> str:
    pattern = rf"【{re.escape(section_name)}】(.*?)(?=【[^】]+】|$)"
    match = re.search(pattern, str(prompt or ""), re.S)
    return match.group(1).strip() if match else ""


def reference_replacement_prompt_audit(final_prompt: str, asset_kind: str) -> dict[str, Any]:
    """Reject mechanically stacked scene/character replacement prompts."""
    prompt = str(final_prompt or "").strip()
    kind = str(asset_kind or "").strip()
    if kind not in {"scene", "character", "prop"}:
        raise RuntimeError(f"未知参考替换资产类型: {kind}")

    section_counts = {
        section: prompt.count(f"【{section}】")
        for section in REFERENCE_REPLACEMENT_SECTIONS
    }
    unexpected_sections = [
        section
        for section in ("参考继承边界", "光影", "风格锁")
        if f"【{section}】" in prompt
    ]
    duplicate_directives = {
        directive: prompt.count(directive)
        for directive in REFERENCE_REPLACEMENT_DUPLICATE_DIRECTIVES
        if prompt.count(directive) > 1
    }
    negative_heading = "【反向约束】"
    negative_offset = prompt.find(negative_heading)
    negative_is_final = (
        negative_offset >= 0
        and not re.search(r"【[^】]+】", prompt[negative_offset + len(negative_heading):])
    )
    positive_prompt = prompt[:negative_offset] if negative_offset >= 0 else prompt
    subject = extract_prompt_section(prompt, "主体事实")
    color = extract_prompt_section(prompt, "色彩材质")
    positive_texture_terms = [
        term
        for term in ("矿物颜料颗粒", "统一纸纹", "颗粒化做旧", "脏污噪点")
        if term in positive_prompt
    ]
    irrelevant_scene_character_rules = [
        term
        for term in ("人物的脸、手", "衣物完整可穿", "整袖口", "整下摆")
        if kind == "scene" and term in positive_prompt
    ]
    missing_spatial_color_markers = [
        marker
        for marker in ("冷色连续可见区", "暖色连续可见区", "石阶与地面保持淡墨、纸白")
        if kind == "scene" and marker not in color
    ]
    missing_character_clothing_markers = [
        marker
        for marker in CHARACTER_REQUIRED_STYLE_MARKERS
        if kind == "character" and marker not in positive_prompt
    ]

    violations: list[str] = []
    if len(prompt) > REFERENCE_REPLACEMENT_MAX_CHARS:
        violations.append("prompt_too_long")
    if any(count != 1 for count in section_counts.values()):
        violations.append("invalid_prompt_sections")
    if unexpected_sections:
        violations.append("unexpected_prompt_sections")
    if duplicate_directives:
        violations.append("duplicate_prompt_directives")
    if not negative_is_final:
        violations.append("negative_section_not_final")
    if not subject.startswith("输入旧图仅"):
        violations.append("reference_scope_not_leading")
    if positive_texture_terms:
        violations.append("positive_texture_overstack")
    if irrelevant_scene_character_rules:
        violations.append("irrelevant_scene_character_rules")
    if missing_spatial_color_markers:
        violations.append("missing_spatial_color_balance")
    if missing_character_clothing_markers:
        violations.append("missing_character_clothing_integrity")

    return {
        "version": REFERENCE_REPLACEMENT_PROMPT_VERSION,
        "assetKind": kind,
        "promptChars": len(prompt),
        "maximumPromptChars": REFERENCE_REPLACEMENT_MAX_CHARS,
        "sectionCounts": section_counts,
        "unexpectedSections": unexpected_sections,
        "duplicateDirectives": duplicate_directives,
        "negativeSectionFinal": negative_is_final,
        "referenceScopeLeading": subject.startswith("输入旧图仅"),
        "positiveTextureTerms": positive_texture_terms,
        "irrelevantSceneCharacterRules": irrelevant_scene_character_rules,
        "missingSpatialColorMarkers": missing_spatial_color_markers,
        "missingCharacterClothingMarkers": missing_character_clothing_markers,
        "violations": violations,
        "status": "pass" if not violations else "fail",
    }


def assert_reference_replacement_prompt_audit(audit: dict[str, Any]) -> None:
    if audit.get("status") != "pass":
        raise RuntimeError(
            "道劫工笔 V2 参考替换提示词审计失败: "
            + ", ".join(audit.get("violations") or ["unknown"])
        )


def prompt_quality_audit(
    final_prompt: str,
    reference_roles: list[str] | tuple[str, ...] | None,
    capability: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return deterministic V2 violations without deciding image quality."""
    prompt = str(final_prompt or "")
    style_section = " ".join(filter(None, (
        extract_prompt_section(prompt, "风格锁"),
        extract_prompt_section(prompt, "媒介层级"),
        extract_prompt_section(prompt, "色彩材质"),
        extract_prompt_section(prompt, "光源"),
        extract_prompt_section(prompt, "光影"),
    )))
    negative_section = extract_prompt_section(prompt, "反向约束")
    prompt_without_negative_section = prompt.replace(f"【反向约束】{negative_section}", "")
    scene_lock_section = extract_prompt_section(prompt, "场景锁")
    prompt_without_forbidden_phrases = re.sub(
        r"(?:禁止|不得|不作|不要)[^。；，]*",
        "",
        prompt_without_negative_section,
    )
    roles = normalize_reference_roles(reference_roles)
    violations: list[str] = []
    required_style_markers = [
        *REQUIRED_STYLE_MARKERS,
        *(CHARACTER_REQUIRED_STYLE_MARKERS if "canonical" in roles else ()),
    ]
    missing_markers = [marker for marker in required_style_markers if marker not in style_section]
    if missing_markers:
        violations.append("missing_v2_style_markers")
    sd_weight_syntax = bool(SD_WEIGHT_PATTERN.search(prompt))
    if sd_weight_syntax:
        violations.append("sd_weight_syntax")
    positive_dirty_texture = "dirty texture" in prompt_without_negative_section.lower()
    if positive_dirty_texture:
        violations.append("positive_dirty_texture")
    ragged_clothing_terms = sorted(set(RAGGED_CLOTHING_PATTERN.findall(prompt)))
    if ragged_clothing_terms:
        violations.append("ragged_clothing_language")
    incompatible_wardrobe_identifiers = [
        identifier
        for identifier in INCOMPATIBLE_WARDROBE_VERSIONS
        if identifier in prompt_without_negative_section
    ]
    if incompatible_wardrobe_identifiers:
        violations.append("incompatible_wardrobe_identifier")
    legacy_scene_palette_terms = [
        token for token in LEGACY_SCENE_PALETTE_TERMS if token in scene_lock_section
    ]
    if legacy_scene_palette_terms:
        violations.append("legacy_scene_palette_conflict")
    unscoped_reference_inheritance = bool(
        UNSCOPED_REFERENCE_INHERITANCE_PATTERN.search(prompt_without_negative_section)
    )
    if unscoped_reference_inheritance:
        violations.append("unscoped_reference_inheritance")
    global_interior_style_leaks = [token for token in STYLE_SECTION_INTERIOR_LEAKS if token in style_section]
    if global_interior_style_leaks:
        violations.append("global_interior_style_leak")
    monochrome_gray_blue_palette = bool(MONOCHROME_GRAY_BLUE_PATTERN.search(prompt_without_forbidden_phrases))
    if monochrome_gray_blue_palette:
        violations.append("monochrome_gray_blue_palette")
    positive_cinematic_render_terms = sorted(set(POSITIVE_CINEMATIC_RENDER_PATTERN.findall(prompt_without_forbidden_phrases)))
    if positive_cinematic_render_terms:
        violations.append("positive_cinematic_render_language")
    style_reference_provenance = True
    if STYLE_REFERENCE_ROLE in roles:
        try:
            assert_reference_capability(capability or {}, roles)
        except RuntimeError:
            style_reference_provenance = False
            violations.append("invalid_style_reference_provenance")
    return {
        "version": PROMPT_AUDIT_VERSION,
        "styleContractVersion": STYLE_CONTRACT_VERSION,
        "styleContractFingerprint": style_contract_fingerprint(
            ((capability or {}).get("styleReference") or {}).get("sha256")
            if STYLE_REFERENCE_ROLE in roles
            else None
        ),
        "referenceRoles": roles,
        "missingStyleMarkers": missing_markers,
        "hasSdWeightSyntax": sd_weight_syntax,
        "hasPositiveDirtyTexture": positive_dirty_texture,
        "raggedClothingTerms": ragged_clothing_terms,
        "incompatibleWardrobeIdentifiers": incompatible_wardrobe_identifiers,
        "legacyScenePaletteTerms": legacy_scene_palette_terms,
        "hasUnscopedReferenceInheritance": unscoped_reference_inheritance,
        "globalInteriorStyleLeaks": global_interior_style_leaks,
        "hasMonochromeGrayBluePalette": monochrome_gray_blue_palette,
        "positiveCinematicRenderTerms": positive_cinematic_render_terms,
        "hasStyleReferenceProvenance": style_reference_provenance,
        "violations": violations,
        "status": "pass" if not violations else "fail",
    }


def assert_prompt_quality_audit(audit: dict[str, Any]) -> None:
    if audit.get("status") != "pass":
        raise RuntimeError("道劫工笔 V2 提示词审计失败: " + ", ".join(audit.get("violations") or ["unknown"]))


def is_warm_xuan_paper_neutral(hue: int, saturation: int, value: int) -> bool:
    return (
        WARM_XUAN_HUE_MIN <= hue <= WARM_XUAN_HUE_MAX
        and saturation <= WARM_XUAN_SATURATION_MAX
        and value >= WARM_XUAN_VALUE_MIN
    )


def audit_color(image_path: Path) -> dict[str, Any]:
    """Apply the MA ImageGen HSV color gate to one final PNG without mutation."""
    with Image.open(image_path) as opened:
        source_format = opened.format or ""
        source_mode = opened.mode
        source_size = opened.size
        has_alpha = "A" in opened.getbands() or "transparency" in opened.info
        working = opened.convert("RGBA" if has_alpha else "RGB")
    working.thumbnail((192, 192), Image.Resampling.LANCZOS)
    alpha = working.getchannel("A") if working.mode == "RGBA" else None
    image = working.convert("RGB")
    hsv = image.convert("HSV")
    hue_counts = [0] * 12
    chromatic_pixels = 0
    warm_pixels = 0
    cool_pixels = 0
    visible_pixels = 0
    pixel_reader = getattr(hsv, "get_flattened_data", hsv.getdata)
    pixels = pixel_reader()
    if alpha is not None:
        alpha_reader = getattr(alpha, "get_flattened_data", alpha.getdata)
        pixel_rows = zip(pixels, alpha_reader())
    else:
        pixel_rows = ((pixel, 255) for pixel in pixels)
    for (hue, saturation, value), alpha_value in pixel_rows:
        if alpha_value < 16:
            continue
        visible_pixels += 1
        if saturation < 46 or value < 28 or value > 245 or is_warm_xuan_paper_neutral(hue, saturation, value):
            continue
        chromatic_pixels += 1
        family = min(11, int(hue * 12 / 256))
        hue_counts[family] += 1
        degrees = hue * 360 / 256
        if degrees < 75 or degrees >= 330:
            warm_pixels += 1
        if 75 <= degrees < 270:
            cool_pixels += 1
    chromatic_ratio = chromatic_pixels / visible_pixels if visible_pixels else 0.0
    threshold = max(1, round(visible_pixels * 0.02))
    hue_families = sum(count >= threshold for count in hue_counts)
    dominant_hue_ratio = max(hue_counts) / chromatic_pixels if chromatic_pixels else 1.0
    failed_gates: list[str] = []
    if source_format.upper() != "PNG":
        failed_gates.append("format_png")
    if visible_pixels == 0:
        failed_gates.append("visible_pixels")
    if chromatic_ratio < MIN_CHROMATIC_RATIO:
        failed_gates.append("chromatic_pixel_ratio_low")
    if chromatic_ratio > MAX_CHROMATIC_RATIO:
        failed_gates.append("chromatic_pixel_ratio_high")
    if chromatic_ratio >= 0.35 and hue_families < MIN_HUE_FAMILIES:
        failed_gates.append("hue_families")
    if chromatic_ratio >= COLOR_FORWARD_RATIO and dominant_hue_ratio > 0.90:
        failed_gates.append("dominant_hue_ratio")
    if chromatic_ratio >= COLOR_FORWARD_RATIO and not (warm_pixels >= threshold and cool_pixels >= threshold):
        failed_gates.append("warm_cool_balance")
    return {
        "version": COLOR_AUDIT_VERSION,
        "sourceProvenance": COLOR_AUDIT_SOURCE_PROVENANCE,
        "image": str(image_path),
        "status": "fail" if failed_gates else "pass",
        "failedGates": failed_gates,
        "format": source_format,
        "mode": source_mode,
        "width": source_size[0],
        "height": source_size[1],
        "bytes": image_path.stat().st_size,
        "chromaticPixelRatio": round(chromatic_ratio, 4),
        "inkWashRatio": round(1.0 - chromatic_ratio, 4),
        "chromaticBand": [MIN_CHROMATIC_RATIO, MAX_CHROMATIC_RATIO],
        "colorForwardRatio": COLOR_FORWARD_RATIO,
        "hueFamilies": hue_families,
        "dominantHueRatio": round(dominant_hue_ratio, 4),
        "warmCoolPresent": warm_pixels >= threshold and cool_pixels >= threshold,
    }


def _reference_background_rgb(image: Image.Image) -> tuple[int, int, int]:
    inset = max(1, min(image.size) // 50)
    border: list[tuple[int, int, int]] = []
    for x in range(inset, image.width - inset):
        border.extend((image.getpixel((x, inset)), image.getpixel((x, image.height - 1 - inset))))
    for y in range(inset, image.height - inset):
        border.extend((image.getpixel((inset, y)), image.getpixel((image.width - 1 - inset, y))))
    paper = []
    for pixel in border:
        high = max(pixel)
        low = min(pixel)
        saturation = 0 if high == 0 else round((high - low) * 255 / high)
        if saturation < 35 and high > 180:
            paper.append(pixel)
    samples = paper or border
    if not samples:
        return (244, 240, 232)
    middle = len(samples) // 2
    return tuple(sorted(pixel[channel] for pixel in samples)[middle] for channel in range(3))


def _reference_subject_pixels(image_path: Path) -> tuple[list[tuple[int, int, int]], float, tuple[int, int, int] | None]:
    with Image.open(image_path) as opened:
        has_alpha = "A" in opened.getbands() or "transparency" in opened.info
        working = opened.convert("RGBA" if has_alpha else "RGB")
    working.thumbnail((192, 192), Image.Resampling.LANCZOS)
    alpha = working.getchannel("A") if working.mode == "RGBA" else None
    rgb = working.convert("RGB")
    pixel_reader = getattr(rgb, "get_flattened_data", rgb.getdata)
    rgb_pixels = list(pixel_reader())
    if alpha is not None:
        alpha_reader = getattr(alpha, "get_flattened_data", alpha.getdata)
        alpha_pixels = list(alpha_reader())
        subject = [pixel for pixel, alpha_value in zip(rgb_pixels, alpha_pixels) if alpha_value >= 16]
        return subject, len(subject) / max(1, len(rgb_pixels)), None

    background = _reference_background_rgb(rgb)
    background_luma = sum(background) / 3
    distance_limit = REFERENCE_BACKGROUND_DISTANCE ** 2
    subject = []
    for pixel in rgb_pixels:
        distance = sum((pixel[channel] - background[channel]) ** 2 for channel in range(3))
        if distance >= distance_limit or sum(pixel) / 3 <= background_luma - REFERENCE_BACKGROUND_LUMA_DELTA:
            subject.append(pixel)
    return subject, len(subject) / max(1, len(rgb_pixels)), background


def _reference_subject_color_metrics(
    pixels: list[tuple[int, int, int]],
    *,
    enforce_color_gates: bool,
) -> dict[str, Any]:
    visible_pixels = len(pixels)
    hue_counts = [0] * 12
    chromatic_pixels = 0
    warm_pixels = 0
    cool_pixels = 0
    if pixels:
        rgb = Image.new("RGB", (len(pixels), 1))
        rgb.putdata(pixels)
        hsv = rgb.convert("HSV")
        pixel_reader = getattr(hsv, "get_flattened_data", hsv.getdata)
        for hue, saturation, value in pixel_reader():
            if saturation < 46 or value < 28 or value > 245 or is_warm_xuan_paper_neutral(hue, saturation, value):
                continue
            chromatic_pixels += 1
            family = min(11, int(hue * 12 / 256))
            hue_counts[family] += 1
            degrees = hue * 360 / 256
            if degrees < 75 or degrees >= 330:
                warm_pixels += 1
            if 75 <= degrees < 270:
                cool_pixels += 1
    chromatic_ratio = chromatic_pixels / visible_pixels if visible_pixels else 0.0
    threshold = max(1, round(visible_pixels * 0.02))
    hue_families = sum(count >= threshold for count in hue_counts)
    dominant_hue_ratio = max(hue_counts) / chromatic_pixels if chromatic_pixels else 1.0
    failed_gates = []
    if not visible_pixels:
        failed_gates.append("reference_content_pixels")
    warm_cool_present = warm_pixels >= threshold and cool_pixels >= threshold
    if enforce_color_gates:
        if chromatic_ratio < MIN_CHROMATIC_RATIO:
            failed_gates.append("chromatic_pixel_ratio_low")
        if chromatic_ratio > MAX_CHROMATIC_RATIO:
            failed_gates.append("chromatic_pixel_ratio_high")
        if chromatic_ratio >= 0.35 and hue_families < MIN_HUE_FAMILIES:
            failed_gates.append("hue_families")
        if chromatic_ratio >= COLOR_FORWARD_RATIO and dominant_hue_ratio > 0.90:
            failed_gates.append("dominant_hue_ratio")
        if chromatic_ratio >= COLOR_FORWARD_RATIO and not warm_cool_present:
            failed_gates.append("warm_cool_balance")
    return {
        "status": "fail" if failed_gates else "pass",
        "failedGates": failed_gates,
        "visiblePixels": visible_pixels,
        "chromaticPixelRatio": round(chromatic_ratio, 4),
        "inkWashRatio": round(1.0 - chromatic_ratio, 4),
        "chromaticBand": [MIN_CHROMATIC_RATIO, MAX_CHROMATIC_RATIO],
        "colorForwardRatio": COLOR_FORWARD_RATIO,
        "hueFamilies": hue_families,
        "dominantHueRatio": round(dominant_hue_ratio, 4),
        "warmCoolPresent": warm_cool_present,
    }


def audit_reference_color(image_path: Path, reference_role: str) -> dict[str, Any]:
    """Audit asset-board subjects without treating blank xuan paper as subject color."""
    full_frame = audit_color(image_path)
    role = str(reference_role or "").strip()
    if role not in REFERENCE_SUBJECT_COLOR_ROLES:
        return {
            **full_frame,
            "referenceAuditVersion": REFERENCE_COLOR_AUDIT_VERSION,
            "referenceRole": role or None,
            "measurementBasis": "full-frame",
            "colorGatePolicy": "v2-full-frame-hard-band",
            "contentAreaRatio": 1.0,
            "estimatedBackgroundRgb": None,
            "fullFrameAudit": full_frame,
        }

    subject_pixels, content_area_ratio, background = _reference_subject_pixels(image_path)
    diagnostic_only = role in REFERENCE_DIAGNOSTIC_COLOR_ROLES
    metrics = _reference_subject_color_metrics(
        subject_pixels,
        enforce_color_gates=not diagnostic_only,
    )
    failed_gates = list(metrics["failedGates"])
    if content_area_ratio < MIN_REFERENCE_CONTENT_AREA_RATIO:
        failed_gates.append("reference_content_area_low")
    if full_frame.get("format") != "PNG" and "format_png" not in failed_gates:
        failed_gates.insert(0, "format_png")
    return {
        **full_frame,
        **metrics,
        "version": REFERENCE_COLOR_AUDIT_VERSION,
        "sourceProvenance": f"{COLOR_AUDIT_SOURCE_PROVENANCE}+MYStudio/reference-subject-mask-v1",
        "status": "fail" if failed_gates else "pass",
        "failedGates": failed_gates,
        "referenceAuditVersion": REFERENCE_COLOR_AUDIT_VERSION,
        "referenceRole": role,
        "measurementBasis": "subject-content",
        "colorGatePolicy": "diagnostic-only" if diagnostic_only else "v2-subject-hard-band",
        "contentAreaRatio": round(content_area_ratio, 4),
        "estimatedBackgroundRgb": list(background) if background else None,
        "fullFrameAudit": full_frame,
    }


def write_color_audit(image_path: Path) -> dict[str, Any]:
    report = audit_color(image_path)
    report_path = image_path.with_name(f"{image_path.stem}.color-audit.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {**report, "reportPath": str(report_path)}


def normalize_review_checklist(checklist: dict[str, Any] | None) -> dict[str, bool | None]:
    source = checklist or {}
    return {
        field: source.get(field) if isinstance(source.get(field), bool) else None
        for field in HUMAN_REVIEW_CHECKLIST_FIELDS
    }


def is_complete_approved_review_checklist(checklist: dict[str, Any] | None) -> bool:
    normalized = normalize_review_checklist(checklist)
    return all(normalized[field] is True for field in HUMAN_REVIEW_CHECKLIST_FIELDS)
