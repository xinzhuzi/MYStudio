"""my_sheet_card_composer.py — 道劫角色设定卡·格式一 v1 合成器(1113 道劫正册化)。

单真源件:固定底框几何/角标/角名/配色取色/预裁分格全内聚本件;
脚本 apps/build/scripts/daojie_sheet_b_frame.py 为薄壳 re-export(管线/金样同路)。
真源链:分格指令与武器/特效模板=qi21_bases.json#sheet_card(v1);
本件只管「固定框+固定方式」——框/格线/题名/16 角标程序绘(零缺笔零印章),
格内画面由上游 9 图(master/侧/背/面部/侧头/腕/腰/武器/特效)喂入。
字体链跨平台:Mac 楷体→冬黑→苹方;Win simkai→msyh。
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

# ── 画布与版式常量(3840×2160=设定卡 resolution_override 口径,32 对齐)──
W, H = 3840, 2160
M = 36          # 外边距
G = 20          # 格间距
FORMAT_VERSION = "v1.1"  # v1=1112 冻结;v1.1=1113 多格式注册表(全卡几何零改动)
PAPER = (247, 243, 234)      # 宣纸米白
INK_LINE = (107, 101, 90)    # 细线边框
INK_TEXT = (44, 39, 32)      # 角标/题名墨色

# ── 格式注册表(1113 用户令「固定成几个格式」)──
# 全卡=格式一 v1 几何逐字节恒定(金样锚);其余为同族衍生格式。
FORMATS = ("全卡", "简版", "竖版", "无武器")
CANVAS = {"全卡": (3840, 2160), "简版": (3840, 2160),
          "竖版": (2160, 3840), "无武器": (3840, 2160)}
CELL_KEYS_BY_FMT = {
    "全卡": ("front", "side", "back", "face", "head", "eye", "hair",
             "wrist", "waist", "weapon", "weapon_a", "weapon_b",
             "fabric_1", "fabric_2", "fabric_3", "gear_1", "gear_2",
             "fx_1", "fx_2"),
    "简版": ("front", "side", "back", "face", "head", "eye", "hair",
             "wrist", "waist"),                     # 三视图+六特写,砍四区
    "竖版": ("全卡同集=18 格"),
    "无武器": ("front", "side", "back", "face", "head", "eye", "hair",
               "wrist", "waist", "fabric_1", "fabric_2", "fabric_3",
               "gear_1", "gear_2", "fx_1", "fx_2"),  # 四区去武器区→三区
}
CELL_KEYS_BY_FMT["竖版"] = CELL_KEYS_BY_FMT["全卡"]

NAME_SIZE = 64                # 角名字号(右上角小档,1112 用户令「标题太大/仅占名位」)
LABEL_SIZE = 36               # 角标字号(4K 画布可辨下限)

FONT_CHAIN = (
    "/System/Library/Fonts/STKaiti.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "C:\\Windows\\Fonts\\simkai.ttf",   # Win 楷体
    "C:\\Windows\\Fonts\\msyh.ttc",     # Win 微软雅黑
)

# 格名登记;compose 断言缺格即红(半成品卡禁出门)
CELL_KEYS = (
    "front", "side", "back",                    # 三视图横排
    "face", "head", "eye", "hair", "wrist", "waist",   # 六格特写
    "weapon", "weapon_a", "weapon_b",           # 武器(整器+两局部)
    "fabric_1", "fabric_2", "fabric_3",         # 服饰纹理三样
    "gear_1", "gear_2",                         # 装备细节两格
    "fx_1", "fx_2",                             # 能力两格
)

LABELS = {
    "front": "正视图", "side": "侧视图", "back": "背视图",
    "face": "面部特写", "head": "头部细节", "eye": "眉眼", "hair": "发型",
    "wrist": "腕部", "waist": "腰部",
    "weapon": "武器展示", "weapon_a": "握持部位", "weapon_b": "收存结构",
    "fabric_1": "服饰纹理", "gear_1": "装备细节", "fx_1": "能力",
}


_BG_TRUTH_CANDIDATES = (
    __import__("pathlib").Path(__file__).resolve().parents[4]
    / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",
    __import__("pathlib").Path(__import__("os").environ.get(
        "MYSTUDIO_COMFYUI_HOME",
        __import__("pathlib").Path.home()
        / "Library/Application Support/漫影工作室/comfyui")) / "daojie-data",
    __import__("pathlib").Path("/Applications/漫影工作室.app/Contents/Resources/"
                               "studio-manuals/art_skills/daojie_ink_guofeng/json"),
)


def _bg_color(bg: str):
    """背景类型→画布底色(真源 sheet_card_qwen.backgrounds;缺位回退素白宣纸)。"""
    try:
        import json as _json
        for cand in _BG_TRUTH_CANDIDATES:
            p = cand / "qi21_bases.json"
            if p.is_file():
                tab = _json.loads(p.read_text(encoding="utf-8"))[
                    "sheet_card_qwen"]["backgrounds"]
                if bg in tab:
                    return tuple(tab[bg]["canvas"])
    except Exception:
        pass
    return PAPER  # 缺真源/未知型=默认素白宣纸(金样同色)


def _font(size: int) -> ImageFont.FreeTypeFont:
    """中文字体链(跨平台;题名后叠件同源口径)。"""
    for fp in FONT_CHAIN:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    raise RuntimeError("无可用中文字体:" + "|".join(FONT_CHAIN))


def layout(fmt: str = "全卡") -> dict:
    """版式几何(格式注册表 v1.1;全卡=格式一 v1 几何逐字节恒定)。"""
    assert fmt in FORMATS, f"未知格式 {fmt!r}({FORMATS})"
    cw_, ch_ = CANVAS[fmt]
    cells: dict = {}
    iw, ih = cw_ - 2 * M, ch_ - 2 * M
    if fmt == "全卡" or fmt == "竖版":
        scale = ih if fmt == "全卡" else ih  # 两版行比例同构,竖版画布高重塑
        r1 = round(ih * 0.55) if fmt == "全卡" else round(ih * 0.58)
        r4 = ih - G - r1
        y1, y4 = M, M + r1 + G
        vw = round(r1 * 1664 / 2496) + 48
        for i, k in enumerate(("front", "side", "back")):
            x = M + i * (vw + G)
            cells[k] = (x, y1, x + vw, y1 + r1)
        rx0 = M + 3 * vw + 2 * G
        rw = cw_ - M - rx0
        PH = 150
        cwid = (rw - 2 * G) // 3
        chh = (r1 - PH - 2 * G) // 2
        for i, k in enumerate(("face", "head", "eye", "hair", "wrist", "waist")):
            col, row = i % 3, i // 3
            x = rx0 + col * (cwid + G)
            y = y1 + row * (chh + G)
            cells[k] = (x, y, x + cwid, y + chh)
        cells["_palette"] = (rx0, y1 + r1 - PH, cw_ - M, y1 + r1)
        if fmt == "无武器":
            pass
        if fmt == "全卡" or fmt == "竖版":
            zw = iw - 3 * G
            z1w = round(zw * 0.40)
            zsw = (zw - z1w) // 3
            x = M
            z1 = (x, y4, x + z1w, y4 + r4); x += z1w + G
            z2 = (x, y4, x + zsw, y4 + r4); x += zsw + G
            z3 = (x, y4, x + zsw, y4 + r4); x += zsw + G
            z4 = (x, y4, cw_ - M, y4 + r4)
            wt = round(r4 * 0.58)
            ihh = (r4 - G) // 2
            cells["weapon"] = (z1[0], y4, z1[2], y4 + wt)
            mid = z1[0] + (z1[2] - z1[0] - G) // 2
            cells["weapon_a"] = (z1[0], y4 + wt + G, mid, y4 + r4)
            cells["weapon_b"] = (mid + G, y4 + wt + G, z1[2], y4 + r4)
            sh = (r4 - 2 * G) // 3
            for i, k in enumerate(("fabric_1", "fabric_2", "fabric_3")):
                y = y4 + i * (sh + G)
                cells[k] = (z2[0], y, z2[2], y + sh)
            cells["gear_1"] = (z3[0], y4, z3[2], y4 + ihh)
            cells["gear_2"] = (z3[0], y4 + ihh + G, z3[2], y4 + r4)
            cells["fx_1"] = (z4[0], y4, z4[2], y4 + ihh)
            cells["fx_2"] = (z4[0], y4 + ihh + G, z4[2], y4 + r4)
        return cells
    if fmt == "无武器":
        # 顶块同全卡;底部=三等区(服饰纵向三枚/装备上下/能力上下),武器区移除
        cells = layout("全卡")
        for k in ("weapon", "weapon_a", "weapon_b", "fabric_1", "fabric_2",
                  "fabric_3", "gear_1", "gear_2", "fx_1", "fx_2"):
            cells.pop(k)
        y4 = cells["_palette"][3] + G
        r4 = H - M - y4
        zw = (W - 2 * M - 2 * G) // 3
        sh = (r4 - 2 * G) // 3
        ihh = (r4 - G) // 2
        zx = (M, M + zw + G, M + 2 * (zw + G))
        for i, k in enumerate(("fabric_1", "fabric_2", "fabric_3")):
            y = y4 + i * (sh + G)
            cells[k] = (zx[0], y, zx[0] + zw, y + sh)
        cells["gear_1"] = (zx[1], y4, zx[1] + zw, y4 + ihh)
        cells["gear_2"] = (zx[1], y4 + ihh + G, zx[1] + zw, y4 + r4)
        cells["fx_1"] = (zx[2], y4, zx[2] + zw, y4 + ihh)
        cells["fx_2"] = (zx[2], y4 + ihh + G, zx[2] + zw, y4 + r4)
        return cells
    if fmt == "简版":
        # 三视图横排(52%)+六特写 6×1(40%)+配色条(8%),无底部区
        r1 = round(ih * 0.52)
        r2 = round(ih * 0.40)
        y1, y2 = M, M + r1 + G
        y3 = y2 + r2 + G
        vw = (iw - 2 * G) // 3
        for i, k in enumerate(("front", "side", "back")):
            x = M + i * (vw + G)
            cells[k] = (x, y1, x + vw, y1 + r1)
        cwid = (iw - 5 * G) // 6
        for i, k in enumerate(("face", "head", "eye", "hair", "wrist", "waist")):
            x = M + i * (cwid + G)
            cells[k] = (x, y2, x + cwid, y2 + r2)
        cells["_palette"] = (M, y3, W - M, H - M)
        return cells
    raise AssertionError(fmt)


def cells_focal() -> dict:
    """格名→裁剪焦点偏置(眉眼横带取面中部/发型取头顶/武器两局部取两端)。"""
    return {
        "front": (0.5, 0.46), "side": (0.5, 0.46), "back": (0.5, 0.46),
        "eye": (0.5, 0.36), "hair": (0.5, 0.20),
        "weapon_a": (0.12, 0.5), "weapon_b": (0.88, 0.5),
        "fabric_1": (0.5, 0.44), "fx_2": (0.62, 0.38),
    }


def fit_crop(img: Image.Image, rect, focal=(0.5, 0.5)) -> Image.Image:
    """按格矩长宽比 cover 裁剪缩放;focal=(fx,fy) 裁剪焦点(0..1,可偏置取局部)。"""
    x0, y0, x1, y1 = rect
    rw, rh = x1 - x0, y1 - y0
    iw, ih = img.size
    scale = max(rw / iw, rh / ih)
    nw, nh = max(rw, round(iw * scale)), max(rh, round(ih * scale))
    im = img.resize((nw, nh), Image.LANCZOS)
    cx, cy = nw * focal[0], nh * focal[1]
    lx = min(max(cx - rw / 2, 0), nw - rw)
    ly = min(max(cy - rh / 2, 0), nh - rh)
    return im.crop((round(lx), round(ly), round(lx) + rw, round(ly) + rh))


def extract_palette(img: Image.Image, n: int = 5):
    """主体实际设色提取:量化→仅滤画布纸底(月白衣不误伤)→最小色距去重→覆盖×饱和。"""
    small = img.convert("RGB")
    small.thumbnail((320, 320))
    q = small.quantize(colors=24, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:72]
    counts = sorted(q.getcolors() or [], reverse=True)
    picked: list = []

    def far_enough(rgb):
        return all(sum(abs(a - b) for a, b in zip(rgb, p)) > 60 for p, _ in picked)

    for cnt, idx in counts:
        r, g, b = pal[idx * 3: idx * 3 + 3]
        if abs(r - PAPER[0]) + abs(g - PAPER[1]) + abs(b - PAPER[2]) < 24:
            continue                      # 仅滤画布纸底本身
        mx, mn = max(r, g, b), min(r, g, b)
        sat = 0.0 if mx == 0 else (mx - mn) / mx
        rgb, score = (r, g, b), cnt * (0.2 + sat)
        if not far_enough(rgb):
            continue
        picked.append((rgb, score))
        if len(picked) >= n:
            break
    while len(picked) < n:                # 不足补墨色阶梯(仍守最小色距)
        for cand in ((44, 39, 32), (90, 86, 78), (140, 134, 122),
                     (190, 184, 170), (232, 226, 212)):
            if far_enough(cand):
                picked.append((cand, 0))
                break
        else:
            break
    return [c for c, _ in picked[:n]]


def _place(canvas: Image.Image, draw: ImageDraw.ImageDraw,
           img, rect, label: str | None, focal=(0.5, 0.5),
           label_font: ImageFont.FreeTypeFont | None = None,
           mode: str = "cover", paper=PAPER):
    """mode=cover:占满裁切(特写/局部);contain:整图入格居中,余白衬纸色
    (三视图/整器/眉眼横带=完整优先;1112 教训:cover 裁头/裁两端/裁外眼角)。"""
    x0, y0, x1, y1 = rect
    rw, rh = x1 - x0, y1 - y0
    if mode == "contain":
        iw, ih = img.size
        s = min(rw / iw, rh / ih)
        nw, nh = max(1, round(iw * s)), max(1, round(ih * s))
        tile = Image.new("RGB", (rw, rh), paper)
        tile.paste(img.resize((nw, nh), Image.LANCZOS), ((rw - nw) // 2, (rh - nh) // 2))
        canvas.paste(tile, (x0, y0))
    else:
        canvas.paste(fit_crop(img, rect, focal), (x0, y0))
    draw.rectangle(rect, outline=INK_LINE, width=2)
    if label:
        f = label_font or _font(LABEL_SIZE)
        bb = draw.textbbox((0, 0), label, font=f)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        pad = 8
        draw.rectangle((x0, y0, x0 + tw + 2 * pad, y0 + th + 2 * pad), fill=paper)
        draw.text((x0 + pad - bb[0], y0 + pad - bb[1]), label, font=f, fill=INK_TEXT)


def zoom(img: Image.Image, fx, fy, fw, fh=None) -> Image.Image:
    """以 (fx,fy) 为中心取 (fw,fh) 宽高比例预裁(眉眼取横带 fw>fh 配 contain 格)。"""
    fh = fh if fh is not None else fw
    w, h = img.size
    cw, chh = round(w * fw), round(h * fh)
    cx, cy = round(w * fx), round(h * fy)
    x0 = min(max(cx - cw // 2, 0), w - cw)
    y0 = min(max(cy - chh // 2, 0), h - chh)
    return img.crop((x0, y0, x0 + cw, y0 + chh))


def derive_cells(imgs: dict) -> dict:
    """9 步产物(master/side/back/face/head/wrist/waist/weapon/effect)→18 格。
    分格方式=格式一 v1 固定方式(直用+预裁放大;金样锚 419639ab)。"""
    need = {"master", "side", "back", "face", "head", "wrist", "waist",
            "weapon", "effect"}
    assert need <= set(imgs), f"缺步产物:{need - set(imgs)}"
    return {
        "front": imgs["master"], "side": imgs["side"], "back": imgs["back"],
        "face": imgs["face"], "head": imgs["head"],
        "eye": zoom(imgs["face"], 0.5, 0.42, 0.70, 0.26),
        "hair": zoom(imgs["head"], 0.5, 0.20, 0.60),
        "wrist": imgs["wrist"], "waist": imgs["waist"],
        "weapon": imgs["weapon"],
        "weapon_a": zoom(imgs["weapon"], 0.12, 0.5, 0.35),
        "weapon_b": zoom(imgs["weapon"], 0.88, 0.5, 0.35),
        "fabric_1": zoom(imgs["master"], 0.5, 0.42, 0.30),
        "fabric_2": zoom(imgs["waist"], 0.5, 0.5, 0.60),
        "fabric_3": zoom(imgs["wrist"], 0.5, 0.5, 0.60),
        "gear_1": zoom(imgs["waist"], 0.42, 0.52, 0.45),
        "gear_2": zoom(imgs["waist"], 0.45, 0.50, 0.40),
        "fx_1": imgs["effect"],
        "fx_2": zoom(imgs["effect"], 0.62, 0.35, 0.55),
    }


def compose(cells: dict, palette, title: str, dst: str, fmt: str = "全卡", bg: str = "素白宣纸") -> str:
    """整卡合成(文件路,脚本/金样用;fmt=格式注册表)。缺格断言红;恒 RGB。"""
    assert fmt in FORMATS, fmt
    keys = CELL_KEYS_BY_FMT[fmt]
    missing = [k for k in keys if not isinstance(cells.get(k), Image.Image)]
    assert not missing, f"缺格 {missing}({fmt} 应全填 {len(keys)} 格)"
    assert len(palette) == 5, "配色应恰五枚"
    cw_, ch_ = CANVAS[fmt]
    paper = _bg_color(bg)

    canvas = Image.new("RGB", (cw_, ch_), paper)
    d = ImageDraw.Draw(canvas)
    geo = layout(fmt)
    label_font = _font(LABEL_SIZE)

    # 外框(顶格版式:格子自顶起,无标题带)
    d.rectangle((M, M, cw_ - M, ch_ - M), outline=INK_LINE, width=3)
    # 格裁贴(三视图/整器/眉眼横带=contain 整图入格,其余 cover 裁切)
    CONTAIN = {"front", "side", "back", "weapon", "eye"}
    for k in keys:
        _place(canvas, d, cells[k], geo[k], LABELS.get(k),
               focal=cells_focal().get(k, (0.5, 0.5)), label_font=label_font,
               mode="contain" if k in CONTAIN else "cover", paper=paper)

    # 配色带:角标+五枚圆卡(取自主体实际设色)
    px0, py0, px1, py1 = geo["_palette"]
    bb = d.textbbox((0, 0), "配色", font=label_font)
    d.text((px0 + 8 - bb[0], py0 + (py1 - py0 - (bb[3] - bb[1])) // 2 - bb[1]),
           "配色", font=label_font, fill=INK_TEXT)
    r = min((py1 - py0) // 2 - 14, max(10, (px1 - px0 - 260) // 12))
    cx = px0 + 200
    cy = (py0 + py1) // 2
    for rgb in palette:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rgb,
                  outline=INK_LINE, width=3)
        cx += 2 * r + max(30, (px1 - px0 - 260 - 5 * 2 * r) // 4)

    # 角名=最后一步贴(1112 用户令「先画条条框框,最后名字贴到图上」):
    # 透明底浮于右上格面上,零衬底零遮挡。
    tf = _font(NAME_SIZE)
    bb = d.textbbox((0, 0), title, font=tf)
    tw = bb[2] - bb[0]
    d.text((cw_ - M - 20 - tw - bb[0], M + 12 - bb[1]), title,
           font=tf, fill=INK_TEXT)

    canvas.save(dst)  # RGB 模式保存,PNG 恒无 alpha
    return dst


def _selftest(dst="/tmp/sheetB_frame_selftest.png"):
    """离线几何自检:色块占位合成一整卡。"""
    import random
    random.seed(0)
    cells = {}
    for i, k in enumerate(CELL_KEYS):
        hue = (i * 37) % 255
        cells[k] = Image.new("RGB", (900, 600), (hue, (hue * 2) % 255, (hue * 3) % 255))
    compose(cells, [(200, 60, 60)] * 5, "自检·沈孤鸿", dst)
    im = Image.open(dst)
    assert im.size == (W, H) and im.mode == "RGB", (im.size, im.mode)


class MySheetCardComposer:
    """道劫角色设定卡·格式一 v1 合成器(1113 道劫正册化)。

    9 图入卡:master(正视图源)/side/back/face/head/wrist/waist/weapon/effect
    →固定底框(程序绘框线+16 角标+配色五圆+右上角名)→ 3840×2160 IMAGE。
    固定框/固定方式=本模块;分格指令真源=qi21_bases.json#sheet_card。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "master": ("IMAGE",), "side": ("IMAGE",), "back": ("IMAGE",),
            "face": ("IMAGE",), "head": ("IMAGE",),
            "wrist": ("IMAGE",), "waist": ("IMAGE",),
            "weapon": ("IMAGE",), "effect": ("IMAGE",),
            "角名": ("STRING", {"default": "沈孤鸿", "multiline": False}),
            "格式": (list(FORMATS), {"default": "全卡"}),
            "背景": ("STRING", {"default": "素白宣纸", "multiline": False}),
        }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("设定卡",)
    FUNCTION = "compose_card"
    CATEGORY = "道劫/设定卡"

    def compose_card(self, master, side, back, face, head, wrist, waist,
                     weapon, effect, 角名, 格式="全卡", 背景="素白宣纸"):
        import numpy as np  # 引擎内必在;懒导入保 Mac 纯文件路测试零 torch 依赖

        def to_pil(t):
            arr = (t[0].clamp(0, 1).cpu().numpy() * 255).round().astype("uint8")
            return Image.fromarray(arr)

        cells = derive_cells({
            "master": to_pil(master), "side": to_pil(side), "back": to_pil(back),
            "face": to_pil(face), "head": to_pil(head),
            "wrist": to_pil(wrist), "waist": to_pil(waist),
            "weapon": to_pil(weapon), "effect": to_pil(effect),
        })
        m = cells["front"]
        pal_src = m.crop((round(m.width * 0.32), 0,
                          round(m.width * 0.68), m.height))
        palette = extract_palette(pal_src)

        import io
        buf = io.BytesIO()
        compose(cells, palette, 角名, buf, fmt=格式, bg=背景)
        buf.seek(0)
        card = Image.open(buf).convert("RGB")

        import torch
        arr = np.asarray(card, dtype="float32") / 255.0
        return (torch.from_numpy(arr)[None,],)


NODE_CLASS_MAPPINGS = {"MySheetCardComposer": MySheetCardComposer}
