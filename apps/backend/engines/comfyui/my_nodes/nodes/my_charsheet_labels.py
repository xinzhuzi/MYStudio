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
    return Image.fromarray((frame.cpu().numpy() * 255.0).clip(0, 255).astype("uint8"))


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
                "layout": (["四格条带", "左栏竖排"],),
                "grid_labels": ("STRING", {"multiline": True, "default": (
                    "正面全身\n侧面全身\n背面全身\n面部特写")}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"

    _PAPER = (247, 243, 235)  # 纸卡底色(暖白)

    def run(self, image, name, fields, font, name_size, field_size, ink,
            seal_text, layout="四格条带", grid_labels="正面全身\n侧面全身\n背面全身\n面部特写"):
        import torch

        outs = []
        for frame in image:
            im = _tensor_to_pil(frame).convert("RGBA")
            overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
            if layout == "四格条带":
                self._draw_grid_bands(overlay, name, fields, font, name_size,
                                      field_size, ink, seal_text, grid_labels)
            else:
                self._draw_column(overlay, name, fields, font, name_size,
                                  field_size, ink, seal_text)
            outs.append(_pil_to_tensor(Image.alpha_composite(im, overlay).convert("RGB"))[0])
        return (torch.stack(outs),)

    def _draw_grid_bands(self, overlay, name, fields, family, name_size,
                         field_size, ink, seal_text, grid_labels):
        """四视图版式(09-20 三轮):四格等分横排——每格底部纸色条带写格标签,
        左上角色小卡(姓名+精简字段),小朱印贴卡侧。文字全部落在格间/条带,
        生成图内容零接触。"""
        draw = ImageDraw.Draw(overlay)
        w, h = overlay.size
        ink_rgb = INKS.get(ink) or INKS["墨黑"]
        ink_a = int(0.95 * 255)

        # ① 每格底部标签条带(四等分;格数随 grid_labels 行数自适应)
        labels = [ln.strip() for ln in grid_labels.splitlines() if ln.strip()] or ["正面全身"]
        n = max(len(labels), 1)
        band_h = field_size * 2.0
        y0 = h - band_h - field_size * 0.45
        cell_w = w / n
        f_label = _load_font(family, field_size, bold=False)
        for i, label in enumerate(labels):
            x0 = cell_w * i + field_size * 0.5
            x1 = cell_w * (i + 1) - field_size * 0.5
            draw.rectangle((x0, y0, x1, y0 + band_h),
                           fill=self._PAPER + (int(0.88 * 255),),
                           outline=ink_rgb + (int(0.5 * 255),), width=2)
            bbox = draw.textbbox((0, 0), label, font=f_label)
            draw.text(((x0 + x1 - bbox[0] - bbox[2]) / 2,
                       y0 + (band_h - (bbox[3] - bbox[1])) / 2 - bbox[1]),
                      label, font=f_label, fill=ink_rgb + (ink_a,))

        # ② 左上角色小卡(姓名大字+字段行,自适应高;溢出截断)
        pad = name_size * 0.30
        eff = int(name_size * 0.62 * min(1.0, 6.0 / max(len(name), 1)))
        f_name = _load_font(family, eff, bold=True)
        f_field = _load_font(family, int(field_size * 0.82), bold=False)
        lines = [ln for ln in fields.splitlines() if ln.strip()][:4]
        name_bb = draw.textbbox((0, 0), name, font=f_name)
        name_w = name_bb[2] - name_bb[0]
        card_x, card_y = w * 0.030, h * 0.032
        card_w = max([name_w] + [draw.textbbox((0, 0), ln, font=f_field)[2] for ln in lines] or [0]) \
            + pad * 2 + eff * 1.35  # 右侧留印位
        card_h = pad + (name_bb[3] - name_bb[1]) + eff * 0.30 \
            + len(lines) * field_size * 0.82 * 1.5 + pad * 0.4
        draw.rounded_rectangle((card_x, card_y, card_x + card_w, card_y + card_h),
                               radius=6, fill=self._PAPER + (int(0.90 * 255),),
                               outline=ink_rgb + (int(0.6 * 255),), width=2)
        draw.text((card_x + pad, card_y + pad - name_bb[1]), name,
                  font=f_name, fill=ink_rgb + (ink_a,))
        y = card_y + pad + (name_bb[3] - name_bb[1]) + eff * 0.30
        for ln in lines:
            bb = draw.textbbox((0, 0), ln, font=f_field)
            draw.text((card_x + pad + field_size * 0.15, y - bb[1]), ln,
                      font=f_field, fill=INKS["墨黑"] + (ink_a,))
            y += field_size * 0.82 * 1.5
        _draw_seal(overlay, (card_x + card_w - eff * 0.62,
                             card_y + card_h - eff * 0.62),
                   eff * 1.24, seal_text, family)

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
