#!/usr/bin/env python3
"""布局预览渲染(调研用临时件):按坐标把 GUI 工作流某作用域画成图——组框/节点框/贝塞尔连线。
用法: python3 render.py <工作流相对路径> <out.png> [--sub N] [--norm [--tol]] [--width 1600]"""
import json
import math
import os
import sys

sys.path.insert(0, "/tmp/wflayout-research.g8dxXV")
import opcc2 as opcc
from layout_check import _pos, _iter_links

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc",
                   "/System/Library/Fonts/Hiragino Sans GB.ttc", "/Library/Fonts/Arial Unicode.ttf"]
WIRE_COLORS = {"MODEL": "#b58b8a", "CLIP": "#ffd52f", "VAE": "#a1d0ad", "CONDITIONING": "#d5a52a",
               "LATENT": "#c99042", "IMAGE": "#64b1f4", "MASK": "#8f8f8f", "INT": "#296bad", "FLOAT": "#296bad",
               "STRING": "#a5b1be", "BOOLEAN": "#54b48b", "SIGMAS": "#8f458f", "NOISE": "#8f458f",
               "GUIDER": "#8f458f", "SAMPLER": "#8f458f", "COMBO": "#a5b1be"}


def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def scope_of(doc, which):
    """返回 (nodes, [(lid, oid, os, tid, ts, type)], groups, name)。"""
    if which < 0:
        raw, nodes, groups, name = doc.get("links") or [], doc.get("nodes") or [], doc.get("groups") or [], "main"
    else:
        sg = (doc.get("definitions") or {}).get("subgraphs")[which]
        raw, nodes, groups, name = sg.get("links") or [], sg.get("nodes") or [], sg.get("groups") or [], sg.get("name")
    links = []
    for l in raw:
        if isinstance(l, dict):
            links.append((l["id"], l.get("origin_id"), l.get("origin_slot", 0), l.get("target_id"), l.get("target_slot", 0), l.get("type")))
        else:
            links.append((l[0], l[1], l[2], l[3], l[4], l[5] if len(l) > 5 else None))
    return nodes, links, groups, name


