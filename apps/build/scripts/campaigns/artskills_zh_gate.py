#!/usr/bin/env python3
"""art_skills 全库中文化战役·结构门禁(09-16 用户令)。

对翻译后的全库做确定性校验,任一不过即退出码 1:
  G1 名册守恒:开放风格展示名集合与基线完全一致(增删/改名=丢风格)
  G2 解析级守恒:每风格 canon/variant 与基线一致(翻译弄坏锚点行会致级漂移)
  G3 H1 守恒:每风格 prefix.md H1 展示名与基线一致
  G4 锚点非空:全部开放风格正/负锚点可解析且非空
  G5 分隔符纪律(09-16 用户裁定「统一全角化」后拆两半):
     『质量锚定』行=全角纪律(紧邻逗号/冒号全角,组分隔符 ), ( ASCII;
      节点顶层切分只认 ASCII 逗号,全角化不影响装配;实证全角优于半角)
     『反向规避』行=ASCII 纪律不变(负向权重组走节点 ASCII 冒号识别)
  G6 残句抽查:两行内不得残留「3 个及以上连续英文单词且非白名单术语」
     的明显未翻译片段(白名单=常见精确美术词,防误杀)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps" / "backend"))

from engines.comfyui.my_nodes.nodes import my_styles  # noqa: E402

if len(sys.argv) > 1:  # world.run 传不了 env,argv 显式指根(repo 真源)
    import os
    os.environ["MYSTUDIO_ART_SKILLS"] = sys.argv[1]

BASE_JSON = Path(__file__).resolve().parent / ".artskills_zh_baseline.json"

# 精确美术词白名单(词根匹配,大小写不敏感):保留英文不算残留
ART_TERMS = re.compile(
    r"gongbi|cel[- ]?shad|bokeh|low[- ]?poly|PBR|ray[- ]?trac|anisotrop|"
    r"art nouveau|bauhaus|deco|ukiyo[- ]?e|manga|anime|chibi|mecha|"
    r"3D|2D|CGI|VFX|HDR|SFX|LoRA|pixel|vaporwave|cyberpunk|steampunk|"
    r"gothic|baroque|rococo|impressionis|expressionis|surrealis|minimalis|"
    r"watercolor|oil painting|gouache|tempera|linework|brushwork|"
    r"flat[- ]?wash|negative space|render|shading|palette|silhouette|"
    r"out of focus|low[- ]?key|high[- ]?key|super deformed|stick figure|"
    r"rubber hose|voxel|sprite|webtoon|shonen|shojo|moe|grain|deformed|"
    r"hand[- ]?drawn|character design|body proportion|facial features|"
    r"daily life|daily setting|cel animation|comic book|movie still", re.I)


def anchor_rows(style_dir: Path):
    rows = {}
    prefix = style_dir / "prefix.md"
    if not prefix.is_file():
        return rows
    for line in prefix.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.lstrip()
        for key in ("质量锚定", "反向规避"):
            if stripped.startswith(f"| {key} |"):
                rows[key] = stripped
    return rows


def main() -> int:
    baseline = json.loads(BASE_JSON.read_text(encoding="utf-8"))
    root = my_styles._resolve_art_skills_root()
    if root is None:
        print("G0 art_skills 根未找到", file=sys.stderr)
        return 1
    catalog = my_styles._get_catalog(root)
    failures: list[str] = []

    # G1 名册守恒
    base_names, now_names = set(baseline), set(catalog)
    if base_names != now_names:
        failures.append(f"G1 名册漂移:丢={sorted(base_names - now_names)} 增={sorted(now_names - base_names)}")

    for name in sorted(base_names & now_names):
        base = baseline[name]
        entry = catalog[name]
        style_dir = root / entry["dir"]
        # G2 解析级
        if entry["level"] != base["level"]:
            failures.append(f"G2 {name}: level {base['level']}→{entry['level']}")
        # G3 H1
        prefix = style_dir / "prefix.md"
        h1 = ""
        if prefix.is_file():
            m = my_styles._PREFIX_H1.search(prefix.read_text(encoding="utf-8", errors="replace"))
            h1 = m.group(1).strip() if m else ""
        if h1 != base["h1"]:
            failures.append(f"G3 {name}: H1 「{base['h1']}」→「{h1}」")
        # G4 锚点非空
        try:
            pos, neg = my_styles.MyStylesLibrary().run(name)
            if not pos.strip() or not neg.strip():
                failures.append(f"G4 {name}: 锚点空")
        except Exception as error:
            failures.append(f"G4 {name}: 解析异常 {error}")
            continue
        # G5/G6 两行纪律
        rows = anchor_rows(style_dir)
        for key, row in rows.items():
            # 09-16 用户裁定「统一全角化」:『质量锚定』行改为全角纪律
            # (逗号→，(紧邻非空格时)/冒号→：,组分隔符 ), ( 保持 ASCII;
            #  实证=X 系消融全角优于半角,工笔先例 e309ef5);『反向规避』
            # 行维持 ASCII 纪律(无裁定,负向权重组 (…:1.4) 走节点 ASCII
            # 冒号识别路径不动)。
            if key == "质量锚定":
                cell = row.split("|", 2)[-1]
                if ":" in cell:
                    failures.append(f"G5 {name}·{key}: 残留ASCII冒号(应全角)")
                for c in re.finditer(r",(?![ ])", cell):
                    failures.append(
                        f"G5 {name}·{key}: 残留紧邻ASCII逗号 …{cell[max(0,c.start()-6):c.start()+6]}…")
            elif "，" in row or "：" in row:
                failures.append(f"G5 {name}·{key}: 含全角逗号/冒号")
            # G6:切出非白名单的英文三连词
            text = row.split("|", 2)[-1]
            for frag in re.findall(r"[A-Za-z][A-Za-z\-']+(?:\s+[A-Za-z][A-Za-z\-']*){3,}", text):
                if not ART_TERMS.search(frag):
                    failures.append(f"G6 {name}·{key}: 疑似未译片段 「{frag.strip()[:60]}」")
                    break

    # G7 注入源语言:组装终词(纯锚点)不得残留 4+ 连英文词(白名单外)
    for name in sorted(base_names & now_names):
        try:
            pos, neg = my_styles.MyStylesLibrary().run(name)
        except Exception:
            continue  # G4 已记
        for label, text in (("正向", pos), ("负向", neg)):
            hit = False
            for frag in re.findall(r"[A-Za-z][A-Za-z\-']+(?:\s+[A-Za-z][A-Za-z\-']*){3,}", text):
                if not ART_TERMS.search(frag):
                    failures.append(f"G7 {name}·{label}: 注入词残留英文 「{frag.strip()[:60]}」")
                    hit = True
                    break

    if failures:
        print(f"门禁未过({len(failures)} 项):")
        for f in failures[:60]:
            print("  ✗", f)
        return 1
    print(f"过门: 名册 {len(catalog)} 风格全守恒,锚点全可解析,两行纪律净")
    return 0


if __name__ == "__main__":
    sys.exit(main())
