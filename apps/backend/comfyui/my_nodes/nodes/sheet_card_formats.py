"""sheet_card_formats.py — 设定卡格式注册表解释器(1114 格式注册表数据驱动化)。

真源=qi21_bases.json#sheet_card_qwen.formats(格式定义五键 grid/cells/labels/
background/prompts,另 _doc 文档键与可选顶层 inherit/cells_drop);本件=加载链+
五道校验闸+表达式 DSL 求值器,供 my_sheet_card_composer(布局/渲染)与
my_sheet_prompt_hub(格式下拉)共用。语义铁律(金样逐字节不变,与
my_sheet_card_composer.py 现行算术严格一致):
- round = Python 内建 round(银行家舍入);"/"=真除(得 float 供 round);"//"=整除;
- 求值序:继承矩形→vars(按 JSON 书写序,可引前序 vars)→palette 覆写→cells;
- inherit 继承的是父格式「已算出的矩形」(数值),非表达式——子格式在自己的
  画布上另算自己的 vars(与旧码 无装备=layout("全卡")+pop+重算 同构);
- 内置变量 W/H=本格式画布,M/G=margin/gutter,iw=W-2M,ih=H-2M(双双用 M)。

分级兜底(1114 裁定,消除静默烂卡 vs 部署级软着陆的矛盾):
- 真源缺位(候选链四层全无文件)或整文件 JSON 解析失败=部署级故障→
  静默回退内嵌 _FROZEN 冻结快照+告警日志(保住「合成器零外部文件可独立工作」);
- 真源解析得动但任一条目 schema 不过五道闸=作者级错误→拒载整源抛
  SheetFormatsError(带格式/键定位),INPUT_TYPES/layout/compose 上抛可见。

双加载实例事项:本模块可能同时以「包成员 my_nodes.nodes.sheet_card_formats」与
「spec_from_file_location 裸载名 sheet_card_formats」两种身份各存一份实例
(composer/hub 的裸载兼容 shim 会按路径加载第二份)。两份实例各自持 mtime 缓存、
各自读真源,数据一致、互不共享可变状态(resolve 不改注册表),故无害;新增模块级
可变状态时须保持「无跨实例共享假设」。

_FROZEN 字面量住在本目录 sheet_card_formats_frozen.generated.py(1124 超线文件拆分:
自本文件尾段原样移出;本模块按文件路径加载,包成员/裸载两种身份都适用),由
apps/build/scripts/daojie_sheet_formats_freeze.py 从真源再生(幂等),勿手改。
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

_HERE = Path(__file__).resolve()

FORMATS_VERSION = "v8"          # 真源 format_version(读侧不设卡;写侧 bump 走真源 _doc 版本链)


class SheetFormatsError(ValueError):
    """真源 formats 条目 schema 不过(作者级错误,拒载整源,带格式/键定位)。"""


_OPS = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": lambda a, b: a / b,
    "//": lambda a, b: a // b,
}
_EDGE = {"left": 0, "top": 1, "right": 2, "bottom": 3}
_RESERVED = {"W", "H", "M", "G", "iw", "ih"}      # 内置变量名,vars 禁覆盖
_MODES = {"contain", "cover"}
_UNIVERSE = {  # 格键宇宙 = derive_cells 输出 19 键(新格名=新裁法=代码层)
    "front", "side", "back", "face", "head", "eye", "hair", "wrist", "waist",
    "weapon", "weapon_a", "weapon_b", "fabric_1", "fabric_2", "fabric_3",
    "gear_1", "gear_2", "fx_1", "fx_2",
    "exp_1", "exp_2", "exp_3", "exp_4", "exp_5",
}


def _candidates() -> list[Path]:
    """真源家四层候选(对齐 my_sheet_prompt_hub._daojie_data 正典+装机/用户位)。"""
    out: list[Path] = []
    _env = os.environ.get("MYSTUDIO_DAOJIE_DATA")
    if _env:
        out.append(Path(_env))
    out.append(_HERE.parents[4]
               / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json")
    out.append(Path(os.environ.get(
        "MYSTUDIO_COMFYUI_HOME",
        Path.home() / "Library/Application Support/漫影工作室/comfyui")) / "daojie-data")
    out.append(Path("/Applications/漫影工作室.app/Contents/Resources/"
                    "studio-manuals/art_skills/daojie_ink_guofeng/json"))
    out.append(Path.home() / "Applications" / "漫影工作室.app" / "Contents"
               / "Resources" / "studio-manuals" / "art_skills"
               / "daojie_ink_guofeng" / "json")
    return out


def truth_path() -> Path | None:
    """候选链上第一个在位的 qi21_bases.json(缺位=None;测试据此判真源在位否)。"""
    for base in _candidates():
        p = base / "qi21_bases.json"
        if p.is_file():
            return p
    return None


def validate_registry(reg: dict) -> None:
    """加载期五道闸;单条目坏=拒载整源(SheetFormatsError 带定位),由上层上抛可见。

    ① mode∈{contain,cover} ② 格键唯一且⊆derive_cells 19 键宇宙 ③ inherit 无环
    且父在册 ④ rect 四元/at·size·gap 二元 ⑤ vars 禁覆盖保留名;
    另有画布二元正整数组/cells 条目形貌/cells_drop⊆宇宙。
    """
    for fmt, spec in reg.items():               # ③ inherit 无环+父在册(先于递归)
        seen, f = set(), fmt
        while isinstance(spec, dict) and "inherit" in (reg.get(f) or {}):
            if f in seen:
                raise SheetFormatsError(f"格式 {fmt!r} 继承成环(回到 {f!r})")
            seen.add(f)
            f = reg[f]["inherit"]
            if f not in reg:
                raise SheetFormatsError(f"格式 {fmt!r} 继承的父格式 {f!r} 不在册")
    for fmt, spec in reg.items():
        g = spec.get("grid", {})
        if "canvas" in g:
            cv = g.get("canvas")
            if not (isinstance(cv, list) and len(cv) == 2
                    and all(isinstance(v, int) and not isinstance(v, bool) and v > 0
                            for v in cv)):
                raise SheetFormatsError(
                    f"{fmt}.grid.canvas 应为二元正整数组,得 {cv!r}")
        for v in g.get("vars", {}):              # ⑤ vars 禁覆盖保留名
            if v in _RESERVED:
                raise SheetFormatsError(
                    f"{fmt}.grid.vars.{v} 覆盖保留名 {sorted(_RESERVED)}")
        pal = g.get("palette")
        if pal is not None and not (isinstance(pal, list) and len(pal) == 4):
            raise SheetFormatsError(f"{fmt}.grid.palette 应为四元表达式组")
        seen_keys = set()
        for e in spec.get("cells", []):
            if not isinstance(e, dict) or not ({"key", "rect"} <= e.keys()
                                               or {"flow", "grid"} & e.keys()):
                raise SheetFormatsError(f"{fmt} cells 条目缺 key/rect 或 flow/grid:{e!r}")
            keys = [e["key"]] if "key" in e else e["keys"]
            for k in keys:                       # ② 格键唯一 + ⊆19 键宇宙
                if k in seen_keys:
                    raise SheetFormatsError(f"{fmt} 格键重复:{k!r}")
                seen_keys.add(k)
                if k not in _UNIVERSE:
                    raise SheetFormatsError(
                        f"{fmt} 格键 {k!r} 不在 derive_cells 24 键宇宙")
            mods = ([e.get("mode", "cover")] if "key" in e else
                    [e.get("modes", {}).get(k, e.get("mode", "cover")) for k in keys])
            for m in mods:                       # ① mode 枚举
                if m not in _MODES:
                    raise SheetFormatsError(
                        f"{fmt} 非法 mode {m!r}(合法 {sorted(_MODES)})")
            r = e.get("rect")
            if "key" in e and not (isinstance(r, list) and len(r) == 4):
                raise SheetFormatsError(f"{fmt}.{e['key']}.rect 应为四元表达式组")  # ④
            for fld, n in (("at", 2), ("size", 2)):
                if fld in e and not (isinstance(e[fld], list) and len(e[fld]) == n):
                    raise SheetFormatsError(
                        f"{fmt} cells 条目 {fld} 应为 {n} 元表达式组")
            if "gap" in e and isinstance(e["gap"], list) and len(e["gap"]) != 2:
                raise SheetFormatsError(f"{fmt} cells 条目 gap 数组应二元")
        for k in spec.get("cells_drop", []):
            if k not in _UNIVERSE:
                raise SheetFormatsError(f"{fmt}.cells_drop {k!r} 不在格键宇宙")


def _ev(e, env, rects):
    if isinstance(e, (int, float)):
        return e
    if isinstance(e, str):
        return env[e]
    op, *args = e
    if op in _OPS:
        a, b = (_ev(x, env, rects) for x in args)
        return _OPS[op](a, b)
    if op == "round":
        return round(_ev(args[0], env, rects))
    if op in _EDGE:
        return rects[args[0]][_EDGE[op]]
    raise SheetFormatsError(f"未知算子/访问器 {op!r}")


def _expand_entry(entry, env, rects, out, modes):
    """单格(rect)或格组(flow/grid)展开 → out[key]=(x0,y0,x1,y1) 有序写入。"""
    if "key" in entry:
        k = entry["key"]
        r = tuple(_ev(x, env, rects) for x in entry["rect"])
        out[k] = r
        modes[k] = entry.get("mode", "cover")
        return
    keys = entry["keys"]
    default_mode = entry.get("mode", "cover")
    overrides = entry.get("modes", {})
    if "flow" in entry:                       # h: 横排 x_i=x0+i*(w+g);v: 纵排
        x0, y0 = (_ev(x, env, rects) for x in entry["at"])
        w, h = (_ev(x, env, rects) for x in entry["size"])
        g = _ev(entry["gap"], env, rects)
        for i, k in enumerate(keys):
            if entry["flow"] == "h":
                out[k] = (x0 + i * (w + g), y0, x0 + i * (w + g) + w, y0 + h)
            else:
                out[k] = (x0, y0 + i * (h + g), x0 + w, y0 + i * (h + g) + h)
            modes[k] = overrides.get(k, default_mode)
        return
    if "grid" in entry:                       # [cols,rows];col=i%cols,row=i//cols
        cols, _rows = entry["grid"]
        x0, y0 = (_ev(x, env, rects) for x in entry["at"])
        w, h = (_ev(x, env, rects) for x in entry["size"])
        gx, gy = (_ev(x, env, rects) for x in entry["gap"])
        for i, k in enumerate(keys):
            c, r = i % cols, i // cols
            out[k] = (x0 + c * (w + gx), y0 + r * (h + gy),
                      x0 + c * (w + gx) + w, y0 + r * (h + gy) + h)
            modes[k] = overrides.get(k, default_mode)
        return
    raise SheetFormatsError(f"cells 条目缺 key/flow/grid:{entry!r}")


def _resolve(registry: dict, fmt: str, _memo: dict | None = None) -> dict:
    """fmt 原始 spec → 解析结果(canvas/margin/gutter/rects/modes/labels/…)。"""
    if _memo is None:                            # 顶层调用:先整源校验(拒载坏条目)
        validate_registry(registry)
        _memo = {}
    if fmt in _memo:
        return _memo[fmt]
    spec = registry[fmt]
    parent = _resolve(registry, spec["inherit"], _memo) if "inherit" in spec else None
    grid = spec.get("grid", {})
    canvas = tuple(grid.get("canvas", parent["canvas"])) if parent else tuple(grid["canvas"])
    marg = grid.get("margin", parent["margin"] if parent else None)
    gut = grid.get("gutter", parent["gutter"] if parent else None)
    W, H = canvas
    env = {"W": W, "H": H, "M": marg, "G": gut, "iw": W - 2 * marg, "ih": H - 2 * marg}

    rects: dict = {}
    modes: dict = {}
    if parent:                                # 继承=父格式已算出的矩形(数值)
        rects.update({k: v for k, v in parent["rects"].items() if k != "_palette"})
        modes.update(parent["modes"])
        for k in spec.get("cells_drop", []):
            rects.pop(k, None)
            modes.pop(k, None)
    if "palette" not in grid and parent:
        rects["_palette"] = parent["rects"]["_palette"]
    for name, expr in grid.get("vars", {}).items():   # vars 按书写序,可引前序 vars
        env[name] = _ev(expr, env, rects)             # (访问器可引继承矩形含 _palette)
    if "palette" in grid:                             # palette 覆写:vars 之后求值
        rects["_palette"] = tuple(_ev(x, env, rects) for x in grid["palette"])
    for entry in spec.get("cells", []):
        _expand_entry(entry, env, rects, out=rects, modes=modes)

    # 显式 rect 覆盖(1114 竖版修正:真源 formats.X.rects 优先于 grid 公式;
    # 公式重算=多点位同步改,显式覆=单点修正,更安全)
    if "rects" in spec:
        for k, v in spec["rects"].items():
            rects[k] = tuple(v)

    for k, r in rects.items():                # 验证:坐标全 int;倒矩形/越界=告警不拦
        assert all(isinstance(v, int) for v in r), f"{fmt}.{k} 坐标非整数:{r}"
        if not (r[0] < r[2] and r[1] < r[3]):
            log.warning("[sheet_card_formats] %s.%s 倒矩形(存量几何同状,恒等保留):%s",
                        fmt, k, r)

    lab = spec.get("labels", {})
    if "inherit" in lab:                      # labels 可独立继承(不必同格式级 inherit)
        lab = _resolve(registry, lab["inherit"], _memo)["labels"]
    res = {"canvas": canvas, "margin": marg, "gutter": gut, "rects": rects,
           "modes": modes, "labels": lab,
           "background": spec.get("background", {"default": "素白宣纸", "allow": "*"}),
           "prompts": spec.get("prompts", {"preset": "base"})}
    _memo[fmt] = res
    return res


_CACHE: tuple | None = None   # ((path_str|None, mtime_ns|None), registry)


def _frozen_copy() -> dict:
    return json.loads(json.dumps(_FROZEN))


def load_formats() -> dict:
    """加载格式注册表(mtime 缓存)。

    真源缺位/整文件解析失败→回退内嵌 _FROZEN+告警(部署级软着陆);
    条目 schema 不过→SheetFormatsError 上抛(作者级,节点面板/运行日志可见)。
    """
    global _CACHE
    path = truth_path()
    key = (str(path), path.stat().st_mtime_ns) if path else (None, None)
    if _CACHE is not None and _CACHE[0] == key:
        return _CACHE[1]
    if path is None:
        log.warning("[sheet_card_formats] 真源缺位(候选链全无 qi21_bases.json),"
                    "回退内嵌 _FROZEN 冻结快照")
        reg = _frozen_copy()
    else:
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
            reg = doc["sheet_card_qwen"]["formats"]
        except Exception as e:                # 整文件级故障=部署级,软着陆
            log.warning("[sheet_card_formats] 真源整文件加载失败(%s),"
                        "回退内嵌 _FROZEN 冻结快照:%s", path, e)
            reg = _frozen_copy()
        else:
            if not isinstance(reg, dict) or not reg:
                raise SheetFormatsError(
                    f"真源 {path} sheet_card_qwen.formats 应为非空对象,得 {reg!r}")
            validate_registry(reg)             # 作者级错误:上抛不缓存(修文件即热恢复)
    _CACHE = (key, reg)
    return reg


def formats_list() -> list[str]:
    """格式名书写序(『全卡』恒首键=缺省档契约;新增格式只能尾部追加)。"""
    return list(load_formats())


def resolve(fmt: str) -> dict:
    """格式名→解析结果(canvas/margin/gutter/rects 含 _palette/modes/labels/…)。"""
    reg = load_formats()
    if fmt not in reg:
        raise SheetFormatsError(f"未知格式 {fmt!r}(在册:{list(reg)})")
    return _resolve(reg, fmt)


# ── 遗留符号面(PEP 562 惰性;绑定语义=取『全卡』格式对应值——金样锚格式,
#    非首键:『全卡恒首键』契约下两者等价,绑定锚点更抗未来误排)──
def __getattr__(name: str):
    if name == "FORMATS":
        return tuple(formats_list())
    if name == "CANVAS":
        return {f: resolve(f)["canvas"] for f in formats_list()}
    if name == "CELL_KEYS_BY_FMT":
        return {f: tuple(k for k in resolve(f)["rects"] if k != "_palette")
                for f in formats_list()}
    if name == "CELL_KEYS":
        return tuple(k for k in resolve("全卡")["rects"] if k != "_palette")
    if name == "LABELS":
        return dict(resolve("全卡")["labels"].get("text", {}))
    if name in ("W", "H", "M", "G"):
        spec = resolve("全卡")
        return {"W": spec["canvas"][0], "H": spec["canvas"][1],
                "M": spec["margin"], "G": spec["gutter"]}[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


# ── _FROZEN 冻结快照(1124 超线文件拆分:字面量移到本目录
# sheet_card_formats_frozen.generated.py,仍由 apps/build/scripts/daojie_sheet_formats_freeze.py
# 再生;勿手改)──────────────────────────────────────────────
# 本模块可能被按路径裸载(见文件头「双加载实例事项」),相对导入不可用,故按文件路径
# 加载;每份实例各持一份快照(纯数据,不共享可变状态)。


def _load_frozen() -> dict:
    import importlib.util

    path = Path(__file__).resolve().parent / "sheet_card_formats_frozen.generated.py"
    spec = importlib.util.spec_from_file_location("sheet_card_formats_frozen", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._FROZEN


_FROZEN: dict = _load_frozen()
