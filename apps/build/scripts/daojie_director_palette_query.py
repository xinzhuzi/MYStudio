#!/usr/bin/env python3
"""
道劫导演色卡查询工具（H12）
用法:
  python3 daojie_director_palette_query.py --scheme A          # 按光影方案查
  python3 daojie_director_query.py --color C2                  # 按道劫主色查
  python3 daojie_director_palette_query.py --color "#5B8C7A"   # 按HEX查
  python3 daojie_director_palette_query.py --scheme F --top 5  # 大典辉煌场景找导演

输出: Lab色距最小的导演排名, 含色感关键词与道劫层准入提示。
数据源: ~/Downloads/夸克/导演视觉风格色卡整合版_SKILL_整合版_200位/ (不复制进仓库)
"""

import argparse
import glob
import json
import os
import sys

# ── 道劫 C1-C10 色槽 ──
DAOJIE_COLORS = {
    "C1": ("宣纸白", "#F5F0E8"),
    "C2": ("青绿", "#5B8C7A"),
    "C3": ("朱红", "#B8453A"),
    "C4": ("靛蓝", "#2B4570"),
    "C5": ("旧金", "#A8883C"),
    "C6": ("浓墨", "#1A1A1A"),
    "C7": ("淡墨", "#6B6B6B"),
    "C8": ("赭石", "#8B5E3C"),
    "C9": ("暗金", "#7A6528"),
    "C10": ("血红", "#8B1A1A"),
}

# ── A-G 光影方案 → 道劫主色 ──
SCHEME_COLORS = {
    "A": [("C1", 0.5), ("C2", 0.3), ("C7", 0.2)],           # 散光清透
    "B": [("C1", 0.4), ("C2", 0.3), ("C5", 0.3)],            # 仙气浩荡
    "C": [("C8", 0.5), ("C6", 0.3), ("C9", 0.2)],            # 灵火暖影
    "D": [("C4", 0.6), ("C1", 0.4)],                          # 月华冷辉
    "E": [("C1", 0.7), ("C7", 0.3)],                          # 窗纱灵光
    "F": [("C3", 0.4), ("C5", 0.3), ("C6", 0.3)],            # 大典辉煌
    "G": [("C4", 0.5), ("C6", 0.5)],                          # 冷调肃杀
}
SCHEME_NAMES = {
    "A": "散光清透（日常修行/清修悟道）",
    "B": "仙气浩荡（突破/仙道意境）",
    "C": "灵火暖影（丹房/洞府夜修）",
    "D": "月华冷辉（月下悟道/孤修）",
    "E": "窗纱灵光（藏经阁/静室）",
    "F": "大典辉煌（宗门大典/飞升）",
    "G": "冷调肃杀（斗法/心魔/杀劫）",
}

# ── 道劫相关21位导演白名单（速查表已有） ──
RELEVANT_DIRECTORS = {
    "侯孝贤", "沟口健二", "张艺谋", "塔可夫斯基", "今敏", "王家卫", "小津安二郎",
    "汤浅政明", "高畑勋", "米林宏昌", "汤姆·摩尔", "新海诚", "徐克",
    "泰伦斯·马力克", "安东尼·明格拉", "杨凡", "陈凯歌", "毕赣",
    "大卫·芬奇", "李安", "金基德",
}


