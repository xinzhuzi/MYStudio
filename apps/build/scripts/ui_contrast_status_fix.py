#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ui_contrast_status_fix.py — 状态色(成功/警告/信息)对比度令牌解算/落地/复验(1126).

与 ui_contrast_token_fix.py 同一套路,对象换成 --success / --warning / --info 三组。
这三组颜色在全应用里同时承担两种角色(用法盘点: 绿字 158 处、黄字 165 处、蓝字 12 处,
底色 176 处,零硬编码白字,全部走语义令牌):
  ① 当文字: text-success 压在浅/深底色上;
  ② 当底色: bg-success 承托 --success-foreground。
所以同一枚颜色必须两头都达标,只能动令牌、不动组件。

改前实测(WCAG AA 门槛 4.5):
  亮色: 白字压黄 2.13、黄字压浅底 1.5-1.9、白字压绿 3.33、白字压蓝 2.86;
  暗色: 灰字压绿 1.83、灰字压蓝 2.48(黄色这组已用近黑字,是对的)。

修法(只调亮度,不改色相/饱和度,取离现值最近的达标值):
  亮色: 字保持纯白,底色加深到「当文字压最亮的底也 ≥ 目标」;
  暗色: 字改近黑(同黄色组的既有做法),底色只在必要时微调。

状态色只在 :root 与 .dark 两处定义,各预置主题不单独覆盖;
但每套预置的底色不同,所以要对 14 套主题逐一校验。

用法:
  python3 apps/build/scripts/ui_contrast_status_fix.py              # 解算并打印(不改文件)
  python3 apps/build/scripts/ui_contrast_status_fix.py --apply      # 解算并精确替换 index.css
  python3 apps/build/scripts/ui_contrast_status_fix.py --verify     # 复验(改后的)index.css,全达标退出 0
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CSS_PATH = REPO / "apps/frontend/index.css"

T_SOLVE = 4.65   # 解算目标(4.5 + 余量)
T_VERIFY = 4.60  # 复验下限
T_TINT = 4.50    # 半透明底(徽章 hover、淡底芯片)上的门槛

SEMS = ("success", "warning", "info")
SURFACE_TOKENS = ("--background", "--card", "--popover", "--panel", "--panel-elevated")
LIGHT_PRESETS = ("neutral", "blueprint", "warmPaper", "sageInk", "mist", "porcelain", "lavender")
DARK_PRESETS = ("cinema", "graphite", "midnight", "ink", "ember")
# 前景只在这两种里选:亮色倾向纯白,暗色倾向近黑(与 --warning-foreground 的既有做法一致)
WHITE_HSL = (0.0, 0.0, 100.0)
INK_HSL = (0.0, 0.0, 3.5)


# ─── 颜色数学 ───────────────────────────────────────────────────────────────

def hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    s /= 100.0
    l /= 100.0
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60.0) % 2 - 1))
    m = l - c / 2
    r, g, b = ((c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x))[int(h // 60) % 6]
    return tuple(int(round((v + m) * 255)) for v in (r, g, b))


def _lin(v: int) -> float:
    c = v / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb: tuple[int, int, int]) -> float:
    return 0.2126 * _lin(rgb[0]) + 0.7152 * _lin(rgb[1]) + 0.0722 * _lin(rgb[2])


def ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def mix(fg: tuple[int, int, int], alpha: float, bg: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple(int(round(f * alpha + b * (1 - alpha))) for f, b in zip(fg, bg))


# ─── 解析 index.css ─────────────────────────────────────────────────────────

Token = dict[str, tuple[float, float, float]]
_TOKEN_RE = re.compile(r"(--[\w-]+):\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%")


def _block(css: str, selector: str) -> str:
    m = re.search(selector + r"\s*\{", css)
    if not m:
        return ""
    return css[m.end():css.index("}", m.end())]


def _tokens(body: str) -> Token:
    return {m[0]: (float(m[1]), float(m[2]), float(m[3])) for m in _TOKEN_RE.findall(body)}


def load_themes(css: str) -> dict[str, Token]:
    """14 套主题的最终令牌(基础块 + 预置覆盖)。"""
    root = _tokens(_block(css, r"(?m)^:root"))
    dark = _tokens(_block(css, r"(?m)^\.dark"))
    themes: Token = {"light": dict(root), "dark": dict(dark)}
    for name in LIGHT_PRESETS:
        themes[f"light-{name}"] = {**root, **_tokens(_block(css, rf":root\.theme-preset-{name}:not\(\.dark\)"))}
    for name in DARK_PRESETS:
        themes[f"dark-{name}"] = {**dark, **_tokens(_block(css, rf"\.dark\.theme-preset-{name}"))}
    return themes


# ─── 约束与解算 ─────────────────────────────────────────────────────────────

def worst(tok: Token, sem: str, fg_hsl: tuple[float, float, float], solve_t: float = T_SOLVE) -> tuple[float, str]:
    """该主题下这组状态色的最小对比度与对应约束名。"""
    color = hsl_to_rgb(*tok[f"--{sem}"])
    fg = hsl_to_rgb(*fg_hsl)
    bg = hsl_to_rgb(*tok["--background"])
    checks = {
        "字压底色": (ratio(fg, color), solve_t),
        "字压底色@80%": (ratio(fg, mix(color, 0.8, bg)), T_TINT),
        "当文字压 background": (ratio(color, hsl_to_rgb(*tok["--background"])), solve_t),
        # 本色淡底芯片上放本色字,实测最重用到 /30(黄 8 处、绿 1 处),按 /30 卡
        "当文字压 淡底芯片(本色 30%)": (ratio(color, mix(color, 0.30, bg)), T_TINT),
    }
    for surf in SURFACE_TOKENS:
        if surf in tok:
            checks[f"当文字压 {surf[2:]}"] = (ratio(color, hsl_to_rgb(*tok[surf])), solve_t)
    name, (value, _) = min(checks.items(), key=lambda kv: kv[1][0])
    return value, name


def _passing(base: dict[str, Token], sem: str, fg_hsl: tuple[float, float, float],
             lightness: float, h: float, s: float) -> bool:
    trial = {name: {**tok, f"--{sem}": (h, s, lightness)} for name, tok in base.items()}
    return all(worst(tok, sem, fg_hsl)[0] >= T_VERIFY for tok in trial.values())


def solve_lightness(base: dict[str, Token], sem: str, fg_hsl: tuple[float, float, float],
                    current: float) -> tuple[float, dict[str, tuple[float, str]]]:
    """保持色相/饱和度,找离 current 最近、且全部主题达标的亮度。

    现值配上新前景已经达标就不动亮度(暗色的绿/蓝只需换前景);否则从现值向两侧各扫到
    第一个达标值,取离现值近的那个。
    """
    h, s, _ = next(iter(base.values()))[f"--{sem}"]
    step = 0.1
    if _passing(base, sem, fg_hsl, round(current, 1), h, s):
        chosen = round(current, 1)
    else:
        found: list[float] = []
        for direction in (-1, 1):
            l = round(current, 1)
            while 1.0 <= l <= 99.0:
                l = round(l + direction * step, 1)
                if _passing(base, sem, fg_hsl, l, h, s):
                    found.append(l)
                    break
        if not found:
            raise SystemExit(f"--{sem}: 现值 {fmt((h, s, current))} 配前景 {fg_hsl} 找不到达标亮度")
        chosen = min(found, key=lambda c: abs(c - current))
    trial = {name: {**tok, f"--{sem}": (h, s, chosen)} for name, tok in base.items()}
    return chosen, {name: worst(tok, sem, fg_hsl) for name, tok in trial.items()}


def plan(css: str) -> list[dict]:
    themes = load_themes(css)
    light = {n: t for n, t in themes.items() if not n.startswith("dark")}
    dark = {n: t for n, t in themes.items() if n.startswith("dark")}
    proposals: list[dict] = []
    for group, base, fg_hsl in (("light", light, WHITE_HSL), ("dark", dark, INK_HSL)):
        for sem in SEMS:
            current = next(iter(base.values()))[f"--{sem}"]
            current_fg = next(iter(base.values()))[f"--{sem}-foreground"]
            before = min(worst(t, sem, current_fg)[0] for t in base.values())
            already = min(worst(t, sem, fg_hsl)[0] for t in base.values())
            if already >= T_VERIFY and current_fg == fg_hsl:
                continue
            new_l, detail = solve_lightness(base, sem, fg_hsl, current[2])
            proposals.append({
                "group": group, "sem": sem,
                "old": current, "new": (current[0], current[1], new_l),
                "old_fg": current_fg, "new_fg": fg_hsl,
                "before": before, "after": min(v[0] for v in detail.values()),
                "worst_theme": min(detail, key=lambda n: detail[n][0]),
                "worst_check": min(detail.values(), key=lambda v: v[0])[1],
            })
    return proposals


def fmt(t: tuple[float, float, float]) -> str:
    h, s, l = t
    def num(v: float) -> str:
        return str(int(v)) if float(v).is_integer() else f"{v:g}"
    return f"{num(h)} {num(s)}% {num(l)}%"


def rgb_hex(hsl: tuple[float, float, float]) -> str:
    return "#%02x%02x%02x" % hsl_to_rgb(*hsl)


# ─── 落地与复验 ─────────────────────────────────────────────────────────────

def _line(block_selector: str, token: str, value: tuple[float, float, float]) -> str:
    return f"--{token}: {fmt(value)};"


def apply(css: str, proposals: list[dict]) -> tuple[str, int]:
    changes = 0
    for p in proposals:
        selector = r"(?m)^:root" if p["group"] == "light" else r"(?m)^\.dark"
        for token, old, new in ((f"--{p['sem']}", p["old"], p["new"]),
                                (f"--{p['sem']}-foreground", p["old_fg"], p["new_fg"])):
            if old == new:
                continue
            m = re.search(selector + r"\s*\{", css)
            start, end = m.end(), css.index("}", m.end())
            body = css[start:end]
            pattern = re.compile(rf"(--{re.escape(token[2:])}):\s*{re.escape(fmt(old))};")
            hits = pattern.findall(body)
            if len(hits) != 1:
                raise SystemExit(f"{selector[5:]} 块里 {token}: {fmt(old)} 命中 {len(hits)} 次,拒绝落地")
            body = pattern.sub(lambda mm: f"{mm.group(1)}: {fmt(new)};", body, count=1)
            css = css[:start] + body + css[end:]
            changes += 1
    return css, changes


def verify(css: str) -> list[str]:
    themes = load_themes(css)
    problems: list[str] = []
    for name, tok in themes.items():
        fg_hsl = WHITE_HSL if not name.startswith("dark") else INK_HSL
        for sem in SEMS:
            value, check = worst(tok, sem, fg_hsl)
            threshold = T_TINT if "80%" in check or "淡底" in check else T_VERIFY
            if value < threshold:
                problems.append(f"{name} --{sem}: {check} {value:.2f} < {threshold}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--css", type=Path, default=CSS_PATH)
    ap.add_argument("--apply", action="store_true", help="解算并把结果精确替换进 index.css")
    ap.add_argument("--verify", action="store_true", help="复验(改后的)css,全部达标退出 0")
    args = ap.parse_args()

    css = args.css.read_text(encoding="utf-8")
    if args.verify:
        problems = verify(css)
        if problems:
            print(f"复验未过 {len(problems)} 项:")
            for line in problems:
                print("  " + line)
            return 1
        themes = load_themes(css)
        lows = []
        for name, tok in themes.items():
            fg_hsl = WHITE_HSL if not name.startswith("dark") else INK_HSL
            for sem in SEMS:
                value, check = worst(tok, sem, fg_hsl)
                lows.append((value, name, sem, check))
        lows.sort()
        print(f"复验通过:{len(themes)} 套主题 × {len(SEMS)} 组状态色全部达标(复验下限 {T_VERIFY},淡底 {T_TINT})")
        print("最低五项:")
        for value, name, sem, check in lows[:5]:
            print(f"  {name:16} --{sem:8} {check:24} {value:.2f}")
        return 0

    proposals = plan(css)
    if not proposals:
        print("无需改动:全部已达标。")
        return 0
    print(f"{'组':6} {'令牌':10} {'改前':18} {'改后':18} {'改前最差':>8} {'改后最差':>8}  最差主题/约束")
    for p in proposals:
        print(f"{p['group']:6} --{p['sem']:9} {fmt(p['old']) + ' ' + rgb_hex(p['old']):18} "
              f"{fmt(p['new']) + ' ' + rgb_hex(p['new']):18} {p['before']:8.2f} {p['after']:8.2f}  "
              f"{p['worst_theme']}/{p['worst_check']}")
        if p["old_fg"] != p["new_fg"]:
            print(f"{'':6} --{p['sem']}-foreground  {fmt(p['old_fg']):18} {fmt(p['new_fg']):18}")
    if args.apply:
        css, changes = apply(css, proposals)
        args.css.write_text(css, encoding="utf-8")
        print(f"\n已落地 {changes} 处到 {args.css}")
        problems = verify(css)
        if problems:
            print("落地后复验未过:")
            for line in problems:
                print("  " + line)
            return 1
        print("落地后复验通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
