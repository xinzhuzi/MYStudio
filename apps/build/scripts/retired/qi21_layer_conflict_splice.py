#!/usr/bin/env python3
"""qi21_bases.json 三层冲突分批 splice(10-09-qi21-prompt-layer-conflict Phase 3,design §3)。

批 A=底座三字段(D2/D3/D5)、B=场景型首行(D3/D4)、C=型文元语言(D6)、
D=删透明型死字段 positive_background_text(D7)+layer_contract.assembly_order.positive 改写实际链。
负向(negative_text/_CLASH_EXEMPT)不在本任务范围,零改动。

每批:mtime 30 分钟静默门(或盘上 md5=本任务上一批写出值)→ cp 备份 backups/qi21_bases.<批>.json
→ 唯一锚 splice → 写前字节比对 → indent=2 回写(往返字节无损)→ 重解析 → 键集合+字段白名单断言
→ research/splice-<批>.json。默认 dry-run,--apply 才写。

用法:python3 apps/build/scripts/qi21_layer_conflict_splice.py --batch A [--apply]
"""
import argparse
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
TASK = REPO / ".trellis/tasks/10-09-qi21-prompt-layer-conflict"
QUIET_SEC = 30 * 60
ASB_FIELDS = ("positive_text", "positive_style_text", "positive_ground_text")
RGBA_TYPES = ("道具", "人物多视图", "高清人脸", "表情差分")

D5_OLD = "：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术。"
D5_NEW = "，线条、色彩、留白与构图可见中国传统绘画来源。"
QUALITY_OLD = "成片质量：主体达到生产级细节清晰度，线描锐利自然；"
QUALITY_NEW = "主体线描锐利自然；"
D3_OLD = "浅净哑光底在非主体区域的每层色罩下保持可见；"
D2_OLD = ("环境按空间距离递减细节密度。生产级资产质量指焦点主体可读性、非焦点区域低频干净、画面层级分明。"
          "细节层级：视觉焦点区域最高细节密度，线描清晰锐利。辅助区域按视觉权重递减细节，以概括形体和大色面为主，不堆积细碎纹理。")
D2_NEW = "视觉焦点区域线描清晰锐利。"
_STYLE_OPS = ((D5_OLD, D5_NEW), (QUALITY_OLD, QUALITY_NEW))
_GROUND_OPS = ((D3_OLD, ""), (D2_OLD, D2_NEW))
A_OPS = tuple((("asb",), f, o, n) for f, ops in (("positive_text", _STYLE_OPS + _GROUND_OPS),
                                                   ("positive_style_text", _STYLE_OPS),
                                                   ("positive_ground_text", _GROUND_OPS)) for o, n in ops)

B_OLD = ("空镜场景，前景、中景、远景三层分明；环境主体达到完整细节渲染，画面边缘渐次简化。近处以细线勾勒，线随结构时粗时细；"
         "中景用色块晕开，墨与色相互接晕；远景交给低对比色面，色彩浓淡分明，层层退远、渐淡渐虚。")
B_NEW = ("空镜场景，前景、中景、远景三层分明，环境即画面主体。前景物件以细线完整勾勒并分染，线随结构时粗时细，材质与结构细节清晰；"
         "中景物件以线描勾出形体、单次分染，件件可辨可数，墨色分层晕染，色面交界清楚；远景只留大形，交给低对比色面，色彩浓淡分明，层层退远、渐淡渐虚。")
B_OPS = ((("type", "场景"), "positive_text", B_OLD, B_NEW),)

# (型, 字段, 旧, 新);测试按下标取旧句,顺序即 design §3.3 表序
C_OPS = (
    ("人物", "positive_text", "按主体句指定采用半身或全身取景", "取景为半身或全身"),
    ("人物", "positive_text", "背景色相出自主体句场景与时段", "背景色相出自画中场景与时段"),
    ("美宣", "positive_text", "人物数量、动作与取景范围遵循主体句", "人物数量、动作与取景范围依画中叙事而定"),
    ("美宣", "positive_text", "背景色相出自主体句场景与时段", "背景色相出自画中场景与时段"),
    ("高清人脸", "positive_text", "面部肤色、发色与可见衣领主色遵循主体句", "面部肤色、发色与可见衣领主色与角色设定一致"),
    ("表情差分", "positive_text", "各格情绪以主体句逐格点位为准", "九格情绪按左上至右下点位逐格各异"),
    ("表情差分", "positive_text", "面部肤色、发色与原有色词遵循主体句", "面部肤色与发色九格一致"),
    ("表情差分", "rgba_positive", "随主体句逐格点位指定的情绪变化", "随各格点位的情绪变化"),
)

ASSEMBLY_POSITIVE = [
    "t2i:[400]主体句 + [4010]types[].positive_text(透明开经 _qi21_rgba_text 句级剔除中文透明声明)"
    " + [4032]四段协议(风格工艺件/底色背景件/透明承载件/负向词表) → [4013]MyQi21ApiPE 扩写 → [4014]FinalOutput",
    "i2i/img2img:MyQi21PromptAssembly 三段拼「主体句:…\\n类型句:types[].positive_text\\n风格件」(透明路同款句级剔除)",
]
CONTRACT_UPDATED = "2026-10-09"

BATCHES = {
    "A": A_OPS,
    "B": B_OPS,
    "C": tuple((("type", z), f, o, n) for z, f, o, n in C_OPS),
    "D": (),
}


class AnchorError(RuntimeError):
    pass


def _types(d: dict) -> dict:
    return {t["zh"]: t for t in d.get("types", []) if isinstance(t, dict) and t.get("zh")}


def _holder(d: dict, loc: tuple) -> dict:
    return d["art_style_base"] if loc[0] == "asb" else _types(d)[loc[1]]