def hex_to_lab(hex_str: str) -> tuple:
    """HEX → Lab (D65)。"""
    h = hex_str.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"无效 HEX: {hex_str}")
    r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92
    r, g, b = f(r), f(g), f(b)
    X = (0.4124*r + 0.3576*g + 0.1805*b) / 0.95047
    Y = 0.2126*r + 0.7152*g + 0.0722*b
    Z = (0.0193*r + 0.1192*g + 0.9505*b) / 1.08883
    g2 = lambda t: t ** (1/3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = g2(X), g2(Y), g2(Z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab_dist(a: tuple, b: tuple) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def load_all_palettes(base: str) -> list:
    """加载全部200位导演 palette.json。"""
    results = []
    for path in sorted(glob.glob(os.path.join(base, "[01]*_*/[0-9][0-9][0-9]_*/assets/color_palettes/palette.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            name = data.get("director", {}).get("name_zh", "")
            num = data.get("director", {}).get("id", "")
            prim = [c for c in data.get("palette", {}).get("primary", [])
                    if isinstance(c.get("hex"), str) and len(c["hex"].lstrip("#")) == 6]
            if not prim:
                continue
            labs = []
            for c in prim:
                try:
                    labs.append((hex_to_lab(c["hex"]), c.get("ratio", 0)))
                except ValueError:
                    continue
            if not labs:
                continue
            results.append({
                "name": name, "num": num, "path": path,
                "labs": labs,
                "color_kw": data.get("color_keywords", [])[:4],
                "mood_kw": data.get("mood_keywords", [])[:3],
                "relevant": name in RELEVANT_DIRECTORS,
            })
        except (json.JSONDecodeError, OSError):
            continue
    return results


def query(directors: list, query_labs: list, top: int, relevant_only: bool) -> list:
    """对每位导演计算加权 Lab 色距，排名。"""
    scores = []
    for d in directors:
        if relevant_only and not d["relevant"]:
            continue
        # 对每个查询色，找导演最近的原生色，按权重加权
        total = 0
        for q_lab, q_weight in query_labs:
            best = min(lab_dist(q_lab, d_lab) for d_lab, _ in d["labs"])
            total += best * q_weight
        scores.append((total, d))
    scores.sort(key=lambda x: x[0])
    return scores[:top]


def main():
    parser = argparse.ArgumentParser(description="道劫导演色卡查询（Lab色距）")
    parser.add_argument("--scheme", choices=list(SCHEME_COLORS.keys()), help="光影方案 A-G")
    parser.add_argument("--color", help="道劫色槽（C1-C10）或 HEX（#RRGGBB）")
    parser.add_argument("--top", type=int, default=10, help="返回前 N 位（默认10）")
    parser.add_argument("--all", action="store_true", help="查全部200位（默认仅道劫相关21位）")
    parser.add_argument("--base", default=os.path.expanduser(
        "~/Downloads/夸克/导演视觉风格色卡整合版_SKILL_整合版_200位"),
        help="色卡包根目录")
    args = parser.parse_args()

    if not args.scheme and not args.color:
        parser.error("至少指定 --scheme 或 --color")

    # 构建查询色列表 [(lab, weight), ...]
    query_labs = []
    if args.scheme:
        scheme = SCHEME_COLORS[args.scheme]
        for code, weight in scheme:
            hex_val = DAOJIE_COLORS[code][1]
            query_labs.append((hex_to_lab(hex_val), weight))
        print(f"方案 {args.scheme}: {SCHEME_NAMES[args.scheme]}")
        print(f"查询色: {', '.join(f'{DAOJIE_COLORS[c][0]}({c})×{w}' for c, w in scheme)}")
    if args.color:
        c = args.color.upper().lstrip("#")
        if c in DAOJIE_COLORS:
            hex_val = DAOJIE_COLORS[c][1]
            print(f"指定色: {DAOJIE_COLORS[c][0]}({c}) = {hex_val}")
        elif len(c) == 6:
            hex_val = f"#{c}"
            print(f"指定色: {hex_val}")
        else:
            parser.error(f"无效色值: {args.color}（可用 C1-C10 或 #RRGGBB）")
        if not args.scheme:
            query_labs = [(hex_to_lab(hex_val), 1.0)]
        else:
            query_labs.append((hex_to_lab(hex_val), 0.5))

    directors = load_all_palettes(args.base)
    if not directors:
        print("错误: 未加载到任何 palette.json，请检查 --base 路径", file=sys.stderr)
        sys.exit(1)

    scope = "全部200位" if args.all else f"道劫相关{len(RELEVANT_DIRECTORS)}位"
    print(f"搜索范围: {scope}（共加载 {len(directors)} 位）\n")

    results = query(directors, query_labs, args.top, not args.all)

    print(f"{'排名':<4} {'导演':<12} {'色距':<6} {'相关':<4} 色感关键词")
    print("-" * 80)
    for i, (score, d) in enumerate(results, 1):
        rel = "★" if d["relevant"] else ""
        kw = "、".join(d["color_kw"][:3])
        print(f"{i:<4} {d['name']:<12} {score:<6.1f} {rel:<4} {kw}")

    print(f"\n提示: 色感词须经 fusion §六 翻译表换为道劫 C1-C10 写法后方可入提示词。")


if __name__ == "__main__":
    main()
