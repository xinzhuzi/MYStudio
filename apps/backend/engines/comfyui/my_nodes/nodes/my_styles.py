# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""风格库节点:art_skills 现读替换 easy stylesSelector(09-15 用户令)。

漫影风格库真源(60 目录=apps/frontend/assets/studio-manuals/art_skills,
装机=Resources/studio-manuals/art_skills)磁盘现读:combo=展示名列表
(启动惰性扫描+根 mtime 失效,画布 R 键刷新即见增删);正/负词组装=
用户输入拼接手册锚定段/反向规避段(顶层逗号切分合并,权重组内逗号
不切开)。run() 每次重读手册原文,单文件热改即时生效。

形态对齐旧 easy stylesSelector:positive/negative forceInput 占 slot0/1,
style 纯 widget 恒单条 widgets_values;输出 STRING 双出逐槽同名同型。
"""

from __future__ import annotations

import os
import re
from pathlib import Path

# 第一期不开放的目录(显式名单钉死:dev 60-2=58=装机 60-2,两环境 combo 恒同)。
# 09-22 方案C:daojie_ink_guofeng 解除排除(装机打包同步解禁,与运行时编译器
# daojie-prompt-contract.ts 的双写风险用户已接受),风格库下拉唯一道劫条目=它
# (原「道劫·新中式」轻量预设卡并入后删除);3D_guofeng_cyber / realpeople_modern_city
# =手册异构,锚点语义未经人工定稿。
_FIRST_PHASE_EXCLUDED = frozenset({
    "3D_guofeng_cyber",
    "realpeople_modern_city",
})

# 默认风格显式钉死+存在性校验(不在列表回落 sorted 首项)——它是 object_info
# 校验面与对拍脚本的静默回退值,不允许漂移(09-15 设计评审残留意见裁定)。
DEFAULT_STYLE = "2D工笔风"

_ROOT_MISSING_COMBO = ["(风格库未找到,请重启漫影或检查安装)"]

# 装机固定位(env 未注入时按序取第一个 is_dir;dev 不猜路径,靠 env 注入/手动 export)
_INSTALL_FIXED_CANDIDATES = (
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills"),
    Path.home() / "Applications" / "漫影工作室.app"
    / "Contents" / "Resources" / "studio-manuals" / "art_skills",
)

_PREFIX_H1 = re.compile(r"^# 全局美学基础 · (.+?)\s*$", re.M)
_README_H1 = re.compile(r"^# (.+?)\s*$", re.M)
_CANON_POSITIVE_ROW = re.compile(r"^\|\s*质量锚定\s*\|(.+?)\|\s*$", re.M)
_CANON_NEGATIVE_ROW = re.compile(r"^\|\s*反向规避\s*\|(.+?)\|\s*$", re.M)
# README 兜底展示名剥尾缀,按长到短尝试
_README_TITLE_SUFFIXES = (" 通用风格说明", "风格 说明", "风格说明")

# 模块级目录缓存(展示名 → {"dir": 目录名, "level": "canon"|"variant"}),
# 键=根路径+根 mtime;INPUT_TYPES 每次调用比对失效重扫。
_catalog_cache: dict = {"root": None, "mtime": None, "names": {}}


def _resolve_art_skills_root():
    """四层候选链:env 显式覆盖 → 装机固定位 → None。

    env 已设置但路径不存在=响亮降级返回 None(显式覆盖失效不偷偷兜底,
    免得测试/定制环境静默读到别家的风格库);env 未注入才探测装机固定位。
    dev 仓库位置任意不做探测,一律靠 env 注入(engine_manager launch_env
    先例)或开发者手动 export。
    """
    env = os.environ.get("MYSTUDIO_ART_SKILLS")
    if env:
        path = Path(env)
        return path if path.is_dir() else None
    for candidate in _INSTALL_FIXED_CANDIDATES:
        if candidate.is_dir():
            return candidate
    return None


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _display_name(style_dir: Path):
    """展示名:prefix.md H1『# 全局美学基础 · X』首选,README.md 首个 H1
    剥尾缀兜底;两处都拿不到返回 None(该目录跌出 combo)。"""
    prefix = style_dir / "prefix.md"
    if prefix.is_file():
        match = _PREFIX_H1.search(_read_text(prefix))
        if match:
            return match.group(1).strip()
    readme = style_dir / "README.md"
    if readme.is_file():
        match = _README_H1.search(_read_text(readme))
        if match:
            name = match.group(1).strip()
            for suffix in _README_TITLE_SUFFIXES:
                if name.endswith(suffix):
                    name = name[: -len(suffix)]
                    break
            return name.strip() or None
    return None


def _section_first_line(text: str, title: str):
    """锚点标题后至下一 ##/### 标题前取首个非空物理行(09-15 实读修正:
    真源 9 家 VARIANT 锚点区均为单空行分段内含多行——锚点句=首行,以中文
    句号结尾;次行起=题材专属说明,负向次行含 people/human silhouette 等
    排除人物项,无条件注入会灾难性抵消人物图,故只取首行、显式丢弃其余,
    句内中文标点原样保留)。"""
    match = re.search(r"^#{2,3}\s*" + re.escape(title) + r"\s*$", text, re.M)
    if not match:
        return None
    rest = text[match.end():]
    next_heading = re.search(r"^#{2,3}\s", rest, re.M)
    if next_heading:
        rest = rest[: next_heading.start()]
    for line in rest.split("\n"):
        line = line.strip()
        if line:
            return line
    return None


def _parse_anchor(style_dir: Path):
    """风格目录 → (正向锚定段, 反向规避段, 解析级别)。

    两级来源:①CANON(prefix.md 『全局色彩与光影』表『质量锚定』/
    『反向规避』行,按行键解析不按行号);②VARIANT 回退(art_prompt/
    art_scene.md 锚点段首行)。两级都拿不到抛中文 RuntimeError 指明目录
    与缺什么——combo 校验只在浏览器前端,桥/API 直发与存量画布可携带
    任意字符串,run 侧必须自守。"""
    prefix = style_dir / "prefix.md"
    if prefix.is_file():
        text = _read_text(prefix)
        positive = _CANON_POSITIVE_ROW.search(text)
        negative = _CANON_NEGATIVE_ROW.search(text)
        if positive and negative:
            return positive.group(1).strip(), negative.group(1).strip(), "canon"
    scene = style_dir / "art_prompt" / "art_scene.md"
    if scene.is_file():
        text = _read_text(scene)
        positive = _section_first_line(text, "正向质量锚点")
        negative = _section_first_line(text, "反向规避提示词")
        if positive and negative:
            return positive, negative, "variant"
        missing = "『正向质量锚点』" if not positive else "『反向规避提示词』"
        raise RuntimeError(
            f"风格目录解析失败:「{style_dir.name}」art_prompt/art_scene.md "
            f"缺{missing}锚点段,请检查手册目录 art_skills/ 是否被改动")
    raise RuntimeError(
        f"风格目录解析失败:「{style_dir.name}」prefix.md 缺『质量锚定/反向规避』"
        "行且 art_prompt/art_scene.md 无锚点段,请检查手册目录 art_skills/ 是否被改动")


def _scan_catalog(root: Path) -> dict:
    """扫描开放风格:凡含 prefix.md 的目录为候选(排除名单外);解析失败
    的目录自动跌出 combo;展示名重名拼「展示名(目录名)」防御。"""
    by_name: dict[str, list] = {}
    for entry in sorted(os.listdir(root)):
        style_dir = root / entry  # 目录名保持原样做路径拼接(macOS FS 大小写不敏感,原样最稳)
        if entry in _FIRST_PHASE_EXCLUDED or not style_dir.is_dir():
            continue
        if not (style_dir / "prefix.md").is_file():
            continue
        try:
            _parse_anchor(style_dir)
        except (RuntimeError, OSError):
            continue
        name = _display_name(style_dir)
        if not name:
            continue
        by_name.setdefault(name, []).append(entry)
    catalog: dict[str, dict] = {}
    for name, entries in by_name.items():
        for dir_name in entries:
            key = name if len(entries) == 1 else f"{name}({dir_name})"
            level = _parse_anchor(root / dir_name)[2]
            catalog[key] = {"dir": dir_name, "level": level}
    return catalog


def _get_catalog(root: Path) -> dict:
    """目录缓存读取:根 mtime 变化即重扫(手册目录增删即刻可见)。"""
    try:
        mtime = root.stat().st_mtime
    except OSError:
        mtime = None
    cache = _catalog_cache
    if cache["root"] == root and cache["mtime"] == mtime:
        return cache["names"]
    try:
        names = _scan_catalog(root)
    except OSError:
        names = {}
    cache["root"], cache["mtime"], cache["names"] = root, mtime, names
    return names


def styles_list() -> list:
    """combo 值=开放展示名 sorted;根未找到(或扫出空)返回占位单条,
    保节点可上画布不炸。"""
    root = _resolve_art_skills_root()
    if root is None:
        return list(_ROOT_MISSING_COMBO)
    return sorted(_get_catalog(root)) or list(_ROOT_MISSING_COMBO)


def _split_top_level_tokens(text: str) -> list:
    """按顶层逗号切分;( [ { 深度内的逗号不切——权重组如
    (worst quality, low quality:1.4) 必须整 token 保留。"""
    tokens: list[str] = []
    buffer: list[str] = []
    depth = 0
    for char in text:
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        if char == "," and depth == 0:
            tokens.append("".join(buffer))
            buffer = []
        else:
            buffer.append(char)
    tokens.append("".join(buffer))
    return [token.strip() for token in tokens if token.strip()]


def _merge_negative(user_text: str, style_text: str) -> str:
    """用户负向在前、风格规避段在后;仅整 token 完全相等才去重(保守,
    不做子串/语义归并),重组 ", " 连接。任一侧为空=裸输出另一侧。"""
    merged: list[str] = []
    seen: set[str] = set()
    tokens = _split_top_level_tokens(user_text) + _split_top_level_tokens(style_text)
    for token in tokens:
        if token not in seen:
            seen.add(token)
            merged.append(token)
    return ", ".join(merged)


class MyStylesLibrary:
    """漫影风格库:style 下拉选风格,手册锚定段注入正/负 STRING 双出。"""

    CATEGORY = "my"

    @classmethod
    def INPUT_TYPES(cls):
        names = styles_list()
        if DEFAULT_STYLE in names:
            default = DEFAULT_STYLE
        elif names:
            default = names[0]
        else:
            default = ""
        return {
            "required": {"style": (names, {"default": default})},
            # forceInput(原生 INPUT_TYPES 键,驼峰):前端不为两输入建文本
            # widget,节点 widget 只剩 style 一枚,widgets_values 恒单条
            # [展示名]——对拍脚本位置式单条对齐的前提,勿加 multiline/default。
            "optional": {
                "positive": ("STRING", {"forceInput": True}),
                "negative": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, style, positive=None, negative=None):
        """手册热改须穿透引擎输出缓存(09-16 调教战役实弹:节点读外部文件
        不进输入哈希,同输入重跑像素全同,手册改动被缓存吞——战役期间靠
        全角空格扰动续命,此为根修)。返回手册文件 mtime 签名:手册动=
        签名变=重执行;未动=同签名=正常吃缓存。"""
        root = _resolve_art_skills_root()
        if root is None:
            return float("nan")
        entry = _get_catalog(root).get(style)
        if entry is None:
            return float("nan")
        style_dir = root / entry["dir"]
        parts = [str(style)]
        for rel in ("prefix.md", "art_prompt/art_scene.md", "README.md"):
            try:
                parts.append(str((style_dir / rel).stat().st_mtime_ns))
            except OSError:
                parts.append("x")
        return ":".join(parts)

    def run(self, style, positive=None, negative=None):
        root = _resolve_art_skills_root()
        if root is None:
            raise RuntimeError(
                "漫影风格库(art_skills)未找到:已尝试 MYSTUDIO_ART_SKILLS 环境变量与 "
                "/Applications、~/Applications 下 漫影工作室.app/Contents/Resources/"
                "studio-manuals/art_skills。请确认漫影工作室安装完整,或设置环境变量 "
                "MYSTUDIO_ART_SKILLS 指向仓库 apps/frontend/assets/studio-manuals/art_skills")
        catalog = _get_catalog(root)
        entry = catalog.get(style)
        if entry is None:
            raise RuntimeError(
                f"未知风格:「{style}」。风格库现共 {len(catalog)} 个可选风格,"
                "请在画布重新选择风格下拉,或检查手册目录 art_skills/ 是否被改动")
        # 每次重读手册原文(单文件 2-4KB),热改即时生效
        anchor_positive, anchor_negative, _ = _parse_anchor(root / entry["dir"])
        user_positive = (positive or "").strip()
        user_negative = (negative or "").strip()
        out_positive = (
            f"{user_positive}, {anchor_positive}" if user_positive else anchor_positive)
        return (out_positive, _merge_negative(user_negative, anchor_negative))
