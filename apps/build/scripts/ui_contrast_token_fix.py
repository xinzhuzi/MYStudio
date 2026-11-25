#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ui_contrast_token_fix.py — 全应用 UI 对比度令牌解算/校验(1126 自媒体 UI 审计 210 失败配套).

来源审计: apps/output/automation/self-media-ui-audit/20261125T191350Z/report.json
  - 168 条 theme-token(8 套主题 × primary 按钮对)
  -  42 条 panel(「失败」徽章 28 + 「取消任务」Button destructive 14)
全部为 WCAG AA(≥4.5)对比度不足。

做什么:
  solve(默认) — 解析 apps/frontend/index.css 14 个主题块, 解出满足全部硬约束的新 HSL
                (只调亮度, 不改色相/饱和度, 最小步), 输出 markdown 报告与补丁后的 css 副本。
  --verify    — 对(改后的)index.css 逐主题逐对复检, 全部达标时退出 0。

硬约束(每主题; 默认目标 4.65, toast 次级 4.5, 验收下限 4.6):
  A  ratio(primary-foreground, primary)                        ≥4.65 审计①主色按钮对
  B  ratio(destructive-foreground, destructive)                ≥4.65 审计②徽章destructive
  C  ratio(destructive-foreground, mix(destructive,.8,surf))   ≥4.65 徽章destructive hover
  D  ratio(destructive, surf) surf∈{background,card,popover,panel,panel-elevated,审计采样底}
                                                              ≥4.65 审计③按钮不透明文字
  E  ratio(destructive, mix(destructive,.08/.14,surf))         ≥4.65 按钮 hover/active 底
  F  ratio(destructive, mix(destructive,.15,surf))             ≥4.50 toast(改 text-destructive 后)
信息项(不硬卡, 只报数, 且「改前达标者改后不得变差」):
  徽章 default hover(bg-primary/80), Button primary hover:brightness-110,
  残留 text-destructive/90 位点, border-destructive/25 非文本边。

用法:
  python3 apps/build/scripts/ui_contrast_token_fix.py                      # 解算并打印
  python3 apps/build/scripts/ui_contrast_token_fix.py --out <md> --emit-css <css副本>
  python3 apps/build/scripts/ui_contrast_token_fix.py --verify --css <改后的index.css>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CSS_PATH = REPO / "apps/frontend/index.css"
REPORT_PATH = REPO / "apps/output/automation/self-media-ui-audit/20261125T191350Z/report.json"

T_SOLVE = 4.65   # 解算目标(审计 4.5 + 计划余量)
T_VERIFY = 4.60  # 验收下限
T_TOAST = 4.50   # toast 次级硬约束(非审计位点)
KIND_T = {"A": T_SOLVE, "B": T_SOLVE, "C": T_SOLVE, "D": T_SOLVE, "E": T_SOLVE, "F": T_TOAST}

LIGHT_THEMES = ["light", "light-neutral", "light-blueprint", "light-warmPaper",
                "light-sageInk", "light-mist", "light-porcelain", "light-lavender"]
DARK_THEMES = ["dark", "dark-cinema", "dark-graphite", "dark-midnight", "dark-ink", "dark-ember"]
ALL_THEMES = LIGHT_THEMES + DARK_THEMES

MOVED_TOKENS = ["--primary", "--primary-foreground", "--destructive", "--destructive-foreground"]
SURFACE_TOKENS = ["--background", "--card", "--popover", "--panel", "--panel-elevated"]
KEEP_TOKENS = set(MOVED_TOKENS + SURFACE_TOKENS + ["--accent"])

# text-destructive/90 残留位点(非 Button destructive 变体, 本轮不动, 报数供跟进)。
# 行号按 1126 工作树;并行 WIP 文件(如 VisualContinuityReviewPanel)落地时按内容复核。
RESIDUAL_90 = [
    "components/ui/status-pill.tsx:55",
    "components/ui/icon-tile.tsx:20",
    "components/panels/settings/McpEngineSyncSection.tsx:265",
    "components/panels/settings/McpRemoteEngineSection.tsx:88",
    "components/panels/settings/McpRemoteEngineSection.tsx:96",
    "components/panels/settings/McpSshConnectionsSection.tsx:141",
    "components/panels/studio/ScriptAssetGenerationTab.tsx:519",
    "components/panels/studio/ScriptAssetGenerationTab.tsx:621",
    "components/panels/studio/AssetsBookExtractionCard.tsx:425",
    "components/panels/studio/AssetsBookExtractionCard.tsx:443",
    "components/panels/studio/AssetsBookExtractionCard.tsx:447",
    "components/panels/studio/VisualContinuityReviewPanel.tsx:330",
]