def render(doc, which, path, width=1600, height=1100, title=""):
    nodes, links, groups, name = scope_of(doc, which)
    by = {n["id"]: n for n in nodes}
    boxes = {n["id"]: opcc.vbox(n) for n in nodes}
    grects = [(g["bounding"][0], g["bounding"][1], g["bounding"][0] + g["bounding"][2], g["bounding"][1] + g["bounding"][3], g.get("title", "")) for g in groups]
    xs0 = [b[0] for b in boxes.values()] + [g[0] for g in grects] + [0]
    ys0 = [b[1] for b in boxes.values()] + [g[1] for g in grects] + [0]
    xs1 = [b[2] for b in boxes.values()] + [g[2] for g in grects] + [1]
    ys1 = [b[3] for b in boxes.values()] + [g[3] for g in grects] + [1]
    x0, y0, x1, y1 = min(xs0), min(ys0), max(xs1), max(ys1)
    sc = min((width - 40) / max(1, x1 - x0), (height - 70) / max(1, y1 - y0))
    img = Image.new("RGB", (width, height), (31, 33, 36))
    d = ImageDraw.Draw(img)
    T = lambda x, y: (20 + (x - x0) * sc, 50 + (y - y0) * sc)
    f_title, f_node, f_grp = font(15), font(max(8, min(13, int(13 / max(sc, 0.01) * 0.0 + 11)))), font(13)
    d.text((16, 12), "%s  画布 %d×%d px  缩放 %.2f×  节点 %d  组 %d" % (title or name, x1 - x0, y1 - y0, sc, len(nodes), len(groups)), fill=(230, 230, 230), font=f_title)
    for gx0, gy0, gx1, gy1, gt in grects:
        a = T(gx0, gy0); b = T(gx1, gy1)
        d.rectangle([a, b], fill=(46, 54, 62), outline=(96, 125, 139), width=2)
        if sc > 0.12:
            d.text((a[0] + 6, a[1] + 4), gt[:40], fill=(176, 196, 206), font=f_grp)

    def bez(p0, p3, n=40):
        k = max(40, min(200, abs(p3[0] - p0[0]) * 0.5))
        p1, p2 = (p0[0] + k, p0[1]), (p3[0] - k, p3[1])
        out = []
        for i in range(n + 1):
            t = i / n; mt = 1 - t
            out.append((mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                        mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1]))
        return out

    for lid, oid, os_, tid, ts_, lt in links:
        if oid not in boxes or tid not in boxes:
            continue
        A, B = boxes[oid], boxes[tid]
        p0 = (A[2], A[1] + 25 + (os_ or 0) * 20); p3 = (B[0], B[1] + 25 + (ts_ or 0) * 20)
        pts = [T(x, y) for x, y in bez(p0, p3)]
        col = WIRE_COLORS.get(lt if isinstance(lt, str) else (lt[0] if lt else "STRING"), "#8a8a8a")
        d.line(pts, fill=col, width=1)
    for i, n in enumerate(nodes):
        b = boxes[n["id"]]
        a = T(b[0], b[1]); c = T(b[2], b[3])
        if n.get("type") == "Reroute":
            d.ellipse([a[0] - 2, a[1] - 2, a[0] + 4, a[1] + 4], fill=(200, 200, 200))
            continue
        body = (52, 58, 64) if n.get("type") != "MarkdownNote" else (44, 48, 52)
        d.rectangle([a, c], fill=body, outline=(150, 150, 150), width=1)
        d.rectangle([a, (c[0], a[1] + min(18, c[1] - a[1]))], fill=(70, 78, 86))
        if (c[1] - a[1]) >= 14 and (c[0] - a[0]) >= 24:
            t = n.get("title") or n.get("type") or ""
            if len(t) > 26 and not n.get("title"):
                t = t[:24] + "…"
            d.text((a[0] + 3, a[1] + 2), t[:30], fill=(235, 235, 235), font=f_node)
    img.save(path)
    return sc, (x1 - x0, y1 - y0)


if __name__ == "__main__":
    root = os.path.join(opcc.REPO, "apps/backend/comfyui/workflows")
    rel, out = sys.argv[1], sys.argv[2]
    which = int(sys.argv[sys.argv.index("--sub") + 1]) if "--sub" in sys.argv else -1
    width = int(sys.argv[sys.argv.index("--width") + 1]) if "--width" in sys.argv else 1600
    doc = json.load(open(os.path.join(root, rel), encoding="utf-8"))
    title = ""
    if "--norm" in sys.argv:
        P = dict(opcc.DEF)
        if "--ht" in sys.argv:
            P["H_T"] = float(sys.argv[sys.argv.index("--ht") + 1])
        if "--vt" in sys.argv:
            P["V_T"] = float(sys.argv[sys.argv.index("--vt") + 1])
        if "--gate" in sys.argv:      # 过守门(立宪严格)沿档位梯子选档
            new, rep = opcc.process(doc, P=P, ladder=(1.0, 1.5, 2.0, float("inf")))
            if new is None:
                new, _r = opcc.normalize_groups_only(doc, P)
                title = "整治后·守门全梯子不过 → 只动组框"
            else:
                title = "整治后·严格守门选档 %s(目标档 横≤%g 纵≤%g)" % (opcc.fmt_scale(rep["scale"]), P["H_T"], P["V_T"])
            doc = new
        else:                         # 不守门:固定档,看最紧凑效果
            doc, _r = opcc.normalize(doc, 1.0, P)
            title = "整治后·不守门 固定最紧档(横隙≤%g 纵隙≤%g)" % (P["H_T"], P["V_T"])
    print(render(doc, which, out, width=width, title=title))
