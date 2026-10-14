#!/usr/bin/env python3
"""qi21-道劫-i2i.json 工作流本体直跑器(1013 用户令:「按照晏燎的图,做个图生图测试」)。

不做任何自建图——从工作流 GUI JSON **按其结构通用展平**成 API 格式发车
(与画布 graphToPrompt 同语义):
- 双子图([6] 提示词类型优化/[7] 加速)按定义就地展开,宿主边界穿越重连;
- 旁路语义=画布同款:mode 4 节点剪除、其连线剪断(image_3 默认缺席;
  --enable-ref3 = 模拟用户对 [12]+[18] 按 Ctrl+B 解旁路并选图);
- Reroute 一律解析穿越([42]/[43]/[44]/[33] 总线拐);
- 档位选择=[7:7015] MyQi21SpeedSelect 的画布懒执行在 headless 无 lazy 请求方,
  故按档直通:winning 采样器输出直代 SpeedSelect 出线,未选支路剪除
  (与画布执行图等价);
- seed=**每次随机**(random.randint;铁令),注入宿主「seed」面板槽现值位;
- PE 改写=[4013] TextGenerate 本地 pe_i2i 检查点(全链零云端,API key 无涉)。

用法:python3 qi21_i2i_workflow_fire.py --instruction "..." \
    [--ref1 yanliao_yuanying_front.png] [--ref2 clothing_light_blue_denim_shirt.png] \
    [--ref3 yanliao_heti_front.png(--enable-ref3 才接线)] \
    [--enable-anchor(解旁路 [505] 透明锚,仅 viggle 档语义)] \
    [--tier "2 · viggle"|"1 · 原生出图"] [--type 人物] [--seed N(缺省随机)]
    [--out 路径] [--dry-run]
"""
import argparse
import json
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
SKIP_TYPES = {"Note", "MarkdownNote"}          # 前端注释件,无 API 形
PASS_TYPES = {"Reroute"}                       # 解析穿越


def engine_base() -> str:
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    port = json.loads(manifest.read_text(encoding="utf-8")).get("engine", {}).get("port")
    return f"http://127.0.0.1:{port}"


ENGINE = engine_base()
_objinfo: dict = {}


def objinfo(cls):
    if cls not in _objinfo:
        u = f"{ENGINE}/object_info/{urllib.parse.quote(cls)}"
        _objinfo[cls] = json.load(urllib.request.urlopen(u, timeout=15))[cls]
    return _objinfo[cls]


LINK_TYPES = {"CLIP", "IMAGE", "VAE", "MODEL", "CONDITIONING", "LATENT", "MASK",
              "AUDIO", "VIDEO", "COMFY_AUTOGROW_V3", "COMFY_MATCHTYPE_V3", "IMAGEUPLOAD"}
WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "COMFY_DYNAMICCOMBO_V3"}
CONTROL_WORDS = {"fixed", "randomize", "increment", "decrement"}
# 前端扁平 wv → 0.39 API 名的按位 pick(object_info 不泛化时用;
# 采样子参=required 点式键,1013 实弹 400 教学钉入)
PICKERS = {
    "TextGenerate": {"max_length": 1, "sampling_mode": 2,
                     "sampling_mode.temperature": 3, "sampling_mode.top_k": 4,
                     "sampling_mode.top_p": 5, "sampling_mode.min_p": 6,
                     "sampling_mode.repetition_penalty": 7, "sampling_mode.seed": 8,
                     "sampling_mode.presence_penalty": 9, "thinking": 10,
                     "use_default_template": 11, "mtp": 12},
}


def widget_order(cls):
    """API widget 形输入名序:类型过滤(纯连线型/Autogrow 非.widget;forceInput 非/widget)。"""
    d = objinfo(cls)
    out = []
    for grp in ("required", "optional"):
        for k, v in d["input"].get(grp, {}).items():
            spec = v[1] if len(v) > 1 and isinstance(v[1], dict) else {}
            if spec.get("forceInput"):
                continue
            t = v[0]
            if isinstance(t, list) or (isinstance(t, str) and t in WIDGET_TYPES):
                out.append(k)
    return out


def widget_values(cls, wv):
    """wv → {API 名: 值}:剥 control 词后按 widget_order 对位;PICKERS 优先。"""
    vals = [v for v in (wv or []) if not (isinstance(v, str) and v in CONTROL_WORDS)]
    if cls in PICKERS:
        return {k: (wv[i] if i < len(wv) else None) for k, i in PICKERS[cls].items()}
    return dict(zip(widget_order(cls), vals))


