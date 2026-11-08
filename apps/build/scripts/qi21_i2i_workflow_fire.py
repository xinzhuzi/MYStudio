#!/usr/bin/env python3
"""qi21-道劫-i2i.json 工作流本体直跑器(1013 用户令:「按照晏燎的图,做个图生图测试」)。

不做任何自建图——从工作流 GUI JSON **按其结构通用展平**成 API 格式发车
(与画布 graphToPrompt 同语义):
- 双子图([6] 提示词类型优化/[7] 加速)按定义就地展开,宿主边界穿越重连;
- 旁路语义=画布同款:mode 4 节点剪除、其连线剪断(image_2/3 默认缺席=1016 单参考默认;
  --enable-ref3 = 模拟用户对 [12]+[18] 按 Ctrl+B 解旁路并选图;[11]+[17] 同手法暂无旗,走画布);
- Reroute 一律解析穿越([42]/[43]/[44] 总线拐;[33] 1015 退役直连);
- 档位选择=[7:7015] MyQi21SpeedSelect 的画布懒执行在 headless 无 lazy 请求方,
  故按档直通:winning 采样器输出直代 SpeedSelect 出线,未选支路剪除
  (与画布执行图等价;1017 起面板出厂默认=「自动 · 按型」,展平前经
  resolve_speed_mode 按 --type 解析生效档再直通);
- seed=**每次随机**(random.randint;铁令),真注=flatten 后直写 7:7014/503:7402
  (宿主「seed」面板槽写值对老式宿主[7]不生效——1017up4 复查定谳);
- PE 改写=[4013] TextGenerate 本地 pe_i2i 检查点(全链零云端,API key 无涉)。

用法:python3 qi21_i2i_workflow_fire.py --instruction "..." \
    [--ref1 yanliao_yuanying_front.png] [--ref2 clothing_light_blue_denim_shirt.png] \
    [--ref3 yanliao_heti_front.png(--enable-ref3 才接线)] \
    [--enable-anchor(解旁路 [505] 透明锚,仅 viggle 档语义)] \
    [--tier "自动 · 按型"|"2 · viggle"|"1 · 原生出图"|"0 · Turbo 8步"(1016turbo 官方臂直通 7031;自动档按 --type 路由)] [--type 人物] [--seed N(缺省随机)]
    [--out 路径] [--dry-run]
"""
import argparse
import json
import random
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
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
                     "sampling_mode.presence_penalty": 9, "sampling_mode.thinking": 10,
                     "sampling_mode.use_default_template": 11, "sampling_mode.mtp": 12},
}

# 1017 增档令:面板首档=「自动 · 按型」(型名∈{设定卡,美宣,概念气氛图}→原生出图,其余
# 含空→Turbo);fire 侧镜像节点件 my_qi21_speed_select.resolve_slot 的路由表
# (headless 直通形无 lazy 请求方,须在展平前解析成生效档再剪支路)
AUTO_MODE = "自动 · 按型"
AUTO_DIRECT_TYPES = ("设定卡", "美宣", "概念气氛图")


