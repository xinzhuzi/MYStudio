#!/usr/bin/env python3
"""三工作流风格节点迁移:easy stylesSelector → MyStylesLibrary(09-15 用户令:风格从 art_skills 现读)。

背景:旧方案=easy stylesSelector 读引擎家 ComfyUI-Easy-Use/styles/MY_风格.json(手工维护,
与前端手册语言分叉致工笔画风跑偏,且不随包分发);新节点 MyStylesLibrary(my_nodes/nodes/
my_styles.py)启动惰性扫描 apps/frontend/assets/studio-manuals/art_skills/(装机=Resources/
studio-manuals/art_skills),combo=57 展示名,正/负词由 prefix.md 质量锚定行+反向规避行拼装。

手术对象(均 easy stylesSelector,保 id/位置/尺寸/outputs 连线零改动):
  · K2-文生图-超集.json  [60] 预设 2D工笔风(2d_gongbi)
  · K2-文生图.json       [52] 预设 2D工笔风(2d_gongbi)
  · K2-图生图.json       [38] 预设 2D水彩(2d_watercolor)
逐节点:①type→MyStylesLibrary;②properties→{"Node name for S&R"}(清 aux_id/ver/ue_properties);
③inputs 四槽→两槽(positive slot0/negative slot1 原 link 照抄;style 为纯 widget 不占槽,旧
styles/select_styles 两 widget 槽整条删除,三家实测均未连线);④widgets_values→[展示名]恒单条;
⑤widgets_values_named→{"style": 展示名}(评审 09-15 改法 a:不整删——p2_duipai_run.py 的
ui_to_api_t2i 按 linked→named→default 三源取值且无位置式回退,整删 named 会让 style 恒落
object_info default,画布改风格后对拍仍打默认风格=静默脱钩;残留旧键 styles/select_styles
还会触发其 leftover 门 RuntimeError。改写为新键后 named 源直取画布实选值);
⑥title 去「48风格」字样;⑦说明卡文案同步(超集 66 速查卡+文生图 62 Note)。

历史分叉如实记录(非本次引入):文生图52/图生图38 旧 wvn 存 Krea 社区风格值(styles 键),
若前端优先 named 渲染,画布实选=Krea 风格而非标题宣称的 2D工笔风/2D水彩;本迁移收敛到
漫影风格库预设属修正而非无损。

门(不过即退出码 1,不写盘):目标节点形态 / wvn=={"style":展示名} / 值∈art_skills 实测
展示名集合 / 三 json 零 easy stylesSelector+零 MY_风格 / links 双向一致+悬空线零 /
三条 showAnything 风格预览支线 wired / last_node_id·last_link_id==max。

幂等:新态重跑零 diff。与 manying_superset_negative_prompt.py(步骤8 已同步改写)收敛态
一致,互跑皆稳。执行序敏感点:从旧态出发只跑改后超集脚本会产出 type 仍 easy
stylesSelector+widgets_values 单条的中间红态(styles combo 列表是文件名集合,不含
「2D工笔风」→前端 value not in list),须以本脚本至少跑过一次为收敛条件。
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
K2 = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像"
ART_SKILLS = REPO / "apps/frontend/assets/studio-manuals/art_skills"

# 与 my_nodes/nodes/my_styles.py 同口径:装机被 electron-builder.yml 排除/手册异构的 3 家
EXCLUDED_DIRS = {"daojie_ink_guofeng", "3D_guofeng_cyber", "realpeople_modern_city"}

NEW_TYPE = "MyStylesLibrary"

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def node(d: dict, nid: int) -> dict:
    hits = [n for n in d["nodes"] if n["id"] == nid]
    if not hits:
        raise SystemExit(f"节点 {nid} 不存在")
    return hits[0]


# ---------------- art_skills 展示名实测(与 my_styles.py 解析规则同口径) ----------------

def _display_name(d: Path) -> str | None:
    """首选 prefix.md H1『全局美学基础 · X』;兜底 README.md 首个 H1 剥通用尾缀。"""
    p = d / "prefix.md"
    if p.exists():
        m = re.search(r"^# 全局美学基础 · (.+?)\s*$", p.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1)
    r = d / "README.md"
    if r.exists():
        m = re.search(r"^# (.+)$", r.read_text(encoding="utf-8"), re.M)
        if m:
            t = m.group(1).strip()
            for suf in (" 通用风格说明", "风格 说明", "风格说明"):
                if t.endswith(suf):
                    t = t[: -len(suf)]
            return t
    return None


def load_display_names() -> set[str]:
    """开放风格展示名集合(dev 60-3=57 与装机 59-2=57 恒同;重名时拼「名(目录)」防撞)。"""
    names: list[str] = []
    for d in sorted(ART_SKILLS.iterdir()):
        if not d.is_dir() or not (d / "prefix.md").exists():
            continue
        if d.name in EXCLUDED_DIRS:
            continue
        n = _display_name(d)
        if n:
            names.append(n)
    dup = [k for k, v in Counter(names).items() if v > 1]
    if dup:
        raise SystemExit(f"art_skills 展示名重复,无法唯一定址: {dup}")
    if not names:
        raise SystemExit(f"art_skills 风格库为空或不可读: {ART_SKILLS}")
    return set(names)


# ---------------- 单工作流手术 ----------------

def migrate_styles_node(d: dict, nid: int, display: str, title: str) -> None:
    n = node(d, nid)
    old = {i["name"]: i for i in n["inputs"]}
    pos_link = old["positive"].get("link")
    neg_link = old["negative"].get("link")

    n["type"] = NEW_TYPE
    n["properties"] = {"Node name for S&R": NEW_TYPE}
    # forceInput 形态:positive/negative 占 slot0/slot1(原 link 照抄),style 纯 widget 不占槽
    n["inputs"] = [
        {
            "name": "positive",
            "label": "正面提示词（可选）",
            "localized_name": "正面提示词（可选）",
            "shape": 7,
            "type": "STRING",
            "link": pos_link,
        },
        {
            "name": "negative",
            "label": "负面提示词（可选）",
            "localized_name": "负面提示词（可选）",
            "shape": 7,
            "type": "STRING",
            "link": neg_link,
        },
    ]
    n["widgets_values"] = [display]
    n["widgets_values_named"] = {"style": display}  # 评审改法 a:改写不整删,p2 named 源直取
    n["title"] = title
    # outputs 零改动:positive/negative STRING 槽名与旧 selector 逐槽同名同型,连线全保


# ---------------- 结构门 ----------------

def gate_wf(d: dict, nid: int, display: str, name: str,
            wired_pairs: list[tuple[int, int, int, int]]) -> None:
    n = node(d, nid)
    check(n["type"] == NEW_TYPE, f"{name}: 节点{nid} type={n['type']!r}≠{NEW_TYPE}")
    wv = n.get("widgets_values")
    check(isinstance(wv, list) and len(wv) == 1, f"{name}: 节点{nid} widgets_values 应单条,实={wv!r}")
    if isinstance(wv, list) and len(wv) == 1:
        check(wv[0] == display, f"{name}: 节点{nid} widgets_values={wv[0]!r}≠{display!r}")
    wvn = n.get("widgets_values_named")
    check(wvn == {"style": display}, f"{name}: 节点{nid} widgets_values_named={wvn!r}≠{{'style': {display!r}}}")
    check(display in DISPLAY_NAMES, f"{name}: 展示名 {display!r} 不在 art_skills 实测集合")
    check(n.get("properties") == {"Node name for S&R": NEW_TYPE},
          f"{name}: 节点{nid} properties 残留 Easy-Use 字段")
    check([i["name"] for i in n["inputs"]] == ["positive", "negative"],
          f"{name}: 节点{nid} inputs 槽名应恰为 positive/negative 两槽")

    raw = json.dumps(d, ensure_ascii=False)
    check("easy stylesSelector" not in raw, f"{name}: 残留 easy stylesSelector")
    check("MY_风格" not in raw, f"{name}: 残留 MY_风格")

    ids = {x["id"] for x in d["nodes"]}
    links = {l[0]: l for l in d["links"]}
    for l in d["links"]:
        check(l[1] in ids and l[3] in ids, f"{name}: 链接{l[0]} 端点缺失")
        if l[1] in ids and l[3] in ids:
            outs = nodes_by_id[l[1]]["outputs"]
            ins = nodes_by_id[l[3]]["inputs"]
            check(l[2] < len(outs) and l[0] in (outs[l[2]].get("links") or []),
                  f"{name}: 链接{l[0]} 源端引用缺")
            check(l[4] < len(ins) and ins[l[4]].get("link") == l[0],
                  f"{name}: 链接{l[0]} 目的端引用缺")
    for x in d["nodes"]:
        for o in x.get("outputs", []):
            for lid in o.get("links") or []:
                check(lid in links and links[lid][1] == x["id"],
                      f"{name}: 节点{x['id']} 输出悬空线{lid}")
        for i_ in x.get("inputs", []):
            lid = i_.get("link")
            check(lid is None or (lid in links and links[lid][3] == x["id"]),
                  f"{name}: 节点{x['id']} 输入悬空线{lid}")

    # 风格预览支线入门:双向一致门只验『存在的边两端引用齐』,不验『该存在的边存在』
    for s, ss, dn_, ds in wired_pairs:
        check(any(l[1] == s and l[2] == ss and l[3] == dn_ and l[4] == ds for l in d["links"]),
              f"{name}: 链路断 {s}.{ss}→{dn_}.{ds}")

    check(d.get("last_node_id") == max(x["id"] for x in d["nodes"]), f"{name}: last_node_id 未重算")
    check(d.get("last_link_id") == max(l[0] for l in d["links"]), f"{name}: last_link_id 未重算")


DISPLAY_NAMES: set[str] = set()
nodes_by_id: dict[int, dict] = {}


def main() -> int:
    global DISPLAY_NAMES
    DISPLAY_NAMES = load_display_names()

    targets = [
        {
            "path": K2 / "1_文生图/K2-文生图-超集.json",
            "nid": 60,
            "display": "2D工笔风",
            "title": "[60] 漫影风格库(art_skills 现读·正负词同注入)",
            "wired": [(50, 0, 60, 0), (64, 0, 60, 1), (60, 0, 51, 1), (60, 1, 65, 1), (60, 0, 62, 0)],
            "name": "超集",
        },
        {
            "path": K2 / "1_文生图/K2-文生图.json",
            "nid": 52,
            "display": "2D工笔风",
            "title": "风格选择(漫影风格库 art_skills 现读,预设:2D工笔风)",
            "wired": [(50, 0, 52, 0), (52, 0, 53, 1), (52, 0, 51, 0)],
            "name": "文生图",
        },
        {
            "path": K2 / "2_图生图/K2-图生图.json",
            "nid": 38,
            "display": "2D水彩",
            "title": "风格选择(漫影风格库 art_skills 现读,预设:2D水彩)",
            "wired": [(18, 0, 38, 0), (38, 0, 17, 3), (38, 0, 40, 0)],
            "name": "图生图",
        },
    ]

    docs: list[tuple[dict, dict]] = []
    for t in targets:
        d = json.loads(t["path"].read_text(encoding="utf-8"))
        migrate_styles_node(d, t["nid"], t["display"], t["title"])
        docs.append((t, d))

    # ---- 超集 [66] 速查卡:风格库口径(LoRA 句由 manying_superset_negative_prompt.py 管,不同句互不打回) ----
    sup_t, sup = docs[0]
    card = node(sup, 66)["widgets_values"][0]
    node(sup, 66)["widgets_values"][0] = card.replace(
        "风格在「漫影风格库」选(正负词同注入)",
        "风格在「漫影风格库」选(art_skills 手册现读·正负词同注入)",
    )

    # ---- 文生图 [62] Note:48→实测开放数+Krea 库改指 5_风格扩展流(精确串替换=幂等,旧句不在则 no-op) ----
    n_cnt = len(DISPLAY_NAMES)
    t2i_t, t2i = docs[1]
    note = node(t2i, 62)["widgets_values"][0]
    node(t2i, 62)["widgets_values"][0] = note.replace(
        "下拉可切漫影风格库全部 48 风格(2D/3D/真人/定格四大类)或 Krea 官方 3946 库任意风格,画风+引导+负面全链自动换。",
        f"下拉可切漫影风格库全部 {n_cnt} 风格(2D/3D/真人/定格);要 Krea 官方 3946 社区库=用 5_风格扩展流,画风+引导+负面全链自动换。",
    )

    # ---- 重算+门(重算在门前:图生图 last_node_id 历史虚高 43>max 42,重算收敛;设计步骤5⑤) ----
    global nodes_by_id
    for (t, d) in docs:
        d["last_node_id"] = max(x["id"] for x in d["nodes"])
        d["last_link_id"] = max(l[0] for l in d["links"])
        nodes_by_id = {x["id"]: x for x in d["nodes"]}
        gate_wf(d, t["nid"], t["display"], t["name"], t["wired"])

    if failures:
        print("结构门未过:")
        for f in failures:
            print("  ✗", f)
        return 1

    for (t, d) in docs:
        t["path"].write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"过门: 三工作流 easy stylesSelector→{NEW_TYPE}(展示名实测 {n_cnt} 家)"
          f" 超集[60]/文生图[52]=2D工笔风 图生图[38]=2D水彩 links 双向一致 支线全 wired 零 MY_风格")
    return 0


if __name__ == "__main__":
    sys.exit(main())