class Flattener:
    def __init__(self, wf):
        self.wf = wf
        self.sgs = {sg["id"]: sg for sg in wf["definitions"]["subgraphs"]}
        self.g = {}          # API graph
        self._cache = {}     # (scope,node_id) -> (class, resolved out slot map)

    # --- 连线源解析:穿 Reroute;跨宿主边界交 resolve_host_out ---
    def node_api_inputs(self, n):
        """widget 值按 object_info 类型过滤序对位(control 词已剥);连线槽由调用方覆盖。"""
        return widget_values(n["type"], n.get("widgets_values"))

    def emit(self, key, cls, inputs):
        # 未知输入名剔除(upload 等纯前端件);点式键(images.imageN/sampling_mode.*)
        # =Autogrow/动态组合子输入,object_info 静态名单不载,放行
        try:
            d = objinfo(cls)["input"]
            known = {k for grp in ("required", "optional") for k in d.get(grp, {})}
            inputs = {k: v for k, v in inputs.items() if k in known or "." in k}
        except Exception:
            pass  # 类查不到(纯前端件)→原样交引擎,400 即暴露
        self.g[key] = {"class_type": cls, "inputs": inputs}

    def flatten(self, tier, overrides):
        wf = self.wf
        root = {n["id"]: n for n in wf["nodes"]}
        rlinks = {l[0]: l for l in wf["links"]}   # [id,src,sslot,dst,dslot,type]
        live_root = {i: n for i, n in root.items() if n.get("mode", 0) == 0 and n["type"] not in SKIP_TYPES}
        if overrides.get("enable_ref3"):
            for i in (12, 18):
                if i in root:
                    live_root[i] = root[i]
        if overrides.get("enable_anchor"):
            if 505 in root:
                live_root[505] = root[505]

        # 连线索引:宿主入线 dst_slot→src;宿主出线 src_slot→[dst]
        host_in, host_out = {}, {}
        for l in wf["links"]:
            lid, s, ss, d, ds, ty = l
            s_dead = s not in live_root
            d_dead = d not in live_root
            if d in root and root[d]["type"] in self.sgs and not s_dead and not d_dead:
                host_in.setdefault(d, {})[ds] = (s, ss, lid)
            if s in root and root[s]["type"] in self.sgs and not s_dead and not d_dead:
                host_out.setdefault(s, {})[ss] = (d, ds, lid)

        def resolve_root(nid, slot):
            """根域源解析:穿 Reroute;落点若是宿主则穿进其子图出线。
            返回 (域前缀或空, 节点id, 槽)。"""
            while root[nid]["type"] in PASS_TYPES:
                l = next(l for l in wf["links"] if l[3] == nid)
                nid, slot = l[1], l[2]
            if root[nid]["type"] in self.sgs:
                sg = self.sgs[root[nid]["type"]]
                l = next(x for x in sg["links"] if x["target_id"] == -20 and x["target_slot"] == slot)
                inner, slot = l["origin_id"], l["origin_slot"]
                sgn = {n["id"]: n for n in sg["nodes"]}
                while sgn[inner]["type"] in PASS_TYPES:
                    l2 = next(x for x in sg["links"] if x["target_id"] == inner)
                    inner, slot = l2["origin_id"], l2["origin_slot"]
                return f"{nid}:", inner, slot
            return "", nid, slot

        # 根域非宿主活节点 → API(Reroute 只作穿越解析,不发射)
        for nid, n in live_root.items():
            if n["type"] in self.sgs or n["type"] in PASS_TYPES:
                continue
            ins = self.node_api_inputs(n)
            for inp in n.get("inputs", []):
                if inp.get("link") is None:
                    continue
                l = rlinks[inp["link"]]
                p, s2, sslot = resolve_root(l[1], l[2])
                ins[inp["name"]] = [p + str(s2), sslot]
            if nid in overrides.get("images", {}):
                ins["image"] = overrides["images"][nid]
            self.emit(str(nid), n["type"], ins)

        # 宿主展开
        for hid, host in live_root.items():
            if host["type"] not in self.sgs:
                continue
            sg = self.sgs[host["type"]]
            sg_nodes = {n["id"]: n for n in sg["nodes"]}
            sg_links = {l["id"]: l for l in sg["links"]}
            pfx = f"{hid}:"
            # 宿主 widget 提升槽(有 "widget" 键的 inputs)按序对 widgets_values
            promoted = [(i["name"], i) for i in host.get("inputs", []) if "widget" in i]
            wv = host.get("widgets_values") or []
            lit = {sg_slot: wv[k] for k, (name, i) in enumerate(promoted)
                   for sg_slot in [next(idx for idx, s in enumerate(sg["inputs"]) if s["name"] == name)]}

            def cross_in(sg_slot):
                """-10 slot → ('link',[key,slot]) | ('lit',v) | None"""
                ext = host_in.get(hid, {}).get(sg_slot)
                if ext:
                    s, ss, _ = ext
                    p, s2, sslot = resolve_root(s, ss)
                    return ("link", [p + str(s2), sslot])
                if sg_slot in lit:
                    return ("lit", lit[sg_slot])
                return None

            def cross_out(sg_slot):
                return host_out.get(hid, {}).get(sg_slot)

            # 内部节点(旁路/注释剪除)
            inner_live = {i: n for i, n in sg_nodes.items()
                          if n.get("mode", 0) == 0 and n["type"] not in SKIP_TYPES}

            def inner_origin(nid, slot):
                while sg_nodes[nid]["type"] in PASS_TYPES:
                    l = next(l for l in sg["links"] if l["target_id"] == nid)
                    nid, slot = l["origin_id"], l["origin_slot"]
                return nid, slot

            for iid, n in inner_live.items():
                if n["type"] in PASS_TYPES:
                    continue
                key = pfx + str(iid)
                ins = self.node_api_inputs(n)
                for inp in n.get("inputs", []):
                    lid = inp.get("link")
                    if lid is None:
                        continue
                    l = sg_links[lid]
                    o, os_ = l["origin_id"], l["origin_slot"]
                    if o == -10:
                        c = cross_in(os_)
                        if c is None:
                            continue                      # 可选槽缺席(旁路图)
                        ins[inp["name"]] = c[1]
                    else:
                        o, os_ = inner_origin(o, os_)
                        ins[inp["name"]] = [pfx + str(o), os_]
                self.emit(key, n["type"], ins)

            # 宿主出线回填:-20 线(target_id=-20,target_slot=S)→外部消费者
            for l in sg["links"]:
                if l["target_id"] != -20:
                    continue
                S = l["target_slot"]
                inner_src, inner_slot = l["origin_id"], l["origin_slot"]
                while sg_nodes[inner_src]["type"] in PASS_TYPES:
                    ll = next(x for x in sg["links"] if x["target_id"] == inner_src)
                    inner_src, inner_slot = ll["origin_id"], ll["origin_slot"]
                ext = cross_out(S)
                if not ext:
                    continue
                d, ds, _ = ext
                if d in root and root[d]["type"] in self.sgs:
                    continue  # 宿主消费者:由其展开期 cross_in 经 resolve_root 穿线
                self.g[str(d)]["inputs"][root[d]["inputs"][ds]["name"]] = [pfx + str(inner_src), inner_slot]

            # 档位直通:剪 SpeedSelect 与未选支路(画布懒执行的无 lazy 等价形)
            # 1014 官方化:viggle 出线=段B 7024(σ表+9步双段链 7011/7012/7017-7024)
            if hid == 7:
                win = {"viggle": "7024", "fun": "7013"}.get(
                    "viggle" if "viggle" in tier else ("fun" if "Fun" in tier else ""), "7010")
                sel_key = pfx + "7015"
                win_key = pfx + win
                for k, e in self.g.items():
                    for name, v in list(e["inputs"].items()):
                        if isinstance(v, list) and v[0] == sel_key:
                            v[0] = win_key
                chain = ("7011", "7012", "7017", "7018", "7019", "7020",
                         "7021", "7022", "7023", "7024")
                drop = {sel_key} | {pfx + x for x in (
                    chain + ("7013",) if win == "7010" else
                    ("7010", "7013") if win == "7024" else
                    ("7010",) + chain)}
                for k in drop:
                    self.g.pop(k, None)