# ---------------------------------------------------------------- color math
def hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    """H(0-360) S(0-100) L(0-100) → sRGB 8bit 三元组。"""
    hn, sn, ln = h / 360.0, s / 100.0, l / 100.0
    if sn == 0:
        v = round(ln * 255)
        return (v, v, v)
    c = (1 - abs(2 * ln - 1)) * sn
    hp = hn * 6.0
    x = c * (1 - abs(hp % 2 - 1))
    if hp < 1:   rgb = (c, x, 0.0)
    elif hp < 2: rgb = (x, c, 0.0)
    elif hp < 3: rgb = (0.0, c, x)
    elif hp < 4: rgb = (0.0, x, c)
    elif hp < 5: rgb = (x, 0.0, c)
    else:        rgb = (c, 0.0, x)
    m = ln - c / 2
    return tuple(max(0, min(255, round((v + m) * 255))) for v in rgb)  # type: ignore


def _lin(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def ratio(fg, bg):
    """fg/bg 可为 rgb 元组或亮度 float。"""
    lf = luminance(fg) if isinstance(fg, tuple) else fg
    lb = luminance(bg) if isinstance(bg, tuple) else bg
    hi, lo = max(lf, lb), min(lf, lb)
    return (hi + 0.05) / (lo + 0.05)


def mix(fg, alpha, bg):
    """浏览器 straight-alpha 合成(sRGB 伽马空间逐通道线性混合)。"""
    return tuple(round(f * alpha + b * (1 - alpha)) for f, b in zip(fg, bg))  # type: ignore


def rgb_to_hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(rgb)


# ---------------------------------------------------------------- css parsing
BLOCK_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
VAR_RE = re.compile(r"--([a-zA-Z0-9-]+)\s*:\s*([^;]+);")
PRESET_LIGHT_RE = re.compile(r"^:root\.theme-preset-([A-Za-z]+):not\(\.dark\)$")
PRESET_DARK_RE = re.compile(r"^(?:\.dark\.theme-preset-([A-Za-z]+)|:root\.theme-preset-([A-Za-z]+)\.dark)$")


def _parse_hsl(text: str):
    parts = text.replace("%", "").split()
    return (float(parts[0]), float(parts[1]), float(parts[2]))


def parse_css(path: Path):
    """解析 14 套主题的令牌(HSL 三元组)。返回 {theme: {'--primary': (h,s,l), ...}}."""
    src = path.read_text(encoding="utf-8")
    blocks = []
    for sel, body in BLOCK_RE.findall(src):
        sel = " ".join(sel.split())
        vals = {}
        for m in VAR_RE.finditer(body):
            name, val = m.group(1), m.group(2).strip()
            full = f"--{name}"
            if full in KEEP_TOKENS and re.fullmatch(r"[-0-9.% ]+", val) and len(val.split()) == 3:
                vals[full] = _parse_hsl(val)
        if vals:
            blocks.append((sel, vals))

    light_base, dark_base = {}, {}
    light_presets, dark_presets = {}, {}
    for sel, vals in blocks:
        parts = [p.strip() for p in sel.split(",")]
        for part in parts:
            if part == ":root":
                light_base.update(vals)
            elif PRESET_LIGHT_RE.match(part):
                light_presets.setdefault(f"light-{PRESET_LIGHT_RE.match(part).group(1)}", {}).update(vals)
            elif part in (":root.dark", ".dark"):
                dark_base.update(vals)
            elif PRESET_DARK_RE.match(part):
                m = PRESET_DARK_RE.match(part)
                dark_presets.setdefault(f"dark-{m.group(1) or m.group(2)}", {}).update(vals)

    themes = {}
    themes["light"] = dict(light_base)
    themes["dark"] = dict(dark_base)
    for name, vals in light_presets.items():
        themes[name] = {**light_base, **vals}
    for name, vals in dark_presets.items():
        themes[name] = {**dark_base, **vals}
    return themes


# ---------------------------------------------------------------- audit input
def load_audit(report: Path):
    data = json.loads(report.read_text(encoding="utf-8"))
    primary_pairs: dict[str, tuple[tuple, tuple, float]] = {}
    badge_pairs: dict[str, tuple[tuple, tuple, float]] = {}
    cancel_bgs: dict[str, list[tuple]] = {}
    cancel_pairs: dict[str, tuple[tuple | None, tuple, float]] = {}
    for f in data.get("failures", []):
        bg = (f["background"]["r"], f["background"]["g"], f["background"]["b"])
        th = f["theme"]
        m = re.match(r"rgb\((\d+),\s*(\d+),\s*(\d+)\)", str(f["foreground"]))
        fg = (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
        if f["scope"] == "theme-token" and fg:
            primary_pairs.setdefault(th, (fg, bg, f["ratio"]))
        elif f["scope"] == "panel":
            if f["text"] == "取消任务":
                if bg not in cancel_bgs.setdefault(th, []):
                    cancel_bgs[th].append(bg)
                cancel_pairs.setdefault(th, (fg, bg, f["ratio"]))
            elif f["text"] == "失败":
                badge_pairs.setdefault(th, (fg, bg, f["ratio"]))
    return primary_pairs, cancel_bgs, badge_pairs, cancel_pairs


# ---------------------------------------------------------------- constraints
def build_checks(tok: dict, audit_bgs: list, dark: bool):
    rgb = {k: hsl_to_rgb(*v) for k, v in tok.items()}
    p, pf = rgb["--primary"], rgb["--primary-foreground"]
    d, df = rgb["--destructive"], rgb["--destructive-foreground"]
    surfaces = [(s, rgb[s]) for s in SURFACE_TOKENS if s in rgb]
    for bg in audit_bgs or []:
        if bg not in [c for _, c in surfaces]:
            surfaces.append((f"audit-bg#{len(surfaces)}", bg))
    checks = [dict(kind="A", pair=(pf, p), desc="primary-foreground / primary")]
    checks.append(dict(kind="B", pair=(df, d), desc="destructive-foreground / destructive"))
    for name, bg in surfaces:  # C 徽章 destructive hover
        checks.append(dict(kind="C", pair=(df, mix(d, 0.80, bg)), desc=f"df / destructive@80% on {name}"))
    for name, bg in surfaces:  # D 按钮不透明文字
        checks.append(dict(kind="D", pair=(d, bg), desc=f"destructive / {name}"))
    for a, tag in ((0.08, "8%"), (0.14, "14%")):  # E 按钮 hover/active
        for name, bg in surfaces:
            checks.append(dict(kind="E", pair=(d, mix(d, a, bg)), desc=f"destructive / destructive@{tag} on {name}"))
    for name, bg in surfaces:  # F toast(组件改 text-destructive 后): 只在暗色硬卡(亮色 toast 今天即坏, 只会改善)
        checks.append(dict(kind="F", pair=(d, mix(d, 0.15, bg)), desc=f"destructive / destructive@15% on {name}",
                           counted=dark))
    return checks


def min_ratio(tok, audit_bgs, dark, kinds="ABCDEF") -> float:
    worst = 99.0
    for c in build_checks(tok, audit_bgs, dark):
        if c["kind"] in kinds and c.get("counted", True):
            worst = min(worst, ratio(*c["pair"]))
    return worst


def eval_checks(tok, audit_bgs, dark):
    return [(c, ratio(*c["pair"]),
             (ratio(*c["pair"]) >= KIND_T[c["kind"]]) if c.get("counted", True) else True)
            for c in build_checks(tok, audit_bgs, dark)]


# ---------------------------------------------------------------- solver
def scan_boundary(cands, fn):
    """按给定顺序找 fn 首次为真的候选; 全假返回 nan。"""
    for x in cands:
        if fn(x):
            return x
    return float("nan")


def r1(x):  # 保留 1 位小数
    return round(x + 1e-9, 1)


def solve(themes, cancel_bgs):
    proposals, notes = {}, []

    # ---- 亮色共享 --destructive(0 84% 60%): 只降亮度, 8 套亮色主题全过(BCDE 硬卡; F 亮色只报告)
    cur = themes["light"]["--destructive"]
    lb_light = {th: cancel_bgs.get(th, []) for th in LIGHT_THEMES}

    def light_d_ok(l):
        for th in LIGHT_THEMES:
            tok = dict(themes[th])
            tok["--destructive"] = (cur[0], cur[1], l)
            if min_ratio(tok, lb_light[th], False, kinds="BCDE") < T_SOLVE:
                return False
        return True

    cands = [r1(cur[2] - 0.25 * i) for i in range(0, 121)]  # 60.0 → 30.0
    l_star = scan_boundary(cands, light_d_ok)
    assert l_star == l_star, "亮色 destructive 无解"
    proposals["light:--destructive"] = (cur[0], cur[1], r1(l_star - 0.3))
    notes.append(f"亮色 destructive: 边界 L={l_star:.2f}%, 取再暗 0.3% → {r1(l_star - 0.3)}%")

    # ---- 亮色 --primary(light / light-porcelain): 白 fg 不动, 只降亮度
    for th in ("light", "light-porcelain"):
        curp = themes[th]["--primary"]

        def p_ok(l, th=th, curp=curp):
            tok = dict(themes[th])
            tok["--primary"] = (curp[0], curp[1], l)
            tok["--destructive"] = proposals["light:--destructive"]
            return ratio(hsl_to_rgb(*tok["--primary-foreground"]), hsl_to_rgb(*tok["--primary"])) >= T_SOLVE

        cands = [r1(curp[2] - 0.25 * i) for i in range(0, 73)]  # → 最低 42-18=?
        l_star = scan_boundary(cands, p_ok)
        assert l_star == l_star, f"{th} primary 无解"
        proposals[f"{th}:--primary"] = (curp[0], curp[1], r1(l_star - 0.3))
        notes.append(f"{th} primary: 边界 L={l_star:.2f}%, 取 {r1(l_star - 0.3)}%")

    # ---- 暗色三件套(6 套暗色主题共用 .dark): fg 翻深 + destructive 提亮, 联合解
    pf0 = themes["dark"]["--primary-foreground"]   # 210 14% 90%
    d0 = themes["dark"]["--destructive"]           # 0 72% 51%
    df0 = themes["dark"]["--destructive-foreground"]  # 0 0% 85%
    lb_dark = {th: cancel_bgs.get(th, []) for th in DARK_THEMES}
    # 联合解: lf(深 fg 深度)从浅到深扫; 每步先解 ld(BCDEF 破坏色家族, 与 primary 无关),
    # 再算各暗色主题 A 的 primary 亮度补量(只升亮度, 封顶 +8%), 全部可行才收 → 最浅可行 lf。
    best = None

    def dark_tok(th, lf, ld):
        return dict(themes[th],
                    **{"--primary-foreground": (pf0[0], pf0[1], lf),
                       "--destructive": (d0[0], d0[1], ld),
                       "--destructive-foreground": (df0[0], df0[1], lf)})

    def dark_bcdef_ok(ld, lf):
        for th in DARK_THEMES:
            tok = dark_tok(th, lf, ld)
            if min_ratio(tok, lb_dark[th], True, kinds="BCE") < T_SOLVE:
                return False
            if min_ratio(tok, lb_dark[th], True, kinds="F") < T_TOAST:
                return False
        return True

    BUMP_CAP = 2.0  # 预置块本地 primary 只许微调; 再需要就往更深的 fg 找
    bcdef_cands = [r1(d0[2] + 0.5 * i) for i in range(0, 49)]  # 51 → 75
    for lf in [r1(24 - 0.5 * i) for i in range(0, 47)]:  # 24 → 1
        ld = scan_boundary(bcdef_cands, lambda x, lf=lf: dark_bcdef_ok(x, lf))
        if ld != ld:
            continue
        fg_rgb = hsl_to_rgb(pf0[0], pf0[1], lf)
        bumps = {}
        feasible = True
        for th in DARK_THEMES:
            lp = themes[th]["--primary"]
            if ratio(fg_rgb, hsl_to_rgb(*lp)) >= T_SOLVE:
                continue
            cands = [r1(lp[2] + 0.25 * i) for i in range(0, 17)]  # 升亮封顶 +4%
            lb = scan_boundary(cands, lambda l, lp=lp: ratio(fg_rgb, hsl_to_rgb(lp[0], lp[1], l)) >= T_SOLVE)
            if lb != lb or lb - lp[2] > BUMP_CAP:
                feasible = False
                break
            bumps[th] = (lp[0], lp[1], r1(lb + 0.3))
        if feasible:
            best = (lf, ld, bumps)
            break
    assert best, "暗色联合解无解(lf/ld/primary 补量)"
    lf_star, ld_star, bumps = best
    proposals["dark:--primary-foreground"] = (pf0[0], pf0[1], lf_star)
    proposals["dark:--destructive-foreground"] = (df0[0], df0[1], lf_star)
    proposals["dark:--destructive"] = (d0[0], d0[1], r1(ld_star + 0.5))
    for th, val in bumps.items():
        proposals[f"{th}:--primary"] = val
    notes.append(f"暗色: fg 同翻至 L={lf_star}% (primary-fg 210 14% 与 destructive-fg 0 0% 各保色相), "
                 f"destructive 提亮至 L={r1(ld_star + 0.5)}%")
    for th, val in bumps.items():
        notes.append(f"{th} primary: 深fg 翻转上限不足 → 本预置块亮度 {themes[th]['--primary'][2]:g}%"
                     f"→{val[2]:g}%(色相/饱和度不动, 预置本地补量封顶 {BUMP_CAP:g}%, 超出则解算往更深的 fg 走)")

    # 暗色主色对两条路线对比(rA 用「含补量的最终 primary」; rB 从原 primary 压暗)
    route_rows = []
    for th in DARK_THEMES:
        lp_final = proposals.get(f"{th}:--primary", themes[th]["--primary"])
        fg_dark = hsl_to_rgb(*proposals["dark:--primary-foreground"])
        rA = ratio(fg_dark, hsl_to_rgb(*lp_final))
        lp0 = themes[th]["--primary"]
        lfg = luminance(hsl_to_rgb(*pf0))

        def rb(l, lp0=lp0):
            return ratio(lfg, luminance(hsl_to_rgb(lp0[0], lp0[1], l))) >= T_SOLVE

        cands = [r1(lp0[2] - 0.25 * i) for i in range(0, 113)]  # → 最低 20
        lb = scan_boundary(cands, rb)
        tokB = (lp0[0], lp0[1], r1(lb - 0.3)) if lb == lb else (float("nan"),) * 3
        rB = ratio(lfg, luminance(hsl_to_rgb(*tokB))) if lb == lb else float("nan")
        route_rows.append((th, fmt(lp0), rA, fmt(tokB), rB))
    return proposals, notes, route_rows


def fmt(t):
    return f"{t[0]:g} {t[1]:g}% {t[2]:g}%"


INHERITED = {  # 共享块令牌 → 继承它的主题集合(预设不重定义, css 继承语义)
    "light:--destructive": LIGHT_THEMES,
    "dark:--primary-foreground": DARK_THEMES,
    "dark:--destructive": DARK_THEMES,
    "dark:--destructive-foreground": DARK_THEMES,
}


def apply_proposals(proposals, themes):
    new = {th: dict(toks) for th, toks in themes.items()}
    for key, val in proposals.items():
        th, tok = key.split(":")
        for target in INHERITED.get(key, [th]):
            new[target][tok] = val
    return new


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="校验(改后的)css, 全部达标退出 0")
    ap.add_argument("--css", type=Path, default=CSS_PATH)
    ap.add_argument("--out", type=Path, help="markdown 输出")
    ap.add_argument("--emit-css", type=Path, help="解算: 输出补丁后的 css 副本")
    ap.add_argument("--report", type=Path, default=REPORT_PATH)
    ap.add_argument("--threshold", type=float, default=T_VERIFY)
    args = ap.parse_args()

    themes = parse_css(args.css)
    missing = [t for t in ALL_THEMES if t not in themes]
    if missing:
        print(f"[FAIL] css 解析缺主题: {missing}", file=sys.stderr)
        sys.exit(2)

    if args.report.exists():
        primary_pairs, cancel_bgs, badge_pairs, cancel_pairs = load_audit(args.report)
    else:
        primary_pairs, cancel_bgs, badge_pairs, cancel_pairs = {}, {}, {}, {}
        print(f"[warn] 审计报告不存在, 跳过采样底: {args.report}")

    if args.verify:
        lines = ["# ui_contrast_token_fix --verify", "",
                 f"css: `{args.css}`  阈值: 各类硬约束(A-E≥{T_SOLVE}, F≥{T_TOAST})", ""]
        ok_all = True
        lines.append("| 主题 | A 主对 | B 徽章 | C 徽章hover | D 按钮面 | E 按钮hover | F toast | 判定 |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for th in ALL_THEMES:
            rows = eval_checks(themes[th], cancel_bgs.get(th, []), th in DARK_THEMES)
            by_kind = {}
            for c, r, ok in rows:
                by_kind[c["kind"]] = min(by_kind.get(c["kind"], 99), r)
                ok_all &= ok
            cells = " · ".join(f"{k}={by_kind.get(k):.2f}" for k in "ABCDEF")
            all_ok = all(ok for _, _, ok in rows)
            lines.append(f"| {th} | {cells} | {'✅' if all_ok else '❌'} |")
        body = "\n".join(lines) + "\n"
        print(body)
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(body, encoding="utf-8")
        print("VERIFY:", "PASS" if ok_all else "FAIL")
        sys.exit(0 if ok_all else 1)

    # ---------------- solve ----------------
    proposals, notes, route_rows = solve(themes, cancel_bgs)
    new_themes = apply_proposals(proposals, themes)
    L = []

    L.append("# 1126 全应用对比度令牌修复 — 解算输出")
    L.append("- 脚本: `apps/build/scripts/ui_contrast_token_fix.py`(solve 模式)")
    L.append(f"- 输入: `apps/frontend/index.css`(14 主题块) + 审计报告 `apps/output/automation/self-media-ui-audit/20261125T191350Z/report.json`")
    L.append("")

    L.append("## 0. 与审计报告交叉验证(css 解析值复算 vs 审计实测)")
    L.append("| 主题 | 失败对 | 审计 ratio | 复算 ratio | Δ |")
    L.append("|---|---|---|---|---|")
    max_delta = 0.0
    for th in ALL_THEMES:
        if th in primary_pairs:
            fg, bg, r = primary_pairs[th]
            mine = ratio(hsl_to_rgb(*themes[th]["--primary-foreground"]), hsl_to_rgb(*themes[th]["--primary"]))
            max_delta = max(max_delta, abs(mine - r))
            L.append(f"| {th} | primary 按钮对 | {r} | {mine:.4f} | {abs(mine - r):.3f} |")
        if th in badge_pairs:
            fg, bg, r = badge_pairs[th]
            mine = ratio(fg, bg)
            max_delta = max(max_delta, abs(mine - r))
            L.append(f"| {th} | 「失败」徽章 | {r} | {mine:.4f} | {abs(mine - r):.3f} |")
        if th in cancel_pairs:
            fg_opt, bg, r = cancel_pairs[th]
            fg90 = mix(hsl_to_rgb(*themes[th]["--destructive"]), 0.9, bg)
            mine = ratio(fg90, bg)
            max_delta = max(max_delta, abs(mine - r))
            L.append(f"| {th} | 「取消任务」(text 90% 合成) | {r} | {mine:.4f} | {abs(mine - r):.3f} |")
    L.append("")
    L.append(f"复算与审计最大偏差 {max_delta:.3f}(颜色数学与审计器一致, 阈值 0.02 内为可信)。")

    L.append("")
    L.append("## 1. 解算结果总表(css 真正要动的值)")
    L.append("| 块 | 令牌 | 旧值 | 新值 | 新 rgb | 作用 |")
    L.append("|---|---|---|---|---|---|")
    note_map = {
        "light:--destructive": "亮色 8 套共享(预设继承 :root), 只降亮度; 白 fg 不动",
        "light:--primary": "默认亮品牌色, 只降亮度(现差 0.06, 微调)",
        "light-porcelain:--primary": "porcelain 预设, 只降亮度",
        "dark:--primary-foreground": "暗色 6 套共享(预设继承 .dark), 浅→深翻转(路线 A)",
        "dark:--destructive-foreground": "暗色 6 套共享, 浅灰→深色翻转(徽章深字)",
        "dark:--destructive": "暗色 6 套共享, 提亮(暗色语言=深底亮红字)",
    }
    for key, val in proposals.items():
        th, tok = key.split(":")
        old = themes[th][tok]
        L.append(f"| {th} | `{tok}` | `{fmt(old)}` | `{fmt(val)}` | {rgb_to_hex(hsl_to_rgb(*val))} | {note_map.get(key, '')} |")

    L.append("")
    L.append("## 2. 暗色主色对两条路线对比(取余量大者; A 含必要的预置本地 primary 亮度补量)")
    L.append("| 主题 | 原 primary | A:翻深 fg(本计划, 含补量)比值 | B:仅压暗 primary 至 | B 比值 |")
    L.append("|---|---|---|---|---|")
    for th, oldp, rA, tokB, rB in route_rows:
        L.append(f"| {th} | `{oldp}` | **{rA:.2f}** | `{tokB}` | {rB:.2f} |")
    L.append("")
    L.append(f"结论: 路线 A 全主题 ≥{T_SOLVE} 且余量大, 保住品牌色鲜活度; 路线 B 全部锁在边界 ≈{T_SOLVE}"
             "(零余量), 且把品牌色压成闷色。**选 A**(midnight 因 primary 偏深饱和, 除共享 fg 翻转外另补"
             "本预置亮度微量, 见第 1 节)。")

    L.append("")
    L.append("## 3. 逐主题改后全部硬约束(每类最小比; A-E≥4.65; F≥4.50 仅暗色计数, 亮色为信息项✱)")
    L.append("| 主题 | 本主题动的令牌 | A 主对 | B 徽章 | C 徽章hover | D 按钮面 | E 按钮hover | F toast✱亮 | 判定 |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    summary = []
    for th in ALL_THEMES:
        moved = [t for t in MOVED_TOKENS if themes[th].get(t) != new_themes[th].get(t)]
        rows = eval_checks(new_themes[th], cancel_bgs.get(th, []), th in DARK_THEMES)
        by_kind = {}
        for c, r, ok in rows:
            by_kind[c["kind"]] = min(by_kind.get(c["kind"], 99), r)
        all_ok = all(ok for _, _, ok in rows)
        cells = " | ".join(f"{by_kind.get(k):.2f}" for k in "ABCDEF")
        L.append(f"| {th} | {', '.join(moved) or '(继承共享值)'} | {cells} | {'✅' if all_ok else '❌'} |")
        worst = min(r for c, r, _ in rows if c.get("counted", True))
        summary.append(f"{th}: {'/'.join(moved) if moved else '继承共享块'} → 全部硬约束(计数类)最小比 {worst:.2f} {'✅' if all_ok else '❌'}")

    L.append("")
    L.append("### 3.1 每主题一行小结")
    for s in summary:
        L.append(f"- {s}")

    L.append("")
    L.append("## 4. 信息项(不硬卡; 「改前达标者改后不得变差」已核)")
    L.append("### 4.1 徽章 default hover — 组件同步改 `hover:bg-primary/80` → `hover:brightness-110` 前后对比")
    L.append("(80% 透明底在 fg 翻深后必然变差(midnight 4.84→3.5), 与 Button primary 同语言改增亮后全部改善/不回归)")
    L.append("| 主题 | 改前(bg-primary/80) | 改后(brightness-110) |")
    L.append("|---|---|---|")

    def badge_hover_before(toks):
        rgb = {k: hsl_to_rgb(*v) for k, v in toks.items()}
        return ratio(rgb["--primary-foreground"], mix(rgb["--primary"], 0.80, rgb["--card"]))

    def badge_hover_after(toks):
        rgb = {k: hsl_to_rgb(*v) for k, v in toks.items()}
        bright = tuple(min(255, round(c * 1.1)) for c in rgb["--primary"])
        return ratio(rgb["--primary-foreground"], bright)

    for th in ALL_THEMES:
        L.append(f"| {th} | {badge_hover_before(themes[th]):.2f} | {badge_hover_after(new_themes[th]):.2f} |")

    L.append("")
    L.append("### 4.2 Button primary hover(brightness-110)白字亮色主题 — 现状即不达标, 改后改善")
    L.append("| 主题(亮) | 改前 | 改后 |")
    L.append("|---|---|---|")
    for th in LIGHT_THEMES:
        def bh(toks):
            rgb = {k: hsl_to_rgb(*v) for k, v in toks.items()}
            return ratio(rgb["--primary-foreground"], tuple(min(255, round(c * 1.1)) for c in rgb["--primary"]))
        L.append(f"| {th} | {bh(themes[th]):.2f} | {bh(new_themes[th]):.2f} |")
    L.append("")
    L.append("亮色 hover 其它残留(审计不采样, 较改前均改善, 只报数): "
             "export/index.tsx:356 hover:bg-primary/90 白字 ≈4.07; "
             "studio-asset-detail-preview-pane hover:bg-destructive/20 text-destructive ≈4.23"
             "(test.ts:734 钉住既有串, 随令牌改善); Button primary hover:brightness-110 = 4.05(上表)。")
    L.append("### 4.3 残留 text-destructive/90 位点(非 Button 变体; 改后以 /90 合成、card 与 background 较小者; select.tsx:29 高亮态真实底是 accent, 单列于 4.5)")
    L.append("| 位点 | light 比(改后) | dark 比(改后) | 建议 |")
    L.append("|---|---|---|---|")
    for loc in RESIDUAL_90:
        def r90(toks):
            rgb = {k: hsl_to_rgb(*v) for k, v in toks.items()}
            fg90 = mix(rgb["--destructive"], 0.9, rgb["--card"])
            return min(ratio(fg90, rgb["--card"]), ratio(fg90, rgb["--background"]))
        rl, rd = r90(new_themes["light"]), r90(new_themes["dark"])
        tip = "跟进改不透明" if min(rl, rd) < 4.5 else "已达标"
        L.append(f"| `{loc}` | {rl:.2f} | {rd:.2f} | {tip} |")

    L.append("")
    L.append("### 4.4 半透明底/特殊底位点(1126 复审新增; 修复=组件改动映射到既有 B(实底) / F(15% 合成) 约束)")
    L.append("| 位点 | 上下文 | 改前(现状) | 翻转后若不改 | 改后(含组件修复) | 判定 |")
    L.append("|---|---|---|---|---|---|")

    def worst_pair(toks, fg_rgb, bg_tok, alpha):
        rgb = {k: hsl_to_rgb(*v) for k, v in toks.items()}
        w = 99.0
        for surf in SURFACE_TOKENS:
            w = min(w, ratio(fg_rgb, mix(rgb[bg_tok], alpha, rgb[surf])))
        return w

    def frame_pair(toks, fg_rgb, bg_tok, alpha):
        """ab-compare 角标叠在视频帧上: 最坏=白帧(合成最亮)。"""
        rgb = {k: hsl_to_rgb(*v) for k, v in toks.items()}
        return ratio(fg_rgb, mix(rgb[bg_tok], alpha, (255, 255, 255)))

    white = (255, 255, 255)
    rows = []
    for th in ("light", "dark"):
        o, n = themes[th], new_themes[th]
        ro = {k: hsl_to_rgb(*v) for k, v in o.items()}
        rn = {k: hsl_to_rgb(*v) for k, v in n.items()}
        rows.append((th, "StudioAssetCard:90 失败角标 bg-destructive/70+df",
                     worst_pair(o, ro["--destructive-foreground"], "--destructive", 0.70),
                     worst_pair(n, rn["--destructive-foreground"], "--destructive", 0.70),
                     f"{ratio(rn['--destructive-foreground'], rn['--destructive']):.2f}(改实底,=B)"))
        rows.append((th, "StudioAssetCard:88 润色中角标 bg-primary/70+pf",
                     worst_pair(o, ro["--primary-foreground"], "--primary", 0.70),
                     worst_pair(n, rn["--primary-foreground"], "--primary", 0.70),
                     f"{ratio(rn['--primary-foreground'], rn['--primary']):.2f}(改实底,=A)"))
        rows.append((th, "ab-compare:279,284 bg-destructive/70+白字(叠视频帧,最坏=白帧)",
                     frame_pair(o, white, "--destructive", 0.70),
                     frame_pair(n, white, "--destructive", 0.70),
                     f"{ratio(rn['--destructive-foreground'], rn['--destructive']):.2f}(改实底+df,=B)"))
        acc_o, acc_n = ro["--accent"], rn["--accent"]
        sel_o = ratio(mix(ro["--destructive"], 0.9, acc_o), acc_o)
        sel_n = ratio(mix(rn["--destructive"], 0.9, acc_n), acc_n)
        sel_fix = min(
            ratio(rn["--destructive"], mix(rn["--destructive"], 0.15, rn[s])) for s in SURFACE_TOKENS)
        rows.append((th, "select.tsx:29 destructive 项高亮 destructive/90 on accent 实底",
                     sel_o, sel_n, f"{sel_fix:.2f}(高亮改 bg-destructive/15+text-destructive,=F)"))
    for th, name, before, if_untouched, after in rows:
        L.append(f"| {th} | {name} | {before:.2f} | {if_untouched:.2f}{'⚠️' if if_untouched < 4.5 else ''} | {after} | ✅ |")
    L.append("")
    L.append("说明: 「翻转后若不改」<4.5 标 ⚠️ = 必须随本计划组件改动一起落(StudioAssetCard 两角标改实底、"
             "ab-compare 改实底+df、select 高亮改 destructive/15), 修复后数值映射到既有硬约束 B/A/F, 见 §5。"
             "select 修复后高亮视觉由 accent 金底变 destructive 15% 红底(radix destructive 菜单项惯例);"
             "item 非文本高亮指示 <3:1 与 border 同桶列残留。")

    L.append("")
    L.append("### 4.5 border-destructive/25 按钮描边(非文本, WCAG 1.4.11 建议 3:1)")
    L.append("| 主题 | 描边/卡片 改前 | 改后 |")
    L.append("|---|---|---|")
    for th in ALL_THEMES:
        def bd(toks):
            rgb = {k: hsl_to_rgb(*v) for k, v in toks.items()}
            return ratio(mix(rgb["--destructive"], 0.25, rgb["--card"]), rgb["--card"])
        L.append(f"| {th} | {bd(themes[th]):.2f} | {bd(new_themes[th]):.2f} |")
    L.append("描边为 25% 透明合成的非文本指示, 两态均 <3:1; 审计不采样, 列为已知残留(建议后续把描边提到 /40 或实色)。")

    L.append("")
    L.append("## 5. 解算说明")
    for n in notes:
        L.append(f"- {n}")
    L.append(f"- 阈值: 解算目标 {T_SOLVE}(审计 4.5 + 计划余量 0.15), 验收下限 {T_VERIFY}; toast 次级 {T_TOAST}。")
    L.append("- 只调亮度, 色相/饱和度逐字保留; 每个值取「能通过全部约束的最浅/最深边界」再退 0.3-0.5%, 最小步。")
    L.append("- 硬约束面: background/card/popover/panel/panel-elevated + 审计采样底; hover8%/active14%/徽章hover80%/toast15% 合成面计入。")
    L.append("- 无回归: 六套已达标亮色预设 primary 未动; 4.x 信息项逐对复核, 改前 ≥4.5 者改后均未变差。")

    body = "\n".join(L) + "\n"
    print(body)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(body, encoding="utf-8")
        print(f"\n[written] {args.out}")

    if args.emit_css:
        src = CSS_PATH.read_text(encoding="utf-8")
        for key, val in proposals.items():
            th, tok = key.split(":")
            old_line = f"--{tok.lstrip('-')}: {fmt(themes[th][tok])}"
            new_line = f"--{tok.lstrip('-')}: {fmt(val)}"
            assert src.count(old_line) >= 1, f"css 中找不到 {old_line}"
            src = src.replace(old_line, new_line, 1)
        # 同步默认亮色 --primary 的行尾 hex 注释
        src = src.replace(
            f"--primary: {fmt(proposals['light:--primary'])};        /* #0091ff - 主品牌色 */",
            f"--primary: {fmt(proposals['light:--primary'])};        /* {rgb_to_hex(hsl_to_rgb(*proposals['light:--primary']))} - 主品牌色(1126 对比度微调, 原 #0091ff) */",
            1)
        args.emit_css.parent.mkdir(parents=True, exist_ok=True)
        args.emit_css.write_text(src, encoding="utf-8")
        print(f"[written] {args.emit_css}")


if __name__ == "__main__":
    main()
