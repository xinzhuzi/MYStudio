# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""设定表汉字标注节点(09-20 用户裁定案一:画面文字程序叠加)。

背景与定谳(09-20 CN 对照实弹):K2 底模文字渲染域=拉丁字母,画面内
汉字=似字非字假字,官方模板 VISIBLE TEXT 段被迫锁 English only。本节点
承接任务书「无文字版」(工作流侧模板已改 Do not render any text)后的
后处理:在设定板左栏程序叠加真汉字(姓名大字+身份字段+朱印),
内容 100% 准确、批量可自动化。

字体栈(09-20 二轮:用户裁定字形=大陆规范简体):
  苹方(默认)PingFang SC=macOS 官方简体规范字形——AssetsV2 资产目录
    哈希随系统更新漂移,故 glob 现探;缺则回退用户目录 Lark 副本。
  宋体 Songti SC=书卷气可选(刻本旧字形,非默认——旧字形观感被用户
    判「不是简体中文」,09-20 定谳)。
  黑体 STHeiti(大陆标准)→ Hiragino(日系字形,末位回退)。
  全缺=ImageFont.load_default(不可中文,保节点不炸+控制台警告)。

排版=比例布局(2K 2568×1712 校准,任意分辨率等比缩放):
  左栏中心 0.128W/栏左 0.042W;姓名 y0=0.112H(>6 字自动缩宽);
  分隔墨线;字段块行距 1.75×;朱印(边长 2.55×姓名字高,旋转 -4°,
  朱砂底白文 2×2,α=0.92)钉栏底 0.795H。字段溢出印区=截断+警告。