def structural_equivalence(wf, g, enable_ref3, enable_anchor, images, tier=""):
    """结构等价校验(工作流本体的机器自证):画布活节点集↔API 节点集、
    活连线集↔API 边集逐一断言;任何缺失/多出即 fail-closed。
    档位直通(画布懒执行的 headless 等价形)随 tier 口径计入期望集。"""
    root = {n["id"]: n for n in wf["nodes"]}
    sgs = {sg["id"]: sg for sg in wf["definitions"]["subgraphs"]}
    live = {i: n for i, n in root.items()
            if n.get("mode", 0) == 0 and n["type"] not in SKIP_TYPES}
    if enable_ref3:
        live.update({i: root[i] for i in (12, 18) if i in root})
    if enable_anchor:
        live.update({i: root[i] for i in (505,) if i in root})
    # 期望节点集:活根(非宿主/非穿越)+ 两子图活内部(非穿越)
    want = set()
    for i, n in live.items():
        if n["type"] in sgs:
            sg = sgs[n["type"]]
            accel = n["type"] == root[7]["type"] if 7 in root else False
            win = "7010"
            keep_set = set()
            if accel:
                win = {"viggle": "7024", "fun": "7013"}.get(
                    "viggle" if "viggle" in tier else ("fun" if "Fun" in tier else ""), "7010")
                chain = {"7011", "7012", "7017", "7018", "7019", "7020",
                         "7021", "7022", "7023", "7024"}
                keep_set = (chain | {"7014"}) if win == "7024" else \
                    ({"7013", "7014"} if win == "7013" else {"7010", "7014"})
            for m in sg["nodes"]:
                if m.get("mode", 0) == 0 and m["type"] not in SKIP_TYPES and m["type"] not in PASS_TYPES:
                    if accel and m["type"] == "MyQi21SpeedSelect":
                        continue  # 档位直通:被 winning 采样器替代
                    if accel and str(m["id"]) not in keep_set:
                        continue  # 未选支路全剪(1014 官方链归属 viggle 档)
                    want.add(f"{i}:{m['id']}")
        elif n["type"] not in PASS_TYPES:
            want.add(str(i))
    got = set(g.keys())
    missing, extra = want - got, got - want
    assert not missing and not extra, f"节点集不等价:缺{sorted(missing)} 多{sorted(extra)}"
    # 期望边集:画布每条活连线 → (源key,源槽,目标key,目标名)
    def key_of(nid, slot, side):
        n = root[nid]
        if n["type"] in sgs:
            sg = sgs[n["type"]]
            if side == "out":
                l = next(x for x in sg["links"] if x["target_id"] == -20 and x["target_slot"] == slot)
                src, slot = l["origin_id"], l["origin_slot"]
                while next(m for m in sg["nodes"] if m["id"] == src)["type"] in PASS_TYPES:
                    l2 = next(x for x in sg["links"] if x["target_id"] == src)
                    src, slot = l2["origin_id"], l2["origin_slot"]
                if src == 7015:  # 档位直通:SpeedSelect 出线=winning 采样器出线
                    src = int(win)
                return f"{nid}:{src}", slot
            return None  # 入方向由目标节点侧计数
        while n["type"] in PASS_TYPES:
            l = next(x for x in wf["links"] if x[3] == nid)
            nid, slot = l[1], l[2]
            n = root[nid]
            if n["type"] in sgs:
                return key_of(nid, slot, "out")
        return str(nid), slot
    edges = 0
    # 剪枝节点集 = 加速域被直通替代的件(边循环同步跳过;1014 官方链)
    win = {"viggle": "7024", "fun": "7013"}.get(
        "viggle" if "viggle" in tier else ("fun" if "Fun" in tier else ""), "7010")
    chain = {"7011", "7012", "7017", "7018", "7019", "7020", "7021", "7022", "7023", "7024"}
    keep_set = (chain | {"7014"}) if win == "7024" else \
        ({"7013", "7014"} if win == "7013" else {"7010", "7014"})
    pruned = {f"7:{x}" for x in ("7015", "7010", "7011", "7012", "7013", *chain)} - \
             {f"7:{x}" for x in keep_set}
    for l in wf["links"]:
        lid, s, ss, d, ds, ty = l
        if s not in live or d not in live:
            continue
        if f"7:{s}" in pruned or f"7:{d}" in pruned:
            continue
        if root[d]["type"] in sgs or root[d]["type"] in PASS_TYPES:
            continue  # 宿主入线/Reroute 目标:由内部 cross_in(已穿 Reroute)侧覆盖
        ks = key_of(s, ss, "out")
        if ks is None:
            continue
        name = root[d]["inputs"][ds]["name"]
        v = g[str(d)]["inputs"].get(name)
        assert isinstance(v, list) and v == [ks[0], ks[1]], \
            f"边不等价: link{lid} [{s}]{ss}→[{d}].{name} 期望[{ks[0]},{ks[1]}] 实得{v}"
        edges += 1
    return len(want), edges


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instruction", required=True)
    ap.add_argument("--type", default="人物")
    ap.add_argument("--subject", default=None,
                    help="主体句直给(缺省=官方换装例句语义下仍用 [400] 注入指令;此参仅改 [4011] 主体句位)")
    ap.add_argument("--rgba", default=None, choices=("自动", "true", "false"),
                    help="覆写面板「RGBA透明」三态(缺省=工作流现值;探针用)")
    ap.add_argument("--canvas-mp", type=float, default=None,
                    help="覆写 [16] 画布预缩 megapixels(缺省=工作流现值 1.5;官方 viggle 编辑甜点≈1.0)")
    ap.add_argument("--ref1", default="yanliao_yuanying_front.png")
    ap.add_argument("--ref2", default="clothing_light_blue_denim_shirt.png")
    ap.add_argument("--ref3", default=None)
    ap.add_argument("--enable-ref3", action="store_true")
    ap.add_argument("--enable-anchor", action="store_true",
                    help="解旁路 [505] 透明锚=模拟用户 Ctrl+B,仅 viggle 档语义")
    ap.add_argument("--tier", default=None, help="缺省=工作流宿主现值")
    ap.add_argument("--bypass-upscale", action="store_true",
                    help="旁路⑤SeedVR2放大组(=工作流文档化 Ctrl+B 操作,只出[8]直出图)")
    ap.add_argument("--no-pe", action="store_true",
                    help="PE启用?=false(=面板开关,直写选配臂文档态;探针提速用)")
    ap.add_argument("--cond-single", action="store_true",
                    help="诊断探针:viggle 段A/B conditioning 改接 positive_single([171] 单参考)")
    ap.add_argument("--seg6", action="store_true",
                    help="诊断探针:官方6步单段(σ表6点直连,摘段B/切分;鉴别段B是否alpha归零触发点)")
    ap.add_argument("--legacy6", action="store_true",
                    help="诊断探针:旧式 KSampler(simple 6步+合并式 LoRA)+双参考正源(E5:色彩修复归因)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wf = json.loads(WF.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    host6, host7 = root[6], root[7]
    # 指令真源=[400](「指令」槽经 [33] 拐自 [400] 连线,连线优先于宿主面板值——
    # 只写宿主 wv 不生效,1013 C弹实锤;两处同写保险)
    root[400]["widgets_values"] = [args.instruction]
    if args.subject:  # [4011] 主体句位(装配器 wv[0];九型扫用)
        sg6w = next(s for s in wf["definitions"]["subgraphs"] if s["name"].startswith("[6]"))
        next(n for n in sg6w["nodes"] if n["id"] == 4011)["widgets_values"][0] = args.subject
    if args.no_pe:
        root[6]["widgets_values"][2] = False
    if args.rgba:
        root[6]["widgets_values"][3] = args.rgba
    if args.canvas_mp:
        root[16]["widgets_values"][1] = args.canvas_mp
    if args.bypass_upscale:  # ⑤组框整组旁路([402] 文档化操作)
        for i in (501, 502, 503, 504):
            if i in root:
                root[i]["mode"] = 4
    host6_wv = list(host6["widgets_values"])
    host6_wv[0] = args.instruction
    host6_wv[1] = args.type
    host7_wv = list(host7["widgets_values"])
    if args.tier:
        host7_wv[0] = args.tier
    tier = host7_wv[0]
    seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
    host7_wv[1] = seed
    # 旁路占位对 [12]/[18] 的宿主 widget 缺席(其值随节点 widgets_values 走,可直改)
    if args.enable_ref3 and args.ref3 and 12 in root:
        root[12]["widgets_values"][0] = args.ref3

    fl = Flattener(wf)
    # 宿主 widgets_values 覆写注入
    host6["widgets_values"] = host6_wv
    host7["widgets_values"] = host7_wv
    fl.flatten(tier, {"enable_ref3": args.enable_ref3,
                      "enable_anchor": args.enable_anchor,
                      "images": {10: args.ref1, 11: args.ref2}})
    if args.cond_single:  # 诊断探针覆写(不落盘,仅本弹执行图)
        for k in ("7:7019", "7:7022"):
            fl.g[k]["inputs"]["conditioning"] = ["6:171", 0]
    if args.seg6:  # 官方6步单段探针:σ表换6点,段A直吃全表,段B族拆除
        SIG6 = "1.0, 0.9375, 0.875, 0.75, 0.5, 0.25"
        fl.g["7:7020"]["inputs"]["nodes"] = SIG6
        fl.g["7:7012"]["inputs"]["sigmas"] = ["7:7020", 0]
        for k in ("7:7021", "7:7022", "7:7023", "7:7024"):
            fl.g.pop(k, None)
        for e in fl.g.values():
            for v in e["inputs"].values():
                if isinstance(v, list) and v[0] == "7:7024":
                    v[0] = "7:7012"
    if args.legacy6:  # E5 探针:旧式采样形态(LoraLoaderModelOnly 合并+KSampler simple 6步)+双参考正源
        for k in ("7:7017", "7:7018", "7:7019", "7:7020", "7:7021", "7:7022", "7:7023", "7:7024"):
            fl.g.pop(k, None)
        fl.g["7:7011"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["9", 0], "lora_name": fl.g["7:7011"]["inputs"]["lora_name"],
            "strength_model": 1.0}}
        fl.g["7:7012"] = {"class_type": "KSampler", "inputs": {
            "model": ["7:7011", 0], "positive": ["6:4015", 0], "negative": ["6:4015", 1],
            "latent_image": ["20", 0], "seed": ["7:7014", 0], "steps": 6, "cfg": 1.0,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
        for e in fl.g.values():
            for v in e["inputs"].values():
                if isinstance(v, list) and v[0] == "7:7024":
                    v[0] = "7:7012"

    print(f"[fire] 型={args.type} 档={tier} seed={seed} ref3={'on('+str(args.ref3)+')' if args.enable_ref3 else 'off(旁路)'}"
          f" anchor={'on' if args.enable_anchor else 'off(旁路)'}")
    if args.enable_anchor and "viggle" not in tier:
        print(f"[WARN] --enable-anchor 仅 viggle 档语义(透明锚进 [171] 单参考编码),当前档={tier}:不拦停,照常执行")
    if args.cond_single or args.seg6 or args.legacy6:
        print("[fire] 探针覆写在驾(--cond-single/--seg6):跳过结构等价校验(诊断专用,非工作流态)")
    else:
        nn, ne = structural_equivalence(wf, fl.g, args.enable_ref3, args.enable_anchor,
                                        {10: args.ref1, 11: args.ref2, **({12: args.ref3} if args.enable_ref3 and args.ref3 else {})},
                                        tier=tier)
        print(f"[fire] 结构等价校验 PASS: 节点 {nn}↔{len(fl.g)} 活连线边 {ne} 全对上(工作流本体,零自建)")
    print(f"[fire] 展平节点数={len(fl.g)}: {sorted(fl.g.keys())}")
    if args.dry_run:
        print(json.dumps(fl.g, ensure_ascii=False, indent=1)[:4000])
        return
    req = urllib.request.Request(f"{ENGINE}/prompt",
                                 data=json.dumps({"prompt": fl.g, "client_id": "i2i-workflow-fire"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        sys_exit = f"400: {e.read().decode()[:800]}"
        raise SystemExit(sys_exit)
    print(f"queued {pid}")
    t0 = time.time()
    outs = None
    while time.time() - t0 < 1500:
        time.sleep(10)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=15) as r:
            hist = json.load(r)
        if pid in hist:
            outs = hist[pid].get("outputs", {})
            if any("images" in o for o in outs.values()):
                break
    assert outs, "超时无产物"
    outdir = Path(args.out) if args.out else REPO / "apps/output/i2i-fire-1013"
    outdir.mkdir(parents=True, exist_ok=True)
    got = []
    for nid, o in sorted(outs.items()):
        for img in o.get("images", []):
            p = outdir / img["filename"]
            urllib.request.urlretrieve(
                f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}&type={img.get('type','output')}", p)
            got.append((nid, p))
            print(f"  image <- node {nid}: {p}")
        if "text" in o:
            txt = o["text"]
            txt = "".join(txt) if isinstance(txt, list) else str(txt)
            snap = outdir / f"prompt_preview_{nid}.txt"
            snap.write_text(txt, encoding="utf-8")
            print(f"  text  <- node {nid}: {snap}({len(txt)}字)")
    meta = outdir / f"meta_{pid}.json"
    meta.write_text(json.dumps({"seed": seed, "tier": tier, "type": args.type,
                                "instruction": args.instruction, "ref1": args.ref1,
                                "ref2": args.ref2, "ref3": args.ref3 if args.enable_ref3 else None,
                                "graph_keys": sorted(fl.g.keys())}, ensure_ascii=False, indent=1),
                    encoding="utf-8")
    print(f"DONE ({time.time()-t0:.0f}s) [seed={seed} 档={tier}] meta→{meta}")


if __name__ == "__main__":
    main()
