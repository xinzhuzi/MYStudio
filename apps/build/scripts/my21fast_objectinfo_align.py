#!/usr/bin/env python3
"""my21fast-1025 序3①:TextEncodeQwenImage21 vs MyQi21FastEncode object_info 结构对齐器(主裁A)。

结构域递归比(主裁A 口径):
  1. input.required / input.optional:组内全键序(逐组键名序列零差)+ 逐键
     类型牌(type tag)相等 + extras 全 dict 递归相等;
  2. COMFY_AUTOGROW_V3 的 template 子树递归参与同一归一比较(images 锚);
  3. output 三列表零差:output / output_name / output_is_list;
  4. 顶层豁免:tooltip 族(extras 键 "tooltip"/"output_tooltips" 及 *_tooltip)
     与顶层新式元数据键(name/display_name/description/python_module/category/
     essentials_category/search_aliases/price_badge/api_node/deprecated/
     dev_only/experimental/has_intermediate_output/output_tooltips/
     output_matchtypes/is_input_list/input_order/output_node 等非结构域键)
     ——豁免键明册登记并逐键打印 EXEMPT,不静默。

缺省 extras 归一:spec 形 [type] ≡ [type, {}](前轮亲读引擎 _io.py:2072-2086,
官方 object_info 导出恒二元;本仓声明形 [type] 与官方 [type, {}] 结构等价)。

数据源:--snapshot <json> 离线快照,或 --engine 直连在跑引擎 /object_info
(端口现查装机家 manifest.json,禁抄常量;连接失败=退出 2 SKIPPED-ENGINE-DOWN)。

--selftest:双向反例三态(EQUAL/DIFF/EXEMPT)全过才退出 0;反例含主裁钦点两条:
  ["IMAGE"] vs ["IMAGE", {}] → EQUAL(缺省 extras 归一);
  {} vs {"forceInput": True} → DIFF(extras 不等)。

用法:
  python3 my21fast_objectinfo_align.py --selftest
  python3 my21fast_objectinfo_align.py --snapshot ../../backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json
  python3 my21fast_objectinfo_align.py --engine
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OFFICIAL_KEY = "TextEncodeQwenImage21"
FAST_KEY = "MyQi21FastEncode"

# ——主裁A 豁免明册(逐键登记,不静默)———————————————————————————————————
EXEMPT_EXTRAS_KEYS = {"tooltip"}                     # extras 内 tooltip 族
EXEMPT_TOP_KEYS = {                                  # 顶层新式元数据/显示域键
    "name", "display_name", "description", "python_module", "category",
    "input_order", "is_input_list", "output_is_list_order", "output_node",
    "output_tooltips", "output_matchtypes", "deprecated", "experimental",
    "dev_only", "api_node", "price_badge", "search_aliases",
    "essentials_category", "has_intermediate_output", "cnr_id", "author",
    "license", "help", "website", "reference", "icon",
}
CORE_TOP_KEYS = ("input", "output", "output_name", "output_is_list")  # 结构域三列表+input


def _norm_spec(spec) -> tuple:
    """[type] → (type, {});[type, extras] → (type, extras);其余原样牌。"""
    if isinstance(spec, list):
        if len(spec) == 1:
            return (spec[0], {})
        if len(spec) == 2 and isinstance(spec[1], dict):
            return (spec[0], spec[1])
        return (tuple(spec), {})
    return (spec, {})


def _diff_template(ta: dict, tb: dict, path: str, exempt: list) -> list:
    """COMFY_AUTOGROW_V3 template 子树递归:形如 {input:{required/optional:{名:spec}}},
    叶值是 spec 列表——[type] ≡ [type, {}] 归一在叶位施加(与官方 _io.py 恒二元对齐)。"""
    out = []
    if not (isinstance(ta, dict) and isinstance(tb, dict) and
            isinstance(ta.get("input"), dict) and isinstance(tb.get("input"), dict)):
        return _diff_extras(ta, tb, path, exempt)
    for g in ("required", "optional"):
        ga, gb = ta["input"].get(g, {}), tb["input"].get(g, {})
        if list(ga.keys()) != list(gb.keys()):
            out.append(f"{path}.input.{g}: template 组内键序差 {list(ga.keys())} vs {list(gb.keys())}")
        for name in [n for n in ga if n in gb]:
            sa, sb = _norm_spec(ga[name]), _norm_spec(gb[name])
            if sa[0] != sb[0]:
                out.append(f"{path}.input.{g}.{name}: template 叶类型牌差 {sa[0]!r} vs {sb[0]!r}")
            else:
                out += _diff_extras(sa[1], sb[1], f"{path}.input.{g}.{name}", exempt)
    return out


def _is_tooltip_family(k: str) -> bool:
    return k in EXEMPT_EXTRAS_KEYS or k.endswith("_tooltip") or k == "tooltips"


def _diff_extras(a: dict, b: dict, path: str, exempt: list) -> list:
    """extras 全 dict 递归比(键集比=无序;extras 内部键序非结构域——组内全键序
    属 input.required/optional 名序,由 compare_entries 单独序敏感比);
    tooltip 族豁免(单侧独有亦豁免并登记);template 子树走 spec 感知递归。"""
    out = []
    for k in [x for x in a if x not in b]:
        sub = f"{path}.{k}"
        if _is_tooltip_family(k):
            exempt.append(f"{sub}(仅A)")
        else:
            out.append(f"{path}: extras 键集差 仅A=[{k}]")
    for k in [x for x in b if x not in a]:
        sub = f"{path}.{k}"
        if _is_tooltip_family(k):
            exempt.append(f"{sub}(仅B)")
        else:
            out.append(f"{path}: extras 键集差 仅B=[{k}]")
    keys = [k for k in a if k in b]
    for k in keys:
        sub = f"{path}.{k}"
        if _is_tooltip_family(k):
            exempt.append(sub)
            continue
        va, vb = a[k], b[k]
        if k == "template" and isinstance(va, dict) and isinstance(vb, dict):
            out += _diff_template(va, vb, sub, exempt)
            continue
        if isinstance(va, dict) and isinstance(vb, dict):
            out += _diff_extras(va, vb, sub, exempt)
            continue
        if isinstance(va, list) and isinstance(vb, list):
            # 列表逐位递归(tuple 形 spec 走归一)
            if len(va) != len(vb):
                out.append(f"{sub}: 列表长差 {len(va)} vs {len(vb)}")
                continue
            for i, (ea, eb) in enumerate(zip(va, vb)):
                na, nb = _norm_spec(ea) if isinstance(ea, list) else (ea, None), \
                         _norm_spec(eb) if isinstance(eb, list) else (eb, None)
                if isinstance(ea, list) and isinstance(eb, list):
                    if na[0] != nb[0]:
                        out.append(f"{sub}[{i}]: 类型牌差 {na[0]!r} vs {nb[0]!r}")
                    elif na[1] or nb[1]:
                        out += _diff_extras(na[1], nb[1], f"{sub}[{i}]", exempt)
                elif ea != eb:
                    out.append(f"{sub}[{i}]: 值差 {ea!r} vs {eb!r}")
            continue
        if va != vb:
            out.append(f"{sub}: 值差 {va!r} vs {vb!r}")
    return out


def compare_entries(official: dict, fast: dict) -> dict:
    """主裁A 结构域递归比;返回 {verdict, diffs, exempt}。verdict ∈ EQUAL/DIFF。"""
    diffs: list[str] = []
    exempt: list[str] = []
    # 顶层:结构域四键外全豁免(登记)
    for k in sorted(set(official) | set(fast)):
        if k in CORE_TOP_KEYS:
            continue
        if official.get(k) != fast.get(k):
            exempt.append(f"<top>:{k}")
    for k in CORE_TOP_KEYS:
        if k not in official or k not in fast:
            diffs.append(f"<top>:{k} 缺席 A={'in' if k in official else 'out'} B={'in' if k in fast else 'out'}")
            continue
        if k == "input":
            ga, gb = official["input"], fast["input"]
            groups = [g for g in ("required", "optional") if g in ga or g in gb]
            for g in groups:
                if g not in ga or g not in gb:
                    diffs.append(f"input.{g}: 组缺席")
                    continue
                ka, kb = list(ga[g].keys()), list(gb[g].keys())
                if ka != kb:
                    diffs.append(f"input.{g}: 组内键序差 {ka} vs {kb}")
                for name in [n for n in ka if n in kb]:
                    ta, ea = _norm_spec(ga[g][name])
                    tb, eb = _norm_spec(gb[g][name])
                    if ta != tb:
                        diffs.append(f"input.{g}.{name}: 类型牌差 {ta!r} vs {tb!r}")
                    else:
                        diffs += _diff_extras(ea, eb, f"input.{g}.{name}", exempt)
        elif isinstance(official[k], list):
            if official[k] != fast[k]:
                diffs.append(f"<top>:{k}: 三列表差 {official[k]} vs {fast[k]}")
        elif official[k] != fast[k]:
            diffs.append(f"<top>:{k}: 差 {official[k]!r} vs {fast[k]!r}")
    return {"verdict": "DIFF" if diffs else "EQUAL", "diffs": diffs, "exempt": exempt}


# ——selftest 三态(EQUAL / DIFF / EXEMPT)—————————————————————————————————

def _selftest() -> int:
    failures = []

    def check(state: str, label: str, cond: bool):
        print(f"[selftest:{state}] {label} -> {'PASS' if cond else 'FAIL'}")
        if not cond:
            failures.append(label)

    # EQUAL:主裁钦点 1——缺省 extras 归一(双向)
    check("EQUAL", '["IMAGE"] vs ["IMAGE",{}] 归一相等(A→B)', _norm_spec(["IMAGE"]) == _norm_spec(["IMAGE", {}]))
    check("EQUAL", '["IMAGE",{}] vs ["IMAGE"] 归一相等(B→A 反向)', _norm_spec(["IMAGE", {}]) == _norm_spec(["IMAGE"]))
    r = compare_entries(
        {"input": {"required": {"a": ["IMAGE"]}}, "output": ["X"], "output_name": ["y"], "output_is_list": [False]},
        {"input": {"required": {"a": ["IMAGE", {}]}}, "output": ["X"], "output_name": ["y"], "output_is_list": [False]},
    )
    check("EQUAL", "整条目 [a:IMAGE] vs [a:IMAGE,{}] → EQUAL", r["verdict"] == "EQUAL")
    # EQUAL:autogrow template 递归归一
    def _ag(image_spec, names):
        return {"input": {"required": {"images": ["COMFY_AUTOGROW_V3",
                {"template": {"input": {"required": {"image": image_spec}}}, "names": names, "min": 0}]}},
                "output": [], "output_name": [], "output_is_list": []}
    r = compare_entries(_ag(["IMAGE"], ["image_1"]), _ag(["IMAGE", {}], ["image_1"]))
    check("EQUAL", "autogrow template 子树 [image:IMAGE] vs [image:IMAGE,{}] → EQUAL", r["verdict"] == "EQUAL")
    check("EQUAL", "autogrow template 子树 [image:IMAGE] vs [image:IMAGE,{}] → EQUAL", r["verdict"] == "EQUAL")
    # EQUAL:键序同序
    r = compare_entries(
        {"input": {"required": {"a": ["X", {}], "b": ["Y", {}]}}, "output": [], "output_name": [], "output_is_list": []},
        {"input": {"required": {"a": ["X", {}], "b": ["Y", {}]}}, "output": [], "output_name": [], "output_is_list": []},
    )
    check("EQUAL", "组内键序同序 → EQUAL", r["verdict"] == "EQUAL")

    # DIFF:主裁钦点 2——extras 不等(双向)
    d = _diff_extras({}, {"forceInput": True}, "t", [])
    check("DIFF", '{} vs {"forceInput":true} 不等(A→B)', d != [])
    d = _diff_extras({"forceInput": True}, {}, "t", [])
    check("DIFF", '{"forceInput":true} vs {} 不等(B→A 反向)', d != [])
    # DIFF:类型牌差
    check("DIFF", '["IMAGE"] vs ["MASK"] 类型牌差', _norm_spec(["IMAGE"])[0] != _norm_spec(["MASK"])[0])
    # DIFF:键序差
    r = compare_entries(
        {"input": {"required": {"a": ["X", {}], "b": ["Y", {}]}}, "output": [], "output_name": [], "output_is_list": []},
        {"input": {"required": {"b": ["Y", {}], "a": ["X", {}]}}, "output": [], "output_name": [], "output_is_list": []},
    )
    check("DIFF", "组内键序倒序 → DIFF", r["verdict"] == "DIFF")
    # DIFF:output 三列表差
    r = compare_entries(
        {"input": {}, "output": ["CONDITIONING", "CONDITIONING", "LATENT"], "output_name": ["positive", "negative", "latent"], "output_is_list": [False, False, False]},
        {"input": {}, "output": ["CONDITIONING", "CONDITIONING"], "output_name": ["positive", "negative"], "output_is_list": [False, False]},
    )
    check("DIFF", "output 三列表差 → DIFF", r["verdict"] == "DIFF")
    # DIFF:autogrow names 差
    r = compare_entries(_ag(["IMAGE"], ["image_1"]), _ag(["IMAGE"], ["image_1", "image_2"]))
    check("DIFF", "autogrow names 列表差 → DIFF", r["verdict"] == "DIFF")

    # EXEMPT:tooltip 族差被豁免(登记)且不判 DIFF
    r = compare_entries(
        {"input": {"required": {"a": ["X", {"tooltip": "左"}]}}, "output": [], "output_name": [], "output_is_list": []},
        {"input": {"required": {"a": ["X", {"tooltip": "右"}]}}, "output": [], "output_name": [], "output_is_list": []},
    )
    check("EXEMPT", "extras tooltip 族差 → EQUAL 且登记豁免", r["verdict"] == "EQUAL" and any("tooltip" in e for e in r["exempt"]))
    # EXEMPT:顶层新式元数据键差被豁免
    r = compare_entries(
        {"input": {}, "output": [], "output_name": [], "output_is_list": [], "display_name": "A", "price_badge": None, "search_aliases": None, "python_module": "x"},
        {"input": {}, "output": [], "output_name": [], "output_is_list": [], "display_name": "B", "price_badge": "pro", "search_aliases": ["q"], "python_module": "y"},
    )
    check("EXEMPT", "顶层元数据键差 → EQUAL 且逐键登记豁免", r["verdict"] == "EQUAL" and len(r["exempt"]) == 4)

    if failures:
        print(f"[selftest] FAIL ×{len(failures)}: {failures}")
        return 1
    print("[selftest] 三态(EQUAL/DIFF/EXEMPT)全过")
    return 0


def _load_source(args) -> tuple[dict, str]:
    if args.snapshot:
        path = Path(args.snapshot)
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()
        return json.loads(path.read_text(encoding="utf-8")), f"snapshot:{path}"
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    port = json.loads(manifest.read_text(encoding="utf-8"))["engine"]["port"]
    base = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(f"{base}/object_info", timeout=30) as resp:
            return json.load(resp), f"engine:{base}"
    except Exception as exc:  # noqa: BLE001 ——引擎停=兑底跳过,非失败
        print(f"SKIPPED-ENGINE-DOWN engine {base} object_info 不可达: {exc}")
        raise SystemExit(2)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--snapshot", help="离线 object_info 快照 JSON(如 tests/fixtures/qi21_object_info_snapshot.json)")
    ap.add_argument("--engine", action="store_true", help="直连在跑引擎(端口现查装机家 manifest)")
    ap.add_argument("--official-key", default=OFFICIAL_KEY)
    ap.add_argument("--fast-key", default=FAST_KEY)
    args = ap.parse_args()
    if args.selftest:
        return _selftest()
    if not args.snapshot and not args.engine:
        ap.error("需要 --snapshot 或 --engine 之一(或 --selftest)")
    info, src = _load_source(args)
    missing = [k for k in (args.official_key, args.fast_key) if k not in info]
    if missing:
        print(f"[align] 源缺键 {missing}(src={src})——快照尚未补新类条目(序5 步骤5)或引擎未载新类")
        return 3
    result = compare_entries(info[args.official_key], info[args.fast_key])
    print(f"[align] src={src}")
    print(f"[align] {args.official_key} vs {args.fast_key} → {result['verdict']}")
    for d in result["diffs"]:
        print(f"  DIFF {d}")
    for e in sorted(set(result["exempt"])):
        print(f"  EXEMPT {e}")
    print(f"[align] 计:diffs={len(result['diffs'])} exempt={len(set(result['exempt']))}")
    return 0 if result["verdict"] == "EQUAL" else 1


if __name__ == "__main__":
    sys.exit(main())