def resolve_speed_mode(speed, type_name):
    """面板档×型名→生效档(1017;与 my_qi21_speed_select.resolve_slot 同路由表)。

    「自动 · 按型」按型名现算:型名∈{设定卡,美宣,概念气氛图}→「1 · 原生出图」,其余
    (含 None/空串)→「0 · Turbo 8步」(型名空=按 Turbo 缺省安全侧);手动档
    与未知串原样返回(未知串交引擎 /prompt combo 闭集硬校验报 400,
    fail-closed 不代选;--tier 显式给档不经型名改写)。"""
    if speed == AUTO_MODE:
        return "1 · 原生出图" if type_name in AUTO_DIRECT_TYPES else "0 · Turbo 8步"
    return speed


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
            # 1017up4 旁路宿主直通:源=旁路宿主也入索引(resolve_root 按型直通溯链)
            s_dead = s not in live_root and not (
                s in root and root[s]["type"] in self.sgs)
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
                # 1017up4 旁路宿主直通:mode4 宿主出槽→同型入槽,递归溯链
                # (超分母线 A/B/C 默认旁路,D 宿主入水=[5]/[509] 直通——与画布
                # graphToPrompt 旁路语义同款;S1 探针在案)
                if root[nid].get("mode", 0) != 0:
                    oty = root[nid]["outputs"][slot]["type"]
                    inp = next((i for i in root[nid].get("inputs", [])
                                if i.get("type") == oty and i.get("link") is not None), None)
                    l0 = rlinks[inp["link"]]
                    return resolve_root(l0[1], l0[2])
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
                # 1018inkbp:Reroute 与旁路件(mode!=0)统一前穿到其输入
                while nid in sg_nodes and (sg_nodes[nid]["type"] in PASS_TYPES
                                           or sg_nodes[nid].get("mode", 0) != 0):
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
                        if o == -10:  # 1018inkbp:前穿抵边界=吃宿主入参
                            c = cross_in(os_)
                            if c is None:
                                continue
                            ins[inp["name"]] = c[1]
                        else:
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
                # 1016turbo:fun→Turbo 出线=7031(官方臂;噪声/采样器复用 7017/7018)
                win = {"viggle": "7024", "Turbo": "7031"}.get(
                    "viggle" if "viggle" in tier else ("Turbo" if "Turbo" in tier else ""), "7010")
                sel_key = pfx + "7015"
                win_key = pfx + win
                for k, e in self.g.items():
                    for name, v in list(e["inputs"].items()):
                        if isinstance(v, list) and v[0] == sel_key:
                            v[0] = win_key
                chain = ("7011", "7012", "7017", "7018", "7019", "7020",
                         "7021", "7022", "7023", "7024")
                tchain = ("7028", "7029", "7030", "7031")   # 1016turbo 官方臂四件
                vig_only = ("7011", "7012", "7019", "7020",  # 7017/7018=两加速档共用
                            "7021", "7022", "7023", "7024")
                drop = {sel_key} | {pfx + x for x in (
                    chain + tchain if win == "7010" else
                    ("7010",) + tchain if win == "7024" else
                    ("7010",) + vig_only)}
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
                win = {"viggle": "7024", "Turbo": "7031"}.get(
                    "viggle" if "viggle" in tier else ("Turbo" if "Turbo" in tier else ""), "7010")
                chain = {"7011", "7012", "7017", "7018", "7019", "7020",
                         "7021", "7022", "7023", "7024"}
                tchain = {"7028", "7029", "7030", "7031"}   # 1016turbo 官方臂
                keep_set = (chain | {"7014", "7034"}) if win == "7024" else \
                    (tchain | {"7017", "7018", "7014", "7034"}) if win == "7031" else {"7010", "7014", "7034"}
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
    win = {"viggle": "7024", "Turbo": "7031"}.get(
        "viggle" if "viggle" in tier else ("Turbo" if "Turbo" in tier else ""), "7010")
    chain = {"7011", "7012", "7017", "7018", "7019", "7020", "7021", "7022", "7023", "7024"}
    tchain = {"7028", "7029", "7030", "7031"}   # 1016turbo 官方臂
    keep_set = (chain | {"7014", "7034"}) if win == "7024" else \
        (tchain | {"7017", "7018", "7014", "7034"}) if win == "7031" else {"7010", "7014", "7034"}
    # 1018inkling:[7034] 入口风格件三档共吃(不随档剪枝)
    pruned = {f"7:{x}" for x in ("7015", "7010", "7011", "7012", *chain, *tchain)} - \
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


