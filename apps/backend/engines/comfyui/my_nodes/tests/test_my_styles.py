# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyStylesLibrary 契约测试(风格库节点:art_skills 现读,09-15 用户令)。

迷你风格树(tmp_path+MYSTUDIO_ART_SKILLS 注入)锁形状/组装/合并/降级;
真源树(dev 布局)锁发现口径(60 目录/57 开放/展示名/默认风格钉死/2d_gongbi
锚词/90s VARIANT 首行规则)。引擎库零依赖,源码位 sidecar 直跑。
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes import my_styles
from engines.comfyui.my_nodes.nodes.my_styles import MyStylesLibrary

# dev 布局真源:本测试文件 parents[5]=apps → frontend/assets/studio-manuals/art_skills
REPO_ART_SKILLS = (
    Path(__file__).resolve().parents[5] / "frontend" / "assets" / "studio-manuals" / "art_skills"
)


@pytest.fixture(autouse=True)
def _reset_catalog_cache():
    """测试间清模块级目录缓存,免 env 切换后读到上一家的缓存。"""
    my_styles._catalog_cache.update(root=None, mtime=None, names={})
    yield
    my_styles._catalog_cache.update(root=None, mtime=None, names={})


def _make_canon(root: Path, dir_name: str, display: str) -> None:
    style_dir = root / dir_name
    style_dir.mkdir(parents=True)
    # 画廊封面(PIL 1×1):有图才有 &v= 版本号,无图 thumb 无 v 属正态
    try:
        from PIL import Image
        (style_dir / "images").mkdir(exist_ok=True)
        Image.new("RGB", (1, 1)).save(style_dir / "images" / "1.png")
    except ImportError:
        pass
    (style_dir / "prefix.md").write_text(
        f"# 全局美学基础 · {display}\n\n---\n\n"
        "## 二、全局色彩与光影\n\n| 项目 | 约束 |\n|---|---|\n"
        "| 色彩基线 | ink black |\n"
        "| 质量锚定 | (best quality, masterpiece:1.2), (test gongbi:1.3) |\n"
        "| 反向规避 | (worst quality, low quality:1.4), extra bad |\n",
        encoding="utf-8",
    )


@pytest.fixture()
def mini_tree(tmp_path):
    """迷你风格树:1 CANON + 1 VARIANT + 1 排除名单目录。"""
    root = tmp_path / "art_skills"
    _make_canon(root, "mini_canon", "测试工笔")

    variant = root / "mini_variant"
    (variant / "art_prompt").mkdir(parents=True)
    # prefix.md 有 H1 但无行键 → 走 VARIANT 回退
    (variant / "prefix.md").write_text(
        "# 全局美学基础 · 测试水彩\n\n无锚定行的前缀手册。\n", encoding="utf-8")
    # 锚点区=单空行分段内含多行(真源 9 家实际形态):首行=锚点句,
    # 次行=题材专属说明(负向次行含 people 等排除人物项,必须丢弃)
    (variant / "art_prompt" / "art_scene.md").write_text(
        "### 正向质量锚点\n\n测试水彩锚点, hand-drawn texture。\n"
        "第二行题材说明不该进提示词。\n\n"
        "### 反向规避提示词\n\nbad quality, blurry。\npeople, human silhouette。\n",
        encoding="utf-8",
    )

    # 排除名单目录(用真实排除名):内容合法也不得进 combo
    _make_canon(root, "daojie_ink_guofeng", "排除目录")
    return root


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_styles_library():
    assert NODE_CLASS_MAPPINGS.get("MyStylesLibrary") is MyStylesLibrary
    assert MyStylesLibrary.CATEGORY == "my"
    assert NODE_DISPLAY_NAME_MAPPINGS["MyStylesLibrary"] == "漫影 风格库"
    # 设计裁定:此类无存量工作流,不建 Manying 旧名别名
    assert "ManyingStylesLibrary" not in NODE_CLASS_MAPPINGS