def _splice(d: dict, loc: tuple, field: str, old: str, new: str) -> None:
    h = _holder(d, loc)
    n = str(h.get(field) or "").count(old)
    if n != 1:
        raise AnchorError(f"{loc}/{field} 锚命中 {n} 次(须恰 1):{old[:24]}…")
    h[field] = h[field].replace(old, new)


def apply_batch(d: dict, batch: str) -> dict:
    """原地改 d 并返回;任一锚非唯一即抛 AnchorError(此时 d 可能半改,调用方须用副本)。"""
    for loc, field, old, new in BATCHES[batch]:
        _splice(d, loc, field, old, new)
    if batch == "D":
        order = d["layer_contract"]["assembly_order"]
        if order.get("positive") == ASSEMBLY_POSITIVE:
            raise AnchorError("assembly_order.positive 已是新链(批 D 已落)")
        for z in RGBA_TYPES:
            _types(d)[z].pop("positive_background_text")
        order["positive"] = list(ASSEMBLY_POSITIVE)
        d["layer_contract"]["updated"] = CONTRACT_UPDATED
    return d


def whitelist(batch: str) -> set:
    if batch == "D":
        return ({("types", z, "positive_background_text") for z in RGBA_TYPES}
                | {("layer_contract", "assembly_order", "positive"), ("layer_contract", "updated")})
    return {(("art_style_base",) if loc[0] == "asb" else ("types", loc[1])) + (f,)
            for loc, f, _o, _n in BATCHES[batch]}


def _flatten(node, path=()) -> dict:
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            out.update(_flatten(v, path + (k,)))
        return out
    if path == ("types",) and isinstance(node, list):
        out = {}
        for i, t in enumerate(node):
            out.update(_flatten(t, path + ((t.get("zh") if isinstance(t, dict) else None) or i,)))
        return out
    return {path: json.dumps(node, ensure_ascii=False)}


def diff_paths(before: dict, after: dict) -> set:
    fb, fa = _flatten(before), _flatten(after)
    return {p for p in fb.keys() | fa.keys() if fb.get(p) != fa.get(p)}


def batch_state(d: dict, batch: str) -> str:
    states = set()
    for loc, field, old, new in BATCHES[batch]:
        text = str(_holder(d, loc).get(field) or "")
        if text.count(old) == 1:
            states.add("before")
        elif old not in text and (not new or new in text):
            states.add("after")
        else:
            states.add("mixed")
    if batch == "D":
        has_bg = [("positive_background_text" in _types(d)[z]) for z in RGBA_TYPES]
        is_new = d["layer_contract"]["assembly_order"].get("positive") == ASSEMBLY_POSITIVE
        states.add("before" if all(has_bg) and not is_new else "after" if not any(has_bg) and is_new else "mixed")
    return states.pop() if len(states) == 1 else "mixed"


def dump(d: dict) -> str:
    return json.dumps(d, ensure_ascii=False, indent=2) + "\n"


def _md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def _own_md5s() -> set:
    out = set()
    for rep in (TASK / "research").glob("splice-*.json"):
        out.add(json.loads(rep.read_text(encoding="utf-8")).get("md5_after"))
    return out


def _quiet_gate(raw: bytes) -> str:
    age = time.time() - BASES.stat().st_mtime
    if age >= QUIET_SEC:
        return f"mtime 静默 {int(age)}s"
    if _md5(raw) in _own_md5s():
        return "盘上=本任务上一批写出值"
    raise SystemExit(f"静默门未过:{int(age)}s 内有他方写入,先等再重验")


def run(batch: str, apply: bool) -> dict:
    raw = BASES.read_bytes()
    before = json.loads(raw)
    if batch_state(before, batch) != "before":
        raise SystemExit(f"批 {batch} 盘上状态={batch_state(before, batch)},非全旧锚,拒绝 splice")
    gate = _quiet_gate(raw)
    after = apply_batch(json.loads(raw), batch)
    changed = diff_paths(before, after)
    if not changed <= whitelist(batch):
        raise SystemExit(f"越白名单:{sorted(changed - whitelist(batch))}")
    fb, fa = _flatten(before), _flatten(after)
    report = {"batch": batch, "gate": gate, "md5_before": _md5(raw), "applied": apply,
              "changed": {"/".join(map(str, p)): {"before": fb.get(p), "after": fa.get(p)} for p in sorted(changed, key=str)}}
    if not apply:
        return report
    backup = TASK / "backups" / f"qi21_bases.{batch}.json"
    backup.parent.mkdir(parents=True, exist_ok=True)
    if backup.exists() and backup.read_bytes() != raw:
        raise SystemExit(f"{backup.name} 已存在且与盘上不同,拒绝覆盖备份")
    shutil.copy2(BASES, backup)
    if BASES.read_bytes() != raw:
        raise SystemExit("写前字节比对失败:读后有他方写入")
    BASES.write_text(dump(after), encoding="utf-8")
    written = BASES.read_bytes()
    reparsed = json.loads(written)
    assert reparsed.keys() == before.keys(), "顶层键集合变了"
    assert diff_paths(before, reparsed) == changed, "回读 diff 与预期不符"
    assert batch_state(reparsed, batch) == "after", "回读非全新句"
    report.update(md5_after=_md5(written), backup=str(backup.relative_to(REPO)))
    out = TASK / "research" / f"splice-{batch}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--batch", required=True, choices=sorted(BATCHES))
    ap.add_argument("--apply", action="store_true", help="写盘(缺省 dry-run)")
    args = ap.parse_args()
    rep = run(args.batch, args.apply)
    print(json.dumps({k: v for k, v in rep.items() if k != "changed"} | {"changed": sorted(rep["changed"])},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