def judge_png(p, nonblack_min=0.01, alpha_max_gate=5):
    """img_stat_1014.py :19/:23 同式数值判据(单源,9 型扫与自测共用):
    判黑=非黑<nonblack_min 或(alpha_max_gate>0 且 alpha.amax<=alpha_max_gate)。
    返回 dict(ok/nonblack/amin/amax/verdict)。"""
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(p).convert("RGBA"))
    rgb = a[..., :3].astype(float)
    nonblack = float((rgb.mean(axis=2) > 10).mean())
    alpha = a[..., 3]
    amin, amax = int(alpha.min()), int(alpha.max())
    if nonblack < nonblack_min:
        ok, verdict = False, f"纯黑屏(非黑={nonblack:.4f}<{nonblack_min})"
    elif alpha_max_gate and amax <= alpha_max_gate:
        ok, verdict = False, f"全透明(alpha {amin}-{amax},amax<={alpha_max_gate})"
    else:
        ok, verdict = True, f"非黑={nonblack:.2f} alpha={amin}-{amax}"
    return {"ok": ok, "nonblack": nonblack, "amin": amin, "amax": amax, "verdict": verdict}


def _fresh_seed(used):
    """重抽 fresh random,禁复用已用(判黑/超时)种子。"""
    while True:
        s = random.randint(1, 2**31 - 1)
        if s not in used:
            return s