# ── 形状:forceInput 锁死(widget 只剩 style 一枚)─────────
def test_input_shape_locks_force_input(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    spec = MyStylesLibrary.INPUT_TYPES()
    assert set(spec["required"]) == {"style"}
    combo = spec["required"]["style"]
    assert isinstance(combo[0], list)
    assert combo[0] == ["测试工笔", "测试水彩"]  # 排除名单目录不在
    assert combo[1]["default"] == "测试工笔"  # DEFAULT_STYLE 不在迷你列表 → sorted 首项
    assert set(spec["optional"]) == {"positive", "negative"}
    for key in ("positive", "negative"):
        slot = spec["optional"][key]
        assert slot[0] == "STRING"
        assert set(slot[1]) == {"forceInput"}  # 多键(default/multiline)会生文本 widget,高危1 修订锁死
        assert slot[1]["forceInput"] is True
    assert MyStylesLibrary.RETURN_TYPES == ("STRING", "STRING")
    assert MyStylesLibrary.RETURN_NAMES == ("positive", "negative")
    assert MyStylesLibrary.FUNCTION == "run"
    assert not hasattr(MyStylesLibrary, "OUTPUT_NODE") or MyStylesLibrary.OUTPUT_NODE is not True


# ── run():CANON 组装+负向合并去重(权重组整 token 保留)──
def test_run_canon_assembly_and_negative_merge(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    positive, negative = MyStylesLibrary().run(
        "测试工笔", positive="a cat", negative="worst quality")
    assert positive == "a cat, (best quality, masterpiece:1.2), (test gongbi:1.3)"
    # 用户段在前、风格段在后;整 token 完全相等才去重:
    # 'worst quality' 与 '(worst quality, low quality:1.4)' 不相等 → 权重组整保留
    assert negative == "worst quality, (worst quality, low quality:1.4), extra bad"
    assert "(worst quality, low quality:1.4)" in negative


def test_run_empty_inputs_output_bare_anchor(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    positive, negative = MyStylesLibrary().run("测试工笔")
    assert positive == "(best quality, masterpiece:1.2), (test gongbi:1.3)"
    assert negative == "(worst quality, low quality:1.4), extra bad"
    positive, negative = MyStylesLibrary().run("测试工笔", positive=None, negative=None)
    assert positive == "(best quality, masterpiece:1.2), (test gongbi:1.3)"


# ── run():VARIANT 只取锚点首行(题材说明/排除人物项丢弃)──
def test_run_variant_takes_first_line_only(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    positive, negative = MyStylesLibrary().run("测试水彩")
    assert positive == "测试水彩锚点, hand-drawn texture。"
    assert "第二行题材说明" not in positive
    assert negative == "bad quality, blurry。"
    assert "people" not in negative
    assert "human silhouette" not in negative


# ── 降级路径:根未找到=占位 combo+中文 RuntimeError ─────────
def test_missing_root_degrades_loudly(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(tmp_path / "nope"))
    assert my_styles.styles_list() == ["(风格库未找到,请重启漫影或检查安装)"]
    combo = MyStylesLibrary.INPUT_TYPES()["required"]["style"]
    assert combo[0] == ["(风格库未找到,请重启漫影或检查安装)"]
    with pytest.raises(RuntimeError, match="风格库"):
        MyStylesLibrary().run("(风格库未找到,请重启漫影或检查安装)")


# ── 自守:未知风格中文 RuntimeError(combo 校验只在浏览器前端)──
def test_unknown_style_raises_plain_language(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    with pytest.raises(RuntimeError, match="未知风格"):
        MyStylesLibrary().run("不存在的风格")


# ── 自守:目录解析失败中文报错+自动跌出 combo ──────────────
def test_unparsable_dir_drops_out_of_combo(tmp_path, monkeypatch):
    root = tmp_path / "art_skills"
    _make_canon(root, "ok_canon", "正常风格")
    broken = root / "broken_dir"
    broken.mkdir()
    (broken / "prefix.md").write_text(
        "# 全局美学基础 · 坏目录\n\n没有锚定行也没有 art_prompt。\n", encoding="utf-8")
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(root))
    assert my_styles.styles_list() == ["正常风格"]
    with pytest.raises(RuntimeError, match="风格目录解析失败"):
        my_styles._parse_anchor(broken)


# ── 路径解析:装机固定位回退(env 未注入时)+ README 兜底展示名 ──
def test_install_fixed_candidates_fallback(mini_tree, monkeypatch):
    monkeypatch.delenv("MYSTUDIO_ART_SKILLS", raising=False)
    monkeypatch.setattr(my_styles, "_INSTALL_FIXED_CANDIDATES", (mini_tree,))
    assert my_styles._resolve_art_skills_root() == mini_tree
    assert my_styles.styles_list() == ["测试工笔", "测试水彩"]


def test_display_name_readme_fallback(tmp_path, monkeypatch):
    root = tmp_path / "art_skills"
    style_dir = root / "readme_only"
    style_dir.mkdir(parents=True)
    # prefix.md 无『# 全局美学基础 ·』H1(但有行键保可解析)→ 兜底 README H1
    (style_dir / "prefix.md").write_text(
        "# 其他标题形态\n\n| 项目 | 约束 |\n|---|---|\n"
        "| 质量锚定 | (best quality:1.2) |\n| 反向规避 | (worst quality:1.4) |\n",
        encoding="utf-8")
    (style_dir / "README.md").write_text(
        "# 测试兜底风格说明\n\n正文。\n", encoding="utf-8")
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(root))
    assert my_styles.styles_list() == ["测试兜底"]  # 剥『风格说明』尾缀


# ── 缓存:根 mtime 失效(手册目录增删即刻可见)──────────────
def test_catalog_mtime_invalidation(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    assert my_styles.styles_list() == ["测试工笔", "测试水彩"]
    _make_canon(mini_tree, "mini_third", "测试第三")
    stat = mini_tree.stat()
    os.utime(mini_tree, ns=(stat.st_atime_ns + 10**9, stat.st_mtime_ns + 10**9))
    assert my_styles.styles_list() == ["测试工笔", "测试水彩", "测试第三"]


# ── 真源树(dev 布局):发现口径+默认风格钉死+锚词组装 ────────
def test_real_tree_discovery_and_dev_layout_resolution(monkeypatch):
    assert REPO_ART_SKILLS.is_dir(), f"dev 布局真源缺失:{REPO_ART_SKILLS}"
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(REPO_ART_SKILLS))
    assert my_styles._resolve_art_skills_root() == REPO_ART_SKILLS

    # 风格发现:60 目录全含 prefix.md;排除 3 家 → 57 开放
    assert sum(1 for d in REPO_ART_SKILLS.iterdir() if d.is_dir()) == 60
    catalog = my_styles._get_catalog(REPO_ART_SKILLS)
    assert len(catalog) == 57
    assert not any(v["dir"] in my_styles._FIRST_PHASE_EXCLUDED for v in catalog.values())
    levels = [v["level"] for v in catalog.values()]
    assert levels.count("canon") == 48
    assert levels.count("variant") == 9

    # 展示名提取:prefix H1 直取,与三工作流 widgets_values 现值逐字一致
    assert catalog["2D工笔风"] == {"dir": "2d_gongbi", "level": "canon"}
    assert catalog["2D水彩"] == {"dir": "2d_watercolor", "level": "canon"}
    assert catalog["90年代日式动画"]["dir"] == "2D_90s_japanese_anime"
    assert catalog["90年代日式动画"]["level"] == "variant"


def test_real_tree_default_style_pinned(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(REPO_ART_SKILLS))
    combo = MyStylesLibrary.INPUT_TYPES()["required"]["style"]
    assert combo[1]["default"] == "2D工笔风"  # 显式钉死(评审残留意见),非 sorted 首项
    assert "2D工笔风" in combo[0]


def test_real_tree_run_gongbi_assembles_manual_anchors(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(REPO_ART_SKILLS))
    positive, negative = MyStylesLibrary().run(
        "2D工笔风", positive="a lady", negative="blurry")
    # 正向=用户词在前+手册质量锚定行原样(09-16 用户裁定锚点中文化)
    assert positive.startswith("a lady, ")
    assert "中国传统工笔画，宣纸设色：1.35" in positive  # 09-16 全角化(用户 GPT-image-2 实证文本)
    assert "完成度高的工笔画" in positive
    # 负向=用户词在前+反向规避行,权重组整 token 保留
    assert negative.startswith("blurry")
    assert "(最差质量,低质量:1.4)" in negative
    assert "泼墨写意" in negative


# ── 工笔基础词定稿冻结(09-16 用户裁定"定稿";改这两行=改契约,须过用户裁定)──
# 09-16 二次裁定(用户贴 GPT-image-2 实证提示词):正向锚定标点全角化(词零改动),X4 实测全角优于半角
FROZEN_GONGBI_POSITIVE = '| 质量锚定 | (中国传统工笔画，宣纸设色：1.35), (精谨线描，细腻墨线，线条细而稳，勾勒精确有韵律：1.28), (层层设色，分染罩染提染，矿物颜料层染过渡细腻：1.2), (石青，石绿，朱砂，赭石，花青，雅致低饱和，强色只作局部点缀：1.15), (东方古典造型，身姿修长端雅，五官清秀，神情含蓄：1.12), (装饰有序，传统纹样精致不堆砌：1.1), (非对称平衡构图，大面积留白，主体精致与留白安静相衬：1.18), (细腻宣纸质感，手绘颜料表面：1.1), 宁静诗意，古雅氛围，完成度高的工笔画 |'
FROZEN_GONGBI_NEGATIVE = '| 反向规避 | (最差质量,低质量:1.4), 厚漫画描边,粗黑轮廓,卡通平涂阴影,现代动漫比例,夸张大眼, 摄影写实,3D渲染,CGI,塑料皮肤, 霓虹色,高饱和荧光色, 过度装饰,纹样堆砌,杂乱构图, 厚重西式油画,水彩晕染,泼墨写意, 做旧扫描感,重纸纹,纸面污渍,泛黄旧底,绢纹织物底,褶皱绉纹,横向条纹,色带, 文字,水印,签名,多余手指,畸形的手 |'


def test_gongbi_base_prompt_frozen(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(REPO_ART_SKILLS))
    text = (REPO_ART_SKILLS / "2d_gongbi" / "prefix.md").read_text(encoding="utf-8")
    assert FROZEN_GONGBI_POSITIVE in text, "工笔基础词(正向)被改动——定稿冻结,改前须过用户裁定"
    assert FROZEN_GONGBI_NEGATIVE in text, "工笔基础词(负向)被改动——定稿冻结,改前须过用户裁定"
    pos, neg = MyStylesLibrary().run("2D工笔风")
    assert "宣纸设色" in pos and "精谨线描" in pos and "非对称平衡构图" in pos
    assert "厚漫画描边" in neg and "绢纹织物底" in neg


def test_real_tree_run_variant_first_line_no_people(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(REPO_ART_SKILLS))
    positive, negative = MyStylesLibrary().run("90年代日式动画")
    assert positive.startswith("90年代日式动画电影质感")
    assert positive.endswith("。")  # 段内原样,中文句号保留
    assert negative.startswith("低质量")  # 09-16 全库中文化后锚点首行为中文
    assert "people" not in negative and "人物" not in negative  # 题材专属排除人物项只在次行,首行规则丢弃


# ── 画廊服务端(09-16:节点内瀑布流选风格)─────────────────
def test_gallery_list_payload_matches_combo(mini_tree, monkeypatch):
    from engines.comfyui.my_nodes import my_styles_server

    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    payload = my_styles_server.list_payload()
    assert payload is not None
    names = [s["name"] for s in payload["styles"]]
    assert names == ["测试工笔", "测试水彩"]  # 与 combo 同源同序(sorted)
    assert payload["count"] == 2
    for item in payload["styles"]:
        # URL 带缓存击穿版本号(&v=<mtime>,09-16 深审:无版本号=浏览器 24h 吐旧图)
        assert item["thumb"].startswith(f"/my_styles/thumb?dir={item['dir']}")
        assert item["level"] in ("canon", "variant")
    with_v = [i for i in payload["styles"] if "&v=" in i["thumb"]]
    assert [i["dir"] for i in with_v] == ["mini_canon"]  # 有封面才有版本号
    assert "mini_variant" not in [i["dir"] for i in payload["styles"] if "&v=" in i["thumb"]]


def test_gallery_list_payload_missing_root(monkeypatch):
    from engines.comfyui.my_nodes import my_styles_server

    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", "/nonexistent/art_skills")
    assert my_styles_server.list_payload() is None


def test_gallery_resolve_thumb_guards(mini_tree, monkeypatch):
    from engines.comfyui.my_nodes import my_styles_server

    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    # 非法形态/不在目录册/合法但无图 → 一律 None(无异常,防穿越不靠报错)
    assert my_styles_server.resolve_thumb("../escape") is None
    assert my_styles_server.resolve_thumb("") is None
    assert my_styles_server.resolve_thumb("mini_canon") is None  # 目录册内但 images/ 无图


def test_gallery_build_thumb_real_gongbi(tmp_path):
    from engines.comfyui.my_nodes import my_styles_server

    src = REPO_ART_SKILLS / "2d_gongbi" / "images" / "1.png"
    if not src.is_file():  # 真源形态漂移时显式失败,不静默跳过
        pytest.fail(f"真源封面缺失:{src}")
    cover = my_styles_server.cover_image(REPO_ART_SKILLS / "2d_gongbi")
    assert cover == src
    out = my_styles_server.build_thumb(src, tmp_path, "2d_gongbi")
    assert out.is_file() and out.suffix == ".jpg"
    assert out.stat().st_size < 200 * 1024  # 320px 缩略图必须显著小于 700KB 原图
    assert my_styles_server.build_thumb(src, tmp_path, "2d_gongbi") == out  # 缓存命中同路径


def test_gallery_thumb_no_cross_style_collision(tmp_path):
    """09-16 实弹事故回归:缓存键曾用 src.parent.name(恒 'images'),
    57 风格全撞一缓存文件→画廊满屏同图。键=风格目录名,各风格各自一档。"""
    from engines.comfyui.my_nodes import my_styles_server

    with_images = sorted(
        d.name for d in REPO_ART_SKILLS.iterdir()
        if d.is_dir() and my_styles_server.cover_image(d) is not None
    )
    assert len(with_images) >= 2
    first, second = with_images[0], with_images[1]
    out_a = my_styles_server.build_thumb(
        my_styles_server.cover_image(REPO_ART_SKILLS / first), tmp_path, first)
    out_b = my_styles_server.build_thumb(
        my_styles_server.cover_image(REPO_ART_SKILLS / second), tmp_path, second)
    assert out_a != out_b and out_a.is_file() and out_b.is_file()
    assert out_a.read_bytes() != out_b.read_bytes()  # 不同风格=不同图


# ── 缓存签名(09-16 战役根修:手册热改穿透引擎输出缓存)────
def test_is_changed_tracks_manual_mtime(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    sig1 = MyStylesLibrary.IS_CHANGED("测试工笔")
    assert isinstance(sig1, str) and "测试工笔" in sig1
    assert MyStylesLibrary.IS_CHANGED("测试工笔") == sig1  # 手册未动=同签名(吃缓存)
    import os, time
    target = mini_tree / "mini_canon" / "prefix.md"
    stamp = target.stat().st_atime
    time.sleep(0.01)
    with open(target, "a", encoding="utf-8") as fh:
        fh.write("\n")
    os.utime(target, (stamp + 5, stamp + 5))  # 显式推 mtime 免文件系统粒度
    assert MyStylesLibrary.IS_CHANGED("测试工笔") != sig1  # 手册动=签名变(重执行)


def test_is_changed_degrades_on_missing(mini_tree, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_ART_SKILLS", str(mini_tree))
    import math
    assert math.isnan(MyStylesLibrary.IS_CHANGED("不存在的风格"))  # 未知风格=恒变