"""

from __future__ import annotations

import glob as _glob
import os

from PIL import Image, ImageDraw, ImageFont


def _pingfang_paths() -> list[str]:
    """PingFang.ttc 候选路径:AssetsV2 glob(哈希漂移自愈)→ Lark 副本。"""
    found = sorted(_glob.glob(
        "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/*/AssetData/PingFang.ttc"))
    lark = os.path.expanduser(
        "~/Library/Application Support/com.electron.lark.font_workaround/PingFang.ttc")
    if os.path.isfile(lark):
        found.append(lark)
    return found


# (路径或探测函数, bold_index, regular_index);探测函数=无参返回路径列表
FONT_STACKS: dict = {
    "苹方(简体)": [(_pingfang_paths, 11, 3)],   # SC Semibold / SC Regular
    "宋体": [("/System/Library/Fonts/Supplemental/Songti.ttc", 1, 6)],
    "黑体": [("/System/Library/Fonts/STHeiti Medium.ttc", 0, 0),
             ("/System/Library/Fonts/STHeiti Light.ttc", 0, 0),
             ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0, 0)],
}
INKS = {"墨黑": (38, 34, 30), "朱砂": (176, 42, 38)}
SEAL_RED = (176, 42, 38)
SEAL_TEXT = (245, 239, 230)


def _font_stack(family: str):
    return FONT_STACKS.get(family) or FONT_STACKS["苹方(简体)"]


def _load_font(family: str, size: int, bold: bool):
    if size <= 0:
        return ImageFont.load_default()
    for entry in _font_stack(family):
        path_or_fn, bold_idx, reg_idx = entry
        paths = path_or_fn() if callable(path_or_fn) else [path_or_fn]
        for path in paths:
            try:
                return ImageFont.truetype(path, size,
                                          index=bold_idx if bold else reg_idx)
            except OSError:
                continue
    print(f"[漫影 设定表标注] 中文字体栈全缺(family={family}),回退 PIL 默认字体——"
          "中文将不可读,请检查系统字体 /System/Library/Fonts/")
    return ImageFont.load_default()


def _tensor_to_pil(frame):
    import numpy as np  # 引擎侧,懒加载(同 my_reference 惯例)
    arr = frame.cpu().numpy()
    if arr.ndim == 4:  # 带批量维的切片(09-20 十轮拼版分支)
        arr = arr[0]
    return Image.fromarray((arr * 255.0).clip(0, 255).astype("uint8"))


def _pil_to_tensor(im: Image.Image):
    import numpy as np
    import torch
    return torch.from_numpy(np.array(im).astype("float32") / 255.0)[None,]


def _draw_seal(draw_im: Image.Image, center: tuple[float, float], side: float,
               text: str, family: str, alpha: float = 0.92):
    """朱印:独立 RGBA 层(旋转不伤底图),朱砂底+2×2 白文,整体 -4°。
    印文字体跟随节点 family(09-20 二轮:字形口径统一,防旧字形回潮)。"""
    layer = Image.new("RGBA", (int(side) + 8, int(side) + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = (4, 4, int(side) + 4, int(side) + 4)
    d.rectangle(box, fill=SEAL_RED + (int(alpha * 255),), outline=SEAL_RED + (255,), width=2)
    chars = list(text.replace(" ", ""))[:4] or ["印"]
    chars += [""] * (4 - len(chars))
    cell = side / 2
    fs = max(int(cell * 0.62), 8)
    font = _load_font(family, fs, bold=True)
    # 印文章法:右上→右下→左上→左下(传统印章读序)
    for slot, ch in zip((0, 1, 2, 3), chars):
        if not ch:
            continue
        col, row = slot % 2, slot // 2
        order = [(1, 0), (1, 1), (0, 0), (0, 1)]  # 列序右起
        cx = 4 + order[slot][0] * cell + cell / 2
        cy = 4 + order[slot][1] * cell + cell / 2
        bbox = d.textbbox((0, 0), ch, font=font)
        d.text((cx - (bbox[0] + bbox[2]) / 2, cy - (bbox[1] + bbox[3]) / 2), ch,
               font=font, fill=SEAL_TEXT + (255,))
    layer = layer.rotate(4.0, resample=Image.BICUBIC, expand=True)  # 底图坐标 -4°=层转 +4°
    draw_im.alpha_composite(layer, (int(center[0] - layer.width / 2),
                                    int(center[1] - layer.height / 2)))


class MyCharsheetLabels:
    """漫影设定表标注:image 入图左栏程序叠加真汉字出图(无文字版模板的
    配套后处理;JS 侧输入槽中文显示名见 web/my-charsheet-labels-node.js)。"""

    CATEGORY = "my"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "name": ("STRING", {"default": "青珣"}),
                "fields": ("STRING", {"multiline": True, "default": (
                    "筑基后期 · 剑修\n青云门 · 内门弟子\n佩剑『听澜』\n"
                    "青玉道袍 · 素银簪\n眉目沉静 藏三分锋")}),
                "font": (list(FONT_STACKS),),
                "name_size": ("INT", {"default": 92, "min": 24, "max": 200, "step": 2}),
                "field_size": ("INT", {"default": 40, "min": 12, "max": 96, "step": 2}),
                "ink": (list(INKS),),
                "seal_text": ("STRING", {"default": "道劫"}),
                "layout": (["纯拼版(无字)", "四格拼版", "四格条带", "左栏竖排"],),
                "grid_labels": ("STRING", {"multiline": True, "default": (
                    "半身像\n正面全身\n侧面全身\n背面全身")}),
            },
            # 四格拼版(09-20 十轮):image_b/c/d=第 2/3/4 视角单图(半身/正/侧/背
            # 单视角各自生成,人数/顺序由拼版定死——QuadView 一次成表人数不可控定谳)
            "optional": {
                "image_b": ("IMAGE", {"forceInput": True}),
                "image_c": ("IMAGE", {"forceInput": True}),
                "image_d": ("IMAGE", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        """节点代码热改穿透输出缓存(my_styles 09-16 同根修;MyDaojieBase 先例):
        返回源码 mtime 签名——代码动=签名变=重执行;未动=正常吃缓存(采样层免重跑)。"""
        import os
        try:
            return f"{os.path.getmtime(__file__):.0f}"
        except OSError:
            return float("nan")

    _PAPER = (247, 243, 235)  # 纸卡底色(暖白)

    def run(self, image, name, fields, font, name_size, field_size, ink,
            seal_text, layout="四格拼版",
            grid_labels="半身像\n正面全身\n侧面全身\n背面全身",
            image_b=None, image_c=None, image_d=None):
        import torch

        frames = [image[i:i + 1] for i in range(image.shape[0])]
        if layout in ("四格拼版", "纯拼版(无字)"):
            outs = []
            for idx, frame in enumerate(frames):
                quad = []
                for src in (image, image_b, image_c, image_d):
                    if src is None:
                        continue
                    quad.append(src[idx:idx + 1] if src.shape[0] > idx else src[-1:])
                canvas = self._compose_canvas(quad)
                if layout == "四格拼版":
                    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
                    self._draw_grid_card(canvas, overlay, name, fields, font,
                                         name_size, field_size, ink, seal_text,
                                         grid_labels, strip_mode=True)
                    canvas = Image.alpha_composite(canvas, overlay)
                outs.append(_pil_to_tensor(canvas.convert("RGB"))[0])
            return (torch.stack(outs),)

        outs = []
        for idx, frame in enumerate(frames):
            im = _tensor_to_pil(frame).convert("RGBA")
            overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
            if layout == "四格条带":
                self._draw_grid_card(im, overlay, name, fields, font, name_size,
                                     field_size, ink, seal_text, grid_labels,
                                     strip_mode=False)
            else:
                self._draw_column(overlay, name, fields, font, name_size,
                                  field_size, ink, seal_text)
            outs.append(_pil_to_tensor(Image.alpha_composite(im, overlay).convert("RGB"))[0])
        return (torch.stack(outs),)

    _CANVAS_W, _CANVAS_H = 2568, 1712  # 2K 3:2(用户定案)

    def _compose_canvas(self, quad):
        """四格拼版(十轮):四张单视角图横排成条→等比缩放到画布宽的 96%→
        垂直居中偏上放到 2568×1712 纸面画布;内容条下方留白带=格标签区
        (程序画,与人物物理隔离)。"""
        from PIL import Image
        tiles = [_tensor_to_pil(q[0]).convert("RGB") for q in quad] or \
            [Image.new("RGB", (768, 1024), "white")]
        th = 1712
        sized = []
        for t in tiles:
            r = th / t.height
            sized.append(t.resize((max(1, int(t.width * r)), th), Image.LANCZOS))
        strip_w = sum(t.width for t in sized)
        strip = Image.new("RGB", (strip_w, th), "white")
        x = 0
        for t in sized:
            strip.paste(t, (x, 0)); x += t.width
        # 满幅(十轮终:高铺满 1712 等比,宽不足左右补纸边)
        r = self._CANVAS_H / strip.height
        strip = strip.resize((max(1, int(strip.width * r)), self._CANVAS_H), Image.LANCZOS)
        canvas = Image.new("RGBA", (self._CANVAS_W, self._CANVAS_H), (255, 253, 248, 255))
        cx = (self._CANVAS_W - strip.width) // 2
        canvas.paste(strip, (cx, 0))
        return canvas

    def _draw_grid_card(self, im, overlay, name, fields, family, name_size,
                        field_size, ink, seal_text, grid_labels, strip_mode):
        """四格条带/拼版共用标注:信息卡(零接触放置)+格标签。
        strip_mode=True(拼版):格标签画在内容条下方留白带(等分=拼版顺序);
        strip_mode=False:仅信息卡(旧四格条带语义)。"""
        draw = ImageDraw.Draw(overlay)
        w, h = overlay.size
        ink_rgb = INKS.get(ink) or INKS["墨黑"]
        ink_a = int(0.95 * 255)
        labels = [ln.strip() for ln in grid_labels.splitlines() if ln.strip()]

        if strip_mode:
            band_y = int(h * 0.86)                        # 标签带(留白区)
            band_h = field_size * 1.6
            f_label = _load_font(family, field_size, bold=False)
            n = len(labels) or 1
            for i, label in enumerate(labels):
                x0 = w * 0.02 + (w * 0.96) * i / n
                x1 = w * 0.02 + (w * 0.96) * (i + 1) / n
                draw.rectangle((x0 + 8, band_y, x1 - 8, band_y + band_h),
                               fill=self._PAPER + (int(0.92 * 255),),
                               outline=ink_rgb + (int(0.5 * 255),), width=2)
                bbox = draw.textbbox((0, 0), label, font=f_label)
                draw.text(((x0 + x1 - bbox[0] - bbox[2]) / 2,
                           band_y + (band_h - bbox[3] + bbox[1]) / 2 - bbox[1]),
                          label, font=f_label, fill=ink_rgb + (ink_a,))
        else:
            segs = self._content_columns(im)
            if len(segs) != len(labels):
                print(f"[漫影 设定表标注] 内容段 {len(segs)} 与图例 {len(labels)} 不符——"
                      f"视图可能粘连/重复,建议换种子重roll")
            wide = [f"{(x1-x0)/w:.0%}" for x0, x1 in segs if (x1 - x0) > w * 0.32]
            if wide:
                print(f"[漫影 设定表标注] ⚠ 超宽段 {wide}(>32%)——疑似挤多视图,请读图核对")

        pad = name_size * 0.30
        eff = int(name_size * 0.62 * min(1.0, 6.0 / max(len(name), 1)))
        f_name = _load_font(family, eff, bold=True)
        f_field = _load_font(family, int(field_size * 0.82), bold=False)
        f_legend = _load_font(family, int(field_size * 0.78), bold=False)
        lines = [ln for ln in fields.splitlines() if ln.strip()][:4]
        legend = "格序 · " + " · ".join(labels)
        name_w = draw.textbbox((0, 0), name, font=f_name)[2]
        card_w = max(name_w,
                     draw.textbbox((0, 0), legend, font=f_legend)[2],
                     max((draw.textbbox((0, 0), ln, font=f_field)[2]
                          for ln in lines), default=0)) + pad * 2 + eff * 1.35
        card_h = pad * 1.4 + eff * 1.35 + len(lines) * eff * 1.1 + eff * 1.5
        card_overlay = self._place_card(im, w, h, card_w, card_h, family, eff,
                                        pad, name, lines, legend,
                                        f_name, f_field, f_legend,
                                        ink_rgb, seal_text)
        overlay.alpha_composite(card_overlay)

    @staticmethod
    def _content_columns(im, top_frac=0.84, floor=175, smooth_k=31,
                         density=0.05, min_seg_frac=0.03):
        """生成内容列段检测(09-20 四轮):QuadView 四格非精确等分,标签带须跟内容走。
        返回 [(x0,x1)] 像素段;不可用(全空/异常)返回空表。"""
        import numpy as np
        arr = np.array(im.convert("L"), dtype=float)
        h, w = arr.shape
        body = arr[: int(h * top_frac), :] < floor
        colfrac = body.mean(axis=0)
        if not colfrac.any():
            return []
        smooth = np.convolve(colfrac, np.ones(smooth_k) / smooth_k, mode="same")
        segs, s = [], None
        for i, v in enumerate(smooth > density):
            if v and s is None:
                s = i
            if not v and s is not None:
                if i - s > w * min_seg_frac:
                    segs.append((s, i))
                s = None
        if s is not None:
            segs.append((s, w))
        return segs

    @staticmethod
    def _card_collision(im, box, floor=170):
        """卡矩形与生成内容的重叠密度(09-20 八轮):按卡实际放置矩形算,
        不再用角窗口启发(七轮教训:窗口空≠卡矩形空,卡底边扫到特写头顶)。"""
        import numpy as np
        a = np.array(im.convert("L"), dtype=float)
        x0, y0, x1, y1 = [int(v) for v in box]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(a.shape[1], x1), min(a.shape[0], y1)
        if x1 <= x0 or y1 <= y0:
            return 1.0
        return float((a[y0:y1, x0:x1] < floor).mean())

    def _place_card(self, im, w, h, card_w, card_h, family, eff, pad,
                    name, lines, legend, f_name, f_field, f_legend,
                    ink_rgb, seal_text, max_density=0.08):
        """零接触放置(八轮):四角×全卡/迷你卡(只姓名+印)共 8 候选,
        选卡矩形内容密度最低者;全候选>阈值时仍取最低并打警告。"""
        margin = w * 0.012
        draw = None
        best = None   # (density, box, mini)
        for mini in (False, True):
            cw = card_w if not mini else max(card_w * 0.42, eff * 3.2)
            ch = card_h if not mini else eff * 2.6 + pad
            for cx in (margin, w - cw - margin):
                for cy in (margin, h - ch - margin):
                    box = (cx, cy, cx + cw, cy + ch)
                    d = self._card_collision(im, box)
                    if best is None or d < best[0]:
                        best = (d, box, mini)
        d, (cx, cy, x1, y1), mini = best
        if d > max_density:
            print(f"[漫影 设定表标注] ⚠ 全候选角均有内容(最低密度 {d:.2f}),"
                  f"卡仍压 {d:.0%} 区域——建议重roll换布局")
        else:
            print(f"[漫影 设定表标注] 卡落点 ({cx / w:.0%}, {cy / h:.0%})"
                  f" 密度 {d:.3f} (零接触阈值 {max_density})")
        overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        ink_a = int(0.95 * 255)
        draw.rounded_rectangle((cx, cy, x1, y1), radius=6,
                               fill=self._PAPER + (int(0.90 * 255),),
                               outline=ink_rgb + (int(0.6 * 255),), width=2)
        draw.text((cx + pad, cy + pad), name, font=f_name,
                  fill=ink_rgb + (ink_a,))
        if not mini:
            y = cy + pad + eff * 1.35
            for ln in lines:
                draw.text((cx + pad, y), ln, font=f_field,
                          fill=INKS["墨黑"] + (ink_a,))
                y += eff * 1.1
            draw.text((cx + pad, y + eff * 0.12), legend, font=f_legend,
                      fill=ink_rgb + (int(0.80 * 255),))
        _draw_seal(overlay, (x1 - eff * 0.62, y1 - eff * 0.62),
                   eff * 1.24, seal_text, family)
        return overlay

    def _draw_grid_bands(self, im, overlay, name, fields, family, name_size,
                         field_size, ink, seal_text, grid_labels):
        """四视图版式(09-20 八轮=零接触放置):信息卡承载姓名+字段+格序图例+
        小朱印;卡矩形与内容的重叠密度逐候选实测,8 候选取最低且≤阈值;
        不画底部条带。_content_columns 仅作格数审计日志。"""
        draw = ImageDraw.Draw(overlay)
        w, h = overlay.size
        ink_rgb = INKS.get(ink) or INKS["墨黑"]

        labels = [ln.strip() for ln in grid_labels.splitlines() if ln.strip()]
        segs = self._content_columns(im)
        if len(segs) != len(labels):
            print(f"[漫影 设定表标注] 内容段 {len(segs)} 与图例 {len(labels)} 不符——"
                  f"视图可能粘连/重复,建议换种子重roll(段中心:"
                  + " ".join(f"{(x0+x1)/2/w:.0%}" for x0, x1 in segs) + ")")
        wide = [f"{(x1-x0)/w:.0%}" for x0, x1 in segs if (x1 - x0) > w * 0.32]
        if wide:  # 九轮教训:段数对但宽段内挤多人(半身+正面=5 视图/多一背面漏报)
            print(f"[漫影 设定表标注] ⚠ 超宽段 {wide}(>32%)——该段疑似挤了多个"
                  f"视图,请读图核对人数/视图数,不符则重roll")

        pad = name_size * 0.30
        eff = int(name_size * 0.62 * min(1.0, 6.0 / max(len(name), 1)))
        f_name = _load_font(family, eff, bold=True)
        f_field = _load_font(family, int(field_size * 0.82), bold=False)
        f_legend = _load_font(family, int(field_size * 0.78), bold=False)
        lines = [ln for ln in fields.splitlines() if ln.strip()][:4]
        legend = "格序 · " + " · ".join(labels)
        name_w = draw.textbbox((0, 0), name, font=f_name)[2]
        card_w = max(name_w,
                     draw.textbbox((0, 0), legend, font=f_legend)[2],
                     max((draw.textbbox((0, 0), ln, font=f_field)[2]
                          for ln in lines), default=0)) + pad * 2 + eff * 1.35
        card_h = pad * 1.4 + eff * 1.35 + len(lines) * eff * 1.1 + eff * 1.5
        card_overlay = self._place_card(im, w, h, card_w, card_h, family, eff,
                                        pad, name, lines, legend,
                                        f_name, f_field, f_legend,
                                        ink_rgb, seal_text)
        overlay.alpha_composite(card_overlay)

    def _draw_column(self, overlay, name, fields, family, name_size,
                     field_size, ink, seal_text):
        """左栏竖排(旧 Dynamic 七区版式配套,保留)。"""
        draw = ImageDraw.Draw(overlay)
        w, h = overlay.size
        cx, x0 = 0.128 * w, 0.042 * w
        ink_rgb = INKS.get(ink) or INKS["墨黑"]
        ink_a = int(0.95 * 255)

        eff = int(name_size * min(1.0, 6.0 / max(len(name), 1)))
        f_name = _load_font(family, eff, bold=True)
        bbox = draw.textbbox((0, 0), name, font=f_name)
        draw.text((cx - (bbox[2] - bbox[0]) / 2, 0.112 * h), name,
                  font=f_name, fill=ink_rgb + (ink_a,))
        name_bottom = 0.112 * h + (bbox[3] - bbox[1]) + eff * 0.28

        ly = name_bottom + 0.010 * h
        draw.rectangle((x0, ly, x0 + 0.160 * w, ly + 2), fill=ink_rgb + (ink_a,))
        draw.rectangle((x0, ly + 6, x0 + 0.108 * w, ly + 7),
                       fill=ink_rgb + (int(0.45 * 255),))

        f_field = _load_font(family, field_size, bold=False)
        y = ly + 0.020 * h
        seal_top = 0.795 * h - 1.30 * (2.55 * eff)
        lines = [ln for ln in fields.splitlines() if ln.strip()]
        for i, ln in enumerate(lines):
            if y + field_size > seal_top:
                print(f"[漫影 设定表标注] 字段第 {i + 1} 行起溢出印区已截断"
                      f"(共 {len(lines)} 行,容 {i} 行);请精简 fields 或调 field_size")
                break
            draw.text((x0 + 0.006 * w, y), ln, font=f_field,
                      fill=INKS["墨黑"] + (ink_a,))
            y += field_size * 1.75

        _draw_seal(overlay, (cx, 0.795 * h), 2.55 * eff, seal_text, family)