def build_graph(args, seed):
    """展平+结构等价校验(测试缝:可整体替换)。返回 (tier, fl.g)。"""
    wf = json.loads(WF.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    host6, host7 = root[6], root[7]
    # 指令真源=[400](「指令」槽直连自 [400]([33] 拐 1015 退役),连线优先于宿主面板值——
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
    # 1017:面板原档(--tier 覆写后)可为「自动 · 按型」——按 --type 解析生效档,
    # 展平/结构等价校验/三处窗映射全按生效档走;面板原档记 build_graph.last_panel
    # 供 meta 双值(guard 测试缝 fake 不设该属性=回落生效档)
    tier_panel = host7_wv[0]
    tier = resolve_speed_mode(tier_panel, args.type)
    build_graph.last_panel = tier_panel
    host7_wv[1] = seed  # 此写对老式宿主[7]不生效,seed 真注=flatten 后直写 7:7014/503:7402(见下)
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
    # 1017up4 复查红:i2i seed 直注——宿主[7]为老式无 widget 键(promoted 空),
    # Flattener lit 直通不达,主链 7:7014 与 D 尾 503:7402 落回子图内恒 0
    # (1016 收装起即如此=基线旧红;铁律「每次生图必随机种子」i2i 全链未达)。
    # 手法与 t2i fire(:298 PrimitiveInt value=seed)同款:
    for k in ("7:7014", "503:7402"):
        if k in fl.g and fl.g[k]["class_type"] == "PrimitiveInt":
            fl.g[k]["inputs"]["value"] = seed
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
    if args.empty_latent:  # 诊断探针覆写(不落盘,仅本弹执行图):[19]=true 走 [4] 空潜自定义画幅
        ew, eh = args.empty_latent
        # 发射前自检断言:双路接线必须原样(盘上契约锚 :4516/:4580 区的运行态镜像)
        assert fl.g["20"]["inputs"]["switch"] == ["19", 0], \
            f"[20].switch 应=[\"19\",0](画幅开关源 [19]),得 {fl.g['20']['inputs'].get('switch')}"
        assert fl.g["20"]["inputs"]["on_true"] == ["4", 0], \
            f"[20].on_true 应=[\"4\",0](EmptyLatentImage [4]),得 {fl.g['20']['inputs'].get('on_true')}"
        fl.g["19"]["inputs"]["value"] = True
        fl.g["4"]["inputs"]["width"] = ew
        fl.g["4"]["inputs"]["height"] = eh
        print(f"[fire] --empty-latent 探针在驾:[19].value=True [4].width/height={ew}×{eh}"
              f"(仅本弹执行图,工作流零落盘)")

    print(f"[fire] 型={args.type} 档={tier_panel}→生效档={tier} seed={seed} ref3={'on('+str(args.ref3)+')' if args.enable_ref3 else 'off(旁路)'}"
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
    return tier, fl.g


def submit(graph):
    """POST /prompt(测试缝)。"""
    req = urllib.request.Request(
        f"{ENGINE}/prompt",
        data=json.dumps({"prompt": graph, "client_id": "i2i-workflow-fire"}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        raise SystemExit(f"400: {e.read().decode()[:800]}")


def poll_products(pid, poll_timeout=1500, interval=10):
    """/history 轮询至有图;超时返回 None(verdict=timeout,不再 assert 崩);
    轮询瞬断(并行看门狗回收窗口)不即崩,续轮到有界超时。"""
    t0 = time.time()
    while time.time() - t0 < poll_timeout:
        time.sleep(interval)
        try:
            with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=15) as r:
                hist = json.load(r)
        except Exception:
            continue
        if pid in hist:
            outs = hist[pid].get("outputs", {})
            if any("images" in o for o in outs.values()):
                return outs
    return None


def download(outs, outdir):
    """产物下载(测试缝),返回图片路径列。"""
    got = []
    for nid, o in sorted(outs.items()):
        for img in o.get("images", []):
            p = outdir / img["filename"]
            urllib.request.urlretrieve(
                f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}&type={img.get('type','output')}", p)
            got.append(p)
            print(f"  image <- node {nid}: {p}")
        if "text" in o:
            txt = o["text"]
            txt = "".join(txt) if isinstance(txt, list) else str(txt)
            snap = outdir / f"prompt_preview_{nid}.txt"
            snap.write_text(txt, encoding="utf-8")
            print(f"  text  <- node {nid}: {snap}({len(txt)}字)")
    return got


def fire_once(args, seed):
    """单发(测试缝):展平→发车→轮询下载→判黑。判黑对象=该发下载全部 PNG,
    任一判黑即整发判黑(废件全移 <out>/guard-rejected/,通过件原位)。
    轮询超时显式归类 verdict=timeout(不再 assert 崩)。
    返回 (status, files):status ∈ pass/black/timeout。"""
    outdir = Path(args.out) if args.out else REPO / "apps/output/i2i-fire-1013"
    outdir.mkdir(parents=True, exist_ok=True)
    tier, graph = build_graph(args, seed)
    pid = submit(graph)
    print(f"queued {pid}")
    outs = poll_products(pid)
    if outs is None:
        return "timeout", []
    files = download(outs, outdir)
    meta = outdir / f"meta_{pid}.json"
    meta.write_text(json.dumps({"seed": seed, "tier": tier,
                                "tier_panel": getattr(build_graph, "last_panel", tier),
                                "type": args.type,
                                "instruction": args.instruction, "ref1": args.ref1,
                                "ref2": args.ref2, "ref3": args.ref3 if args.enable_ref3 else None,
                                "graph_keys": sorted(graph.keys())}, ensure_ascii=False, indent=1),
                    encoding="utf-8")
    verdicts, black = [], False
    for p in files:
        j = judge_png(p, args.guard_nonblack, args.guard_alpha_max)
        verdicts.append(f"{p.name}: {j['verdict']}")
        black |= not j["ok"]
    for v in verdicts:
        print(f"  [judge] {v}")
    if black:
        rej = outdir / "guard-rejected"
        rej.mkdir(parents=True, exist_ok=True)
        for p in files:
            p.rename(rej / f"seed{seed}_{p.name}")
        print(f"[fire] 判黑:整发 {len(files)} 件移 {rej}")
        return "black", []
    return "pass", files


def run_guard(args, outdir):
    """guard 主循环(可测):--guard 关=单发;开=总发≤guard_max+1。
    黑/超时两形态同计数面有界重抽(重抽恒 fresh random 禁复用判黑种子,
    盲抽不放量);meta_guard.json(attempts+终局)落 outdir。返回退出码。"""
    guard_max = args.guard_max if args.guard else 0
    attempts, seeds = [], []
    final = "pass"
    for attempt in range(guard_max + 1):
        seed = args.seed if (attempt == 0 and args.seed is not None) else _fresh_seed(seeds)
        seeds.append(seed)
        status, _files = fire_once(args, seed)
        attempts.append({"attempt": attempt, "seed": seed, "status": status})
        print(f"[fire] guard attempt{attempt}/{guard_max} seed={seed} → {status}")
        if status == "pass":
            final = "pass"
            break
        final = status
    meta = {"guard": bool(args.guard), "guard_max": guard_max,
            "guard_nonblack": args.guard_nonblack, "guard_alpha_max": args.guard_alpha_max,
            "attempts": attempts, "final": final,
            "seed_policy": "首发可 --seed 固定;判黑/超时重抽恒 fresh random 禁复用判黑种子(黑/超时两形态同规)"}
    (outdir / "meta_guard.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1),
                                            encoding="utf-8")
    if final != "pass":
        print(f"[fire] guard 耗尽 exit 1:终局={final}"
              + ("(超时非黑,盲抽不放量)" if final == "timeout" else "(判黑,盲抽不放量)"))
        return 1
    print(f"[fire] guard 通过:attempts={len(attempts)} 终局=pass")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instruction", required=True)
    ap.add_argument("--type", default="人物海报")
    ap.add_argument("--subject", default=None,
                    help="主体句直给(缺省=官方换装例句语义下仍用 [400] 注入指令;此参仅改 [4011] 主体句位)")
    ap.add_argument("--rgba", default=None, choices=("自动", "true", "false"),
                    help="覆写面板「RGBA透明」三态(缺省=工作流现值;探针用)")
    ap.add_argument("--canvas-mp", type=float, default=None,
                    help="覆写 [16] 画布预缩 megapixels(缺省=工作流现值 1.0;1014 定谳 viggle 稳定区,勿升 1.5)")
    ap.add_argument("--ref1", default="yanliao_yuanying_front.png")
    ap.add_argument("--ref2", default="clothing_light_blue_denim_shirt.png")
    ap.add_argument("--ref3", default=None)
    ap.add_argument("--enable-ref3", action="store_true")
    ap.add_argument("--enable-anchor", action="store_true",
                    help="解旁路 [505] 透明锚=模拟用户 Ctrl+B,仅 viggle 档语义")
    ap.add_argument("--guard", action="store_true",
                    help="判黑/超时有界重试闸:总发≤guard_max+1;重抽恒 fresh random(--seed 仅首发,黑/超时两形态同规);"
                         "判黑=img_stat_1014 同式(该发任一 PNG 非黑<--guard-nonblack 或 alpha.amax<=--guard-alpha-max 即整发判黑),"
                         "废件移 <out>/guard-rejected/,耗尽 exit 1(超时非黑/判黑两终局)")
    ap.add_argument("--guard-max", type=int, default=2,
                    help="重试上限 N(缺省 2,总发≤N+1;仅 --guard 生效)")
    ap.add_argument("--guard-nonblack", type=float, default=0.01,
                    help="非黑门(缺省 0.01=img_stat_1014.py:19 同式)")
    ap.add_argument("--guard-alpha-max", type=int, default=5,
                    help="alpha.amax 门(缺省 5=img_stat_1014.py:23 同式;0=关)")
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
    ap.add_argument("--empty-latent", nargs=2, type=int, default=None, metavar=("W", "H"),
                    help="诊断探针:[19]=true 走 [4] 空潜自定义画幅 W×H(仅本弹执行图,工作流零落盘;"
                         "契约锚 [19] 源默认 false/[20].on_true←[4] 盘上原样)")
    ap.add_argument("--seed", type=int, default=None,
                    help="首发固定种子;判黑/超时重抽恒 fresh random 禁复用判黑种子(黑/超时两形态同规)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.dry_run:
        seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
        _tier, graph = build_graph(args, seed)
        print(json.dumps(graph, ensure_ascii=False, indent=1)[:4000])
        return
    outdir = Path(args.out) if args.out else REPO / "apps/output/i2i-fire-1013"
    outdir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    code = run_guard(args, outdir)
    if code == 0:
        print(f"DONE ({time.time() - t0:.0f}s)")
    sys.exit(code)


if __name__ == "__main__":
    main()
